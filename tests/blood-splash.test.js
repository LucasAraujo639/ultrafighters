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


test('blood pixels splash on a wall and stay; the floor keeps only a few specks', () => {
  const { game } = createGame();
  game.platforms.length = 0;
  game.platforms.push({ x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false });
  game.platforms.push({ x: 300, y: 300, w: 40, h: 200, solidSides: true, cloud: false, ladder: false });
  for (const crate of game.crates) crate.dead = true;
  game.bloodPixels.length = 0;
  game.bloodWallStains.length = 0;
  for (let n = 0; n < 40; n++) game.spawnBloodHit(290, 400, 1); // shot toward the wall at x=300
  for (let frame = 0; frame < 60; frame++) game.step();
  assert.equal(game.bloodPixels.length, 0, 'every pixel ended (stain or vanished)');
  assert.ok(game.bloodWallStains.length > 0, 'some blood stays on the wall');
  assert.ok(game.bloodWallStains.length <= 200, 'the wall stains are capped');
  for (const st of game.bloodWallStains) assert.equal(st.x, 299, 'stuck flush against the wall face');
  for (let frame = 0; frame < 600; frame++) game.step();
  assert.ok(game.bloodWallStains.length > 0, 'wall blood never fades');
});

test('one shot at chest height over a floor leaves a visible handful of specks', () => {
  const { game } = createGame();
  game.platforms.length = 0;
  game.platforms.push({ x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false });
  game.bloodFloorStains.length = 0;
  game.spawnBloodHit(400, 480, 1);
  for (let frame = 0; frame < 120; frame++) game.step();
  assert.ok(game.bloodFloorStains.length >= 4, 'floor specks: ' + game.bloodFloorStains.length);
  assert.ok(game.bloodFloorStains.length <= 24, 'a single shot never makes a huge puddle');
});
