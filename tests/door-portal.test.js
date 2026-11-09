'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const doorApi = require('../src/door-portal.js');
const noop = () => {};

const DOORS = [
  { x: 743, y: 315, w: 20, h: 24, target: 1 },
  { x: 743, y: 441, w: 20, h: 24, target: 0 }
];
const bodyIn = (door, overrides) => Object.assign({ x: door.x + 3, y: door.y + door.h - 18, w: 14, h: 18, vx: 3, locked: false }, overrides);

// ---------- pure rules ----------

test('door transit: entering a doorway toward the door side exits the linked doorway at the same height above its floor', () => {
  const body = bodyIn(DOORS[0], { y: DOORS[0].y + DOORS[0].h - 18 - 2 }); // 2 px above the doorway floor
  const out = doorApi.transit(body, DOORS);
  assert.equal(out.locked, true);
  assert.ok(out.teleport);
  assert.equal(out.teleport.x + body.w / 2, DOORS[1].x + DOORS[1].w / 2, 'centred in the exit');
  assert.equal(DOORS[1].y + DOORS[1].h - (out.teleport.y + body.h), 2, 'same height above the floor');
});

test('door transit: a locked body, a body moving away or a body too tall does nothing', () => {
  assert.equal(doorApi.transit(bodyIn(DOORS[0], { locked: true }), DOORS).teleport, null);
  assert.equal(doorApi.transit(bodyIn(DOORS[0], { vx: -2 }), DOORS).teleport, null);
  assert.equal(doorApi.transit(bodyIn(DOORS[0], { h: 30, y: DOORS[0].y - 3 }), DOORS).teleport, null);
});

test('door transit: it unlocks only once the body has left the doorway', () => {
  const inside = doorApi.transit(bodyIn(DOORS[1], { locked: true }), DOORS);
  assert.equal(inside.inDoorway, true);
  assert.equal(inside.locked, true);
  const outside = doorApi.transit({ x: 600, y: 440, w: 14, h: 18, vx: 3, locked: true }, DOORS);
  assert.equal(outside.inDoorway, false);
  assert.equal(outside.locked, false);
});

// ---------- in the real map ----------

let sharedGame = null;
function stationGame() {
  if (!sharedGame) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
    const gradient = { addColorStop: noop };
    const ctx = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient },
      { get: (t, k) => (k in t ? t[k] : noop), set() { return true; } });
    const canvas = { width: 800, height: 600, getContext: () => ctx };
    const window = { addEventListener: noop, requestAnimationFrame: noop };
    vm.runInNewContext(src, {
      window,
      SuperfightersRigidImpact: require('../src/rigid-impact.js'),
      SuperfightersHeavyProps: require('../src/heavy-props.js'),
      SuperfightersImpactDynamics: require('../src/impact-dynamics.js'),
      SuperfightersDoorPortal: doorApi,
      document: { getElementById: () => canvas },
      performance: { now: () => 0 },
      console: { log: noop, warn: noop, error: noop }
    }, { filename: 'src/game.js' });
    sharedGame = window.__sf;
    sharedGame.botActive = false;
    for (const item of sharedGame.weaponItems) item.taken = true;
  }
  const game = sharedGame;
  game.crates.length = 0;
  game.barrels.length = 0;
  game.players[0].x = 20; game.players[1].x = 30;
  return game;
}

function barrelAt(game, x, floorY) {
  const barrel = {
    x, y: floorY - 18.75, w: 13.75, h: 18.75, sx: x, sy: floorY - 18.75, vx: 0, vy: 0, angle: 0, spin: 0,
    mass: 2, baseW: 13.75, baseH: 18.75, burning: false, burnFuse: 0, resting: true
  };
  game.barrels.push(barrel);
  return barrel;
}

const FLOORS = [
  { name: 'upper door', floorY: 338.75, from: 0, to: 1 },
  { name: 'lower door', floorY: 464.75, from: 1, to: 0 }
];

function throwIntoDoor(game, kind, floor, vx) {
  game.crates.length = 0; game.barrels.length = 0;
  const prop = kind === 'barrel' ? barrelAt(game, 722, floor.floorY) : game.createCrate(722, floor.floorY, kind);
  for (let i = 0; i < 5; i++) game.step();
  prop.vx = vx; prop.resting = false;
  const exit = game.doorPortals[floor.to];
  let teleports = 0;
  let last = { x: prop.x, y: prop.y };
  let landed = null;
  for (let i = 0; i < 120; i++) {
    game.step();
    if (Math.abs(prop.x - last.x) > 25 || Math.abs(prop.y - last.y) > 25) { teleports++; landed = { x: prop.x, y: prop.y }; }
    last = { x: prop.x, y: prop.y };
  }
  return { prop, exit, teleports, landed };
}

test('in game: props slid into a door come out of the other door, once, at floor level', () => {
  const game = stationGame();
  for (const floor of FLOORS) {
    for (const kind of ['table', 'bouncer', 'cementBarrel', 'metalCrate', 'barrel']) {
      const { exit, teleports, landed, prop } = throwIntoDoor(game, kind, floor, 3);
      assert.equal(teleports, 1, floor.name + ' ' + kind + ': went through exactly once (no ping-pong)');
      assert.ok(Math.abs(landed.x + prop.w / 2 - (exit.x + exit.w / 2)) < 1, floor.name + ' ' + kind + ': centred in the exit door');
      assert.ok(Math.abs(landed.y + prop.h - (exit.y + exit.h)) < 1.5, floor.name + ' ' + kind + ': on the exit floor');
    }
  }
});

test('in game: a prop moving away from the door side never goes through', () => {
  const game = stationGame();
  game.crates.length = 0;
  const crate = game.createCrate(745, 338.75, null);
  for (let i = 0; i < 5; i++) game.step();
  crate.vx = -2;
  const start = crate.x;
  for (let i = 0; i < 60; i++) game.step();
  assert.ok(crate.x < start && Math.abs(crate.y - 318.75) < 3, 'it just slides out the way it is going');
});

test('in game: an occupied exit makes the prop wait at the entrance instead of overlapping', () => {
  const game = stationGame();
  game.crates.length = 0; game.barrels.length = 0;
  const blocker = game.createCrate(748, 464.75, null); // sits in the lower doorway (the exit)
  const barrel = barrelAt(game, 722, 338.75);
  for (let i = 0; i < 5; i++) game.step();
  barrel.vx = 3; barrel.resting = false;
  let teleported = false;
  let last = { x: barrel.x, y: barrel.y };
  for (let i = 0; i < 60; i++) {
    game.step();
    if (Math.abs(barrel.y - last.y) > 25) teleported = true;
    last = { x: barrel.x, y: barrel.y };
  }
  assert.equal(teleported, false, 'the exit was blocked');
  assert.ok(blocker, 'the blocker stayed in place');
});
