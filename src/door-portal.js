/**
 * Superfighters clone — door portal transit for props (pure rules, no game state).
 *
 * The station's black entrances are linked pairs of doorways (PortalData):
 * whatever enters one while travelling toward the door side comes out of the
 * linked one, keeping its velocity and its height above the doorway floor.
 * Fighters and thrown explosives already use them; this module answers the
 * same question for solid props (crates, barrels, table): "does this body
 * enter a doorway this step, and where does it come out?". The caller applies
 * the result and keeps the body locked until it has left the doorway, so it
 * never bounces between the two entrances.
 */
(function (root) {
  'use strict';

  var MIN_ENTRY_SPEED = 0.05; // px/step toward the door side below which a body is not "travelling" through it

  /** Whether a body's centre is inside the doorway and the body fits its height. */
  function insideDoorway(body, door) {
    var centerX = body.x + body.w / 2;
    var centerY = body.y + body.h / 2;
    if (centerX < door.x || centerX > door.x + door.w) return false;
    if (centerY < door.y || centerY > door.y + door.h) return false;
    return body.h <= door.h + 1e-9; // a body taller than the doorway cannot go through
  }

  /**
   * `body`: { x, y, w, h, vx, locked }, `doors`: [{ x, y, w, h, target }] with
   * `target` the index of the linked doorway. Returns { inDoorway, locked,
   * teleport } where `teleport` is the new { x, y } (top-left) or null.
   */
  function transit(body, doors) {
    for (var i = 0; i < doors.length; i++) {
      var door = doors[i];
      if (!insideDoorway(body, door)) continue;
      if (body.locked || body.vx < MIN_ENTRY_SPEED) return { inDoorway: true, locked: body.locked, teleport: null };
      var exit = doors[door.target];
      var bottomAboveFloor = door.y + door.h - (body.y + body.h); // height above the doorway floor
      return {
        inDoorway: true,
        locked: true,
        teleport: { x: exit.x + exit.w / 2 - body.w / 2, y: exit.y + exit.h - bottomAboveFloor - body.h }
      };
    }
    return { inDoorway: false, locked: false, teleport: null };
  }

  var api = { MIN_ENTRY_SPEED: MIN_ENTRY_SPEED, insideDoorway: insideDoorway, transit: transit };
  root.SuperfightersDoorPortal = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
