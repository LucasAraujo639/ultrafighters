const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
const noop = () => {};

function createGame() {
  const g = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => g, createRadialGradient: () => g }, {
    get: (t, k) => (k in t ? t[k] : noop),
    set() { return true; }
  });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const listeners = Object.create(null);
  const window = { addEventListener: (t, cb) => { listeners[t] = cb; }, requestAnimationFrame: noop };
  vm.runInNewContext(src, {
    window, document: { getElementById: () => canvas },
    performance: { now: () => 0 }, console: { log: noop, warn: noop, error: noop }
  }, { filename: 'src/game.js' });
  return { game: window.__sf, listeners };
}

// canvas coords: central floor top 446.75, right floor top 464.75, ramp x 604..628
function walk(dir) {
  const { game, listeners } = createGame();
  game.botActive = false;
  const p = game.players.find((q) => q.binding && q.binding.right === 'ArrowRight');
  for (const c of game.crates) c.dead = true;
  for (const b of game.barrels) b.dead = true;
  const sy = dir > 0 ? 446.75 : 464.75;
  Object.assign(p, { x: dir > 0 ? 560 : 650, y: sy - p.h, airVelocityX: 0, airVelocityY: 0, onGround: true, groundedPlatform: null });
  listeners.keydown({ code: dir > 0 ? 'ArrowRight' : 'ArrowLeft', repeat: false, preventDefault: () => {} });
  const trace = [];
  for (let f = 0; f < (dir > 0 ? 75 : 150); f++) {
    game.step();
    trace.push([p.x + p.w / 2, p.y + p.h]);
  }
  return { p, trace };
}

test('stairs: walking right descends the ramp progressively', () => {
  const { p, trace } = walk(1);
  const onRamp = trace.filter(([x]) => x > 606 && x < 626);
  assert.ok(onRamp.length > 4, 'spent time on the ramp');
  const ys = onRamp.map(([, y]) => y);
  assert.ok(ys.some((y) => y > 449 && y < 463), 'intermediate heights on the ramp: ' + ys.map((y) => y.toFixed(1)).join(','));
  assert.ok(p.onGround && Math.abs(p.y + p.h - 464.75) < 2, 'ends on the right floor, y=' + (p.y + p.h));
});

test('stairs: walking left climbs back up to the central floor', () => {
  const { p, trace } = walk(-1);
  const ys = trace.filter(([x]) => x > 606 && x < 626).map(([, y]) => y);
  assert.ok(ys.some((y) => y > 449 && y < 463), 'intermediate heights: ' + ys.map((y) => y.toFixed(1)).join(','));
  assert.ok(p.onGround);
  assert.ok(Math.abs(p.y + p.h - 446.75) < 2 || p.x < 604, 'on top of the central floor, y=' + (p.y + p.h) + ' x=' + p.x);
});

test('grenades explode without leaving ground fire', () => {
  const { game } = createGame();
  const before = game.groundFire ? game.groundFire.length : 0;
  game.explodeGrenade(300, 440);
  assert.equal(game.groundFire ? game.groundFire.length : 0, before);
});

test('the central floor block has no stair assist', () => {
  const { game } = createGame();
  assert.equal(game.platforms[1].noStep, true);
});

test('the bucket on the central floor is a solid box: running into it stops you', () => {
  const { game, listeners } = createGame();
  game.botActive = false;
  const bucket = game.platforms.find((q) => q.shape === 'rect' && q.w === 15.5 && q.h === 13.5);
  assert.ok(bucket && bucket.noStep);
  const p = game.players.find((q) => q.binding && q.binding.right === 'ArrowRight');
  for (const c of game.crates) c.dead = true;
  for (const b of game.barrels) b.dead = true;
  Object.assign(p, { x: bucket.x - 60, y: bucket.y + bucket.h - p.h, airVelocityX: 0, airVelocityY: 0, onGround: true, groundedPlatform: null });
  listeners.keydown({ code: 'ArrowRight', repeat: false, preventDefault: () => {} });
  for (let f = 0; f < 80; f++) game.step();
  assert.ok(p.x + p.w <= bucket.x + 0.5, 'stopped against the bucket, x=' + p.x);
});
