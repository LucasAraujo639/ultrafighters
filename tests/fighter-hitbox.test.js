'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const hitbox = require('../src/fighter-hitbox.js');

const BODY = { x: 100, y: 200, w: 16.8, h: 26.4 };
const part = (parts, name) => parts.find((p) => p.part === name);

test('silhouette: every part lies inside the fighter box and the head is narrower than the shoulders', () => {
  const parts = hitbox.fighterParts(BODY, 1);
  assert.equal(parts.length, 5);
  for (const p of parts) {
    assert.ok(p.x >= BODY.x - 1e-9 && p.x + p.w <= BODY.x + BODY.w + 1e-9, p.part + ' inside in x');
    assert.ok(p.y >= BODY.y - 1e-9 && p.y + p.h <= BODY.y + BODY.h + 1e-9, p.part + ' inside in y');
  }
  assert.ok(part(parts, 'head').w < part(parts, 'arms').w, 'head narrower than the arm span');
  assert.ok(part(parts, 'legs').w < part(parts, 'arms').w, 'legs narrower than the arm span');
  assert.equal(part(parts, 'head').y, BODY.y, 'the head is the top of the silhouette');
});

test('silhouette: facing left mirrors it', () => {
  const right = hitbox.fighterParts(BODY, 1);
  const left = hitbox.fighterParts(BODY, -1);
  const headRight = part(right, 'head');
  const headLeft = part(left, 'head');
  assert.ok(Math.abs((headRight.x - BODY.x) - (BODY.x + BODY.w - (headLeft.x + headLeft.w))) < 1e-9);
  assert.equal(headRight.w, headLeft.w);
});

test('silhouette: empty corners of the box are not contact, the body is', () => {
  const cornerAboveShoulder = { x: BODY.x - 6, y: BODY.y - 4, w: 7, h: 9 };   // beside the head, over the shoulder line
  assert.equal(hitbox.silhouetteOverlaps(BODY, 1, cornerAboveShoulder), false, 'beside the head: nothing there');
  const atTheArms = { x: BODY.x - 6, y: BODY.y + 10, w: 8, h: 4 };
  assert.equal(hitbox.silhouetteOverlaps(BODY, 1, atTheArms), true, 'at arm height the box edge is touched');
  const beyondBox = { x: BODY.x + BODY.w + 2, y: BODY.y, w: 5, h: BODY.h };
  assert.equal(hitbox.silhouetteOverlaps(BODY, 1, beyondBox), false);
  const onTheHead = { x: BODY.x + 6, y: BODY.y - 3, w: 4, h: 5 };
  assert.equal(hitbox.silhouetteOverlaps(BODY, 1, onTheHead), true, 'the top of the head is touched');
});

test('silhouette: the front hand reaches farther than the back arm', () => {
  const frontReach = { x: BODY.x + BODY.w - 1, y: BODY.y + 9, w: 3, h: 3 };  // ahead, at hand height (facing right)
  const backReach = { x: BODY.x - 2, y: BODY.y + 9, w: 3, h: 3 };
  assert.equal(hitbox.silhouetteOverlaps(BODY, 1, frontReach), true);
  assert.equal(hitbox.silhouetteOverlaps(BODY, 1, backReach), true, 'the arm span is symmetric enough to touch');
  const beside = { x: BODY.x - 2, y: BODY.y + 20, w: 3, h: 3 };                // at shin height, behind: only the boot
  assert.equal(hitbox.silhouetteOverlaps(BODY, 1, beside), false, 'the legs do not fill the box');
});

test('head rectangle: the top slice of the silhouette', () => {
  const head = hitbox.headRect(BODY, 1);
  assert.equal(head.y, BODY.y);
  assert.ok(head.h < BODY.h * 0.4);
});
