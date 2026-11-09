'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};
class FakeImage { set src(v) { this.complete = true; this.naturalWidth = 16; this.naturalHeight = 16; if (this.onload) this.onload(); } }
function createGame() {
  const gradient = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient }, { get: (t, k) => (k in t ? t[k] : noop), set: () => true });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const window = { addEventListener: noop, requestAnimationFrame: noop };
  vm.runInNewContext(src, { window, Image: FakeImage, performance: { now: () => 0 }, document: { getElementById: () => canvas, createElement: () => canvas }, console: { log: noop, warn: noop, error: noop } }, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; game.grenades.length = 0; game.bullets.length = 0;
  for (const item of game.weaponItems) item.taken = true;
  const [p1, p2] = game.players;
  Object.assign(p1, { x: 100, y: floor.y - p1.h, onGround: true, hp: 100 });
  Object.assign(p2, { x: 700, y: floor.y - p2.h, onGround: true, hp: 100 });
  return { game, p1, p2 };
}
test('grenade fuse is 3.5 seconds', () => {
  const { game } = createGame();
  assert.equal(game.grenade.throwTimer, 210);
});
test('a bullet detonates a grenade, owner included', () => {
  const { game } = createGame();
  game.grenades.push({ x: 400, y: 300, vx: 0, vy: 0, spin: 0, fuse: 200, owner: 1, type: 'grenade' });
  game.bullets.push({ x: 380, y: 300, vx: 20, vy: 0, damage: 5, owner: 1 });
  const before = game.explosions.length;
  game.step();
  assert.equal(game.grenades.length, 0);
  assert.ok(game.explosions.length > before);
});
test('a kick sends a nearby grenade forward', () => {
  const { game, p1 } = createGame();
  p1.lastDirX = 1;
  const g = { x: p1.x + p1.w + 8, y: p1.y + p1.h - 4, vx: -2, vy: 0, spin: 0, fuse: 200, owner: 2, type: 'grenade' };
  game.grenades.push(g);
  game.kickGrenadesInReach(p1);
  assert.ok(Math.abs(g.vx - game.grenade.throwSpeed * 0.7) < 1e-9, 'same speed as a hand throw');
  assert.ok(g.vy < 0);
});
test('quick-shot: fire pressed right after a throw pops the fresh grenade in the air', () => {
  const { game, p1 } = createGame();
  p1.lastDirX = 1;
  p1.ranged = { gun: game.guns.pistol, ammo: 12 };
  p1.throwable = { type: 'grenade', ammo: 3 };
  p1.aiming = true; p1.aimMode = 1; p1.throwTimer = game.grenade.throwTimer;
  p1.releaseThrowable();
  assert.equal(game.grenades.length, 1);
  p1.aiming = true; p1.aimMode = 0; // fire pressed immediately after the throw
  game.step(); // the raise starts
  p1.fireWeapon(); // trigger released at once: queued behind the raise
  for (let f = 0; f < 40 && game.grenades.length; f++) game.step();
  assert.equal(game.grenades.length, 0, 'the quick shot detonated the grenade mid-air');
  assert.equal(p1.hp, 100, 'the blast pops far enough away to leave the thrower unhurt');
});
