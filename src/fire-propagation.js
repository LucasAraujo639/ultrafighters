/**
 * Superfighters clone — generic fire propagation rules (pure, no game state).
 *
 * Any physical prop can opt in by carrying a `material` tag. Flammable
 * materials (wood, paper) that are burning emit a periodic heat pulse; props
 * inside the pulse radius accumulate heat and catch fire once it crosses the
 * ignition threshold, so the blaze spreads gradually instead of instantly.
 * Burning itself (damage over time, consumption) is applied by the owner of
 * the prop; this module only answers "is it flammable?" and "how much heat?".
 */
(function (root) {
  'use strict';

  var MATERIAL = { WOOD: 'wood', PAPER: 'paper', METAL: 'metal', CONCRETE: 'concrete' };
  var FLAMMABLE_MATERIALS = {};
  FLAMMABLE_MATERIALS[MATERIAL.WOOD] = true;
  FLAMMABLE_MATERIALS[MATERIAL.PAPER] = true;

  var FIRE_SPREAD_RADIUS = 36;        // px, centre to centre
  var FIRE_SPREAD_PULSE_STEPS = 15;   // a burning prop emits a pulse every quarter second
  var IGNITION_HEAT = 1;              // accumulated heat that sets a prop alight
  var HEAT_PER_PULSE_AT_CONTACT = 0.45; // ~3 pulses at point-blank, more further away

  function isFlammable(material) {
    return FLAMMABLE_MATERIALS[material] === true;
  }

  /** Heat a pulse delivers at `distance` (0 beyond the radius, linear falloff). */
  function heatFromPulse(distance, radius) {
    if (distance >= radius) return 0;
    return HEAT_PER_PULSE_AT_CONTACT * (1 - distance / radius);
  }

  var api = {
    MATERIAL: MATERIAL,
    FIRE_SPREAD_RADIUS: FIRE_SPREAD_RADIUS,
    FIRE_SPREAD_PULSE_STEPS: FIRE_SPREAD_PULSE_STEPS,
    IGNITION_HEAT: IGNITION_HEAT,
    isFlammable: isFlammable,
    heatFromPulse: heatFromPulse
  };
  root.SuperfightersFire = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
