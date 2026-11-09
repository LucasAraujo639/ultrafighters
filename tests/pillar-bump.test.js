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
  const listeners = Object.create(null);
  const window = { addEventListener: (t, cb) => { listeners[t] = cb; }, requestAnimationFrame: noop };
  vm.runInNewContext(src, { window, document: { getElementById: () => canvas }, performance: { now: () => 0 }, console: { log: noop, warn: noop, error: (...a) => process.stderr.write(a.join(' ') + '\n') } }, { filename: 'src/game.js' });
  return { game: window.__sf, listeners };
}
for (const [name, w, h] of [['pillar 1', 13.5, 40.5], ['pillar 2', 13.5, 42.5]]) {
  test('jumping up into the hanging ' + name + ' bumps the head', () => {
    const { game, listeners } = createGame();
    game.botActive = false;
    const beam = game.platforms.find((q) => q.shape === 'rect' && q.w === w && q.h === h);
    assert.ok(beam);
    const p = game.players.find((q) => q.binding && q.binding.right === 'ArrowRight');
    for (const c of game.crates) c.dead = true;
    for (const b of game.barrels) b.dead = true;
    const floorY = beam.y + beam.h + 70;
    game.platforms.push({ x: beam.x - 50, y: floorY, w: 120, h: 50, solidSides: true, shape: 'rect', cloud: false, ladder: false });
    Object.assign(p, { x: beam.x + beam.w / 2 - p.w / 2, y: floorY - p.h, airVelocityX: 0, airVelocityY: 0, onGround: true, groundedPlatform: null });
    // the map's own block sits where the fighter is stood: remove it so the jump is the only thing under test
    for (let i = game.platforms.length - 1; i >= 0; i--) {
      const q = game.platforms[i];
      const overlapsBody = q.x < p.x + p.w && q.x + q.w > p.x && q.y < p.y + p.h && q.y + q.h > p.y;
      if (overlapsBody && q !== beam && q.shape === 'rect' && !(q.y === floorY)) game.platforms.splice(i, 1);
    }
    for (let f = 0; f < 3; f++) game.step();
    p.airVelocityY = -14; p.onGround = false; p.jumping = true;
    let minY = Infinity;
    const tr = []; for (let f = 0; f < 40; f++) { game.step(); minY = Math.min(minY, p.y); tr.push(p.y.toFixed(0)); } if (process.env.DBG) console.error(tr.join(' '), p.x, beam.x, beam.y, beam.h);
    assert.ok(minY >= beam.y + beam.h - 0.5, 'head stopped under the beam: minY=' + minY + ' beamBottom=' + (beam.y + beam.h));
  });
}
