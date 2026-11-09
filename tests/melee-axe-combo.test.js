'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};

// Synchronous Image stub (fires onload on src assignment): same contract as
// sprite-attack.test.js — spriteReady is true by the end of the module body.
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

// Recording context: tracks every canvas op plus the scale(-1) state inside
// the current save frame (mirrored drawing indicator).
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
      translate: function (x, y) { drawCalls.push({ name: 'translate', args: [x, y], flipped }); },
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
    punchComboNr: 1,
    hp: 100
  });
  player.lastDirX = 1;
}

function lastTraceDraw(drawCalls, img) {
  const idx = drawCalls.reduce(
    (found, c, i) => (c.name === 'drawImage' && c.args[0] === img ? i : found),
    -1
  );
  return idx >= 0 ? { call: drawCalls[idx], before: drawCalls.slice(0, idx) } : null;
}

function approx(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 0.01,
    `${label}: ${actual} != ${expected}`
  );
}

test('axe trace spawns at the fighter symbol origin (center-x on the feet line)', () => {
  const { game } = createGame();
  const p1 = game.players[0];
  groundPlayer(p1, 100, 100);

  p1.equipped = game.weapons.axe;
  p1.punchComboNr = 1;
  p1.lastDirX = -1; // captured facing (left)
  p1.startMeleeTrace();

  assert.equal(p1.meleeTrace.shape, 750);
  assert.equal(p1.meleeTrace.dir, -1);
  approx(p1.meleeTrace.x, p1.x + p1.w / 2, 'trace x = fighter center axis');
  assert.equal(p1.meleeTrace.y, p1.y + p1.h, 'trace y = feet line');
  assert.equal(p1.meleeTrace.clock, 0);
});

test('axe trace draws hinged on the fighter axis, mirrored about it when facing left', () => {
  const { game, drawCalls } = createGame();
  const p1 = game.players[0];
  const p2 = game.players[1];
  groundPlayer(p1, 120, 120);
  const k = p1.h / 21;

  // Right facing: origin at the captured axis, art hangs off its reg point
  const capturedX = p1.x + p1.w / 2;
  const capturedY = p1.y + p1.h;
  p1.meleeTrace = { shape: 750, dir: 1, x: capturedX, y: capturedY, clock: 0 };
  p1.update(p2);
  game.render();
  let hit = lastTraceDraw(drawCalls, game.spriteImages[750]);
  assert.ok(hit, 'trace drawImage present');
  assert.equal(hit.call.flipped, false);
  const tIdx = hit.before.reduce(
    (found, c, i) => (c.name === 'translate' ? i : found),
    -1
  );
  const tr = drawCalls[tIdx];
  assert.equal(tr.name, 'translate');
  approx(tr.args[0], capturedX, 'translate x = captured center axis');
  approx(tr.args[1], capturedY, 'translate y = captured feet line');
  approx(hit.call.args[1], -13 * k, 'trace reg ox applied');
  approx(hit.call.args[2], -16 * k, 'trace reg oy applied');

  // Left facing: SAME pivot, same art args — only the scale(-1) flips, so the
  // arc is the true reflection about the fighter axis (no sideways slide).
  drawCalls.length = 0;
  p1.meleeTrace = { shape: 750, dir: -1, x: capturedX, y: capturedY, clock: 0 };
  p1.update(p2);
  game.render();
  hit = lastTraceDraw(drawCalls, game.spriteImages[750]);
  assert.ok(hit, 'mirrored trace drawImage present');
  assert.equal(hit.call.flipped, true, 'captured left facing flips the trace');
  const tIdx2 = hit.before.reduce(
    (found, c, i) => (c.name === 'translate' ? i : found),
    -1
  );
  const tr2 = drawCalls[tIdx2];
  approx(tr2.args[0], capturedX, 'mirrored pivot stays on the axis');
  approx(tr2.args[1], capturedY, 'mirrored pivot stays on the feet line');
  approx(hit.call.args[1], -13 * k, 'mirrored trace reg ox unchanged');
  approx(hit.call.args[2], -16 * k, 'mirrored trace reg oy unchanged');
});

test('weapon swing cells re-anchor the fighter torso across combo links', () => {
  const { game, drawCalls } = createGame();
  const p1 = game.players[0];
  groundPlayer(p1, 100, 100);
  k_p1 = p1.h / 21;
  var k_p1; // hoisted

  p1.equipped = game.weapons.axe;
  p1.punching = true;
  p1.punchFrame = 16; // past link-1's first cell hold -> the strike cell 645
  game.render();

  let hit = lastTraceDraw(drawCalls, game.spriteImages[645]);
  assert.ok(hit, 'axe strike cell drawn');
  assert.equal(hit.call.flipped, false, 'right-facing cell unflipped');
  approx(hit.call.args[1], -(15.5 - 0.5) * k_p1, 'cell 645 torso bx anchored');
  approx(hit.call.args[2], -(19 + 2) * k_p1, 'cell 645 feet row anchored');

  // Mirrored side: same art args, flipped transform
  drawCalls.length = 0;
  p1.lastDirX = -1;
  game.render();
  hit = lastTraceDraw(drawCalls, game.spriteImages[645]);
  assert.ok(hit, 'mirrored axe strike cell drawn');
  assert.equal(hit.call.flipped, true, 'left-facing cell flipped');
  approx(hit.call.args[1], -(15.5 - 0.5) * k_p1, 'mirrored cell keeps the anchor');
  approx(hit.call.args[2], -(19 + 2) * k_p1, 'mirrored cell keeps the feet row');

  // Fists cells keep the centered/cell-bottom draw (no anchor table entry)
  drawCalls.length = 0;
  p1.equipped = game.weapons.fists;
  p1.punchFrame = 0;
  game.render();
  hit = lastTraceDraw(drawCalls, game.spriteImages[627]);
  assert.ok(hit, 'fists punch cell drawn');
  approx(hit.call.args[1], -(game.spriteImages[627].naturalWidth / 2) * k_p1, 'fists cell stays centered');
});

test('weapon combo links replay MELEE_ANIM_SLOW slower than the punch', () => {
  const { game } = createGame();
  const [p1, p2] = game.players;
  groundPlayer(p1, 100, 100);

  // Baseline: fists link length (port cadence: PUNCH anim ~12 artifact
  // frames * 2.5 steps = 30 steps per link)
  p1.punching = true;
  p1.punchFrame = 0;
  let fistsSteps = 0;
  while (p1.punching && fistsSteps < 100) {
    p1.update(p2);
    fistsSteps++;
  }
  assert.equal(fistsSteps, 30, 'fists link still ends at the vanilla 30 steps');

  // Axe link stretches to 30 * 1.5 = 45 steps
  p1.equipped = game.weapons.axe;
  p1.punching = true;
  p1.punchFrame = 0;
  let axeSteps = 0;
  while (p1.punching && axeSteps < 100) {
    p1.update(p2);
    axeSteps++;
  }
  assert.equal(axeSteps, 45, 'axe link 1 ends at 45 steps (30 * 1.5)');

  // Machete and sword share the stretched cadence
  for (const shape of ['machete', 'sword']) {
    const p = game.players[0];
    p.equipped = game.weapons[shape];
    p.punching = true;
    p.punchFrame = 0;
    let steps = 0;
    while (p.punching && steps < 100) {
      p.update(p2);
      steps++;
    }
    assert.equal(steps, 45, `${shape} link 1 ends at 45 steps`);
  }
});

test('slash trace fires at the stretched hit frame, once per link', () => {
  const { game } = createGame();
  const [p1, p2] = game.players;
  groundPlayer(p1, 100, 100);

  p1.equipped = game.weapons.axe;
  p1.punching = true;
  p1.punchFrame = 0;
  // Hit frame: link 1 hits at step 10, stretched x1.5 -> 15
  for (let i = 0; i < 14; i++) p1.update(p2);
  assert.equal(p1.meleeTrace, null, 'no trace before the hit frame');
  p1.update(p2);
  assert.ok(p1.meleeTrace, 'axe trace spawned at the stretched hit frame');
  assert.equal(p1.meleeTrace.shape, 750);
});
