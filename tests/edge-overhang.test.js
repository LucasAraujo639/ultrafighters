const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
const rigid = require('../src/rigid-impact.js');
const noop = () => {};
function createGame() {
  const g = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => g, createRadialGradient: () => g }, { get: (t, k) => (k in t ? t[k] : noop), set() { return true; } });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const window = { addEventListener: noop, requestAnimationFrame: noop };
  vm.runInNewContext(src, { window, SuperfightersRigidImpact: rigid, document: { getElementById: () => canvas }, performance: { now: () => 0 }, console: { log: noop, warn: noop, error: noop } }, { filename: 'src/game.js' });
  return window.__sf;
}

test('overhangDirection: balanced while the centre sits over the support, topples once past the edge', () => {
  const api = rigid;
  assert.equal(api.overhangDirection(5, 0, 10), 0);
  assert.equal(api.overhangDirection(14, 0, 10), 1);
  assert.equal(api.overhangDirection(-4, 0, 10), -1);
});

test('a crate with its centre past a platform edge slides off and falls instead of hovering', () => {
  const game = createGame();
  game.botActive = false;
  for (const c of game.crates) c.dead = true;
  for (const b of game.barrels) b.dead = true;
  // the scaffold ledge from the bug report: its right side is open air all the way down
  const plat = game.platforms.find((q) => q.shape === 'rect' && q.x === 182.75 && q.y === 351.75);
  assert.ok(plat, 'scaffold ledge not found');
  const crate = game.createCrate ? game.createCrate(plat.x + plat.w - 4, plat.y, null) : null;
  assert.ok(crate, 'createCrate not exposed');
  crate.x = plat.x + plat.w - 4; // only 4px of a ~20px crate on the platform
  crate.y = plat.y - crate.h;
  const startY = crate.y;
  for (let i = 0; i < 240; i++) game.step();
  assert.ok(crate.y > startY + 5, 'crate still hovering at the edge: y=' + crate.y + ' start=' + startY);
});
