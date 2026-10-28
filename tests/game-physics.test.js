'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const noop = () => {};

function createGame() {
  const listeners = Object.create(null);
  let nextFrame = null;
  const gradient = { addColorStop: noop };
  const context = new Proxy(
    {
      createLinearGradient: () => gradient,
      createRadialGradient: () => gradient
    },
    {
      get(target, key) {
        return key in target ? target[key] : noop;
      },
      set() {
        return true;
      }
    }
  );
  const canvas = { width: 800, height: 600, getContext: () => context };
  const window = {
    addEventListener(type, callback) {
      listeners[type] = callback;
    },
    requestAnimationFrame(callback) {
      nextFrame = callback;
    }
  };
  const sandbox = {
    window,
    document: { getElementById: () => canvas },
    performance: { now: () => 0 },
    console: { log: noop, warn: noop, error: noop }
  };

  vm.runInNewContext(gameSource, sandbox, { filename: 'src/game.js' });
  const game = window.__sf;
  game.botActive = false;
  for (const item of game.weaponItems) item.taken = true;
  return { game, listeners, getNextFrame: () => nextFrame };
}

function keyDown(listeners, code) {
  listeners.keydown({ code, repeat: false, preventDefault: noop });
}

function keyUp(listeners, code) {
  listeners.keyup({ code, preventDefault: noop });
}

function resetPlayer(player, x, y, onGround) {
  Object.assign(player, {
    x,
    y,
    airVelocityX: 0,
    airVelocityY: 0,
    onGround,
    groundedPlatform: null,
    jumping: false,
    jumpPushTimeLeft: 0,
    falling: false,
    knockedDown: false,
    knockedDownFrame: 0,
    rolling: false,
    diving: false,
    climbing: false,
    wallJumping: false,
    grabbedBy: null,
    grabbedPlayerNr: 0,
    stunTimer: 0,
    staggering: false,
    punching: false,
    aiming: false,
    startAimASAP: false,
    sprinting: false,
    running: false,
    sprintEnergy: 100,
    lastDirX: 1,
    airbornTimer: 0,
    jumpKickPerformed: false,
    jumpKickQueued: false,
    hp: 100
  });
}

function findLowerLeftFloor(platforms) {
  return Array.from(platforms).find(
    (platform) => platform.material === 'Ground' && platform.x < 20 && platform.w > 300
  );
}

test('Police Station keeps the extracted collision shapes and dimensions', () => {
  const { game } = createGame();
  const platforms = Array.from(game.platforms);
  const boxes = platforms.filter(
    (platform) => platform.shape === 'rect' && !platform.glass && !platform.elevator
  );
  const lowerLeftFloor = boxes.find((platform) => platform.x < 20 && platform.w > 300);
  const circle = platforms.find((platform) => platform.shape === 'circle');
  const glass = platforms.filter((platform) => platform.glass);
  const elevator = platforms.find((platform) => platform.elevator);

  assert.equal(boxes.length, 28);
  assert.ok(boxes.some((platform) => Math.abs(platform.w - 171.5) < 1e-7));
  assert.equal(
    boxes.filter((platform) => platform.cloud && Math.abs(platform.w - 45.5) < 1e-7).length,
    2
  );
  assert.ok(boxes.some((platform) => Math.abs(platform.w - 15.5) < 1e-7));
  assert.deepEqual([circle.cx, circle.cy, circle.radius], [20, 382, 7.5]);
  assert.deepEqual(glass.map((pane) => [pane.w, pane.h]), [[4, 38], [4, 32]]);
  assert.deepEqual([elevator.x, elevator.y, elevator.w, elevator.h], [419, 440.5, 26, 7]);
  assert.equal(elevator.oneWay, true);

  const [player1, player2] = game.players;
  assert.deepEqual([player1.x, player2.x], [79, 167]);
  for (let frame = 0; frame < 40; frame++) game.step();
  assert.equal(player1.onGround, true);
  assert.equal(player2.onGround, true);
  assert.ok(Math.abs(player1.y + player1.h - lowerLeftFloor.y) < 1e-6);
  assert.ok(Math.abs(player2.y + player2.h - lowerLeftFloor.y) < 1e-6);
});

test('fighters use a body 60% of the base size', () => {
  const { game } = createGame();
  for (const player of Array.from(game.players)) {
    assert.equal(player.baseW, 28);
    assert.equal(player.baseH, 44);
    assert.ok(Math.abs(player.w - 28 * 0.6) < 1e-9);
    assert.ok(Math.abs(player.h - 44 * 0.6) < 1e-9);
    assert.ok(player.w < player.baseW);
    assert.ok(player.h < player.baseH);
  }
});

test('restarting a round revives the dead fighter with full health', () => {
  const { game } = createGame();
  const [player1, player2] = game.players;

  player1.hp = 0;
  player1.knockedDown = true;
  player1.knockedDownFrame = 25;
  player1.grabbedBy = player2;
  player1.aiming = true;
  player1.ranged = { gun: game.guns.pistol, ammo: 3 };
  player1.sprintEnergy = 0;
  player2.hp = 35;

  game.restartRound();

  for (const player of [player1, player2]) {
    assert.equal(player.hp, 100, 'both fighters start the round at 100 hp');
    assert.equal(player.knockedDown, false);
    assert.equal(player.knockedDownFrame, 0);
    assert.equal(player.falling, false);
    assert.equal(player.onGround, true);
    assert.equal(player.grabbedBy, null);
    assert.equal(player.equipped, game.weapons.fists);
    assert.equal(player.ranged, null);
    assert.equal(player.aiming, false);
    assert.equal(player.sprintEnergy, 100);
  }

  // The death block re-collapses any fighter left at hp <= 0.
  for (let frame = 0; frame < 30; frame++) game.step();
  assert.equal(player1.hp, 100);
  assert.equal(player1.knockedDown, false);
  assert.equal(player1.falling, false);
});

test('the automatic end-of-round restart also revives the loser', () => {
  const { game } = createGame();
  const [player1, player2] = game.players;
  for (let frame = 0; frame < 10; frame++) game.step();

  for (let round = 0; round < 3; round++) {
    player1.hp = 0;
    player1.knockedDown = false;
    player1.knockedDownFrame = 0;

    for (let frame = 0; frame < 200; frame++) game.step();

    assert.equal(game.roundOver, null, `round ${round + 1} restarted`);
    assert.equal(player1.hp, 100, `loser is revived for round ${round + 2}`);
    assert.equal(player2.hp, 100);
    assert.equal(player1.knockedDown, false);
    assert.equal(player1.falling, false);
    for (let frame = 0; frame < 30; frame++) game.step();
    assert.equal(player1.hp, 100);
    assert.equal(player1.knockedDown, false);
  }
});

test('punches shatter the glass pane by the pit', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const pane = game.glassPanes[0];

  const shelf = Array.from(game.platforms).find(
    (platform) =>
      platform.shape === 'rect' &&
      !platform.glass &&
      !platform.cloud &&
      !platform.ladder &&
      platform.x < pane.x + pane.w &&
      platform.x + platform.w > pane.x &&
      Math.abs(platform.y - (pane.y + pane.h)) < 2
  );
  assert.ok(shelf, 'the pane hangs at the edge of a walkable platform');

  resetPlayer(player, pane.x + pane.w + 1, shelf.y - player.h, true);
  player.groundedPlatform = shelf;
  player.lastDirX = -1;
  keyDown(listeners, 'KeyF');
  for (let frame = 0; frame < 20; frame++) game.step();

  assert.equal(pane.broken, true, 'one punch is enough (SOLID_GLASS_01 has 5 hp)');
  assert.equal(Array.from(game.platforms).includes(pane), false, 'the collider is gone');
  assert.ok(game.glassShards.length > 0, 'the pane throws glass shards');
});

test('the third punch launches the victim, who lands knocked down and gets up', () => {
  const { game } = createGame();
  const [attacker, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(attacker, 300, floor.y - attacker.h, true);
  attacker.groundedPlatform = floor;
  resetPlayer(victim, 310, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  attacker.lastDirX = 1;
  attacker.punchComboNr = 3;

  attacker.tryPunchHit(victim);

  // PunchPlayer: AirVelocityX = 3 * attacker dir, AirVelocityY = -2.5, Fall()
  // (extracted values, restored).
  assert.equal(victim.falling, true, 'the combo finisher ragdolls the victim');
  assert.equal(victim.knockedDown, false);
  assert.equal(victim.onGround, false);
  assert.equal(victim.airVelocityX, 3);
  assert.equal(victim.airVelocityY, -2.5);
  assert.ok(victim.hp < 100, 'the finisher also deals its link damage');

  // The ragdoll lands and becomes Knockdowned (lying on the ground).
  let landed = false;
  for (let frame = 0; frame < 60 && !landed; frame++) {
    game.step();
    landed = victim.knockedDown;
  }
  assert.equal(landed, true, 'the victim lands lying on the ground');
  assert.equal(victim.falling, false);

  // Knockdowned clears when the recovery animation finishes (AnimationDone).
  for (let frame = 0; frame < 60; frame++) game.step();
  assert.equal(victim.knockedDown, false, 'the victim gets back up');
  assert.equal(victim.onGround, true);
});

test('a long fall deals impact damage and plays the knockdown animation', () => {
  const { game } = createGame();
  const [other, faller] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(other, 60, floor.y - other.h, true);
  other.groundedPlatform = floor;
  resetPlayer(faller, 400, 120, false); // 380 px above the floor

  let sawRagdoll = false;
  let landed = false;
  for (let frame = 0; frame < 120 && !landed; frame++) {
    game.step();
    sawRagdoll = sawRagdoll || faller.falling;
    landed = faller.knockedDown;
  }

  assert.equal(sawRagdoll, false, 'the fall keeps air control (no mid-air ragdoll)');
  assert.equal(landed, true, 'the landing plays the knockdown animation');
  assert.ok(faller.hp < 100, 'the impact costs HP');
  assert.equal(faller.falling, false);

  for (let frame = 0; frame < 60; frame++) game.step();
  assert.equal(faller.knockedDown, false, 'the fighter gets back up');
});

test('a hard fall onto another fighter hurts them and knocks both down', () => {
  const { game } = createGame();
  const [faller, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(faller, 400, 120, false);
  resetPlayer(victim, 400, floor.y - victim.h, true);
  victim.groundedPlatform = floor;

  let landed = false;
  for (let frame = 0; frame < 120 && !landed; frame++) {
    game.step();
    landed = faller.knockedDown;
  }

  assert.equal(landed, true, 'the faller lands');
  assert.equal(victim.hp, 94, 'the fighter underneath loses a little HP (6)');
  assert.equal(victim.knockedDown, true, 'the fighter underneath collapses too');
  assert.equal(faller.knockedDown, true);

  for (let frame = 0; frame < 60; frame++) game.step();
  assert.equal(victim.knockedDown, false, 'both get back up');
  assert.equal(faller.knockedDown, false);
});

test('landing hard on a shelf does not hurt a fighter standing below it', () => {
  const { game } = createGame();
  const [faller, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  const shelf = { x: 380, y: 300, w: 40, h: 10, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor, shelf);

  resetPlayer(faller, 400, 120, false);
  resetPlayer(victim, 400, floor.y - victim.h, true);
  victim.groundedPlatform = floor;

  for (let frame = 0; frame < 120 && !faller.knockedDown; frame++) game.step();

  assert.equal(faller.knockedDown, true, 'the faller lands on the shelf');
  assert.equal(victim.hp, 100, 'the fighter below the shelf is untouched');
  assert.equal(victim.knockedDown, false);
});

test('a dive onto a grounded fighter damages only the victim', () => {
  const { game } = createGame();
  const [diver, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(diver, 300, floor.y - diver.h, true);
  diver.groundedPlatform = floor;
  resetPlayer(victim, 306, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  diver.diving = true;

  diver.checkDiveImpact(victim);

  assert.equal(diver.hp, 100, 'the diver takes no damage from the tackle');
  assert.equal(victim.hp, 97, 'the tackled fighter takes the lowered 3');
  assert.equal(victim.grabbedBy, diver, 'the tackle still catches the victim');

  // The impact must only resolve once, not once per substep.
  diver.checkDiveImpact(victim);
  assert.equal(diver.hp, 100);
  assert.equal(victim.hp, 97);
});

test('a tackle drop leaves the victim on the raised platform, never through it', () => {
  const { game } = createGame();
  const [diver, victim] = game.players;
  const raised = {
    shape: 'rect',
    x: 300,
    y: 380,
    w: 200,
    h: 10,
    solidSides: true,
    cloud: false,
    material: 'Ground'
  };
  const floor = {
    shape: 'rect',
    x: 0,
    y: 500,
    w: 800,
    h: 100,
    solidSides: true,
    cloud: false,
    material: 'Ground'
  };
  game.platforms.length = 0;
  game.platforms.push(floor, raised);

  resetPlayer(diver, 340, raised.y - diver.h, true);
  diver.groundedPlatform = raised;
  resetPlayer(victim, 340, raised.y - victim.h, true);
  victim.groundedPlatform = raised;

  // Reproduce the moment the dive lands: the victim has been caught and the
  // diver releases them (DropGrabbedPlayer) instead of snapping them to 560.
  diver.grabbedPlayerNr = victim.id;
  victim.grabbedByPlayer(diver);
  diver.dropGrabbed(false);

  for (let frame = 0; frame < 30; frame++) game.step();

  assert.ok(
    Math.abs(victim.y + victim.h - raised.y) < 1e-6,
    'the victim settles on the raised platform'
  );
  assert.ok(victim.y + victim.h < floor.y, 'the victim never sinks through the ground');
});

test('bullets shatter glass and a new round restores it', () => {
  const { game } = createGame();
  const pane = game.glassPanes[1];

  game.bullets.push({
    x: pane.x - 9,
    y: pane.y + pane.h / 2,
    vx: 20,
    vy: 0,
    damage: 10,
    crit: false,
    critDamage: 0,
    owner: 1
  });
  game.step();

  assert.equal(pane.broken, true, 'a bullet shatters the pane');
  assert.equal(game.bullets.length, 0, 'the bullet stops at the glass');

  game.restartRound();

  assert.equal(pane.broken, false, 'the next round rebuilds the pane');
  assert.ok(Array.from(game.platforms).includes(pane), 'the collider is back');
  assert.equal(game.glassShards.length, 0, 'shards are cleared with the round');
});

test('the camera zooms in when fighters are close and out once they separate', () => {
  const { game } = createGame();
  const [player1, player2] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  function settle(x1, x2) {
    resetPlayer(player1, x1, floor.y - player1.h, true);
    player1.groundedPlatform = floor;
    resetPlayer(player2, x2, floor.y - player2.h, true);
    player2.groundedPlatform = floor;
    for (let frame = 0; frame < 120; frame++) game.step();
  }

  settle(300, 340);
  const closeZoom = game.camera.zoom;
  const closeViewWidth = 800 / closeZoom;

  settle(20, 760);
  const farZoom = game.camera.zoom;
  const farViewWidth = 800 / farZoom;

  // Previous fast-mode framing: 72 px padding, zoom clamped to 0.72..1.5.
  assert.ok(Math.abs(closeZoom - 1.5) < 0.01, `close zoom should be 1.5, got ${closeZoom}`);
  assert.ok(Math.abs(farZoom - 0.867) < 0.01, `far zoom should be 0.867, got ${farZoom}`);
  assert.ok(closeZoom > farZoom + 0.2, 'close framing must be tighter');
  assert.ok(closeViewWidth < 800, 'close framing crops the map');
  assert.ok(farViewWidth > closeViewWidth, 'separating must reveal more map');

  const viewLeft = game.camera.x - farViewWidth / 2;
  const viewRight = game.camera.x + farViewWidth / 2;
  assert.ok(viewLeft <= player1.x, 'left fighter stays inside the view');
  assert.ok(viewRight >= player2.x + player2.w, 'right fighter stays inside the view');
});

test('both players complete a single jump arc and cannot jump again in midair', () => {
  for (const [playerIndex, jumpCode] of [[0, 'KeyW'], [1, 'ArrowUp']]) {
    const { game, listeners } = createGame();
    const player = game.players[playerIndex];
    const other = game.players[1 - playerIndex];
    const floor = findLowerLeftFloor(game.platforms);
    const directionCode = playerIndex === 0 ? 'KeyD' : 'ArrowRight';
    resetPlayer(player, 250, floor.y - player.h, true);
    resetPlayer(other, 700, 200, false);
    player.groundedPlatform = floor;

    keyDown(listeners, jumpCode);
    keyDown(listeners, directionCode);
    let previousGround = player.onGround;
    let previousY = player.y;
    let previousDirection = 0;
    let groundTransitions = 0;
    let apexes = 0;
    let airborneJumpVelocity = null;
    let landed = false;

    for (let frame = 1; frame <= 80; frame++) {
      if (frame === 5) keyUp(listeners, jumpCode);
      if (frame === 8) {
        airborneJumpVelocity = player.airVelocityY;
        keyDown(listeners, jumpCode);
      }
      if (frame === 9) keyUp(listeners, jumpCode);

      game.step();
      if (frame === 8) assert.ok(player.airVelocityY > airborneJumpVelocity);

      if (player.onGround !== previousGround) groundTransitions++;
      if (player.onGround) {
        assert.ok(Math.abs(player.y + player.h - floor.y) < 1e-6);
        landed = true;
        break;
      }

      const deltaY = player.y - previousY;
      if (deltaY !== 0) {
        const direction = deltaY < 0 ? -1 : 1;
        if (previousDirection === -1 && direction === 1) apexes++;
        previousDirection = direction;
      }
      previousGround = player.onGround;
      previousY = player.y;
    }

    assert.equal(landed, true, `player ${playerIndex + 1} should land`);
    assert.equal(groundTransitions, 2, 'the only transitions are takeoff and landing');
    assert.equal(apexes, 1, 'the jump has exactly one apex');
    keyUp(listeners, directionCode);

    for (let frame = 0; frame < 20; frame++) game.step();
    assert.equal(player.onGround, true);
    assert.equal(player.airVelocityY, 0);
    assert.ok(Math.abs(player.y + player.h - floor.y) < 1e-6);

    keyDown(listeners, jumpCode);
    game.step();
    assert.equal(player.onGround, false, 'a new jump is allowed after landing');
    assert.equal(player.jumping, true);
  }
});

test('solid upper ledges also land at their extracted top surface', () => {
  const { game } = createGame();
  const player = game.players[0];
  const upperLedge = Array.from(game.platforms).find(
    (platform) =>
      platform.material === 'Ground' &&
      Math.abs(platform.y - 248.75) < 1e-7 &&
      Math.abs(platform.w - 171.5) < 1e-7
  );
  resetPlayer(player, 500, 170, false);

  let landed = false;
  for (let frame = 0; frame < 40; frame++) {
    game.step();
    if (player.onGround) {
      landed = true;
      break;
    }
  }
  assert.equal(landed, true);
  assert.equal(player.groundedPlatform, upperLedge);
  assert.ok(Math.abs(player.y + player.h - upperLedge.y) < 1e-6);
});

test('the Police Station elevator carries a grounded rider through its fixed steps', () => {
  const { game } = createGame();
  const player = game.players[0];
  const elevator = Array.from(game.platforms).find((platform) => platform.elevator);
  const baseY = elevator.y;
  resetPlayer(player, elevator.x - 1, elevator.y - player.h, true);
  player.groundedPlatform = elevator;

  for (let frame = 0; frame < 180; frame++) game.step();

  assert.ok(elevator.y < baseY - 100);
  assert.equal(player.onGround, true);
  assert.equal(player.groundedPlatform, elevator);
  assert.equal(player.airVelocityY, 0);
  assert.ok(Math.abs(player.y + player.h - elevator.y) < 1e-6);
});

test('the extracted circle provides real top-surface collisions', () => {
  const { game } = createGame();
  const player = game.players[0];
  const circle = Array.from(game.platforms).find((platform) => platform.shape === 'circle');

  resetPlayer(player, 7, 300, false);
  for (let frame = 0; frame < 60 && !player.onGround; frame++) game.step();
  assert.equal(player.groundedPlatform, circle);
  assert.ok(Math.abs(player.y + player.h - (circle.cy - circle.radius)) < 1e-6);
});

test('one-way platforms land only on downward foot crossings with horizontal overlap', () => {
  const { game } = createGame();
  const player = game.players[0];
  resetPlayer(player, 180, 300, false);
  const cloud = Array.from(game.platforms).find(
    (platform) =>
      platform.cloud &&
      Math.abs(platform.y - 351.75) < 1 &&
      player.x < platform.x + platform.w &&
      player.x + player.w > platform.x
  );

  let landed = false;
  for (let frame = 0; frame < 40; frame++) {
    game.step();
    if (player.onGround) {
      landed = true;
      break;
    }
  }
  assert.equal(landed, true);
  assert.equal(player.groundedPlatform, cloud);
  assert.ok(Math.abs(player.y + player.h - cloud.y) < 1e-6);

  const supportedY = player.y;
  for (let frame = 0; frame < 12; frame++) game.step();
  assert.equal(player.onGround, true);
  assert.equal(player.y, supportedY);
  assert.equal(player.airVelocityY, 0);
});

test('players fall when walking off a platform edge', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 100, y: 400, w: 80, h: 40, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  resetPlayer(player, 150, floor.y - player.h, true);
  player.groundedPlatform = floor;

  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 30; frame++) game.step();

  assert.ok(player.x > floor.x + floor.w - player.w);
  assert.equal(player.onGround, false);
  assert.ok(player.y + player.h > floor.y);
});

test('double-tapping DOWN drops the fighter through a red cloud bar', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const cloud = {
    shape: 'rect',
    x: 100,
    y: 300,
    w: 120,
    h: 4,
    material: 'Metal',
    flag: 'CLOUD',
    solidSides: false,
    cloud: true,
    oneWay: true,
    ladder: false
  };
  game.platforms.length = 0;
  game.platforms.push(cloud);
  resetPlayer(player, 150, cloud.y - player.h, true);
  player.groundedPlatform = cloud;
  for (let frame = 0; frame < 6; frame++) game.step();
  assert.equal(player.onGround, true, 'the cloud supports the fighter');

  const feetOnCloud = player.y + player.h;
  keyDown(listeners, 'KeyS');
  game.step();
  keyUp(listeners, 'KeyS');
  game.step();
  keyDown(listeners, 'KeyS');
  game.step();
  keyUp(listeners, 'KeyS');

  for (let frame = 0; frame < 10; frame++) game.step();

  assert.equal(player.onGround, false, 'the cloud no longer supports the fighter');
  assert.ok(player.y + player.h > feetOnCloud + 2, 'the fighter sinks through the bar');
});

test('a double DOWN drops exactly one red cloud and lands on the next', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const makeCloud = (y) => ({
    shape: 'rect',
    x: 100,
    y,
    w: 120,
    h: 4,
    material: 'Metal',
    flag: 'CLOUD',
    solidSides: false,
    cloud: true,
    oneWay: true,
    ladder: false
  });
  const upper = makeCloud(300);
  const lower = makeCloud(323);
  game.platforms.length = 0;
  game.platforms.push(upper, lower);
  resetPlayer(player, 150, upper.y - player.h, true);
  player.groundedPlatform = upper;
  for (let frame = 0; frame < 6; frame++) game.step();

  keyDown(listeners, 'KeyS');
  game.step();
  keyUp(listeners, 'KeyS');
  game.step();
  keyDown(listeners, 'KeyS');
  game.step();
  keyUp(listeners, 'KeyS');

  for (let frame = 0; frame < 60; frame++) game.step();

  assert.equal(player.onGround, true, 'the fighter lands instead of falling through both');
  assert.ok(Math.abs(player.y + player.h - lower.y) < 1e-6, 'it stops on the second cloud');
});

test('a 200 ms double-tap still drops through the cloud', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const cloud = {
    shape: 'rect',
    x: 100,
    y: 300,
    w: 120,
    h: 4,
    material: 'Metal',
    flag: 'CLOUD',
    solidSides: false,
    cloud: true,
    oneWay: true,
    ladder: false
  };
  game.platforms.length = 0;
  game.platforms.push(cloud);
  resetPlayer(player, 150, cloud.y - player.h, true);
  player.groundedPlatform = cloud;
  for (let frame = 0; frame < 6; frame++) game.step();

  keyDown(listeners, 'KeyS');
  game.step();
  keyUp(listeners, 'KeyS');
  for (let frame = 0; frame < 12; frame++) game.step();
  keyDown(listeners, 'KeyS');
  game.step();
  keyUp(listeners, 'KeyS');

  for (let frame = 0; frame < 10; frame++) game.step();
  assert.equal(player.onGround, false, 'the 250 ms window accepts the second tap');
});

test('a roll can chain into a cloud drop with DOWN', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const makeCloud = (y) => ({
    shape: 'rect',
    x: 100,
    y,
    w: 400,
    h: 4,
    material: 'Metal',
    flag: 'CLOUD',
    solidSides: false,
    cloud: true,
    oneWay: true,
    ladder: false
  });
  const upper = makeCloud(300);
  const lower = makeCloud(323);
  game.platforms.length = 0;
  game.platforms.push(upper, lower);
  resetPlayer(player, 150, upper.y - player.h, true);
  player.groundedPlatform = upper;
  for (let frame = 0; frame < 6; frame++) game.step();

  keyDown(listeners, 'KeyD'); // run so DOWN starts the roll
  for (let frame = 0; frame < 4; frame++) game.step();
  keyDown(listeners, 'KeyS');
  game.step();
  keyUp(listeners, 'KeyS');
  assert.equal(player.rolling, true, 'DOWN while running starts the roll');

  for (let frame = 0; frame < 3; frame++) game.step();
  keyDown(listeners, 'KeyS');
  game.step();
  keyUp(listeners, 'KeyS');
  keyUp(listeners, 'KeyD');

  assert.equal(player.rolling, false, 'the drop ends the roll');
  for (let frame = 0; frame < 60; frame++) game.step();
  assert.equal(player.onGround, true, 'the fighter lands on the next cloud');
  assert.ok(Math.abs(player.y + player.h - lower.y) < 1e-6);
});

test('a single DOWN tap keeps the fighter on the cloud', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const cloud = {
    shape: 'rect',
    x: 100,
    y: 300,
    w: 120,
    h: 4,
    material: 'Metal',
    flag: 'CLOUD',
    solidSides: false,
    cloud: true,
    oneWay: true,
    ladder: false
  };
  game.platforms.length = 0;
  game.platforms.push(cloud);
  resetPlayer(player, 150, cloud.y - player.h, true);
  player.groundedPlatform = cloud;
  for (let frame = 0; frame < 6; frame++) game.step();

  keyDown(listeners, 'KeyS');
  game.step();
  keyUp(listeners, 'KeyS');
  for (let frame = 0; frame < 20; frame++) game.step();

  assert.equal(player.onGround, true);
  assert.ok(Math.abs(player.y + player.h - cloud.y) < 1e-6);
});

test('double-tapping a movement direction sprints at twice the run speed', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = findLowerLeftFloor(game.platforms);
  resetPlayer(player, 250, floor.y - player.h, true);
  player.groundedPlatform = floor;

  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 3; frame++) game.step();
  keyUp(listeners, 'KeyD');
  game.step(); // release arms _sprintActivationDuration
  keyDown(listeners, 'KeyD');
  game.step(); // re-press inside the window

  assert.equal(player.sprinting, true, 'the double-tap activates the sprint');
  assert.equal(player.airVelocityX, 3.4, 'RunSpeed is doubled while sprinting');
  assert.ok(player.shortDiveTimer > 0, 'the double-tap also arms the short dive');

  // Releasing a sprint and pressing again re-sprints immediately.
  keyUp(listeners, 'KeyD');
  game.step();
  assert.equal(player.sprinting, false);
  keyDown(listeners, 'KeyD');
  game.step();
  assert.equal(player.sprinting, true, 'the re-sprint window reactivates it');
});

test('a 100 ms double-tap re-press is inside the activation window', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = findLowerLeftFloor(game.platforms);
  resetPlayer(player, 250, floor.y - player.h, true);
  player.groundedPlatform = floor;

  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 3; frame++) game.step();
  keyUp(listeners, 'KeyD');
  for (let frame = 0; frame < 6; frame++) game.step(); // 100 ms at 60 Hz
  keyDown(listeners, 'KeyD');
  game.step();

  assert.equal(player.sprinting, true);
});

test('a slow re-press does not sprint', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = findLowerLeftFloor(game.platforms);
  resetPlayer(player, 250, floor.y - player.h, true);
  player.groundedPlatform = floor;

  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 3; frame++) game.step();
  keyUp(listeners, 'KeyD');
  for (let frame = 0; frame < 10; frame++) game.step(); // window expires
  keyDown(listeners, 'KeyD');
  game.step();

  assert.equal(player.sprinting, false);
  assert.equal(player.airVelocityX, 1.7, 'it stays a normal run');
});

test('Shift no longer activates the sprint', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = findLowerLeftFloor(game.platforms);
  resetPlayer(player, 250, floor.y - player.h, true);
  player.groundedPlatform = floor;

  keyDown(listeners, 'ShiftLeft');
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 5; frame++) game.step();

  assert.equal(player.sprinting, false);
  assert.equal(player.airVelocityX, 1.7);
});

test('walk and sprint use the tuned per-step pace at 60 Hz', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = findLowerLeftFloor(game.platforms);
  resetPlayer(player, 120, floor.y - player.h, true);
  player.groundedPlatform = floor;

  // Original pace: 1.7 px/step at 60 Hz => 102 px/s.
  const startX = player.x;
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 60; frame++) game.step();
  assert.ok(
    Math.abs(player.x - startX - 102) < 0.01,
    'one second of walking covers 1.7 px/step * 60 steps'
  );

  // Sprint is 2x run speed and drains 1.2 per step:
  // 100 / (1.2 * 60) = 1.39 s of full stamina.
  keyUp(listeners, 'KeyD');
  game.step();
  keyDown(listeners, 'KeyD');
  game.step();
  assert.equal(player.sprinting, true, 'the re-press starts the sprint');
  let sprintSteps = 0;
  while (player.sprintEnergy > 0 && sprintSteps < 1000) {
    game.step();
    sprintSteps++;
  }
  assert.ok(
    Math.abs(sprintSteps / 60 - 100 / (1.2 * 60)) < 0.05,
    'full stamina lasts about 1.4 s'
  );
});

test('the fixed-step simulation is consistent at 30, 60, and 144 render FPS', () => {
  function stateAfter200ms(renderFps) {
    const { game, listeners, getNextFrame } = createGame();
    const player = game.players[0];
    const floor = findLowerLeftFloor(game.platforms);
    resetPlayer(player, 250, floor.y - player.h, true);
    player.groundedPlatform = floor;
    keyDown(listeners, 'KeyW');

    const times = [];
    const lastIndex = Math.floor((200 * renderFps) / 1000);
    for (let i = 0; i <= lastIndex; i++) times.push((i * 1000) / renderFps);
    if (times[times.length - 1] < 200) times.push(200);
    for (const now of times) getNextFrame()(now);

    return {
      y: player.y,
      vy: player.airVelocityY,
      onGround: player.onGround,
      cameraX: game.camera.x,
      cameraY: game.camera.y,
      cameraZoom: game.camera.zoom
    };
  }

  const reference = stateAfter200ms(60);
  for (const renderFps of [30, 144]) {
    const state = stateAfter200ms(renderFps);
    assert.ok(Math.abs(state.y - reference.y) < 1e-7);
    assert.ok(Math.abs(state.vy - reference.vy) < 1e-7);
    assert.equal(state.onGround, reference.onGround);
    assert.ok(Math.abs(state.cameraX - reference.cameraX) < 1e-7);
    assert.ok(Math.abs(state.cameraY - reference.cameraY) < 1e-7);
    assert.ok(Math.abs(state.cameraZoom - reference.cameraZoom) < 1e-7);
  }
});
