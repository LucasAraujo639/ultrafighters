'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const impact = require('../src/impact-dynamics.js');
const rigid = require('../src/rigid-impact.js');
const heavy = require('../src/heavy-props.js');
const hitbox = require('../src/fighter-hitbox.js');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'game.js'), 'utf8');
const noop = () => {};

function createGame() {
  const gradient = { addColorStop: noop };
  const ctx = new Proxy({ createLinearGradient: () => gradient, createRadialGradient: () => gradient },
    { get: (t, k) => (k in t ? t[k] : noop), set() { return true; } });
  const canvas = { width: 800, height: 600, getContext: () => ctx };
  const listeners = Object.create(null);
  const window = { addEventListener(type, cb) { listeners[type] = cb; }, requestAnimationFrame: noop };
  vm.runInNewContext(src, {
    window,
    SuperfightersRigidImpact: rigid,
    SuperfightersHeavyProps: heavy,
    SuperfightersImpactDynamics: impact,
    SuperfightersFighterHitbox: hitbox,
    document: { getElementById: () => canvas },
    performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  }, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  game.__listeners = listeners; // test-only: drive the keyboard
  return game;
}

// A clean arena: one solid floor, no props, fighters parked far away.
const FLOOR_Y = 500;
function emptyArena(game) {
  game.platforms.length = 0;
  game.platforms.push({ x: 0, y: FLOOR_Y, w: 800, h: 100, solidSides: true, cloud: false, ladder: false });
  game.crates.length = 0;
  game.barrels.length = 0;
  game.bullets.length = 0;
  game.players[0].x = 20; game.players[0].y = FLOOR_Y - game.players[0].h;
  game.players[1].x = 760; game.players[1].y = FLOOR_Y - game.players[1].h;
}

// Building a full game compiles the whole script in a fresh vm context. The
// sampling tests below need hundreds of runs, and that many contexts exhausts
// memory (node crashed with SIGSEGV), so they share one game and reset it.
let sharedGameInstance = null;
function resetFighter(fighter) {
  fighter.hp = 100; fighter.gibbed = false;
  fighter.knockbackRoll = false; fighter.knockbackRollFrame = 0; fighter.knockbackRollAngle = 0;
  fighter.knockedDown = false; fighter.rolling = false; fighter.falling = false; fighter.jumping = false;
  fighter.stunTimer = 0; fighter.hitFlash = 0; fighter.meleeRecoilVelocityX = 0;
  fighter.airVelocityX = 0; fighter.airVelocityY = 0;
  fighter.onGround = true; fighter.groundedCrate = null; fighter.groundedBarrel = null; fighter.groundedPlatform = null;
}
function arenaGame() {
  if (!sharedGameInstance) sharedGameInstance = createGame();
  const game = sharedGameInstance;
  emptyArena(game);
  for (const list of [game.weaponItems, game.explosions, game.grenades, game.gore, game.flames, game.propFragments, game.barrelDebris]) {
    if (list) list.length = 0;
  }
  game.players.forEach(resetFighter);
  game.players[0].x = 20; game.players[0].y = FLOOR_Y - game.players[0].h;
  game.players[1].x = 760; game.players[1].y = FLOOR_Y - game.players[1].h;
  return game;
}

function settledCrate(game, x, kind) {
  const crate = game.createCrate(x, FLOOR_Y, kind);
  for (let i = 0; i < 5; i++) game.step();
  crate.vx = 0; crate.spin = 0; crate.angle = 0;
  return crate;
}

// ---------- pure rules ----------

const box = { width: 20, height: 20, centerX: 0, centerY: 0, contactX: -10, dvx: 0.5 };

test('grounded shot: the upper half tips the box forward, the lower half rocks it back', () => {
  const high = impact.bulletResponse(Object.assign({}, box, { contactY: -8, grounded: true }));
  const low = impact.bulletResponse(Object.assign({}, box, { contactY: 8, grounded: true }));
  assert.ok(high.spin > 0, 'shot to the right, high: clockwise (top travels with the bullet)');
  assert.ok(low.spin < 0, 'shot to the right, low: counter-clockwise (top leans to the shooter)');
  assert.ok(Math.abs(high.spin) > Math.abs(low.spin), 'the floor absorbs most of a low hit\'s torque');
  assert.ok(low.dvx > box.dvx && high.dvx < box.dvx, 'low hits slide further, high hits trade slide for tipping');
});

test('grounded shot through the centre only slides; mirrored shots mirror the spin', () => {
  const centre = impact.bulletResponse(Object.assign({}, box, { contactY: 0, grounded: true }));
  assert.equal(centre.spin, 0);
  assert.equal(centre.dvx, box.dvx);
  const right = impact.bulletResponse(Object.assign({}, box, { contactY: -8, grounded: true }));
  const left = impact.bulletResponse(Object.assign({}, box, { contactY: -8, grounded: true, dvx: -0.5 }));
  assert.ok(Math.abs(right.spin + left.spin) < 1e-12);
});

test('airborne shot uses the free-body lever r x J', () => {
  const air = impact.bulletResponse(Object.assign({}, box, { contactY: -8, grounded: false }));
  assert.equal(air.spin, impact.freeBodySpin(20, 20, -10, -8, 0.5, 0));
  assert.equal(air.dvx, 0.5);
});

test('rotated box collider: a corner of the AABB is empty once the box tilts 45 degrees', () => {
  assert.ok(impact.pointInRotatedBox(9, 9, 0, 0, 20, 20, 0), 'upright: the corner is solid');
  assert.ok(!impact.pointInRotatedBox(9, 9, 0, 0, 20, 20, Math.PI / 4), 'tilted: that corner is air');
  assert.ok(impact.pointInRotatedBox(0, 13, 0, 0, 20, 20, Math.PI / 4), 'tilted: the lower vertex reaches further down');
});

test('overhang torque grows with how far the centre of mass hangs over the void', () => {
  const little = impact.overhangSpinAcceleration(1, 20, 20, 0.34);
  const lot = impact.overhangSpinAcceleration(8, 20, 20, 0.34);
  assert.ok(little > 0 && lot > little);
  assert.ok(impact.overhangSpinAcceleration(-8, 20, 20, 0.34) < 0, 'tips toward the side it overhangs');
  assert.equal(impact.overhangSpinAcceleration(0, 20, 20, 0.34), 0);
});

test('pair separation: shared by inverse mass, bounded per pass, immovable bodies never move', () => {
  const equal = impact.pairSeparation(4, 1, 1);
  assert.equal(equal.a, 2); assert.equal(equal.b, 2);
  const heavyRight = impact.pairSeparation(2, 1, 7);
  assert.ok(heavyRight.a > heavyRight.b * 6, 'the light body gives way');
  const deep = impact.pairSeparation(20, 1, 1);
  assert.equal(deep.a, impact.MAX_SEPARATION_PER_PASS, 'a deep overlap never resolves in one jump');
  const wall = impact.pairSeparation(4, 1, Infinity);
  assert.equal(wall.b, 0); assert.equal(wall.a, 3);
});

test('melee recoil: light props absorb the blow, heavier ones push back harder, bounded', () => {
  assert.equal(impact.meleeRecoilSpeed(1, 1.6), 0, 'a wooden crate gives way');
  const cement = impact.meleeRecoilSpeed(2, 1.6);
  const metal = impact.meleeRecoilSpeed(7, 1.6);
  const deck = impact.meleeRecoilSpeed(12, 1.6);
  assert.ok(cement > 0 && metal > cement && deck > metal);
  assert.ok(impact.meleeRecoilSpeed(1e9, 100) <= 2.2);
  let speed = metal;
  for (let i = 0; i < 40; i++) speed = impact.decayRecoil(speed);
  assert.equal(speed, 0, 'the rebound dies out');
});

const FIGHTER_BODY = { fighterWidth: 16.8, fighterHeight: 26.4, fighterFeetY: 500, gravity: 0.3375 };
function blow(overrides) {
  return impact.fighterKnockoverImpact(Object.assign({
    propMass: 1, propWidth: 20, propHeight: 20, propVx: 0, propSpin: 0, propCenterY: 490, towardFighter: 1
  }, FIGHTER_BODY, overrides));
}

test('knockover: only a blow whose impulse spins him past his own tipping energy knocks the fighter over', () => {
  const weak = blow({ propVx: 1.5 });  // a kicked crate
  const strong = blow({ propVx: 6 });  // a blast-launched crate
  assert.equal(weak.topples, false, 'a kicked crate only shoves him (' + weak.spin.toFixed(4) + ' < ' + weak.criticalSpin.toFixed(4) + ')');
  assert.equal(strong.topples, true, 'a flying crate knocks him over');
  assert.ok(Math.abs(weak.criticalSpin - impact.standingTipSpin(16.8, 26.4, 0.3375)) < 1e-12);
  assert.equal(blow({ propVx: -6 }).topples, false, 'moving away from him: no blow');
});

test('knockover: heavier props need less speed, a blow higher on his body has more lever', () => {
  const threshold = (overrides) => {
    let low = 0, high = 30;
    for (let i = 0; i < 40; i++) { const mid = (low + high) / 2; if (blow(Object.assign({ propVx: mid }, overrides)).topples) high = mid; else low = mid; }
    return high;
  };
  const wooden = threshold({ propMass: 1 });
  const metal = threshold({ propMass: 7 });
  assert.ok(metal < wooden, 'metal ' + metal.toFixed(2) + ' vs wooden ' + wooden.toFixed(2));
  assert.ok(threshold({ propCenterY: 478 }) < wooden, 'chest height topples him more easily than knee height');
  assert.ok(wooden > 1.6, 'no kick (<1.6 px/step) can do it: ' + wooden.toFixed(2));
});

test('knockover: the sweep of a spinning prop adds to its speed at the contact point', () => {
  // prop centre above his head: the contact is its lower part, which a
  // counter-clockwise spin (negative) swings toward him
  const still = blow({ propVx: 2, propCenterY: 470 });
  const sweeping = blow({ propVx: 2, propCenterY: 470, propSpin: -0.2 });
  assert.ok(sweeping.closingSpeed > still.closingSpeed);
  assert.ok(sweeping.impulse > still.impulse);
});

// ---------- in game ----------

test('in game: a high shot tips a resting crate toward the bullet, a low one rocks it back and slides it further', () => {
  const game = createGame();
  emptyArena(game);
  const high = settledCrate(game, 300);
  const low = settledCrate(game, 400);
  const shot = (c, y) => ({ x: c.x + 1, y: y, kind: 'bullet', pushAtContact: true });
  game.damageCrate(high, 0, 0.5, 0, shot(high, high.y + 3));
  game.damageCrate(low, 0, 0.5, 0, shot(low, low.y + low.h - 3));
  assert.ok(high.spin > 0, 'high shot from the left: clockwise, top forward');
  assert.ok(low.spin < 0, 'low shot from the left: counter-clockwise, top back');
  assert.ok(low.vx > high.vx, 'the low hit sweeps the base: more slide');
});

test('in game: a real bullet high on a crate pushes it and tilts it forward', () => {
  const game = createGame();
  emptyArena(game);
  const crate = settledCrate(game, 400);
  game.bullets.push({ x: crate.x - 2, y: crate.y + 3, vx: 6, vy: 0, damage: 1, crit: false, owner: 1, impulse: 1.05 });
  game.step();
  assert.equal(game.bullets.length, 0, 'the crate ate the bullet');
  assert.ok(crate.vx >= 0, 'never pushed back toward the shooter');
  assert.ok(crate.angle > 0 || crate.spin > 0, 'the heavy crate barely slides, but its top tips forward');
});

test('in game: punching a metal crate bounces the attacker back; a wooden crate does not', () => {
  for (const [kind, expectRecoil] of [['metalCrate', true], [null, false]]) {
    const game = createGame();
    emptyArena(game);
    const attacker = game.players[0];
    const prop = settledCrate(game, 300, kind);
    attacker.x = prop.x - attacker.w - 2; attacker.y = FLOOR_Y - attacker.h;
    attacker.lastDirX = 1; attacker.onGround = true;
    for (let i = 0; i < 3; i++) game.step();
    const startX = attacker.x;
    game.hitCratesInReach(attacker, 12, 0, game.meleePush.punchX, 0, 'punch');
    for (let i = 0; i < 12; i++) game.step();
    if (expectRecoil) assert.ok(attacker.x < startX - 0.5, kind + ': attacker rebounded (' + (startX - attacker.x) + ' px)');
    else assert.ok(Math.abs(attacker.x - startX) < 0.5, 'wooden crate: no rebound');
  }
});

function tumbleCrateOntoFighter(vx) {
  const game = arenaGame();
  const fighter = game.players[0];
  fighter.x = 300; fighter.y = FLOOR_Y - fighter.h; fighter.onGround = true;
  game.step();
  const crate = game.createCrate(fighter.x - 16, fighter.y + 8, null);
  crate.resting = false; crate.wasGrounded = false;
  crate.vx = vx; crate.vy = 2.5; crate.spin = 0.15;
  game.step();
  return fighter;
}

test('in game: a crate tumbling onto a fighter fast enough throws him into the knockback roll', () => {
  const fighter = tumbleCrateOntoFighter(5);
  assert.ok(fighter.knockbackRoll, 'the fast tumbling crate bowled him over');
  assert.ok(fighter.airVelocityX > 0, 'thrown along the crate\'s motion');
  assert.ok(!fighter.knockedDown);
});

test('in game: a crate tumbling onto him too slowly lacks the inertia: no knockback roll', () => {
  const fighter = tumbleCrateOntoFighter(1.0);
  assert.ok(!fighter.knockbackRoll, 'below the knock-over threshold');
});

test('in game: a straight drop still only knocks the fighter down (no roll)', () => {
  const game = createGame();
  emptyArena(game);
  const fighter = game.players[0];
  fighter.x = 300; fighter.y = FLOOR_Y - fighter.h; fighter.onGround = true;
  game.step();
  const crate = game.createCrate(fighter.x - 2, fighter.y + 4, null); // lands on his head: the overlap is clearly vertical
  crate.resting = false; crate.vx = 0; crate.vy = 4; crate.spin = 0;
  game.step();
  assert.ok(!fighter.knockbackRoll);
  assert.ok(fighter.knockedDown);
});

test('in game: overlapping crates separate by mass in bounded steps, never swapping sides', () => {
  const game = createGame();
  emptyArena(game);
  const light = settledCrate(game, 300);
  const metal = settledCrate(game, 340, 'metalCrate');
  light.x = metal.x - light.w + 12; // 12 px deep
  const lightStart = light.x;
  const metalStart = metal.x;
  game.step();
  assert.ok(light.x < lightStart, 'the light crate gives way');
  assert.ok(lightStart - light.x <= 3 * impact.MAX_SEPARATION_PER_PASS + 1e-9, 'no teleport: bounded by the passes');
  assert.ok(Math.abs(metal.x - metalStart) < lightStart - light.x, 'the metal crate barely moves');
  for (let i = 0; i < 10; i++) game.step();
  assert.ok(light.x + light.w / 2 < metal.x + metal.w / 2, 'order kept: no swap');
  assert.ok(light.x + light.w <= metal.x + 0.5, 'fully separated after a few steps');
});

test('in game: a crate hanging past an edge tips toward the void and falls', () => {
  const game = createGame();
  emptyArena(game);
  game.platforms.push({ x: 200, y: 400, w: 60, h: 10, solidSides: true, cloud: false, ladder: false });
  const crate = game.createCrate(255, 400, null); // 20 px crate: centre 5 px past the right edge (260)
  crate.y = 400 - crate.h;
  game.step();
  let maxSpin = 0;
  for (let i = 0; i < 60; i++) { game.step(); maxSpin = Math.max(maxSpin, crate.spin); }
  assert.ok(maxSpin > 0, 'tipped clockwise, over the right edge');
  assert.ok(crate.y > 400, 'fell off instead of hovering');
});

// ---------- every prop family: explosive barrels and table fragments ----------

function placeBarrel(game, x, yBottom) {
  const b = {
    x, y: yBottom - 19, w: 14, h: 19, sx: x, sy: yBottom - 19, vx: 0, vy: 0, angle: 0, spin: 0,
    mass: 3.5, baseW: 13.75, baseH: 18.75, burning: false, burnFuse: 0, resting: true
  };
  b.y = yBottom - 18.75; b.sy = b.y; b.w = 13.75; b.h = 18.75;
  game.barrels.push(b);
  return b;
}

test('in game: a shot high on a barrel tips it with the bullet, a low shot rocks it back', () => {
  const spins = { high: 0, low: 0 };
  const runs = 30; // the launch keeps a small random scatter: compare averages
  for (const where of ['high', 'low']) {
    for (let r = 0; r < runs; r++) {
      const game = arenaGame();
      const barrel = placeBarrel(game, 400, FLOOR_Y);
      for (let i = 0; i < 3; i++) game.step();
      barrel.spin = 0; barrel.angle = 0; barrel.vx = 0;
      const y = where === 'high' ? barrel.y + 2 : barrel.y + barrel.h - 2;
      game.bullets.push({ x: barrel.x - 1, y, vx: 6, vy: 0, damage: 1, crit: false, owner: 1, impulse: 0.6 });
      game.step();
      spins[where] += barrel.spin;
    }
  }
  assert.ok(spins.high / runs > 0.01, 'high hits tip it clockwise on average: ' + spins.high / runs);
  assert.ok(spins.low / runs < 0, 'low hits rock it the other way on average: ' + spins.low / runs);
});

test('in game: a barrel standing past an edge topples off instead of balancing', () => {
  const game = createGame();
  emptyArena(game);
  game.platforms.push({ x: 200, y: 400, w: 60, h: 10, solidSides: true, cloud: false, ladder: false });
  const barrel = placeBarrel(game, 255, 400); // centre at 262: 2 px past the edge
  for (let i = 0; i < 120; i++) game.step();
  assert.ok(barrel.y > 400, 'fell off the ledge');
});

test('in game: a tumbling barrel landing on a fighter throws him into the knockback roll', () => {
  const game = createGame();
  emptyArena(game);
  const fighter = game.players[0];
  fighter.x = 300; fighter.y = FLOOR_Y - fighter.h; fighter.onGround = true;
  fighter.knockedDown = false; fighter.knockbackRoll = false;
  game.step();
  const barrel = placeBarrel(game, fighter.x - 10, fighter.y + 12);
  barrel.resting = false; barrel.vx = 1.5; barrel.vy = 2.5; barrel.spin = 0.15;
  game.step();
  assert.ok(fighter.knockbackRoll, 'bowled over by the barrel');
});

test('in game: barrels pressed together separate in bounded steps, keeping their order', () => {
  const game = createGame();
  emptyArena(game);
  const left = placeBarrel(game, 300, FLOOR_Y);
  const right = placeBarrel(game, 310, FLOOR_Y); // 4 px deep
  game.step();
  assert.ok(left.x + left.w / 2 < right.x + right.w / 2, 'no swap');
  assert.ok(left.x > 300 - 3 * impact.MAX_SEPARATION_PER_PASS - 1e-9, 'no teleport');
  for (let i = 0; i < 5; i++) game.step();
  assert.ok(left.x + left.w <= right.x + 0.5, 'separated');
});

test('in game: a blast-fast table fragment never tunnels through a thin platform', () => {
  const game = createGame();
  emptyArena(game);
  game.platforms.push({ x: 300, y: 400, w: 100, h: 4, solidSides: true, cloud: false, ladder: false });
  const fragment = game.createPropFragment('tableFragmentB', 350, 380);
  fragment.vx = 0; fragment.vy = 14;
  for (let i = 0; i < 4; i++) game.step();
  assert.ok(fragment.y + fragment.h <= 400 + 1e-6, 'landed on the platform: bottom=' + (fragment.y + fragment.h));
});

// ---------- no pass-through: props pushed into props and into fighters ----------

function sideOf(a, b) { return Math.sign((a.x + a.w / 2) - (b.x + b.w / 2)); }
function verticalOverlap(a, b) { return Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y); }

test('side collision: momentum conserved, heavy bodies barely move, walls bounce back', () => {
  const equal = impact.sideCollisionVelocities(2, 1, 0, 1, 0);
  assert.equal(equal.a, 1); assert.equal(equal.b, 1);
  const heavyHit = impact.sideCollisionVelocities(2, 1, 0, 7, 0);
  assert.ok(Math.abs(1 * 2 - (1 * heavyHit.a + 7 * heavyHit.b)) < 1e-12);
  assert.ok(heavyHit.b < 0.3);
  const wall = impact.sideCollisionVelocities(2, 1, 0, Infinity, 0.5);
  assert.equal(wall.a, -1); assert.equal(wall.b, 0);
});

test('in game: punched props never pass through the prop beside them', () => {
  const kinds = [null, 'table', 'metalCrate', 'cementBarrel', 'barrel'];
  for (const moverKind of [null, 'table', 'cementBarrel']) {
    for (const otherKind of kinds) {
      for (let run = 0; run < 3; run++) {
        const game = arenaGame();
        const mover = game.createCrate(300, FLOOR_Y, moverKind);
        const other = otherKind === 'barrel' ? placeBarrel(game, 300 + mover.w, FLOOR_Y) : game.createCrate(300 + mover.w, FLOOR_Y, otherKind);
        for (let i = 0; i < 5; i++) game.step();
        const attacker = { x: 0, y: FLOOR_Y - 26, w: 16.8, h: 26.4, lastDirX: 1 };
        let side = sideOf(mover, other);
        for (let hit = 0; hit < 10; hit++) {
          attacker.x = mover.x - 20;
          game.damageCrate(mover, 0, game.meleePush.punchX * 2, 0, game.meleeContact(attacker, 'punch'));
          for (let i = 0; i < 15; i++) {
            game.step();
            const now = sideOf(mover, other);
            if (now !== side && verticalOverlap(mover, other) > 2) {
              assert.fail((moverKind || 'crate') + ' passed through ' + (otherKind || 'crate'));
            }
            side = now;
          }
        }
      }
    }
  }
});

test('in game: a prop driven into a fighter never passes through him, even pinned against a wall', () => {
  for (const pinned of [false, true]) {
    for (const kind of [null, 'table', 'metalCrate', 'cementBarrel']) {
      const game = arenaGame();
      if (pinned) game.platforms.push({ x: 380, y: 300, w: 40, h: 200, solidSides: true, cloud: false, ladder: false, shape: 'rect' });
      const fighter = game.players[0];
      const prop = game.createCrate(320, FLOOR_Y, kind);
      fighter.x = pinned ? 380 - fighter.w : prop.x + prop.w + 4;
      fighter.y = FLOOR_Y - fighter.h;
      for (let i = 0; i < 5; i++) game.step();
      const attacker = { x: 0, y: FLOOR_Y - 26, w: 16.8, h: 26.4, lastDirX: 1 };
      let side = sideOf(prop, fighter);
      let deepest = 0;
      for (let hit = 0; hit < 8; hit++) {
        attacker.x = prop.x - 20;
        game.damageCrate(prop, 0, game.meleePush.punchX * 4, 0, game.meleeContact(attacker, 'punch'));
        for (let i = 0; i < 20; i++) {
          game.step();
          const upright = !fighter.knockbackRoll && !fighter.knockedDown;
          const now = sideOf(prop, fighter);
          if (upright && now !== side && verticalOverlap(prop, fighter) > 3) assert.fail((kind || 'crate') + ' passed through the fighter');
          side = now;
          if (upright && verticalOverlap(prop, fighter) > 3) {
            deepest = Math.max(deepest, Math.min(prop.x + prop.w, fighter.x + fighter.w) - Math.max(prop.x, fighter.x));
          }
        }
      }
      assert.ok(deepest <= 1, (kind || 'crate') + (pinned ? ' (pinned)' : '') + ' sank ' + deepest.toFixed(1) + ' px into the fighter');
    }
  }
});

// ---------- gentle reactions to melee: no whirling props, no launched fighters ----------

function meleeOnProp(game, attacker, prop, hit) {
  attacker.x = Math.min(attacker.x, prop.x - attacker.w - 1);
  if (hit === 'kick') game.damageCrate(prop, 0, game.meleePush.kickX, -1.05, game.meleeContact(attacker, 'kick'));
  else game.hitCratesInReach(attacker, 12, 0, hit === 'punch' ? game.meleePush.punchX : game.meleePush.kickX, hit === 'punch' ? 0 : -1.05, hit);
}

test('in game: punches and kicks never whirl a heavy prop on its own axis', () => {
  for (const kind of [null, 'table', 'bouncer', 'cementBarrel', 'metalCrate']) {
    let fastest = 0;
    for (const hit of ['punch', 'kick', 'aerialKick']) {
      for (let run = 0; run < 8; run++) {
        const game = arenaGame();
        const attacker = game.players[0];
        const prop = game.createCrate(300, FLOOR_Y, kind);
        attacker.x = prop.x - attacker.w - 1; attacker.y = FLOOR_Y - attacker.h; attacker.lastDirX = 1;
        for (let i = 0; i < 5; i++) game.step();
        for (let blow = 0; blow < 3; blow++) {
          meleeOnProp(game, attacker, prop, hit);
          for (let i = 0; i < 40; i++) { game.step(); if (!prop.bouncing) fastest = Math.max(fastest, Math.abs(prop.spin)); }
        }
      }
    }
    assert.ok(fastest < 0.16, (kind || 'crate') + ' spun at ' + fastest.toFixed(3) + ' rad/step');
  }
});

test('in game: a cement barrel struck with a fighter right behind it rolls him gently, never the attacker', () => {
  let bystanderRolls = 0;
  let attackerRolls = 0;
  const runs = 20;
  for (const hit of ['punch', 'aerialKick']) { // the swings that go through hitCratesInReach
    for (let run = 0; run < 10; run++) {
      const game = arenaGame();
      const attacker = game.players[0];
      const bystander = game.players[1];
      const barrel = game.createCrate(300, FLOOR_Y, 'cementBarrel');
      attacker.x = barrel.x - attacker.w - 1; attacker.y = FLOOR_Y - attacker.h; attacker.lastDirX = 1;
      bystander.x = barrel.x + barrel.w + 1; bystander.y = FLOOR_Y - bystander.h;
      for (let i = 0; i < 5; i++) game.step();
      meleeOnProp(game, attacker, barrel, hit);
      let rolled = false;
      for (let i = 0; i < 60; i++) {
        game.step();
        for (const fighter of [attacker, bystander]) {
          if (!fighter.knockbackRoll) continue;
          assert.ok(Math.abs(fighter.airVelocityX) <= 1.1 + 1e-9, 'thrown at ' + fighter.airVelocityX);
          assert.ok(fighter.airVelocityY >= -0.45 - 1e-9, 'popped up at ' + fighter.airVelocityY);
        }
        if (bystander.knockbackRoll) rolled = true;
        if (attacker.knockbackRoll) attackerRolls++;
      }
      if (rolled) bystanderRolls++;
    }
  }
  assert.equal(bystanderRolls, runs, 'the blow travels through the drum into the fighter right behind it');
  assert.equal(attackerRolls, 0, 'the rebound of an ordinary blow lacks the inertia to knock the attacker over');
});

// ---------- weight: no hops under blows; the fuel barrel is the cement drum that rolls ----------

test('in game: blows give crates and drums a hop, not a jump: kicks under ~9 px, punches under ~22 px', () => {
  for (const kind of [null, 'cementBarrel', 'barrel']) {
    for (const hit of ['punch', 'kick', 'aerialKick']) {
      for (let run = 0; run < 5; run++) {
        const game = arenaGame();
        const attacker = game.players[0];
        const prop = kind === 'barrel' ? placeBarrel(game, 300, FLOOR_Y) : game.createCrate(300, FLOOR_Y, kind);
        attacker.x = prop.x - attacker.w - 1; attacker.y = FLOOR_Y - attacker.h; attacker.lastDirX = 1;
        for (let i = 0; i < 5; i++) game.step();
        const floorY = prop.y + prop.h;
        const push = hit === 'punch' ? game.meleePush.punchX : game.meleePush.kickX;
        const pushY = hit === 'punch' ? 0 : -1.05;
        if (kind === 'barrel') game.hitBarrelsInReach(attacker, 12, 0, push, pushY, hit);
        else game.hitCratesInReach(attacker, 12, 0, push, pushY, hit);
        let rise = 0;
        for (let i = 0; i < 60; i++) { game.step(); rise = Math.max(rise, floorY - (prop.y + prop.h)); }
        const ceiling = hit === 'punch' ? 22 : 9;
        assert.ok(rise < ceiling, (kind || 'crate') + ' ' + hit + ' hopped ' + rise.toFixed(1) + ' px');
        assert.ok(rise > 0.5 || hit !== 'punch', (kind || 'crate') + ' punch still lifts it a little');
      }
    }
  }
});

test('in game: a blow leaves a heavy prop leaning, not whirling: the spin of a hit bleeds off in the air', () => {
  for (const kind of [null, 'cementBarrel', 'barrel', 'table']) {
    for (const hit of ['punch', 'kick', 'aerialKick']) {
      let steadyTilt = 0;
      for (let run = 0; run < 6; run++) {
        const game = arenaGame();
        const attacker = game.players[0];
        const prop = kind === 'barrel' ? placeBarrel(game, 300, FLOOR_Y) : game.createCrate(300, FLOOR_Y, kind);
        attacker.x = prop.x - attacker.w - 1; attacker.y = FLOOR_Y - attacker.h; attacker.lastDirX = 1;
        for (let i = 0; i < 5; i++) game.step();
        const push = hit === 'punch' ? game.meleePush.punchX : game.meleePush.kickX;
        const pushY = hit === 'punch' ? 0 : -1.05;
        if (kind === 'barrel') game.hitBarrelsInReach(attacker, 12, 0, push, pushY, hit);
        else game.hitCratesInReach(attacker, 12, 0, push, pushY, hit);
        for (let i = 0; i < 90; i++) {
          game.step();
          const quarter = Math.PI / 2;
          steadyTilt = Math.max(steadyTilt, Math.abs(prop.angle - Math.round(prop.angle / quarter) * quarter));
        }
      }
      assert.ok(steadyTilt < 1.1, (kind || 'crate') + ' ' + hit + ' tilted ' + steadyTilt.toFixed(2) + ' rad');
    }
  }
});

test('in game: the fuel barrel has the cement drum hitbox, and it follows the rotated art', () => {
  const game = createGame();
  const cement = heavy.HEAVY_PROP_CONFIG.cementBarrel;
  const barrel = game.barrels[0];
  assert.equal(barrel.baseW, cement.width);
  assert.equal(barrel.baseH, cement.height);
  emptyArena(game);
  const tilted = placeBarrel(game, 300, FLOOR_Y);
  for (let i = 0; i < 3; i++) game.step();
  tilted.angle = Math.PI / 4; tilted.spin = 0;
  tilted.resting = false;
  game.step();
  const expected = heavy.rotatedExtent(cement.width, cement.height, tilted.angle);
  assert.ok(Math.abs(tilted.w - expected.w) < 0.6 && Math.abs(tilted.h - expected.h) < 0.6,
    'hitbox ' + tilted.w.toFixed(1) + 'x' + tilted.h.toFixed(1) + ' vs art ' + expected.w.toFixed(1) + 'x' + expected.h.toFixed(1));
});

test('in game: standing, the fuel barrel slides like the cement drum; lying on its side it rolls on', () => {
  const coast = (kind, lying) => {
    const game = createGame();
    emptyArena(game);
    const prop = kind === 'barrel' ? placeBarrel(game, 300, FLOOR_Y) : game.createCrate(300, FLOOR_Y, 'cementBarrel');
    if (lying) { prop.angle = Math.PI / 2; prop.pose = 1; prop.w = 18.75; prop.h = 13.75; prop.y = FLOOR_Y - prop.h; }
    for (let i = 0; i < 3; i++) game.step();
    const startX = prop.x;
    prop.vx = 2;
    for (let i = 0; i < 200; i++) game.step();
    return prop.x - startX;
  };
  const barrelUp = coast('barrel', false);
  const cementUp = coast('cement', false);
  assert.ok(Math.abs(barrelUp - cementUp) < 1, 'upright: same grip (' + barrelUp.toFixed(1) + ' vs ' + cementUp.toFixed(1) + ')');
  assert.ok(coast('barrel', true) > cementUp * 3, 'lying: the cylinder rolls much further');
  assert.ok(Math.abs(coast('cement', true) - cementUp) < 1, 'the cement drum always drags');
});

// ---------- configurable response multipliers per family (heavy-props.js) ----------

test('impact multipliers: the table matches the spec and can be tuned per family', () => {
  const plain = heavy.impactMultipliersFor(null);
  assert.deepEqual(plain, { vertical: 1.3, torque: 1.9, horizontal: 1.3 });
  const close = (row, expected, label) => {
    for (const axis of ['vertical', 'torque', 'horizontal']) {
      assert.ok(Math.abs(row[axis] - expected[axis]) < 1e-9, label + ' ' + axis + ': ' + row[axis] + ' vs ' + expected[axis]);
    }
  };
  // cement drum: previous +20/+80/+20 row, then -20 % lift, +40 % spin, +20 % slide
  close(heavy.impactMultipliersFor(heavy.HEAVY_PROP_CONFIG.cementBarrel), { vertical: 0.768, torque: 2.52, horizontal: 1.44 }, 'cement barrel');
  // fire barrel: the cement drum row, everything +30 %, then -20 % lift
  close(heavy.EXPLOSIVE_BARREL_IMPACT_MULTIPLIERS, { vertical: 0.768 * 1.3 * 0.8, torque: 2.52 * 1.3, horizontal: 1.44 * 1.3 }, 'fire barrel');
  // metal crate: previous +5/+30/+5 row, +20 % spin, then +20 % spin again
  close(heavy.impactMultipliersFor(heavy.HEAVY_PROP_CONFIG.metalCrate), { vertical: 1.05, torque: 1.56 * 1.2, horizontal: 1.05 }, 'metal crate');
  assert.deepEqual(heavy.impactMultipliersFor(heavy.HEAVY_PROP_CONFIG.table), heavy.NEUTRAL_IMPACT_MULTIPLIERS, 'untouched families stay neutral');
});

function averageKickResponse(game, kind, samples) {
  // one game for every sample: building hundreds of full games exhausts the vm contexts
  let slide = 0, hop = 0, spin = 0;
  const attacker = game.players[0];
  for (let run = 0; run < samples; run++) {
    game.crates.length = 0; game.barrels.length = 0;
    const prop = kind === 'barrel' ? placeBarrel(game, 300, FLOOR_Y) : game.createCrate(300, FLOOR_Y, kind);
    attacker.x = prop.x - attacker.w - 1; attacker.y = FLOOR_Y - attacker.h; attacker.lastDirX = 1;
    prop.vx = 0; prop.vy = 0; prop.spin = 0;
    if (kind === 'barrel') game.hitBarrelsInReach(attacker, 12, 0, game.meleePush.kickX, -1.05, 'kick');
    else game.damageCrate(prop, 0, game.meleePush.kickX, -1.05, game.meleeContact(attacker, 'kick'));
    slide += prop.vx; hop += -prop.vy; spin += Math.abs(prop.spin);
  }
  return { slide: slide / samples, hop: hop / samples, spin: spin / samples };
}

test('in game: crates, barrels and the metal crate respond to blows by exactly their multiplier rows', () => {
  const families = [
    { name: 'wooden crate', kind: null, row: heavy.PLAIN_CRATE_IMPACT_MULTIPLIERS },
    { name: 'metal crate', kind: 'metalCrate', row: heavy.HEAVY_PROP_CONFIG.metalCrate.impactMultipliers },
    { name: 'cement barrel', kind: 'cementBarrel', row: heavy.HEAVY_PROP_CONFIG.cementBarrel.impactMultipliers },
    { name: 'fuel barrel', kind: 'barrel', row: heavy.EXPLOSIVE_BARREL_IMPACT_MULTIPLIERS }
  ];
  const game = createGame();
  emptyArena(game);
  for (const family of families) {
    const tuned = { vertical: family.row.vertical, torque: family.row.torque, horizontal: family.row.horizontal };
    const withRow = averageKickResponse(game, family.kind, 250);
    family.row.vertical = 1; family.row.torque = 1; family.row.horizontal = 1; // mutate in place: the game reads these rows live
    let neutral;
    try { neutral = averageKickResponse(game, family.kind, 250); } finally { Object.assign(family.row, tuned); }
    const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < expected * 0.12,
      family.name + ' ' + label + ': x' + actual.toFixed(3) + ' vs expected x' + expected);
    near(withRow.slide / neutral.slide, tuned.horizontal, 'slide');
    near(withRow.hop / neutral.hop, tuned.vertical, 'hop');
    near(withRow.spin / neutral.spin, tuned.torque, 'spin');
  }
});

test('in game: explosions use the same rows (a blast hurls a crate and a barrel further when its row grows)', () => {
  const game = createGame();
  emptyArena(game);
  const launchAfterBlast = (kind) => {
    game.crates.length = 0; game.barrels.length = 0;
    const prop = kind === 'barrel' ? placeBarrel(game, 300, FLOOR_Y) : game.createCrate(300, FLOOR_Y, kind);
    prop.vx = 0; prop.vy = 0; prop.spin = 0;
    game.explodeAt(prop.x + prop.w / 2 - 22, prop.y + prop.h, 80, 0, 0);
    return Math.abs(prop.vx);
  };
  for (const [kind, row] of [[null, heavy.PLAIN_CRATE_IMPACT_MULTIPLIERS], ['barrel', heavy.EXPLOSIVE_BARREL_IMPACT_MULTIPLIERS]]) {
    const tuned = Object.assign({}, row);
    let strong = 0, weak = 0;
    for (let run = 0; run < 400; run++) strong += launchAfterBlast(kind);
    row.horizontal = 1;
    try { for (let run = 0; run < 400; run++) weak += launchAfterBlast(kind); } finally { Object.assign(row, tuned); }
    assert.ok(strong > weak * 1.05, (kind || 'crate') + ': ' + strong.toFixed(1) + ' vs ' + weak.toFixed(1));
  }
});

test('in game: bullets never move or tilt the metal crate, but still damage it', () => {
  const game = createGame();
  emptyArena(game);
  const crate = game.createCrate(300, FLOOR_Y, 'metalCrate');
  crate.vx = 0; crate.vy = 0; crate.spin = 0;
  const hpBefore = crate.hp;
  const startX = crate.x, startY = crate.y, startAngle = crate.angle || 0;
  for (const contactY of [crate.y + 2, crate.y + crate.h / 2, crate.y + crate.h - 2]) {
    game.damageCrate(crate, 20, 12, 0, { x: crate.x, y: contactY, kind: 'bullet', pushAtContact: true });
  }
  assert.equal(crate.vx, 0); assert.equal(crate.vy, 0); assert.equal(crate.spin, 0);
  for (let step = 0; step < 30; step++) game.step();
  assert.ok(Math.abs(crate.x - startX) < 0.01 && Math.abs(crate.y - startY) < 0.01, 'it stays put');
  assert.ok(Math.abs((crate.angle || 0) - startAngle) < 1e-6, 'no tilt');
  assert.ok(crate.hp < hpBefore, 'the shots still dent it');
  // a blow still moves it
  game.damageCrate(crate, 0, game.meleePush.kickX, -1.05, game.meleeContact(game.players[0], 'kick'));
  assert.ok(crate.vx !== 0 || crate.vy !== 0, 'melee still shoves it');
});

// ---------- continuous tipping: no angle snapping, gravity torque vs. angular inertia ----------

const DEG = Math.PI / 180;

test('tipping torque is continuous: zero exactly at the barrier, restoring below it, toppling above it', () => {
  const barrier = rigid.tipBarrier(20, 20); // 45 deg for a square
  assert.ok(Math.abs(rigid.tipAngularAcceleration(barrier, 20, 20, 0.3375)) < 1e-12);
  const below = rigid.tipAngularAcceleration(barrier - 0.01, 20, 20, 0.3375);
  const above = rigid.tipAngularAcceleration(barrier + 0.01, 20, 20, 0.3375);
  assert.ok(below < 0 && above > 0, 'back toward flat below the barrier, toward falling above it');
  assert.ok(Math.abs(below) < 1e-3 && Math.abs(above) < 1e-3, 'barely any torque next to the tipping point (no jump)');
  assert.ok(rigid.tipAngularAcceleration(-0.3, 20, 20, 0.3375) > 0, 'mirrored for the other side');
  assert.ok(Math.abs(rigid.tipAngularAcceleration(0.1, 20, 20, 0.3375)) > Math.abs(below) * 10, 'strongest when nearly flat');
});

test('ground rotation never snaps: the angle moves exactly by the angular velocity on every step', () => {
  for (const start of [44, 46, 30, 60]) {
    const state = { angle: start * DEG, spin: 0, pose: undefined };
    let previousAngle = state.angle;
    let rested = false;
    for (let step = 0; step < 400 && !rested; step++) {
      const poseBefore = state.pose;
      rested = rigid.stepGroundRotation(state, 20, 20, 0.1);
      const moved = state.angle - previousAngle;
      if (!rested) {
        assert.ok(Math.abs(moved) < 8 * DEG, start + ' deg: jumped ' + (moved / DEG).toFixed(1) + ' deg in one step');
        void poseBefore; // a face landing keeps part of the spin; the angle never jumps either way
      }
      previousAngle = state.angle;
    }
    assert.ok(rested, start + ' deg ends at rest');
  }
});

test('ground rotation conserves angular velocity: no damping, only gravity changes it', () => {
  const state = { angle: 0.3, spin: 0.04, pose: 0 };
  const expected = 0.04 + rigid.tipAngularAcceleration(0.3, 20, 20, 0.3375);
  rigid.stepGroundRotation(state, 20, 20, 0.3375);
  assert.ok(Math.abs(state.spin - expected) < 1e-12, 'spin ' + state.spin + ' vs gravity-only ' + expected);
  assert.ok(Math.abs(state.angle - (0.3 + expected)) < 1e-12, 'the angle follows the velocity');
});

test('inertia against gravity: enough angular energy rolls past the tipping point, too little swings back', () => {
  const run = (spin) => {
    const state = { angle: 0.3, spin, pose: 0 };
    let peak = state.angle;
    for (let step = 0; step < 600; step++) {
      if (rigid.stepGroundRotation(state, 20, 20, 0.3375)) break;
      peak = Math.max(peak, state.angle);
    }
    return { peak, finalPose: state.pose, angle: state.angle };
  };
  const weak = run(0.03);
  const strong = run(0.08);
  assert.ok(weak.peak < rigid.tipBarrier(20, 20), 'a weak push stays under the barrier');
  assert.equal(weak.finalPose, 0, 'and gravity returns it to its base');
  assert.ok(strong.peak > rigid.tipBarrier(20, 20), 'a strong push crosses the barrier');
  assert.equal(strong.finalPose, 1, 'and it finishes lying on its side');
  assert.ok(Math.abs(strong.angle - Math.PI / 2) < 1e-9);
});

test('a face meeting the floor keeps spin like a rigid rocking block: slender boxes keep more, squat ones stop', () => {
  const slender = rigid.faceLandingTransfer(14, 19);
  const square = rigid.faceLandingTransfer(20, 20);
  const squat = rigid.faceLandingTransfer(18, 10);
  assert.ok(slender > square && square > squat);
  assert.ok(Math.abs(square - 0.25) < 1e-9);
  assert.equal(squat, 0);
});

test('in game: a barrel past its barrier falls with a smooth, continuous angular velocity', () => {
  const game = createGame();
  emptyArena(game);
  const barrel = placeBarrel(game, 300, FLOOR_Y);
  for (let i = 0; i < 3; i++) game.step();
  barrel.angle = 40 * DEG; barrel.spin = 0; barrel.resting = false; barrel.wasGrounded = true;
  let previousSpin = barrel.spin;
  let largestChange = 0;
  for (let i = 0; i < 120; i++) {
    game.step();
    // the fall itself: the velocity only changes by what gravity adds each step
    // (the impact of its side meeting the floor, at the very end, is a separate event)
    if (barrel.angle < 80 * DEG) largestChange = Math.max(largestChange, Math.abs(barrel.spin - previousSpin));
    previousSpin = barrel.spin;
  }
  assert.ok(Math.abs(barrel.angle - Math.PI / 2) < 1e-6, 'it ended lying on its side');
  assert.ok(largestChange < 0.01, 'angular velocity changed by ' + largestChange.toFixed(4) + ' in a step during the fall');
});

test('in game: a crate tilted just under / just over 45 deg returns or falls, never jumps; the hitbox rises smoothly', () => {
  for (const [startDeg, expectedTurns] of [[40, 0], [50, 1]]) {
    const game = createGame();
    emptyArena(game);
    const crate = settledCrate(game, 400);
    crate.angle = startDeg * DEG; crate.spin = 0; crate.resting = false; crate.wasGrounded = true;
    let previousAngle = crate.angle;
    let previousBottom = crate.y + crate.h;
    for (let i = 0; i < 200; i++) {
      game.step();
      assert.ok(Math.abs(crate.angle - previousAngle) < 8 * DEG, startDeg + ' deg: angle jump');
      assert.ok(Math.abs(crate.y + crate.h - previousBottom) < 0.5, 'it never leaves the floor or sinks into it');
      previousAngle = crate.angle;
      previousBottom = crate.y + crate.h;
    }
    assert.ok(Math.abs(crate.angle - expectedTurns * Math.PI / 2) < 1e-6, startDeg + ' deg ends at ' + expectedTurns + ' quarter turns');
  }
});

// ---------- rider inertia: a fighter on a prop rocks it a little ----------

test('rider on a top face: the feet push the face opposite to his acceleration; his weight leans it toward him', () => {
  const box = { width: 20, height: 20, propMass: 1 };
  const speedingRight = impact.riderSurfaceSpin(Object.assign({ accelX: 1 }, box));
  const brakingRight = impact.riderSurfaceSpin(Object.assign({ accelX: -1 }, box));
  assert.ok(speedingRight < 0 && brakingRight > 0, 'the top is dragged back against the push-off');
  assert.ok(impact.riderSurfaceSpin(Object.assign({ landingVy: 4, offsetX: 6 }, box)) > 0, 'a landing right of centre leans it right');
  assert.ok(impact.riderSurfaceSpin(Object.assign({ landingVy: 4, offsetX: -6 }, box)) < 0, '...left of centre, left');
  assert.equal(impact.riderSurfaceSpin(Object.assign({ landingVy: 4, offsetX: 0 }, box)), 0, 'a centred landing only presses down');
  assert.equal(impact.riderSurfaceSpin(Object.assign({}, box)), 0, 'standing still does nothing');
  const light = Math.abs(impact.riderSurfaceSpin({ width: 20, height: 20, propMass: 1, accelX: 0.3 }));
  const heavyProp = Math.abs(impact.riderSurfaceSpin({ width: 20, height: 20, propMass: 7, accelX: 0.3 }));
  assert.ok(heavyProp < light / 5, 'a heavier prop rocks far less');
  assert.ok(Math.abs(impact.riderSurfaceSpin(Object.assign({ accelX: 50 }, box))) <= impact.RIDER_MAX_SPIN, 'footwork spin is capped');
  assert.ok(Math.abs(impact.riderSurfaceSpin(Object.assign({ landingVy: 50, offsetX: 9 }, box))) <= impact.RIDER_LANDING_MAX_SPIN, 'landing spin is capped');
  assert.equal(impact.addRiderSpin(0.2, 0.01), 0.2, 'a rider never speeds up a prop already spinning faster than the cap');
  assert.ok(Math.abs(impact.addRiderSpin(-0.2, 0.01) + 0.19) < 1e-12, 'but can slow it down');
});

function riderOnProp(game, kind) {
  const prop = kind === 'barrel' ? placeBarrel(game, 300, FLOOR_Y) : game.createCrate(300, FLOOR_Y, kind);
  for (let i = 0; i < 10; i++) game.step();
  return prop;
}

test('in game: landing off-centre on a crate or a barrel rocks it a few degrees, then it settles flat in place', () => {
  for (const kind of [undefined, 'cementBarrel', 'barrel']) {
    const game = arenaGame();
    const fighter = game.players[0];
    const prop = riderOnProp(game, kind);
    const startX = prop.x;
    fighter.x = prop.x + prop.w - fighter.w * 0.5 - 1; fighter.y = prop.y - fighter.h - 40;
    fighter.onGround = false; fighter.airVelocityY = 0;
    let maxTilt = 0;
    for (let step = 0; step < 120; step++) { game.step(); maxTilt = Math.max(maxTilt, Math.abs(prop.angle || 0)); }
    const label = kind || 'crate';
    assert.ok(maxTilt > 0.5 * DEG && maxTilt < 4 * DEG, label + ': a small rock (' + (maxTilt / DEG).toFixed(2) + ' deg)');
    assert.ok(Math.abs(prop.angle || 0) < 1e-6, label + ': back flat');
    assert.ok(Math.abs(prop.x - startX) < 0.5, label + ': it rocks in place, it does not slide');
  }
});

test('in game: a fighter just standing on a prop leaves it still; the heavy metal crate barely feels a landing', () => {
  const game = arenaGame();
  const fighter = game.players[0];
  const crate = riderOnProp(game, undefined);
  fighter.x = crate.x + crate.w / 2 - fighter.w / 2 + 4; fighter.y = crate.y - fighter.h; fighter.onGround = true;
  for (let step = 0; step < 60; step++) game.step();
  assert.ok(Math.abs(crate.angle || 0) < 0.6 * DEG, 'standing still: no rocking');

  const game2 = arenaGame();
  const rider = game2.players[0];
  const metal = riderOnProp(game2, 'metalCrate');
  rider.x = metal.x + metal.w - rider.w * 0.5 - 1; rider.y = metal.y - rider.h - 40;
  rider.onGround = false; rider.airVelocityY = 0;
  let maxTilt = 0;
  for (let step = 0; step < 120; step++) { game2.step(); maxTilt = Math.max(maxTilt, Math.abs(metal.angle || 0)); }
  assert.ok(maxTilt < 1 * DEG, 'metal crate: ' + (maxTilt / DEG).toFixed(2) + ' deg');
});

// ---------- inertia decides the tip-over, not the 45 deg barrier alone ----------

const TIP_GRAVITY = 0.3375 * 0.3;

test('critical tip spin: the rotational energy needed to lift the centre of mass over the pivot', () => {
  const flat = rigid.criticalTipSpin(0, 20, 20, TIP_GRAVITY);
  const tilted = rigid.criticalTipSpin(30 * DEG, 20, 20, TIP_GRAVITY);
  assert.ok(flat > tilted && tilted > 0, 'the closer to the barrier, the less inertia it takes');
  assert.equal(rigid.criticalTipSpin(46 * DEG, 20, 20, TIP_GRAVITY), 0, 'past the barrier gravity does the rest');
  assert.ok(rigid.criticalTipSpin(0, 13.75, 18.75, TIP_GRAVITY) < flat, 'a slender drum tips over more easily than a square crate');
});

test('inertia, not the angle: from flat or from a small tilt, enough angular velocity rolls the box over and too little rocks it back', () => {
  for (const startDeg of [0, 10, 25]) {
    const critical = rigid.criticalTipSpin(startDeg * DEG, 20, 20, TIP_GRAVITY);
    for (const [factor, shouldTopple] of [[1.08, true], [0.92, false]]) {
      const state = { angle: startDeg * DEG, spin: critical * factor, pose: 0 };
      assert.equal(rigid.hasTipMomentum(state, 20, 20, TIP_GRAVITY), shouldTopple, startDeg + ' deg x' + factor + ': prediction');
      let maxAngle = 0;
      for (let step = 0; step < 600; step++) {
        if (rigid.stepGroundRotation(state, 20, 20, TIP_GRAVITY)) break;
        maxAngle = Math.max(maxAngle, state.angle);
      }
      assert.equal(state.pose === 1, shouldTopple, startDeg + ' deg x' + factor + ': toppled=' + (state.pose === 1) + ' (peak ' + (maxAngle / DEG).toFixed(1) + ' deg)');
    }
  }
});

test('inertia toward flat: a box swinging back must still have the energy to climb the far edge after its face hits the floor', () => {
  const back = { angle: 20 * DEG, spin: -0.01, pose: 0 };
  assert.equal(rigid.hasTipMomentum(back, 20, 20, TIP_GRAVITY), false, 'a gentle swing back only rocks');
  const hard = { angle: 20 * DEG, spin: -0.2, pose: 0 };
  assert.equal(rigid.hasTipMomentum(hard, 13.75, 18.75, TIP_GRAVITY), true, 'a violent one rolls over the other edge');
});

test('a blow keeps part of the spin above the usual cap, never past the hard ceiling and never slowing a faster spin', () => {
  assert.equal(rigid.inertialHitSpin(0, 0.02, 0.05, 0.08), 0.02, 'under the cap: in full');
  const strong = rigid.inertialHitSpin(0, 0.1, 0.05, 0.08);
  assert.ok(Math.abs(strong - (0.05 + 0.05 * rigid.EXCESS_HIT_SPIN_SHARE)) < 1e-12, 'over it: a share of the surplus');
  assert.equal(rigid.inertialHitSpin(0, 5, 0.05, 0.08), 0.08, 'hard ceiling');
  assert.equal(rigid.inertialHitSpin(0, -5, 0.05, 0.08), -0.08, 'both ways');
  assert.equal(rigid.inertialHitSpin(0.07, 0.01, 0.05, 0.08), 0.07, 'a faster spin is never cut down by a blow');
});

test('in game: a hop keeps the spin that has the inertia to topple the prop; only a weak rocking spin bleeds off in the air', () => {
  const game = arenaGame();
  const crate = game.createCrate(300, FLOOR_Y);
  for (let i = 0; i < 5; i++) game.step();
  const critical = rigid.criticalTipSpin(0, crate.baseW || crate.w, crate.baseH || crate.h, TIP_GRAVITY);
  crate.y -= 30; crate.vy = -1; crate.spin = critical * 1.2; crate.resting = false; crate.wasGrounded = false;
  game.step();
  assert.ok(Math.abs(crate.spin) > critical * 1.15, 'strong spin kept: ' + crate.spin.toFixed(4));
  const weak = game.createCrate(500, FLOOR_Y);
  for (let i = 0; i < 5; i++) game.step();
  weak.y -= 30; weak.vy = -1; weak.spin = critical * 0.4; weak.resting = false; weak.wasGrounded = false;
  const before = weak.spin;
  game.step(); game.step();
  assert.ok(Math.abs(weak.spin) < Math.abs(before) * 0.95, 'weak spin bleeds');
});

// ---------- the hanging deck: a physical pendulum ----------

test('hanging pendulum: gravity sets a heavy, slow period; the swing is bounded by energy and never stops dead', () => {
  const config = heavy.HEAVY_PROP_CONFIG.hanging;
  const swingLength = config.ropeLength + config.height / 2;
  const input = { gravity: 0.3375, swingLength, riders: [] };
  const state = { angle: 0.05, omega: 0 };
  const expectedPeriod = 2 * Math.PI * Math.sqrt(heavy.pendulumInertia(config, swingLength) / (config.mass * 0.3375 * swingLength));
  let crossings = [];
  for (let step = 0; step < 400; step++) {
    const before = state.angle;
    heavy.pendulumStep(state, input, config, 1);
    if ((before > 0) !== (state.angle > 0)) crossings.push(step);
  }
  const period = 2 * (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
  assert.ok(Math.abs(period - expectedPeriod) < expectedPeriod * 0.06, 'period ' + period.toFixed(1) + ' vs ' + expectedPeriod.toFixed(1));
  // a huge kick: it peaks at swayMaxAngle and turns back smoothly, no clamp-and-stop
  const kicked = { angle: 0, omega: 0.5 };
  let peak = 0, worstJump = 0, previousOmega = null;
  for (let step = 0; step < 200; step++) {
    heavy.pendulumStep(kicked, input, config, 1);
    peak = Math.max(peak, Math.abs(kicked.angle));
    if (previousOmega !== null && step > 0) worstJump = Math.max(worstJump, Math.abs(kicked.omega - previousOmega));
    previousOmega = kicked.omega;
  }
  assert.ok(peak <= config.swayMaxAngle + 1e-9, 'bounded: ' + peak);
  assert.ok(peak > config.swayMaxAngle * 0.9, 'it still uses the room it has');
  assert.ok(worstJump < 0.01, 'the angular velocity changes smoothly (' + worstJump.toFixed(4) + ')');
});

test('hanging pendulum: a weight right of the pivot leans the deck that way; centred, it hangs straight', () => {
  const config = heavy.HEAVY_PROP_CONFIG.hanging;
  const swingLength = config.ropeLength + config.height / 2;
  const settle = (offsetX) => {
    const state = { angle: 0, omega: 0 };
    const input = { gravity: 0.3375, swingLength, riders: [{ mass: impact.FIGHTER_MASS, offsetX, depth: config.ropeLength }] };
    for (let step = 0; step < 3000; step++) heavy.pendulumStep(state, input, config, 1);
    return state.angle;
  };
  const right = settle(15);
  assert.ok(right < 0, 'right side dips (swing angle < 0): ' + right);
  // statics: the combined centre of mass sits under the pivot
  const expected = -Math.asin(impact.FIGHTER_MASS * 15 / (config.mass * swingLength));
  assert.ok(Math.abs(right - expected) < 0.002, right.toFixed(4) + ' vs ' + expected.toFixed(4));
  assert.ok(Math.abs(settle(0)) < 1e-9, 'centred: straight');
});

test('in game: a shot low on the hanging deck swings it more than one next to the rope', () => {
  const swing = (lowShot) => {
    const game = createGame();
    for (const item of game.weaponItems) item.taken = true;
    const deck = game.crates.find((c) => c.anchor);
    game.step();
    game.bullets.push({ x: deck.x + 4, y: lowShot ? deck.y + deck.h - 2 : deck.y + 2, vx: 12, vy: 0, damage: 10, owner: 99, life: 50 });
    let peak = 0;
    for (let step = 0; step < 80; step++) { game.step(); peak = Math.max(peak, Math.abs(deck.anchor.angle)); }
    assert.equal(deck.anchor.released, false);
    return peak;
  };
  const low = swing(true), high = swing(false);
  assert.ok(low > high * 1.5, 'low ' + low.toFixed(4) + ' vs high ' + high.toFixed(4));
});

// ---------- riding a kicked prop: inertia keeps the fighter in place ----------

test('foot friction: a slow support is matched, a jerked one slips under the feet by at most mu g per step', () => {
  const grip = impact.RIDER_FOOT_FRICTION * 0.3375;
  assert.equal(impact.frictionCarrySpeed(0, grip * 0.5, 0.3375), grip * 0.5, 'within the grip: he moves with the face');
  assert.ok(Math.abs(impact.frictionCarrySpeed(0, 2, 0.3375) - grip) < 1e-12, 'a kick: he only gains mu g');
  assert.ok(Math.abs(impact.frictionCarrySpeed(1, 0, 0.3375) - (1 - grip)) < 1e-12, 'the face stops: friction brakes his drift');
  assert.ok(Math.abs(impact.frictionCarrySpeed(-1, 0, 0.3375) + (1 - grip)) < 1e-12, 'both ways');
});

function kickPropUnderRider(kind) {
  const game = arenaGame();
  const rider = game.players[0];
  const kicker = game.players[1];
  const prop = kind === 'barrel' ? placeBarrel(game, 300, FLOOR_Y) : game.createCrate(300, FLOOR_Y, kind);
  for (let step = 0; step < 5; step++) game.step();
  rider.x = prop.x + prop.w / 2 - rider.w / 2; rider.y = prop.y - rider.h; rider.onGround = true;
  kicker.x = prop.x - kicker.w - 1; kicker.y = FLOOR_Y - kicker.h; kicker.lastDirX = 1;
  for (let step = 0; step < 10; step++) game.step();
  const propStart = prop.x, riderStart = rider.x;
  if (kind === 'barrel') game.hitBarrelsInReach(kicker, 12, 0, game.meleePush.kickX, -1.05, 'kick');
  else game.hitCratesInReach(kicker, 12, 0, game.meleePush.kickX, -1.05, 'kick');
  let worstJump = 0, previousX = rider.x;
  for (let step = 0; step < 60; step++) {
    game.step();
    kicker.x = 20; kicker.y = FLOOR_Y - kicker.h;
    worstJump = Math.max(worstJump, Math.abs(rider.x - previousX));
    previousX = rider.x;
  }
  return { prop: prop.x - propStart, rider: rider.x - riderStart, worstJump };
}

test('in game: kicking the prop a fighter stands on moves the prop; his inertia keeps him nearly in place', () => {
  for (const kind of [undefined, 'cementBarrel', 'barrel']) {
    let prop = 0, rider = 0, worstJump = 0;
    const runs = 12;
    for (let run = 0; run < runs; run++) {
      const result = kickPropUnderRider(kind);
      prop += result.prop; rider += result.rider; worstJump = Math.max(worstJump, result.worstJump);
    }
    const label = kind || 'crate';
    assert.ok(prop / runs > 4, label + ': the kicked prop slides (' + (prop / runs).toFixed(1) + ' px)');
    assert.ok(rider / runs < prop / runs * 0.5, label + ': the rider stays behind (' + (rider / runs).toFixed(1) + ' vs ' + (prop / runs).toFixed(1) + ' px)');
    assert.ok(rider / runs > -0.5, label + ': and is never thrown backwards');
    assert.ok(worstJump < 2, label + ': no sideways shove or teleport (' + worstJump.toFixed(2) + ' px in one step)');
  }
});

test('cement drum family: a kick hops within a narrow band (no tiny hop one time and a vault the next)', () => {
  const rigid = require('../src/rigid-impact.js');
  const heavy = require('../src/heavy-props.js');
  const scale = heavy.HEAVY_PROP_CONFIG.cementBarrel.hitVariationScale;
  assert.equal(heavy.HEAVY_PROP_CONFIG.bouncer.hitVariationScale, scale, 'bouncer shares the drum wobble');
  const spreadOf = (spreadScale) => {
    let low = Infinity; let high = -Infinity;
    for (let sample = 0; sample <= 200; sample++) {
      const seq = [sample / 200, 0.5, 1 - sample / 200, 0.3, 0.7];
      let i = 0;
      const hit = rigid.varyHit({ pushX: 4, pushY: -1.05, x: 0, y: 0 }, 'melee', () => seq[i++ % seq.length], spreadScale);
      low = Math.min(low, hit.pushY); high = Math.max(high, hit.pushY);
    }
    return high - low;
  };
  assert.ok(spreadOf(scale) < spreadOf(undefined) * 0.5, 'drum kicks wobble far less than a plain crate');
});

test('metal crate (sprite 134): 20 % lighter, wobbles far less than the drums, still heavier than any drum', () => {
  const heavy = require('../src/heavy-props.js');
  const metal = heavy.HEAVY_PROP_CONFIG.metalCrate;
  assert.ok(Math.abs(metal.mass - 7 * 0.8) < 1e-9, 'mass ' + metal.mass);
  assert.ok(metal.hitVariationScale <= 0.1, 'near-constant hits');
  assert.ok(metal.hitVariationScale < heavy.HEAVY_PROP_CONFIG.cementBarrel.hitVariationScale);
  assert.ok(metal.mass > heavy.HEAVY_PROP_CONFIG.cementBarrel.mass);
});

// Regression: a drum rolling off the end of the indoor floor onto the first stair
// tread (0.5 px higher than the floor) read as already inside the surface, was pushed
// sideways and then fell through the floor out of the map (removed below y 620).
test('a drum rolling off the floor edge onto the stair treads never falls out of the map', () => {
  const game = createGame(); // the real map, with the physics rule modules
  for (const item of game.weaponItems) item.taken = true;
  const FLOOR_TOP = 446.75;
  const BARREL = { w: 13.75, h: 18.75 };
  let fell = 0;
  for (const angle of [1.2, 1.6, 2.0, 2.4]) {
    for (const vx of [0.5, 0.9, 1.3]) {
      for (const x of [592, 596, 599]) {
        game.barrels.length = 0;
        const b = {
          x, y: FLOOR_TOP - BARREL.h, w: BARREL.w, h: BARREL.h, vx, vy: 0, angle, spin: 0,
          baseW: BARREL.w, baseH: BARREL.h, burning: false, burnFuse: 0, resting: false
        };
        game.barrels.push(b);
        for (let frame = 0; frame < 200; frame++) {
          game.step();
          if (game.barrels.indexOf(b) < 0 || b.y > 600) { fell++; break; }
        }
      }
    }
  }
  assert.equal(fell, 0, fell + ' of 36 drums fell out of the map');
});

// ---------- a blow on a prop with a fighter right behind it ----------

function blowWithFighterBehind(kind, strength, gapBehind) {
  const game = arenaGame();
  const [attacker, covered] = game.players;
  const prop = settledCrate(game, 400, kind);
  attacker.x = prop.x - attacker.w - 1; attacker.lastDirX = 1;
  covered.x = prop.x + prop.w + gapBehind; covered.y = FLOOR_Y - covered.h;
  game.hitCratesInReach(attacker, 12, 0, game.meleePush.kickX * strength, -1.05, 'kick');
  const result = { game, attacker, covered, prop, coveredRolled: covered.knockbackRoll, attackerRolled: false, lowestVx: 0 };
  for (let i = 0; i < 60; i++) {
    game.step();
    if (attacker.knockbackRoll) result.attackerRolled = true;
    result.lowestVx = Math.min(result.lowestVx, prop.vx);
  }
  return result;
}

test('blocked blow rule: the prop gives back a share of the blow speed, never more', () => {
  assert.equal(impact.blockedBlowReboundSpeed(2), 2 * impact.BLOCKED_BLOW_RESTITUTION);
  assert.ok(impact.BLOCKED_BLOW_RESTITUTION > 0 && impact.BLOCKED_BLOW_RESTITUTION < 1);
  assert.equal(impact.blockedBlowReboundSpeed(-1), 0);
});

test('in game: a fighter right behind the struck prop rolls, and the prop rebounds toward the attacker', () => {
  for (const kind of [null, 'cementBarrel', 'bouncer', 'metalCrate']) {
    const hit = blowWithFighterBehind(kind, 1, 1);
    assert.ok(hit.coveredRolled, (kind || 'crate') + ': the fighter behind it rolls');
    assert.ok(hit.lowestVx < -0.2, (kind || 'crate') + ': the prop came back toward the attacker (' + hit.lowestVx.toFixed(2) + ')');
  }
});

test('in game: an ordinary kick rebound lacks the inertia to roll the attacker; a hard blow has it', () => {
  assert.ok(!blowWithFighterBehind(null, 1, 1).attackerRolled, 'ordinary kick: shoved at most');
  assert.ok(blowWithFighterBehind(null, 6, 1).attackerRolled, 'hard blow: the rebound bowls him over too');
  assert.ok(blowWithFighterBehind(null, 4, 1).attackerRolled && !blowWithFighterBehind('metalCrate', 4, 1).attackerRolled, 'a heavy crate gets back far less speed than a plain one for the same blow');
});

test('in game: a fighter well away from the struck prop is not bowled over by it', () => {
  const hit = blowWithFighterBehind(null, 1, 30);
  assert.ok(!hit.coveredRolled, 'not in contact with the prop');
});

test('in game: a fighter standing ON the struck prop is not "behind" it', () => {
  const game = arenaGame();
  const [attacker, rider] = game.players;
  const prop = settledCrate(game, 400, null);
  rider.x = prop.x + 2; rider.y = prop.y - rider.h; rider.onGround = true; rider.groundedCrate = prop;
  attacker.x = prop.x - attacker.w - 1; attacker.lastDirX = 1;
  game.hitCratesInReach(attacker, 12, 0, game.meleePush.kickX, -1.05, 'kick');
  assert.ok(!rider.knockbackRoll);
});

test('in game: the same goes for a fuel barrel with a fighter behind it', () => {
  const game = arenaGame();
  const [attacker, covered] = game.players;
  const barrel = placeBarrel(game, 400, FLOOR_Y);
  for (let i = 0; i < 5; i++) game.step();
  attacker.x = barrel.x - attacker.w - 1; attacker.lastDirX = 1;
  covered.x = barrel.x + barrel.w + 1; covered.y = FLOOR_Y - covered.h;
  game.hitBarrelsInReach(attacker, 12, 0, game.meleePush.kickX, -1.05, 'kick');
  assert.ok(covered.knockbackRoll, 'the fighter behind the barrel rolls');
  assert.ok(barrel.vx < 0, 'the barrel rebounds toward the attacker');
});

// ---------- head bump: a jumping fighter hits a prop's underside ----------

test('head bump rule: a light prop is thrown up faster than a heavy one, which sends the fighter back down', () => {
  const base = { fighterRiseSpeed: 5, propWidth: 20, propCenterX: 0, headCenterX: 0, anchored: false };
  const light = impact.headBumpOutcome(Object.assign({}, base, { propMass: 1 }));
  const heavyProp = impact.headBumpOutcome(Object.assign({}, base, { propMass: 8 }));
  assert.ok(light.propVy < heavyProp.propVy && light.propVy < 0 && heavyProp.propVy < 0, 'both go up, the light one faster');
  assert.ok(light.fighterRise > 0, 'a light prop lets him keep rising');
  assert.ok(heavyProp.fighterRise < 0, 'a heavy prop knocks his rise back down');
  assert.equal(light.propVx, 0, 'dead centre: no sideways nudge');
});

test('head bump rule: the prop slides a little AWAY from the side the head hit, never more than a fraction of its rise', () => {
  const base = { fighterRiseSpeed: 5, propMass: 1, propWidth: 20, propCenterX: 0 };
  const headUnderLeft = impact.headBumpOutcome(Object.assign({}, base, { headCenterX: -8 }));
  const headUnderRight = impact.headBumpOutcome(Object.assign({}, base, { headCenterX: 8 }));
  assert.ok(headUnderLeft.propVx > 0 && headUnderRight.propVx < 0);
  assert.ok(Math.abs(headUnderLeft.propVx) < Math.abs(headUnderLeft.propVy) * 0.2, 'barely sideways');
});

test('head bump rule: an anchored prop does nothing and stops him', () => {
  const out = impact.headBumpOutcome({ fighterRiseSpeed: 5, propMass: 12, propWidth: 20, propCenterX: 0, headCenterX: 3, anchored: true });
  assert.deepEqual([out.propVx, out.propVy, out.fighterRise], [0, 0, 0]);
});

function jumpUnderLedgeProp(kind, headOffsetX) {
  const game = arenaGame();
  game.platforms.push({ x: 300, y: 462, w: 200, h: 4, solidSides: false, cloud: true, ladder: false });
  const fighter = game.players[0];
  let prop;
  if (kind === 'barrel') {
    prop = placeBarrel(game, 400, 462);
  } else {
    prop = game.createCrate(400, 462, kind);
  }
  for (let i = 0; i < 5; i++) game.step();
  const restY = prop.y;
  fighter.x = prop.x + prop.w / 2 - fighter.w / 2 + headOffsetX; fighter.y = FLOOR_Y - fighter.h;
  fighter.lastDirX = 1; fighter.onGround = true; fighter.groundedPlatform = game.platforms[0];
  fighter.airVelocityX = 0; fighter.airVelocityY = 0;
  fighter.startJump && fighter.startJump();
  fighter.airVelocityY = -5; fighter.onGround = false; fighter.jumping = true; fighter.groundedPlatform = null;
  let rise = 0;
  let sideways = 0;
  for (let i = 0; i < 40; i++) {
    game.step();
    rise = Math.max(rise, restY - prop.y);
    if (Math.abs(prop.vx) > Math.abs(sideways)) sideways = prop.vx;
  }
  return { rise, sideways, prop };
}

test('in game: jumping into the underside of a prop throws it up instead of jamming against it', () => {
  for (const kind of [null, 'table', 'bouncer', 'cementBarrel', 'barrel']) {
    const hit = jumpUnderLedgeProp(kind, 0);
    assert.ok(hit.rise > 0.3, (kind || 'crate') + ' rose ' + hit.rise.toFixed(2));
  }
});

test('in game: a lighter prop rises more than a heavy one; the metal crate barely moves', () => {
  const crate = jumpUnderLedgeProp(null, 0).rise;
  const metal = jumpUnderLedgeProp('metalCrate', 0).rise;
  assert.ok(crate > metal * 3, 'crate ' + crate.toFixed(2) + ' vs metal ' + metal.toFixed(2));
});

test('in game: the side the head hits decides the small sideways nudge', () => {
  const underLeftEdge = jumpUnderLedgeProp(null, -6).sideways;
  const underRightEdge = jumpUnderLedgeProp(null, 6).sideways;
  assert.ok(underLeftEdge > 0 && underRightEdge < 0, 'left ' + underLeftEdge.toFixed(3) + ' right ' + underRightEdge.toFixed(3));
  assert.ok(Math.abs(underLeftEdge) < 0.8 && Math.abs(underRightEdge) < 0.8, 'barely sideways');
});

test('head bump rule: the prop is thrown 50 % then 40 % harder than the plain collision gives it', () => {
  const input = { fighterRiseSpeed: 5, propMass: 1, propWidth: 20, propCenterX: 0, headCenterX: 0, anchored: false };
  const plainCollision = (1 + impact.HEAD_BUMP_RESTITUTION) * impact.FIGHTER_MASS * 5 / (impact.FIGHTER_MASS + 1);
  assert.ok(Math.abs(impact.HEAD_BUMP_FORCE_GAIN - 1.5 * 1.4) < 1e-12);
  assert.ok(Math.abs(-impact.headBumpOutcome(input).propVy - plainCollision * 1.5 * 1.4) < 1e-9);
});

// ---------- walking push, dense falling props, rigid table, hanging headbutt ----------

test('in game: walking into a prop never drags it: only blows, blasts and headbutts move a resting prop', () => {
  for (const kind of [null, 'table', 'cementBarrel', 'metalCrate']) {
    const game = arenaGame();
    const fighter = game.players[0];
    const prop = settledCrate(game, 400, kind);
    fighter.x = prop.x - fighter.w - 2; fighter.y = FLOOR_Y - fighter.h; fighter.lastDirX = 1;
    fighter.onGround = true; fighter.groundedPlatform = game.platforms[0];
    const startX = prop.x;
    game.__listeners.keydown({ code: 'KeyD', repeat: false, preventDefault() {} });
    for (let i = 0; i < 80; i++) game.step();
    game.__listeners.keyup({ code: 'KeyD', preventDefault() {} });
    assert.ok(Math.abs(prop.x - startX) < 0.5, (kind || 'crate') + ' moved ' + (prop.x - startX).toFixed(2) + ' px');
    assert.ok(fighter.x + fighter.w <= prop.x + 0.01, 'he stays outside it');
  }
});

test('in game: a metal crate dropped on a fighter crushes him by its momentum; a wooden crate does not', () => {
  const dropOn = (kind) => {
    const game = arenaGame();
    const fighter = game.players[0];
    fighter.x = 400; fighter.y = FLOOR_Y - fighter.h; fighter.onGround = true; fighter.groundedPlatform = game.platforms[0];
    game.step();
    const prop = game.createCrate(fighter.x + fighter.w / 2 - 6, FLOOR_Y, kind);
    prop.y = FLOOR_Y - fighter.h - 60 - prop.h; prop.vy = 2; prop.vx = 0; prop.resting = false;
    for (let i = 0; i < 40; i++) game.step();
    return fighter.hp;
  };
  assert.ok(dropOn('metalCrate') <= 40, 'crushed: hp ' + dropOn('metalCrate'));
  assert.equal(dropOn(null), 100, 'a wooden crate only knocks the air out of nobody');
});

test('in game: the table resists a punch far more than a wooden crate (it needs a harder blow to topple)', () => {
  const toppleRate = (kind) => {
    let topples = 0;
    const runs = 30;
    for (let r = 0; r < runs; r++) {
      const game = arenaGame();
      const attacker = game.players[0];
      const prop = settledCrate(game, 400, kind);
      attacker.x = prop.x - attacker.w - 1; attacker.lastDirX = 1;
      game.hitCratesInReach(attacker, 12, 0, game.meleePush.punchX, 0);
      let tilt = 0;
      for (let i = 0; i < 100; i++) { game.step(); attacker.x = 20; tilt = Math.max(tilt, Math.abs(prop.angle)); }
      if (tilt > 0.7) topples++;
    }
    return topples / runs;
  };
  assert.ok(toppleRate('table') < toppleRate(null) * 0.5, 'table ' + toppleRate('table') + ' vs crate ' + toppleRate(null));
});

test('head bump rule: a hanging (anchored) body still takes the blow as a swing away from the side the head hit', () => {
  const underLeft = impact.headBumpOutcome({ fighterRiseSpeed: 5, propMass: 12, propWidth: 36, propCenterX: 0, headCenterX: -10, anchored: true });
  const underRight = impact.headBumpOutcome({ fighterRiseSpeed: 5, propMass: 12, propWidth: 36, propCenterX: 0, headCenterX: 10, anchored: true });
  assert.ok(underLeft.swingImpulse > 0 && underRight.swingImpulse < 0);
  assert.equal(underLeft.propVy, 0, 'it does not fly off its rope');
});

// Regression: the pit with the lying barrel on its ledge left a 14.5 px gap beside the ledge (15.5 beside
// the barrel), and the 16.8 px collision body could not squeeze through it (he stood on the barrel, stuck).
test('in game: the fighter fits through a 14.5 px gap beside a ledge with a barrel lying on it', () => {
  const game = createGame();
  game.platforms.length = 0;
  game.platforms.push({ x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false });
  game.platforms.push({ x: 600, y: 300, w: 33, h: 12.5, solidSides: true, cloud: false, ladder: false });   // left slab
  game.platforms.push({ x: 668, y: 300, w: 40, h: 12.5, solidSides: true, cloud: false, ladder: false });   // right slab: 14.5 px beyond the ledge end
  game.platforms.push({ x: 633, y: 330, w: 20.5, h: 2.5, solidSides: false, cloud: true, ladder: false });  // ledge under the shaft
  game.crates.length = 0; game.barrels.length = 0;
  const lying = {
    x: 633.5, y: 330 - 13.75, w: 18.75, h: 13.75, sx: 633, sy: 316, vx: 0, vy: 0, angle: Math.PI / 2, spin: 0,
    mass: 2, baseW: 13.75, baseH: 18.75, burning: false, burnFuse: 0, resting: true
  };
  game.barrels.push(lying);
  for (let i = 0; i < 10; i++) game.step();
  const ledgeEnd = 653.5;
  const gap = 668 - ledgeEnd;
  const fighter = game.players[0];
  game.players[1].x = 20; game.players[1].y = FLOOR_Y - game.players[1].h;
  assert.ok(gap > fighter.w && gap < 16.8, 'the free gap beside the ledge (' + gap.toFixed(2) + ') is wider than the body (' + fighter.w.toFixed(2) + ') but narrower than the old 16.8 body');
  // drop from above, centred on the free gap beside the barrel
  fighter.x = ledgeEnd + (gap - fighter.w) / 2; fighter.y = 250;
  fighter.airVelocityX = 0; fighter.airVelocityY = 0; fighter.onGround = false; fighter.groundedPlatform = null;
  for (let i = 0; i < 80; i++) game.step();
  assert.ok(fighter.y + fighter.h > 400, 'he fell through the gap to the floor below (feet at ' + (fighter.y + fighter.h).toFixed(1) + ')');
});
