'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const rigid = require('../src/rigid-impact.js');
const heavy = require('../src/heavy-props.js');
const fire = require('../src/fire-propagation.js');
const noop = () => {};

test('central impulse never spins; off-centre one does; sign follows the lever', () => {
  assert.equal(rigid.spinChangeFromImpulse(20, 20, 0, 0, 0.8, -1), 0);
  const left = rigid.spinChangeFromImpulse(20, 20, -12, 4, 0, -0.5);
  const right = rigid.spinChangeFromImpulse(20, 20, 12, 4, 0, -0.5);
  assert.ok(left > 0 && right < 0, 'opposite levers spin opposite ways');
});

test('dead-band: weak hits give no spin, strong ones are reduced by the band', () => {
  assert.equal(rigid.spinChangeFromImpulse(20, 20, -12, 0, 0, -0.1), 0);
  const strong = rigid.spinChangeFromImpulse(20, 20, -12, 0, 0, -1);
  assert.ok(strong > 0);
  const raw = 12 * 1 * 12 / 800;
  assert.ok(Math.abs(strong - (raw - rigid.TORQUE_DEADBAND)) < 1e-9);
});

test('bigger bodies and boosts: same hit spins a larger box less, a boost spins more', () => {
  const small = rigid.spinChangeFromImpulse(14, 14, -10, 0, 0, -1);
  const large = rigid.spinChangeFromImpulse(30, 30, -10, 0, 0, -1);
  assert.ok(small > large);
  assert.ok(rigid.spinChangeFromImpulse(20, 20, -10, 0, 0, -0.5, 1.8) > rigid.spinChangeFromImpulse(20, 20, -10, 0, 0, -0.5, 1));
});

test('ground rotation: a small tilt falls back flat and locks; spin decays to zero', () => {
  const state = { angle: 0.2, spin: 0, pose: 0 };
  let locked = false;
  for (let i = 0; i < 400 && !locked; i++) locked = rigid.stepGroundRotation(state, 20, 14);
  assert.ok(locked);
  assert.equal(state.angle, 0);
  assert.equal(state.spin, 0);
});

test('ground rotation: a tall box pushed past its barrier topples onto its side', () => {
  const state = { angle: 0.9, spin: 0.05, pose: 0 }; // 14x19 barrier is ~36 deg (0.63 rad)
  let locked = false;
  for (let i = 0; i < 600 && !locked; i++) locked = rigid.stepGroundRotation(state, 14, 19);
  assert.ok(locked);
  assert.ok(Math.abs(state.angle - Math.PI / 2) < 1e-9, 'lying on its side');
});

test('spin never exceeds the cap and rotation is never endless', () => {
  const state = { angle: 0, spin: 5, pose: 0 };
  rigid.stepAirRotation(state);
  assert.ok(Math.abs(state.spin) <= rigid.MAX_SPIN);
  const ground = { angle: 0.4, spin: 0.35, pose: 0 };
  let locked = false;
  for (let i = 0; i < 600 && !locked; i++) locked = rigid.stepGroundRotation(ground, 20, 20);
  assert.ok(locked);
});

class FakeImage {
  constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(v) { this._src = v; this.complete = true; this.naturalWidth = 16; this.naturalHeight = 16; if (this.onload) this.onload(); }
  get src() { return this._src; }
}

function createGame(randomValue) {
  const rng = { value: randomValue === undefined ? 0.5 : randomValue };
  const controlledMath = Object.create(Math);
  controlledMath.random = () => rng.value;
  const gradient = { addColorStop: noop };
  const context = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient }, { get(t, k) { return k in t ? t[k] : noop; }, set() { return true; } });
  const canvas = { width: 800, height: 600, getContext: () => context };
  const window = { addEventListener: noop, requestAnimationFrame: noop };
  window.PLAYER_SPRITE_MAP = {
    idle: 592, walk: [599, 596, 600], run: [616, 596, 617], crouch: 613, jump: 597, fall: [602, 603, 606],
    attack: [627, 628, 630, 631, 633, 634], attackLinks: [[627, 628, 630], [631, 633], [634]], gethit: [718, 720],
    launched: [724, 725, 726], climb: [709, 710, 711], climbDown: 713, kick: 622, kickWithJump: 722, roll: [619, 620],
    dive: 624, knockedDown: [609, 610], SoftLanding: 611
  };
  const sandbox = {
    window, Image: FakeImage, Math: controlledMath, SuperfightersRigidImpact: rigid, SuperfightersHeavyProps: heavy, SuperfightersFighterHitbox: require('../src/fighter-hitbox.js'), SuperfightersFire: fire,
    document: { getElementById: () => canvas, createElement: (t) => (t === 'canvas' ? canvas : {}) },
    performance: { now: () => 0 }, console: { log: noop, warn: noop, error: noop }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8'), sandbox, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  game.crates.length = 0;
  game.rng = rng;
  return game;
}

test('in game: a central-ish weak shove only slides the crate, a foot kick spins it', () => {
  const game = createGame();
  const crate = game.createCrate(300, 458);
  for (let i = 0; i < 20; i++) game.step();
  const centre = { x: crate.x + crate.w / 2, y: crate.y + crate.h / 2 };
  game.damageCrate(crate, 1, 0.5, 0, { x: centre.x, y: centre.y, pushAtContact: true });
  assert.equal(crate.spin, 0, 'through the centre: linear only');
  assert.ok(crate.vx > 0);
  game.damageCrate(crate, 4, 0.85, -0.8, { x: centre.x - 14, y: crate.y + crate.h - 4, liftY: -0.5 });
  assert.ok(Math.abs(crate.spin) > 0, 'off-centre foot lift spins it');
});

test('in game: a spun crate comes to rest flat, with a hitbox matching its pose', () => {
  const game = createGame();
  const crate = game.createCrate(300, 458);
  for (let i = 0; i < 20; i++) game.step();
  game.damageCrate(crate, 4, 1, -1.2, { x: crate.x - 4, y: crate.y + crate.h - 4, liftY: -0.9, torqueBoost: 1.8 });
  for (let i = 0; i < 400; i++) game.step();
  const turns = crate.angle / (Math.PI / 2);
  assert.ok(Math.abs(turns - Math.round(turns)) < 1e-6, 'flat on a face');
  assert.equal(crate.spin, 0);
});

test('in game: heavier props slide less under the same kick; the fuel barrel shares the cement drum body', () => {
  const game = createGame();
  const attacker = game.players[0];
  attacker.x = 100; attacker.y = 458.75 - attacker.h; attacker.lastDirX = 1;
  const crate = game.createCrate(300, 458);
  const table = game.createCrate(340, 458, 'table');
  const cement = game.createCrate(380, 458, 'cementBarrel');
  const metal = game.createCrate(420, 458, 'metalCrate');
  const barrel = game.barrels[0];
  const kick = () => ({ kind: 'melee', x: attacker.x + 12, y: attacker.y + attacker.h - 4, liftY: -0.5 });
  const push = 0.85;
  for (const prop of [crate, table, cement, metal]) game.damageCrate(prop, 0, push, 0, kick());
  barrel.vx = 0;
  game.shoveBarrel(barrel, 1, push, 0, attacker, 'kick');
  assert.ok(table.vx < crate.vx && table.vx > crate.vx * 0.4, 'the table slides in the same range as a crate (the crate has +30 % impact response, the table none)');
  assert.ok(cement.vx < crate.vx, 'the cement drum is heavier than a crate: it slides less');
  assert.ok(barrel.vx < crate.vx, 'the fuel barrel is the same heavy drum');
  assert.ok(Math.abs(barrel.vx - cement.vx) < cement.vx * 0.6, 'fuel barrel ~ cement drum');
  assert.ok(metal.vx < crate.vx * 0.6, 'the invented metal crate stays hard to kick');
});

test('in game: a bullet impulse is divided by mass (cement drum moves less than a crate)', () => {
  const game = createGame();
  const crate = game.createCrate(300, 458);
  const cement = game.createCrate(340, 458, 'cementBarrel');
  const shot = (p) => ({ x: p.x, y: p.y + 4, kind: 'bullet', pushAtContact: true });
  game.damageCrate(crate, 0, 2, 0, shot(crate));
  game.damageCrate(cement, 0, 2, 0, shot(cement));
  assert.ok(cement.vx < crate.vx);
});

test('in game: sliding stops by Coulomb friction, independent of mass', () => {
  const game = createGame();
  const crate = game.createCrate(150, 458);
  const table = game.createCrate(200, 458, 'table');
  for (let i = 0; i < 10; i++) game.step();
  crate.vx = 2; table.vx = 2;
  const startCrate = crate.x; const startTable = table.x;
  for (let i = 0; i < 120; i++) game.step();
  const crateTravel = crate.x - startCrate; const tableTravel = table.x - startTable;
  assert.ok(Math.abs(crateTravel - tableTravel) < crateTravel * 0.15, 'same friction (wood), same distance');
});

test('in game: punches and charged kicks only lean a fuel barrel: their spin never exceeds the halved hit cap', () => {
  const game = createGame();
  const attacker = game.players[0];
  const barrel = game.barrels[0];
  attacker.lastDirX = 1;
  attacker.x = barrel.x - attacker.w - 2; attacker.y = barrel.y + barrel.h - attacker.h;
  const drum = heavy.HEAVY_PROP_CONFIG.cementBarrel; // the fuel barrel shares the drum's body
  const spinCap = drum.maxHitSpin * heavy.EXPLOSIVE_BARREL_IMPACT_MULTIPLIERS.torque; // the fuel barrel's own row
  for (const [hit, pushX, pushY] of [['punch', game.meleePush.punchX, 0], ['aerialKick', game.meleePush.kickX, -0.8]]) {
    for (let run = 0; run < 20; run++) {
      barrel.spin = 0;
      game.shoveBarrel(barrel, 1, pushX, pushY, attacker, hit);
      assert.ok(Math.abs(barrel.spin) <= spinCap + 1e-9, hit + ' spun it at ' + barrel.spin);
    }
  }
});

test('varyHit: pinned RNG changes nothing; different RNG values change force, direction and lever', () => {
  const hit = { pushX: 1, pushY: -0.5, x: 10, y: 20, torqueBoost: 1 };
  const same = rigid.varyHit(hit, 'melee', () => 0.5);
  assert.ok(Math.abs(same.pushX - 1) < 1e-9 && Math.abs(same.pushY + 0.5) < 1e-9 && same.x === 10 && same.torqueBoost === 1);
  const a = rigid.varyHit(hit, 'melee', () => 0.1);
  const b = rigid.varyHit(hit, 'melee', () => 0.9);
  assert.notEqual(a.pushX, b.pushX);
  assert.notEqual(a.x, b.x);
  assert.notEqual(a.torqueBoost, b.torqueBoost);
});

test('in game: repeated identical kicks never produce the same motion', () => {
  const results = new Set();
  let seed = 0.13;
  const game = createGame();
  game.rng.value = 0.5;
  for (let i = 0; i < 8; i++) {
    seed = (seed * 9301 + 0.49297) % 1;
    game.rng.value = seed;
    const crate = game.createCrate(300, 458);
    for (let s = 0; s < 5; s++) game.step();
    game.damageCrate(crate, 0, 0.85, -1.05, { kind: 'melee', x: crate.x - 4, y: crate.y + crate.h - 4, liftY: -0.5 });
    results.add([crate.vx.toFixed(3), crate.vy.toFixed(3), crate.spin.toFixed(3)].join('|'));
    crate.dead = true;
  }
  assert.ok(results.size >= 6, 'varied outcomes: ' + results.size);
});

test('in game: a punch carries less force than a kick and lands at fist height', () => {
  const game = createGame();
  const attacker = game.players[0];
  attacker.lastDirX = 1; attacker.x = 100; attacker.y = 458.75 - attacker.h;
  assert.ok(game.meleePush.punchX < game.meleePush.kickX);
  assert.ok(game.meleePush.punchX > game.meleePush.kickX * 0.5, 'a little weaker, not feeble');
  const punch = game.meleeContact(attacker, 'punch');
  const kick = game.meleeContact(attacker, 'kick');
  assert.ok(punch.y < kick.y, 'fist above the boot');
  assert.equal(punch.liftY, 0);
  assert.ok(kick.liftY < 0);
});

test('in game: a punch and a kick rotate the same crate differently', () => {
  const game = createGame();
  const attacker = game.players[0];
  attacker.lastDirX = 1; attacker.x = 100; attacker.y = 458.75 - attacker.h;
  const kicked = game.createCrate(300, 458);
  const punched = game.createCrate(340, 458);
  for (let s = 0; s < 5; s++) game.step();
  game.damageCrate(kicked, 0, game.meleePush.kickX, -1.05, game.meleeContact(attacker, 'kick'));
  game.damageCrate(punched, 0, game.meleePush.punchX, 0, game.meleeContact(attacker, 'punch'));
  assert.ok(kicked.vy < 0, 'the kick lofts it');
  assert.equal(punched.vy, 0, 'the punch shoves it flat');
  assert.notEqual(kicked.spin.toFixed(3), punched.spin.toFixed(3));
});

test('in game: hitting a crate tilts it slowly (low spin ceiling), the metal crate even slower', () => {
  const game = createGame();
  const plain = game.createCrate(300, 458);
  const metal = game.createCrate(340, 458, 'metalCrate');
  for (let s = 0; s < 5; s++) game.step();
  for (const crate of [plain, metal]) {
    game.damageCrate(crate, 4, 1.6, -1.5, { kind: 'melee', x: crate.x - 4, y: crate.y + crate.h - 4, liftY: -1.2, torqueBoost: 1.8 });
  }
  // a strong blow may keep the inertia to roll the crate over (inertia decides
  // the tip-over), but never more than its own tipping energy plus a margin
  const tipCeiling = (w, h) => rigid.criticalTipSpin(0, w, h, 0.3375 * 0.3) * 1.25;
  assert.ok(Math.abs(plain.spin) > 0 && Math.abs(plain.spin) <= tipCeiling(plain.baseW || plain.w, plain.baseH || plain.h) + 1e-9, 'plain crate spin ' + plain.spin);
  assert.ok(Math.abs(metal.spin) < Math.abs(plain.spin), 'metal crate spin ' + metal.spin + ' (slower than the plain crate)');
});

test('anti-tunnelling: speeds are clamped and a fast crate cannot pass through another', () => {
  const game = createGame();
  const bullet = game.createCrate(200, 458);
  const target = game.createCrate(260, 458);
  for (let s = 0; s < 5; s++) game.step();
  game.damageCrate(bullet, 0, 500, 0);
  assert.ok(Math.abs(bullet.vx) <= 14, 'impulse clamped: ' + bullet.vx);
  bullet.vx = 14;
  for (let s = 0; s < 40; s++) {
    game.step();
    assert.ok(bullet.x + bullet.w / 2 < target.x + target.w / 2 + 1, 'did not tunnel through the other crate (step ' + s + ')');
  }
});

test('anti-tunnelling: a fighter airborne speed is capped and a fast prop does not teleport him through the next prop', () => {
  const game = createGame();
  const p = game.players[0];
  p.x = 100; p.y = 300; p.airVelocityX = 200; p.airVelocityY = -200; p.falling = true; p.onGround = false;
  game.step();
  assert.ok(Math.abs(p.airVelocityX) <= 16 && Math.abs(p.airVelocityY) <= 16);
});
