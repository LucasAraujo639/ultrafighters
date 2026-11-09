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
  const listeners = {};
  const window = { addEventListener: (type, cb) => { listeners[type] = cb; }, requestAnimationFrame: noop };
  vm.runInNewContext(src, {
    window, Image: FakeImage, performance: { now: () => 0 },
    document: { getElementById: () => canvas, createElement: () => canvas },
    console: { log: noop, warn: noop, error: noop }
  }, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  game.keys = {
    down: (code) => listeners.keydown({ code, repeat: false, preventDefault: noop }),
    up: (code) => listeners.keyup({ code, preventDefault: noop })
  };
  return game;
}
function park(game, a, b) {
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  for (const [p, x] of [[game.players[0], a], [game.players[1], b]]) {
    Object.assign(p, { x, y: floor.y - p.h, onGround: true, hp: 100, airVelocityX: 0, airVelocityY: 0, matrixDodgeTimer: 0 });
  }
}

test('burning fighter touching a clean one ignites them at level 1', () => {
  const game = createGame();
  const [p1, p2] = game.players;
  park(game, 300, 302);
  p1.addBurn(100); // carrier at level 2
  assert.match(p1.fireState.name, /LEVEL_2/);
  game.step();
  assert.match(p1.fireState.name, /FIRE_LEVEL/);
  assert.equal(p2.fireState.name, 'FIRE_LEVEL_1');
});

test('no contact, no contagion', () => {
  const game = createGame();
  const [p1, p2] = game.players;
  park(game, 60, 720);
  p1.addBurn(100);
  game.step();
  assert.equal(p2.fireState.name, 'NONE');
});

test('sprinting or jumping through the carrier does not spread the fire', () => {
  for (const mover of [0, 1]) {
    for (const action of ['sprint', 'jump']) {
      const game = createGame();
      const [p1, p2] = game.players;
      park(game, 300, 420);
      p1.addBurn(100);
      const right = mover === 0 ? 'KeyD' : 'ArrowRight';
      const left = mover === 0 ? 'KeyA' : 'ArrowLeft';
      const jumpKey = mover === 0 ? 'KeyW' : 'ArrowUp';
      const dir = mover === 0 ? right : left;
      if (mover === 1) { p2.x = 420; p1.x = 300; }
      if (action === 'sprint') { game.keys.down(dir); game.keys.up(dir); game.step(); game.keys.down(dir); }
      else { game.keys.down(dir); game.keys.down(jumpKey); }
      let sawSprintOrAir = false;
      for (let i = 0; i < 400 && p2.fireState.name === 'NONE'; i++) {
        game.step();
        const m = game.players[mover];
        const touching = Math.abs(p1.x - p2.x) < p1.w;
        if (touching && (m.sprinting || !m.onGround)) sawSprintOrAir = true;
        if (touching && !(m.sprinting || !m.onGround)) break; // slowed down: not this test
      }
      if (sawSprintOrAir) assert.equal(p2.fireState.name, 'NONE', action + ' mover ' + mover);
    }
  }
});

test('a flying rocket leaves an exhaust trail behind its tail that fades and stays capped', () => {
  const game = createGame();
  park(game, 60, 720);
  game.bullets.push({ x: 300, y: 200, vx: 6, vy: 0, damage: 0, crit: false, critDamage: 0, owner: 0, rocket: true, impulse: 0 });
  for (let i = 0; i < 10; i++) game.step();
  const rocket = game.bullets[0];
  assert.ok(rocket, 'the rocket is still flying');
  assert.ok(game.rocketExhaust.length > 0, 'puffs are emitted');
  assert.ok(game.rocketExhaust.every((puff) => puff.x < rocket.x), 'puffs spawn behind the flying direction');
  assert.ok(game.rocketExhaust.length <= 400, 'bounded');
  game.bullets.length = 0;
  for (let i = 0; i < 40; i++) game.step();
  assert.equal(game.rocketExhaust.length, 0, 'the trail fades out completely');
});

test('the renderer draws the missile and its exhaust without throwing', () => {
  const game = createGame();
  park(game, 60, 720);
  game.bullets.push({ x: 300, y: 200, vx: 6, vy: 2, damage: 0, crit: false, critDamage: 0, owner: 0, rocket: true, impulse: 0 });
  for (let i = 0; i < 5; i++) game.step();
  game.render();
});
