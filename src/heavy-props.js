/**
 * Superfighters clone — heavy interactive props (pure rules, no game state).
 *
 * Three props share this module's data and decisions:
 *  - HANGING     (sprite 2.svg)    dangles from a rope; only a bullet crossing
 *                                  the rope anchor or a blast reaching it cuts
 *                                  it loose, and the fall crushes whoever is under.
 *  - METAL_CRATE (sprite 134.svg)  very heavy, barely moves, bullets ring off it
 *                                  with the metallic hit sound.
 *  - BOUNCER     (sprite 1063.svg) own art and size; its physics come from the
 *                                  same CEMENT_DRUM_PHYSICS block as the cement barrel.
 *
 * The module only answers questions ("is the anchor hit?", "does it bounce?")
 * and hands back plain data; physics, damage and drawing stay in game.js.
 * Randomness is injected (`random`) so every rule is deterministic in tests.
 */
(function (root) {
  'use strict';

  var HEAVY_PROP_KIND = {
    HANGING: 'hanging',
    METAL_CRATE: 'metalCrate',
    BOUNCER: 'bouncer',
    CEMENT_BARREL: 'cementBarrel',
    TABLE: 'table',
    TABLE_FRAGMENT_A: 'tableFragmentA',
    TABLE_FRAGMENT_B: 'tableFragmentB',
    TABLE_FRAGMENT_C: 'tableFragmentC'
  };

  // Shipped art is tiny (13-29 px); it is drawn at the same 1.25 factor the
  // barrels use so the props sit in scale with the fighters.
  var HEAVY_PROP_ART_SCALE = 1.25;
  // Original Kick(): KickWeightCalculation props get impulse = KickPower * mass, so
  // their launch speed (dv) is the KickPower itself, whatever the mass. Speeds
  // below are relative to the plain crate's 1.7 m/s. The off-centre lift
  // (0,-0.4 * min(mass,1)) shrinks only for bodies heavier than 1 (mass =
  // density * area in m^2: wood 3, metal 10).
  var KICK_SPEED_RATIO_TABLE = 0.58; // original KickPower 0.95 fixed impulse (0.93 of a crate), lowered for the hop's airtime
  var BASE_CRATE_MASS = 1; // the plain wooden crate every mass is measured against

  // Response multipliers to melee blows and explosions (bullets are tuned
  // separately). 1 = the base response; 1.3 = +30 %. `vertical` scales the
  // upward push (hop), `torque` the spin a hit gives (and its ceiling),
  // `horizontal` the slide speed. Edit a row to fine-tune one family.
  var NEUTRAL_IMPACT_MULTIPLIERS = { vertical: 1, torque: 1, horizontal: 1 };
  var PLAIN_CRATE_IMPACT_MULTIPLIERS = { vertical: 1.3, torque: 1.9, horizontal: 1.3 };   // wooden crate: +30 / +90 / +30 %
  // Rows are tuned as "previous row x requested change" so each tweak stays traceable.
  var BARREL_BASE_IMPACT_MULTIPLIERS = { vertical: 1.2, torque: 1.8, horizontal: 1.2 };  // shared drum row: +20 / +80 / +20 %
  var CEMENT_BARREL_RESPONSE_TWEAK = { vertical: 0.64, torque: 1.4, horizontal: 1.2 };    // cement drum: -36 % lift (-20 % twice), +40 % spin, +20 % slide
  var EXPLOSIVE_BARREL_RESPONSE_TWEAK = { vertical: 1.3 * 0.8, torque: 1.3, horizontal: 1.3 }; // fire barrel: the cement drum's row, everything +30 %, then -20 % lift
  var METAL_CRATE_BASE_IMPACT_MULTIPLIERS = { vertical: 1.05, torque: 1.3, horizontal: 1.05 }; // +5 / +30 / +5 %
  var METAL_CRATE_RESPONSE_TWEAK = { vertical: 1, torque: 1.44, horizontal: 1 };         // metal crate: +20 % spin, then +20 % again

  function scaleImpactRow(row, tweak) {
    return {
      vertical: row.vertical * tweak.vertical,
      torque: row.torque * tweak.torque,
      horizontal: row.horizontal * tweak.horizontal
    };
  }

  var CEMENT_BARREL_IMPACT_MULTIPLIERS = scaleImpactRow(BARREL_BASE_IMPACT_MULTIPLIERS, CEMENT_BARREL_RESPONSE_TWEAK);
  var EXPLOSIVE_BARREL_IMPACT_MULTIPLIERS = scaleImpactRow(CEMENT_BARREL_IMPACT_MULTIPLIERS, EXPLOSIVE_BARREL_RESPONSE_TWEAK); // follows the cement row
  var METAL_CRATE_IMPACT_MULTIPLIERS = scaleImpactRow(METAL_CRATE_BASE_IMPACT_MULTIPLIERS, METAL_CRATE_RESPONSE_TWEAK);

  var HEAVY_PROP_CONFIG = {};

  HEAVY_PROP_CONFIG[HEAVY_PROP_KIND.METAL_CRATE] = {
    sprite: 134,
    width: 13 * HEAVY_PROP_ART_SCALE,
    height: 15 * HEAVY_PROP_ART_SCALE,
    mass: 5.6,                     // still far heavier than a fighter (crate = 1): 7 less 20 %
    friction: 0.4,                 // original metal friction
    impactMultipliers: METAL_CRATE_IMPACT_MULTIPLIERS,
    bulletImmovable: true,         // shots dent it (damage, sound) but never move or tilt it
    hitVariationScale: 0.1,        // almost no wobble: every kick and blast on it plays out nearly the same
    torqueScale: 0.06,             // a hit barely tilts it
    maxHitSpin: 0.0175,
    kickSpeedRatio: 0.35,          // hard to kick: only a sliver of a crate's launch speed
    meleeVerticalRatio: 0.32,
    hitPoints: 600,                // bullets barely scratch it
    damageTakenMultiplier: 0.05,   // metal shrugs off 95% of every hit
    bulletHitSound: 'BULLET_HIT_METAL',
    material: 'metal',
    knockbackMinSpeed: 2.5,        // only a blast-launched crate carries enough energy
    knockbackTransfer: 0.7,
    bounceChance: 0,
    crushChance: 0
  };

  // Physics shared by every cement-drum family prop (the cement barrel and the
  // bouncer, sprite 1063): edit this one block and both change. Art, size and
  // durability stay in each prop's own entry below. Inert and rigid, medium-heavy:
  // it slides when pushed or shot, and it is NOT a fuel barrel (no ignition,
  // no explosion).
  var CEMENT_DRUM_PHYSICS = {
    mass: 2,                       // original barrel: metal 10 x (9x13 px) = 2x a crate
    friction: 0.4,
    kickSpeedRatio: 0.47,          // horizontal launch share (the hop adds airtime, so the push is gentler)
    liftRatio: 0.65,               // the boot lifts it a little less than a crate...
    liftTorqueRatio: 1 / 1.3,      // ...but it still levers the edge (original barrel lift, mass 1.3)
    meleeVerticalRatio: 0.95,      // a blow pops it up a little (a touch under the original)
    impactMultipliers: CEMENT_BARREL_IMPACT_MULTIPLIERS, // the explosive barrel has its own row
    torqueScale: 0.175,            // a solid drum: a blow rocks it slowly, it never spins on its own axis
    maxHitSpin: 0.035,             // rad/step: a slow lean, enough to tip onto whoever stands beside it
    bulletPush: 0.3,               // each shot nudges it along the bullet's direction
    knockbackMinSpeed: 2.5,
    knockbackTransfer: 0.7,
    hitVariationScale: 0.35,       // no two kicks alike, but within a narrow band: never a tiny hop one time and a vault the next
    bounceChance: 0,
    crushChance: 0
  };

  HEAVY_PROP_CONFIG[HEAVY_PROP_KIND.CEMENT_BARREL] = Object.assign({}, CEMENT_DRUM_PHYSICS, {
    sprite: 156,
    width: 11 * HEAVY_PROP_ART_SCALE,
    height: 15 * HEAVY_PROP_ART_SCALE,
    hitPoints: 300,
    damageTakenMultiplier: 0.1,
    bulletHitSound: 'BULLET_HIT_DEFAULT',
    material: 'concrete'
  });

  // Bouncer (sprite 1063): the cement drum's physics, its own art and durability.
  HEAVY_PROP_CONFIG[HEAVY_PROP_KIND.BOUNCER] = Object.assign({}, CEMENT_DRUM_PHYSICS, {
    sprite: 1063,
    width: 15 * HEAVY_PROP_ART_SCALE,
    height: 17 * HEAVY_PROP_ART_SCALE,
    hitPoints: 80,
    damageTakenMultiplier: 0.5,
    bulletHitSound: 'BULLET_HIT_WOOD',
    material: 'wood'
  });

  // Destructible table: breaks into three wooden fragments that keep the
  // wood material (so they also burn and are consumed by fire).
  var TABLE_FRAGMENT_KINDS = [
    HEAVY_PROP_KIND.TABLE_FRAGMENT_A,
    HEAVY_PROP_KIND.TABLE_FRAGMENT_B,
    HEAVY_PROP_KIND.TABLE_FRAGMENT_C
  ];
  HEAVY_PROP_CONFIG[HEAVY_PROP_KIND.TABLE] = {
    sprite: 202,
    width: 18 * HEAVY_PROP_ART_SCALE,
    height: 10 * HEAVY_PROP_ART_SCALE,
    mass: 0.92,                    // original table: wood 3 x (18x10 px) = 0.9x a crate
    friction: 0.6,
    kickSpeedRatio: KICK_SPEED_RATIO_TABLE, // original TABLE: KickPower 0.95 fixed impulse
    meleeVerticalRatio: 0.84,
    torqueScale: 0.25,             // light and wide: it leans over, but never whirls in place
    maxHitSpin: 0.05,
    hitPoints: 30,
    damageTakenMultiplier: 1,
    bulletHitSound: 'BULLET_HIT_WOOD',
    material: 'wood',
    debrisKinds: TABLE_FRAGMENT_KINDS,
    debrisScatterSpeed: 2.5,       // px/step of random dispersion on break
    bounceChance: 0,
    crushChance: 0
  };
  var FRAGMENT_SPRITES = [205, 208, 211];
  var FRAGMENT_SIZES = [[6, 10], [11, 3], [5, 10]];
  for (var f = 0; f < TABLE_FRAGMENT_KINDS.length; f++) {
    HEAVY_PROP_CONFIG[TABLE_FRAGMENT_KINDS[f]] = {
      sprite: FRAGMENT_SPRITES[f],
      width: FRAGMENT_SIZES[f][0] * HEAVY_PROP_ART_SCALE,
      height: FRAGMENT_SIZES[f][1] * HEAVY_PROP_ART_SCALE,
      mass: 0.6,
      hitPoints: 12,
      damageTakenMultiplier: 1,
      bulletHitSound: 'BULLET_HIT_WOOD',
      material: 'wood',
      fragment: true,              // non-solid, flammable, lives lifetimeSteps then vanishes
      lifetimeSteps: 1200,         // 20 s at 60 Hz
      bounceChance: 0,
      crushChance: 0
    };
  }

  HEAVY_PROP_CONFIG[HEAVY_PROP_KIND.HANGING] = {
    sprite: 2,
    width: 29 * HEAVY_PROP_ART_SCALE,
    height: 16 * HEAVY_PROP_ART_SCALE,
    mass: 12,                      // heavier than the green metal crate (7)
    friction: 0.4,                 // once landed it grips the floor like the metal crate
    kickSpeedRatio: 0.2,           // a kick/punch gives a landed deck only 20% of a crate's launch speed
    meleeVerticalRatio: 0.18,
    blastSpeedRatio: 0.45,         // a grenade feels the weight too: 45% of a crate's launch speed (only blasts really move it)
    liftRatio: 0.25,               // a boot can hardly lift it
    torqueScale: 0.1,              // a hit barely tilts it
    maxHitSpin: 0.02,
    hitPoints: 1000000,            // the body is never worn down, only the rope matters
    damageTakenMultiplier: 0,
    bulletPush: 0.4,               // a shot swings it by this share of the bullet speed
    bulletHitSound: 'BULLET_HIT_METAL',
    material: 'metal',
    bounceChance: 0,
    crushChance: 0,
    swayStiffness: 0.04,           // legacy spring (swayStep only); the game uses pendulumStep (gravity)
    swayDamping: 0.012,            // per step: air + rope friction, a heavy swing dies out slowly
    swayMaxAngle: 0.22,            // rad: the most energy a swing can carry (it peaks there smoothly)
    weightTiltMax: 0.04,           // legacy (swayStep only): pendulumStep tilts by the real weight torque
    unstableAngle: 0.1,            // beyond this tilt the deck starts to slide a fighter off
    edgeSlidePush: 0.35,           // px/step
    meleeSwingShare: 0.01,         // punches/kicks barely nudge it (1% of a blast)
    bulletSwingShare: 0.08,        // a bullet moves it 1/12 as much as a blast (mass 12)
    bulletSwingGain: 0.012,        // angular speed gained per px/step of push landing at the centre of mass (lower = more, near the rope = less)
    ropeLength: 8,                 // px between the ceiling anchor and the body top
    anchorHitHalfWidth: 3,         // the rope is thin: a precise shot is required
    fallCrushMinSpeed: 1,          // px/step downward before the falling deck crushes
    crushDamage: 9999,             // lethal: takes all his health, no chance to survive
    landedCrushMinFallSpeed: 1.5,  // a landed deck pushed off an edge crushes once it falls this fast
    crushBlastShare: 1,
    crushCooldownSteps: 45
  };

  /** Axis-aligned extent of a w x h rectangle rotated by `angle`: the hitbox follows the sprite. */
  function rotatedExtent(width, height, angle) {
    var cos = Math.abs(Math.cos(angle));
    var sin = Math.abs(Math.sin(angle));
    return { w: width * cos + height * sin, h: width * sin + height * cos };
  }

  /**
   * One pendulum step for the hanging deck: a damped spring toward
   * `targetAngle` (the weight tilt) with a hard cap. Mutates {angle, omega}.
   */
  function swayStep(state, targetAngle, config, timeScale) {
    var scale = timeScale || 1;
    state.omega += (-config.swayStiffness * (state.angle - targetAngle) - config.swayDamping * state.omega) * scale;
    state.angle += state.omega * scale;
    if (state.angle > config.swayMaxAngle) { state.angle = config.swayMaxAngle; state.omega = Math.min(0, state.omega); }
    if (state.angle < -config.swayMaxAngle) { state.angle = -config.swayMaxAngle; state.omega = Math.max(0, state.omega); }
    return state;
  }

  // ---------- the hanging deck as a real physical pendulum ----------
  // The deck (mass M, w x h) hangs with its centre of mass d = rope + h/2
  // under the ceiling pivot. Its inertia about the pivot is
  // I = M ((w^2 + h^2) / 12 + d^2) (parallel axis), and gravity pulls it back
  // with tau = -M g d sin(angle): a heavy, slow, natural swing, not a spring
  // with an invented stiffness. Fighters standing on it add their weight at
  // their own lever (the swing settles where the combined centre of mass sits
  // under the pivot) and their inertia. The swing is bounded by ENERGY: it
  // simply never carries more than it takes to reach swayMaxAngle, so it
  // peaks smoothly there instead of hitting a wall.
  var PENDULUM_MIN_INERTIA = 1e-6;

  /** Inertia (mass * px^2) of the deck about its ceiling pivot. */
  function pendulumInertia(config, swingLength) {
    var w = config.width;
    var h = config.height;
    return config.mass * ((w * w + h * h) / 12 + swingLength * swingLength);
  }

  /**
   * One pendulum step. `state` {angle, omega}: angle > 0 swings the body
   * toward +x. `input`: { gravity, swingLength, riders: [{ mass, offsetX,
   * depth }] } where offsetX is a rider's horizontal distance from the pivot
   * (world) and depth his vertical distance below it. Mutates and returns
   * state.
   */
  function pendulumStep(state, input, config, timeScale) {
    var scale = timeScale || 1;
    var gravity = input.gravity;
    var swingLength = input.swingLength;
    var inertia = pendulumInertia(config, swingLength);
    var gravityTorque = -config.mass * gravity * swingLength * Math.sin(state.angle);
    var riders = input.riders || [];
    for (var i = 0; i < riders.length; i++) {
      var rider = riders[i];
      // a weight right of the pivot dips that side: the body swings toward -x
      gravityTorque -= rider.mass * gravity * rider.offsetX;
      inertia += rider.mass * (rider.offsetX * rider.offsetX + rider.depth * rider.depth);
    }
    var angularAcceleration = gravityTorque / Math.max(inertia, PENDULUM_MIN_INERTIA);
    state.omega += (angularAcceleration - config.swayDamping * state.omega) * scale;
    state.omega = limitSwingEnergy(state.angle, state.omega, config, input, inertia);
    state.angle += state.omega * scale;
    return state;
  }

  /** Caps the angular speed so the swing can never carry past swayMaxAngle. */
  function limitSwingEnergy(angle, omega, config, input, inertia) {
    var stiffness = config.mass * input.gravity * input.swingLength / Math.max(inertia, PENDULUM_MIN_INERTIA);
    var headroom = Math.cos(Math.min(Math.abs(angle), config.swayMaxAngle)) - Math.cos(config.swayMaxAngle);
    var outward = angle === 0 || (omega > 0) === (angle > 0);
    if (!outward) return omega; // swinging back toward the bottom: gravity is paying, nothing to cap
    var maxOmega = Math.sqrt(2 * stiffness * Math.max(0, headroom));
    return Math.max(-maxOmega, Math.min(maxOmega, omega));
  }

  /**
   * Angular speed change of a horizontal impulse `impulseX` (mass * px/step)
   * applied `depth` px under the pivot: dw = J * depth / I. A blow low on the
   * deck swings it more than one next to the rope.
   */
  function pendulumImpulseSpin(config, swingLength, impulseX, depth) {
    return impulseX * Math.max(0, depth) / pendulumInertia(config, swingLength);
  }

  /** Hit-zone of the rope: a thin box centred on the rope between ceiling and body. */
  function anchorZone(prop) {
    var config = HEAVY_PROP_CONFIG[HEAVY_PROP_KIND.HANGING];
    var centerX = prop.x + prop.w / 2;
    return {
      x: centerX - config.anchorHitHalfWidth,
      y: prop.y - config.ropeLength,
      w: config.anchorHitHalfWidth * 2,
      h: config.ropeLength
    };
  }

  /** Centre of the rope, the point an explosion has to reach. */
  function anchorPoint(prop) {
    var zone = anchorZone(prop);
    return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
  }

  function pointInZone(zone, x, y) {
    return x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h;
  }

  /**
   * Did a bullet travelling from (fromX,fromY) to (toX,toY) cross the rope this
   * step? Sampled along the segment so fast bullets cannot tunnel through the
   * 6 px wide zone.
   */
  function segmentCrossesAnchor(prop, fromX, fromY, toX, toY) {
    var zone = anchorZone(prop);
    var length = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
    var samples = Math.max(1, Math.ceil(length / 2));
    for (var i = 0; i <= samples; i++) {
      var t = i / samples;
      if (pointInZone(zone, fromX + (toX - fromX) * t, fromY + (toY - fromY) * t)) return true;
    }
    return false;
  }

  /** True when a blast of `radius` centred at (x,y) reaches the rope anchor. */
  function blastReachesAnchor(prop, x, y, radius) {
    var point = anchorPoint(prop);
    var dx = point.x - x;
    var dy = point.y - y;
    return dx * dx + dy * dy <= radius * radius;
  }

  /** Does a hit of `impact` strength pop a resting bouncer off the floor? */
  function shouldBounce(config, impact, random) {
    if (!config || !config.bounceChance) return false;
    if (impact < (config.bounceMinImpact || 0)) return false;
    return random() < config.bounceChance;
  }

  /** Lethal crush (true) or just a glancing blow (false) for a bounce that landed on a fighter. */
  function bounceCrushIsLethal(config, random) {
    return !!config && random() < config.crushChance;
  }

  /** Impact multipliers of a prop: its config row, the plain crate's when it has no config, neutral otherwise. */
  function impactMultipliersFor(config) {
    if (!config) return PLAIN_CRATE_IMPACT_MULTIPLIERS;
    return config.impactMultipliers || NEUTRAL_IMPACT_MULTIPLIERS;
  }

  /** Impulses are divided by mass: the same shove moves a metal crate far less than a wooden one. */
  function impulseForMass(impulse, mass) {
    return impulse * BASE_CRATE_MASS / Math.max(mass || BASE_CRATE_MASS, BASE_CRATE_MASS);
  }

  var api = {
    HEAVY_PROP_KIND: HEAVY_PROP_KIND,
    HEAVY_PROP_CONFIG: HEAVY_PROP_CONFIG,
    BASE_CRATE_MASS: BASE_CRATE_MASS,
    rotatedExtent: rotatedExtent,
    swayStep: swayStep,
    pendulumInertia: pendulumInertia,
    pendulumStep: pendulumStep,
    pendulumImpulseSpin: pendulumImpulseSpin,
    anchorZone: anchorZone,
    anchorPoint: anchorPoint,
    segmentCrossesAnchor: segmentCrossesAnchor,
    blastReachesAnchor: blastReachesAnchor,
    shouldBounce: shouldBounce,
    bounceCrushIsLethal: bounceCrushIsLethal,
    impulseForMass: impulseForMass,
    impactMultipliersFor: impactMultipliersFor,
    PLAIN_CRATE_IMPACT_MULTIPLIERS: PLAIN_CRATE_IMPACT_MULTIPLIERS,
    EXPLOSIVE_BARREL_IMPACT_MULTIPLIERS: EXPLOSIVE_BARREL_IMPACT_MULTIPLIERS,
    NEUTRAL_IMPACT_MULTIPLIERS: NEUTRAL_IMPACT_MULTIPLIERS
  };
  root.SuperfightersHeavyProps = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
