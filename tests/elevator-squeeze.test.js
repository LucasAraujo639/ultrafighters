const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
const noop = () => {};
function createGame() {
  const g = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => g, createRadialGradient: () => g }, { get: (t, k) => (k in t ? t[k] : noop), set() { return true; } });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const window = { addEventListener: noop, requestAnimationFrame: noop };
  vm.runInNewContext(src, { window, document: { getElementById: () => canvas }, performance: { now: () => 0 }, console: { log: noop, warn: noop, error: noop } }, { filename: 'src/game.js' });
  return window.__sf;
}
test('elevator pinning rider against solid slab slides them aside, no teleport', () => {
  const game = createGame();
  game.botActive = false;
  const lift = game.platforms.find((q) => q.elevator);
  const p = game.players[0];
  for (const c of game.crates) c.dead = true;
  for (const b of game.barrels) b.dead = true;
  const slab = { x: lift.x - 40, y: lift.baseY - 60, w: 80, h: 20, solidSides: true, shape: 'rect', cloud: false, ladder: false, oneWay: false };
  game.platforms.push(slab);
  lift.t = 0;
  Object.assign(p, { x: lift.x + lift.w / 2 - p.w / 2, y: lift.y - p.h, airVelocityX: 0, airVelocityY: 0, onGround: true, groundedPlatform: lift });
  let minY = Infinity;
  for (let f = 0; f < 400; f++) { game.step(); minY = Math.min(minY, p.y); }
  assert.ok(minY > slab.y - 200, 'player never launched skyward');
  assert.ok(p.y < 640, 'player did not fall out of the world');
});

test('spam-jumping on the moving elevator never lets the rider fall through', () => {
  const game = createGame();
  game.botActive = false;
  const lift = game.platforms.find((q) => q.elevator);
  const p = game.players[0];
  for (const c of game.crates) c.dead = true;
  for (const b of game.barrels) b.dead = true;
  lift.t = Math.PI; // start at the top of the cycle, about to descend then climb
  Object.assign(p, { x: lift.x + lift.w / 2 - p.w / 2, y: lift.y - p.h, airVelocityX: 0, airVelocityY: 0, onGround: true, groundedPlatform: lift });
  for (let f = 0; f < 1500; f++) {
    p.airVelocityX = 0;
    if (p.onGround && f % 7 === 0) p.beginJump();
    game.step();
    assert.ok(p.y + p.h <= lift.y + 6, 'rider stays above the lift surface at frame ' + f);
  }
});
