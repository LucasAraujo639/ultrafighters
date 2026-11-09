'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const heavy = require('../src/heavy-props.js');
const fire = require('../src/fire-propagation.js');
const rigid = require('../src/rigid-impact.js');
const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};

class FakeImage {
  constructor() { this.complete = false; this.naturalWidth = 0; this.naturalHeight = 0; }
  set src(value) {
    this._src = value; this.complete = true; this.naturalWidth = 16; this.naturalHeight = 16;
    if (typeof this.onload === 'function') this.onload();
  }
  get src() { return this._src; }
}

function createGame() {
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    { createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    { get(t, k) { return k in t ? t[k] : noop; }, set() { return true; } }
  );
  const canvas = { width: 800, height: 600, getContext: () => context };
  const window = { addEventListener: noop, requestAnimationFrame: noop };
  window.PLAYER_SPRITE_MAP = {
    idle: 592, walk: [599, 596, 600], run: [616, 596, 617], crouch: 613,
    jump: 597, fall: [602, 603, 606], attack: [627, 628, 630, 631, 633, 634],
    attackLinks: [[627, 628, 630], [631, 633], [634]], gethit: [718, 720],
    launched: [724, 725, 726], climb: [709, 710, 711], climbDown: 713,
    kick: 622, kickWithJump: 722, roll: [619, 620], dive: 624,
    knockedDown: [609, 610], SoftLanding: 611
  };
  const played = [];
  const rng = { value: 0.5 };
  const controlledMath = Object.create(Math);
  controlledMath.random = () => rng.value;
  const sandbox = {
    window, Image: FakeImage, Math: controlledMath,
    SuperfightersHeavyProps: heavy,
    SuperfightersFighterHitbox: require('../src/fighter-hitbox.js'),
    SuperfightersPropFighterContacts: require('../src/prop-fighter-contacts.js'),
    SuperfightersFire: fire,
    SuperfightersRigidImpact: rigid,
    SuperfightersAudio: (() => {
      const real = require('../src/audio-manager.js');
      return {
        SFX: real.SFX,
        SOUND_CATALOG: real.SOUND_CATALOG,
        createAudioManager: (options) => {
          const manager = real.createAudioManager(options);
          const play = manager.play;
          manager.play = (name, opts) => { played.push(name); return play(name, opts); };
          return manager;
        }
      };
    })(),
    Audio: class { constructor() { this.volume = 1; this.paused = true; } play() { return Promise.resolve(); } pause() {} load() {} addEventListener() {} },
    document: { getElementById: () => canvas, createElement: (t) => (t === 'canvas' ? canvas : {}) },
    performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  };
  vm.runInNewContext(gameSource, sandbox, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  return { game, played, rng };
}

test('pure rules: rope anchor is hit by a precise shot, not a body shot', () => {
  const prop = { x: 100, y: 200, w: 36, h: 20 };
  assert.ok(heavy.segmentCrossesAnchor(prop, 50, 196, 150, 196)); // crosses the rope at its height
  assert.ok(!heavy.segmentCrossesAnchor(prop, 50, 210, 150, 210)); // body height: no
  assert.ok(!heavy.segmentCrossesAnchor(prop, 50, 196, 105, 196)); // stops short of the rope
});

test('pure rules: blast must reach the anchor; mass divides impulses; bounce is gated', () => {
  const prop = { x: 100, y: 200, w: 36, h: 20 };
  const anchor = heavy.anchorPoint(prop);
  assert.ok(heavy.blastReachesAnchor(prop, anchor.x + 10, anchor.y, 12));
  assert.ok(!heavy.blastReachesAnchor(prop, anchor.x + 40, anchor.y, 12));
  assert.ok(heavy.impulseForMass(6, 6) < heavy.impulseForMass(6, 2.5));
  assert.ok(!heavy.shouldBounce(heavy.HEAVY_PROP_CONFIG.bouncer, 99, () => 0)); // the bouncer no longer hops
  assert.ok(!heavy.shouldBounce(heavy.HEAVY_PROP_CONFIG.metalCrate, 99, () => 0)); // never bounces
  assert.ok(heavy.HEAVY_PROP_CONFIG.metalCrate.mass > heavy.HEAVY_PROP_CONFIG.bouncer.mass);
});

test('bouncer (sprite 1063): same physics as the cement barrel, only art, size and durability differ', () => {
  const bouncer = heavy.HEAVY_PROP_CONFIG.bouncer;
  const cement = heavy.HEAVY_PROP_CONFIG.cementBarrel;
  assert.equal(bouncer.sprite, 1063);
  for (const key of ['mass', 'friction', 'kickSpeedRatio', 'liftRatio', 'meleeVerticalRatio', 'impactMultipliers',
    'torqueScale', 'maxHitSpin', 'bulletPush', 'knockbackMinSpeed', 'knockbackTransfer', 'bounceChance', 'crushChance']) {
    assert.deepEqual(bouncer[key], cement[key], key);
  }
  assert.notEqual(bouncer.width, cement.width);
});

test('metal crate: heavy, shot rings metal and barely scratches', () => {
  const { game, played } = createGame();
  const metal = game.crates.find((c) => c.heavyKind === 'metalCrate');
  const wood = game.crates.find((c) => !c.heavyKind);
  assert.ok(metal && metal.mass > 1);
  const hp = metal.hp;
  game.damageCrate(metal, 20, 6, 0);
  game.damageCrate(wood, 20, 6, 0);
  assert.ok(metal.vx < wood.vx / 3, 'same shove moves the metal crate far less');
  assert.ok(metal.hp > hp - 2);
  game.bullets.push({ x: metal.x + 2, y: metal.y + 2, vx: 0, vy: 0, damage: 10, owner: 99, life: 50 });
  game.step();
  assert.ok(played.includes('BULLET_HIT_METAL'));
});

function placeFighterOnFloor(game, fighter, x) {
  fighter.x = x; fighter.y = 458.75 - fighter.h; fighter.airVelocityX = 0; fighter.airVelocityY = 0;
  fighter.onGround = true; fighter.knockedDown = false; fighter.knockbackRoll = false;
}

test('hanging deck: solid, hangs beside the ladder, body shots swing it, rope shot cuts it and the fall kills', () => {
  const { game } = createGame();
  const deck = game.crates.find((c) => c.anchor);
  assert.ok(deck && !deck.anchor.released);
  assert.ok(Math.abs(deck.x + deck.w / 2 - 202) < 3, 'next to the ladder (x 162-175)');
  // body shot: swings, does not cut
  game.bullets.push({ x: deck.x + 4, y: deck.y + 5, vx: 12, vy: 0, damage: 10, owner: 99, life: 50 });
  game.step();
  assert.equal(deck.anchor.released, false);
  assert.ok(deck.anchor.omega > 0, 'impulse transferred');
  let maxAngle = 0;
  for (let i = 0; i < 120; i++) { game.step(); maxAngle = Math.max(maxAngle, Math.abs(deck.anchor.angle)); }
  assert.ok(maxAngle > 0.005 && maxAngle <= 0.22, 'subtle swing');
  // rope shot
  game.bullets.push({ x: deck.anchor.pivotX + (deck.x + deck.w / 2 - deck.anchor.pivotX), y: deck.y - 4, vx: 0, vy: 0, damage: 10, owner: 99, life: 50 });
  game.step();
  assert.equal(deck.anchor.released, true);
  const victim = game.players[1];
  victim.x = deck.x + deck.w / 2 - victim.w / 2;
  victim.y = deck.y + deck.h + 6;
  const hpBefore = victim.hp;
  for (let i = 0; i < 60 && victim.hp === hpBefore; i++) game.step();
  assert.equal(victim.hp, 0, 'the crush is lethal: ' + victim.hp);
  assert.ok(victim.gibbed, 'the lethal crush bursts him open');
  for (let i = 0; i < 120; i++) game.step();
  assert.ok(!deck.dead && game.crates.includes(deck), 'the fallen deck stays on the scene');
  assert.ok(deck.anchor.landed);
});

test('hanging deck: once fallen it is a harmless heavy solid prop', () => {
  const { game } = createGame();
  const deck = game.crates.find((c) => c.anchor);
  game.releaseHangingProp(deck);
  for (let i = 0; i < 200; i++) game.step();
  assert.ok(deck.anchor.landed && !deck.dead);
  const p = game.players[0];
  placeFighterOnFloor(game, p, deck.x - p.w - 20);
  const hp = p.hp;
  deck.vy = 0;
  for (let i = 0; i < 30; i++) game.step();
  assert.equal(p.hp, hp);
});

test('hanging deck: a fighter lands on it (solid), tilts it by weight and rides the swing', () => {
  const { game } = createGame();
  const deck = game.crates.find((c) => c.anchor);
  const p = game.players[0];
  p.x = deck.x + deck.w - p.w - 1; // right edge
  p.y = deck.y - p.h - 10;
  p.airVelocityY = 0; p.falling = true; p.onGround = false;
  for (let i = 0; i < 90; i++) game.step();
  assert.ok(Math.abs(p.y + p.h - deck.y) < 1.5, 'stands on the deck, not through it');
  assert.ok(deck.anchor.angle !== 0, 'weight tilts the deck');
  assert.ok(Math.abs(deck.anchor.angle) <= 0.22);
});

test('hanging deck: a blast reaching the rope releases it, a far one does not', () => {
  const { game } = createGame();
  const deck = game.crates.find((c) => c.anchor);
  game.explodeAt(deck.x + 400, deck.y, 40, 10, 5);
  assert.equal(deck.anchor.released, false);
  game.explodeAt(deck.anchor.pivotX + 4, deck.anchor.pivotY + 4, 40, 10, 5);
  assert.equal(deck.anchor.released, true);
});

test('cement barrel: slides when shot, never explodes or burns', () => {
  const { game } = createGame();
  const cement = game.crates.find((c) => c.heavyKind === 'cementBarrel');
  assert.ok(cement);
  for (let i = 0; i < 30; i++) game.step();
  const startX = cement.x;
  game.bullets.push({ x: cement.x + 2, y: cement.y + 4, vx: 12, vy: 0, damage: 10, owner: 99, life: 50 });
  game.step();
  assert.ok(cement.vx > 0 || cement.x > startX, 'the shot nudges it');
  const explosionsBefore = game.explosions.length;
  game.damageCrate(cement, 500, 0, 0);
  assert.equal(game.explosions.length, explosionsBefore);
  assert.ok(!cement.dead);
  assert.equal(fire.isFlammable('concrete'), false);
});

test('table: hitbox is the real rectangle and follows the rotation', () => {
  const { game } = createGame();
  const table = game.crates.find((c) => c.heavyKind === 'table');
  for (let i = 0; i < 30; i++) game.step();
  assert.ok(table.w > table.h, 'wide and low upright');
  const bottom = table.y + table.h;
  table.angle = Math.PI / 2; // lying on its end
  game.step();
  assert.ok(table.h > table.w, 'tall and narrow once turned 90 degrees');
  assert.ok(Math.abs(table.y + table.h - bottom) < 0.5, 'still sitting on the same floor');
});

test('table: breaks into three non-solid wooden fragments that vanish after 20 s', () => {
  const { game } = createGame();
  const table = game.crates.find((c) => c.heavyKind === 'table');
  const cx = table.x + table.w / 2;
  const cratesBefore = game.crates.length;
  game.damageCrate(table, 999, 0, 0);
  assert.ok(table.dead);
  assert.equal(game.propFragments.length, 3);
  assert.equal(game.propFragments.map((f) => f.heavyConfig.sprite).sort().join(), '205,208,211');
  for (const f of game.propFragments) {
    assert.ok(Math.abs(f.x + f.w / 2 - cx) < 1);
    assert.equal(f.heavyConfig.material, 'wood');
  }
  assert.equal(game.crates.length, cratesBefore - 0, 'fragments are not solid crates');
  // a fighter standing in them is not moved or blocked
  const p = game.players[0];
  placeFighterOnFloor(game, p, cx - p.w / 2);
  p.y = table.y + table.h - p.h; // stand on the same floor the table stood on
  const startX = p.x;
  for (let i = 0; i < 5; i++) game.step();
  assert.ok(Math.abs(p.x - startX) < 0.5);
  for (let i = 0; i < 1210; i++) game.step();
  assert.equal(game.propFragments.length, 0, 'gone after 20 seconds');
});

test('fire spreads gradually to nearby flammable props (crates and fragments); far and fireproof stay safe', () => {
  const { game } = createGame();
  game.crates.length = 0;
  const burning = game.createCrate(300, 458);
  const near = game.createCrate(318, 458);
  const far = game.createCrate(200, 458);
  const metal = game.createCrate(336, 458, 'metalCrate');
  const scrap = game.createPropFragment('tableFragmentA', 300, 450);
  game.igniteCrate(burning);
  game.step();
  assert.ok(!near.onFire, 'not instant');
  for (let i = 0; i < 120 && !(near.onFire && scrap.onFire); i++) game.step();
  assert.ok(near.onFire, 'neighbour catches fire after a few pulses');
  assert.ok(scrap.onFire, 'fragments are fuel too');
  assert.ok(!far.onFire);
  assert.ok(!metal.onFire);
});

test('burning fragments are consumed and disappear entirely', () => {
  const { game } = createGame();
  const fragment = game.createPropFragment('tableFragmentA', 300, 440);
  game.igniteCrate(fragment);
  for (let i = 0; i < 300 && game.propFragments.includes(fragment); i++) game.step();
  assert.ok(!game.propFragments.includes(fragment));
});

test('heavy props thrown by a blast send the fighter into the knockback roll', () => {
  for (const kind of ['metalCrate', 'cementBarrel', 'bouncer']) {
    const { game } = createGame();
    const prop = game.crates.find((c) => c.heavyKind === kind);
    const p = game.players[0];
    prop.x = 200; prop.y = 458.75 - prop.h; // open stretch of the outdoor floor
    placeFighterOnFloor(game, p, prop.x + prop.w + 4);
    prop.vx = 7; prop.vy = 0; prop.resting = false;
    game.step();
    assert.ok(p.knockbackRoll, kind + ' triggers the roll');
    assert.ok(p.airVelocityX > 0, 'thrown along the impact');
  }
});

test('a slow-sliding heavy prop only shoves the fighter (no roll)', () => {
  const { game } = createGame();
  const prop = game.crates.find((c) => c.heavyKind === 'metalCrate');
  const p = game.players[0];
  placeFighterOnFloor(game, p, prop.x + prop.w + 1);
  prop.vx = 0.5;
  game.step();
  assert.ok(!p.knockbackRoll);
});

test('fragments: the contact zone is wider than the art and scatters when a fighter walks over', () => {
  const { game } = createGame();
  const scrap = game.createPropFragment('tableFragmentC', 300, 452);
  for (let i = 0; i < 30; i++) game.step();
  scrap.vx = 0; scrap.vy = 0;
  const p = game.players[0];
  // stand 6 px beside the 6 px wide scrap: outside the art, inside the contact zone
  placeFighterOnFloor(game, p, scrap.x - p.w - 4);
  const art = { x: scrap.x, y: scrap.y, w: scrap.w, h: scrap.h };
  assert.ok(p.x + p.w < art.x, 'not touching the sprite');
  game.step();
  assert.ok(scrap.vx !== 0 || scrap.vy < 0, 'the scrap reacted');
});

test('fragments: a kick flings them and a blast throws them away from the centre', () => {
  const { game } = createGame();
  const scrap = game.createPropFragment('tableFragmentA', 300, 452);
  const other = game.createPropFragment('tableFragmentB', 360, 452);
  for (let i = 0; i < 30; i++) game.step();
  const p = game.players[0];
  placeFighterOnFloor(game, p, scrap.x - p.w - 2);
  p.lastDirX = 1;
  other.nudgeCooldown = 999;
  scrap.vx = 0; scrap.vy = 0; scrap.nudgeCooldown = 999;
  game.hitCratesInReach(p, 30, 4, 1.5, -1);
  assert.ok(scrap.vx > 0, 'flung forward by the kick');
  other.vx = 0;
  game.explodeAt(other.x - 20, other.y, 60, 10, 5);
  assert.ok(other.vx > 0, 'blown away from the blast');
});

test('hanging deck released right above a fighter standing under it crushes him once and throws him', () => {
  const { game } = createGame();
  const deck = game.crates.find((c) => c.anchor);
  const p = game.players[0];
  // stand on the ledge beside the ladder, a few px under the deck (slow fall speed on contact)
  p.x = deck.x + deck.w / 2 - p.w / 2; p.y = 351.75 - p.h; p.onGround = true;
  p.groundedPlatform = game.platforms.find((q) => Math.abs(q.y - 351.75) < 1 && q.x > 180) || null;
  for (let i = 0; i < 10; i++) game.step();
  const hp0 = p.hp;
  game.releaseHangingProp(deck);
  const damageSteps = [];
  let lastHp = hp0;
  let minHp = hp0;
  let everGibbed = false;
  for (let i = 0; i < 200; i++) {
    game.step();
    if (p.gibbed) everGibbed = true; // the round restart later revives him
    if (lastHp - p.hp >= 20) damageSteps.push(i); // crush-size hits (landing impact is smaller)
    lastHp = p.hp;
    minHp = Math.min(minHp, p.hp);
  }
  assert.equal(damageSteps.length, 1, 'crushed exactly once, no repeated hits');
  assert.equal(minHp, 0, 'no chance to survive');
  assert.ok(everGibbed, 'bursts open instead of being thrown');
});

test('a landed hanging deck pushed off an edge and dropping onto a fighter kills him too', () => {
  const { game } = createGame();
  const deck = game.crates.find((c) => c.anchor);
  game.releaseHangingProp(deck);
  for (let i = 0; i < 200; i++) game.step();
  assert.ok(deck.anchor.landed);
  const p = game.players[0];
  placeFighterOnFloor(game, p, 100);
  // shoved off a ledge above him: falling fast
  deck.x = p.x + p.w / 2 - deck.w / 2; deck.y = p.y - deck.h - 30; deck.vx = 0; deck.vy = 3; deck.resting = false;
  for (let i = 0; i < 60 && p.hp > 0; i++) game.step();
  assert.equal(p.hp, 0);
});

test('a landed hanging deck sliding sideways along the floor does not kill', () => {
  const { game } = createGame();
  const deck = game.crates.find((c) => c.anchor);
  game.releaseHangingProp(deck);
  for (let i = 0; i < 200; i++) game.step();
  const p = game.players[0];
  deck.x = 120; deck.y = 458.75 - deck.h; deck.vx = 0; deck.vy = 0;
  placeFighterOnFloor(game, p, 160);
  deck.vx = 2;
  for (let i = 0; i < 40; i++) game.step();
  assert.ok(p.hp > 0);
});

test('a fighter killed by a crushing prop bursts into gore that stays close, unlike a blast', () => {
  const crushed = (() => {
    const { game } = createGame();
    const deck = game.crates.find((c) => c.anchor);
    const p = game.players[0];
    p.x = deck.x + deck.w / 2 - p.w / 2; p.y = 351.75 - p.h; p.onGround = true;
    p.groundedPlatform = game.platforms.find((q) => Math.abs(q.y - 351.75) < 1 && q.x > 180) || null;
    for (let i = 0; i < 10; i++) game.step();
    game.releaseHangingProp(deck);
    for (let i = 0; i < 12 && !p.gibbed; i++) game.step();
    assert.ok(p.gibbed, 'burst on death');
    return game.gore.slice();
  })();
  const blasted = (() => {
    const { game } = createGame();
    const p = game.players[0];
    placeFighterOnFloor(game, p, 200);
    p.setHp(1);
    game.explodeAt(p.x + p.w / 2, p.y + p.h / 2, 120, 100, 100);
    assert.ok(p.gibbed);
    return game.gore.slice();
  })();
  assert.ok(crushed.length >= 10, 'there is gore');
  const reach = (list) => Math.max(...list.map((g) => Math.hypot(g.vx, g.vy)));
  assert.ok(reach(crushed) < reach(blasted) * 0.6, 'short range: ' + reach(crushed).toFixed(1) + ' vs ' + reach(blasted).toFixed(1));
});

test('standing ON the hanging deck when it is cut (grenade in hand) never counts as being crushed', () => {
  const { game } = createGame();
  const deck = game.crates.find((c) => c.anchor);
  const p = game.players[0];
  p.x = deck.x + deck.w / 2 - p.w / 2; p.y = deck.y - p.h; p.onGround = true; p.groundedCrate = deck; p.groundedPlatform = null;
  for (let i = 0; i < 5; i++) game.step();
  assert.ok(p.groundedCrate === deck, 'riding the deck');
  const hp0 = p.hp;
  // a blast that reaches the rope but is too weak to hurt him: only the cut matters
  game.releaseHangingProp(deck);
  let gibbed = false;
  for (let i = 0; i < 60; i++) { game.step(); if (p.gibbed) gibbed = true; }
  assert.ok(!gibbed, 'not gibbed by his own deck');
  assert.ok(p.hp >= hp0 - 25, 'no crush damage from a deck under his feet: ' + p.hp);
});

test('a bouncer under a fighter (he stands on it) never crushes him', () => {
  const { game } = createGame();
  const bouncer = game.crates.find((c) => c.heavyKind === 'bouncer');
  const p = game.players[0];
  for (let i = 0; i < 30; i++) game.step();
  p.x = bouncer.x + bouncer.w / 2 - p.w / 2; p.y = bouncer.y - p.h; p.onGround = true; p.groundedCrate = bouncer;
  bouncer.vy = 4; bouncer.bouncing = true;
  const hp0 = p.hp;
  for (let i = 0; i < 30; i++) game.step();
  assert.equal(p.hp, hp0);
});
