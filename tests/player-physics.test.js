'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Player } = require('../src/player-physics.js');

test('module loads and player has scaled body', () => {
  const p = new Player({ x: 0, y: 0 });
  assert.equal(p.baseW, 28);
  assert.equal(p.baseH, 44);
  assert.ok(Math.abs(p.w - 28 * 0.6) < 1e-9);
  assert.ok(Math.abs(p.h - 44 * 0.6) < 1e-9);
});

test('gravity pulls a falling player down until landing', () => {
  const floor = { x: 0, y: 300, w: 800, h: 40, solidSides: true, cloud: false, ladder: false };
  const p = new Player({ x: 50, y: 100, platforms: [floor], onGround: false });
  p.airVelocityY = 0;
  let landed = false;
  for (let i = 0; i < 200 && !landed; i++) {
    p.update(null, { platforms: [floor], gameSpeed: 1 });
    landed = p.onGround;
  }
  assert.equal(landed, true);
  assert.ok(Math.abs(p.y + p.h - floor.y) < 1e-6);
});

test('jump creates upward velocity and lands back', () => {
  const floor = { x: 0, y: 300, w: 800, h: 40, solidSides: true, cloud: false, ladder: false };
  const p = new Player({ x: 50, y: 260, platforms: [floor], onGround: true, groundedPlatform: floor });
  p.keyDown('KeyW');
  p.update(null, { platforms: [floor], gameSpeed: 1 });
  assert.equal(p.onGround, false);
  assert.ok(p.airVelocityY < 0);
  let landed = false;
  for (let i = 0; i < 200 && !landed; i++) {
    p.update(null, { platforms: [floor], gameSpeed: 1 });
    landed = p.onGround;
  }
  assert.equal(landed, true);
});

test('horizontal movement walks on ground', () => {
  const floor = { x: 0, y: 300, w: 800, h: 40, solidSides: true, cloud: false, ladder: false };
  const p = new Player({ x: 50, y: 260, platforms: [floor], onGround: true, groundedPlatform: floor, binding: { left:'KeyA', right:'KeyD', up:'KeyW', down:'KeyS' } });
  const startX = p.x;
  p.keyDown('KeyD');
  for (let i = 0; i < 60; i++) {
    // re-press not needed; key held; but update clears justPressed; movement uses keys held
    p.keyDown('KeyD');
    p.update(null, { platforms: [floor], gameSpeed: 1 });
  }
  assert.ok(p.x > startX);
});
