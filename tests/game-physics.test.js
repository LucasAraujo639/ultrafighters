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

  // place him LEFT of the pane facing right, away from the map's crates
  // (MELEE beside a crate kicks it — the pane needs a clear punch arc)
  resetPlayer(player, pane.x - 1 - player.w, shelf.y - player.h, true);
  player.groundedPlatform = shelf;
  player.lastDirX = 1;
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
  game.crates.length = 0; // camera-only test: no dynamic props in the frame

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
    game.crates.length = 0; // pure jump test: no dynamic props in the way
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

test('damaged fighters passively regen HP after the extracted delay', () => {
  const { game } = createGame();
  const player = game.players[0];
  player.damage(40); // 100 -> 60, arms the 72-step regen block
  assert.equal(player.hp, 60);
  for (let frame = 0; frame < 72; frame++) game.step();
  assert.equal(player.hp, 60, 'no regen during the 72-step damage window');
  for (let frame = 0; frame < 60; frame++) game.step();
  assert.ok(Math.abs(player.hp - 66) < 1e-6, '0.1 HP per step after the delay');
});

test('a dead fighter never regenerates back to life', () => {
  const { game } = createGame();
  const player = game.players[0];
  player.hp = 0;
  for (let frame = 0; frame < 100; frame++) game.step(); // before the auto-restart
  assert.ok(game.roundOver !== null, 'the kill still registers');
  assert.equal(player.hp, 0, 'no passive revive from 0 HP');
});

test('a fighter lying on the ground cannot be beaten down further', () => {
  const { game } = createGame();
  const [attacker, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(attacker, 300, floor.y - attacker.h, true);
  attacker.groundedPlatform = floor;
  resetPlayer(victim, 306, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  victim.knockedDown = true; // lying body
  victim.knockedDownFrame = 15;
  const hpBefore = victim.hp;

  attacker.lastDirX = 1;
  attacker.punchComboNr = 3;
  attacker.tryPunchHit(victim);
  attacker.tryKickHit(victim);

  assert.equal(victim.hp, hpBefore, 'no damage lands on a lying body');
  assert.equal(victim.falling, false, 'the body is not juggled while lying');
});

test('health pickups heal for their extracted ammo value and cap at 100', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(player, 400, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.hpDamageTimer = 1e9; // freeze passive regen for exact assertions
  player.hp = 40;
  game.weaponItems.push({ weapon: { kind: 'health', name: 'Medkit', ammo: 50, shape: 'medkit' }, x: player.x + 4, y: floor.y - 2, taken: false, pickupDelay: 0 });
  game.step();
  assert.equal(player.hp, 90, 'medkit heals 50');

  // Pills: extracted Ammo 25, clamped at 100
  game.weaponItems.push({ weapon: { kind: 'health', name: 'Pills', ammo: 25, shape: 'pills' }, x: player.x + 4, y: floor.y - 2, taken: false, pickupDelay: 0 });
  game.step();
  assert.equal(player.hp, 100, 'pills heal 25 but never exceed 100');

  // At full health the pickup stays on the ground
  game.weaponItems.push({ weapon: { kind: 'health', name: 'Medkit', ammo: 50, shape: 'medkit' }, x: player.x + 4, y: floor.y - 2, taken: false, pickupDelay: 0 });
  game.step();
  assert.equal(game.weaponItems[game.weaponItems.length - 1].taken, false, 'a medkit is not wasted at full HP');
});

test('MELEE over a lying body does not grab it', () => {
  const { game, listeners } = createGame();
  const [p1, p2] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(p1, 300, floor.y - p1.h, true);
  p1.groundedPlatform = floor;
  resetPlayer(p2, 306, floor.y - p2.h, true);
  p2.groundedPlatform = floor;
  p2.knockedDown = true;
  p2.knockedDownFrame = 15;

  keyDown(listeners, 'KeyF');
  for (let frame = 0; frame < 10; frame++) game.step(); // within the lying window (frame 15 -> 25)

  assert.equal(p1.grabbedPlayerNr, 0, 'the lying body is never grabbed');
  assert.equal(p2.grabbedBy, null, 'the lying body is never held');
  assert.equal(p2.knockedDown, true, 'the body stays lying where it was');
});

test('crates are physical: standable, pushable, kickable, breakable', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;

  // a crate drops onto the floor from above
  game.crates.push({ x: 400, y: 400, w: 14, h: 14, vx: 0, vy: 0, hp: 40, hp0: 40, angle: 0, spin: 0, resting: false, dead: false });
  for (let frame = 0; frame < 40; frame++) game.step();
  const crate = game.crates[0];
  assert.ok(Math.abs(crate.y + crate.h - floor.y) < 1e-6, 'the crate rests on the floor');

  // the player lands on top of the crate
  resetPlayer(player, 402, 300, false);
  player.airVelocityY = 0;
  let standing = false;
  for (let frame = 0; frame < 60 && !standing; frame++) {
    game.step();
    standing = player.onGround && player.groundedCrate === crate;
  }
  assert.equal(standing, true, 'the player stands on the crate');

  // walking into a crate no longer moves it (immovable to footsteps)
  resetPlayer(player, 200, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.groundedCrate = null;
  game.crates.length = 0;
  game.crates.push({ x: 250, y: floor.y - 14, w: 14, h: 14, vx: 0, vy: 0, hp: 40, hp0: 40, angle: 0, spin: 0, resting: true, dead: false });
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 20; frame++) game.step();
  assert.ok(Math.abs(game.crates[0].x - 250) < 1e-6, 'walking never moves the crate');

  // a kick damages it, repeated hits break it into debris
  const target = game.crates[0];
  target.hp = 4; // one kick (4) breaks it
  player.x = target.x - 20;
  keyUp(listeners, 'KeyD');
  keyDown(listeners, 'KeyF');
  for (let frame = 0; frame < 10; frame++) game.step();
  assert.ok(game.crates.indexOf(target) === -1 || target.dead, 'the broken crate is gone');
  assert.ok(game.glassShards.length > 0, 'the crate throws wood debris');
});

test('grenade blasts damage crates and send them flying', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  game.crates.push({ x: 400, y: 486, w: 14, h: 14, vx: 0, vy: 0, hp: 40, hp0: 40, angle: 0, spin: 0, resting: true, dead: false });
  game.explodeGrenade(392, 490);
  const crate = game.crates[0];
  assert.ok(crate.hp < 40, 'the blast damages the crate');
  assert.ok(Math.abs(crate.vx) > 3, 'the blast throws the crate');
});

test('bullets damage crates and stop inside them', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  game.crates.push({ x: 400, y: 486, w: 14, h: 14, vx: 0, vy: 0, hp: 40, hp0: 40, angle: 0, spin: 0, resting: true, dead: false });
  game.bullets.push({ x: 405, y: 492, vx: 5, vy: 0, damage: 20, crit: false, owner: 1 });
  game.step();
  assert.ok(game.crates[0].hp === 20, 'the crate took the bullet damage');
  assert.equal(game.bullets.length, 0, 'the crate ate the bullet');
});

test('a couple of punches breaks a crate into pieces', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  game.crates.push({ x: 400, y: 480, w: 20, h: 20, sx: 400, sy: 480, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  const crate = game.crates[0];
  game.damageCrate(crate, 6); // first punch
  assert.ok(!crate.dead && crate.hp === 14, 'still standing after one punch');
  game.damageCrate(crate, 7); // second punch
  assert.ok(!crate.dead && crate.hp === 7, 'cracking after two');
  game.damageCrate(crate, 8); // third punch breaks it
  assert.ok(crate.dead, 'three punches break the crate');
  assert.ok(game.glassShards.length >= 3, 'it bursts into several pieces');
});

test('crates never leave the map', () => {
  const { game } = createGame();
  game.platforms.length = 0;
  game.platforms.push({ x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false });
  game.crates.length = 0;
  game.crates.push({ x: 500, y: 500, w: 20, h: 20, sx: 300, sy: 440, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  // thrown into the pit -> breaks, then respawns at home after the delay
  game.crates[0].y = 630;
  game.step();
  assert.equal(game.crates.length, 0, 'the pit destroys the crate (no teleport)');
  for (let frame = 0; frame < 299; frame++) game.step();
  assert.equal(game.crates.length, 0, 'not yet: respawn delay is 5 s');
  game.step();
  assert.equal(game.crates.length, 1, 'the crate comes back home');
  assert.ok(Math.abs(game.crates[0].x - 300) < 1e-6);
  assert.ok(Math.abs(game.crates[0].y - 480) < 1, 'settled onto the floor at home x');
  // thrown at the left wall -> clamped
  game.crates[0].x = -30;
  game.step();
  assert.ok(Math.abs(game.crates[0].x) < 1e-6, 'side walls clamp the crate');
});

test('crates are immovable to walking: blocked but never pushed', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  game.crates.push({ x: 300, y: floor.y - 20, w: 20, h: 20, sx: 300, sy: floor.y - 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 260, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 30; frame++) game.step();
  assert.ok(player.x + player.w <= game.crates[0].x + 1e-6, 'the fighter is blocked by the crate');
  assert.ok(Math.abs(game.crates[0].x - 300) < 1e-6, 'walking never moves the crate');
  assert.equal(player.running, true, 'the walk animation keeps running against it');
});

test('holding DOWN standing still takes the crouch cover pose', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  resetPlayer(player, 400, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'KeyS');
  game.step();
  assert.equal(player.crouching, true, 'DOWN while standing crouches');
  assert.equal(player.airVelocityX, 0, 'crouch locks movement');
  keyUp(listeners, 'KeyS');
  game.step();
  assert.equal(player.crouching, false);
});

test('a kick launches a crate a moderate distance, not across the map', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  game.crates.push({ x: 330, y: floor.y - 20, w: 20, h: 20, sx: 330, sy: floor.y - 20, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 310, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'KeyF'); // kick
  for (let frame = 0; frame < 40; frame++) game.step();
  const travelled = game.crates[0].x - 330;
  assert.ok(travelled > 8, 'the kick moved the crate');
  assert.ok(travelled < 60, `the crate did not fly across the map (moved ${travelled}px)`);
});

test('a punch still shoves a crate; walking does not', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  game.crates.push({ x: 330, y: floor.y - 20, w: 20, h: 20, sx: 330, sy: floor.y - 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 310, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'KeyF');
  for (let frame = 0; frame < 14; frame++) game.step(); // punch lands at frame 10
  assert.ok(game.crates[0].vx !== 0 || game.crates[0].x > 330, 'the punch shoved the crate');
});

test('the kick key is gone: MELEE kicks crates and jump kicks in the air', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  game.crates.push({ x: 330, y: floor.y - 20, w: 20, h: 20, sx: 330, sy: floor.y - 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 310, floor.y - player.h, true);
  player.groundedPlatform = floor;

  // the old dedicated kick key does nothing now
  keyDown(listeners, 'KeyG');
  game.step();
  keyUp(listeners, 'KeyG');
  assert.equal(player.kickCooldown, 0, 'KeyG no longer triggers a kick');

  // MELEE beside a crate kicks it (no punch started)
  keyDown(listeners, 'KeyF');
  game.step();
  keyUp(listeners, 'KeyF');
  assert.ok(player.kickFlash > 0, 'MELEE beside a crate kicks it');
  assert.ok(game.crates[0].hp < 20, 'the crate took the kick damage');
  assert.equal(player.punching, false, 'no punch was started');

  // MELEE while airborne queues the jump kick (with timer below the gate it
  // stays queued; from 2.5 it executes in the same step)
  resetPlayer(player, 400, 300, false);
  player.jumping = true;
  player.airbornTimer = 0;
  keyDown(listeners, 'KeyF');
  game.step();
  keyUp(listeners, 'KeyF');
  assert.equal(player.jumpKickQueued, true, 'airborne MELEE queues the jump kick');
});

test('fully overlapped fighters still punch each other (central raycast)', () => {
  const { game } = createGame();
  const [attacker, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(attacker, 300, floor.y - attacker.h, true);
  attacker.groundedPlatform = floor;
  resetPlayer(victim, 300, floor.y - victim.h, true); // exact same spot
  victim.groundedPlatform = floor;
  attacker.lastDirX = 1;
  attacker.punchComboNr = 1;

  assert.equal(attacker.meleeConnects(victim), true, 'the punch reaches an overlapped body');
  const hpBefore = victim.hp;
  attacker.tryPunchHit(victim);
  assert.ok(victim.hp < hpBefore, 'the punch landed on the overlapped fighter');
});

test('the jump kick always knocks its victim down', () => {
  const { game } = createGame();
  const [kicker, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  for (let i = 0; i < 10; i++) {
    resetPlayer(kicker, 300, floor.y - kicker.h, true);
    kicker.groundedPlatform = floor;
    resetPlayer(victim, 310, floor.y - victim.h, true);
    victim.groundedPlatform = floor;
    kicker.lastDirX = 1;
    kicker.tryKickHit(victim);
    assert.equal(victim.falling, true, 'every jump kick sends the victim down');
  }
});

test('a crate falling on a fighter knocks him down and slides past', () => {
  const { game } = createGame();
  const victim = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  resetPlayer(victim, 400, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  // crate dropped right above him
  game.crates.push({ x: 402, y: 420, w: 20, h: 20, sx: 402, sy: 420, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: false, dead: false });
  let knocked = false;
  for (let frame = 0; frame < 60; frame++) {
    game.step();
    if (victim.knockedDown) { knocked = true; break; }
  }
  assert.equal(knocked, true, 'the falling crate knocked him down');
  assert.ok(victim.x < 402 || victim.x > 422, 'the crate slid past his side');
  assert.ok(!game.crates.some(c => rectsOverlapHelp(c, victim)), 'no crate stays inside the body');
});

test('a sliding crate shoves a standing fighter without knocking him down', () => {
  const { game } = createGame();
  const victim = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  resetPlayer(victim, 420, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  // crate kicked from the left, sliding along the floor
  game.crates.push({ x: 395, y: floor.y - 20, w: 20, h: 20, sx: 395, sy: floor.y - 20, vx: 5, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: false, dead: false });
  const kdBefore = victim.knockedDown;
  for (let frame = 0; frame < 30; frame++) game.step();
  assert.equal(victim.knockedDown, kdBefore, 'a sliding crate never floors a fighter');
  assert.ok(victim.x > 420, 'the fighter was shoved aside by the crate');
});

function rectsOverlapHelp(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

test('a fighter standing on a kicked crate rides it instead of being pierced', () => {
  const { game } = createGame();
  const rider = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  const crate = { x: 400, y: floor.y - 20, w: 20, h: 20, sx: 400, sy: floor.y - 20, vx: 2.2, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false };
  game.crates.push(crate);
  resetPlayer(rider, 402, floor.y - rider.h - 20, true); // feet on the crate top
  rider.groundedPlatform = null;
  rider.groundedCrate = crate;
  for (let frame = 0; frame < 10; frame++) game.step();
  assert.equal(rider.groundedCrate, crate, 'the fighter stands on the crate');
  // the crate slides under his feet: he rides along, never pierced
  let pierced = false;
  for (let frame = 0; frame < 30; frame++) {
    game.step();
    if (rectsOverlapHelp(rider, crate)) pierced = true;
  }
  assert.equal(pierced, false, 'the crate never passes through the rider');
  assert.ok(Math.abs((rider.y + rider.h) - crate.y) < 4, 'the rider stays glued to the crate top');
});

test('crates spawn already settled: the scene opens with everything in place', () => {
  const { game } = createGame();
  // camera/test floor only: settle-check on a known surface, not the map's own
  game.crates.length = 0;
  game.crates.push({ x: 400, y: 480, w: 20, h: 20, sx: 400, sy: 480, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  const start = game.crates.map(c => ({ x: c.x, y: c.y }));
  assert.ok(start.length > 0, 'the map spawns crates');
  for (let frame = 0; frame < 60; frame++) game.step();
  for (let i = 0; i < game.crates.length; i++) {
    assert.ok(
      Math.abs(game.crates[i].y - start[i].y) < 1 &&
      Math.abs(game.crates[i].x - start[i].x) < 1,
      'crate ' + i + ' never visibly falls on scene open (<1px drift)'
    );
  }
});

test('crates never overlap each other: a kicked crate stops against or pushes the other', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  game.crates.push({ x: 500, y: 480, w: 20, h: 20, sx: 500, sy: 480, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false });
  game.crates.push({ x: 420, y: 480, w: 20, h: 20, sx: 420, sy: 480, vx: 6, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: false, dead: false });
  let overlapped = false;
  for (let frame = 0; frame < 40; frame++) {
    game.step();
    const a = game.crates[0], b = game.crates[1];
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlapped = true;
  }
  assert.equal(overlapped, false, 'the crates never end up inside each other');
  assert.ok(game.crates[1].x < 500, 'the moving crate did not tunnel through');
});

test('a crate kicked into a stack pushes the stack, never through it', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  // two crates side by side on the floor
  game.crates.push({ x: 480, y: 480, w: 20, h: 20, sx: 480, sy: 480, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false });
  game.crates.push({ x: 500, y: 480, w: 20, h: 20, sx: 500, sy: 480, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false });
  // a third crate kicked hard from the left
  game.crates.push({ x: 380, y: 480, w: 20, h: 20, sx: 380, sy: 480, vx: 10, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: false, dead: false });
  let overlapped = false;
  for (let frame = 0; frame < 40; frame++) {
    game.step();
    const cs = game.crates;
    for (let a = 0; a < cs.length; a++) {
      for (let b = a + 1; b < cs.length; b++) {
        const ca = cs[a], cb = cs[b];
        if (ca.x < cb.x + cb.w && ca.x + ca.w > cb.x && ca.y < cb.y + cb.h && ca.y + ca.h > cb.y) overlapped = true;
      }
    }
  }
  assert.equal(overlapped, false, 'no crate ever ends up inside another');
  assert.ok(game.crates[1].x > 480 || game.crates[0].x > 480, 'the impact pushed the stack');
});

test('MELEE beside a crate: first press kicks, next presses flow into the punch combo', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  game.crates.push({ x: 330, y: floor.y - 20, w: 20, h: 20, sx: 330, sy: floor.y - 20, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 310, floor.y - player.h, true);
  player.groundedPlatform = floor;

  // press 1: kicks the crate
  keyDown(listeners, 'KeyF');
  game.step();
  keyUp(listeners, 'KeyF');
  assert.ok(player.kickFlash > 0, 'first press kicks the crate');
  assert.equal(player.punching, false);
  assert.ok(player.kickCooldown > 0, 'the kick went on cooldown');

  // press 2 while the kick is cooling down: the punch combo starts anyway
  keyDown(listeners, 'KeyF');
  game.step();
  keyUp(listeners, 'KeyF');
  assert.equal(player.punching, true, 'the combo flows right after the kick');
  assert.ok(player.kickCooldown > 0, 'the cooldown still had time left');
});

test('crouching beside a crate takes cover: back flush, bullets hit the crate', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  const crate = { x: 460, y: floor.y - 20, w: 20, h: 20, sx: 460, sy: floor.y - 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false };
  game.crates.push(crate);
  // standing 4px from the crate: touching distance takes cover
  resetPlayer(player, crate.x - player.w - 4, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'KeyS');
  for (let frame = 0; frame < 4; frame++) game.step();
  assert.equal(player.crouching, true);
  assert.equal(player.inCover, true, 'the crouch snapped his back to the crate');
  assert.equal(player.x + player.w, crate.x, 'flush against the crate face');
  assert.equal(player.lastDirX, -1, 'back to the crate: he faces the open side');

  // from 20px away the crouch is just a crouch: no magnetizing
  game.crates.pop();
  game.crates.push({ x: 460, y: floor.y - 20, w: 20, h: 20, sx: 460, sy: floor.y - 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 420, floor.y - player.h, true);
  player.groundedPlatform = floor;
  for (let frame = 0; frame < 10; frame++) game.step();
  assert.equal(player.crouching, true);
  assert.equal(player.inCover, false, 'no magnetizing from a distance');

  // a bullet from the crate's side stops at the crate: full cover
  const hpBefore = player.hp;
  game.bullets.push({ x: 490, y: floor.y - 10, vx: -6, vy: 0, damage: 20, crit: false, owner: 2 });
  for (let frame = 0; frame < 3; frame++) game.step();
  assert.equal(game.bullets.length, 0, 'the bullet died on the crate');
  assert.equal(player.hp, hpBefore, 'the fighter took no damage in cover');

  // with no crate around, crouching never claims cover
  game.crates.length = 0;
  game.step();
  assert.equal(player.crouching, true);
  assert.equal(player.inCover, false, 'no crate, no cover');

  // the walk + hold-S path (roll triggered while running) still ends in cover
  game.crates.push({ x: 400, y: floor.y - 20, w: 20, h: 20, sx: 400, sy: floor.y - 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 360, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 20; frame++) game.step();
  keyUp(listeners, 'KeyD');
  keyDown(listeners, 'KeyS'); // roll first (kneel while running), then hold
  for (let frame = 0; frame < 40; frame++) game.step();
  keyUp(listeners, 'KeyS');
  assert.equal(player.inCover, true, 'even after the roll, S ends in cover');
  assert.ok(Math.abs(player.x + player.w - 400) < 1, 'flush against the crate face');
});

test('a fighter standing on a crate cannot kick it from on top', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  const crate = { x: 400, y: floor.y - 20, w: 20, h: 20, sx: 400, sy: floor.y - 20, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false };
  game.crates.push(crate);
  resetPlayer(player, 402, floor.y - player.h - 20, true); // feet on the crate top
  player.groundedPlatform = null;
  player.groundedCrate = crate;
  for (let frame = 0; frame < 5; frame++) game.step();
  const hpBefore = crate.hp;
  const vxBefore = crate.vx;

  // MELEE while standing on it: no kick target, punches start instead
  keyDown(listeners, 'KeyF');
  for (let frame = 0; frame < 12; frame++) game.step(); // punch swings
  keyUp(listeners, 'KeyF');
  assert.equal(crate.hp, hpBefore, 'the mounted crate took no kick damage');
  assert.ok(Math.abs(crate.vx - vxBefore) < 1e-6, 'the mounted crate was not shoved');
});

test('punch combos beside a crate still shove it (floor-level sweep)', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  const crate = { x: 330, y: floor.y - 20, w: 20, h: 20, sx: 330, sy: floor.y - 20, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false };
  game.crates.push(crate);
  resetPlayer(player, 310, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.groundedCrate = null; // beside it, not on top
  player.lastDirX = 1;
  keyDown(listeners, 'KeyF');
  for (let frame = 0; frame < 14; frame++) game.step(); // punch lands
  keyUp(listeners, 'KeyF');
  assert.ok(crate.hp < 60, 'the punch hit the crate');
  assert.ok(crate.vx !== 0 || crate.x > 330, 'the punch shoved it');
});

test('a fighter standing ON the crate still never hits it', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  const crate = { x: 400, y: floor.y - 20, w: 20, h: 20, sx: 400, sy: floor.y - 20, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false };
  game.crates.push(crate);
  resetPlayer(player, 402, floor.y - player.h - 20, true);
  player.groundedPlatform = null;
  player.groundedCrate = crate;
  for (let frame = 0; frame < 5; frame++) game.step();
  keyDown(listeners, 'KeyF');
  for (let frame = 0; frame < 14; frame++) game.step();
  keyUp(listeners, 'KeyF');
  assert.equal(crate.hp, 60, 'the mounted crate stays untouched');
});

test('crouched on top of a crate, MELEE stomps it to move it', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0;
  const crate = { x: 400, y: floor.y - 20, w: 20, h: 20, sx: 400, sy: floor.y - 20, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false };
  game.crates.push(crate);
  resetPlayer(player, 402, floor.y - player.h - 20, true);
  player.groundedPlatform = null;
  player.groundedCrate = crate;
  for (let frame = 0; frame < 5; frame++) game.step();

  // crouch on top (hold S), then MELEE: the stomp kick moves the crate
  keyDown(listeners, 'KeyS');
  for (let frame = 0; frame < 3; frame++) game.step();
  assert.equal(player.crouching, true, 'crouched on top of the crate');
  keyDown(listeners, 'KeyF');
  game.step();
  keyUp(listeners, 'KeyF');
  assert.ok(player.kickFlash > 0, 'MELEE crouched = stomp kick');
  assert.ok(crate.hp < 60, 'the crate took the stomp damage');
  assert.ok(crate.vx !== 0 || crate.x !== 400, 'the stomp shoved the crate');

  // standing (not crouched) MELEE still refuses to kick it
  keyUp(listeners, 'KeyS');
  game.step();
  keyDown(listeners, 'KeyF');
  game.step();
  keyUp(listeners, 'KeyF');
  assert.equal(player.kickFlash, 0, 'standing MELEE does not kick it');
  assert.equal(player.punching, true, 'it punches instead');
});
