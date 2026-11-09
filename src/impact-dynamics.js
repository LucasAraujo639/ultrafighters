/**
 * Superfighters clone — contact dynamics for rigid props (pure rules, no game state).
 *
 * Complements rigid-impact.js (free rotation, tip-over, dead-band) with the
 * rules that depend on WHERE and HOW a body is touched:
 *  - groundedBulletResponse: a shot on a prop resting on the floor. The height
 *    of the contact relative to the centre of mass decides the outcome:
 *      upper half -> the box pivots on its leading bottom corner and tips
 *                    forward (top travels with the bullet), sliding less;
 *      lower half -> the floor takes the torque: the box slides more and
 *                    rocks back slightly (top leans toward the shooter).
 *    Airborne props use the plain free-body response (r x J) / I.
 *  - pointInRotatedBox: hit test against the real rotated rectangle (OBB).
 *  - overhangSpinAcceleration: gravity torque about the supporting edge, so a
 *    box hanging further over the void topples faster (tau = m g d).
 *  - pairSeparation: mass-weighted, step-bounded split of an interpenetration
 *    so chains of pushed props never swap places or teleport.
 *  - meleeRecoilSpeed / fighterKnockoverImpact: the fighter side of a contact
 *    (rebound off a heavy body; the knockback roll only when the blow can tip
 *    him over his feet).
 *
 * Units: px, rad, steps. Angles grow clockwise on screen (canvas, y down).
 */
(function (root) {
  'use strict';

  // Rectangle inertia per unit mass: about the centre (w^2 + h^2) / 12,
  // about a corner (w^2 + h^2) / 3 (parallel-axis theorem).
  var CENTER_INERTIA_DIVISOR = 12;
  var CORNER_INERTIA_DIVISOR = 3;

  // Bullet impulse (Box2D kg m/s on a crate of mass 1) to px/step: the engine's
  // conversion, 1 m/s = 30 px at 60 steps/s = 0.5 px/step (B2D_TO_STEP).
  var BULLET_IMPULSE_TO_SPEED = 0.5;

  // Grounded response shape. heightShare runs from -1 (bottom edge) to +1 (top edge).
  var TOP_HIT_SLIDE_LOSS = 0.45;     // a hit at the very top keeps only 55% of the slide (energy goes into tipping)
  var LOW_HIT_SLIDE_GAIN = 0.25;     // a hit at the very bottom slides 25% further (it sweeps the base)
  var LOW_HIT_ROCK_SHARE = 0.35;     // share of the free-body back-spin the floor lets through on low hits
  var CENTRE_BAND = 0.08;            // |heightShare| under this is "dead centre": pure slide, no spin

  var FIGHTER_MASS = 0.7;            // original player Mass, in crate units (wooden crate = 1)
  var RECOIL_MIN_PROP_MASS = 2;      // only genuinely heavy bodies (cement drum and up) push back
  var RECOIL_GAIN = 0.55;           // share of the swing speed handed back by an immovable body
  var RECOIL_MAX_SPEED = 2.2;        // px/step cap on the rebound
  var RECOIL_DECAY = 0.72;           // per step: the rebound bleeds out in ~10 steps
  var RECOIL_MIN_SPEED = 0.05;       // px/step below which the rebound is over

  var TOPPLE_MIN_SPIN = 0.02;        // rad/step: the prop is visibly leaning over, not just rocking (hit spin is capped well under 0.05)

  var MAX_SEPARATION_PER_PASS = 3;   // px: a single pass never moves a body further than this


  function clamp(value, low, high) {
    return value < low ? low : (value > high ? high : value);
  }

  function sign(value) {
    return value > 0 ? 1 : (value < 0 ? -1 : 0);
  }

  /** Free-body angular change of a w x h box for velocity change (dvx, dvy) at lever (leverX, leverY). */
  function freeBodySpin(width, height, leverX, leverY, dvx, dvy) {
    return (leverX * dvy - leverY * dvx) * CENTER_INERTIA_DIVISOR / (width * width + height * height);
  }

  /**
   * Height of the contact over the centre of mass as a share of the half
   * height: +1 top edge, 0 centre, -1 bottom edge (screen y grows downward).
   */
  function contactHeightShare(contactY, centerY, height) {
    if (!(height > 0)) return 0;
    return clamp((centerY - contactY) / (height / 2), -1, 1);
  }

  /**
   * Response of a prop to a horizontal bullet impulse.
   * `hit`: { width, height, centerX, centerY, contactX, contactY, dvx, grounded }
   * where dvx is the linear velocity change the impulse would give a free body.
   * Returns { dvx, spin, heightShare }: the slide actually transmitted and the
   * angular velocity change (rad/step, clockwise positive).
   */
  function bulletResponse(hit) {
    var heightShare = contactHeightShare(hit.contactY, hit.centerY, hit.height);
    if (!hit.grounded) {
      return {
        dvx: hit.dvx,
        spin: freeBodySpin(hit.width, hit.height, hit.contactX - hit.centerX, hit.contactY - hit.centerY, hit.dvx, 0),
        heightShare: heightShare
      };
    }
    if (Math.abs(heightShare) < CENTRE_BAND) return { dvx: hit.dvx, spin: 0, heightShare: heightShare };
    var push = sign(hit.dvx);
    if (heightShare > 0) {
      // upper half: the leading bottom corner becomes the pivot. Torque about it
      // is J times the contact's height above the floor, against corner inertia.
      var riseAboveFloor = hit.height / 2 + heightShare * hit.height / 2;
      var tipSpin = push * Math.abs(hit.dvx) * riseAboveFloor * CORNER_INERTIA_DIVISOR /
        (hit.width * hit.width + hit.height * hit.height);
      return { dvx: hit.dvx * (1 - TOP_HIT_SLIDE_LOSS * heightShare), spin: tipSpin, heightShare: heightShare };
    }
    // lower half: the floor's friction takes most of the torque; what leaks
    // through rocks the top back toward the shooter while the base sweeps on.
    var depth = -heightShare;
    var lever = depth * hit.height / 2;
    var rockSpin = -push * Math.abs(hit.dvx) * lever * CENTER_INERTIA_DIVISOR /
      (hit.width * hit.width + hit.height * hit.height) * LOW_HIT_ROCK_SHARE;
    return { dvx: hit.dvx * (1 + LOW_HIT_SLIDE_GAIN * depth), spin: rockSpin, heightShare: heightShare };
  }

  /** True when (px, py) lies inside the w x h rectangle centred at (cx, cy) rotated by `angle`. */
  function pointInRotatedBox(px, py, cx, cy, width, height, angle) {
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var dx = px - cx;
    var dy = py - cy;
    var localX = dx * cos + dy * sin;   // rotate the point into the box frame
    var localY = -dx * sin + dy * cos;
    return Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2;
  }

  /**
   * Angular acceleration (rad/step^2, signed toward the void) gravity gives a
   * box whose centre of mass sits `overhang` px past the supporting edge. The
   * box pivots on that edge: tau = m g d, I_edge / m = (w^2 + h^2) / 12 + r^2.
   */
  function overhangSpinAcceleration(overhang, width, height, gravity) {
    var distance = Math.abs(overhang);
    if (distance === 0) return 0;
    var leverSq = distance * distance + (height / 2) * (height / 2);
    var inertiaPerMass = (width * width + height * height) / CENTER_INERTIA_DIVISOR + leverSq;
    return sign(overhang) * gravity * distance / inertiaPerMass;
  }

  /**
   * Split an interpenetration `overlap` (px) between two bodies by inverse
   * mass (a mass of Infinity, or 0 inverse mass, never moves). Each share is
   * bounded so a deep overlap resolves over a few passes instead of a jump.
   * Returns { a, b }: the distance each body moves APART (both >= 0).
   */
  function pairSeparation(overlap, massA, massB) {
    var inverseA = massA === Infinity ? 0 : 1 / Math.max(massA, 1e-6);
    var inverseB = massB === Infinity ? 0 : 1 / Math.max(massB, 1e-6);
    var total = inverseA + inverseB;
    if (!(overlap > 0) || total === 0) return { a: 0, b: 0 };
    return {
      a: Math.min(MAX_SEPARATION_PER_PASS, overlap * inverseA / total),
      b: Math.min(MAX_SEPARATION_PER_PASS, overlap * inverseB / total)
    };
  }

  /**
   * One-dimensional collision of two bodies along x (velocities v, masses m;
   * Infinity = immovable). Momentum is conserved and the approach speed is
   * reversed by `restitution` (0 = they move on together, 1 = elastic).
   * Returns { a, b }: the velocities after the impact.
   */
  function sideCollisionVelocities(velocityA, massA, velocityB, massB, restitution) {
    var e = restitution || 0;
    if (massA === Infinity && massB === Infinity) return { a: 0, b: 0 };
    if (massB === Infinity) return { a: velocityB - e * (velocityA - velocityB), b: velocityB };
    if (massA === Infinity) return { a: velocityA, b: velocityA - e * (velocityB - velocityA) };
    var total = massA + massB;
    var momentum = massA * velocityA + massB * velocityB;
    return {
      a: (momentum - massB * e * (velocityA - velocityB)) / total,
      b: (momentum + massA * e * (velocityA - velocityB)) / total
    };
  }

  /**
   * Rebound speed (px/step, >= 0) a fighter of `fighterMass` gets back when a
   * swing at `swingSpeed` lands on a prop of `propMass`. Light props absorb the
   * blow (no rebound); the heavier the body, the more of the swing bounces back.
   */
  function meleeRecoilSpeed(propMass, swingSpeed, fighterMass) {
    var ownMass = fighterMass || FIGHTER_MASS;
    if (!(propMass >= RECOIL_MIN_PROP_MASS) || !(propMass > ownMass)) return 0;
    var stiffness = (propMass - ownMass) / (propMass + ownMass); // 0 equal mass, -> 1 immovable
    return Math.min(RECOIL_MAX_SPEED, Math.abs(swingSpeed) * RECOIL_GAIN * stiffness);
  }

  /** One step of rebound decay; returns the new speed (0 once negligible). */
  function decayRecoil(speed) {
    var next = speed * RECOIL_DECAY;
    return Math.abs(next) < RECOIL_MIN_SPEED ? 0 : next;
  }

  // ---------- does a prop's blow knock the fighter off his feet? ----------
  // The fighter is a standing rigid body (w x h) that pivots on the edge of
  // his feet, like any box. A prop striking him hands him the impulse of a
  // plastic collision, J = mu * v (mu = reduced mass, v = closing speed of
  // the prop's contact point, linear speed plus the sweep of its spin). That
  // impulse, applied at the contact height above his feet, spins him about
  // the pivot (dw = J * height / I_feet, I_feet = m (w^2 + h^2) / 3). Only if
  // that spin carries enough energy to lift his centre of mass over the edge
  // of his feet (the same tip-over energy as the props) is he knocked off
  // his feet into the knockback roll; anything weaker only shoves him.
  var FIGHTER_IMPACT_RESTITUTION = 0; // a body soaks up the blow (plastic contact)
  var CORNER_INERTIA_FACTOR = 1 / CORNER_INERTIA_DIVISOR;

  /** Angular speed (rad/step) that tips a standing w x h body over the edge of its base. */
  function standingTipSpin(width, height, gravity) {
    var diagonal = Math.sqrt(width * width + height * height);
    var stiffness = 3 * gravity / (2 * diagonal);
    return Math.sqrt(2 * stiffness * (1 - Math.cos(Math.atan(width / height))));
  }

  /**
   * input: { propMass, propWidth, propHeight, propVx, propSpin, propCenterY,
   *          towardFighter (+1 the fighter is to the prop's right, -1 left),
   *          fighterMass?, fighterWidth, fighterHeight, fighterFeetY, gravity }
   * Returns { topples, impulse, fighterSpeed, spin, criticalSpin, closingSpeed }.
   */
  function fighterKnockoverImpact(input) {
    var fighterMass = input.fighterMass === undefined ? FIGHTER_MASS : input.fighterMass;
    var fighterTop = input.fighterFeetY - input.fighterHeight;
    // the blow lands where the prop meets his body, at its centre height, within his height
    var contactY = Math.max(fighterTop, Math.min(input.fighterFeetY, input.propCenterY));
    var leverOnProp = contactY - input.propCenterY;
    // horizontal velocity of the prop's contact point: v + w x r (screen y down, clockwise +)
    var contactVx = input.propVx - (input.propSpin || 0) * leverOnProp;
    var closingSpeed = contactVx * input.towardFighter;
    var criticalSpin = standingTipSpin(input.fighterWidth, input.fighterHeight, input.gravity);
    if (!(closingSpeed > 0)) {
      return { topples: false, impulse: 0, fighterSpeed: 0, spin: 0, criticalSpin: criticalSpin, closingSpeed: closingSpeed };
    }
    var propInertia = input.propMass * (input.propWidth * input.propWidth + input.propHeight * input.propHeight) / CENTER_INERTIA_DIVISOR;
    var effectivePropMass = 1 / (1 / input.propMass + leverOnProp * leverOnProp / propInertia);
    var reducedMass = effectivePropMass * fighterMass / (effectivePropMass + fighterMass);
    var impulse = reducedMass * closingSpeed * (1 + FIGHTER_IMPACT_RESTITUTION);
    var leverOnFighter = input.fighterFeetY - contactY;
    var feetInertia = fighterMass * (input.fighterWidth * input.fighterWidth + input.fighterHeight * input.fighterHeight) * CORNER_INERTIA_FACTOR;
    var spin = impulse * leverOnFighter / feetInertia;
    return {
      topples: spin >= criticalSpin,
      impulse: impulse,
      fighterSpeed: impulse / fighterMass,
      spin: spin,
      criticalSpin: criticalSpin,
      closingSpeed: closingSpeed
    };
  }

  // ---------- a fighter standing on a prop: the reaction of his feet on its top face ----------
  // Newton's third law on the contact surface: whatever horizontal impulse
  // the fighter's feet take from the top face (to speed up, brake, turn or
  // push off on each stride) the face takes back, at its own height, half
  // the body's height above the centre of mass. His weight on the planted
  // foot (and the thud of a landing) presses down at his offset from the
  // centre. Both torque the prop: r x J / I, I = m (w^2 + h^2) / 12. The
  // floor's tip dynamics (rigid-impact.js) turn that spin into a small rock
  // that gravity brings back flat.
  var RIDER_TORQUE_GAIN = 0.09;       // share of the free-body torque left once the floor holds the base (normal + friction)
  var RIDER_MAX_DV = 3;               // px/step: larger jumps are teleports / respawns, not footwork
  var RIDER_STRIDE_PX = 8;            // px of travel on the face between two footfalls
  var FOOTFALL_PUSH_SHARE = 0.35;     // share of the walking speed each push-off hands back to the face
  var FOOTFALL_WEIGHT_DV = 0.5;       // px/step: the planted foot's weight pressing on the face
  var RIDER_MAX_SPIN = 0.012;         // rad/step a walking fighter can give a prop (a gentle rock)
  var RIDER_LANDING_MAX_SPIN = 0.016; // rad/step a landing thud can give (a firmer, single rock)

  /** Spin (rad/step) an impulse J applied at (leverX, leverY) from the centre gives a free rigid box. */
  function surfaceImpulseSpin(width, height, mass, leverX, leverY, impulseX, impulseY) {
    var inertiaPerMass = (width * width + height * height) / CENTER_INERTIA_DIVISOR;
    return (leverX * impulseY - leverY * impulseX) / (Math.max(mass, 1e-6) * inertiaPerMass);
  }

  /**
   * Spin change a fighter on a prop's top face gives it this step.
   * input: { width, height, propMass, riderMass?, offsetX (rider centre - prop centre),
   *          accelX (rider's change of speed relative to the face, px/step^2),
   *          speedX (rider's speed relative to the face), footfall (bool),
   *          landingVy (downward speed of a landing, 0 if none) }
   */
  function riderSurfaceSpin(input) {
    var impulse = riderSurfaceImpulse(input);
    var spin = surfaceImpulseSpin(input.width, input.height, input.propMass,
      input.offsetX || 0, -input.height / 2, impulse.x, impulse.y) * RIDER_TORQUE_GAIN;
    var cap = input.landingVy > 0 ? RIDER_LANDING_MAX_SPIN : RIDER_MAX_SPIN;
    return Math.max(-cap, Math.min(cap, spin));
  }

  /**
   * Impulse (mass * px/step) the fighter's feet put on the face this step:
   * x opposite to his acceleration and push-off, y his weight (planted foot,
   * landing). Same input as riderSurfaceSpin.
   */
  function riderSurfaceImpulse(input) {
    var riderMass = input.riderMass === undefined ? FIGHTER_MASS : input.riderMass;
    var accelX = Math.max(-RIDER_MAX_DV, Math.min(RIDER_MAX_DV, input.accelX || 0));
    // the face pushes the feet forward, so the feet push the face back
    var impulseX = -riderMass * accelX;
    var impulseY = riderMass * Math.max(0, input.landingVy || 0);
    if (input.footfall) {
      impulseX -= riderMass * (input.speedX || 0) * FOOTFALL_PUSH_SHARE;
      impulseY += riderMass * FOOTFALL_WEIGHT_DV;
    }
    return { x: impulseX, y: impulseY };
  }

  /** Adds a rider's spin without ever cutting down a faster spin the prop already has. */
  function addRiderSpin(currentSpin, spinChange, cap) {
    var limit = cap === undefined ? RIDER_MAX_SPIN : cap;
    var next = currentSpin + spinChange;
    if (Math.abs(next) <= limit || Math.abs(next) <= Math.abs(currentSpin)) return next;
    return (next > 0 ? 1 : -1) * Math.max(limit, Math.abs(currentSpin));
  }

  /** Whether the travel on the face since the last footfall completes a stride. */
  function strideCompleted(strideDistance) {
    return strideDistance >= RIDER_STRIDE_PX;
  }

  // ---------- riding a moving prop: the feet only grip so hard ----------
  // A fighter standing on a prop is carried by the friction of his feet on
  // its top face, and friction can only accelerate him by mu * g per step.
  // A slow drift (a sliding crate, the hanging deck's swing) is matched and
  // he rides it; a kick that jerks the prop away out-runs the grip, so his
  // own inertia keeps him nearly in place while the prop slides out from
  // under him. Once the prop stops, the same grip brakes his drift.
  var RIDER_FOOT_FRICTION = 0.1;     // sole on a smooth lid / drum top: a kick yanks it out from under him

  /** Carry speed (px/step) after one step of foot friction toward the support's speed. */
  function frictionCarrySpeed(carrySpeed, supportSpeed, gravity, friction) {
    var grip = (friction === undefined ? RIDER_FOOT_FRICTION : friction) * gravity;
    var slip = supportSpeed - carrySpeed;
    if (Math.abs(slip) <= grip) return supportSpeed; // static friction: he moves with the face
    return carrySpeed + (slip > 0 ? grip : -grip);   // kinetic: the face slides under his feet
  }

  // A blow on a prop with a fighter right behind it (taking cover, or just
  // standing in front of it): the swing's push goes through the prop into him
  // and he is bowled over. He is not a wall, but he does stand his ground, so
  // part of the prop's motion comes back as a rebound toward whoever swung.
  // The rebound is then an ordinary moving prop: it only knocks the attacker
  // over if it arrives with the inertia fighterKnockoverImpact asks for.
  var BLOCKED_BLOW_RESTITUTION = 0.7; // share of the blow speed the prop gives back
  function blockedBlowReboundSpeed(blowSpeed) {
    return Math.max(0, blowSpeed) * BLOCKED_BLOW_RESTITUTION;
  }

  // A jumping fighter's head meets the underside of a prop. It is a collision
  // between two bodies: the prop is thrown UP by the fighter's momentum (the
  // lighter it is, the faster), the fighter keeps whatever rise the collision
  // leaves him (a very heavy prop sends him back down), and the prop slides a
  // little away from the side the head hit: the head under the left half
  // nudges it right, under the right half nudges it left, dead centre not at all.
  var HEAD_BUMP_RESTITUTION = 0.3;  // soft contact: a skull, not a bat
  var HEAD_BUMP_FORCE_GAIN = 1.5 * 1.4; // the headbutt throws the prop 50 % harder than the plain collision, then 40 % harder again
  var HEAD_BUMP_SIDE_RATIO = 0.15;  // sideways nudge per unit of upward speed at the very edge
  function headBumpOutcome(input) {
    var fighterMass = input.fighterMass || FIGHTER_MASS;
    var rise = Math.max(0, input.fighterRiseSpeed);
    var half0 = Math.max(input.propWidth / 2, 1e-6);
    var share0 = Math.max(-1, Math.min(1, (input.propCenterX - input.headCenterX) / half0));
    if (input.anchored || !(input.propMass > 0)) {
      // it cannot fly off, but a hanging body still takes the blow as a swing
      return { propVx: 0, propVy: 0, fighterRise: 0, offsetShare: share0,
        swingImpulse: share0 * rise * fighterMass * HEAD_BUMP_SIDE_RATIO * HEAD_BUMP_FORCE_GAIN };
    }
    var totalMass = fighterMass + input.propMass;
    var propUp = (1 + HEAD_BUMP_RESTITUTION) * fighterMass * rise / totalMass * HEAD_BUMP_FORCE_GAIN;
    var fighterRise = (fighterMass - HEAD_BUMP_RESTITUTION * input.propMass) * rise / totalMass;
    var half = Math.max(input.propWidth / 2, 1e-6);
    var offsetShare = Math.max(-1, Math.min(1, (input.propCenterX - input.headCenterX) / half)); // + : prop lies to the right of the head
    return {
      propVx: offsetShare * propUp * HEAD_BUMP_SIDE_RATIO,
      propVy: -propUp,
      fighterRise: fighterRise,
      offsetShare: offsetShare
    };
  }

  var api = {
    HEAD_BUMP_RESTITUTION: HEAD_BUMP_RESTITUTION,
    HEAD_BUMP_FORCE_GAIN: HEAD_BUMP_FORCE_GAIN,
    headBumpOutcome: headBumpOutcome,
    BLOCKED_BLOW_RESTITUTION: BLOCKED_BLOW_RESTITUTION,
    blockedBlowReboundSpeed: blockedBlowReboundSpeed,
    RIDER_MAX_SPIN: RIDER_MAX_SPIN,
    RIDER_LANDING_MAX_SPIN: RIDER_LANDING_MAX_SPIN,
    RIDER_STRIDE_PX: RIDER_STRIDE_PX,
    surfaceImpulseSpin: surfaceImpulseSpin,
    riderSurfaceSpin: riderSurfaceSpin,
    riderSurfaceImpulse: riderSurfaceImpulse,
    RIDER_FOOT_FRICTION: RIDER_FOOT_FRICTION,
    frictionCarrySpeed: frictionCarrySpeed,
    addRiderSpin: addRiderSpin,
    strideCompleted: strideCompleted,
    BULLET_IMPULSE_TO_SPEED: BULLET_IMPULSE_TO_SPEED,
    FIGHTER_MASS: FIGHTER_MASS,
    TOPPLE_MIN_SPIN: TOPPLE_MIN_SPIN,
    MAX_SEPARATION_PER_PASS: MAX_SEPARATION_PER_PASS,
    contactHeightShare: contactHeightShare,
    freeBodySpin: freeBodySpin,
    bulletResponse: bulletResponse,
    pointInRotatedBox: pointInRotatedBox,
    overhangSpinAcceleration: overhangSpinAcceleration,
    pairSeparation: pairSeparation,
    sideCollisionVelocities: sideCollisionVelocities,
    meleeRecoilSpeed: meleeRecoilSpeed,
    decayRecoil: decayRecoil,
    standingTipSpin: standingTipSpin,
    fighterKnockoverImpact: fighterKnockoverImpact
  };
  root.SuperfightersImpactDynamics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
