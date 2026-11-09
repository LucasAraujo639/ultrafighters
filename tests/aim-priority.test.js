'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};
function createGame() {
  const listeners = Object.create(null);
  const g = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => g, createRadialGradient: () => g }, { get: (t, k) => (k in t ? t[k] : noop), set() { return true; } });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const window = { addEventListener: (t, cb) => { listeners[t] = cb; }, requestAnimationFrame: noop };
  vm.runInNewContext(src, { window, document: { getElementById: () => canvas }, performance: { now: () => 0 }, console: { log: noop, warn: noop, error: noop } }, { filename: 'src/game.js' });
  return { game: window.__sf, listeners };
}
const key = (l, type, code) => l[type]({ code, repeat: false, preventDefault: noop });

test('FIRE cancels a run immediately and aims', () => {
  const { game, listeners } = createGame();
  game.botActive = false;
  const p = game.players.find((q) => q === game.players[0]);
  p.ranged = { gun: game.guns.pistol, ammo: 12 };
  key(listeners, 'keydown', p.binding.right);
  for (let i = 0; i < 20; i++) game.step();
  key(listeners, 'keydown', p.binding.fire);
  game.step();
  assert.equal(p.aiming, true);
  assert.equal(p.running, false);
});

test('FIRE held in the air is buffered and aims on landing', () => {
  const { game, listeners } = createGame();
  game.botActive = false;
  const p = game.players.find((q) => q === game.players[0]);
  p.ranged = { gun: game.guns.pistol, ammo: 12 };
  p.onGround = false; p.y -= 60; p.airVelocityY = 0;
  key(listeners, 'keydown', p.binding.fire);
  game.step();
  assert.equal(p.aiming, false);
  for (let i = 0; i < 90 && !p.onGround; i++) game.step();
  game.step();
  assert.equal(p.aiming, true);
});
