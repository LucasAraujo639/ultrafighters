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
function clear(game) {
  game.botActive = false;
  for (const c of game.crates) c.dead = true;
}

test('walking off a rising lift never teleports the rider to the sky', () => {
  const game = createGame();
  clear(game);
  const lift = game.platforms.find((q) => q.elevator);
  const p = game.players[0];
  lift.t = 0.3;
  Object.assign(p, { x: lift.x + 2, y: lift.y - p.h, airVelocityX: 0, airVelocityY: 0, onGround: true, groundedPlatform: lift });
  p.pressLeft = () => true;
  p.pressRight = () => false;
  for (let f = 0; f < 120; f++) {
    game.step();
    assert.ok(p.y > 150, 'rider stays near the lift, frame ' + f + ' y=' + p.y);
  }
});

test('the glass pane beside the lift stays solid as the lift rises past it', () => {
  const game = createGame();
  clear(game);
  const lift = game.platforms.find((q) => q.elevator);
  const gl = game.glassPanes[0];
  const p = game.players[0];
  lift.t = 0.5;
  Object.assign(p, { x: lift.x + 2, y: lift.y - p.h, airVelocityX: 0, airVelocityY: 0, onGround: true, groundedPlatform: lift });
  p.pressRight = () => true;
  p.pressLeft = () => false;
  for (let f = 0; f < 150; f++) {
    game.step();
    if (!gl.broken) assert.ok(p.x + p.w <= gl.x + 1, 'body never enters the pane, frame ' + f);
  }
});

test('a grenade thrown at a gray wall bounces back instead of passing through', () => {
  const game = createGame();
  clear(game);
  const wall = { x: 300, y: 100, w: 20, h: 200, solidSides: true, shape: 'rect', cloud: false, ladder: false, oneWay: false };
  game.platforms.push(wall);
  game.grenades.push({ type: 'grenade', x: 250, y: 200, vx: 6, vy: 0, fuse: 500, spin: 0 });
  for (let f = 0; f < 40; f++) game.step();
  const gr = game.grenades[0];
  assert.ok(gr.x < wall.x, 'stays on the near side, x=' + gr.x);
  assert.ok(gr.vx < 0, 'horizontal speed reflected');
});

for (const type of ['grenade', 'molotov']) {
  for (const prop of ['crate', 'barrel']) {
    test('a thrown ' + type + ' bounces off a ' + prop + ' instead of passing through', () => {
      const game = createGame();
      clear(game);
      const body = { x: 300, y: 180, w: 20, h: 26, vx: 0, vy: 0, hp: 999, hp0: 999, angle: 0, spin: 0, resting: true, dead: false };
      (prop === 'crate' ? game.crates : game.barrels).push(body);
      game.grenades.push({ type, x: 250, y: 190, vx: 12, vy: 0, fuse: 500, spin: 0 });
      for (let f = 0; f < 30; f++) game.step();
      if (type === 'molotov') {
        // a molotov never bounces: the bottle bursts on the prop and leaves fire
        assert.equal(game.grenades.length, 0, 'the bottle burst on the ' + prop);
        return;
      }
      const gr = game.grenades[0];
      assert.ok(gr.x < body.x, 'stays on the near side, x=' + gr.x);
      assert.ok(gr.vx < 0, 'horizontal speed reflected');
    });
  }
}

function createKeyGame() {
  const g = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => g, createRadialGradient: () => g }, { get: (t, k) => (k in t ? t[k] : noop), set() { return true; } });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const handlers = {};
  const window = { addEventListener: (t, f) => { handlers[t] = f; }, requestAnimationFrame: noop };
  vm.runInNewContext(src, { window, document: { getElementById: () => canvas }, performance: { now: () => 0 }, console: { log: noop, warn: noop, error: noop } }, { filename: 'src/game.js' });
  return { game: window.__sf, key: (code, down) => handlers[down ? 'keydown' : 'keyup']({ code, preventDefault: noop }) };
}

for (const [down, dirKey, name] of [['KeyS', 'KeyD', 'S+D'], ['KeyS', 'KeyA', 'S+A']]) {
  test('hold DOWN then press a direction rolls ' + name, () => {
    const { game, key } = createKeyGame();
    clear(game);
    const p = game.players[0];
    assert.equal(p.binding.down, down);
    for (let f = 0; f < 30; f++) game.step(); // settle on the floor
    key(down, true);
    game.step(); game.step();
    assert.equal(p.rolling, false, 'DOWN alone only kneels');
    key(dirKey, true);
    game.step();
    assert.equal(p.rolling, true, 'second key press rolls at once');
  });
}
