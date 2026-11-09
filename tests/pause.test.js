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
  return { game, listeners, fills, getNextFrame: () => nextFrame };
}

function keyDown(listeners, code) {
  listeners.keydown({ code, repeat: false, preventDefault: noop });
}

function keyDownRepeat(listeners, code) {
  listeners.keydown({ code, repeat: true, preventDefault: noop });
}

function keyUp(listeners, code) {
  listeners.keyup({ code, preventDefault: noop });
}

test('KeyP freezes the simulation until pressed again', () => {
  const { game, listeners } = createGame();

  // Settle the sim once so spawn physics stop masking the freeze check.
  game.step();
  const pausedX = game.players[0].x;
  const pausedY = game.players[0].y;

  keyDown(listeners, 'KeyP');
  game.step();
  assert.equal(game.paused, true);

  // While frozen, a held run key must not advance anyone (10 settled steps).
  keyDown(listeners, 'ArrowRight');
  for (let i = 0; i < 10; i++) game.step();
  assert.equal(game.players[0].x, pausedX);
  assert.equal(game.players[0].y, pausedY);

  // The same physical key resumes the sim and running continues.
  keyUp(listeners, 'KeyP');
  keyDown(listeners, 'KeyP');
  game.step();
  assert.equal(game.paused, false);
  for (let i = 0; i < 10; i++) game.step();
  assert.notEqual(game.players[0].x, pausedX);
});

test('PAUSED overlay text appears while frozen and disappears on resume', () => {
  const { game, listeners, fills } = createGame();

  game.render();
  assert.equal(fills.includes('PAUSED'), false);

  keyDown(listeners, 'KeyP');
  game.step();
  fills.length = 0;
  game.render();
  assert.equal(fills.includes('PAUSED'), true);

  keyUp(listeners, 'KeyP');
  keyDown(listeners, 'KeyP');
  game.step();
  fills.length = 0;
  game.render();
  assert.equal(fills.includes('PAUSED'), false);
});

test('held KeyP auto-repeat flips the pause only once per physical press', () => {
  const { game, listeners } = createGame();

  game.step(); // settle
  keyDown(listeners, 'KeyP');
  keyDownRepeat(listeners, 'KeyP');
  keyDownRepeat(listeners, 'KeyP');
  game.step();
  assert.equal(game.paused, true);
  game.step(); // repeats must not toggle back while the key is held
  assert.equal(game.paused, true);
});
