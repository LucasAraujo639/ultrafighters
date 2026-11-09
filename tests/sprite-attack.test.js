'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};

// Synchronous Image stub: the sprite loader fires onload on src assignment so
// spriteReady turns true by the time the module body ends.
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

// Recording context: keeps one entry per canvas op. `flipped` is true when a
// scale(-1) has been applied inside the current canvas save frame, so a test
// can assert whether a given drawImage happened mirrored. Nested save frames
// are not modelled (the sprite path saves/restores linearly).
function createGame() {
  const listeners = Object.create(null);
  let nextFrame = null;
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
    requestAnimationFrame(callback) {
      nextFrame = callback;
    }
  };
  // The sprite map loads BEFORE game.js in the browser (index.html); the
  // sprite path needs the base cells or drawPlayerSprite falls back to the
  // procedural fighter and skips the trace overlay entirely.
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
  return { game, drawCalls, nextFrame: () => nextFrame };
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

// Counts the slash-trace drawImage calls for a given trace image, optionally
// requiring the mirrored scale(-1) state inside them.
function countTraceDraws(drawCalls, traceImg, expectFlipped) {
  return drawCalls.filter(
    (c) =>
      c.name === 'drawImage' &&
      c.args[0] === traceImg &&
      (expectFlipped === undefined || c.flipped === expectFlipped)
  ).length;
}

test('melee swing cells, slash traces and throw release cells load into the sprite cache', () => {
  const { game } = createGame();
  const expected = [
    // melee body cells (axe, sword, machete)
    645, 644, 651, 648, 653, 654, 657, 660, 636, 637, 639, 642,
    // slash traces (axe red, machete, sword)
    750, 753, 756, 759, 762, 765, 768, 771, 774,
    // throwable body cells: the shared release lean (699), the molotov aim
    // piece (703), the grenade aim arm (701) and the quick recovery end
    // frame (705)
    699, 701, 703, 705
  ];
  for (const n of expected) {
    const img = game.spriteImages[n];
    assert.ok(img, `sprite ${n} must load`);
    assert.ok(img.complete && img.naturalWidth > 0, `sprite ${n} must be ready`);
  }
});

test('melee weapon punch resolves the attack key for fists and every melee weapon', () => {
  const { game } = createGame();
  const p1 = game.players[0];
  groundPlayer(p1, 100, 100);

  // Idle baseline for a grounded unarmed fighter
  assert.equal(game.playerSpriteKey(p1), 'idle');

  // Punch state
  p1.punching = true;
  p1.punchFrame = 0;
  assert.equal(game.playerSpriteKey(p1), 'attack');

  // Every melee weapon owns three per-link swing clips (axe/sword/machete)
  for (const shape of ['axe', 'sword', 'machete']) {
    p1.equipped = game.weapons[shape];
    for (let comboNr = 1; comboNr <= 3; comboNr++) {
      p1.punchComboNr = comboNr;
      assert.equal(game.playerSpriteKey(p1), 'attack');
    }
  }
});

test('startMeleeTrace spawns one particle per weapon/link and clears by lifetime', () => {
  const { game } = createGame();
  const [p1, p2] = game.players;
  groundPlayer(p1, 100, 100);

  // Fists spawn nothing
  p1.startMeleeTrace();
  assert.equal(p1.meleeTrace, null, 'fists spawn no slash trace');

  // Sword link 2 trace, facing left: shape + captured facing
  p1.equipped = game.weapons.sword;
  p1.punchComboNr = 2;
  p1.lastDirX = -1;
  p1.startMeleeTrace();
  assert.ok(p1.meleeTrace, 'melee weapon must spawn a slash trace');
  assert.equal(p1.meleeTrace.shape, 771);
  assert.equal(p1.meleeTrace.dir, -1);
  assert.equal(p1.meleeTrace.clock, 0);

  // The particle lives MELEE_TRACE_LIFE update ticks scaled by the weapon
  // swing stretch (the shipped artifact ran both clips on the same
  // game_speed; stretched here: round(5 * 1.5) = 8 steps -> 7 draws)
  for (let i = 1; i <= 8; i++) p1.update(p2);
  assert.equal(p1.meleeTrace, null, 'slash trace must end after its lifetime');
});

test('slash trace renders mirrored (or not) exactly like the CAPTURED facing', () => {
  const { game, drawCalls } = createGame();
  const p1 = game.players[0];
  const p2 = game.players[1];
  groundPlayer(p1, 120, 120);

  // Facing LEFT captured while the live lastDirX stays right: only the trace
  // flips, proving the overlay uses the captured dir, not the live facing.
  p1.meleeTrace = { shape: 750, dir: -1, x: p1.x, y: p1.y, clock: 0 };
  p1.update(p2);
  game.render();
  assert.equal(countTraceDraws(drawCalls, game.spriteImages[750], true), 1, 'left-facing trace draws mirrored');

  // Facing RIGHT captured: same draw, no negation
  p1.meleeTrace = { shape: 750, dir: 1, x: p1.x, y: p1.y, clock: 0 };
  p1.update(p2);
  game.render();
  assert.equal(countTraceDraws(drawCalls, game.spriteImages[750], false), 1, 'right-facing trace draws unmirrored');
});

test('slash trace does not flicker: one particle, fixed lifetime, no cycle re-entry', () => {
  const { game, drawCalls } = createGame();
  const p1 = game.players[0];
  const p2 = game.players[1];
  groundPlayer(p1, 100, 100);
  p1.equipped = game.weapons.machete;
  p1.startMeleeTrace();
  assert.ok(p1.meleeTrace, 'machete trace spawned');

  // tick + render per step across two lifetimes: draws happen ONLY inside
  // the stretched trace-lifetime window (round(5 * 1.5) -> 7 draw steps) and
  // never again.
  let traceDraws = 0;
  for (let i = 0; i < 40; i++) {
    p1.update(p2);
    game.render();
    traceDraws += countTraceDraws(drawCalls, game.spriteImages[759]);
    drawCalls.length = 0;
  }
  assert.equal(traceDraws, 7, `exactly the stretched lifetime draws a frame (${traceDraws})`);
});

test('grenade release spawns the projectile at the release sprite hand', () => {
  const { game } = createGame();
  const p1 = game.players[0];
  groundPlayer(p1, 100, 100);

  p1.throwable = { ammo: 3, type: 'grenade' };
  p1.aiming = true;
  p1.aimMode = 1;
  p1.aimPitch = 0;
  p1.lastDirX = 1;

  p1.releaseThrowable();

  assert.equal(game.grenades.length, 1);
  const g = game.grenades[0];
  // Hand anchor in natural pose coords (1.5, 5.5). The 699 frame shows the
  // grenade at the hand tip with the standard facing mirror, so a right-facing
  // thrower releases from the hip line (mirrors the shipped stand-in model).
  const k = p1.h / 21;
  const sw = game.spriteImages[699].naturalWidth * k;
  const handX = p1.x + p1.w / 2 + (p1.lastDirX < 0 ? -1 : 1) * (1.5 * k - sw / 2);
  const handY = p1.y + p1.h - game.spriteImages[699].naturalHeight * k + 5.5 * k;
  assert.ok(Math.abs(g.x - handX) < 0.01, `grenade x ${g.x} != hand ${handX}`);
  assert.ok(Math.abs(g.y - handY) < 0.01, `grenade y ${g.y} != hand ${handY}`);

  // Release pose armed and typed
  assert.equal(p1.throwPose, 8);
  assert.equal(p1.throwPoseType, 'grenade');
  assert.equal(game.playerSpriteKey(p1), 'throwGrenade');
});

test('throw pose clock counts down through the update tick', () => {
  const { game } = createGame();
  const [p1, p2] = game.players;
  groundPlayer(p1, 100, 100);

  p1.throwPose = 8;
  p1.throwPoseType = 'grenade';
  p1.update(p2);
  assert.equal(p1.throwPose, 7);
  assert.equal(game.playerSpriteKey(p1), 'throwGrenade');
  for (let i = 0; i < 7; i++) p1.update(p2);
  assert.equal(p1.throwPose, 0);
  assert.notEqual(game.playerSpriteKey(p1), 'throwGrenade');
});

test('molotov release uses the molotov release frame', () => {
  const { game } = createGame();
  const p1 = game.players[0];
  groundPlayer(p1, 100, 100);

  p1.throwable = { ammo: 3, type: 'molotov' };
  p1.aiming = true;
  p1.aimMode = 1;
  p1.aimPitch = 0;
  p1.lastDirX = -1; // facing left: the hand anchor maps mirrored

  p1.releaseThrowable();

  assert.equal(game.grenades.length, 1);
  const g = game.grenades[0];
  assert.equal(g.type, 'molotov');
  // The molotov shares the 699 release lean with the grenade, so the mirrored
  // hand anchor (dir -1) uses the same (1.5, 5.5) grip point as the grenade
  // test, flipping to the opposite hip line
  const k = p1.h / 21;
  const sw = game.spriteImages[699].naturalWidth * k;
  const handX = p1.x + p1.w / 2 + (p1.lastDirX < 0 ? -1 : 1) * (1.5 * k - sw / 2);
  assert.ok(Math.abs(g.x - handX) < 0.01, `molotov x ${g.x} != hand ${handX}`);
  assert.equal(p1.throwPose, 8);
  assert.equal(p1.throwPoseType, 'molotov');
  assert.equal(game.playerSpriteKey(p1), 'throwMolotov');
});

test('a held molotov or grenade has a finite grip point and never spawns NaN flames', () => {
  const { game } = createGame();
  const p1 = game.players[0];
  groundPlayer(p1, 100, 100);
  for (const type of ['molotov', 'grenade']) {
    p1.throwable = { ammo: 3, type };
    p1.aiming = true;
    p1.aimMode = 1;
    p1.aimPitch = 20;
    const muzzle = p1.aimMuzzlePoint(1);
    assert.ok(muzzle && Number.isFinite(muzzle.x) && Number.isFinite(muzzle.y), type + ' grip point is finite');
  }
  p1.throwable = { ammo: 3, type: 'molotov' };
  for (let f = 0; f < 30; f++) { p1.update(game.players[1]); game.step(); }
  assert.equal(game.flames.length, 0, 'no flame is drawn on the held bottle');
  assert.ok(game.flames.every((fl) => Number.isFinite(fl.x) && Number.isFinite(fl.y)), 'every flame has a finite position');
});
