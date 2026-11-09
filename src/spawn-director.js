/**
 * Superfighters clone — random spawning (SpawnDirector).
 *
 * Pure logic, no rendering/physics/input knowledge: the game hands it the
 * spots and two callbacks and the module decides WHEN and WHAT appears.
 *
 * Source (extracted original):
 *  - `Code/Handler/WeaponSpawn.as`: every `_spawnInterval` (72 steps @ 24 fps
 *    = 3 s) ONE free weapon spot is picked at random and gets ONE weapon,
 *    chosen with the weighted `_weaponSpawnChance` table. Spots that still hold
 *    a weapon are skipped; the map starts EMPTY, so the arena fills up slowly.
 *  - `Code/Data/WeaponSpawnData.as`: a spawned weapon despawns after
 *    `20 * 24` steps (20 s) and blinks for the last `8 * 24` steps (8 s).
 *
 * The clone runs at 60 Hz, so the original 24 fps step counts are converted
 * with ORIGINAL_STEPS_TO_CLONE_STEPS. Tune the pace ONLY through the three
 * `WEAPON_*` constants below (or pass overrides to `createWeaponSpawner`).
 */
(function (root) {
  'use strict';

  var CLONE_STEPS_PER_SECOND = 60;
  var ORIGINAL_STEPS_PER_SECOND = 24;
  var ORIGINAL_STEPS_TO_CLONE_STEPS = CLONE_STEPS_PER_SECOND / ORIGINAL_STEPS_PER_SECOND;

  // ---- Tunable weapon pacing (clone steps @ 60 Hz) -----------------------
  /** Time between spawn attempts (original: 72 steps = 3 s). */
  var WEAPON_SPAWN_INTERVAL_STEPS = 72 * ORIGINAL_STEPS_TO_CLONE_STEPS;
  /** Life of an untouched spawned weapon (original: 20 s). */
  var WEAPON_DESPAWN_STEPS = 20 * CLONE_STEPS_PER_SECOND;
  /** The weapon blinks during its last stretch (original: 8 s). */
  var WEAPON_BLINK_STEPS = 8 * CLONE_STEPS_PER_SECOND;

  // Original `_weaponSpawnChance` (index order of WeaponSpawn.as's switch),
  // keyed by weapon name. Higher weight = appears more often.
  var WEAPON_SPAWN_WEIGHTS = {
    pistol: 11, rifle: 9, shotgun: 7, sniper: 2, bazooka: 2, molotov: 4,
    grenade: 6, flamethrower: 5, sword: 2, machete: 3, axe: 3,
    slowmo05: 4, slowmo10: 3, pills: 2, medkit: 2, magnum: 2, uzi: 6
  };

  // ---- Player spawn spacing ----------------------------------------------
  /** A fighter should not appear closer than this to the other one (px). */
  var PLAYER_SPAWN_MIN_DISTANCE = 220;

  /**
   * Weighted pick: returns a key of `weights` (or null when empty).
   * `random` is injectable (0 <= r < 1) so tests are deterministic.
   */
  function pickWeightedKey(weights, random) {
    var total = 0;
    var key;
    for (key in weights) total += weights[key];
    if (total <= 0) return null;
    var roll = random() * total;
    for (key in weights) {
      roll -= weights[key];
      if (roll < 0) return key;
    }
    return key;
  }

  /**
   * Creates the progressive weapon spawner.
   *
   * options:
   *  - spots:        [{x, y}] weapon spawn points
   *  - isSpotFree:   function(spot) -> bool (no live weapon linked to it)
   *  - spawnWeapon:  function(spot, weaponKey, lifeSteps, blinkSteps)
   *  - weights, intervalSteps, despawnSteps, blinkSteps, random: overrides
   */
  function createWeaponSpawner(options) {
    var spots = options.spots;
    var isSpotFree = options.isSpotFree;
    var spawnWeapon = options.spawnWeapon;
    var weights = options.weights || WEAPON_SPAWN_WEIGHTS;
    var intervalSteps = options.intervalSteps || WEAPON_SPAWN_INTERVAL_STEPS;
    var despawnSteps = options.despawnSteps || WEAPON_DESPAWN_STEPS;
    var blinkSteps = options.blinkSteps || WEAPON_BLINK_STEPS;
    var random = options.random || Math.random;
    var timer = intervalSteps; // the original also waits one full interval first
    var freeSpotsScratch = []; // reused every attempt: no per-spawn allocation

    function reset() { timer = intervalSteps; }

    /** Advance by `gameSpeed` steps (1 = real time). Returns the spawned spot or null. */
    function update(gameSpeed) {
      timer -= (gameSpeed === undefined ? 1 : gameSpeed);
      if (timer > 0) return null;
      timer = intervalSteps;
      freeSpotsScratch.length = 0;
      for (var i = 0; i < spots.length; i++) {
        if (isSpotFree(spots[i])) freeSpotsScratch.push(spots[i]);
      }
      if (!freeSpotsScratch.length) return null;
      var spot = freeSpotsScratch[Math.floor(random() * freeSpotsScratch.length)];
      var weaponKey = pickWeightedKey(weights, random);
      if (!weaponKey) return null;
      spawnWeapon(spot, weaponKey, despawnSteps, blinkSteps);
      return spot;
    }

    return {
      update: update,
      reset: reset,
      get timer() { return timer; },
      get intervalSteps() { return intervalSteps; }
    };
  }

  /**
   * Random valid player spawn: any point of `points` that is not `lastIndex`
   * and (when possible) at least `minDistance` away from every `avoidPoints`
   * entry ({x, y}). Falls back to the farthest candidate if none is far enough.
   * Returns an index into `points`.
   */
  function pickPlayerSpawnIndex(points, random, lastIndex, avoidPoints, minDistance) {
    var far = [];
    var farthestIndex = -1;
    var farthestDistance = -1;
    for (var i = 0; i < points.length; i++) {
      if (i === lastIndex && points.length > 1) continue;
      var nearest = Infinity;
      for (var a = 0; a < (avoidPoints ? avoidPoints.length : 0); a++) {
        var dx = points[i].x - avoidPoints[a].x;
        var dy = points[i].y - avoidPoints[a].y;
        nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy));
      }
      if (nearest >= (minDistance === undefined ? PLAYER_SPAWN_MIN_DISTANCE : minDistance)) far.push(i);
      if (nearest > farthestDistance) { farthestDistance = nearest; farthestIndex = i; }
    }
    if (far.length) return far[Math.floor(random() * far.length)];
    return farthestIndex;
  }

  var api = {
    WEAPON_SPAWN_INTERVAL_STEPS: WEAPON_SPAWN_INTERVAL_STEPS,
    WEAPON_DESPAWN_STEPS: WEAPON_DESPAWN_STEPS,
    WEAPON_BLINK_STEPS: WEAPON_BLINK_STEPS,
    WEAPON_SPAWN_WEIGHTS: WEAPON_SPAWN_WEIGHTS,
    PLAYER_SPAWN_MIN_DISTANCE: PLAYER_SPAWN_MIN_DISTANCE,
    pickWeightedKey: pickWeightedKey,
    createWeaponSpawner: createWeaponSpawner,
    pickPlayerSpawnIndex: pickPlayerSpawnIndex
  };
  root.SuperfightersSpawn = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
