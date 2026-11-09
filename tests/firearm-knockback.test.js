'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const src = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};
function createGame() {
  const g = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => g, createRadialGradient: () => g }, { get: (t, k) => (k in t ? t[k] : noop), set() { return true; } });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const window = { addEventListener: noop, requestAnimationFrame: noop };
  vm.runInNewContext(src, { window, document: { getElementById: () => canvas }, performance: { now: () => 0 }, console: { log: noop, warn: noop, error: noop } }, { filename: 'src/game.js' });
  return window.__sf;
}
// Fire one bullet from the left straight into the victim's torso.
function shoot(game, victim, rule, extra) {
  game.bullets.push(Object.assign({
    x: victim.x - 2, y: victim.y + victim.h / 2, vx: 20, vy: 0,
    damage: 1, critDamage: 0, crit: false, owner: 99, trail: [], impulse: 0.6,
    knockbackRule: rule, shotId: 1, pelletCount: 1
  }, extra));
}
function setup() {
  const game = createGame();
  game.botActive = false;
  const victim = game.players[1];
  victim.hp = victim.maxHp || 100;
  victim.rolling = false;
  for (let i = 0; i < 90; i++) game.step(); // let the spawn settle on the floor
  victim.hp = victim.maxHp || 100;
  return { game, victim };
}
const settle = (game) => { for (let i = 0; i < 2; i++) game.step(); };

test('sniper: one bullet launches the victim away from the shooter', () => {
  const { game, victim } = setup();
  shoot(game, victim, 'singleHit');
  settle(game);
  assert.ok(victim.airVelocityX > 0 || victim.falling || !victim.onGround);
  assert.equal(victim.lastDirX, 1);
});

test('shotgun: partial pellet hit does not launch, all pellets do', () => {
  const { game, victim } = setup();
  shoot(game, victim, 'allPellets', { shotId: 7, pelletCount: 4 });
  shoot(game, victim, 'allPellets', { shotId: 7, pelletCount: 4, x: victim.x - 3 });
  settle(game);
  assert.equal(victim.falling, false);
  assert.ok(victim.onGround);
  const second = setup();
  for (let i = 0; i < 4; i++) shoot(second.game, second.victim, 'allPellets', { shotId: 9, pelletCount: 4, x: second.victim.x - 2 - i });
  settle(second.game);
  assert.ok(!second.victim.onGround);
});

test('uzi: needs N hits inside the window; slow hits never launch', () => {
  const { game, victim } = setup();
  for (let i = 0; i < 6; i++) {
    shoot(game, victim, 'burstWindow');
    for (let k = 0; k < 60; k++) game.step(); // far apart: window expires
    victim.hp = 100;
  }
  assert.ok(victim.onGround);
  const fast = setup();
  for (let i = 0; i < 4; i++) { shoot(fast.game, fast.victim, 'burstWindow'); fast.game.step(); }
  assert.ok(!fast.victim.onGround);
});
