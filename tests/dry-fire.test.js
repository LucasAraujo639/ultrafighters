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

function aimWithEmptyGun(shape) {
  const { game, listeners } = createGame();
  game.botActive = false;
  const p = game.players[0];
  p.ranged = { gun: game.guns[shape], ammo: 0 };
  key(listeners, 'keydown', p.binding.fire);
  for (let i = 0; i < 30; i++) game.step();
  return { game, listeners, p };
}

test('an empty gun stays equipped and aimed while the trigger is held', () => {
  const { game, p } = aimWithEmptyGun('pistol');
  for (let i = 0; i < 30; i++) game.step();
  assert.equal(p.aiming, true);
  assert.ok(p.ranged, 'gun still in hand');
});

test('releasing with an empty gun fires no bullet and discards the gun', () => {
  const { game, listeners, p } = aimWithEmptyGun('shotgun');
  const bulletsBefore = game.bullets ? game.bullets.length : 0;
  key(listeners, 'keyup', p.binding.fire);
  game.step();
  assert.equal(game.bullets ? game.bullets.length : 0, bulletsBefore, 'no projectile');
  assert.ok(!p.ranged || p.ranged.gun !== game.guns.shotgun, 'gun discarded on release');
  assert.ok(game.weaponItems.some((it) => it.weapon === game.guns.shotgun && it.ammo === 0), 'empty gun tossed as a world item');
});

test('the last shot leaves the empty gun aimed instead of tossing it', () => {
  const { game, listeners } = createGame();
  game.botActive = false;
  const p = game.players[0];
  p.ranged = { gun: game.guns.pistol, ammo: 1 };
  key(listeners, 'keydown', p.binding.fire);
  for (let i = 0; i < 30; i++) game.step();
  key(listeners, 'keyup', p.binding.fire);
  game.step();
  assert.equal(p.ranged.ammo, 0);
  assert.ok(p.ranged, 'empty gun kept after the last shot');
  assert.equal(p.aiming, true);
});

test('each trigger pull on an empty gun flinches and fires nothing', () => {
  const { game, listeners } = createGame();
  game.botActive = false;
  const p = game.players[0];
  p.ranged = { gun: game.guns.pistol, ammo: 0 };
  const bulletsBefore = game.bullets ? game.bullets.length : 0;
  key(listeners, 'keydown', p.binding.fire);
  game.step();
  assert.ok(p.dryFireKickTimer > 0 || p.dryFireKickAmount() > 0, 'flinch started');
  for (let i = 0; i < 20; i++) game.step();
  assert.equal(p.dryFireKickAmount(), 0, 'flinch settles');
  assert.equal(game.bullets ? game.bullets.length : 0, bulletsBefore);
  assert.ok(p.ranged, 'gun kept while the trigger is held');
});
