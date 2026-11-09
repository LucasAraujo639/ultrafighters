/**
 * Superfighters clone — rigid-body hit response (pure rules, no game state).
 *
 * Mirrors how the original Box2D scene reacts to hits: an impulse applied at a
 * contact point changes the linear velocity by J/m and the angular velocity by
 * (r x J)/I, where r is the lever arm from the centre of mass. An impulse
 * through the centre therefore only slides the body; an off-centre one spins
 * it. On top of that this module adds the gameplay filters the clone needs:
 *  - a torque dead-band: weak or nearly central hits never produce a visible spin;
 *  - bounded and damped angular speed (no endless or erratic rotation);
 *  - a rectangular tip-over model with continuous dynamics: a box on the floor
 *    pivots on its lower corner under the real gravity torque
 *    (tau = m g r sin(alpha - tilt)). That torque is a smooth function of the
 *    tilt that vanishes exactly at the tipping point (the centre of mass over
 *    the pivot): below it gravity swings the box back, past it gravity
 *    accelerates the fall. The angle is never snapped to 0/90 degrees and the
 *    angular velocity is never damped: only a face hitting the floor takes
 *    energy out, with the rigid-block coefficient (Housner).
 *  - inertia, not the angle alone, decides a tip-over: a body spinning with
 *    more rotational energy than it takes to lift its centre of mass over the
 *    pivot rolls over from any tilt (hasTipMomentum); a strong blow keeps the
 *    share of its spin above the usual cap that gives it that energy.
 *
 * Units: px, rad, steps. Angles grow clockwise on screen (canvas convention).
 */
(function (root) {
  'use strict';

  var QUARTER_TURN = Math.PI / 2;

  var TORQUE_DEADBAND = 0.02;        // rad/step of spin a hit must exceed before it counts
  var MAX_SPIN = 0.35;               // rad/step hard cap on angular speed
  var AIR_SPIN_DAMPING = 0.995;      // per step while airborne (almost free rotation)
  var DEFAULT_GRAVITY = 0.3375;      // px/step^2 (the game's prop gravity); callers pass their own
  var ANGLE_REST_EPSILON = 0.01;     // rad (0.57 deg = ~0.2 px on a 20 px prop): numerically flat
  var SPIN_REST_EPSILON = 0.005;     // rad/step: about one step of gravity at that tilt, it cannot lift an edge again
  var MIN_FACE_LANDING_TRANSFER = 0;  // a squat box that lands on a face loses all its rotation
  var FACE_LANDING_DRAG = 1.5;       // Housner: spin kept = 1 - 1.5 sin^2(alpha)

  // Natural variation: no two hits are identical. Each kind of source wobbles
  // the force, the push direction, the contact point and the lever (torque).
  var HIT_VARIATION = {
    melee: { force: 0.25, angle: 0.3, contact: 4, torque: 0.35 },
    blast: { force: 0.15, angle: 0.25, contact: 3, torque: 0.3 },
    bullet: { force: 0.1, angle: 0.15, contact: 2, torque: 0.2 }
  };

  /** Uniform jitter in [-1, 1]; `random` is injected so tests can pin it (0.5 = no jitter). */
  function jitter(random) {
    return random() * 2 - 1;
  }

  /**
   * Returns a varied copy of a hit {pushX, pushY, x, y, torqueBoost}: force
   * scaled, direction rotated, contact moved and torque boosted at random.
   * `spreadScale` (default 1) narrows the force, direction and torque wobble.
   */
  function varyHit(hit, kind, random, spreadScale) {
    var spread = HIT_VARIATION[kind];
    if (!spread) return hit;
    var scale = spreadScale === undefined ? 1 : spreadScale; // < 1 narrows the wobble (steadier bodies)
    var force = 1 + jitter(random) * spread.force * scale;
    var angle = jitter(random) * spread.angle * scale;
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    return {
      pushX: (hit.pushX * cos - hit.pushY * sin) * force,
      pushY: (hit.pushX * sin + hit.pushY * cos) * force,
      x: hit.x + jitter(random) * spread.contact,
      y: hit.y + jitter(random) * spread.contact,
      torqueBoost: (hit.torqueBoost || 1) * (1 + jitter(random) * spread.torque * scale)
    };
  }

  function clamp(value, limit) {
    return Math.max(-limit, Math.min(limit, value));
  }

  /**
   * Change in angular speed from a velocity change `dv` applied at lever arm
   * (leverX, leverY) from the centre of mass of a w x h box (unit-density
   * rectangle: I/m = (w^2 + h^2) / 12, so the mass cancels because `dv` is
   * already the impulse divided by mass). The dead-band is subtracted so a hit
   * only starts a spin once it is clearly strong enough.
   */
  function spinChangeFromImpulse(width, height, leverX, leverY, dvx, dvy, boost) {
    var raw = (leverX * dvy - leverY * dvx) * 12 / (width * width + height * height) * (boost || 1);
    var magnitude = Math.abs(raw);
    if (magnitude <= TORQUE_DEADBAND) return 0;
    return (raw > 0 ? 1 : -1) * (magnitude - TORQUE_DEADBAND);
  }

  /** Quarter-turn index of the face the box currently rests on. */
  function poseForAngle(angle) {
    return Math.round(angle / QUARTER_TURN);
  }

  /** Tilt (rad) past which a box resting on a face of width `support` and height `rise` topples. */
  function tipBarrier(support, rise) {
    return Math.atan(support / rise);
  }

  /**
   * Angular acceleration (rad/step^2) gravity gives a box tilted `tilt` rad
   * from the face it rests on, pivoting on its lower corner. The centre of
   * mass sits r = D/2 from the pivot (D = box diagonal) at an angle alpha
   * from the vertical when flat; the torque m g r sin(alpha - |tilt|) over the
   * inertia about the corner m D^2 / 3 gives K sin(|tilt| - alpha) with
   * K = 3 g / (2 D). Negative (back toward the face) below the barrier,
   * zero exactly at it, positive (toward falling) past it. Returned with the
   * sign of the tilt, so it always points along / against the lean.
   */
  function tipAngularAcceleration(tilt, support, rise, gravity) {
    if (tilt === 0) return 0;
    var diagonal = Math.sqrt(support * support + rise * rise);
    var stiffness = 3 * gravity / (2 * diagonal);
    return (tilt > 0 ? 1 : -1) * stiffness * Math.sin(Math.abs(tilt) - tipBarrier(support, rise));
  }

  /**
   * Share of its angular velocity a rocking box keeps when its face meets the
   * floor and it starts pivoting on the opposite corner (Housner's rigid
   * block: 1 - 3/2 sin^2(alpha)). Slender boxes keep a lot and rock for a
   * while; a squat one stops dead.
   */
  function faceLandingTransfer(support, rise) {
    var sine = Math.sin(tipBarrier(support, rise));
    return Math.max(MIN_FACE_LANDING_TRANSFER, 1 - FACE_LANDING_DRAG * sine * sine);
  }

  /**
   * One step of rotation for a box in contact with the ground. `state` is
   * {angle, spin, pose}; `pose` is the quarter-turn index of the face it rests
   * on. The box pivots on its lower corner under the gravity torque
   * (tipAngularAcceleration): the angular velocity is integrated as it is, with
   * no damping and no snapping. When the box swings through flat, or falls
   * onto the next face, its face meets the floor: that impact keeps
   * faceLandingTransfer of the spin and the box carries on, so the angle is
   * continuous and a tumble that has enough momentum rolls over the next edge.
   * Returns true once the box is numerically at rest (no more rotation).
   */
  function stepGroundRotation(state, width, height, gravity) {
    var g = gravity === undefined ? DEFAULT_GRAVITY : gravity;
    // the bookkeeping pose may be stale (the caller wrote the angle directly): re-derive it
    if (state.pose === undefined || Math.abs(state.angle - state.pose * QUARTER_TURN) >= QUARTER_TURN) {
      state.pose = poseForAngle(state.angle);
    }
    var odd = Math.abs(state.pose) % 2 === 1;
    var before = state.angle - state.pose * QUARTER_TURN;
    state.spin = clamp(state.spin + tipAngularAcceleration(before, odd ? height : width, odd ? width : height, g), MAX_SPIN);
    state.angle += state.spin;
    var offset = state.angle - state.pose * QUARTER_TURN;
    var crossedFlat = before !== 0 && ((offset > 0) !== (before > 0) || offset === 0);
    var toppled = Math.abs(offset) >= QUARTER_TURN;
    if (toppled) state.pose += offset > 0 ? 1 : -1; // now resting on the next face
    if (crossedFlat || toppled) {
      var landedOdd = Math.abs(state.pose) % 2 === 1;
      state.spin *= faceLandingTransfer(landedOdd ? height : width, landedOdd ? width : height);
      offset = state.angle - state.pose * QUARTER_TURN;
    }
    if (Math.abs(offset) < ANGLE_REST_EPSILON && Math.abs(state.spin) < SPIN_REST_EPSILON) {
      state.angle = state.pose * QUARTER_TURN; // numerical rest: well under a pixel of travel
      state.spin = 0;
      return true;
    }
    return false;
  }

  // ---------- inertia decides the tip-over, not the barrier angle alone ----------
  // Energy view of the same dynamics: gravity's potential is
  // V(tilt) = K cos(alpha - |tilt|), highest exactly at the barrier. A box
  // spinning at w carries 1/2 w^2 of rotational energy, so it rolls over the
  // edge from ANY tilt (even flat) when 1/2 w^2 >= K (1 - cos(alpha - |tilt|)).
  // A strong blow therefore topples a box long before it reaches 45 degrees;
  // a weak one only rocks it.
  var EXCESS_HIT_SPIN_SHARE = 0.4;   // share of a blow's spin above the soft cap still kept as rotation
  var HIT_SPIN_HARD_FACTOR = 2.5;    // a single blow never spins a body faster than this many soft caps

  function tipStiffness(support, rise, gravity) {
    return 3 * gravity / (2 * Math.sqrt(support * support + rise * rise));
  }

  /**
   * Angular speed (rad/step) a box tilted `tilt` rad from the face it rests on
   * needs, spinning toward its lean, to carry its centre of mass over the
   * pivot. Zero once past the barrier (gravity already does the rest).
   */
  function criticalTipSpin(tilt, support, rise, gravity) {
    var climb = tipBarrier(support, rise) - Math.abs(tilt);
    if (climb <= 0) return 0;
    return Math.sqrt(2 * tipStiffness(support, rise, gravity) * (1 - Math.cos(climb)));
  }

  /**
   * Whether the body's angular inertia alone carries it over an edge.
   * `state` is {angle, spin, pose?}. Spinning toward its lean (or from flat)
   * it must climb from its tilt to the barrier; spinning back toward flat it
   * first gains the fall to flat, loses the face impact (Housner) and must
   * then climb the whole barrier on the other side.
   */
  function hasTipMomentum(state, width, height, gravity) {
    var spin = state.spin || 0;
    if (spin === 0) return false;
    var g = gravity === undefined ? DEFAULT_GRAVITY : gravity;
    var pose = state.pose;
    if (pose === undefined || Math.abs(state.angle - pose * QUARTER_TURN) >= QUARTER_TURN) pose = poseForAngle(state.angle);
    var odd = Math.abs(pose) % 2 === 1;
    var support = odd ? height : width;
    var rise = odd ? width : height;
    var offset = state.angle - pose * QUARTER_TURN;
    if (offset === 0 || (spin > 0) === (offset > 0)) return Math.abs(spin) >= criticalTipSpin(offset, support, rise, g);
    var stiffness = tipStiffness(support, rise, g);
    var barrier = tipBarrier(support, rise);
    var atFlatSquared = spin * spin + 2 * stiffness * (Math.cos(barrier - Math.abs(offset)) - Math.cos(barrier));
    var transfer = faceLandingTransfer(support, rise);
    var afterImpact = Math.sqrt(Math.max(0, atFlatSquared)) * transfer;
    return afterImpact >= criticalTipSpin(0, support, rise, g);
  }

  /**
   * Adds a blow's spin to a body. Up to `softCap` it counts in full (the
   * usual rocking blow); beyond it only EXCESS_HIT_SPIN_SHARE of the surplus
   * is kept, up to `hardCap`, so a blow strong enough still carries the
   * inertia to topple the body, but never whirls it. A blow never cuts down a
   * faster spin the body already has.
   */
  function inertialHitSpin(currentSpin, spinChange, softCap, hardCap) {
    var next = currentSpin + spinChange;
    var magnitude = Math.abs(next);
    if (magnitude <= softCap || magnitude <= Math.abs(currentSpin)) return clamp(next, MAX_SPIN);
    var limit = Math.min(MAX_SPIN, Math.max(softCap, hardCap === undefined ? softCap * HIT_SPIN_HARD_FACTOR : hardCap));
    var shaped = Math.min(limit, softCap + (magnitude - softCap) * EXCESS_HIT_SPIN_SHARE);
    var sameWay = (next > 0) === (currentSpin > 0);
    if (sameWay) shaped = Math.max(shaped, Math.min(Math.abs(currentSpin), MAX_SPIN));
    return (next > 0 ? 1 : -1) * shaped;
  }

  var OVERHANG_MARGIN = 0.5;         // px the centre of mass may stick out before the box loses balance
  var OVERHANG_SPIN_PER_STEP = 0.01; // rad/step^2 of torque gravity adds while the centre hangs over the void

  /**
   * Which way a resting box topples: -1 (left), 1 (right) or 0 (balanced).
   * Balanced while its centre of mass sits over the span it actually rests on.
   */
  function overhangDirection(centerX, supportLeft, supportRight) {
    if (!(supportRight >= supportLeft)) return 0; // no support span recorded
    if (centerX > supportRight + OVERHANG_MARGIN) return 1;
    if (centerX < supportLeft - OVERHANG_MARGIN) return -1;
    return 0;
  }

  /**
   * Rotation while airborne. By default the spin only bleeds slightly (free
   * tumble); `damping` (per-step factor) lets a caller brake the small spin a
   * blow left on a heavy body, which would otherwise keep leaning all the way
   * through a hop.
   */
  function stepAirRotation(state, damping) {
    state.angle += state.spin;
    state.spin = clamp(state.spin * (damping === undefined ? AIR_SPIN_DAMPING : damping), MAX_SPIN);
    state.pose = poseForAngle(state.angle);
  }

  var api = {
    QUARTER_TURN: QUARTER_TURN,
    TORQUE_DEADBAND: TORQUE_DEADBAND,
    MAX_SPIN: MAX_SPIN,
    clamp: clamp,
    varyHit: varyHit,
    HIT_VARIATION: HIT_VARIATION,
    spinChangeFromImpulse: spinChangeFromImpulse,
    poseForAngle: poseForAngle,
    tipBarrier: tipBarrier,
    tipAngularAcceleration: tipAngularAcceleration,
    faceLandingTransfer: faceLandingTransfer,
    criticalTipSpin: criticalTipSpin,
    hasTipMomentum: hasTipMomentum,
    inertialHitSpin: inertialHitSpin,
    EXCESS_HIT_SPIN_SHARE: EXCESS_HIT_SPIN_SHARE,
    HIT_SPIN_HARD_FACTOR: HIT_SPIN_HARD_FACTOR,
    stepGroundRotation: stepGroundRotation,
    stepAirRotation: stepAirRotation,
    overhangDirection: overhangDirection,
    OVERHANG_SPIN_PER_STEP: OVERHANG_SPIN_PER_STEP
  };
  root.SuperfightersRigidImpact = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
