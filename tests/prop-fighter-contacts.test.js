'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const contactsApi = require('../src/prop-fighter-contacts.js');
const impact = require('../src/impact-dynamics.js');
const rigid = require('../src/rigid-impact.js');
const heavy = require('../src/heavy-props.js');
const hitbox = require('../src/fighter-hitbox.js');

const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function fakeFighter(overrides) {
  const f = Object.assign({
    id: 1, x: 100, y: 100, w: 10, h: 22, lastDirX: 1, hp: 100, airVelocityX: 0, airVelocityY: 0, onGround: true,
    groundedCrate: null, groundedBarrel: null, groundedPlatform: null, knockbackRoll: false, rolling: false, knockedDown: false,
    matrixDodgeTimer: 0, grabbedBy: null, aiming: false, rollStarted: null
  }, overrides);
  f.getBounds = () => ({ x: f.x, y: f.y, w: f.w, h: f.h });
  f.startKnockbackRoll = (dir) => { f.rollStarted = dir; f.knockbackRoll = true; };
  f.abortAiming = () => {};
  return f;
}

function fakeProp(overrides) {
  return Object.assign({ x: 100, y: 60, w: 20, h: 20, vx: 0, vy: 0, spin: 0, mass: 1, resting: true, dead: false }, overrides);
}

function createContacts(options) {
  const opts = options || {};
  const crates = opts.crates || [];
  const barrels = opts.barrels || [];
  const fighters = opts.fighters || [];
  const spins = [];
  return {
    crates, barrels, fighters, spins,
    contacts: contactsApi.createPropFighterContacts({
      impactApi: opts.noRules ? null : impact, rigidApi: opts.noRules ? null : rigid, heavyApi: heavy,
      hitboxApi: opts.noHitbox ? null : hitbox,
      crates, barrels, fighters: () => fighters,
      rectsOverlap, isAnchored: (prop) => !!prop.anchored, clampPropSpeed: () => {},
      hitSpin: (spin, change) => spin + change, addHitSpin: (prop, change) => { spins.push(change); prop.spin += change; },
      swingHangingPropByRider: () => {},
      constants: {
        BARREL_MASS: 2, CRATE_MASS: 1, BARREL_GRAVITY: 0.3375, CRATE_GRAVITY: 0.3375, BARREL_W: 14, BARREL_H: 19,
        BARREL_TORQUE_SCALE: 0.175, BARREL_MAX_HIT_SPIN: 0.035, PROP_TIP_GRAVITY_SHARE: 0.3, PROP_DEEP_OVERLAP_SHARE: 0.6,
        TOPPLE_ROLL_MAX_SPEED: 1.1, TOPPLE_ROLL_MIN_SPEED: 0.5, TOPPLE_KNOCKBACK_TRANSFER: 0.3, TOPPLE_ROLL_POP_SHARE: 0.4,
        KNOCKBACK_ROLL_POP: 1.5
      }
    })
  };
}

test('silhouette contact: the box corner beside the head is no contact; without the hitbox module the box is', () => {
  const fighter = fakeFighter({ x: 100, y: 100 });
  const cornerBesideHead = { x: 92, y: 96, w: 9, h: 8 };      // over the shoulder line, beside the head
  assert.equal(createContacts().contacts.fighterTouchesRect(fighter, cornerBesideHead), false);
  assert.equal(createContacts({ noHitbox: true }).contacts.fighterTouchesRect(fighter, cornerBesideHead), rectsOverlap(fighter.getBounds(), cornerBesideHead));
});

test('head press: a graze is clear, a deeper one lifts the prop, a falling or beside prop is left alone', () => {
  const { contacts } = createContacts();
  const fighter = fakeFighter({ y: 100 });
  const graze = fakeProp({ y: 100 + 1 - 20 });               // bottom 1 px inside his head
  assert.equal(contacts.headPressesProp(fighter, graze, false), true);
  assert.equal(graze.vy, 0, 'a graze does not move it');
  const pressed = fakeProp({ y: 100 + 4 - 20 });             // 4 px inside
  assert.equal(contacts.headPressesProp(fighter, pressed, false), true);
  assert.ok(pressed.vy < 0 && !pressed.resting, 'lifted just enough to clear him');
  const falling = fakeProp({ y: 100 + 4 - 20, vy: 3 });
  assert.equal(contacts.headPressesProp(fighter, falling, false), false, 'a falling prop lands on him');
  const beside = fakeProp({ y: 100 });
  assert.equal(contacts.headPressesProp(fighter, beside, false), false);
  assert.equal(createContacts({ noRules: true }).contacts.headPressesProp(fighter, pressed, false), false, 'no rules: no effect');
});

test('head bump: the prop is thrown up, nudged away from the side the head hit; a heavy one barely moves', () => {
  const { contacts, crates } = createContacts();
  const light = fakeProp({ x: 100, y: 60, mass: 1 });
  const heavyProp = fakeProp({ x: 200, y: 60, mass: 8 });
  crates.push(light, heavyProp);
  const underLeftEdge = fakeFighter({ x: 96, y: 80 });        // previous y 82: crosses the underside at y 80
  const target = contacts.headBumpTarget(underLeftEdge, 82);
  assert.ok(target && target.prop === light && !target.isBarrel);
  const remaining = contacts.applyHeadBump(underLeftEdge, target, 5);
  assert.ok(light.vy < 0 && remaining > 0, 'thrown up; he keeps part of his rise');
  assert.ok(light.vx > 0, 'head under the left half nudges it right');
  const heavyTarget = contacts.headBumpTarget(fakeFighter({ x: 200, y: 80 }), 82);
  contacts.applyHeadBump(fakeFighter({ x: 200, y: 80 }), heavyTarget, 5);
  assert.ok(Math.abs(heavyProp.vy) < Math.abs(light.vy) / 3, 'the heavy prop barely rises');
  assert.equal(contacts.headBumpTarget(fakeFighter({ x: 400, y: 80 }), 82), null, 'nothing above him');
  const noRules = createContacts({ noRules: true });
  assert.equal(noRules.contacts.applyHeadBump(underLeftEdge, { prop: fakeProp(), head: { x: 0, y: 0, w: 5, h: 5 }, isBarrel: false }, 5), 0, 'no rules: a solid ceiling');
});

test('head bump: a barrel takes its own mass and spin rules; an anchored prop only swings', () => {
  const barrel = fakeProp({ x: 100, y: 60, w: 14, h: 19, mass: 2 });
  const env = createContacts({ barrels: [barrel] });
  const target = env.contacts.headBumpTarget(fakeFighter({ x: 98, y: 79 }), 82);
  assert.ok(target && target.isBarrel);
  env.contacts.applyHeadBump(fakeFighter({ x: 98, y: 79 }), target, 5);
  assert.ok(barrel.vy < 0);
});

test('blocked blow: the fighter right behind the prop rolls, the prop rebounds toward the attacker', () => {
  const attacker = fakeFighter({ id: 1, x: 70, y: 100 });
  const covered = fakeFighter({ id: 2, x: 122, y: 100 });
  const prop = fakeProp({ x: 100, y: 100 });                  // right face at 120: 2 px from the covered fighter
  const { contacts } = createContacts({ fighters: [attacker, covered] });
  const victim = contacts.blockedBlowVictim(prop, attacker, 1);
  assert.equal(victim, covered);
  prop.vx = 3;                                                // the blow's impulse reached the prop
  contacts.reactToBlockedBlow(prop, victim, 1);
  assert.equal(covered.rollStarted, 1);
  assert.ok(covered.airVelocityX > 0 && covered.airVelocityX <= 1.1, 'a short, slow roll');
  assert.ok(prop.vx < 0, 'rebounds toward the attacker');
  assert.ok(Math.abs(prop.vx) < 3, 'with less speed than it had');
});

test('blocked blow: nobody behind it, a fighter too far, on top of it, down or a prop too slow do nothing', () => {
  const attacker = fakeFighter({ id: 1, x: 70, y: 100 });
  const far = fakeFighter({ id: 2, x: 150, y: 100 });
  const prop = fakeProp({ x: 100, y: 100 });
  const { contacts } = createContacts({ fighters: [attacker, far] });
  assert.equal(contacts.blockedBlowVictim(prop, attacker, 1), null, 'too far behind');
  far.x = 122; far.groundedCrate = prop;
  assert.equal(contacts.blockedBlowVictim(prop, attacker, 1), null, 'standing on it');
  far.groundedCrate = null; far.knockedDown = true;
  assert.equal(contacts.blockedBlowVictim(prop, attacker, 1), null, 'already down');
  far.knockedDown = false;
  prop.vx = 0.05;
  contacts.reactToBlockedBlow(prop, far, 1);
  assert.equal(far.rollStarted, null, 'a blow too weak to travel through');
  assert.equal(createContacts({ noRules: true, fighters: [attacker, far] }).contacts.blockedBlowVictim(prop, attacker, 1), null, 'no rules: no effect');
});
