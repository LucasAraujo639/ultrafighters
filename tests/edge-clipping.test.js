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
const SHALLOW_OVERLAPS = [1, 3, 6, 12];

for (const overlapDepth of SHALLOW_OVERLAPS) {
  for (const side of ['left', 'right']) {
    test('a body grazing a solid edge by ' + overlapDepth + 'px (' + side + ') is ejected, never left embedded', () => {
      const game = createGame();
      game.botActive = false;
      for (const c of game.crates) c.dead = true;
      for (const b of game.barrels) b.dead = true;
      const pillar = game.platforms.find((q) => q.shape === 'rect' && q.w === 13.5 && q.h === 40.5);
      const player = game.players[0];
      const depth = Math.min(overlapDepth, player.w - 1); // a body narrower than the overlap would sit fully inside
      const startX = side === 'left' ? pillar.x - player.w + depth : pillar.x + pillar.w - depth;
      Object.assign(player, { x: startX, y: pillar.y + 10, airVelocityX: 0, airVelocityY: 0, onGround: false, groundedPlatform: null });
      game.step();
      const penetrationX = Math.min(player.x + player.w, pillar.x + pillar.w) - Math.max(player.x, pillar.x);
      const penetrationY = Math.min(player.y + player.h, pillar.y + pillar.h) - Math.max(player.y, pillar.y);
      assert.ok(penetrationX <= 0.01 || penetrationY <= 0.01, 'still embedded: penX=' + penetrationX + ' penY=' + penetrationY);
    });
  }
}
