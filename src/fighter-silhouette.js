/**
 * Superfighters clone — the fighter's contact silhouette (pure geometry, no game state).
 *
 * Against props the fighter is not a plain rectangle: the head is narrower
 * than the shoulders, the arms (and the hands reaching ahead of the body) make
 * the widest part, and the legs are narrower again. A prop at head height can
 * therefore get closer than one at chest height, and the hands touch first.
 *
 * The silhouette is a stack of horizontal bands. Every function answers a
 * question about the horizontal extent the fighter covers over a vertical
 * span; they reuse one result object (no allocation per call, they run every
 * simulation step for every prop in contact range).
 *
 * Units: pixels; fractions are of the fighter's width / height.
 */
(function (root) {
  'use strict';

  // top/bottom: share of the height from the head; left/right: share of the width from the left edge.
  var SILHOUETTE_BANDS = [
    { top: 0, bottom: 0.28, left: 0.18, right: 0.82 },    // head: narrower than the shoulders
    { top: 0.28, bottom: 0.66, left: 0, right: 1 },       // shoulders, torso and arms: the widest part
    { top: 0.66, bottom: 1, left: 0.1, right: 0.9 }       // legs
  ];
  var HAND_BAND = { top: 0.4, bottom: 0.58 };             // the hands, held out in front of the body
  var HAND_REACH_SHARE = 0.1;                             // share of the width the hands stick out ahead of the body

  var extent = { left: 0, right: 0 }; // reused result: offsets from the fighter's x

  /**
   * Horizontal extent (offsets from the fighter's left edge) the silhouette
   * covers over the vertical span [spanTop, spanBottom] (px from the top of the
   * fighter). `facing` is 1 (right) or -1 (left): the hands reach that way.
   * Returns the shared extent object, or null if the span misses the fighter.
   */
  function extentOverSpan(width, height, facing, spanTop, spanBottom) {
    var found = false;
    var left = Infinity;
    var right = -Infinity;
    for (var i = 0; i < SILHOUETTE_BANDS.length; i++) {
      var band = SILHOUETTE_BANDS[i];
      if (spanBottom <= band.top * height || spanTop >= band.bottom * height) continue;
      found = true;
      if (band.left * width < left) left = band.left * width;
      if (band.right * width > right) right = band.right * width;
    }
    if (!found) return null;
    if (spanBottom > HAND_BAND.top * height && spanTop < HAND_BAND.bottom * height) {
      var reach = HAND_REACH_SHARE * width;
      if (facing >= 0) { if (width + reach > right) right = width + reach; }
      else if (-reach < left) left = -reach;
    }
    extent.left = left;
    extent.right = right;
    return extent;
  }

  /** The extent over the vertical span a rectangle occupies next to the fighter at (x, y). */
  function extentBesideRect(y, width, height, facing, rect) {
    return extentOverSpan(width, height, facing, rect.y - y, rect.y + rect.h - y);
  }

  /** Whether the silhouette of a fighter at (x, y) overlaps the rectangle. */
  function overlapsRect(x, y, width, height, facing, rect) {
    var span = extentBesideRect(y, width, height, facing, rect);
    if (span === null) return false;
    return x + span.left < rect.x + rect.w && x + span.right > rect.x;
  }

  /** The fighter's x that puts his silhouette flush against the LEFT face of the rectangle (he stands to its left). */
  function xFlushLeftOf(y, width, height, facing, rect) {
    var span = extentBesideRect(y, width, height, facing, rect);
    return rect.x - (span === null ? width : span.right);
  }

  /** The fighter's x that puts his silhouette flush against the RIGHT face of the rectangle (he stands to its right). */
  function xFlushRightOf(y, width, height, facing, rect) {
    var span = extentBesideRect(y, width, height, facing, rect);
    return rect.x + rect.w - (span === null ? 0 : span.left);
  }

  var HEAD = SILHOUETTE_BANDS[0];
  /** Horizontal range [left, right] (absolute x) of the head of a fighter at x, as a shared object. */
  var headRange = { left: 0, right: 0 };
  function headSpan(x, width) {
    headRange.left = x + HEAD.left * width;
    headRange.right = x + HEAD.right * width;
    return headRange;
  }

  var api = {
    SILHOUETTE_BANDS: SILHOUETTE_BANDS,
    HAND_BAND: HAND_BAND,
    HAND_REACH_SHARE: HAND_REACH_SHARE,
    extentOverSpan: extentOverSpan,
    extentBesideRect: extentBesideRect,
    overlapsRect: overlapsRect,
    xFlushLeftOf: xFlushLeftOf,
    xFlushRightOf: xFlushRightOf,
    headSpan: headSpan
  };
  root.SuperfightersSilhouette = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
