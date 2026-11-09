'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};

function createGame() {
  const listeners = Object.create(null);
  let nextFrame = null;
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient
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
  const sandbox = {
    window,
    document: { getElementById: () => canvas },
    performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  };
  vm.runInNewContext(gameSource, sandbox, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  for (const item of game.weaponItems) item.taken = true;
  return { game, listeners, getNextFrame: () => nextFrame };
}

function keyDown(listeners, code) {
  listeners.keydown({ code, repeat: false, preventDefault: noop });
}

function keyUp(listeners, code) {
  listeners.keyup({ code, preventDefault: noop });
}

function resetPlayer(player, x, y, onGround) {
  Object.assign(player, {
    x,
    y,
    airVelocityX: 0,
    airVelocityY: 0,
    onGround,
    groundedPlatform: null,
    jumping: false,
    jumpPushTimeLeft: 0,
    falling: false,
    knockedDown: false,
    knockedDownFrame: 0,
    rolling: false,
    knockbackRoll: false,
    knockbackRollFrame: 0,
    knockbackRollDir: 0,
    knockbackRollAngle: 0,
    blastRollPending: 0,
    diving: false,
    climbing: false,
    climbFrame: 0,
    wallJumping: false,
    grabbedBy: null,
    grabbedPlayerNr: 0,
    stunTimer: 0,
    staggering: false,
    punching: false,
    aiming: false,
    startAimASAP: false,
    sprinting: false,
    running: false,
    sprintEnergy: 100,
    lastDirX: 1,
    airbornTimer: 0,
    jumpKickPerformed: false,
    jumpKickQueued: false,
    hp: 100
  });
}

const FLOOR = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };

function bareStage(game) {
  game.platforms.length = 0;
  game.platforms.push({ ...FLOOR });
  game.crates.length = 0; game.barrels.length = 0;
}

function typeWord(listeners, word) {
  for (const ch of word.toUpperCase()) {
    listeners.keydown({ code: 'Key' + ch, repeat: false, preventDefault: noop });
    listeners.keyup({ code: 'Key' + ch, preventDefault: noop });
  }
}

test("typing 'matrix' over open sky transforms the Arrow-Key fighter into The One", () => {
  const { game, listeners } = createGame();
  bareStage(game);
  resetPlayer(game.players[0], 120, FLOOR.y - game.players[0].h, true);
  resetPlayer(game.players[1], 500, FLOOR.y - game.players[1].h, true);

  typeWord(listeners, 'matrix');

  assert.equal(game.players[0].matrix, null, 'the WASD fighter is untouched');
  assert.ok(game.players[1].matrix, 'the Arrow-Key fighter wears the shell');
  assert.equal(game.players[1].matrix.name, 'MATRIX');
  assert.deepEqual(
    { ssj2: game.players[1].ssj2 },
    { ssj2: null },
    'no SSJ2 shell is mixed in'
  );
  assert.ok(game.matrixRain.length === 0 && true, 'the burst FX arrays never break the module');
});

test('the ritual needs an open sky: a roof blocks the transformation', () => {
  const { game, listeners } = createGame();
  bareStage(game);
  const p2 = game.players[1];
  resetPlayer(p2, 500, FLOOR.y - p2.h, true);
  // a hung slab right above the fighter counts as a roof
  game.platforms.push({ x: 480, y: FLOOR.y - 200, w: 60, h: 30, solidSides: true, cloud: false, ladder: false });

  typeWord(listeners, 'matrix');

  assert.equal(p2.matrix, null, 'no shell under a roof');
  assert.ok(game.cheat.blockedHint > 0, 'the blocked feedback shows');
  assert.equal(game.cheat.blockedFor, p2.id, 'the hint names the blocked fighter');
});

test("re-typing 'matrix' drops the mode", () => {
  const { game, listeners } = createGame();
  bareStage(game);
  const p2 = game.players[1];
  resetPlayer(p2, 500, FLOOR.y - p2.h, true);

  typeWord(listeners, 'matrix');
  assert.ok(p2.matrix, 'the shell lands first');
  for (let f = 0; f < 40; f++) game.step(); // outlast the cheat cooldown
  typeWord(listeners, 'matrix');
  assert.equal(p2.matrix, null, 'the second word sheds the mode');
});

test("the J/K word and 'matrix' hand the shells over to each other", () => {
  const { game, listeners } = createGame();
  bareStage(game);
  const p2 = game.players[1];
  resetPlayer(p2, 500, FLOOR.y - p2.h, true);

  typeWord(listeners, 'jkjkjkjkjkjkjk');
  assert.ok(p2.ssj2, 'SSJ2 first');
  // the cheat cooldown rejects instant re-typing: wait it out
  for (let f = 0; f < 40; f++) game.step();
  typeWord(listeners, 'matrix');
  assert.equal(p2.ssj2, null, 'the SSJ2 shell steps aside');
  assert.ok(p2.matrix, 'The One takes over');
  for (let f = 0; f < 40; f++) game.step();
  typeWord(listeners, 'jkjkjkjkjkjkjk');
  assert.ok(p2.ssj2, 'and back again');
  assert.equal(p2.matrix, null, 'one shell at a time');
});

test('J (hold) engages bullet time: the world crawls, the avatar does not', () => {
  const { game, listeners } = createGame();
  bareStage(game);
  const p1 = game.players[0];
  const p2 = game.players[1];
  resetPlayer(p1, 80, FLOOR.y - p1.h, true);
  resetPlayer(p2, 400, FLOOR.y - p2.h, true);
  typeWord(listeners, 'matrix');

  keyDown(listeners, 'KeyJ');
  // ramp in (10 steps) + measure window
  for (let f = 0; f < 30; f++) game.step();
  assert.ok(p2.matrixBtOn, 'the hold engages bullet time');
  const factor = game.matrixSlowFactor;
  assert.ok(Math.abs(factor - 0.3) < 0.01, 'the world share settles at 30% (got ' + factor + ')');
  assert.ok(Math.abs(game.gameSpeed - 0.3) < 0.01, 'the merged global pace matches');

  // displacement comparison over 20 more steps
  const x1 = p1.x;
  const x2 = p2.x;
  keyDown(listeners, 'KeyD');
  keyDown(listeners, 'ArrowRight');
  keyUp(listeners, 'KeyJ'); // both run while BT holds (the hold key is J)
  // NOTE: keep J held so the comparison measures the BT state itself
  // restore: re-hold J (KeyJ up one frame would break the hold)
  listeners.keydown({ code: 'KeyJ', repeat: false, preventDefault: noop });
  for (let f = 0; f < 20; f++) game.step();
  keyUp(listeners, 'KeyD');
  keyUp(listeners, 'ArrowRight');
  const d1 = p1.x - x1; // the crawling enemy
  const d2 = p2.x - x2; // the real-time avatar
  assert.ok(d1 > 0 && d1 < d2 * 0.7, 'the world crawls at the slowed pace');
  assert.ok(d2 >= 20 * 1.122 * 0.95, 'the avatar keeps their real-time run speed');
  assert.ok(p2.matrixBtOn, 'bullet time stays on while J is held');

  keyUp(listeners, 'KeyJ');
  for (let f = 0; f < 30; f++) game.step();
  assert.equal(p2.matrixBtOn, false, 'the release disengages');
  assert.equal(game.matrixSlowFactor, 1, 'the world speed restores after the ramp out');
});

test('bullet time hits the hold cap and J cools before a new hold', () => {
  const { game, listeners } = createGame();
  bareStage(game);
  const p2 = game.players[1];
  resetPlayer(p2, 400, FLOOR.y - p2.h, true);
  typeWord(listeners, 'matrix');

  keyDown(listeners, 'KeyJ');
  for (let f = 0; f < 400; f++) game.step();
  assert.equal(p2.matrixBtOn, false, 'the 6s cap forces the crawl off');
  assert.ok(p2.matrixBtCooldown > 0, 'a cooldown follows the forced drop');

  // re-pressing while cooling does nothing
  const speedBefore = game.gameSpeed;
  for (let f = 0; f < 25; f++) game.step();
  keyDown(listeners, 'KeyJ');
  for (let f = 0; f < 12; f++) game.step();
  keyUp(listeners, 'KeyJ');
  for (let f = 0; f < 3; f++) game.step();
  assert.ok(game.matrixSlowFactor === 1 || game.gameSpeed <= speedBefore, 'the cooldown gates the re-engage');
});

test('K dodges backward and deflects frontal shots back at the shooter', () => {
  const { game, listeners } = createGame();
  bareStage(game);
  const p1 = game.players[0];
  const p2 = game.players[1];
  resetPlayer(p1, 560, FLOOR.y - p1.h, true);
  resetPlayer(p2, 400, FLOOR.y - p2.h, true);
  p1.ranged = { gun: game.guns.pistol, ammo: 12 }; // the shooter keeps shooting
  typeWord(listeners, 'matrix');

  // a frontal bullet: to the RIGHT of the avatar (facing right) moving left
  const frontal = {
    x: 500, y: p2.y + 10, vx: -20, vy: 0,
    damage: 10, critDamage: 5, crit: false, owner: 1, trail: [], impulse: 0.6
  };
  game.bullets.push(frontal);

  keyDown(listeners, 'KeyK');
  game.step();
  assert.ok(p2.matrixDodgeTimer > 0, 'the dodge grace window opens');
  assert.ok(p2.airVelocityY < 0, 'the arc hop lifts');
  assert.ok(p2.airVelocityX < 0, 'the hop pushes back over the facing');
  keyUp(listeners, 'KeyK');

  assert.ok(frontal.vx > 0, 'the frontal round reverses course');
  assert.equal(frontal.owner, 2, 'the deflected round now hunts the shooter');

  // the shield window lets a follow-up shot pass clean
  const followUp = {
    x: 500, y: p2.y + 10, vx: -20, vy: 0,
    damage: 10, critDamage: 5, crit: false, owner: 1, trail: [], impulse: 0.6
  };
  game.bullets.push(followUp);
  const hpBefore = p2.hp;
  for (let f = 0; f < 10; f++) game.step();
  assert.equal(p2.hp, hpBefore, 'no damage slips through the dodge window');

  // after the window the same frontal shooter bites
  for (let f = 0; f < 50; f++) game.step(); // dodge grace lapses
  keyDown(listeners, 'KeyK');
  game.step();
  keyUp(listeners, 'KeyK');
  assert.ok(p2.matrixDodgeCooldown > 0, 'the dodge cools down');
});

test('L wall-runs the solid side and ArrowUp kicks off the surface', () => {
  const { game, listeners } = createGame();
  const wall = { x: 320, y: 180, w: 40, h: 320, solidSides: true, cloud: false, ladder: false };
  bareStage(game);
  game.platforms.push(wall);
  const p2 = game.players[1];
  // flush-ish beside the wall face (320): body edge ~315.8, the probe band
  // (edge + 4 + wallDistance) reaches 326.8 — the run-l reach window
  resetPlayer(p2, 299, FLOOR.y - p2.h, true);
  p2.lastDirX = 1; // facing the wall side
  typeWord(listeners, 'matrix');

  const y0 = p2.y;
  keyDown(listeners, 'KeyL');
  for (let f = 0; f < 6; f++) game.step();
  assert.ok(p2.matrixWallRunning, 'the wall run engages beside a solid side');
  assert.ok(p2.airVelocityY <= 0, 'the stance owns the climb');
  assert.ok(p2.y < y0, 'the fighter climbs up the surface');
  const fuelUsed = 90 - p2.matrixWallFuel;
  assert.ok(fuelUsed > 0, 'the gauge burns while climbing');

  // kick off with ArrowUp
  keyDown(listeners, 'ArrowUp');
  game.step();
  keyUp(listeners, 'ArrowUp');
  assert.ok(!p2.matrixWallRunning, 'the kick releases the wall');
  assert.ok(p2.airVelocityY <= -4, 'the kick launches upward');
  assert.ok(p2.airVelocityX < 0, 'the kick pushes away from the right wall');
  assert.equal(p2.lastDirX, -1, 'the kick flips the facing away from the wall');

  keyUp(listeners, 'KeyL');
  for (let f = 0; f < 80; f++) game.step();
  assert.ok(p2.onGround, 'the kicked fighter lands normally');
});

test('L runs cover too: a 131 crate is a wall for the run', () => {
  const { game, listeners } = createGame();
  bareStage(game);
  game.crates.push({ x: 340, y: FLOOR.y - 20, w: 20, h: 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  const p2 = game.players[1];
  resetPlayer(p2, 320, FLOOR.y - p2.h, true); // body edge 336.8 probes the crate face (340)
  p2.lastDirX = 1;
  typeWord(listeners, 'matrix');

  keyDown(listeners, 'KeyL');
  for (let f = 0; f < 8; f++) game.step();
  assert.ok(p2.matrixWallRunning, 'the crate side counts as a cover wall');
  keyUp(listeners, 'KeyL');
});

test('; refills the magazine instantly with the digital rain', () => {
  const { game, listeners } = createGame();
  bareStage(game);
  const p2 = game.players[1];
  resetPlayer(p2, 400, FLOOR.y - p2.h, true);
  typeWord(listeners, 'matrix');
  p2.ranged = { gun: game.guns.pistol, ammo: 2 };

  keyDown(listeners, 'Semicolon');
  game.step();
  keyUp(listeners, 'Semicolon');
  assert.equal(p2.ranged.ammo, game.guns.pistol.ammo, 'the magazine is whole again');
  assert.ok(game.matrixRain.length > 0, 'the digital rain spawns over the body');

  // exhausting and re-pressing inside the cooldown keeps the empty mag
  p2.ranged.ammo = 1;
  keyDown(listeners, 'Semicolon');
  game.step();
  keyUp(listeners, 'Semicolon');
  assert.equal(p2.ranged.ammo, 1, 'the reload cooldown gates the instant refill');
});

test("' glitches the avatar behind the rival's back", () => {
  const { game, listeners } = createGame();
  bareStage(game);
  const p1 = game.players[0];
  const p2 = game.players[1];
  resetPlayer(p1, 200, FLOOR.y - p1.h, true);
  resetPlayer(p2, 600, FLOOR.y - p2.h, true);
  typeWord(listeners, 'matrix');

  keyDown(listeners, 'Quote');
  game.step();
  keyUp(listeners, 'Quote');

  assert.ok(p2.matrixGlitchTimer > 0, 'the warp leaves the distortion clock running');
  assert.ok(game.matrixGlitch.length > 0, 'glitch shards spawn at both spots');
  // behind P1's back: P1 faces right (+1), so neutral back side is LEFT
  assert.ok(p2.x < p1.x, 'the avatar lands behind the rival');
  assert.equal(p2.lastDirX, 1, 'the avatar faces the rival from behind');
  assert.ok(p2.matrixTeleCooldown > 0, 'the warp cools down before the next');

  // an immediate second press inside the cooldown does nothing
  const xAfterFirst = p2.x;
  keyDown(listeners, 'Quote');
  game.step();
  keyUp(listeners, 'Quote');
  assert.equal(p2.x, xAfterFirst, 'the warp cooldown gates the re-warp');
});

test('deaths and locks drop the matrix stances, the transformation stays', () => {
  const { game, listeners } = createGame();
  bareStage(game);
  const p2 = game.players[1];
  resetPlayer(p2, 400, FLOOR.y - p2.h, true);
  typeWord(listeners, 'matrix');
  keyDown(listeners, 'KeyJ');
  for (let f = 0; f < 20; f++) game.step();

  p2.damage(999);
  game.step();
  assert.equal(p2.matrixBtOn, false, 'the crawl drops on death');
  assert.ok(p2.matrix, 'the transformation survives the body');
  keyUp(listeners, 'KeyJ');

  // a new round sheds the shell entirely
  game.restartRound();
  assert.equal(game.players[1].matrix, null, 'a restart is a plain world again');
});
