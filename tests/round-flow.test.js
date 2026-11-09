'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const flowApi = require('../src/round-flow.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
const noop = () => {};
const { ROUND_PHASE, ROUND_EVENT } = flowApi;
const FPS = 60;
const SLOWMO_STEPS = flowApi.ROUND_END_SLOWMO_SECONDS * FPS;

// ---------- pure state machine ----------

function step(flow, player1Dead, player2Dead, continuePressed) {
  return flowApi.stepRoundFlow(flow, { player1Dead, player2Dead, continuePressed: !!continuePressed, slowmoSteps: 3 });
}

test('round flow: playing -> slow motion -> awaiting continue -> restart, one event per transition', () => {
  const flow = flowApi.createRoundFlow();
  assert.equal(step(flow, false, false), ROUND_EVENT.NONE);
  assert.equal(flow.phase, ROUND_PHASE.PLAYING);
  assert.equal(step(flow, true, false), ROUND_EVENT.START_SLOWMO);
  assert.equal(flow.phase, ROUND_PHASE.SLOWMO);
  assert.equal(flow.winnerId, 2);
  assert.equal(step(flow, true, false, true), ROUND_EVENT.NONE, 'continue is ignored during the slow motion');
  assert.equal(step(flow, true, false), ROUND_EVENT.NONE);
  assert.equal(step(flow, true, false), ROUND_EVENT.END_SLOWMO, 'slow motion lasts exactly slowmoSteps');
  assert.equal(flow.phase, ROUND_PHASE.AWAITING_CONTINUE);
  for (let wait = 0; wait < 1000; wait++) assert.equal(step(flow, true, false), ROUND_EVENT.NONE, 'never advances on its own');
  assert.equal(step(flow, true, false, true), ROUND_EVENT.RESTART);
});

test('round flow: a second death inside the slow motion is simultaneous (draw); after it the result is final', () => {
  const late = flowApi.createRoundFlow();
  step(late, false, true);
  assert.equal(late.winnerId, 1);
  step(late, true, true);
  assert.equal(late.winnerId, flowApi.DRAW_WINNER_ID, 'both down within the window: draw');

  const final = flowApi.createRoundFlow();
  step(final, false, true);
  for (let s = 0; s < 3; s++) step(final, false, true);
  assert.equal(final.phase, ROUND_PHASE.AWAITING_CONTINUE);
  step(final, true, true);
  assert.equal(final.winnerId, 1, 'the winner stays the winner once the result is shown');

  const both = flowApi.createRoundFlow();
  step(both, true, true);
  assert.equal(both.winnerId, flowApi.DRAW_WINNER_ID);
});

test('round flow: the banner only shows once the slow motion is over', () => {
  const flow = flowApi.createRoundFlow();
  assert.equal(flowApi.isRoundOver(flow), false);
  step(flow, true, false);
  assert.equal(flowApi.isRoundOver(flow), true);
  assert.equal(flowApi.showsResult(flow), false);
  for (let s = 0; s < 3; s++) step(flow, true, false);
  assert.equal(flowApi.showsResult(flow), true);
});

// ---------- in game ----------

function createGame() {
  const listeners = {};
  const gradient = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    { get: (t, k) => (k in t ? t[k] : noop), set() { return true; } });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const window = { addEventListener(type, cb) { listeners[type] = cb; }, requestAnimationFrame: noop };
  vm.runInNewContext(src, {
    window,
    SuperfightersRoundFlow: flowApi,
    document: { getElementById: () => canvas },
    performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  }, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  for (const item of game.weaponItems) item.taken = true;
  return { game, listeners };
}
const keyDown = (listeners, code) => listeners.keydown({ code, repeat: false, preventDefault: noop });
const keyUp = (listeners, code) => listeners.keyup({ code, preventDefault: noop });

function killPlayer1AndWaitOutTheSlowmo(game) {
  for (let s = 0; s < 10; s++) game.step();
  game.players[0].hp = 0;
  game.step();
  assert.equal(game.roundPhase, ROUND_PHASE.SLOWMO);
  let slowest = 1;
  for (let s = 1; s < SLOWMO_STEPS; s++) { game.step(); slowest = Math.min(slowest, game.gameSpeed); }
  return slowest;
}

test('in game: 3 s of slow motion, then normal speed at once with the result and the Space prompt', () => {
  const { game } = createGame();
  const slowest = killPlayer1AndWaitOutTheSlowmo(game);
  assert.ok(slowest < 0.5, 'the death slow motion ran (' + slowest + ')');
  assert.equal(game.roundPhase, ROUND_PHASE.SLOWMO, 'still slow one step before the 3 s mark');
  game.step();
  assert.equal(game.roundPhase, ROUND_PHASE.AWAITING_CONTINUE);
  assert.equal(game.gameSpeed, 1, 'speed restored immediately, no ramp');
  assert.equal(game.roundResultText, 'PLAYER 2 WINS');
});

test('in game: the round never advances on its own, the survivor moves freely, and Space loads the next round', () => {
  const { game, listeners } = createGame();
  killPlayer1AndWaitOutTheSlowmo(game);
  game.step();
  for (let s = 0; s < 600; s++) game.step(); // 10 s: the legacy flow would have restarted long ago
  assert.equal(game.roundPhase, ROUND_PHASE.AWAITING_CONTINUE);
  assert.ok(game.roundOver, 'still waiting');

  const survivor = game.players[1];
  const startX = survivor.x;
  keyDown(listeners, 'ArrowLeft');
  for (let s = 0; s < 30; s++) game.step();
  keyUp(listeners, 'ArrowLeft');
  assert.ok(Math.abs(survivor.x - startX) > 5, 'the survivor walks around (' + (survivor.x - startX).toFixed(1) + ' px)');

  keyDown(listeners, 'Space');
  game.step();
  keyUp(listeners, 'Space');
  assert.equal(game.roundOver, null, 'next round');
  assert.equal(game.roundPhase, ROUND_PHASE.PLAYING);
  assert.equal(game.players[0].hp, 100, 'the loser is back');
  assert.equal(game.gameSpeed, 1);
});

test('in game: Space during the slow motion does not skip it', () => {
  const { game, listeners } = createGame();
  for (let s = 0; s < 10; s++) game.step();
  game.players[0].hp = 0;
  game.step();
  keyDown(listeners, 'Space');
  game.step();
  keyUp(listeners, 'Space');
  for (let s = 0; s < 20; s++) game.step();
  assert.equal(game.roundPhase, ROUND_PHASE.SLOWMO);
});

test('in game: a double kill reads DRAW', () => {
  const { game } = createGame();
  for (let s = 0; s < 10; s++) game.step();
  game.players[0].hp = 0;
  game.players[1].hp = 0;
  for (let s = 0; s <= SLOWMO_STEPS; s++) game.step();
  assert.equal(game.roundPhase, ROUND_PHASE.AWAITING_CONTINUE);
  assert.equal(game.roundOver.winnerId, 0);
  assert.equal(game.roundResultText, 'DRAW');
});
