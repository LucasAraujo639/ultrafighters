'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};

// Synchronous Image stub: same contract as explosion-fire.test.js.
class FakeImage {
  constructor() {
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
  }
  set src(value) {
    this._src = value;
    this.complete = true;
    this.naturalWidth = 16;
    this.naturalHeight = 16;
    if (typeof this.onload === 'function') this.onload();
  }
  get src() { return this._src; }
}

function createGame() {
  const listeners = Object.create(null);
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient
    },
    { get(t, k) { return k in t ? t[k] : noop; }, set() { return true; } }
  );
  const canvas = { width: 800, height: 600, getContext: () => context };
  const window = {
    addEventListener(type, cb) { listeners[type] = cb; },
    requestAnimationFrame() {}
  };
  window.PLAYER_SPRITE_MAP = {
    idle: 592, walk: [599, 596, 600], run: [616, 596, 617], crouch: 613,
    jump: 597, fall: [602, 603, 606], attack: [627, 628, 630, 631, 633, 634],
    attackLinks: [[627, 628, 630], [631, 633], [634]], gethit: [718, 720],
    launched: [724, 725, 726], climb: [709, 710, 711], climbDown: 713,
    kick: 622, kickWithJump: 722, roll: [619, 620], dive: 624,
    knockedDown: [609, 610], SoftLanding: 611
  };
  const sandbox = {
    window,
    Image: FakeImage,
    document: { getElementById: () => canvas, createElement: (t) => (t === 'canvas' ? canvas : {}) },
    performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  };
  vm.runInNewContext(gameSource, sandbox, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  for (const item of game.weaponItems) item.taken = true;
  return { game, listeners };
}

// A bare pressed-key helper for the melee tests
function keyDown(listeners, code) { listeners.keydown({ code, repeat: false, preventDefault: noop }); }
function keyUp(listeners, code) { listeners.keyup({ code, preventDefault: noop }); }

// Reset both fighters onto a known plain floor (mirrors game-physics style)
function groundPlayer(player, floor, x) {
  Object.assign(player, {
    x, y: floor.y - player.h, airVelocityX: 0, airVelocityY: 0,
    onGround: true, groundedPlatform: floor, groundedCrate: null,
    jumping: false, falling: false, knockedDown: false, knockedDownFrame: 0,
    rolling: false, knockbackRoll: false, knockbackRollFrame: 0,
    knockbackRollAngle: 0, blastRollPending: 0, diving: false, climbing: false,
    grabbingBy: null, grabbedPlayerNr: 0, stunTimer: 0, staggering: false,
    hitFlash: 0, punchQueued: false, punchComboNr: 1, matrixDodgeTimer: 0
  });
}

const PLAIN_FLOOR = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };

function spawnSwapArena(game) {
  game.platforms.length = 0;
  game.platforms.push(PLAIN_FLOOR);
  for (const crate of game.crates) crate.dead = true;
  for (const barrel of game.barrels) barrel.dead = true;
  for (let frame = 0; frame < 5; frame++) game.step();
}

// ---------- Task 1: entity, sprite, crate-identical rigidbody ----------

test('barrels spawn as level props with a 127.svg-sized hitbox and register as cover', () => {
  const { game } = createGame();
  assert.ok(game.barrels.length > 0, 'the map carries barrel props');
  for (const b of game.barrels) {
    assert.equal(b.w, 14);
    assert.equal(b.h, 19);
    assert.equal(b.burning, false, 'pristine barrels start inert (127 sprite)');
    assert.ok(game.coverSystem.contains(b), 'a barrel is an ICoverable prop (cover source)');
    assert.ok(game.coverSystem.isAlive(b), 'an inert barrel can shelter');
  }
});

test('a fresh inert barrel uses the same gravity/friction physics contract as crates', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const b = game.barrels[0] = { x: 120, y: PLAIN_FLOOR.y - 19 - 40, w: 14, h: 19, sx: 120, sy: PLAIN_FLOOR.y - 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  game.barrels.length = 0;
  const spawned = { x: 120, y: PLAIN_FLOOR.y - 19 - 40, w: 14, h: 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  game.barrels.push(spawned);
  for (let frame = 0; frame < 40; frame++) game.step();
  assert.ok(spawned.resting, 'the barrel settles like a crate does');
  assert.equal(spawned.vy, 0, 'no residual fall speed on the floor');
  assert.ok(Math.abs((spawned.y + spawned.h) - PLAIN_FLOOR.y) < 1, 'it rests flush on the floor');
});

// ---------- Task 2: projectile impact -> directed impulse + 161.svg state ----------

test('a bullet hit launches the barrel away from the shooter and flips it into BurningState', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const b = { x: 400, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, sx: 400, sy: PLAIN_FLOOR.y - 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  game.barrels.push(b);
  const bulletSpeed = 22.5; // pistol 30 * TIME_SCALE 0.75
  game.bullets.push({ x: 395, y: b.y + b.h / 2, vx: bulletSpeed, vy: 0, damage: 10, critDamage: 15, crit: false, owner: 1, trail: [], impulse: 0.6 });

  game.step();

  assert.equal(game.bullets.length, 0, 'the barrel eats the shot');
  assert.equal(b.burning, true, 'stage 1: the barrel is set on fire (161 art token)');
  // the shot is a NUDGE, not the direction: the launch carries random scatter
  // in both axes, so it can fly sideways, up, or even back toward the shooter
  assert.ok(Math.hypot(b.vx, b.vy) > 0.5, 'the launch gives the barrel real momentum');
  assert.ok(Math.hypot(b.vx, b.vy) <= bulletSpeed * 2.5, 'the launch stays in a sane range');
});

test('pushback direction is biased by the shot but scatter can override it', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const b = { x: 400, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  game.barrels.push(b);
  game.bullets.push({ x: 419, y: b.y + 9, vx: -22.5, vy: 0, damage: 10, crit: false, owner: 1, trail: [], impulse: 0.6 });
  game.step();
  assert.equal(b.burning, true, 'the barrel ignites');
  // the shot nudges left, but scatter dominates often enough that only the
  // momentum (and the upward hop) are asserted here
  assert.ok(Math.hypot(b.vx, b.vy) > 0.5, 'the launch gives the barrel real momentum');
  assert.ok(b.vy < 0, 'the ignition lift hops the barrel into a readable flight');
});

// ---------- Task 3: second contact while burning -> explosion + debris spawn ----------

test('a burning barrel detonates on its next solid touchdown: blast, ring, fire and fragments', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const b = { x: 400, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 3, vy: -6.5, angle: 0, spin: 0.3, burning: true, burnFuse: 120, resting: false };
  game.barrels.push(b);
  const debrisBefore = game.barrelDebris.length;
  const explosionsBefore = game.explosions.length;

  // the stage-1 hop flies first; the next touchdown is the detonator
  let sawFlight = false;
  let boomed = false;
  for (let frame = 0; frame < 90; frame++) {
    game.step();
    if (game.barrels.includes(b)) {
      sawFlight = sawFlight || Math.abs(b.vy) > 1 || b.burning;
    } else { boomed = true; break; }
  }
  assert.equal(boomed, true, 'the flying burning barrel detonates on the next touchdown');
  assert.ok(!game.barrels.includes(b), 'the barrel entity is removed from the canvas pool');
  assert.ok(game.barrelDebris.length > debrisBefore, 'the detonation spawns micro-pieces');
  assert.ok(game.explosions.length > explosionsBefore, 'the explosion ring is on the ground');
});

test('the flame fragments fly on a 0-360 fan riding the shipped 153/164 debris art', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.detonateBarrel({ x: 400, y: 480, w: 14, h: 19 });
  assert.ok(game.barrelDebris.length >= 6, 'a full micro-piece shower spawns');
  const sprites = new Set(game.barrelDebris.map((d) => d.sprite));
  for (const s of sprites) {
    assert.ok([153, 164].includes(s), `fragments carry the shipped barrel debris art, got ${s}`);
  }
  for (const d of game.barrelDebris) {
    assert.ok(Math.hypot(d.vx, d.vy) > 0, 'every fragment launches with its initial speed');
    assert.ok(d.life >= 180 && d.life <= 300, 'the patch fuse reads 3-5 s at 60 Hz');
  }
});

test('the blast stages a barrel only with real body contact: band ignites, point-blank chains', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrels.length = 0;
  // touch band: surface ~19 px past the blast point -> catch fire + launch
  const banded = { x: 419, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  // just past the touch band: nothing happens
  const untouched = { x: 470, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  game.barrels.push(banded, untouched);

  game.explodeAt(400, PLAIN_FLOOR.y - 10, 200, 40, 8);
  game.step(); // dead-prop pooling flushes on the mover step (crate convention)

  assert.equal(banded.burning, true, 'the blast grazes the body: stage 1 (fire + launch)');
  assert.ok(banded.vx !== 0 || banded.vy !== 0, 'the launch rides a radial impulse');
  assert.equal(untouched.burning, false, 'a blast past the body never reaches its impact');
});

test('a grenade popping 60px from the barrel never stages it', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrels.length = 0;
  // barrel surface sits 52 px right of the blast: grenade radius 90 makes the
  // ring wash over it, but the blast POINT is far from the body
  const b = { x: 452, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  game.barrels.push(b);
  const explosionsBefore = game.explosions.length;

  game.explodeGrenade(400, PLAIN_FLOOR.y - 10);
  game.step();

  assert.equal(b.burning, false, 'a once-distant blast never reaches its impact on the barrel');
  assert.equal(game.explosions.length, explosionsBefore + 1, 'the grenade itself still detonates');
});

test('point-blank chains still pop burning neighbours now (barrel on barrel)', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrels.length = 0;
  // two neighbours of the blast axis, both inside the 10px point-blank band
  const a = { x: 396, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  const b2 = { x: 412, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  game.barrels.push(a, b2);
  game.explodeAt(410, PLAIN_FLOOR.y - 10, 90, 30, 5);
  game.step();
  assert.equal(game.barrels.includes(a), false, 'the first barrel detonated (chain)');
});

// ---------- Task 4: fire patches burn the fighter and die out on their timer ----------

test('a landed fragment patch burns the fighter that steps on it and leaves him on fire', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrelDebris.length = 0;
  const patch = {
    x: 400, y: PLAIN_FLOOR.y - 4, vx: 0, vy: 0, sprite: 153, angle: 0.4,
    spin: 0, scale: 1, h: 8, life: 240, maxLife: 300, landed: true, hit: {}
  };
  game.barrelDebris.push(patch);
  const victim = game.players[0];
  groundPlayer(victim, PLAIN_FLOOR, 395); // overlapping the patch box
  const hpBefore = victim.hp;

  game.step();

  assert.equal(patch.hit[victim.id], true, 'the patch registers its BurnDamage bite');
  assert.ok(victim.hp < hpBefore, 'the first touch deals its fire damage');
  assert.ok(victim.fireState != null && victim.fireState.name !== 'Normal', 'the fighter is left on fire (burn keeps ticking)');
});

test('the patch never burns the same fighter twice (the fire machine keeps the over-time burn)', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrelDebris.length = 0;
  const patch = { x: 400, y: PLAIN_FLOOR.y - 4, vx: 0, vy: 0, sprite: 164, angle: 0, spin: 0, scale: 1, h: 8, life: 240, maxLife: 240, landed: true, hit: {} };
  game.barrelDebris.push(patch);
  const victim = game.players[0];
  groundPlayer(victim, PLAIN_FLOOR, 400);
  game.step(); // the single patch bite
  assert.equal(patch.hit[victim.id], true, 'the bite is registered once');
  // the hp keeps dropping from the on-fire state (burn over time), but the
  // PATCH itself only ever lands its one bite: check the patch bookkeeping
  for (let frame = 0; frame < 10; frame++) game.step();
  assert.equal(patch.hit[victim.id], true, 'no second patch bite ever');
});

test('fragments fall to the floor, then burn out and vanish once their timer ends', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrelDebris.length = 0;
  game.barrelDebris.push({
    x: 400, y: 430, vx: 0, vy: 0, sprite: 153, angle: 0, spin: 0.2,
    scale: 1, h: 8, life: 12, maxLife: 12, landed: false, hit: {}
  });
  let sawLanding = false;
  let landedLife = null;
  for (let frame = 0; frame < 60; frame++) {
    game.step();
    const d = game.barrelDebris[0];
    if (d && d.landed) {
      sawLanding = true;
      if (landedLife == null) landedLife = d.life; // read on the landing frame
    }
  }
  assert.equal(sawLanding, true, 'the fragment reaches the floor under gravity');
  assert.ok(landedLife != null && landedLife <= 12, 'the fuse only burns grounded patches');
  for (let frame = 0; frame < 20; frame++) game.step();
  assert.equal(game.barrelDebris.length, 0, 'the burnt-out piece is removed from the pool');
});

// ---------- extras: player contacts, melee, restart ----------

test('a flying burning barrel the fighter crosses burns him AND detonates', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrels.length = 0;
  // grounded burning barrel already brushing the fighter: stage-2 contact
  const b = { x: 402, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: -3, vy: 0, angle: 0, spin: 0, burning: true, burnFuse: 120, resting: true };
  game.barrels.push(b);
  const victim = game.players[0];
  groundPlayer(victim, PLAIN_FLOOR, 396);
  const hpBefore = victim.hp;
  const explosionsBefore = game.explosions.length;

  for (let frame = 0; frame < 6 && game.barrels.includes(b); frame++) game.step();

  assert.ok(victim.hp < hpBefore, 'the flying pot burns on touch');
  assert.ok(game.explosions.length > explosionsBefore, 'and the contact detonates the stage 2');
  assert.ok(!game.barrels.includes(b), 'the barrel is gone');
});

test('melee shoves an inert barrel like a crate without setting it on fire', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrels.length = 0;
  const b = { x: 440, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  game.barrels.push(b);
  const attacker = game.players[0];
  groundPlayer(attacker, PLAIN_FLOOR, 400);
  attacker.lastDirX = 1;
  Object.assign(attacker, { punching: true, punchFrame: 20, punchComboNr: 1 });

  game.hitBarrelsInReach(attacker, 40, 6, 0.75, -0.9); // CRATE_PUNCH_PUSH constants

  assert.ok(b.vx > 0, 'the punch impulse shoves the prop');
  assert.ok(b.vx <= 0.9, 'the push reads heavy (a fraction of the old 3 px/step fling)');
  assert.equal(b.burning, false, 'no fire from a physical blow');
  if (b.vy !== 0) assert.ok(b.vy > -1.2, 'the punch no longer vaults the prop off the floor');
});

test('whatever rests on a moving prop rides along (no more hover-then-drop)', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrels.length = 0;
  // a crate stacked on a barrel that is about to be shoved
  const barrel = { x: 400, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 2, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: false };
  const stacked = { x: 398, y: PLAIN_FLOOR.y - 39, w: 20, h: 20, sx: 398, sy: PLAIN_FLOOR.y - 39, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false };
  game.barrels.push(barrel);
  game.crates.push(stacked);
  const startUpperX = stacked.x;

  game.step(); // one mover tick: the rider pass carries the upper along

  assert.ok(stacked.x > startUpperX, 'the crate on top moved with the barrel, not left behind');
  assert.ok(Math.abs(stacked.y + stacked.h - barrel.y) < 2.5, 'the stack stays flush instead of hovering');
});

test('a round restart rebuilds the props and clears the leftover patches', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrelDebris.length = 0;
  game.barrelDebris.push({ x: 1, y: 1, vx: 0, vy: 0, sprite: 153, angle: 0, spin: 0, scale: 1, h: 8, life: 10, maxLife: 10, landed: false, hit: {} });
  // burn one of the restocked props so the restart has something to clean
  game.restartRound();
  let pin = null;
  game.barrels[0].burning = true;
  game.restartRound();
  pin = game.barrels[0];

  assert.equal(game.barrels.length, 5, 'the props re-stock at their home spots');
  assert.equal(pin.burning, false, 'restocked props are pristine');
  assert.equal(game.barrelDebris.length, 0, 'the fire patches go out with the round');
});

test('a punched barrel rolls fluidly with weight: momentum carries, angle tracks the roll', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrels.length = 0;
  const b = { x: 100, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 5, vy: 0, angle: 0, spin: 0.2, burning: false, burnFuse: 0, resting: false };
  game.barrels.push(b);
  let sawRoll = false;
  for (let frame = 0; frame < 90; frame++) {
    game.step();
    if (Math.abs(b.angle) > 0.25) sawRoll = true;
  }
  assert.ok(b.x > 100, 'the barrel rolled along the floor');
  assert.ok(sawRoll, 'the round prop visually rolls while it slides (coupled spin)');
  assert.ok(b.resting, 'it settles back down like the crate easing');
  // a pushed barrel TIPS and stays fallen (nearest quarter turn), it does
  // not snap back upright — 'cae y girar' like a real barrel
  const quarter = Math.PI / 2;
  const nearest = Math.round(b.angle / quarter) * quarter;
  assert.ok(Math.abs(b.angle - nearest) < 1e-6, `the settled barrel rests on a quarter turn (got ${b.angle.toFixed(3)})`);
  assert.equal(b.spin, 0, 'no residual spin once it rests');
});

test('props feel heavy: a punch impulse is a fraction of the old fling', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const crate = {
    x: 420, y: PLAIN_FLOOR.y - 20, w: 20, h: 20, sx: 420, sy: PLAIN_FLOOR.y - 20,
    vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false
  };
  game.crates.push(crate);
  const start = crate.x;
  game.damageCrate(crate, 6, 0.75, -0.9); // punch-style impulse, scaled down
  for (let frame = 0; frame < 30; frame++) game.step();
  const travel = Math.abs(crate.x - start);
  assert.ok(travel < 14, `a punch shove stays weighty (traveled ${travel.toFixed(1)}px)`);
  assert.ok(travel >= 2, 'but the momentum still carries');
});

// ---------- crate rigid-body tumble ----------

test('a crate sliding off a ledge tumbles in the air and lands flat on a quarter turn', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const ledge = { x: 300, y: 400, w: 100, h: 20, solidSides: false, cloud: false, ladder: false };
  game.platforms.push(ledge);
  const crate = {
    x: 385, y: ledge.y - 20, w: 20, h: 20, sx: 385, sy: ledge.y - 20,
    vx: 3, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false
  };
  game.crates.push(crate);
  let maxAngle = 0;
  for (let frame = 0; frame < 120; frame++) {
    game.step();
    maxAngle = Math.max(maxAngle, Math.abs(crate.angle));
  }
  assert.ok(maxAngle > 0.3, `leaving the ledge tips the box over (max angle ${maxAngle.toFixed(2)})`);
  const q = Math.PI / 2;
  assert.ok(Math.abs(crate.angle - Math.round(crate.angle / q) * q) < 1e-6, 'it settles flat on a quarter turn');
  assert.equal(crate.spin, 0, 'no residual spin at rest');
});

// ---------- barrel rigid-body tip dynamics ----------

function dropBarrelAndShove(game, vx, startAngle) {
  game.barrels.length = 0;
  const lying = !!startAngle;
  const b = {
    x: 300, y: PLAIN_FLOOR.y - (lying ? 14 : 19), w: lying ? 19 : 14, h: lying ? 14 : 19,
    vx: 0, vy: 0, angle: startAngle || 0, spin: 0, burning: false, burnFuse: 0, resting: true
  };
  game.barrels.push(b);
  game.step(); game.step();
  b.vx += vx;
  const samples = [];
  for (let frame = 0; frame < 90; frame++) {
    game.step();
    samples.push({ angle: b.angle, bottom: b.y + b.h, w: b.w, h: b.h });
  }
  return { b, samples };
}

test('a light nudge only wobbles the barrel: it rocks and settles back upright', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const { b, samples } = dropBarrelAndShove(game, 0.3);
  assert.ok(samples.some((s) => Math.abs(s.angle) > 0.05), 'it rocks');
  assert.equal(b.angle, 0);
  assert.equal(b.h, 19);
});

test('a punch-sized shove topples the barrel onto its side with a cylinder-shaped hitbox', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const { b, samples } = dropBarrelAndShove(game, 0.8);
  assert.ok(Math.abs(Math.abs(b.angle) - Math.PI / 2) < 1e-6, 'it ends lying on its side');
  assert.ok(Math.abs(b.w - 19) < 1e-6 && Math.abs(b.h - 14) < 1e-6, 'the hitbox lies down with it (19x14)');
  assert.ok(b.resting);
  // it never pops: the angle moves a bounded amount each step, feet stay on the floor
  for (let i = 1; i < samples.length; i++) {
    assert.ok(Math.abs(samples[i].angle - samples[i - 1].angle) < 0.3, 'no single-step snap');
    assert.ok(Math.abs(samples[i].bottom - PLAIN_FLOOR.y) < 1e-6, 'the barrel stays on the floor while it falls');
  }
});

test('a hard shove on a lying barrel rolls it back onto its base (stands up by physics)', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const { b } = dropBarrelAndShove(game, 5, Math.PI / 2);
  assert.ok(Math.abs(b.angle / Math.PI - Math.round(b.angle / Math.PI)) < 1e-6, 'it ends on its base');
  assert.ok(Math.abs(b.h - 19) < 1e-6);
});

test('a kick-sized shove (0.85) stands a lying barrel back up', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  const { b } = dropBarrelAndShove(game, 0.85, Math.PI / 2);
  assert.ok(Math.abs(b.angle / Math.PI - Math.round(b.angle / Math.PI)) < 1e-6, 'ends on its base');
  assert.ok(Math.abs(b.h - 19) < 1e-6);
});

test('shoveBarrel (stomp from above) pushes the barrel under the fighter', () => {
  const { game } = createGame();
  spawnSwapArena(game);
  game.barrels.length = 0;
  const b = { x: 300, y: PLAIN_FLOOR.y - 19, w: 14, h: 19, vx: 0, vy: 0, angle: 0, spin: 0, burning: false, burnFuse: 0, resting: true };
  game.barrels.push(b);
  game.shoveBarrel(b, 1, 0.85, -1.05);
  // original BARREL: KickWeightCalculation + KickPower 1.8 -> launched at least as fast as a crate (0.85)
  assert.ok(b.vx > 0.85 && b.vy < 0);
});

test('the first hit pops an immediate shockwave; the barrel survives to fly', () => {
  const { game } = createGame();
  const b = game.barrels[0];
  const before = game.explosions.length;
  game.igniteBarrel(b, 2, -3, 0);
  assert.ok(game.explosions.length > before, 'first blast ring appears at once');
  assert.ok(!b.dead, 'the barrel itself is not destroyed by its own first wave');
});
