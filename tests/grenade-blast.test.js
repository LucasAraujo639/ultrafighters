'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};
class FakeImage {
  set src(v) { this._src = v; this.complete = true; this.naturalWidth = 16; this.naturalHeight = 16; if (this.onload) this.onload(); }
}
function createGame() {
  const gradient = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    { get: (t, k) => (k in t ? t[k] : noop), set: () => true });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const window = { addEventListener: noop, requestAnimationFrame: noop };
  vm.runInNewContext(src, {
    window, Image: FakeImage, performance: { now: () => 0 },
    document: { getElementById: () => canvas, createElement: () => canvas },
    console: { log: noop, warn: noop, error: noop }
  }, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; game.grenades.length = 0;
  for (const item of game.weaponItems) item.taken = true;
  const [p1, p2] = game.players;
  Object.assign(p1, { x: 400, y: floor.y - p1.h, onGround: true, hp: 100 });
  Object.assign(p2, { x: 720, y: floor.y - p2.h, onGround: true, hp: 100 });
  return { game, p1, p2 };
}
const crateAt = (x, y) => ({ x, y, w: 14, h: 14, vx: 0, vy: 0, hp: 40, hp0: 40, angle: 0, spin: 0, resting: true, dead: false });

test('a single grenade at point blank deals the reduced base damage', () => {
  const { game, p1 } = createGame();
  game.explodeGrenade(p1.x + p1.w / 2, p1.y + p1.h / 2);
  assert.equal(p1.hp, 80);
});

test('grenades that converge pop on the same step and their damage adds up', () => {
  const { game, p1 } = createGame();
  const cx = p1.x + p1.w / 2, cy = p1.y + p1.h / 2;
  const make = (x, fuse) => ({ x, y: cy, vx: 0, vy: 0, spin: 0, fuse, owner: 2, type: 'grenade' });
  game.grenades.push(make(cx, 1), make(cx + 10, 40), make(cx - 10, 60));
  const explosionsBefore = game.explosions.length;
  game.step();
  assert.equal(game.grenades.length, 0, 'the whole cluster is gone');
  assert.equal(game.explosions.length - explosionsBefore, 3, 'three blasts on one step');
  assert.ok(p1.hp <= 100 - 20 * 3 + 12, 'the fighter took the sum of the three blasts');
  assert.ok(p1.hp < 80, 'more than a single grenade');
});

test('a distant grenade does not join the cluster', () => {
  const { game } = createGame();
  const make = (x, fuse) => ({ x, y: 300, vx: 0, vy: 0, spin: 0, fuse, owner: 2, type: 'grenade' });
  game.grenades.push(make(100, 1), make(500, 40));
  game.step();
  assert.equal(game.grenades.length, 1);
});

test('crates and barrels only react to a grenade almost touching them, fighters feel the wide radius', () => {
  const { game, p1 } = createGame();
  // fighter 60 px from the blast is hurt; a crate 60 px away is untouched
  game.crates.push(crateAt(460, 486));
  game.explodeGrenade(400, 490);
  assert.ok(game.crates[0].hp === 40, 'a crate 60 px away is untouched');
  game.crates.length = 0;
  game.crates.push(crateAt(405, 486));
  game.explodeGrenade(400, 490);
  assert.ok(game.crates[0].hp < 40 || game.crates[0].dead, 'a crate next to the blast breaks');
  const wide = createGame();
  wide.game.explodeGrenade(wide.p1.x + wide.p1.w / 2 + 60, wide.p1.y + wide.p1.h / 2);
  assert.ok(wide.p1.hp < 100, 'the fighter 60 px away is hurt');
});

test('a grenade entering a doorway reappears at the linked door with its velocity', () => {
  const { game } = createGame();
  const [door, target] = game.doorPortals;
  const wall = { x: door.x + door.w / 2 - 3, y: door.y - 40, w: 6, h: 120, solidSides: true, shape: 'rect', cloud: false, ladder: false };
  game.platforms.push(wall);
  const offset = 10;
  game.grenades.push({ x: door.x - 12, y: door.y + offset, vx: 4, vy: 0, spin: 0, fuse: 500, owner: 1, type: 'grenade', age: 0 });
  let teleported = false;
  for (let f = 0; f < 20 && !teleported; f++) {
    game.step();
    teleported = game.grenades[0].y > target.y - 1 && game.grenades[0].y < target.y + target.h + 1;
  }
  const g = game.grenades[0];
  assert.ok(teleported, 'came out of the linked door, y=' + g.y);
  assert.ok(Math.abs(g.y - (target.y + offset)) < 4, 'kept its vertical offset inside the door');
  assert.ok(g.vx > 3.5, 'kept its speed, vx=' + g.vx);
  for (let f = 0; f < 10; f++) game.step();
  assert.ok(game.grenades[0].x > target.x + target.w / 2, 'keeps flying on from the exit door');
});

test('a grenade moving away from the door side does not teleport', () => {
  const { game } = createGame();
  const [door] = game.doorPortals;
  game.grenades.push({ x: door.x + door.w - 2, y: door.y + 8, vx: -3, vy: 0, spin: 0, fuse: 500, owner: 1, type: 'grenade', age: 0 });
  game.step();
  assert.ok(Math.abs(game.grenades[0].y - (door.y + 8)) < 3, 'stayed at the same door');
});

test('a grenade hitting the same wall away from the door still rebounds', () => {
  const { game } = createGame();
  const door = game.doorPortals[0];
  const wall = { x: door.x + door.w / 2 - 3, y: door.y - 80, w: 6, h: 200, solidSides: true, shape: 'rect', cloud: false, ladder: false };
  game.platforms.push(wall);
  game.grenades.push({ x: wall.x - 12, y: door.y - 60, vx: 4, vy: -0.2, spin: 0, fuse: 500, owner: 1, type: 'grenade', age: 0 });
  for (let f = 0; f < 10; f++) game.step();
  assert.ok(game.grenades[0].x < wall.x, 'bounced back');
});
