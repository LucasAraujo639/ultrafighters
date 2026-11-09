const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const gameSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
const noop = () => {};

function createGame() {
  const texts = [];
  const gradient = { addColorStop: noop };
  const context = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient }, {
    get(t, k) {
      if (k === 'fillText') return (s) => texts.push(String(s));
      return k in t ? t[k] : noop;
    },
    set() { return true; }
  });
  const canvas = { width: 800, height: 600, getContext: () => context };
  const listeners = Object.create(null);
  const window = { addEventListener: (t, cb) => { listeners[t] = cb; }, requestAnimationFrame: noop };
  vm.runInNewContext(gameSource, {
    window, document: { getElementById: () => canvas },
    performance: { now: () => 0 }, console: { log: noop, warn: noop, error: noop }
  }, { filename: 'src/game.js' });
  return { game: window.__sf, texts, listeners };
}

test('HUD renders the 4-slot plates with ammo digits and survives empty slots', () => {
  const { game, texts } = createGame();
  game.botActive = false;
  const p = game.players[0];
  p.ranged = { gun: p.ranged.gun, ammo: 7 };
  p.throwable = { ammo: 3 };
  game.render();
  assert.ok(texts.includes('07'), 'gun ammo padded to two digits');
  assert.ok(texts.includes('03'), 'grenade count padded to two digits');
  assert.ok(texts.includes('P1') && texts.includes('P2'));
  // empty hands / no gun / no throwable / no slowmo: still renders
  p.ranged = null; p.throwable = null; p.carriedSlowmo = null;
  texts.length = 0;
  game.render();
  assert.ok(texts.includes('P1'));
});

test('impacts keep the aimed gun; a melee blow drops it and it vanishes', () => {
  const { game } = createGame();
  game.botActive = false;
  const p = game.players[0];
  const arm = () => { p.ranged = { gun: game.guns.pistol, ammo: 12 }; p.aiming = true; p.aimMode = 0; };
  arm();
  p.abortAiming(true, 'keep');
  assert.ok(p.ranged, 'explosion/impact keeps the weapon');
  const before = game.weaponItems.length;
  arm();
  p.abortAiming(true, 'vanish');
  assert.equal(p.ranged, null);
  const item = game.weaponItems[game.weaponItems.length - 1];
  assert.equal(game.weaponItems.length, before + 1);
  assert.ok(item.ttl > 0, 'dropped gun is temporary');
});

test('walking over a weapon with an empty slot picks it up; a held one is replaced and deleted', () => {
  const { game } = createGame();
  game.botActive = false;
  const p = game.players[0];
  p.ranged = null;
  game.weaponItems.length = 0;
  const put = (gun) => game.weaponItems.push({ weapon: gun, ammo: gun.ammo, x: p.x + p.w / 2, y: p.y + p.h, taken: false, pickupDelay: 0 });
  put(game.guns.pistol);
  game.step();
  assert.equal(p.ranged && p.ranged.gun, game.guns.pistol, 'auto-pickup with an empty slot');
  put(game.guns.uzi);
  game.step();
  assert.equal(p.ranged.gun, game.guns.pistol, 'occupied slot: walking over does not swap');
  assert.equal(game.weaponItems.filter((i) => !i.taken).length, 1);
});

test('low lips are walked up without jumping (the ramp by the central floor)', () => {
  const { game, listeners } = createGame();
  game.botActive = false;
  const p = game.players.find((q) => q.binding && q.binding.right === 'ArrowRight');
  game.platforms.length = 0;
  game.platforms.push({ x: 0, y: 500, w: 300, h: 100, solidSides: true, shape: 'rect' });
  game.platforms.push({ x: 300, y: 486, w: 300, h: 114, solidSides: true, shape: 'rect' }); // 14 px step
  Object.assign(p, { x: 250, y: 500 - p.h, airVelocityX: 0, airVelocityY: 0, onGround: true, groundedPlatform: null });
  listeners.keydown({ code: 'ArrowRight', repeat: false, preventDefault: () => {} });
  for (let f = 0; f < 120; f++) game.step();
  assert.ok(p.x > 300, 'crossed the lip, got x=' + p.x);
  assert.ok(Math.abs(p.y + p.h - 486) < 2, 'standing on the upper step');
});

test('stairs ease: the body is drawn offset and settles, up and down', () => {
  const { game, listeners } = createGame();
  game.botActive = false;
  const p = game.players.find((q) => q.binding && q.binding.right === 'ArrowRight');
  game.platforms.length = 0;
  for (const c of game.crates) c.dead = true;
  for (const b of game.barrels) b.dead = true;
  game.platforms.push({ x: 0, y: 500, w: 300, h: 100, solidSides: true, shape: 'rect' });
  game.platforms.push({ x: 300, y: 486, w: 100, h: 114, solidSides: true, shape: 'rect' });
  game.platforms.push({ x: 400, y: 500, w: 300, h: 100, solidSides: true, shape: 'rect' });
  Object.assign(p, { x: 250, y: 500 - p.h, airVelocityX: 0, airVelocityY: 0, onGround: true, groundedPlatform: null });
  listeners.keydown({ code: 'ArrowRight', repeat: false, preventDefault: () => {} });
  let up = 0, down = 0;
  // 240 steps: far enough to climb and descend, short of the platform end (the brisker walk would reach it by ~290)
  for (let f = 0; f < 240; f++) {
    game.step();
    up = Math.max(up, p.stepVis || 0);
    down = Math.min(down, p.stepVis || 0);
  }
  assert.ok(up > 5, 'eases up the step (visual offset), got ' + up);
  assert.ok(down < -5, 'eases down the step, got ' + down);
  assert.ok(p.onGround && !p.falling, 'never drops like a block');
});
