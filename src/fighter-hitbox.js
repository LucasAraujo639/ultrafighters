/**
 * Superfighters clone — fighter collision silhouette (pure geometry, no game state).
 *
 * Props see the fighter as a stick-figure silhouette instead of one box: a
 * narrower head on top, the torso with both arms and the front hand reaching
 * out, and the legs ending in the feet. Every part is a rectangle given as
 * fractions of the fighter's bounding box (x from the BACK, y from the top),
 * mirrored when he faces left. The bounding box stays the fighter's footprint
 * for walls and floors; this silhouette only answers "is a prop touching HIM".
 */
(function (root) {
  'use strict';

  var HITBOX_PART = Object.freeze({ HEAD: 'head', TORSO: 'torso', ARMS: 'arms', LEGS: 'legs', FEET: 'feet' });

  // [part, left, top, right, bottom] as fractions of the bounding box, facing right.
  var SILHOUETTE = [
    [HITBOX_PART.HEAD, 0.25, 0.00, 0.85, 0.28],   // the face leans a little forward
    [HITBOX_PART.TORSO, 0.20, 0.28, 0.80, 0.62],
    [HITBOX_PART.ARMS, 0.05, 0.32, 1.00, 0.58],   // the front hand reaches the full width
    [HITBOX_PART.LEGS, 0.20, 0.62, 0.85, 0.90],
    [HITBOX_PART.FEET, 0.05, 0.90, 1.00, 1.00]    // boots a little wider than the legs
  ];

  function partRect(bounds, facing, spec) {
    var left = facing < 0 ? 1 - spec[3] : spec[1];
    var right = facing < 0 ? 1 - spec[1] : spec[3];
    return {
      part: spec[0],
      x: bounds.x + left * bounds.w,
      y: bounds.y + spec[2] * bounds.h,
      w: (right - left) * bounds.w,
      h: (spec[4] - spec[2]) * bounds.h
    };
  }

  /** The silhouette rectangles of a fighter with `bounds` {x, y, w, h} facing `facing` (+1 right, -1 left). */
  function fighterParts(bounds, facing) {
    var parts = [];
    for (var i = 0; i < SILHOUETTE.length; i++) parts.push(partRect(bounds, facing, SILHOUETTE[i]));
    return parts;
  }

  function overlapDepth(part, rect) {
    var depthX = Math.min(part.x + part.w, rect.x + rect.w) - Math.max(part.x, rect.x);
    var depthY = Math.min(part.y + part.h, rect.y + rect.h) - Math.max(part.y, rect.y);
    return depthX > 0 && depthY > 0 ? Math.min(depthX, depthY) : 0;
  }

  /** Whether any part of the silhouette overlaps `rect` {x, y, w, h}. */
  function silhouetteOverlaps(bounds, facing, rect) {
    // cheap reject: the silhouette lives inside the bounding box
    if (bounds.x >= rect.x + rect.w || bounds.x + bounds.w <= rect.x ||
        bounds.y >= rect.y + rect.h || bounds.y + bounds.h <= rect.y) return false;
    var parts = fighterParts(bounds, facing);
    for (var i = 0; i < parts.length; i++) if (overlapDepth(parts[i], rect) > 0) return true;
    return false;
  }

  /** The head rectangle (the part that bumps a ceiling). */
  function headRect(bounds, facing) {
    return partRect(bounds, facing, SILHOUETTE[0]);
  }

  var api = {
    HITBOX_PART: HITBOX_PART,
    SILHOUETTE: SILHOUETTE,
    fighterParts: fighterParts,
    silhouetteOverlaps: silhouetteOverlaps,
    headRect: headRect
  };
  root.SuperfightersFighterHitbox = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
