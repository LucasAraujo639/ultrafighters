'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const spawn = require('../src/spawn-director.js');

const noop = () => {};
const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');

function createGame({ devMode, withSpawnModule = true } = {}) {
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    { createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    { get: (t, k) => (k in t ? t[k] : noop), set: () => true }
  );
  const canvas = { width: 800, height: 600, getContext: () => context, addEventListener: noop };
  const store = devMode === undefined ? {} : { sf_dev_mode: devMode ? '1' : '0' };
  const window = {
    addEventListener: noop,
    requestAnimationFrame: noop,
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); }
    }
  };
  const sandbox = {
    window,
    document: { getElementById: () => canvas },
    performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  };
  if (withSpawnModule) sandbox.SuperfightersSpawn = spawn;
  vm.runInNewContext(gameSource, sandbox, { filename: 'src/game.js' });
  window.__sf.botActive = false;
  return { game: window.__sf, store };
}

test('weights mirror the original chance table (17 weapons, sum 73)', () => {
  const weights = Object.values(spawn.WEAPON_SPAWN_WEIGHTS);
  assert.equal(weights.length, 17);
  assert.equal(weights.reduce((a, b) => a + b, 0), 73);
});

test('original pacing: 3 s interval, 20 s life, 8 s blink at 60 Hz', () => {
  assert.equal(spawn.WEAPON_SPAWN_INTERVAL_STEPS, 180);
  assert.equal(spawn.WEAPON_DESPAWN_STEPS, 1200);
  assert.equal(spawn.WEAPON_BLINK_STEPS, 480);
});

test('spawner places one weapon per interval on FREE spots only', () => {
  const spots = [{ x: 1 }, { x: 2 }];
  const busy = new Set();
  const spawned = [];
  const spawner = spawn.createWeaponSpawner({
    spots,
    isSpotFree: (s) => !busy.has(s),
    spawnWeapon: (s, key) => { busy.add(s); spawned.push(key); },
    intervalSteps: 10
  });
  for (let i = 0; i < 9; i++) assert.equal(spawner.update(1), null);
  assert.ok(spawner.update(1));
  assert.equal(spawned.length, 1);
  for (let i = 0; i < 10; i++) spawner.update(1);
  assert.equal(spawned.length, 2);
  for (let i = 0; i < 30; i++) spawner.update(1); // all spots busy
  assert.equal(spawned.length, 2);
});

test('slow-mo stretches the spawn interval', () => {
  let count = 0;
  const spawner = spawn.createWeaponSpawner({
    spots: [{}], isSpotFree: () => true, spawnWeapon: () => count++, intervalSteps: 10
  });
  for (let i = 0; i < 10; i++) spawner.update(0.5);
  assert.equal(count, 0);
  for (let i = 0; i < 10; i++) spawner.update(0.5);
  assert.equal(count, 1);
});

test('player spawn pick avoids the last point and prefers distance from the rival', () => {
  const points = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 900, y: 0 }];
  for (let i = 0; i < 20; i++) {
    const idx = spawn.pickPlayerSpawnIndex(points, Math.random, 2, [{ x: 0, y: 0 }]);
    assert.notEqual(idx, 2);
  }
  assert.equal(spawn.pickPlayerSpawnIndex(points, Math.random, -1, [{ x: 0, y: 0 }]), 2);
});

test('DEV off (default): empty map at start, weapons appear progressively', () => {
  const { game } = createGame();
  assert.equal(game.devMode, false);
  assert.equal(game.weaponItems.length, 0);
  for (let i = 0; i < 181; i++) game.step(1 / 60);
  assert.equal(game.weaponItems.length, 1);
  const item = game.weaponItems[0];
  assert.equal(item.ttl > 1000, true);
  const onSpot = game.spawns.weapons.some((w) => w.x === item.x && w.y === item.y);
  assert.ok(onSpot);
});

test('DEV on: weapons are stocked from the start and fighters use the fixed spawns', () => {
  const { game } = createGame({ devMode: true });
  assert.equal(game.devMode, true);
  assert.ok(game.weaponItems.length >= 5);
  assert.equal(game.players[0].x, game.spawns.players[0].x);
});

test('toggling DEV mode swaps the weapon flow and persists the choice', () => {
  const { game, store } = createGame({ devMode: false });
  game.setDevMode(true);
  assert.equal(store.sf_dev_mode, '1');
  assert.ok(game.weaponItems.length >= 5);
  game.setDevMode(false);
  assert.equal(store.sf_dev_mode, '0');
  assert.equal(game.weaponItems.length, 0);
});

test('without the spawn module the game keeps the legacy DEV flow', () => {
  const { game } = createGame({ withSpawnModule: false });
  assert.ok(game.weaponItems.length >= 5);
});
