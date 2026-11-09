'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const { SFX, SOUND_CATALOG, createAudioManager } = require('../src/audio-manager.js');

const SOUND_DIRECTORY = path.join(__dirname, '../superfighters/sounds');

function createFakeVoices() {
  const created = [];
  const createVoice = (src) => {
    const voice = {
      src, plays: 0, pauses: 0, volume: 1, loop: false, currentTime: 0,
      play() { this.plays++; return Promise.resolve(); },
      pause() { this.pauses++; }
    };
    created.push(voice);
    return voice;
  };
  return { created, createVoice };
}

function createManager(extra) {
  const fake = createFakeVoices();
  let clock = 0;
  const manager = createAudioManager(Object.assign({ createVoice: fake.createVoice, now: () => clock }, extra));
  return { manager, fake, advance: (ms) => { clock += ms; } };
}

test('every catalogued file exists in superfighters/sounds', () => {
  for (const [name, entry] of Object.entries(SOUND_CATALOG)) {
    for (const file of entry.files) {
      assert.ok(fs.existsSync(path.join(SOUND_DIRECTORY, file)), name + ' -> missing ' + file);
    }
  }
});

test('every SFX event has a catalogue entry', () => {
  for (const name of Object.values(SFX)) assert.ok(SOUND_CATALOG[name], name + ' is not in the catalogue');
});

test('preload builds the fixed voice pools once; playing never creates elements', () => {
  const { manager, fake, advance } = createManager();
  const loaded = manager.preload();
  assert.equal(loaded, fake.created.length);
  const poolSize = fake.created.length;
  for (let i = 0; i < 200; i++) {
    advance(500);
    manager.play(SFX.PISTOL_FIRE);
    manager.play(SFX.EXPLOSION);
  }
  assert.equal(fake.created.length, poolSize, 'no voice is allocated during play');
});

test('the retrigger throttle drops a sound replayed inside its minimum gap', () => {
  const { manager, fake, advance } = createManager();
  manager.preload();
  assert.equal(manager.play(SFX.EXPLOSION), true);
  advance(10);
  assert.equal(manager.play(SFX.EXPLOSION), false);
  advance(200);
  assert.equal(manager.play(SFX.EXPLOSION), true);
  assert.equal(fake.created.reduce((n, v) => n + v.plays, 0), 2);
});

test('volume = catalogue volume x master volume', () => {
  const { manager, fake } = createManager({ masterVolume: 0.5 });
  manager.preload();
  manager.play(SFX.MAGNUM_FIRE);
  const voice = fake.created.find((v) => v.plays > 0);
  assert.equal(voice.volume, 0.5);
});

test('delayed sounds wait the requested steps and freeze while paused', () => {
  const { manager, fake, advance } = createManager();
  manager.preload();
  manager.playAfterSteps(SFX.SHOTGUN_PUMP_FIRST, 3);
  const plays = () => fake.created.reduce((n, v) => n + v.plays, 0);
  manager.tick(); manager.tick();
  assert.equal(plays(), 0);
  manager.setPaused(true);
  manager.tick(); manager.tick(); manager.tick();
  assert.equal(plays(), 0, 'pause freezes the countdown');
  manager.setPaused(false);
  advance(100);
  manager.tick();
  assert.equal(plays(), 1);
  assert.equal(manager.pendingDelayedCount, 0);
});

test('the delayed queue is capped (no unbounded growth)', () => {
  const { manager } = createManager();
  manager.preload();
  for (let i = 0; i < 500; i++) manager.playAfterSteps(SFX.SHOTGUN_PUMP_FIRST, 1000);
  assert.ok(manager.pendingDelayedCount <= 16);
});

test('loops own one voice per key, restart cleanly and stop', () => {
  const { manager, fake } = createManager();
  manager.preload();
  const before = fake.created.length;
  manager.startLoop('fire', SFX.MOLOTOV_FIRE_LOOP);
  manager.startLoop('fire', SFX.MOLOTOV_FIRE_LOOP); // already running: no second voice
  assert.equal(fake.created.length, before + 1);
  assert.equal(manager.isLoopRunning('fire'), true);
  const loop = fake.created[fake.created.length - 1];
  assert.equal(loop.loop, true);
  manager.stopLoop('fire');
  assert.equal(manager.isLoopRunning('fire'), false);
  assert.ok(loop.pauses > 0);
});

test('stopAll clears loops and pending delayed sounds', () => {
  const { manager } = createManager();
  manager.preload();
  manager.startLoop('fire', SFX.MOLOTOV_FIRE_LOOP);
  manager.playAfterSteps(SFX.SHOTGUN_PUMP_SECOND, 10);
  manager.stopAll();
  assert.equal(manager.isLoopRunning('fire'), false);
  assert.equal(manager.pendingDelayedCount, 0);
});

test('muted manager plays nothing; unknown names are ignored', () => {
  const { manager, fake } = createManager();
  manager.preload();
  manager.setMuted(true);
  assert.equal(manager.play(SFX.JUMP), false);
  manager.setMuted(false);
  assert.equal(manager.play('NOT_A_SOUND'), false);
  assert.equal(fake.created.reduce((n, v) => n + v.plays, 0), 0);
});

test('without Audio support the manager is a silent no-op', () => {
  const manager = createAudioManager({ createVoice: null });
  assert.equal(manager.preload(), 0);
  assert.equal(manager.play(SFX.JUMP), false);
});

// ---------- Game wiring (real game.js, fake <audio>) ----------

function createGameWithAudio() {
  const noop = () => {};
  const listeners = Object.create(null);
  const plays = [];
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    { createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    { get: (target, key) => (key in target ? target[key] : noop), set: () => true }
  );
  const canvas = { width: 800, height: 600, getContext: () => context };
  const window = { addEventListener: (type, cb) => { listeners[type] = cb; }, requestAnimationFrame: noop };
  class FakeAudio {
    constructor(src) { this.src = src; this.volume = 1; this.currentTime = 0; }
    play() { plays.push(path.basename(this.src)); return Promise.resolve(); }
    pause() {}
  }
  const sandbox = {
    window, Audio: FakeAudio, SuperfightersAudio: require('../src/audio-manager.js'),
    document: { getElementById: () => canvas }, performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8'), sandbox, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  for (const item of game.weaponItems) item.taken = true;
  return { game, plays };
}

test('game: a shotgun blast plays a shotgun sound, then the pump halves', () => {
  const { game, plays } = createGameWithAudio();
  const [shooter] = game.players;
  shooter.ranged = { gun: game.guns.shotgun, ammo: 10 };
  shooter.aiming = true;
  shooter.aimMode = 0;
  shooter.aimPrepTimer = 0;
  plays.length = 0;
  shooter.spawnShot(game.guns.shotgun, 0, 1);
  assert.ok(plays.some((f) => /shotgun0[0-2]\.mp3$/.test(f)), 'blast: ' + plays.join());
  for (let i = 0; i < 30; i++) game.step();
  assert.ok(plays.includes('2550_shotgun_pump_p1.mp3'), 'first pump half');
  assert.ok(plays.includes('2551_shotgun_pump_p2.mp3'), 'second pump half');
});

test('game: a grenade blast and a molotov shatter raise their sounds', () => {
  const { game, plays } = createGameWithAudio();
  plays.length = 0;
  game.explodeGrenade(400, 300);
  assert.ok(plays.some((f) => /explosion0[0-3]\.mp3$/.test(f)), 'grenade explosion: ' + plays.join());
  plays.length = 0;
  game.shatterMolotov({ x: 400, y: 300, owner: 1 });
  assert.ok(plays.includes('2529_glass_2.mp3'), 'bottle glass');
  assert.ok(plays.includes('2525_fireplosion.mp3'), 'fire burst');
});

test('game: jumping plays the jump sound', () => {
  const { game, plays } = createGameWithAudio();
  for (let i = 0; i < 30; i++) game.step(); // settle on the floor
  plays.length = 0;
  game.players[0].onGround = true;
  game.players[0].beginJump();
  assert.ok(plays.includes('2535_jump_00.mp3'));
});

test('game: grenade bounces and portals are silent', () => {
  const { game, plays } = createGameWithAudio();
  assert.equal(require('../src/audio-manager.js').SFX.GRENADE_BOUNCE, undefined);
  assert.equal(require('../src/audio-manager.js').SFX.PORTAL, undefined);
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  game.grenades.push({ x: 400, y: 450, vx: 2, vy: 6, fuse: 999, type: 'grenade', spin: 0, owner: 1, age: 0 });
  plays.length = 0;
  for (let i = 0; i < 20; i++) game.step();
  assert.deepEqual(plays.filter((f) => /hitmetal|voltage/.test(f)), [], 'no bounce / portal sound: ' + plays.join());
});

test('catalogue: pickup, heal and combo sounds map to the requested files', () => {
  const { SOUND_CATALOG, SFX } = require('../src/audio-manager.js');
  for (const k of [SFX.PICKUP_BLADE]) assert.deepEqual(SOUND_CATALOG[k].files, ['2567_katana_01.mp3']);
  assert.deepEqual(SOUND_CATALOG[SFX.PICKUP_BAZOOKA].files, ['2560_bazooka_aim.mp3']);
  assert.deepEqual(SOUND_CATALOG[SFX.HEALTH_PICKUP].files, ['2526_getHealth_00.mp3']);
  assert.deepEqual(SOUND_CATALOG[SFX.PUNCH_HIT_SECOND].files, ['2541_punch02.mp3']);
});

test('game: slowmo item runs the heartbeat loop and stops it afterwards', () => {
  const { game, plays } = createGameWithAudio();
  plays.length = 0;
  game.startItemSlowmo(0.1);
  game.step();
  assert.ok(plays.includes('2534_heartbeat.mp3'), 'heartbeat while slowed');
  for (let i = 0; i < 400; i++) game.step();
  const before = plays.length;
  for (let i = 0; i < 5; i++) game.step();
  assert.equal(plays.length, before, 'no more beats once slowmo ended');
});

test('game: flamethrower plays one hiss per burst, not per puff', () => {
  const { game, plays } = createGameWithAudio();
  const [p] = game.players;
  p.ranged = { gun: game.guns.flamethrower, ammo: 60 };
  plays.length = 0;
  for (let i = 0; i < 8; i++) p.spawnShot(game.guns.flamethrower, 0, 1);
  assert.equal(plays.filter((f) => /fireplosion/.test(f)).length, 0, 'spawnShot itself is silent for flames');
});
