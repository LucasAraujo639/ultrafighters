'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};

// Synchronous Image stub (fires onload on src assignment): same contract as
// melee-axe-combo.test.js — spriteReady is true by the end of the module body.
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
  get src() {
    return this._src;
  }
}

// Recording context: tracks every canvas op inside the current save frame.
function createGame() {
  const listeners = Object.create(null);
  const drawCalls = [];
  let flipped = false;
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient,
      save: function () { flipped = false; drawCalls.push({ name: 'save', args: [], flipped }); },
      restore: function () { drawCalls.push({ name: 'restore', args: [], flipped }); },
      translate: function (x, y) { drawCalls.push({ name: 'translate', x, y, flipped }); },
      scale: function (x, y) {
        if (Number(x) === -1) flipped = true;
        drawCalls.push({ name: 'scale', args: [x, y], flipped });
      },
      rotate: function (a) { drawCalls.push({ name: 'rotate', args: [a], flipped }); },
      drawImage: function () { drawCalls.push({ name: 'drawImage', args: Array.from(arguments), flipped }); }
    },
    {
      get(target, key) {
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
    requestAnimationFrame(callback) { /* frame loop not driven here */ }
  };
  window.PLAYER_SPRITE_MAP = {
    idle: 592,
    walk: [599, 596, 600],
    run: [616, 596, 617],
    crouch: 613,
    jump: 597,
    fall: [602, 603, 606],
    attack: [627, 628, 630, 631, 633, 634],
    attackLinks: [[627, 628, 630], [631, 633], [634]],
    gethit: [718, 720],
    launched: [724, 725, 726],
    climb: [709, 710, 711],
    climbDown: 713,
    kick: 622,
    kickWithJump: 722,
    roll: [619, 620],
    dive: 624,
    knockedDown: [609, 610],
    SoftLanding: 611
  };
  const sandbox = {
    window,
    Image: FakeImage,
    document: {
      getElementById: () => canvas,
      createElement: (tag) => (tag === 'canvas' ? canvas : {})
    },
    performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  };

  vm.runInNewContext(gameSource, sandbox, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  for (const item of game.weaponItems) item.taken = true;
  return { game, drawCalls };
}

function groundPlayer(player, x, y) {
  Object.assign(player, {
    x,
    y,
    airVelocityX: 0,
    airVelocityY: 0,
    onGround: true,
    groundedPlatform: null,
    jumping: false,
    falling: false,
    knockedDown: false,
    rolling: false,
    knockbackRoll: false,
    diving: false,
    climbing: false,
    crouching: false,
    aiming: false,
    matrixDodgeTimer: 0,
    hp: 100
  });
  player.lastDirX = 1;
}

// Fresh flat world: one big floor, no crates, both fighters parked wide.
function createGameWithFloor() {
  const created = createGame();
  const game = created.game;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  groundPlayer(game.players[0], 60, floor.y - game.players[0].h);
  groundPlayer(game.players[1], 720, floor.y - game.players[1].h);
  return { ...created, floor };
}

test('every blast leaves an 18-ember fire fan behind (TriggerFireAt: BARREL)', () => {
  const { game } = createGameWithFloor();
  groundPlayer(game.players[0], 60, 470);
  groundPlayer(game.players[1], 720, 470);

  game.explodeAt(400, 470, 60, 40, 10);

  assert.equal(game.explosions.length, 1, 'the visual blast ring lives');
  assert.equal(game.groundFire.length, 18, 'the barrel fan leaves 18 embers');
  for (const f of game.groundFire) {
    assert.ok(f.inAir === true, 'embers start airborne');
    assert.ok(
      f.life >= 60 && f.life <= 120,
      'each ember burns 1 - 2 s on the ground (life=' + f.life + ')'
    );
  }
});

test('embers skim, land on the floor and burn out after at most 2 s', () => {
  const { game, floor } = createGameWithFloor();
  groundPlayer(game.players[0], 60, 470);
  groundPlayer(game.players[1], 720, 470);

  game.explodeAt(400, 480, 60, 40, 10);
  assert.equal(game.groundFire.length, 18, 'the fan spawns');

  // let them glide/fall/land (drag-kill the glide, gravity ~0.08/step)
  let landed = 0;
  for (let step = 0; step < 160; step++) {
    game.step();
    landed = game.groundFire.filter((f) => !f.inAir).length;
    if (landed === game.groundFire.length) break;
  }
  assert.equal(landed, game.groundFire.length, 'every ember is on the floor');
  for (const f of game.groundFire) {
    assert.equal(f.y, floor.y, 'embers rest ON the surface, never under it');
    assert.ok(Math.abs(f.x - 400) < 60, 'the pool stays around the blast footprint');
  }

  // the burn gauge: equalize the pools and confirm the 60-120 step fire out
  for (const f of game.groundFire) { f.life = 60; f.maxLife = 60; }
  for (let step = 0; step < 59; step++) game.step();
  assert.ok(game.groundFire.length > 0, 'a 60-step ember still burns one step early');
  game.step();
  assert.equal(game.groundFire.length, 0, 'the ground fire goes out — nothing lingers past its timer');
});

test('an ember landing near a grounded one merges and keeps the longer burn', () => {
  const { game } = createGameWithFloor();
  game.groundFire.length = 0;

  const survivor = {
    x: 400, y: 500, vx: 0, vy: 0, size: 6, life: 30, maxLife: 30,
    inAir: false, slowing: false, hit: {}, phase: 0, sparkTimer: 10, crateTick: 0
  };
  game.groundFire.push(survivor);

  const landing = {
    x: 402, y: 499, vx: 0, vy: 2, size: 6, life: 100, maxLife: 100,
    inAir: true, slowing: true, hit: {}, phase: 1, sparkTimer: 10, crateTick: 0
  };
  game.groundFire.push(landing);

  game.step();
  assert.equal(game.groundFire.length, 1, 'the landing merged into the survivor');
  assert.ok(game.groundFire[0] === survivor, 'the grounded ember survived the merge');
  // 100 minus this step's own grounded burn tick (the merge landed first)
  assert.equal(game.groundFire[0].life, 99, 'the longer BurnTimer wins over');
});

test('standing in the pool lights the fighter at FIRE_LEVEL_1, once per ember', () => {
  const { game } = createGameWithFloor();
  const p1 = game.players[0];
  const hp0 = p1.hp; // 100

  // one burning ember right under the fighter's midsection
  game.groundFire.length = 0;
  game.groundFire.push({
    x: p1.x + p1.w / 2, y: p1.y + p1.h / 2, vx: 0, vy: 0, size: 6,
    life: 90, maxLife: 90, inAir: false, slowing: false,
    hit: {}, phase: 0, sparkTimer: 10, crateTick: 0
  });

  game.step();
  assert.equal(p1.fireState.name, 'FIRE_LEVEL_1', 'the pool ignites the fighter at level 1');
  // the bite lands late in the step (players update first): exactly the 3 hit
  assert.ok(
    Math.abs(p1.hp - (hp0 - 3)) < 0.02,
    'the ember bite is 3 on the ignition step (hp=' + p1.hp + ')'
  );

  game.step();
  assert.equal(p1.fireState.name, 'FIRE_LEVEL_1', 'the burn keeps ticking its own clock');
  assert.ok(
    Math.abs(p1.hp - (hp0 - 3.08)) < 0.02,
    'the next step adds ONLY the L1 burn tick, the ember hits once (hp=' + p1.hp + ')'
  );
});

test('the Matrix dodge holds the pool ignition back, not the ember itself', () => {
  const { game } = createGameWithFloor();
  const p2 = game.players[1];

  game.groundFire.length = 0;
  game.groundFire.push({
    x: p2.x + p2.w / 2, y: p2.y + p2.h / 2, vx: 0, vy: 0, size: 6,
    life: 90, maxLife: 90, inAir: false, slowing: false,
    hit: {}, phase: 0, sparkTimer: 10, crateTick: 0
  });

  p2.matrixDodgeTimer = 30;
  game.step();
  assert.equal(p2.fireState.name, 'NONE', 'the dodge arcs the embers past');
  p2.matrixDodgeTimer = 0;
  game.step();
  assert.equal(p2.fireState.name, 'FIRE_LEVEL_1', 'the pool lights him as soon as the shield drops');
});

test('the pool lights a crate that then burns down progressively and breaks, the spark puffs never light it', () => {
  const { game, floor } = createGameWithFloor();
  const crate = {
    x: 392, y: floor.y - 20, w: 20, h: 20,
    sx: 392, sy: floor.y - 20, vx: 0, vy: 0,
    hp: 20, angle: 0, spin: 0, resting: true, hp0: 20
  };
  game.crates.push(crate);
  game.groundFire.length = 0;
  game.groundFire.push({
    x: 402, y: floor.y - 2, vx: 0, vy: 0, size: 6,
    life: 90, maxLife: 90, inAir: false, slowing: false,
    hit: {}, phase: 0, sparkTimer: 1, crateTick: 0
  });

  game.step();
  assert.equal(crate.onFire, true, 'ember contact lights the crate');
  assert.ok(game.flames.length > 0, 'a landed ember breathes spark puffs');
  const sparks = game.flames.filter((fl) => fl.damage === 0);
  assert.ok(sparks.length > 0, 'the spark puffs are damage-less (visual-only)');

  game.groundFire.length = 0; // the pool is gone: the crate keeps burning alone
  const hpAfterIgnition = crate.hp;
  for (let step = 0; step < 20; step++) game.step();
  assert.ok(crate.hp < hpAfterIgnition, 'the fire eats the crate progressively');
  assert.ok(!crate.dead, 'still standing mid-burn');
  for (let step = 0; step < 120 && !crate.dead; step++) game.step();
  assert.equal(crate.dead, true, 'the burn ends with the crate broken');
});

test('a crate away from the fire never lights', () => {
  const { game, floor } = createGameWithFloor();
  const crate = {
    x: 100, y: floor.y - 20, w: 20, h: 20,
    sx: 100, sy: floor.y - 20, vx: 0, vy: 0,
    hp: 20, angle: 0, spin: 0, resting: true, hp0: 20
  };
  game.crates.push(crate);
  for (let step = 0; step < 30; step++) game.step();
  assert.ok(!crate.onFire);
  assert.equal(crate.hp, 20);
});

test('the fire pool bloom draws one additive save/restore per ember', () => {
  const { game, drawCalls } = createGameWithFloor();

  const countSaves = () => drawCalls.filter((c) => c.name === 'save').length;
  game.render();
  const savesBase = countSaves();
  drawCalls.length = 0; // each render is counted on its own window

  game.groundFire.push(
    { x: 300, y: 486, vx: 0, vy: 0, size: 6, life: 90, maxLife: 90, inAir: false, slowing: false, hit: {}, phase: 0, sparkTimer: 10, crateTick: 0 },
    { x: 320, y: 486, vx: 0, vy: 0, size: 6, life: 90, maxLife: 90, inAir: false, slowing: false, hit: {}, phase: 1, sparkTimer: 10, crateTick: 0 },
    { x: 340, y: 486, vx: 0, vy: 0, size: 6, life: 90, maxLife: 90, inAir: false, slowing: false, hit: {}, phase: 2, sparkTimer: 10, crateTick: 0 }
  );

  game.render();
  assert.equal(countSaves(), savesBase + 3, 'one save/restore pair per ember, nothing nested');
});

test('a round restart clears the fire pool with the rest of the FX', () => {
  const { game } = createGameWithFloor();
  groundPlayer(game.players[0], 60, 470);
  groundPlayer(game.players[1], 720, 470);
  game.explodeAt(400, 480, 60, 40, 10);
  assert.ok(game.groundFire.length > 0, 'the pool lives before the restart');

  game.restartRound();
  assert.equal(game.groundFire.length, 0, 'the fire splash goes out with the round');
});

test('a bazooka rocket blast never leaves fire behind', () => {
  const { game } = createGameWithFloor();
  groundPlayer(game.players[0], 60, 470);
  groundPlayer(game.players[1], 720, 470);

  game.explodeRocket(400, 470);

  assert.equal(game.explosions.length, 1, 'the blast ring still shows');
  assert.equal(game.groundFire.length, 0, 'no embers, no fire pool');
});
