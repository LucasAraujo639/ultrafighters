'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};

function createGame(options) {
  const listeners = Object.create(null);
  const fills = [];
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient
    },
    {
      get(target, key) {
        if (key === 'fillText') return (text) => fills.push(String(text));
        return key in target ? target[key] : noop;
      },
      set() {
        return true;
      }
    }
  );
  const canvas = { width: 800, height: 600, getContext: () => context };
  const window = {
    addEventListener(type, callback) {
      listeners[type] = callback;
    },
    requestAnimationFrame() {}
  };
  const sandbox = {
    window,
    document: { getElementById: () => canvas },
    performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  };

  // optional stand-in for the browser's HTMLAudioElement: enough surface for
  // the mod-audio paths (play/pause/ended) to run deterministically in-vm
  if (options && options.withAudio) {
    class MockAudio {
      constructor(src) {
        this.src = src;
        this.preload = 'auto';
        this.currentTime = 0;
        this.duration = 6.27; // kame_charge.mp3 length drives the charge cap
        this.readyState = 4;
        this.loop = false;
        this.paused = true;
        this.onended = null;
        this.playCount = 0;
        this.pauseCount = 0;
        MockAudio.instances.push(this);
      }
      play() { this.playCount++; this.paused = false; return { catch() {} }; }
      pause() { this.pauseCount++; this.paused = true; }
    }
    MockAudio.instances = [];
    sandbox.Audio = MockAudio;
  }

  vm.runInNewContext(gameSource, sandbox, { filename: 'src/game.js' });
  const game = sandbox.window.__sf;
  _keys.down = (code) => listeners.keydown({ code, repeat: false, preventDefault: noop });
  _keys.up = (code) => listeners.keyup({ code, preventDefault: noop });
  game.botActive = false; // the bot never writes the SSJ2 ability keys
  for (const item of game.weaponItems) item.taken = true;
  return {
    game,
    listeners,
    fills,
    audio: (options && options.withAudio) ? sandbox.Audio.instances : null
  };
}

function keyDown(listeners, code) {
  listeners.keydown({ code, repeat: false, preventDefault: noop });
}
function keyUp(listeners, code) {
  listeners.keyup({ code, preventDefault: noop });
}

function setFloor(game) {
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  for (const crate of game.crates) crate.dead = true;
  return floor;
}

// parks the fighter on the floor in a plain stance
function park(p, x, floor) {
  Object.assign(p, {
    x,
    y: floor.y - p.h,
    airVelocityX: 0,
    airVelocityY: 0,
    onGround: true,
    groundedPlatform: null,
    jumping: false,
    jumpPushTimeLeft: 0,
    falling: false,
    knockedDown: false,
    knockedDownFrame: 0,
    rolling: false,
    knockbackRoll: false,
    diving: false,
    climbing: false,
    wallJumping: false,
    grabbedBy: null,
    grabbedPlayerNr: 0,
    stunTimer: 0,
    staggering: false,
    punching: false,
    aiming: false,
    startAimASAP: false,
    sprinting: false,
    sprintArmed: 0,
    reSprintWindow: 0,
    walking: false,
    running: false,
    throwPose: 0,
    crouching: false,
    inCover: false,
    hpDamageTimer: 9999 // freeze regen for deterministic HP reads
  });
  p.groundedPlatform = floor;
  p.cover.reset();
  p.hp = 100;
  p.barHP = 100;
}

const arrowFighter = (game) => game.players[1];
const rival = (game) => game.players[0];

// the test helpers' listeners alias, re-bound inside the render smoke test
const _keys = { down: null, up: null };
function keyDownByCode(code) { _keys.down(code); }
function keyUpByCode(code) { _keys.up(code); }

function typeSsjWord(listeners) {
  for (let i = 0; i < 14; i++) {
    const ch = i % 2 === 0 ? 'KeyJ' : 'KeyK';
    keyDown(listeners, ch);
    keyUp(listeners, ch);
  }
}

test("the cheat word 'jkjkjkjkjkjkjk' transforms the arrow-key fighter under an open sky", () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  park(rival(game), 200, floor);

  assert.equal(goku.ssj2, null, 'starts plain');
  typeSsjWord(listeners);
  assert.ok(goku.ssj2, 'the transformation landed');
  assert.ok(goku.ssjKi >= 45, 'the state seeds a playable Ki gauge');
});

test('the cheat never triggers while something solid hangs above the fighter', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  // a roof right over the ritual site
  const roof = { x: 360, y: 300, w: 80, h: 12, solidSides: true, cloud: false, ladder: false };
  game.platforms.push(roof);

  typeSsjWord(listeners);
  assert.equal(goku.ssj2, null, 'no roof means no ritual');
  assert.equal(game.cheat.blockedHint > 0, true, 'the blocked ritual says so');
});

test('a non-letter key breaks the sequence (consecutive means consecutive)', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);

  for (const ch of ['KeyJ', 'KeyK', 'KeyJ', 'KeyK', 'KeyJ', 'KeyK', 'KeyJ']) {
    keyDown(listeners, ch);
    keyUp(listeners, ch);
  }
  keyDown(listeners, 'ArrowLeft'); // movement between letters resets the buffer
  keyUp(listeners, 'ArrowLeft');
  for (const ch of ['KeyK', 'KeyJ', 'KeyK', 'KeyJ', 'KeyK', 'KeyJ', 'KeyK']) {
    keyDown(listeners, ch);
    keyUp(listeners, ch);
  }
  assert.equal(goku.ssj2, null, 'the broken stream never transforms');
});

test('SSJ2 boosts the walk speed above the extracted base run', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  // the mult is self-consistent and above 1: walk vs base speed check
  assert.ok(goku.ssjSpeedMult() > 1, 'the shell multiplies the run speed');
  assert.ok(goku.ssjJumpMult() > 1, 'the shell multiplies the jump power');
});

function gokuIn(game, floor, phase) {
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  park(rival(game), 200, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  goku.ssjPhase = phase || 'ssj';
  goku.ssjKi = 100;
  return goku;
}

test('J is reserved in SSJ: it does nothing', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ssj');
  const victim = rival(game);
  const hp = victim.hp;
  keyDown(listeners, 'KeyJ');
  for (let f = 0; f < 60; f++) game.step();
  keyUp(listeners, 'KeyJ');
  assert.equal(goku.ssjMelee, null);
  assert.equal(goku.ssjCombo, null);
  assert.equal(goku.ssjRays, null);
  assert.equal(victim.hp, hp);
  assert.equal(goku.ssjPhase, 'ssj', 'activation starts as plain Super Saiyan');
});

test('SSJ2 flies permanently without pressing the fly key', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ssj2');
  for (let f = 0; f < 5; f++) game.step();
  assert.equal(goku.ssjFlying, true);
  const y0 = goku.y;
  for (let f = 0; f < 60; f++) game.step();
  assert.ok(goku.y <= y0 + 1, 'no gravity pulls the flying SSJ2 down');
});

test('SSJ2 J plays the attack art 1..10 and connects on the rival', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ssj2');
  const victim = rival(game);
  park(victim, goku.x - goku.w - 10, floor);
  goku.lastDirX = -1;
  const hp = victim.hp;
  keyDown(listeners, 'KeyJ');
  game.step();
  assert.ok(goku.ssjMelee, 'the melee sequence started');
  const frames = new Set();
  for (let f = 0; f < 60 && goku.ssjMelee; f++) {
    frames.add(goku.ssjMelee.frame);
    game.step();
  }
  keyUp(listeners, 'KeyJ');
  assert.equal(goku.ssjMelee, null, 'the sequence ended');
  assert.equal(frames.size, 10, 'all ten attack frames played');
  assert.ok(victim.hp < hp, 'the blows connected');
});

test('SSJ small Kamehameha is smaller than the SSJ2 large one', () => {
  const sizes = {};
  for (const phase of ['ssj', 'ssj2']) {
    const { game, listeners } = createGame();
    const floor = setFloor(game);
    const goku = gokuIn(game, floor, phase);
    keyDown(listeners, 'KeyK');
    game.step();
    keyUp(listeners, 'KeyK');
    for (let f = 0; f < 4; f++) game.step();
    assert.ok(game.ssjBeams.length >= 1, phase + ' fired');
    sizes[phase] = game.ssjBeams[0].size;
  }
  assert.ok(sizes.ssj2 > sizes.ssj, 'SSJ2 fires the bigger beam');
});

test('holding the Ki recharge at full Ki for 3 s plays the SSJ -> SSJ2 sequence', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ssj');
  keyDown(listeners, 'Semicolon');
  for (let f = 0; f < 150; f++) game.step();
  assert.equal(goku.ssjPhase, 'ssj', 'still SSJ before 3 s');
  assert.equal(goku.transformationPose, null);
  for (let f = 0; f < 60; f++) game.step();
  assert.ok(goku.transformationPose && goku.transformationPose.set === 'toSsj2', 'the transformation sequence plays');
  for (let f = 0; f < 200; f++) game.step();
  keyUp(listeners, 'Semicolon');
  assert.equal(goku.ssjPhase, 'ssj2', 'SSJ2 landed');
});

test('SSJ2 -> UI: release before 5 s cuts the furious audio; past 5 s it plays out', () => {
  {
    const { game, listeners } = createGame({ withAudio: true });
    const floor = setFloor(game);
    const goku = gokuIn(game, floor, 'ssj2');
    keyDown(listeners, 'Semicolon');
    for (let f = 0; f < 10; f++) game.step();
    const furious = game.modAudio.furious;
    assert.equal(furious.playCount, 1, 'furious audio starts as soon as full Ki is held');
    const pauses = furious.pauseCount;
    keyUp(listeners, 'Semicolon');
    for (let f = 0; f < 3; f++) game.step();
    assert.ok(furious.pauseCount > pauses, 'released early: the audio is cut');
    assert.equal(goku.ssjPhase, 'ssj2');
  }
  {
    const { game, listeners } = createGame({ withAudio: true });
    const floor = setFloor(game);
    const goku = gokuIn(game, floor, 'ssj2');
    keyDown(listeners, 'Semicolon');
    for (let f = 0; f < 320; f++) game.step();
    assert.ok(goku.transformationPose && goku.transformationPose.set === 'toUi', 'past 3 s the UI sequence starts');
    assert.equal(game.modAudio.cosmic.playCount, 1, 'explosioncosmica starts at the 3 s lock');
    assert.equal(game.modAudio.cosmic.paused, false, 'cosmic audio is sounding');
    assert.equal(game.modAudio.furious.paused, false, 'on top of the furious recharge audio, which keeps playing');
    const furious = game.modAudio.furious;
    const pauses = furious.pauseCount;
    keyUp(listeners, 'Semicolon');
    for (let f = 0; f < 520; f++) game.step();
    assert.equal(furious.pauseCount, pauses, 'the audio keeps playing after the release');
    assert.equal(goku.ssjPhase, 'ui', 'Ultra Instinct landed');
    assert.equal(game.modAudio.uiTheme.playCount, 1, 'the UI theme starts');
  }
});

test('UI: slow walk, red steerable orb that explodes, light-beam burst, teleport strike and return', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ui');
  const victim = rival(game);
  park(victim, 650, floor);
  goku.lastDirX = 1;

  // slow walk
  const x0 = goku.x;
  keyDown(listeners, 'ArrowRight');
  for (let f = 0; f < 30; f++) game.step();
  keyUp(listeners, 'ArrowRight');
  assert.ok(goku.x > x0, 'walks');

  // red orb, steerable, explodes on contact
  game.step();
  keyDown(listeners, 'KeyK');
  game.step();
  keyUp(listeners, 'KeyK');
  assert.equal(game.ssjOrbs.length, 1, 'a compact red orb flies');
  const orb = game.ssjOrbs[0];
  keyDown(listeners, 'ArrowUp');
  for (let f = 0; f < 20; f++) game.step();
  keyUp(listeners, 'ArrowUp');
  assert.ok(orb.vy < 0, 'the arrows steer it in real time');
  for (let f = 0; f < 400 && game.ssjOrbs.length; f++) game.step();
  assert.equal(game.ssjOrbs.length, 0, 'the orb exploded');

  // light-beam burst (the blast's ground fire may have scorched the caster: reset the stage)
  park(goku, 338, floor);
  park(victim, 650, floor);
  goku.ssjKi = 100;
  victim.hp = 100;
  keyDown(listeners, 'KeyJ');
  game.step();
  keyUp(listeners, 'KeyJ');
  assert.ok(goku.ssjRays, 'the burst started');
  keyDown(listeners, 'ArrowLeft');
  keyDown(listeners, 'KeyA');
  const walkX0 = goku.x;
  for (let f = 0; f < 6; f++) game.step();
  keyUp(listeners, 'ArrowLeft');
  keyUp(listeners, 'KeyA');
  assert.notEqual(goku.x, walkX0, 'Ultra Instinct keeps walking while the burst fires');
  for (let f = 0; f < 120; f++) game.step();
  assert.ok(victim.hp < 100, 'the light beams reached the rival');

  // teleport strike returns to the exact start
  for (let f = 0; f < 80; f++) game.step();
  park(goku, 338, floor);
  park(victim, 650, floor);
  goku.ssjKi = 100;
  const ox = goku.x;
  const oy = goku.y;
  keyDown(listeners, 'Semicolon');
  game.step();
  keyUp(listeners, 'Semicolon');
  assert.ok(goku.ssjUiTele && goku.ssjUiTele.stage === 'pre', 'wind-up on the spot first');
  for (let f = 0; f < 70 && goku.ssjUiTele.stage === 'pre'; f++) game.step();
  assert.ok(goku.ssjUiTele, 'teleported beside the rival');
  assert.ok(Math.abs(goku.x - victim.x) < 80, 'arrived next to the rival');
  for (let f = 0; f < 60 && goku.ssjUiTele; f++) game.step();
  assert.equal(goku.ssjUiTele, null);
  assert.ok(Math.abs(goku.x - ox) < 1, 'back at the original x');
});

test('K holds the charge and only fires when the key is released', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 300, floor);
  const victim = rival(game);
  park(victim, 520, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  goku.ssjKi = 100;

  keyDown(listeners, 'KeyK');
  game.step();
  assert.ok(goku.ssjBeam && goku.ssjBeam.phase === 'charge', 'the gathering stance started');

  for (let f = 0; f < 60; f++) game.step();
  assert.ok(goku.ssjBeam && goku.ssjBeam.phase === 'charge', 'a held K keeps gathering');
  assert.equal(game.ssjBeams.length, 0, 'holding alone never fires the volley');

  keyUp(listeners, 'KeyK');
  game.step();
  assert.ok(game.ssjBeams.length > 0, 'the release fired the volley');
  for (let f = 0; f < 40; f++) game.step(); // the beam sweeps the whole screen
  assert.ok(victim.hp < 100, 'the fighter in the band took beam damage');
  assert.ok(goku.ssjBeamCooldown > 0, 'the volley owns its cooldown window');
});

test('K destroys a crate standing in the beam band', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 300, floor);
  const crate = game.crates[0];
  crate.dead = false;
  crate.hp = 20;
  crate.x = 380;
  crate.y = floor.y - 20;
  crate.w = 20;
  crate.h = 20;
  goku.ssjKi = 100;
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock

  keyDown(listeners, 'KeyK');
  for (let f = 0; f < 330; f++) game.step(); // a deep hold gathers a heavy volley
  keyUp(listeners, 'KeyK');
  for (let f = 0; f < 40; f++) game.step(); // the release fires and the beam chews
  assert.equal(crate.dead, true, 'the beam shattered the crate in its path');
});

test('kame_charge.mp3 ending by itself reabsorbs the orb: no volley, no wave', () => {
  const { game, listeners } = createGame({ withAudio: true });
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  const victim = rival(game);
  park(victim, 520, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  goku.ssjKi = 100;

  keyDown(listeners, 'KeyK');
  game.step();
  const charge = game.modAudio.kameCharge; // the charge start created the channel
  for (let f = 0; f < 200; f++) game.step(); // mid-charge, K still held
  assert.ok(goku.ssjBeam && goku.ssjBeam.phase === 'charge', 'the orb keeps growing');

  charge.onended(); // the file runs out while the key stays held
  assert.ok(goku.ssjBeam && goku.ssjBeam.phase === 'reabsorb', 'the energy collapse started');
  assert.equal(game.ssjBeams.length, 0, 'the reabsorb never fires a volley');
  assert.equal(victim.hp, 100, 'the rival was never touched');
  const wave = game.modAudio.kameWave;
  assert.ok(!wave || wave.playCount === 0, 'the wave audio never plays');

  for (let f = 0; f < 25; f++) game.step(); // the collapse animation runs out
  assert.equal(goku.ssjBeam, null, 'the stance returned cleanly to idle');
  assert.ok(goku.ssjBeamCooldown > 0, 'the reabsorb owns its cooldown window');
  keyUp(listeners, 'KeyK');
});

test('holding K through the whole fallback charge clock reabsorbs too (no audio in-vm)', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  const victim = rival(game);
  park(victim, 520, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  goku.ssjKi = 100;

  keyDown(listeners, 'KeyK');
  game.step();
  for (let f = 0; f < 376; f++) game.step(); // 6.27 s of kame_charge.mp3 at 60 Hz
  assert.ok(goku.ssjBeam && goku.ssjBeam.phase === 'reabsorb', 'the full hold collapses the orb');
  assert.equal(game.ssjBeams.length, 0, 'no volley ever fired');
  assert.equal(victim.hp, 100, 'the rival was never touched');
  keyUp(listeners, 'KeyK');
});

test('the volley scales with the held time: a longer charge fires bigger and harder', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 300, floor);
  park(rival(game), 520, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock

  // a short tap
  goku.ssjKi = 100;
  keyDown(listeners, 'KeyK');
  for (let f = 0; f < 40; f++) game.step();
  keyUp(listeners, 'KeyK');
  game.step();
  const tap = game.ssjBeams[game.ssjBeams.length - 1].scale;
  assert.ok(tap > 0 && tap < 1, 'a tap fires a partial volley');

  // drop the finished volley, cool down and re-charge much longer
  game.ssjBeams.length = 0;
  goku.ssjBeam = null;
  goku.ssjBeamCooldown = 0;
  goku.ssjKi = 100;
  keyDown(listeners, 'KeyK');
  for (let f = 0; f < 160; f++) game.step();
  keyUp(listeners, 'KeyK');
  game.step();
  const deep = game.ssjBeams[game.ssjBeams.length - 1].scale;
  assert.ok(deep > tap, 'a longer hold fires proportionally harder');
  assert.ok(deep <= 1, 'the charge never exceeds the audio cap');
});

test('L toggles flight: gravity stops, arrows steer, Ki drains, re-toggle lands', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  park(rival(game), 200, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  goku.ssjKi = 100;

  const y0 = goku.y;
  keyDown(listeners, 'KeyL');
  game.step();
  assert.equal(goku.ssjFlying, true, 'flight engaged');
  keyUp(listeners, 'KeyL');

  keyDown(listeners, 'ArrowUp');
  for (let f = 0; f < 200; f++) game.step();
  assert.equal(goku.onGround, false, 'the fighter took off');
  assert.ok(goku.y < y0 - 20, 'the arrows climb while flying');
  assert.ok(goku.airVelocityY <= 0.001, 'gravity is ruled out by the flight stance');
  const kiWhileFlying = goku.ssjKi;
  for (let f = 0; f < 40; f++) game.step();
  assert.ok(goku.ssjKi < kiWhileFlying, 'flight burns Ki every step');

  keyDown(listeners, 'KeyL');
  game.step();
  keyUp(listeners, 'KeyL');
  assert.equal(goku.ssjFlying, false, 'flight toggled off');
  const vy = goku.airVelocityY;
  game.step();
  game.step();
  assert.ok(goku.airVelocityY > vy, 'gravity resumed after the toggle');
});

test("';' (held) pins the stance and refills the Ki gauge fast", () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  goku.ssjKi = 25;

  keyDown(listeners, 'Semicolon');
  game.step();
  game.step();
  assert.equal(goku.ssjCharging, true, 'the charge stance took the fighter');
  const lockedX = goku.x;
  const kiStart = goku.ssjKi;
  for (let f = 0; f < 200; f++) game.step();
  assert.ok(goku.ssjKi > kiStart + 20, 'the held ; refills Ki fast');
  assert.equal(goku.x, lockedX, 'the charge posture never drifts');
  keyUp(listeners, 'Semicolon');
  game.step();
  assert.equal(goku.ssjCharging, false, 'the stance releases with the key');
});

test("'' (free warp) moves the fighter to the rival when they are close", () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  const victim = rival(game);
  park(victim, 520, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  goku.ssjKi = 100;

  keyDown(listeners, 'Quote');
  game.step();
  keyUp(listeners, 'Quote');
  const gap = Math.abs((victim.x + victim.w / 2) - (goku.x + goku.w / 2));
  assert.ok(gap < (victim.w + goku.w) / 2 + 12, 'the warp snapped level beside the rival');
  assert.ok(goku.ssjTeleCooldown > 0, 'the warp owns its cooldown');
});

test('the free warp falls back to the facing hop when the rival is far', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  park(rival(game), 60, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  goku.ssjKi = 100;

  const x0 = goku.x;
  keyDown(listeners, 'Quote');
  game.step();
  keyUp(listeners, 'Quote');
  const travelled = goku.x - x0;
  assert.ok(travelled > 60, 'the facing hop moved the fighter');
});

test('a round restart clears the shell, the stances and the world effects', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  game.ssjParticles.push({ x: 0, y: 0, vx: 0, vy: 0, life: 5, maxLife: 5, size: 2, color: '#fff' });
  game.ssjBeams.push({ owner: 2, dir: 1, x: 0, y: 0, life: 30, grow: 1 });

  game.restartRound();
  assert.equal(goku.ssj2, null, 'a new round is a plain world again');
  assert.equal(game.ssjParticles.length, 0, 'the golden field cleared');
  assert.equal(game.ssjBeams.length, 0, 'no beam survives a round restart');
});

test('an SSJ2 punch hits harder than the base damage', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  const victim = rival(game);
  // damage model check: the same link, the same victim, only the shell differs
  const baseDamage = victim.equipped ? null : null;
  park(goku, 400, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  const link = goku.punchComboNr - 1;
  const expected = goku.equipped.damage[link] * 1.8;
  assert.equal(goku.ssjMeleeMult() * goku.equipped.damage[link], expected, 'the multiplier is the requested 1.8x');
  assert.ok(expected > goku.equipped.damage[link], 'the shell punches harder than plain fists');
});

test('the renderer survives the full SSJ2 posture set (aura, beam, particles)', () => {
  const { game, fills } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 300, floor);
  const victim = rival(game);
  park(victim, 520, floor);
  game.activateSsj2(goku);
  goku.transformationPose = null; // tests skip the transformation cutscene lock
  goku.ssjKi = 100;

  keyDownByCode('Semicolon');
  for (let f = 0; f < 8; f++) game.step(); // charging aura particles
  keyUpByCode('Semicolon');
  keyDownByCode('KeyK');
  for (let f = 0; f < 70; f++) game.step(); // beam charging + firing
  keyUpByCode('KeyK');
  keyDownByCode('KeyL');
  game.step();
  keyUpByCode('KeyL');

  game.render(); // every painter path must survive the proxy canvas
  const hintLine = fills.find((t) => /^P2 (SSJ|ULTRA|THE ONE)/.test(t));
  assert.equal(hintLine, undefined, 'the key instruction line is no longer drawn');
});


test('the secret sequence plays transformation 1..11 and lands the sequence phase', () => {
  const landings = [
    ['jkjkjkjkjkjkjk', 'ssj'],
    ['jjkkjjkkjjkkjj', 'ssj2'],
    ['jjjkkkjjjkkkjk', 'ui']
  ];
  for (const [word, phase] of landings) {
    const { game, listeners } = createGame();
    const floor = setFloor(game);
    const goku = arrowFighter(game);
    park(goku, 400, floor);
    typeWordForHandover(listeners, word);
    assert.ok(goku.transformationPose, word + ' arms the base cutscene');
    assert.equal(goku.transformationPose.set, 'toBase');
    assert.equal(goku.transformationPose.frame, 0);
    const seen = new Set();
    for (let f = 0; f < 400 && goku.transformationPose; f++) {
      seen.add(goku.transformationPose.frame);
      game.step();
    }
    assert.equal(seen.size, 11, 'all eleven frames play');
    assert.equal(goku.transformationPose, null, 'the cutscene ends');
    assert.equal(goku.ssjPhase, phase, word + ' lands ' + phase);
  }
});

test('the transformation cutscene pins the fighter and death cuts it short', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);

  game.activateSsj2(goku);
  const poseStart = { x: goku.x, y: goku.y };

  // input is dead while the ritual flexes: no run, no jump
  keyDown(listeners, 'ArrowRight');
  for (let f = 0; f < 20; f++) game.step();
  assert.equal(goku.x, poseStart.x, 'the pinned fighter never drifts');
  assert.equal(goku.transformationPose !== null, true, 'the pose holds through the lock');
  keyUp(listeners, 'ArrowRight');

  // a lethal hit shears the cutscene (the shell outlives it)
  goku.damage(999);
  game.step();
  assert.equal(goku.transformationPose, null, 'death cancels the cutscene');
  assert.ok(goku.ssj2, 'the transformation itself survives');
});

test('the Matrix handover clears a running transformation cutscene', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = arrowFighter(game);
  park(goku, 400, floor);

  game.activateSsj2(goku);
  assert.ok(goku.transformationPose, 'the gokussj ritual flexes first');
  for (let f = 0; f < 40; f++) game.step(); // outlast the cheat cooldown

  typeWordForHandover(listeners, 'matrix');
  assert.equal(goku.transformationPose, null, 'the cutscene never leaks into The One');
  assert.ok(goku.matrix, 'the mode handover still lands');
});

function typeWordForHandover(listeners, word) {
  for (const ch of word.toUpperCase()) {
    keyDown(listeners, 'Key' + ch);
    keyUp(listeners, 'Key' + ch);
  }
}

test('plain SSJ cannot sprint or roll', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ssj');
  keyDown(listeners, 'ArrowRight');
  keyUp(listeners, 'ArrowRight');
  keyDown(listeners, 'ArrowRight'); // double tap would sprint
  for (let f = 0; f < 10; f++) game.step();
  assert.equal(goku.sprinting, false, 'no sprint in SSJ');
  keyDown(listeners, 'ArrowDown'); // DOWN while running would roll
  for (let f = 0; f < 6; f++) game.step();
  assert.equal(goku.rolling, false, 'no roll in SSJ');
  assert.equal(goku.diving, false);
  keyUp(listeners, 'ArrowDown');
  keyUp(listeners, 'ArrowRight');
});

test('flying SSJ shows the static idle cell', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ssj');
  goku.ssjFlying = true;
  goku.onGround = false;
  goku.airVelocityY = -1;
  assert.equal(game.playerSpriteKey(goku), 'idle');
});

test('the furious recharge audio plays at half volume', () => {
  const { game, listeners } = createGame({ withAudio: true });
  const floor = setFloor(game);
  gokuIn(game, floor, 'ssj2');
  keyDown(listeners, 'Semicolon');
  for (let f = 0; f < 5; f++) game.step();
  assert.equal(game.modAudio.furious.volume, 0.5);
});

test('the SSJ2 -> UI sequence is slow, loops 6/5/7 three times, ends on 8, with cosmic audio and a shockwave', () => {
  const { game } = createGame({ withAudio: true });
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ssj2');
  const foe = rival(game);
  park(foe, 650, floor);
  goku.airVelocityX = 0; const gx = goku.x, gy = goku.y;
  const crate = { x: goku.x + 60, y: floor - 30, w: 30, h: 30, vx: 0, vy: 0, spin: 0, hp: 100, resting: true, dead: false };
  game.crates.push(crate);
  game.startPhaseTransform(goku, 'toUi');
  assert.equal(game.modAudio.cosmic.playCount, 1, 'explosioncosmica starts with the transition');
  let steps = 0;
  const seen = [];
  while (goku.transformationPose && steps < 800) {
    seen.push(goku.transformationPose.frame);
    game.step(); steps++;
  }
  assert.ok(steps >= 5 * 44 + 15 * 16 - 2 && steps <= 5 * 44 + 15 * 16 + 4, 'slow: 5 long intro frames + 15 loop frames, got ' + steps);
  assert.ok(seen.slice(0, 5 * 44).filter((f) => f === 0).length >= 40, 'the build-up lingers on the first art');
  const slots = seen.slice(5 * 44).filter((_, i) => i % 16 === 0);
  assert.equal(slots.join(','), '5,4,5,4,5,6,5,6,5,6,7,6,7,6,7', 'art 6,5,6,5,6,7,6,7,6,7,8,7,8,7,8');
  assert.equal(slots[slots.length - 1], 7, 'ends on art 8');
  assert.equal(goku.ssjPhase, 'ui');
  assert.ok(crate.vx !== 0 || crate.vy !== 0, 'the cosmic shockwave throws the props');
  assert.ok(Math.abs(foe.airVelocityX) > 0 || foe.falling, 'and the rival');
  assert.ok(!goku.falling && goku.x === gx, 'the caster is not thrown by his own blast');
});

test('UI teleport leaves the original frozen at the origin while the clone strikes', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ui');
  const foe = rival(game);
  park(foe, 600, floor);
  goku.ssjKi = 100;
  const ox = goku.x;
  keyDown(listeners, 'Semicolon');
  game.step();
  keyUp(listeners, 'Semicolon');
  assert.ok(goku.ssjUiTele, 'teleport started');
  for (let f = 0; f < 70 && goku.ssjUiTele.stage === 'pre'; f++) game.step();
  assert.equal(goku.ssjUiTele.origin.x, ox, 'the origin (static double) is remembered');
  assert.equal(goku.ssjUiTele.stage, 'strike');
  assert.equal(goku.ssjUiTeleCooldown, 0, 'no cooldown between strikes');
  assert.ok(Math.abs(goku.x - ox) > 100, 'the striker is beside the rival');
});

test('Ultra Instinct glow holds 10 s, fades after, and the state ends at 60 s', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ui');
  goku.ssjUiAge = 0;
  assert.equal(game.uiGlowAmount(goku), 1);
  goku.ssjUiAge = 600;
  assert.equal(game.uiGlowAmount(goku), 1, 'still full at 10 s');
  goku.ssjUiAge = 1500;
  assert.ok(Math.abs(game.uiGlowAmount(goku) - 0.5) < 1e-9, 'half way through the fade');
  goku.ssjUiAge = 2400;
  assert.equal(game.uiGlowAmount(goku), 0, 'gone');
  goku.ssjUiAge = 3598;
  for (let f = 0; f < 4; f++) game.step();
  assert.equal(goku.ssj2, null, 'after one minute the power runs out');
});

// ---------- Ultra Instinct blast rules, barrel immunity, radial shockwave ----------

test('the UI orb explodes without fire, throws the target and costs exactly a quarter of the bar', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ui');
  const foe = rival(game);
  park(foe, 500, floor);
  goku.x = 300;
  game.ssjOrbs.push({ owner: goku.id, x: foe.x + foe.w / 2, y: foe.y + foe.h / 2, vx: 0, vy: 0, life: 50, r: 5 });
  game.step();
  assert.equal(game.ssjOrbs.length, 0, 'the orb detonated on contact');
  assert.equal(game.groundFire.length, 0, 'an explosion, never fire');
  assert.ok(game.explosions.length >= 1, 'the big blast is spawned');
  assert.equal(foe.hp, 75, 'exactly 25% of the full bar');
  assert.ok(foe.falling && !foe.onGround, 'the target is sent flying');
  assert.equal(goku.hp, 100, 'the caster is untouched');
});

test('barrel explosions never touch an Ultra Instinct fighter', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ui');
  const foe = rival(game);
  park(foe, 100, floor);
  const barrel = { x: goku.x + goku.w / 2 - 10, y: floor.y - 26, w: 20, h: 26 };
  game.explodeAt(barrel.x + 10, barrel.y + 13, 200, 40, 8, { uiImmune: true });
  assert.equal(goku.hp, 100, 'no damage');
  assert.ok(!goku.falling && goku.hitFlash !== 6, 'no push, no flash');
  assert.ok(goku.onGround, 'still planted');
  // a plain fighter in the same blast does take it (immunity is UI-only)
  const plain = rival(game);
  plain.x = goku.x + 40;
  game.explodeAt(plain.x, plain.y + 10, 120, 40, 8, { uiImmune: true });
  assert.ok(plain.hp < 100, 'a normal fighter is still hurt');
});

test('SSJ2 -> UI shockwave throws everything radially away from the caster, across the whole stage', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ssj2');
  goku.x = 400;
  const mkCrate = (x, y) => ({ x, y, w: 30, h: 30, vx: 0, vy: 0, spin: 0, hp: 100, resting: true, dead: false });
  const left = mkCrate(40, floor.y - 30);          // far left, beyond the old radius
  const right = mkCrate(740, floor.y - 30);        // far right
  game.platforms.push({ x: 600, y: 300, w: 140, h: 12, solidSides: true, cloud: false, ladder: false });
  const raised = mkCrate(640, 270);                // up on a ledge: up AND right of the caster
  game.crates.push(left, right, raised);
  park(rival(game), 100, floor);
  game.startPhaseTransform(goku, 'toUi');
  for (let f = 0; f < 800 && goku.ssjPhase !== 'ui'; f++) game.step();
  assert.ok(left.vx < 0, 'left props fly left');
  assert.ok(right.vx > 0, 'right props fly right');
  assert.ok(raised.vx > 0 && raised.vy < 0, 'a prop up-right of the caster flies up-right (true 360 degree push)');
  assert.ok(rival(game).airVelocityX < 0, 'the rival is repelled to the left, away from the caster');
});

// ---------- Melee: run-and-gun, the swing never stops the walk ----------

test('a fighter is rooted while punching; only the last link adds its lunge', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const fighter = arrowFighter(game);
  park(fighter, 400, floor);
  park(rival(game), 100, floor);
  fighter.lastDirX = 1;
  fighter.punching = true;
  fighter.punchFrame = 0;
  fighter.punchComboNr = 1;
  const x0 = fighter.x;
  keyDown(listeners, 'ArrowLeft');
  for (let f = 0; f < 4; f++) game.step();
  assert.equal(fighter.x, x0, 'no walking during link 1');
  assert.equal(fighter.lastDirX, 1, 'no turning during the swing');
  keyUp(listeners, 'ArrowLeft');

  fighter.punching = false;
  for (let f = 0; f < 10; f++) game.step(); // settle
  fighter.lastDirX = 1;
  fighter.punching = true;
  fighter.punchFrame = 0;
  fighter.punchComboNr = 3;
  fighter.punchHitPerformed = false;
  const x1 = fighter.x;
  game.step();
  assert.ok(fighter.x > x1, 'the final link keeps its forward lunge');
});

test('Ultra Instinct is fireproof and a hit never swaps its idle art', () => {
  const { game } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ui');
  goku.igniteFire();
  goku.addBurn(200);
  assert.equal(goku.fireState, game.FireStates ? game.FireStates.normal : goku.fireState);
  assert.equal(goku.fireState.name, 'NONE', 'flames never take hold');
  // already burning when the mode lands: put out on the next update
  const plain = rival(game);
  plain.igniteFire();
  assert.notEqual(plain.fireState.name, 'NONE', 'a plain fighter still burns');
  goku.hitFlash = 6;
  goku.stunTimer = 10;
  assert.equal(game.modArtFor(goku, 'gethit'), game.modArtFor(goku, 'idle'), 'hurt pose = static idle art');
  assert.equal(game.modArtFor(goku, 'knockedDown'), game.modArtFor(goku, 'idle'));
});

test('Ultra Instinct cannot aim a gun or throw a grenade', () => {
  const { game, listeners } = createGame();
  const floor = setFloor(game);
  const goku = gokuIn(game, floor, 'ui');
  game.botActive = false;
  goku.ranged = { gun: game.guns.pistol, ammo: 12 };
  const grenades = goku.throwable.ammo;
  keyDown(listeners, goku.binding.fire);
  for (let i = 0; i < 5; i++) game.step();
  assert.equal(goku.aiming, false, 'the gun key does not aim');
  assert.ok(!goku.startAimASAP, 'and nothing is buffered for the landing');
  keyUp(listeners, goku.binding.fire);
  keyDown(listeners, goku.binding.throw);
  for (let i = 0; i < 5; i++) game.step();
  keyUp(listeners, goku.binding.throw);
  for (let i = 0; i < 5; i++) game.step();
  assert.equal(goku.aiming, false, 'the throw key does not aim');
  assert.equal(goku.throwable.ammo, grenades, 'no grenade leaves the hand');
});
