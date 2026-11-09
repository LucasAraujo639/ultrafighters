/**
 * Superfighters clone — fighter <-> prop contact rules that need the world.
 *
 * The pure numbers live in impact-dynamics.js (headBumpOutcome, headContact,
 * blockedBlowReboundSpeed) and fighter-hitbox.js (the silhouette). This module
 * is the thin layer that applies them to real props and fighters:
 *
 *  - fighterTouchesRect    does a prop touch the fighter's silhouette?
 *  - headPressesProp       walking under a prop that only reaches his head
 *  - headBumpTarget /
 *    applyHeadBump         a jumping fighter's head hits a prop's underside
 *  - blockedBlowVictim /
 *    reactToBlockedBlow    a blow on a prop with a fighter right behind it
 *
 * It owns no game state: everything it needs comes from the `env` handed to
 * createPropFighterContacts (the rule modules, the prop lists, the fighters
 * and a few game helpers and tuning constants), so it can be exercised with
 * fake props and fighters. Any rule module may be null: each function then
 * falls back to the legacy behaviour (a plain box, a solid ceiling, no effect).
 */
(function (root) {
  'use strict';

  var HEAD_PRESS_MAX_PROP_VY = 1;       // px/step: faster than this a prop is dropping onto his head, not perched over it
  var BLOCKED_BLOW_CONTACT_GAP_PX = 4;  // px between the prop's far face and the fighter that still counts as "right behind it"
  var BLOCKED_BLOW_MIN_OVERLAP_Y = 4;   // px of shared height: a fighter below or above it is not covered by it
  var BLOCKED_BLOW_MIN_SPEED = 0.2;     // px/step the blow must give the prop for anything to travel through it

  /**
   * env: {
   *   impactApi, rigidApi, heavyApi, hitboxApi          rule modules (nullable)
   *   crates, barrels                                    the live prop lists
   *   fighters()                                         -> the two fighters
   *   rectsOverlap(a, b), isAnchored(prop), clampPropSpeed(prop),
   *   hitSpin(spin, change, softCap, w, h, gravity), addHitSpin(prop, change),
   *   swingHangingPropByRider(prop, impulseX)            game helpers
   *   constants: { BARREL_MASS, CRATE_MASS, BARREL_GRAVITY, CRATE_GRAVITY, BARREL_W, BARREL_H,
   *     BARREL_TORQUE_SCALE, BARREL_MAX_HIT_SPIN, PROP_TIP_GRAVITY_SHARE, PROP_DEEP_OVERLAP_SHARE,
   *     TOPPLE_ROLL_MAX_SPEED, TOPPLE_ROLL_MIN_SPEED, TOPPLE_KNOCKBACK_TRANSFER, TOPPLE_ROLL_POP_SHARE,
   *     KNOCKBACK_ROLL_POP }
   * }
   */
  function createPropFighterContacts(env) {
    var impactApi = env.impactApi;
    var rigidApi = env.rigidApi;
    var heavyApi = env.heavyApi;
    var hitboxApi = env.hitboxApi;
    var k = env.constants;

    /** Props touch the fighter's silhouette, not his whole bounding box (the box without the module). */
    function fighterTouchesRect(fighter, rect) {
      var bounds = fighter.getBounds();
      return hitboxApi
        ? hitboxApi.silhouetteOverlaps(bounds, fighter.lastDirX || 1, rect)
        : env.rectsOverlap(bounds, rect);
    }

    /**
     * Walking under a prop that only reaches his head: a graze is ignored, a
     * deeper one is pressed through (the prop is lifted just enough to clear
     * him). Returns true when the contact is a head contact, so no side block
     * or shove applies.
     */
    function headPressesProp(fighter, prop, isBarrel) {
      if (!impactApi || !impactApi.headContact || env.isAnchored(prop) || prop.burning) return false;
      if (prop.y + prop.h / 2 >= fighter.y) return false;                // its middle is not above his head: it is beside him
      if ((prop.vy || 0) > HEAD_PRESS_MAX_PROP_VY) return false;         // a falling prop lands on him, it is not perched over him
      var depth = prop.y + prop.h - fighter.y;                           // how far his head is inside the underside
      var contact = impactApi.headContact(depth);
      if (contact === 'none') return false;
      if (contact === 'press') {
        var lift = impactApi.headPressLiftSpeed(depth, isBarrel ? k.BARREL_GRAVITY : k.CRATE_GRAVITY);
        if (prop.vy > lift) prop.vy = lift;
        prop.resting = false;
      }
      return true;
    }

    /** The prop whose underside the rising fighter's head crossed this step, or null. */
    function headBumpTarget(fighter, previousY) {
      var head = hitboxApi ? hitboxApi.headRect(fighter.getBounds(), fighter.lastDirX || 1) : fighter.getBounds();
      var lists = [env.crates, env.barrels];
      for (var li = 0; li < lists.length; li++) {
        var list = lists[li];
        for (var i = 0; i < list.length; i++) {
          var prop = list[i];
          if (prop.dead || prop.fragment) continue;
          if (!(head.x < prop.x + prop.w && head.x + head.w > prop.x)) continue;
          var underside = prop.y + prop.h;
          if (previousY >= underside - 1e-7 && fighter.y <= underside + 1e-7) return { prop: prop, head: head, isBarrel: li === 1 };
        }
      }
      return null;
    }

    /**
     * Applies the head bump to the prop (thrown up, nudged away from the side
     * the head hit, spun by the offset; a hanging deck swings) and returns the
     * fighter's remaining upward speed in px/step (>= 0 keeps rising, < 0 is
     * pushed down). Without the rules module the prop is a solid ceiling.
     */
    function applyHeadBump(fighter, target, riseSpeed) {
      var prop = target.prop;
      if (!impactApi || !impactApi.headBumpOutcome) return 0;
      var anchored = env.isAnchored(prop);
      var outcome = impactApi.headBumpOutcome({
        fighterRiseSpeed: riseSpeed,
        propMass: target.isBarrel ? k.BARREL_MASS : (prop.mass || k.CRATE_MASS),
        propWidth: prop.baseW || prop.w,
        propCenterX: prop.x + prop.w / 2,
        headCenterX: target.head.x + target.head.w / 2,
        anchored: anchored || (target.isBarrel && prop.burning)
      });
      if (outcome.swingImpulse !== undefined && anchored && prop.anchor && heavyApi && heavyApi.pendulumImpulseSpin) {
        env.swingHangingPropByRider(prop, outcome.swingImpulse); // the headbutt rocks the hanging deck
      }
      if (outcome.propVy === 0) return outcome.fighterRise;
      prop.vx += outcome.propVx;
      prop.vy += outcome.propVy;
      prop.resting = false;
      env.clampPropSpeed(prop);
      if (rigidApi) spinPropFromHeadBump(prop, target, outcome);
      return outcome.fighterRise;
    }

    function spinPropFromHeadBump(prop, target, outcome) {
      var width = prop.baseW || prop.w;
      var height = prop.baseH || prop.h;
      var leverX = target.head.x + target.head.w / 2 - (prop.x + prop.w / 2);
      var leverY = height / 2; // the push lands on the underside
      var spinChange = rigidApi.spinChangeFromImpulse(width, height, leverX, leverY, outcome.propVx, outcome.propVy, 1);
      if (target.isBarrel) {
        prop.spin = env.hitSpin(prop.spin, spinChange * k.BARREL_TORQUE_SCALE, k.BARREL_MAX_HIT_SPIN,
          k.BARREL_W, k.BARREL_H, k.BARREL_GRAVITY * k.PROP_TIP_GRAVITY_SHARE);
      } else {
        env.addHitSpin(prop, spinChange);
      }
    }

    /**
     * The other fighter standing against the far face of the struck prop (in
     * cover behind it, or just in front of it from the blow's side), or null.
     * Call it BEFORE the blow's impulse is applied.
     */
    function blockedBlowVictim(prop, attacker, direction) {
      if (!impactApi || !impactApi.blockedBlowReboundSpeed || env.isAnchored(prop) || prop.dead || prop.burning) return null;
      var fighters = env.fighters();
      for (var i = 0; i < fighters.length; i++) {
        var p = fighters[i];
        if (p === attacker || p.hp <= 0) continue;
        if (p.knockbackRoll || p.rolling || p.knockedDown || p.matrixDodgeTimer > 0 || p.grabbedBy) continue;
        if (p.groundedCrate === prop || p.groundedBarrel === prop) continue; // standing on it, not behind it
        var gap = direction > 0 ? p.x - (prop.x + prop.w) : prop.x - (p.x + p.w);
        if (gap > BLOCKED_BLOW_CONTACT_GAP_PX || gap < -prop.w * k.PROP_DEEP_OVERLAP_SHARE) continue;
        var sharedHeight = Math.min(p.y + p.h, prop.y + prop.h) - Math.max(p.y, prop.y);
        if (sharedHeight < BLOCKED_BLOW_MIN_OVERLAP_Y) continue;
        return p;
      }
      return null;
    }

    /**
     * Applied right after the blow's impulse reached `prop`: the victim is
     * bowled into the knockback roll and the prop rebounds toward the attacker.
     */
    function reactToBlockedBlow(prop, victim, direction) {
      if (!victim) return;
      var speed = (prop.vx || 0) * direction; // speed the blow gave it, toward the victim
      if (speed < BLOCKED_BLOW_MIN_SPEED) return;
      if (victim.aiming) victim.abortAiming(true, 'vanish');
      victim.onGround = false;
      victim.groundedCrate = null;
      victim.groundedBarrel = null;
      victim.groundedPlatform = null;
      victim.airVelocityX = direction * Math.min(k.TOPPLE_ROLL_MAX_SPEED, Math.max(speed * k.TOPPLE_KNOCKBACK_TRANSFER, k.TOPPLE_ROLL_MIN_SPEED));
      victim.airVelocityY = -k.KNOCKBACK_ROLL_POP * k.TOPPLE_ROLL_POP_SHARE;
      victim.startKnockbackRoll(direction);
      prop.vx = -direction * impactApi.blockedBlowReboundSpeed(speed); // it comes back toward whoever swung
      prop.resting = false;
    }

    return {
      fighterTouchesRect: fighterTouchesRect,
      headPressesProp: headPressesProp,
      headBumpTarget: headBumpTarget,
      applyHeadBump: applyHeadBump,
      blockedBlowVictim: blockedBlowVictim,
      reactToBlockedBlow: reactToBlockedBlow
    };
  }

  var api = {
    HEAD_PRESS_MAX_PROP_VY: HEAD_PRESS_MAX_PROP_VY,
    BLOCKED_BLOW_CONTACT_GAP_PX: BLOCKED_BLOW_CONTACT_GAP_PX,
    BLOCKED_BLOW_MIN_OVERLAP_Y: BLOCKED_BLOW_MIN_OVERLAP_Y,
    BLOCKED_BLOW_MIN_SPEED: BLOCKED_BLOW_MIN_SPEED,
    createPropFighterContacts: createPropFighterContacts
  };
  root.SuperfightersPropFighterContacts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
