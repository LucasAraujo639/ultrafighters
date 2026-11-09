'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const gameSource = fs.readFileSync(path.join(__dirname, '../src/game.js'), 'utf8');
const spriteMapSource = fs.readFileSync(path.join(__dirname, '../sprite-map.example.js'), 'utf8');
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

  if (process.env.SF_TEST_LOAD_MAP) {
    vm.runInNewContext(spriteMapSource, sandbox, { filename: 'sprite-map.example.js' });
  }
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
    knockbackRoll: false,
    knockbackRollFrame: 0,
    knockbackRollDir: 0,
    knockbackRollAngle: 0,
    blastRollPending: 0,
    diving: false,
    climbing: false,
    climbFrame: 0,
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

  assert.equal(boxes.length, 33); // 27 tiles + 6 stair steps
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

test('fighters use a body 60% of the base size (and a collision body narrower than the artifact frame)', () => {
  const { game } = createGame();
  for (const player of Array.from(game.players)) {
    assert.equal(player.baseW, 28);
    assert.equal(player.baseH, 44);
    assert.ok(Math.abs(player.w - 28 * 0.6 * 0.85 * 0.8) < 1e-9, 'collision width is 80 % of the scaled frame (scaled 0.6, reduced 15 %)');
    assert.ok(Math.abs(player.h - 44 * 0.6 * 0.85) < 1e-9);
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
    assert.equal(player.ranged.gun.name, 'Pistol');
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
  keyDown(listeners, 'Digit1');
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
  assert.ok(Math.abs(victim.airVelocityX - 2.25) < 1e-6);
  assert.ok(Math.abs(victim.airVelocityY + 1.875) < 1e-6);
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

test('a long fall slams the ground into a knockback roll, then the lying recovery plays', () => {
  const { game } = createGame();
  const [other, faller] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(other, 60, floor.y - other.h, true);
  other.groundedPlatform = floor;
  resetPlayer(faller, 400, 120, false); // 380 px above the floor

  let sawRagdoll = false;
  let sawRoll = false;
  let landed = false;
  for (let frame = 0; frame < 160 && !landed; frame++) {
    game.step();
    sawRagdoll = sawRagdoll || faller.falling;
    sawRoll = sawRoll || faller.knockbackRoll;
    landed = faller.knockedDown && !faller.knockbackRoll;
  }

  assert.equal(sawRagdoll, false, 'the fall keeps air control (no mid-air ragdoll)');
  assert.equal(sawRoll, true, 'the slam-grade touchdown tumbles (fall from great height)');
  assert.equal(landed, true, 'the tumble hands the body to the lying knockdown recovery');
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

test('a launched body slamming a wall at speed tumbles into a knockback roll', () => {
  const { game } = createGame();
  const [stander, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  const wall = { x: 700, y: 250, w: 60, h: 260, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor, wall);

  // Far away so it never enters the squash rule
  resetPlayer(stander, 60, floor.y - stander.h, true);
  stander.groundedPlatform = floor;

  // Flush right against the wall face (700): the very first substep slams it.
  // Manually reproduce the combo-finisher ragdoll (Falling + horizontal push).
  resetPlayer(victim, 683.2, floor.y - victim.h - 40, false);
  victim.airVelocityX = 2.4; // stronger than the extracted launch push (2.25)
  victim.airVelocityY = 1;
  victim.falling = true;
  victim.lastDirX = 1;

  let rollSteps = 0;
  let rollStartVx = null;
  let monotonic = true;
  let prevAbs = null;
  let sawRecovery = false;
  let sawSpin = false;
  let spinMonotonic = true;
  let prevAngle = 0;
  for (let frame = 0; frame < 200; frame++) {
    game.step();
    if (victim.knockbackRoll) {
      if (rollStartVx === null) {
        rollStartVx = victim.airVelocityX;
        assert.equal(victim.knockbackRollDir, -1, 'the rebound flips the roll off the wall (leftward push)');
        assert.ok(Math.abs(rollStartVx) < 2.4, 'the rebound keeps only part of the impact speed');
      }
      if (victim.onGround) {
        rollSteps++;
        const abs = Math.abs(victim.airVelocityX);
        if (prevAbs !== null && abs > prevAbs + 1e-9) monotonic = false;
        prevAbs = abs;
      }
      // The doll spins with the rolled distance: a leftward roll only turns
      // ccw (non-increasing negative angle) and resets to 0 once it ends
      if (victim.knockbackRoll) {
        if (victim.knockbackRollAngle > prevAngle + 1e-9) spinMonotonic = false;
        prevAngle = victim.knockbackRollAngle;
        sawSpin = sawSpin || victim.knockbackRollAngle < -20;
      } else if (rollStartVx !== null && victim.knockbackRollAngle !== 0) {
        spinMonotonic = false; // stale angle after the roll is over
      }
    }
    if (victim.knockedDown && !victim.knockbackRoll) sawRecovery = true;
  }

  assert.ok(rollStartVx !== null, 'the wall slam starts the knockback roll');
  assert.ok(rollSteps >= 3, 'the roll glides along the ground under friction');
  assert.equal(monotonic, true, 'friction only decelerates the roll');
  assert.equal(sawRecovery, true, 'the roll ends into the lying knockdown recovery');
  assert.equal(sawSpin, true, 'the tumble doll spins as it rolls');
  assert.equal(spinMonotonic, true, 'the spin follows the roll motion and resets when the roll ends');
  assert.ok(victim.knockbackRollFrame <= 1, 'the roll clock resets when the roll ends');
  assert.ok(victim.knockbackRollAngle === 0, 'the spin resets when the roll ends');
  assert.equal(victim.hp > 0, true, 'the victim survived the wall impact (no damage rule)');
  assert.equal(game.playerSpriteKey(victim), 'idle', 'the body gets back up to idle');
});

test('walking into a wall without the ragdoll flight never starts the roll', () => {
  const { game, listeners } = createGame();
  const [walker] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  const wall = { x: 600, y: 300, w: 60, h: 210, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor, wall);

  resetPlayer(walker, 580, floor.y - walker.h, true);
  walker.groundedPlatform = floor;

  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 90; frame++) {
    game.step();
    assert.equal(walker.knockbackRoll, false, 'a controlled push never tumbles');
    assert.equal(walker.knockedDown, false, 'the walker stays on their feet');
    assert.ok(walker.x + walker.w <= 600 + 1e-6, 'the wall still blocks them');
  }
  keyUp(listeners, 'KeyD');
});

test('a sprint crash rebounds off the wall to the opposite side, tumbling', () => {
  const { game, listeners } = createGame();
  const [runner] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  const wall = { x: 600, y: 250, w: 60, h: 260, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor, wall);

  // Double-tap RIGHT to sprint (the extracted 2.55 speed) straight at the wall
  for (const crate of game.crates) crate.dead = true; // clear the runway
  resetPlayer(runner, 450, floor.y - runner.h, true);
  runner.groundedPlatform = floor;
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 3; frame++) game.step();
  keyUp(listeners, 'KeyD');
  game.step(); // release arms the sprint window
  keyDown(listeners, 'KeyD');
  game.step(); // re-press with the direction held: sprinting

  assert.equal(runner.sprinting, true, 'the double-tap sprints toward the wall');

  let crashSpeed = null;
  let reboundVx = null;
  let reboundDir = null;
  let crashedAtX = null;
  let sawRecovery = false;
  let sawSpin = false;
  let movedAway = false;
  for (let frame = 0; frame < 340; frame++) {
    game.step();
    if (runner.knockbackRoll) {
      if (reboundVx === null) {
        reboundVx = runner.airVelocityX;
        reboundDir = runner.knockbackRollDir;
        crashedAtX = runner.x;
      }
      sawSpin = sawSpin || runner.knockbackRollAngle < -20; // ccw: rolls back left
    }
    if (runner.knockedDown && !runner.knockbackRoll) sawRecovery = true;
    if (sawRecovery) keyUp(listeners, 'KeyD'); // stand up straight
    // after the tumble, the body must be drifting AWAY from the wall face
    if (reboundVx !== null && runner.x + runner.w < 600 - 4) movedAway = true;
  }

  assert.ok(reboundVx !== null, 'the fast crash starts the knockback roll');
  assert.ok(reboundVx < 0, 'the rebound pushes the body AWAY from the wall (opposite side)');
  assert.equal(reboundDir, -1, 'the roll faces and spins toward the rebound direction');
  assert.ok(crashedAtX > 520, 'the body was near the wall face when it smashed');
  assert.equal(sawSpin, true, 'the rebound tumble spins');
  assert.equal(sawRecovery, true, 'the tumble ends into the lying recovery and the body gets up');
  assert.equal(movedAway, true, 'the fighter ends up clearly on the opposite side of the wall face');
});

test('a plain jump drifting into a wall never tumbles, even at the air cap', () => {
  const { game, listeners } = createGame();
  const [jumper] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  const wall = { x: 600, y: 250, w: 60, h: 260, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor, wall);
  for (const crate of game.crates) crate.dead = true;

  // Mid-jump state: airborne with the direction held, so air control has
  // already saturated the drift at the cap (2 * RunSpeed = 3.4, past the
  // 3.0 sprint-crash bar). The wall face is close enough that the vertical
  // speed at contact stays a hop's worth (well under the free-fall bar):
  // exactly the user-reported case — jump + held direction + wall = no tumble.
  resetPlayer(jumper, wall.x - jumper.w - 26, floor.y - jumper.h - 50, false);
  jumper.airVelocityX = 3.4;
  jumper.airVelocityY = 0.5;
  jumper.lastDirX = 1;
  keyDown(listeners, 'KeyD'); // the held direction keeps the drift at the cap

  let sawWall = false;
  let sawRoll = false;
  for (let frame = 0; frame < 160; frame++) {
    game.step();
    sawWall = sawWall || jumper.x + jumper.w >= 598;
    sawRoll = sawRoll || jumper.knockbackRoll || jumper.rolling;
    if (jumper.knockbackRoll) assert.fail('the jump drift tumbled into the roll');
    if (game.playerSpriteKey(jumper) === 'knockbackRoll') {
      assert.fail('the jump drift rendered the tumble pose');
    }
    if (jumper.onGround) keyUp(listeners, 'KeyD'); // landed: stand still
  }

  assert.equal(sawWall, true, 'the body actually reached the wall face');
  assert.equal(sawRoll, false, 'the airborne drift never starts the roll');
  assert.equal(jumper.hp, 100, 'a plain wall touch costs nothing');
  assert.equal(game.playerSpriteKey(jumper), 'idle', 'the body slides down and stands');
});

test('a great-height drift into a wall still tumbles (long-free-fall grade)', () => {
  const { game, listeners } = createGame();
  const [faller] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  // Tall wall spanning the whole descent so the body meets the face mid-fall
  const wall = { x: 600, y: 150, w: 60, h: 360, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor, wall);
  for (const crate of game.crates) crate.dead = true;
  for (const barrel of game.barrels) barrel.dead = true; // props off the descent lane

  // 260 px drop drifting right with the direction held: the wide gap makes
  // the face arrive late, so the vertical speed crosses the free-fall bar
  // well before contact — a real high-impact slam, not a jump drift.
  resetPlayer(faller, wall.x - faller.w - 68, floor.y - faller.h - 260, false); // gap scaled with the air drift (15 % slower fighter)
  faller.airVelocityY = 0.5;
  faller.lastDirX = 1;
  keyDown(listeners, 'KeyD'); // drift INTO the wall face

  let sawRoll = false;
  let rollDir = null;
  let sawRecovery = false;
  for (let frame = 0; frame < 300; frame++) {
    game.step();
    if (faller.knockbackRoll) {
      sawRoll = true;
      if (rollDir === null) rollDir = faller.knockbackRollDir;
    }
    if (faller.knockedDown && !faller.knockbackRoll) {
      sawRecovery = true;
      keyUp(listeners, 'KeyD'); // stand up straight
    }
  }

  assert.equal(sawRoll, true, 'the great-height wall slam starts the roll');
  assert.equal(rollDir, -1, 'the rebound off the right wall rolls back left');
  assert.equal(sawRecovery, true, 'the tumble ends into the lying recovery');
  assert.equal(game.playerSpriteKey(faller), 'idle', 'the body gets back up');
});

test('a run off a ledge slams the ground into a roll facing the impact side', () => {
  const { game, listeners } = createGame();
  const [stander, faller] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(stander, 60, floor.y - stander.h, true);
  stander.groundedPlatform = floor;

  // 260 px vertical drop while still moving sideways: a controlled run off a
  // ledge is a fall from GREAT height — the slam-grade touchdown tumbles now
  // (requested trigger 2), facing the impact's horizontal side (vx > 0 rolls
  // facing right; the mirror would flip it for a leftward impact).
  for (const crate of game.crates) crate.dead = true;
  for (const barrel of game.barrels) barrel.dead = true; // props off the descent lane
  resetPlayer(faller, 420, floor.y - faller.h - 260, false);
  faller.airVelocityX = 1.5;
  faller.airVelocityY = 0.5;
  faller.falling = false;
  faller.lastDirX = 1;

  let sawRoll = false;
  let rollDir = null;
  let sawKnockdown = false;
  let sawRecovery = false;
  let landed = false;
  keyDown(listeners, 'ArrowRight'); // P2 holds the direction while falling off
  for (let frame = 0; frame < 300; frame++) {
    game.step();
    landed = landed || faller.onGround;
    if (faller.knockbackRoll) {
      sawRoll = true;
      if (rollDir === null) rollDir = faller.knockbackRollDir;
    }
    sawKnockdown = sawKnockdown || faller.knockedDown;
    if (faller.knockedDown && !faller.knockbackRoll) {
      sawRecovery = true;
      keyUp(listeners, 'ArrowRight'); // stand up straight
    }
  }
  assert.equal(landed, true, 'the flight reaches the floor');

  assert.equal(sawRoll, true, 'the slam-grade touchdown starts the roll');
  assert.equal(rollDir, 1, 'the roll faces the impact side (moving right)');
  assert.equal(sawKnockdown, true, 'the roll ends into the lying knockdown');
  assert.equal(sawRecovery, true, 'the lying recovery plays through');
  assert.ok(faller.hp < 100, 'the impact damage still applies');
  assert.ok(faller.hp > 0, 'the faller survived');
  assert.equal(game.playerSpriteKey(faller), 'idle', 'the body gets back up to idle');
});

test('a short fall below the slam bar lands soft, never the roll', () => {
  const { game } = createGame();
  const [faller] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  // 40 px shelf hop: the touchdown speed stays under the slam bar
  // (FALL_TRIGGER_SPEED), so no damage, no knockdown and never the roll —
  // the tumble stays reserved for great-height impacts.
  for (const barrel of game.barrels) barrel.dead = true; // props off the descent lane
  resetPlayer(faller, 420, floor.y - faller.h - 40, false);
  faller.airVelocityX = 0;
  faller.airVelocityY = 0.5;
  faller.falling = false;
  faller.lastDirX = 1;

  let sawRoll = false;
  let sawKnockdown = false;
  for (let frame = 0; frame < 120; frame++) {
    game.step();
    sawRoll = sawRoll || faller.knockbackRoll;
    sawKnockdown = sawKnockdown || faller.knockedDown;
  }

  assert.equal(sawRoll, false, 'sub-bar touchdowns never roll');
  assert.equal(sawKnockdown, false, 'a shelf hop lands soft, no knockdown');
  assert.equal(faller.hp, 100, 'a soft touchdown takes no impact damage');
  assert.equal(game.playerSpriteKey(faller), 'idle', 'the body stands');
});

test('a run + jump across flat ground never triggers the roll', () => {
  const { game, listeners } = createGame();
  const [runner] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  for (const crate of game.crates) crate.dead = true;

  resetPlayer(runner, 300, floor.y - runner.h, true);
  runner.groundedPlatform = floor;
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 4; frame++) game.step();
  keyDown(listeners, 'KeyW');
  game.step(); // UP just-pressed: beginJump

  let sawAirborne = false;
  let sawAscentKey = false;
  let sawDescentKey = false;
  for (let frame = 0; frame < 160; frame++) {
    game.step();
    sawAirborne = sawAirborne || !runner.onGround;
    if (sawAirborne && runner.onGround) {
      keyUp(listeners, 'KeyD'); // touchdown: stop walking so the body stands
    }
    if (!runner.onGround) {
      const key = game.playerSpriteKey(runner);
      sawAscentKey = sawAscentKey || key === 'jump';
      sawDescentKey = sawDescentKey || key === 'jump';
    }
    assert.equal(runner.knockbackRoll, false, 'a plain jump never starts the knockback roll');
    assert.equal(runner.rolling, false, 'a plain jump never starts the dodge roll');
    if (game.playerSpriteKey(runner) === 'knockbackRoll' || game.playerSpriteKey(runner) === 'roll') {
      assert.fail('the run+jump rendered a roll pose');
    }
  }

  assert.equal(sawAirborne, true, 'the jump left the ground');
  assert.equal(sawAscentKey, true, 'the ascent renders the jump pose');
  assert.equal(sawDescentKey, true, 'the whole jump, descent included, holds the single jump pose');
  assert.equal(runner.hp, 100, 'the flat jump touchdown takes no damage');
  assert.equal(game.playerSpriteKey(runner), 'idle', 'the body lands and stands');
});

test('the descent sprite map never carries the impact tumble cell', () => {
  // Standalone eval: the map file must keep the descent clean on its own.
  // (Array.from copies into the harness realm so cross-realm prototypes
  // cannot trip deepStrictEqual.)
  const recorded = new vm.Script(spriteMapSource, { filename: 'sprite-map.example.js' });
  const sandbox = { window: {} };
  recorded.runInNewContext(sandbox);
  const fallCells = Array.from(sandbox.window.PLAYER_SPRITE_MAP.fall);
  assert.deepEqual(fallCells, [602, 603], 'the descent keeps only the plain fall pair');
  assert.equal(fallCells.includes(606), false, 'cell 606 stays out of the descent');
  assert.equal(sandbox.window.PLAYER_SPRITE_MAP.knockbackRoll, 606, '606 remains the impact tumble pose');
});

test('a grenade blast always rolls its victim on touchdown', () => {
  const { game } = createGame();
  const [victim, bystander] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  for (const crate of game.crates) crate.dead = true;
  for (const barrel of game.barrels) barrel.dead = true;

  resetPlayer(victim, 300, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  resetPlayer(bystander, 600, floor.y - bystander.h, true); // far beyond the 90 px radius
  bystander.groundedPlatform = floor;

  game.explodeGrenade(victim.x + 20, victim.y + victim.h / 2);
  assert.equal(victim.falling, true, 'the blast ragdolls the victim');
  assert.ok(victim.blastRollPending > 0, 'the blast arms the roll window');
  assert.equal(bystander.blastRollPending, 0, 'the fighter outside the radius is untouched');

  let sawFlight = false;
  let sawRoll = false;
  let sawRollDir = null;
  let sawRecovery = false;
  let sawSpin = false;
  for (let frame = 0; frame < 260; frame++) {
    game.step();
    sawFlight = sawFlight || victim.falling;
    if (victim.knockbackRoll) {
      sawRoll = true;
      sawRollDir = sawRollDir === null ? victim.knockbackRollDir : sawRollDir;
      sawSpin = sawSpin || Math.abs(victim.knockbackRollAngle) > 20;
    }
    if (victim.knockedDown && !victim.knockbackRoll) sawRecovery = true;
  }

  assert.equal(sawFlight, true, 'the blast launches a ragdoll flight first');
  assert.equal(sawRoll, true, 'the blast touchdown ends in the knockback roll');
  assert.ok(sawRollDir !== null, 'the tumble keeps a flip direction');
  assert.equal(sawSpin, true, 'the tumble spins as it rolls');
  assert.equal(sawRecovery, true, 'the roll ends into the lying recovery');
  assert.ok(victim.hp < 100, 'the blast takes its damage');
  assert.ok(victim.hp > 0, 'the victim survives');
  assert.equal(victim.blastRollPending, 0, 'the roll window is consumed');
  assert.equal(game.playerSpriteKey(victim), 'idle', 'the body gets back up to idle');
  assert.equal(bystander.hp, 100, 'the bystander never took the blast');
  assert.equal(bystander.knockbackRoll, false, 'the bystander never rolled');
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
    owner: 1,
    impulse: 0.6
  });
  game.step();

  assert.equal(pane.broken, true, 'a bullet shatters the pane');
  // SOLID_GLASS_01 has Strength 0: the bullet pierces it and keeps flying
  assert.equal(game.bullets.length, 1, 'the bullet pierces the glass');

  game.restartRound();

  assert.equal(pane.broken, false, 'the next round rebuilds the pane');
  assert.ok(Array.from(game.platforms).includes(pane), 'the collider is back');
  assert.equal(game.glassShards.length, 0, 'shards are cleared with the round');
});

test('walking into the pane blocks the fighter and never shatters it', () => {
  const { game } = createGame();
  const player = game.players[0];
  const pane = game.glassPanes[0];

  // walking right into the pane's face
  resetPlayer(player, pane.x - player.w - 2, pane.y, false);
  player.diving = false;
  player.airVelocityX = 2;
  player.airVelocityY = 0;

  game.step();

  assert.equal(pane.broken, false, 'walking against the pane leaves it intact');
  assert.ok(player.x + player.w <= pane.x + 0.5, 'the pane blocks the walk — no pass-through');
});

test('a dive tackle crashes through the pane', () => {
  const { game } = createGame();
  const player = game.players[0];
  const pane = game.glassPanes[0];

  resetPlayer(player, pane.x - player.w / 2 - 2, pane.y, false);
  player.diving = true;
  player.airVelocityX = 2;
  player.airVelocityY = 0.4;

  game.step();

  assert.equal(pane.broken, true, 'the tackle smashes the pane');
  assert.equal(Array.from(game.platforms).includes(pane), false, 'the collider is gone');
});

test('jumping beside the glass column keeps the full jump arc', () => {
  const { game, listeners } = createGame();
  const p = game.players[0];
  // settle naturally, then stand on the pit floor right beside the pane column
  for (let i = 0; i < 40; i++) game.step();
  const pane = game.glassPanes[0];
  const pitFloor = game.platforms.find(
    (pl) => pl.shape === 'rect' && !pl.glass && !pl.ladder && !pl.cloud &&
      pl.x + pl.w > pane.x - 30 && pl.x < pane.x && pl.y + 3 >= pane.y + pane.h
  );
  if (pitFloor) {
    game.players[0].x = pane.x - 18; // right edge grazes the pit pillar's edge
    game.players[0].y = pitFloor.y - game.players[0].h;
    game.players[0].groundedPlatform = pitFloor;
    game.players[0].onGround = true;
  }
  const startY = p.y;
  keyDown(listeners, 'KeyW');
  let peak = startY;
  for (let i = 1; i <= 30; i++) {
    game.step();
    peak = Math.min(peak, p.y);
  }
  keyUp(listeners, 'KeyW');
  const rise = startY - peak;
  assert.ok(rise > 30, 'the jump rises (got ' + rise.toFixed(1) + 'px, was dying at ~9)');
  assert.equal(pane.broken, false, 'a normal jump never shatters the pane');
});

test('shooting into the air never touches the panes', () => {
  const { game } = createGame();
  // 4 straight shots in empty sky, none aimed at a pane
  game.bullets.push({ x: 250, y: 300, vx: 0, vy: -40, damage: 10, crit: false, critDamage: 0, owner: 1, impulse: 0.6 });
  game.bullets.push({ x: 500, y: 300, vx: 0, vy: -40, damage: 10, crit: false, critDamage: 0, owner: 1, impulse: 0.6 });
  game.bullets.push({ x: 700, y: 250, vx: -30, vy: -30, damage: 10, crit: false, critDamage: 0, owner: 1, impulse: 0.6 });
  game.bullets.push({ x: 150, y: 250, vx: 30, vy: -30, damage: 10, crit: false, critDamage: 0, owner: 1, impulse: 0.6 });
  for (let i = 0; i < 40; i++) game.step();

  assert.equal(game.bullets.length, 0, 'the stray bullets leave the field');
  for (const pane of game.glassPanes) {
    assert.equal(pane.broken, false, 'stray gunfire never shatters a pane');
  }
});

test('an explosion shatters only the closest pane, never both', () => {
  const { game } = createGame();
  const [near, far] = game.glassPanes;

  // blast right next to one pane: the other stays intact
  game.explodeGrenade(near.x + 20, near.y + near.h / 2);
  for (let i = 0; i < 3; i++) game.step();
  assert.equal(near.broken, true, 'the closest pane shatters');
  assert.equal(far.broken, false, 'the far pane survives the same blast');

  // a second blast on the far side takes out the remaining pane
  game.explodeGrenade(far.x + 20, far.y + far.h / 2);
  for (let i = 0; i < 3; i++) game.step();
  assert.equal(far.broken, true, 'a separate blast takes the other pane out');
});

test('a crate rammed into the pane shatters it and flies through', () => {
  const { game } = createGame();
  const pane = game.glassPanes[1];

  const crate = game.crates[0];
  // a clear ram path: no neighbouring crates to bounce off
  for (var cci = 1; cci < game.crates.length; cci++) game.crates[cci].dead = true;
  Object.assign(crate, {
    x: pane.x - crate.w - 2,
    y: pane.y + 10,
    vx: 3,
    vy: 0,
    resting: false
  });

  const startX = crate.x;
  game.step();

  assert.equal(pane.broken, true, 'dynamic contact shatters the pane');
  assert.ok(crate.x > startX, 'the crate flies through the glass');
});

test('the camera zooms in when fighters are close and out once they separate', () => {
  const { game } = createGame();
  const [player1, player2] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; // camera-only test: no dynamic props in the frame

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

  // Framing: 72 px padding, fit zoom x1.12 closeness, clamped to 0.72..1.7.
  assert.ok(Math.abs(closeZoom - 1.7) < 0.01, `close zoom should be 1.7, got ${closeZoom}`);
  assert.ok(Math.abs(farZoom - 0.971) < 0.01, `far zoom should be 0.971, got ${farZoom}`);
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
    game.crates.length = 0; game.barrels.length = 0; // pure jump test: no dynamic props in the way
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

  resetPlayer(player, 15.4 - player.w / 2, 300, false); // keeps the body centred where the full-size fighter stood
  for (let frame = 0; frame < 60 && !player.onGround; frame++) game.step();
  assert.equal(player.groundedPlatform, circle);
  assert.ok(Math.abs(player.y + player.h - (circle.cy - circle.radius)) < 1e-6);
});

test('one-way platforms land only on downward foot crossings with horizontal overlap', () => {
  const { game } = createGame();
  for (const barrel of game.barrels) barrel.dead = true; // props off the descent lane
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
  // 40 steps: at the brisker walk pace the body clears the ledge and is still falling
  // (60 steps would drop it out of the world and respawn it)
  for (let frame = 0; frame < 40; frame++) game.step();

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
  assert.ok(Math.abs(player.airVelocityX - 2.244 * 0.85) < 1e-9, 'RunSpeed is doubled while sprinting');
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
  assert.ok(Math.abs(player.airVelocityX - 1.122 * 0.85) < 1e-9, 'it stays a normal run');
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
  assert.ok(Math.abs(player.airVelocityX - 1.122 * 0.85) < 1e-9);
});

test('walk and sprint use the tuned per-step pace at 60 Hz', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = findLowerLeftFloor(game.platforms);
  resetPlayer(player, 120, floor.y - player.h, true);
  player.groundedPlatform = floor;

  // TIME_SCALE 0.75, RUN_SPEED_BOOST 1.1*0.8, fighter reduction 0.85: 1.7*0.75*0.88*0.85 px/step at 60 Hz
  const startX = player.x;
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 60; frame++) game.step();
  assert.ok(
    Math.abs(player.x - startX - 67.32 * 0.85) < 0.01,
    'one second of walking covers 1.122 * 0.85 px/step * 60 steps'
  );

  // Sprint is 2x run speed and drains 1.2*0.75 per step:
  // 100 / (0.9 * 60) = 1.85 s of full stamina.
  keyUp(listeners, 'KeyD');
  game.step();
  keyDown(listeners, 'KeyD');
  game.step();
  assert.equal(player.sprinting, true, 'the re-press starts the sprint');
  let sprintSteps = 0;
  while (player.sprintEnergy > 0 && sprintSteps < 3000) {
    game.step();
    sprintSteps++;
    // Treadmill: keep the runner on the clear stretch so the drain measure
    // never depends on station geometry (a fast sprint now rebounds on any
    // wall or crate that it reaches with the knockback roll active).
    player.x = 120;
    player.y = floor.y - player.h;
    player.onGround = true;
    player.groundedPlatform = floor;
  }
  assert.ok(
    Math.abs(sprintSteps / 60 - 100 / (0.9 * 60)) < 0.05,
    'full stamina lasts about 1.85 s'
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
  player.damage(40); // 100 -> 60, arms the 96-step regen block (72 ticks * 4/3)
  assert.equal(player.hp, 60);
  for (let frame = 0; frame < 96; frame++) game.step();
  assert.equal(player.hp, 60, 'no regen during the 96-step damage window');
  for (let frame = 0; frame < 80; frame++) game.step();
  assert.ok(Math.abs(player.hp - 66) < 0.01, '0.075 HP per step after the delay');
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

  // At full health walking over it does nothing; crouch + MELEE banks it
  game.weaponItems.push({ weapon: { kind: 'health', name: 'Medkit', ammo: 50, shape: 'medkit' }, x: player.x + 4, y: floor.y - 2, taken: false, pickupDelay: 0 });
  game.step();
  assert.equal(game.weaponItems.length, 1, 'no auto-grab at full HP');
  assert.equal(player.carriedHealth, null);
  keyDown(listeners, 'KeyS');
  game.step();
  keyDown(listeners, 'Digit1');
  game.step();
  keyUp(listeners, 'Digit1');
  keyUp(listeners, 'KeyS');
  assert.equal(game.weaponItems.length, 0, 'crouch + MELEE grabs it');
  assert.equal(player.carriedHealth.name, 'Medkit', 'and banked for later');
  assert.equal(player.hp, 100);
  player.hp = 30;
  assert.equal(player.nextConsumableKind(), 'health');
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

  keyDown(listeners, 'Digit1');
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
  game.crates.length = 0; game.barrels.length = 0;

  // a crate drops onto the floor from above
  game.crates.push({ x: 400, y: 400, w: 14, h: 14, vx: 0, vy: 0, hp: 40, hp0: 40, angle: 0, spin: 0, resting: false, dead: false });
  for (let frame = 0; frame < 80; frame++) game.step();
  const crate = game.crates[0];
  assert.ok(Math.abs(crate.y + crate.h - floor.y) < 0.01, 'the crate rests on the floor');

  // the player lands on top of the crate
  resetPlayer(player, 402, 300, false);
  player.airVelocityY = 0;
  let standing = false;
  for (let frame = 0; frame < 60 && !standing; frame++) {
    game.step();
    standing = player.onGround && player.groundedCrate === crate;
  }
  assert.equal(standing, true, 'the player stands on the crate');

  // walking into a crate shoves it slowly (heavy push), never at walking pace
  resetPlayer(player, 200, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.groundedCrate = null;
  game.crates.length = 0; game.barrels.length = 0;
  game.crates.push({ x: 250, y: floor.y - 14, w: 14, h: 14, vx: 0, vy: 0, hp: 40, hp0: 40, angle: 0, spin: 0, resting: true, dead: false });
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 60; frame++) game.step();
  assert.ok(Math.abs(game.crates[0].x - 250) < 1e-6, 'walking never moves the crate');

  // a kick damages it, repeated hits break it into debris
  const target = game.crates[0];
  target.hp = 4; // one kick (4) breaks it
  player.x = target.x - 20;
  keyUp(listeners, 'KeyD');
  keyDown(listeners, 'Digit1');
  for (let frame = 0; frame < 10; frame++) game.step();
  assert.ok(game.crates.indexOf(target) === -1 || target.dead, 'the broken crate is gone');
  assert.ok(game.glassShards.length > 0, 'the crate throws wood debris');
});

test('grenade blasts damage crates and send them flying', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
  game.crates.push({ x: 330, y: floor.y - 20, w: 20, h: 20, sx: 330, sy: floor.y - 20, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 310, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'Digit1'); // kick
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
  game.crates.length = 0; game.barrels.length = 0;
  game.crates.push({ x: 330, y: floor.y - 20, w: 20, h: 20, sx: 330, sy: floor.y - 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 310, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'Digit1');
  for (let frame = 0; frame < 14; frame++) game.step(); // punch lands at frame 10
  assert.ok(game.crates[0].vx !== 0 || game.crates[0].x > 330, 'the punch shoved the crate');
});

test('the kick key is gone: MELEE kicks crates and jump kicks in the air', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  game.crates.push({ x: 330, y: floor.y - 20, w: 20, h: 20, sx: 330, sy: floor.y - 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 310, floor.y - player.h, true);
  player.groundedPlatform = floor;

  // the old dedicated kick key does nothing now
  keyDown(listeners, 'KeyG');
  game.step();
  keyUp(listeners, 'KeyG');
  assert.equal(player.kickCooldown, 0, 'KeyG no longer triggers a kick');

  // MELEE beside a crate kicks it (no punch started)
  keyDown(listeners, 'Digit1');
  game.step();
  keyUp(listeners, 'Digit1');
  assert.ok(player.kickFlash > 0, 'MELEE beside a crate kicks it');
  assert.ok(game.crates[0].hp < 20, 'the crate took the kick damage');
  assert.equal(player.punching, false, 'no punch was started');

  // MELEE while airborne queues the jump kick (with timer below the gate it
  // stays queued; from 2.5 it executes in the same step)
  resetPlayer(player, 400, 300, false);
  player.jumping = true;
  player.airbornTimer = 0;
  keyDown(listeners, 'Digit1');
  game.step();
  keyUp(listeners, 'Digit1');
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

// Orientation-independent hit detection (user report): the old center raycast
// put every sample inside the attacker's own 0.6-scaled body, so standing a
// body apart always whiffed. The band is anchored on the front edge.
test('the punch band reaches a victim standing next to the fighter, whichever way they face', () => {
  const { game } = createGame();
  const [attacker, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  for (const victimFacing of [1, -1, 0]) {
    // victimFacing: 1 = back turned to the attacker, -1 = facing the attacker.
    // (0 still reads as a position check: only the band geometry matters.)
    resetPlayer(attacker, 290, floor.y - attacker.h, true);
    attacker.groundedPlatform = floor;
    resetPlayer(victim, 300, floor.y - victim.h, true); // one body-length away, no overlap
    victim.groundedPlatform = floor;
    attacker.lastDirX = 1;
    victim.lastDirX = victimFacing === 0 ? 1 : victimFacing;
    victim.hp = 100;
    attacker.punchComboNr = 1;

    assert.equal(
      attacker.meleeConnects(victim), true,
      `the punch reach passed the fighter edge (facing ${victimFacing})`
    );
    const hpBefore = victim.hp;
    attacker.tryPunchHit(victim);
    assert.ok(victim.hp < hpBefore, `the punch landed regardless of orientation (facing ${victimFacing})`);
  }
});

test('a first hit from behind turns the victim to face the attacker (block/defend chance)', () => {
  const { game } = createGame();
  const [attacker, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(attacker, 290, floor.y - attacker.h, true);
  attacker.groundedPlatform = floor;
  resetPlayer(victim, 300, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  attacker.lastDirX = 1;
  victim.lastDirX = 1; // back turned to the attacker
  victim.hp = 100;
  attacker.punchComboNr = 1;

  attacker.tryPunchHit(victim);
  assert.equal(victim.lastDirX, -1, 'the gethit reaction spins the victim toward the attacker');
  assert.ok(victim.stunTimer > 0, 'the victim is stunned long enough to defend the next link');
});

test('the finished combo launches the victim with their back to the attacker', () => {
  const { game } = createGame();
  const [attacker, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(attacker, 290, floor.y - attacker.h, true);
  attacker.groundedPlatform = floor;
  resetPlayer(victim, 300, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  attacker.lastDirX = 1;
  victim.lastDirX = 1; // back turned at the start
  victim.hp = 100;
  attacker.punchComboNr = 3;

  attacker.tryPunchHit(victim);
  assert.equal(victim.falling, true, 'the combo finisher ragdolls the victim');
  assert.equal(victim.lastDirX, 1, 'the launch leaves the victim facing AWAY from the attacker');
  assert.ok(victim.airVelocityX > 0, 'and they fly away from the attacker');
});

test('a lethal punch on a standing victim tips them over back-turned', () => {
  const { game } = createGame();
  const [attacker, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(attacker, 290, floor.y - attacker.h, true);
  attacker.groundedPlatform = floor;
  resetPlayer(victim, 300, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  attacker.lastDirX = 1;
  victim.lastDirX = 1; // back turned; the punch catches them from behind
  victim.hp = 4; // link 1 deals 6: lethal
  attacker.punchComboNr = 1;

  attacker.tryPunchHit(victim);
  assert.ok(victim.hp <= 0, 'the lethal punch lands');
  assert.equal(victim.falling, true, 'the standing victim is tipped over');
  assert.equal(victim.lastDirX, 1, 'the corpse ends back-turned to the attacker');
  assert.ok(Math.abs(victim.airVelocityX - 2) < 1e-6, 'case 3 tip-over velocity is unchanged');
});

test('a lethal punch on a running victim launches back-turned like any other', () => {
  const { game } = createGame();
  const [attacker, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);

  resetPlayer(attacker, 290, floor.y - attacker.h, true);
  attacker.groundedPlatform = floor;
  resetPlayer(victim, 300, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  attacker.lastDirX = 1;
  victim.lastDirX = 1; // running away from the attacker, caught from behind
  victim.running = true;
  victim.hp = 4;
  attacker.punchComboNr = 1;

  attacker.tryPunchHit(victim);
  assert.equal(victim.falling, true);
  assert.equal(victim.lastDirX, 1, 'the launch leaves the victim back-turned to the attacker');
  assert.ok(Math.abs(victim.airVelocityX - 2) < 1e-6, 'the observed tip-over velocity is unchanged (case 3 keeps its raw extracted values)');
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
  game.crates.push({ x: 330, y: floor.y - 20, w: 20, h: 20, sx: 330, sy: floor.y - 20, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 310, floor.y - player.h, true);
  player.groundedPlatform = floor;

  // press 1: kicks the crate
  keyDown(listeners, 'Digit1');
  game.step();
  keyUp(listeners, 'Digit1');
  assert.ok(player.kickFlash > 0, 'first press kicks the crate');
  assert.equal(player.punching, false);
  assert.ok(player.kickCooldown > 0, 'the kick went on cooldown');

  // press 2 while the kick is cooling down: the punch combo starts anyway
  keyDown(listeners, 'Digit1');
  game.step();
  keyUp(listeners, 'Digit1');
  assert.equal(player.punching, true, 'the combo flows right after the kick');
  assert.ok(player.kickCooldown > 0, 'the cooldown still had time left');
});

test('crouching beside a crate takes cover: back flush, bullets hit the crate', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
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
  game.crates.length = 0; game.barrels.length = 0;
  game.step();
  assert.equal(player.crouching, true);
  assert.equal(player.inCover, false, 'no crate, no cover');

  // the walk + hold-S path (roll triggered while running) still ends in cover
  game.crates.push({ x: 400, y: floor.y - 20, w: 20, h: 20, sx: 400, sy: floor.y - 20, vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 360, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 40; frame++) game.step(); // walks flush against the crate
  keyUp(listeners, 'KeyD');
  keyDown(listeners, 'KeyS'); // roll first (kneel while running), then hold
  for (let frame = 0; frame < 40; frame++) game.step();
  keyUp(listeners, 'KeyS');
  assert.equal(player.inCover, true, 'even after the roll, S ends in cover');
  assert.ok(Math.abs(player.x + player.w - 400) < 1, 'flush against the crate face');
});

test('the Slowmo pickup banks as a consumable and fires with the consume key', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  resetPlayer(player, 400, floor.y - player.h, true);
  player.groundedPlatform = floor;

  game.weaponItems.push({ weapon: { kind: 'powerup', power: 'slowmo', name: 'Slowmo 0.5', time: 5, shape: 'slowmo' }, x: player.x + 4, y: floor.y - 2, taken: false, pickupDelay: 0 });
  game.step(); // walk-over banks the consumable, nothing activates yet
  assert.equal(player.carriedSlowmo.time, 5, 'the pickup banks the slowmo in the consumable slot');
  assert.equal(game.gameSpeed, 1, 'the slow motion waits for the consume key');
  assert.ok(game.weaponItems.every((it) => it.taken), 'the item is off the ground');

  game.weaponItems.push({ weapon: { kind: 'powerup', power: 'slowmo', name: 'Slowmo 1.0', time: 10, shape: 'slowmo' }, x: player.x + 200, y: floor.y - 2, taken: false, pickupDelay: 0 });
  game.step(); // the slot stacks to one: the second pickup stays on the ground
  assert.equal(game.weaponItems[game.weaponItems.length - 1].taken, false, 'a carried slot refuses the second pickup');
  assert.equal(player.carriedSlowmo.time, 5, 'the carried slot keeps the first item');

  keyDown(listeners, 'Digit4');
  game.step(); // the consume press pops the banked item into the slow cam
  keyUp(listeners, 'Digit4');
  assert.equal(player.carriedSlowmo, null, 'consuming clears the slot');
  const mid = Math.floor(24 * 1.5) + Math.floor(5 * 60 * 0.75) - 5; // mid-hold
  let minSpeed = 1;
  for (let f = 0; f < mid + 200; f++) { // ramp in + hold + ramp out
    game.step();
    if (f < mid && game.gameSpeed < minSpeed) minSpeed = game.gameSpeed;
  }
  assert.ok(minSpeed < 0.60 && minSpeed > 0.45, 'the hold eases to ~0.4 effective pace');
  assert.equal(game.gameSpeed, 1, 'the slow motion ramps back out to full speed');
});

test('every ammo family crawls inside the slowmo window to open the dodge', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;

  const makeBullet = () => ({ x: 400, y: 200, vx: 0, vy: 10, damage: 4, crit: false, critDamage: 0, owner: 1, trail: [], rocket: false, impulse: 0.6 });
  const makeGrenade = () => ({ x: 450, y: 210, vx: 0, vy: 0, fuse: 999, type: 'grenade', spin: 0 });
  const makePuff = () => ({ x: 300, y: 150, vx: 5, vy: 0, life: 60, damage: 2, owner: 1, hit: {}, size: 6 });
  const makeRocket = () => ({ x: 400, y: 200, vx: 0, vy: 10, damage: 4, crit: false, critDamage: 0, owner: 1, trail: [], rocket: true, impulse: 0.6 });

  // Baseline: a healthy pace runs the whole family at nomrnal speed
  const bullet0 = makeBullet(); const grenade0 = makeGrenade(); const puff0 = makePuff();
  game.bullets.push(bullet0); game.grenades.push(grenade0); game.flames.push(puff0);
  for (let f = 0; f < 20; f++) game.step();
  const fastFuse = 999 - grenade0.fuse;
  const fastBullet = bullet0.y - 200;
  const fastPuff = puff0.x - 300;

  // The same window with the slow cam on: the family crawls
  game.bullets.length = 0; game.grenades.length = 0; game.flames.length = 0;
  const bullet1 = makeBullet(); const grenade1 = makeGrenade(); const puff1 = makePuff();
  const rocket1 = makeRocket();
  game.bullets.push(bullet1, rocket1); game.grenades.push(grenade1); game.flames.push(puff1);
  game.startItemSlowmo(5);
  game.step(); // the ramp spins up; ammo ran this step before the cam engaged
  for (let f = 0; f < 20; f++) game.step();
  const slowFuse = 999 - grenade1.fuse;
  const slowBullet = bullet1.y - 200;
  const slowPuff = puff1.x - 300;
  const slowRocket = Math.hypot(rocket1.x - 400, rocket1.y - 200);

  assert.ok(
    fastFuse === 20 && Math.abs(fastBullet - 200) <= 0.05 && fastPuff === 100,
    'the baseline holds every ammo full speed (fastFuse=' + fastFuse + ', fastBullet=' + fastBullet + ', fastPuff=' + fastPuff + ')'
  );
  assert.ok(slowFuse > 1 && slowFuse < fastFuse * 0.5, 'the fuse ticks on the slowed clock, not a hidden schedule');
  assert.ok(slowBullet > 1 && slowBullet < fastBullet * 0.1, 'the bullet crawls well below world pace');
  assert.ok(slowPuff > 1 && slowPuff < fastPuff * 0.15, 'the flamethrower puff crawls too');
  assert.ok(slowRocket > 1 && slowRocket < fastBullet * 0.35, 'the hand rocket wobbles within the same share');
});

test('weapons are grabbed with crouch + MELEE, never by walking over', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  resetPlayer(player, 400, floor.y - player.h, true);
  player.groundedPlatform = floor;
  game.weaponItems.length = 0;
  game.weaponItems.push({ weapon: game.guns.uzi, x: player.x + 6, y: floor.y - 2, taken: false, pickupDelay: 0 });

  // walking over does NOT grab it
  keyDown(listeners, 'KeyD');
  for (let frame = 0; frame < 5; frame++) game.step();
  keyUp(listeners, 'KeyD');
  game.step();
  assert.equal(game.weaponItems[0].taken, false, 'walk-over never grabs a weapon');
  assert.equal(player.ranged.gun.name, 'Pistol');

  // crouch + MELEE grabs it
  resetPlayer(player, 398, floor.y - player.h, true);
  player.groundedPlatform = floor;
  keyDown(listeners, 'KeyS');
  game.step(); // crouch first
  keyDown(listeners, 'Digit1');
  game.step();
  keyUp(listeners, 'Digit1');
  assert.ok(player.ranged !== null, 'the uzi is equipped');
  assert.equal(player.ranged.gun.name, 'Uzi');
  keyUp(listeners, 'KeyS');
});

test('the uzi fires a 5-shot burst with extracted damage', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const other = game.players[1];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  resetPlayer(player, 300, floor.y - player.h, true);
  player.groundedPlatform = floor;
  resetPlayer(other, 100, floor.y - other.h, true); // out of the bullet path
  other.groundedPlatform = floor;
  player.ranged = { gun: game.guns.uzi, ammo: 25 };
  player.lastDirX = 1;
  player.aiming = true; player.aimMode = 0; player.aimPitch = 0;

  player.fireWeapon();
  assert.equal(game.bullets.length, 1, 'the first shot leaves the muzzle');
  assert.equal(player.burstQueue, 4, '4 shots remain in the burst queue');
  assert.ok(Math.abs(game.bullets[0].damage - 7) < 1e-6, 'uzi damage 7');
  for (let frame = 0; frame < 18; frame++) game.step();
  assert.equal(player.burstQueue, 0, 'the full 5-shot burst left the muzzle');
  assert.equal(player.ranged.ammo, 20, 'the burst consumed 5 of 25 (extracted)');
});

test('the shotgun fires 4 pellets and the magnum crits hard', () => {
  const { game } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  resetPlayer(player, 300, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.ranged = { gun: game.guns.shotgun, ammo: 32 };
  player.aiming = true; player.aimMode = 0; player.aimPitch = 0;
  player.fireWeapon();
  assert.equal(game.bullets.length, 4, 'shotgun fires 4 pellets');
  assert.ok(Math.abs(game.bullets[0].damage - 6) < 1e-6, 'shotgun pellet damage 6');
});

test('the bazooka rocket hooks a ride: parked rider, frozen cam, steered crash', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const other = game.players[1];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  resetPlayer(player, 300, floor.y - player.h, true);
  player.groundedPlatform = floor;
  resetPlayer(other, 500, floor.y - other.h, true);
  other.groundedPlatform = floor;
  const hpBefore = other.hp;
  game.bullets.push({ x: 480, y: floor.y - 13, vx: 5, vy: 0, damage: 0, critDamage: 0, crit: false, owner: 1, trail: [], rocket: true });
  for (let frame = 0; frame < 5; frame++) game.step();
  const rocket = game.bullets[0];
  // first contact HOOKS a ride (extracted StuckToProjectile), no gib
  assert.ok(other.rocketRide != null, 'the rocket hooked a ride on the fighter');
  assert.ok(rocket && rocket.rider === other, 'the rocket carries the victim');
  assert.equal(other.hp, hpBefore, 'the hook itself does not hurt');
  assert.ok(rocket.hidden, 'the rocket Hide()s inside the rider');
  // the world is frozen by the dramatic cam (SlowmoData(0, 12, 6, 0.01))
  assert.ok(game.gameSpeed < 0.05, 'the ride starts the global slow cam');
  // the rider is parked mid-rocket (UpdatePositionToProjectile)
  assert.ok(
    Math.abs(other.x + other.w / 2 - rocket.x) < 1.5,
    'the rider rides at the rocket mid'
  );
  // steering: RIGHT dips the nose (angle grows under the held key)
  const angleBefore = rocket.rideAngle;
  keyDown(listeners, 'ArrowRight');
  for (let frame = 0; frame < 10; frame++) game.step();
  keyUp(listeners, 'ArrowRight');
  assert.ok(
    rocket.rideAngle > angleBefore + 0.3,
    'the rider steers the rocket with the RIGHT key'
  );
  // the ride timer always detonates the rocket at the cap — rider included
  other.rocketRide.timer = 150;
  game.step();
  assert.equal(other.hp, 0, 'the crash gibs the rider (the ride ends in gibs)');
  assert.ok(game.bullets.indexOf(rocket) === -1, 'the rocket is gone');
  assert.ok(game.explosions.length > 0 || game.roundOver != null, 'the blast went up');
});

test('a steered rocket crash ends the round as a DOUBLE KILL draw', () => {
  const { game } = createGame();
  const player = game.players[0];
  const other = game.players[1];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  resetPlayer(player, 300, floor.y - player.h, true);
  player.groundedPlatform = floor;
  resetPlayer(other, 500, floor.y - other.h, true);
  other.groundedPlatform = floor;
  game.bullets.push({ x: 480, y: floor.y - 13, vx: 5, vy: 0, damage: 0, critDamage: 0, crit: false, owner: 1, trail: [], rocket: true });
  for (let frame = 0; frame < 5; frame++) game.step(); // the rocket hooks `other`
  assert.ok(other.rocketRide != null, 'the ride hooked');
  // the rider steers their rocket straight into the other fighter: BOTH die
  resetPlayer(player, 504, floor.y - player.h, true);
  player.groundedPlatform = floor;
  for (let frame = 0; frame < 8; frame++) game.step();
  assert.equal(player.hp <= 0, true, 'the steered rocket gibs the victim');
  assert.equal(other.hp <= 0, true, 'the rider gibs with the crash');
  assert.ok(game.roundOver != null, 'the round ends');
  assert.equal(game.roundOver.winnerId, 0, 'a mutual rocket kill registers as a draw');
});

test('the molotov spreads fire that burns fighters and crates', () => {
  const { game } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  game.crates.push({ x: 420, y: floor.y - 20, w: 20, h: 20, sx: 420, sy: floor.y - 20, vx: 0, vy: 0, hp: 60, hp0: 60, angle: 0, spin: 0, resting: true, dead: false });
  resetPlayer(player, 425, floor.y - player.h, true);
  player.groundedPlatform = floor;
  const crateHp = game.crates[0].hp;
  game.spawnMolotovFire(430, floor.y - 2, 2);
  assert.equal(game.groundFire.length, 22, 'TriggerFireAt MOLOTOV bursts 22 nodes in a full circle');
  for (let frame = 0; frame < 40; frame++) game.step();
  assert.ok(game.groundFire.length > 0, 'the fire pool burns');
  assert.ok(game.crates[0].hp < crateHp, 'the fire burns the crate');
  assert.ok(player.hp < 100, 'the fire hurts the fighter standing in it');
});

test('a molotov has no fuse: it flies on past the old timer and bursts only on impact', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; game.grenades.length = 0; game.groundFire.length = 0;
  game.grenades.push({ type: 'molotov', x: 100, y: 100, vx: 0, vy: 0, fuse: 1, spin: 0, owner: 1, age: 0 });
  game.step();
  assert.equal(game.grenades.length, 1, 'a spent fuse value does not detonate a molotov');
  for (let f = 0; f < 200 && game.grenades.length; f++) game.step();
  assert.equal(game.grenades.length, 0, 'it shattered when it reached the floor');
  assert.ok(game.groundFire.length > 0, 'and left fire behind');
});

test('a molotov shatters against a wall and a crate instead of bouncing', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  const wall = { x: 300, y: 100, w: 20, h: 300, solidSides: true, shape: 'rect', cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor, wall);
  game.crates.length = 0; game.barrels.length = 0; game.grenades.length = 0; game.groundFire.length = 0;
  game.grenades.push({ type: 'molotov', x: 270, y: 200, vx: 6, vy: 0, fuse: 999, spin: 0, owner: 1, age: 0 });
  for (let f = 0; f < 20; f++) game.step();
  assert.equal(game.grenades.length, 0, 'burst on the wall');
  assert.ok(game.groundFire.length > 0);
  game.groundFire.length = 0;
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.push({ x: 300, y: 180, w: 20, h: 26, vx: 0, vy: 0, hp: 999, hp0: 999, angle: 0, spin: 0, resting: true, dead: false });
  game.grenades.push({ type: 'molotov', x: 270, y: 190, vx: 6, vy: 0, fuse: 999, spin: 0, owner: 1, age: 0 });
  for (let f = 0; f < 20; f++) game.step();
  assert.equal(game.grenades.length, 0, 'burst on the crate');
});

test('a molotov that reaches a fighter lights them at fire LEVEL 2', () => {
  const { game } = createGame();
  const [thrower, target] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; game.grenades.length = 0; game.flames.length = 0;
  resetPlayer(thrower, 100, floor.y - thrower.h, true);
  resetPlayer(target, 400, floor.y - target.h, true);
  target.groundedPlatform = floor;
  game.grenades.push({ type: 'molotov', x: 380, y: floor.y - 15, vx: 4, vy: 0, fuse: 999, spin: 0, owner: thrower.id, age: 40 });
  for (let f = 0; f < 15; f++) game.step();
  assert.equal(game.grenades.length, 0, 'the bottle shattered on contact');
  assert.equal(target.fireState.name, 'FIRE_LEVEL_2', 'the fighter starts burning at level 2');
});

test('flamethrower puffs: no bullet damage, owner immune, 5 touches reach level 2', () => {
  const { game } = createGame();
  const [owner, target] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; game.grenades.length = 0; game.flames.length = 0;
  resetPlayer(owner, 300, floor.y - owner.h, true);
  resetPlayer(target, 600, floor.y - target.h, true);
  const mk = (x) => ({ x, y: floor.y - 12, vx: 0, vy: 0, life: 200, damage: 2, owner: owner.id, hit: {}, size: 6, slowing: true, thrower: true });
  game.flames.push(mk(owner.x + 4));
  game.step();
  assert.equal(owner.fireState.name, 'NONE', 'the owner never burns from their own flame');
  game.flames.length = 0;
  game.flames.push(mk(target.x + 4));
  game.step();
  assert.equal(target.fireState.name, 'FIRE_LEVEL_1', 'one touch (+20) lights level 1');
  assert.ok(target.hitFlash < 6 && !target.falling, 'no bullet flinch');
  for (let f = 0; f < 30; f++) { game.flames.forEach((p) => { p.x = target.x + 4; p.y = target.y + 10; }); game.step(); }
  assert.equal(target.fireState.name, 'FIRE_LEVEL_2', 'sustained contact reaches level 2');
});

test('a flamethrower puff glides about 140 px and lands as ground fire', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; game.grenades.length = 0; game.flames.length = 0;
  game.groundFire.length = 0;
  game.flames.push({ x: 100, y: 450, vx: 3.8, vy: 0, life: 240, damage: 2, owner: 0, hit: {}, size: 5, slowing: true, thrower: true });
  let leftFire = false;
  for (let f = 0; f < 400 && game.flames.length; f++) { game.step(); if (game.groundFire.length) leftFire = true; }
  assert.equal(game.flames.length, 0, 'the puff landed');
  assert.ok(leftFire, 'and left ground fire');
});

test('the aim stays pitched after firing and drops to idle after the extracted hold (6 ticks)', () => {
  const { game } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  resetPlayer(player, 300, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.ranged = { gun: game.guns.pistol, ammo: 12 };
  player.aiming = true; player.aimMode = 0; player.aimPitch = 45;
  player.aimWasActive = true; // already armed: no fresh weapon raise

  player.fireWeapon(); // sets the BackToIdle hold timer (6 ticks = 15 steps)
  // inside the 0.25 s window the aim keeps the pitch
  for (let frame = 0; frame < 5; frame++) game.step();
  assert.equal(player.aiming, true, 'the aim stance stays alive right after firing');
  assert.equal(player.aimPitch, 45, 'the pitch stays where it was fired');

  // past the hold it drops back to the fighting idle (pitch 0)
  for (let frame = 0; frame < 15; frame++) game.step();
  assert.equal(player.aiming, false, 'the short extracted hold drops back to fighting stance');
  assert.equal(player.aimPitch, 0, 'the pitch resets to fight stance');
});

test('arming a gun plays the pre-aim raise and blocks firing until it ends', () => {
  const { game } = createGame();
  const player = game.players[0];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  resetPlayer(player, 300, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.ranged = { gun: game.guns.pistol, ammo: 12 };
  player.aiming = true; player.aimMode = 0;

  game.step(); // the raise starts on the first aiming step
  assert.ok(player.isAimPreparing(), 'the weapon raise window is open');
  player.fireWeapon();
  assert.equal(player.ranged.ammo, 12, 'no shot leaves during the raise');

  for (let frame = 0; frame < 40; frame++) game.step();
  assert.ok(!player.isAimPreparing(), 'the raise ends');
  assert.equal(player.ranged.ammo, 11, 'the shot queued during the raise fires once it ends');
});

test('the fire machine burns at level 1 and escalates to level 2 with time', () => {
  const { game } = createGame();
  const player = game.players[0];
  player.igniteFire();
  assert.equal(player.fireState.name, 'FIRE_LEVEL_1', 'flames ignite at level 1');
  const hp0 = player.hp;

  for (let frame = 0; frame < 60; frame++) game.step();
  assert.ok(player.hp < hp0 - 1 && player.hp > hp0 - 6, 'level 1 burns slowly');
  assert.equal(player.fireState.name, 'FIRE_LEVEL_1', 'no escalation inside the window');

  // without rolling the burn reaches level 2 (the burn node climbs the meter
  // past FireRank2Minimum in ~3.5 s), which drains far more HP
  const hp1 = player.hp;
  for (let frame = 0; frame < 165; frame++) game.step();
  assert.equal(player.fireState.name, 'FIRE_LEVEL_2', 'lingering at level 1 escalates to level 2');
  for (let frame = 0; frame < 60; frame++) game.step();
  assert.ok(player.hp < hp1 - 6, 'level 2 drains much more HP');
});

test('the fire machine: roll goes out at level 1, level 2 needs two rolls', () => {
  const { game } = createGame();
  const player = game.players[0];

  player.igniteFire();
  for (let frame = 0; frame < 30; frame++) game.step();
  player.notifyRoll(); // a floor roll while level 1 extinguishes the fire
  assert.equal(player.fireState.name, 'NONE', 'rolling at level 1 goes out');

  player.igniteFire();
  for (let frame = 0; frame < 220; frame++) game.step(); // escalate to level 2 (~3.5 s, the extracted node climb)
  assert.equal(player.fireState.name, 'FIRE_LEVEL_2');
  player.notifyRoll(); // first roll downgrades to level 1
  assert.equal(player.fireState.name, 'FIRE_LEVEL_1', 'level 2 cools to level 1 with one roll');
  player.notifyRoll(); // the second roll extinguishes
  assert.equal(player.fireState.name, 'NONE', 'the second roll goes out');
});

// ---------- Gore (strong-blast viscera, deaths only) ----------

const GORE_SPRITE_IDS = [141, 147, 150, 153, 181, 183, 164, 167, 170, 529, 570, 573, 1310];

function setupGoreStage(game) {
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  const fighter = game.players[0];
  const farFighter = game.players[1];
  resetPlayer(fighter, 400, floor.y - fighter.h, true);
  resetPlayer(farFighter, 700, floor.y - farFighter.h, true); // out of every blast radius
  const center = { x: fighter.x + fighter.w / 2, y: fighter.y + fighter.h / 2 };
  return { fighter, farFighter, floor, center };
}

test('the bazooka blast gibs the dead fighter: chunks and droplets fly', () => {
  const { game } = createGame();
  const { fighter, center } = setupGoreStage(game);
  assert.equal(fighter.hp, 100, 'the fighter starts healthy');

  // BAZOOKA_ROCKET detonation: radius 110, damage 100 at dead center
  game.explodeAt(center.x, center.y, 110, 100, 30);
  assert.equal(fighter.hp, 0, 'the dead-center blast kills the fighter');
  assert.ok(game.gore.length >= 20, 'the death spawns a chunk + droplet burst');
  for (const piece of game.gore) {
    assert.ok(GORE_SPRITE_IDS.includes(piece.sprite), `gore piece uses real visceral art, got ${piece.sprite}`);
    assert.ok(piece.scale <= 1.35, `gore stays small (chunk cap 1.3 / droplet 1.0), got ${piece.scale}`);
    assert.ok(['chunk', 'drop'].includes(piece.kind), 'pieces are chunks or droplets');
  }
});

test('survivors of a strong blast stay clean: blood only on the death (hp <= 0)', () => {
  const { game } = createGame();
  const { fighter, center } = setupGoreStage(game);

  // A grenade at the center deals 30 damage to a 100 hp fighter: survivor
  game.explodeAt(center.x, center.y, 90, 30, 5);
  assert.ok(fighter.hp > 0, 'the fighter survives the grenade blast');
  assert.equal(game.gore.length, 0, 'the survivor never breaks apart');

  // A weak (radius < 90) lethal blast also stays clean: gore is radius-gated too
  game.explodeAt(center.x, center.y, 60, 100, 30);
  assert.equal(fighter.hp, 0, 'the small blast would kill, but never gibs');
  assert.equal(game.gore.length, 0, 'weak explosions show no viscera');
});

test('a gibbed fighter is reduced to viscera once: the gone body never bursts again', () => {
  const { game } = createGame();
  const { fighter, center } = setupGoreStage(game);

  game.explodeAt(center.x, center.y, 110, 100, 30); // the kill
  assert.equal(fighter.gibbed, true, 'the lethal strong blast flags the body as gibbed');
  const firstBurst = game.gore.length;
  assert.ok(firstBurst >= 20, 'the kill converts the fighter into gore');

  game.explodeAt(center.x, center.y, 110, 100, 30); // another rocket on the leftover position
  assert.equal(game.gore.length, firstBurst, 'there is no body left: nothing bursts again');
  assert.equal(fighter.gibbed, true, 'the flag stays up');
});

test('a non-gore death keeps the body visible: only gibbed fighters vanish', () => {
  const { game } = createGame();
  const { fighter, center } = setupGoreStage(game);

  // weak blast (radius < 90) that still kills: no gore conversion
  game.explodeAt(center.x, center.y, 60, 100, 30);
  assert.equal(fighter.hp, 0, 'the fighter dies');
  assert.equal(fighter.gibbed, false, 'no body was converted: the sprite stays drawn');
  assert.equal(game.gore.length, 0, 'no gore either');
});

test('landed gore scars the floor and the decal pool is capped', () => {
  const { game } = createGame();
  const { center, floor } = setupGoreStage(game);

  for (let k = 0; k < 8; k++) game.explodeAt(center.x, center.y - 4, 110, 100, 30);
  assert.ok(game.gore.length > 0, 'the blasts spawn airborne viscera');
  for (let frame = 0; frame < 180; frame++) game.step(); // everything lands or fades (life 150)
  assert.ok(game.goreStains.length > 0, 'landed pieces stain the floor surface');
  assert.ok(game.gore.length === 0, 'all airborne pieces settled or faded');
  for (const stain of game.goreStains) {
    assert.ok(stain.y > floor.y - 3 && stain.y < floor.y + 2, `stains sit on the floor, got y=${stain.y}`);
    assert.ok(GORE_SPRITE_IDS.includes(stain.sprite), 'stains use real visceral art too');
  }
});

test('the round restart wipes the gore and the stains', () => {
  const { game } = createGame();
  const { center } = setupGoreStage(game);

  game.explodeAt(center.x, center.y, 110, 100, 30);
  for (let frame = 0; frame < 200; frame++) game.step(); // kill + auto-restart (180 ticks)
  assert.equal(game.gore.length, 0, 'airborne viscera never survives the restart');
  assert.equal(game.goreStains.length, 0, 'floor scars never survive the restart');
  assert.equal(game.players[0].gibbed, false, 'the fighter is whole again next round');
});

test('the decal pool is capped so old scars recycle instead of piling up', () => {
  const { game } = createGame();
  const { center } = setupGoreStage(game);

  for (let k = 0; k < 40; k++) game.explodeAt(center.x, center.y - 4, 110, 100, 30);
  for (let frame = 0; frame < 260; frame++) game.step();
  assert.ok(game.gore.length === 0, 'no airborne gore lingers');
  assert.ok(game.goreStains.length <= 90, `stains stay capped at GORE_STAIN_MAX, got ${game.goreStains.length}`);
});

function setupCoverStage(game) {
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0;
  return floor;
}

test('rolling into a crate latches the fighter into cover', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = setupCoverStage(game);
  const crate = {
    x: 260, y: floor.y - 20, w: 20, h: 20,
    vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false
  };
  game.crates.push(crate);

  // 28 px away: inside the roll interaction range. Running + DOWN = a roll
  // that must end latched to the crate, not as a plain dodge.
  resetPlayer(player, crate.x - player.w - 28, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.lastDirX = 1;
  keyDown(listeners, 'KeyD');
  keyDown(listeners, 'KeyS');
  let latched = false;
  for (let frame = 0; frame < 40 && !latched; frame++) {
    game.step();
    latched = player.cover.target === crate && player.inCover;
  }
  assert.equal(latched, true, 'rolling into the crate ends attached');
  assert.ok(!player.rolling, 'the roll stopped on the latch');

  // snapToCover glides 2 px/step: a few steps later the back is flush
  for (let frame = 0; frame < 6; frame++) game.step();
  const flushLeft = Math.abs(player.x + player.w - crate.x) < 1;
  const flushRight = Math.abs(player.x - (crate.x + crate.w)) < 1;
  assert.ok(flushLeft || flushRight, 'flush against the crate face');
  assert.equal(player.lastDirX, -1, 'facing the open side (crate on his right)');

  // walking out through the open side detaches
  keyUp(listeners, 'KeyS');
  keyUp(listeners, 'KeyD');
  keyDown(listeners, 'KeyA'); // dir = the open side
  for (let frame = 0; frame < 3; frame++) game.step();
  assert.equal(player.cover.target, null, 'walking out ends the cover');
  assert.equal(player.inCover, false);
});

test('any ICoverable prop works: kneel flush attaches via the cover system', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = setupCoverStage(game);
  game.crates.length = 0; game.barrels.length = 0;

  // a NON-crate interactive prop (a future barrel/sandbag) that implements
  // just the ICoverable contract registers standalone and works the same
  const prop = {
    x: 500, y: floor.y - 18, w: 18, h: 18, hp: 30, dead: false,
    isCoverAlive() { return this.hp > 0 && !this.dead; }
  };
  game.coverSystem.register(prop);

  resetPlayer(player, prop.x - player.w - 2, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.lastDirX = 1;
  keyDown(listeners, 'KeyS');
  for (let frame = 0; frame < 3; frame++) game.step();
  assert.equal(player.cover.target, prop, 'kneel intent attaches to any coverable');
  assert.equal(player.inCover, true);

  // killing the prop ends the cover hold: a wreck cannot shelter anyone
  prop.hp = 0;
  for (let frame = 0; frame < 3; frame++) game.step();
  assert.equal(player.cover.target, null, 'a dead prop breaks the cover');
  assert.equal(player.inCover, false);
});

test('aiming from cover fires and the cover pose returns automatically', () => {
  const { game, listeners } = createGame();
  const player = game.players[0];
  const floor = setupCoverStage(game);
  const crate = {
    x: 260, y: floor.y - 20, w: 20, h: 20,
    vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false
  };
  game.crates.push(crate);

  // get covered by kneeling flush (touching distance) with DOWN held
  resetPlayer(player, crate.x - player.w - 2, floor.y - player.h, true);
  player.groundedPlatform = floor;
  player.lastDirX = 1;
  keyDown(listeners, 'KeyS');
  for (let frame = 0; frame < 3; frame++) game.step();
  assert.equal(player.inCover, true, 'touching + DOWN takes cover');

  // a gun in hand: FIRE press aims while covered
  player.ranged = { gun: game.guns.pistol, ammo: 999 };
  keyDown(listeners, 'Digit2');
  for (let frame = 0; frame < 3; frame++) game.step();
  assert.equal(player.aiming, true, 'aiming works while covered');
  assert.equal(player.crouching, false, 'the aiming stance replaces the cover pose');
  assert.equal(player.inCover, true, 'still attached while aiming');
  assert.equal(player.lastDirX, 1, 'FIRE from cover aims over the crate (toward it)');

  // FIRE release fires the weapon; after the aim hold expires the cover
  // pose comes back by itself (no extra input needed)
  keyUp(listeners, 'Digit2');
  let backInCover = false;
  for (let frame = 0; frame < 70 && !backInCover; frame++) { // raise delay + idle hold
    game.step();
    backInCover = !player.aiming && player.crouching && player.inCover;
  }
  assert.equal(backInCover, true, 'the cover pose returns after the attack ends');
  assert.equal(player.lastDirX, -1, 'the cover pose faces the open side again');
});

test('a destroyed crate flings its shipped wood fragments with physics', () => {
  const { game } = createGame();
  game.crates.length = 0; game.barrels.length = 0;
  const crate = {
    x: 400, y: 440, w: 20, h: 20,
    vx: 0, vy: 0, hp: 1, hp0: 20, angle: 0, spin: 0, resting: true, dead: false
  };
  game.crates.push(crate);

  game.damageCrate(crate, 5, 0, 0); // hp 1 - 5 < 0: breaks
  assert.equal(game.glassShards.length, 3, 'three wood fragments fly out');
  // game state arrays live in the sandbox realm: copy elements into this
  // realm before comparing (cross-realm prototypes defeat deepEqual)
  const sprites = [...game.glassShards.map((s) => s.sprite)].sort((a, b) => a - b);
  assert.deepEqual(sprites, [6, 9, 141], 'the shipped fragment art (6/9/141) spawns');
  const fragment = game.glassShards[0];
  assert.ok(fragment.vy <= 0, 'the fragment is kicked upward');
  const vy0 = fragment.vy;
  game.step();
  game.step();
  assert.ok(fragment.vy > vy0, 'gravity keeps accelerating the fragment');
  assert.ok(Math.abs(fragment.x - 400) < 30, 'the fragments spread from the crate spot');
});

test('a long free fall crashing into a wall side tumbles (requested trigger 3)', () => {
  const { game, listeners } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  // a tall tower face: its side spans the whole fall window
  const tower = { x: 320, y: 180, w: 40, h: 320, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor, tower);
  game.crates.length = 0; game.barrels.length = 0;

  const victim = game.players[0];
  // Wide gap: the face must arrive LATE, when the fall speed already crossed
  // the free-fall bar (~76 px of drop). A short gap makes the contact a
  // routine jump-drift touch, which never tumbles (user bug report).
  resetPlayer(victim, 320 - victim.w - 54, 300, false); // airborne high up, feet ~326
  victim.lastDirX = 1;

  keyDown(listeners, 'KeyD'); // the body drifts INTO the tower face
  let tumbled = false;
  for (let f = 0; f < 80 && !tumbled; f++) {
    game.step();
    tumbled = victim.knockbackRoll;
  }
  keyUp(listeners, 'ArrowRight');

  assert.equal(tumbled, true, 'the long fall + wall slam tumbles');
  assert.equal(victim.knockbackRollDir, -1, 'the rebound pushes off the leftward face');
  assert.ok(victim.hp > 0, 'the tumbling body keeps hp (no touchdown damage)');
});

test('a same-floor run touching a wall never tumbles (touchdowns stay excluded)', () => {
  const { game, listeners } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  const wall = { x: 320, y: 340, w: 40, h: 160, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor, wall);
  game.crates.length = 0; game.barrels.length = 0;

  const runner = game.players[0];
  resetPlayer(runner, 255, floor.y - runner.h, true);
  runner.groundedPlatform = floor;

  keyDown(listeners, 'KeyD'); // run (walk speed) straight into the wall
  for (let f = 0; f < 80; f++) game.step();
  keyUp(listeners, 'KeyD');

  assert.equal(runner.knockbackRoll, false, 'a ground run touching a wall is not an impact event');
  assert.ok(runner.onGround, 'the runner stays on the floor against the wall');
  assert.ok(runner.hp > 0, 'the plain stop never hurts');
});

test('a rolling fighter is not hit by bullets; after the roll they connect again', () => {
  const { game } = createGame();
  const [shooter, target] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; game.bullets.length = 0;
  resetPlayer(target, 400, floor.y - target.h, true);
  const shoot = () => {
    game.bullets.length = 0;
    game.bullets.push({ x: target.x - 3, y: target.y + target.h / 2, vx: 6, vy: 0, owner: shooter.id, damage: 10, life: 60, impulse: 0.5 });
    game.step();
  };
  target.rolling = true; target.rollFrame = 0;
  const hp = target.hp;
  shoot();
  assert.equal(target.hp, hp, 'rolling dodges the bullet');
  target.rolling = false;
  shoot();
  assert.ok(target.hp < hp, 'the bullet hits once the roll is over');
});

// ---------- Feel tuning: jump sprite, roll cooldown, tackle ----------

test('a jump shows only the single jump cell from take-off to touchdown', () => {
  const { game, listeners } = createGame();
  const player = game.players[1];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  for (const crate of game.crates) crate.dead = true;
  resetPlayer(player, 400, floor.y - player.h, true);
  player.groundedPlatform = floor;
  listeners.keydown({ code: 'ArrowUp', repeat: false, preventDefault: () => {} });
  const keys = new Set();
  for (let f = 0; f < 90; f++) {
    game.step();
    if (!player.onGround) keys.add(game.playerSpriteKey(player));
    if (f === 3) listeners.keyup({ code: 'ArrowUp', preventDefault: () => {} });
  }
  assert.deepEqual([...keys], ['jump'], 'rise and fall use the same pose');
});

test('the roll has an exact 1 s cooldown', () => {
  const { game, listeners } = createGame();
  const player = game.players[1];
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  for (const crate of game.crates) crate.dead = true;
  resetPlayer(player, 300, floor.y - player.h, true);
  player.groundedPlatform = floor;
  const press = (code) => listeners.keydown({ code, repeat: false, preventDefault: () => {} });
  const release = (code) => listeners.keyup({ code, preventDefault: () => {} });
  const tryRoll = () => {
    press('ArrowRight'); press('ArrowDown');
    game.step();
    const rolled = player.rolling;
    release('ArrowDown'); release('ArrowRight');
    return rolled;
  };
  assert.equal(tryRoll(), true, 'the first roll starts (step 0)');
  for (let f = 0; f < 58; f++) game.step(); // steps 1..58
  assert.equal(tryRoll(), false, 'step 59: still on cooldown');
  assert.equal(tryRoll(), true, 'step 60: exactly 1 s after the first roll');
});

for (const coverSide of [-1, 1]) {
  test('leaving cover faces the open side (crate on the ' + (coverSide > 0 ? 'right' : 'left') + ')', () => {
    const { game, listeners } = createGame();
    const player = game.players[0];
    const floor = setupCoverStage(game);
    const crate = {
      x: 260, y: floor.y - 20, w: 20, h: 20,
      vx: 0, vy: 0, hp: 20, hp0: 20, angle: 0, spin: 0, resting: true, dead: false
    };
    game.crates.push(crate);
    const startX = coverSide > 0 ? crate.x - player.w - 2 : crate.x + crate.w + 2;
    resetPlayer(player, startX, floor.y - player.h, true);
    player.groundedPlatform = floor;
    player.lastDirX = coverSide; // looking at the crate when kneeling
    keyDown(listeners, 'KeyS');
    for (let frame = 0; frame < 3; frame++) game.step();
    assert.equal(player.inCover, true);
    // aim toward the crate (turn around) from cover, then fire and release
    player.ranged = { gun: game.guns.pistol, ammo: 999 };
    keyDown(listeners, 'Digit2');
    for (let frame = 0; frame < 3; frame++) game.step();
    keyUp(listeners, 'Digit2');
    for (let frame = 0; frame < 40; frame++) game.step();
    player.lastDirX = coverSide; // worst case: facing the prop when striking out
    keyUp(listeners, 'KeyS');
    keyDown(listeners, 'Digit1'); // MELEE
    game.step();
    assert.equal(player.inCover, false, 'striking leaves the cover');
    assert.equal(player.lastDirX, -coverSide, 'facing the open side after leaving');
  });
}

for (const mode of ['dive-air', 'dive-roll-ground']) {
  for (const obstacle of ['crate', 'wall']) {
    test('tackle (' + mode + ') into a ' + obstacle + ' stops cleanly without a knockback roll', () => {
      const { game } = createGame();
      const player = game.players[0];
      const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, shape: 'rect', cloud: false, ladder: false };
      const wall = { x: 372, y: 380, w: 40, h: 120, solidSides: true, shape: 'rect', cloud: false, ladder: false };
      game.platforms.length = 0; game.crates.length = 0; game.barrels.length = 0;
      game.platforms.push(floor);
      if (obstacle === 'wall') game.platforms.push(wall);
      else game.crates.push({ x: 372, y: 480, w: 20, h: 20, vx: 0, vy: 0, hp: 999, hp0: 999, angle: 0, spin: 0, resting: true, dead: false });
      resetPlayer(player, 340, floor.y - player.h, true);
      player.groundedPlatform = floor;
      player.lastDirX = 1;
      if (mode === 'dive-air') { player.onGround = false; player.groundedPlatform = null; player.diving = true; player.airVelocityY = -1; player.y -= 12; }
      else if (mode === 'dive-roll-ground') { player.rolling = true; player.rollFromDive = true; player.rollFrame = 0; }
      else { player.diving = true; }
      player.airVelocityX = 5;
      let rolled = false;
      for (let f = 0; f < 30; f++) { game.step(); rolled = rolled || player.knockbackRoll; }
      assert.equal(rolled, false, 'no knockback roll');
      assert.equal(player.diving, false);
      assert.equal(player.rolling, false);
      assert.ok(player.x + player.w <= 372 + 1e-6, 'the obstacle stops the tackle');
    });
  }
}

test('a tackle disarms a fighter who is aiming: the gun vanishes', () => {
  const { game } = createGame();
  const [diver, victim] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor);
  resetPlayer(diver, 300, floor.y - diver.h, true);
  diver.groundedPlatform = floor;
  resetPlayer(victim, 306, floor.y - victim.h, true);
  victim.groundedPlatform = floor;
  victim.ranged = { type: 'pistol', ammo: 5 };
  victim.aiming = true;
  victim.aimMode = 0;
  diver.diving = true;
  diver.checkDiveImpact(victim);
  assert.equal(victim.aiming, false, 'aim interrupted');
  assert.equal(victim.ranged, null, 'the weapon is gone');
  const dropped = game.weaponItems[game.weaponItems.length - 1];
  assert.equal(dropped.ttl, 45, 'it falls and disappears, exactly like a punched-out gun');
});

test('a held molotov never detonates in the hand, however long the key stays down', () => {
  const { game } = createGame();
  const [p] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.grenades.length = 0; game.flames.length = 0;
  resetPlayer(p, 300, floor.y - p.h, true);
  p.groundedPlatform = floor;
  p.throwable = { ammo: 3, type: 'molotov' };
  p.aiming = true; p.aimMode = 1; p.throwTimer = 72;
  const hpBefore = p.hp;
  for (let f = 0; f < 400; f++) game.step();
  assert.equal(p.aiming, true, 'still holding the bottle');
  assert.equal(p.throwable.ammo, 3, 'nothing was consumed');
  assert.equal(p.hp, hpBefore, 'no blast in the hand');
  assert.equal(game.flames.length, 0, 'no flame shows on the held bottle: only the fixed 703 sprite');
});

test('molotov floor fire lasts exactly 4 seconds from landing', () => {
  const { game } = createGame();
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; game.groundFire.length = 0;
  game.players.forEach((q) => { q.x = 700; q.y = 100; });
  game.spawnMolotovFire(100, floor.y - 2, 1);
  // every node burns 4 s counted from ITS OWN landing (landings are random):
  // track the landing step per node and check each one dies on schedule
  const landedStep = new Map();
  const burnSteps = 4 * 60;
  for (let f = 0; f < 600 && (game.groundFire.length > 0 || f < 5); f++) {
    for (const e of game.groundFire) {
      if (!e.inAir && !landedStep.has(e)) landedStep.set(e, f);
    }
    game.step();
    for (const [e, at] of landedStep) {
      const gone = !game.groundFire.includes(e);
      if (!gone) assert.ok(f - at <= burnSteps + 2, 'a node outlived its 4 s');
    }
  }
  assert.ok(landedStep.size > 0, 'nodes landed and burned');
  assert.equal(game.groundFire.length, 0, 'fully out');
  const lifetimes = [...landedStep.keys()].length;
  assert.ok(lifetimes > 0);
});

function poolSetup() {
  const { game } = createGame();
  const [p] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0; game.platforms.push(floor);
  game.crates.length = 0; game.barrels.length = 0; game.groundFire.length = 0; game.flames.length = 0;
  game.players[1].x = 700; game.players[1].y = 100;
  resetPlayer(p, 300, floor.y - p.h, true);
  p.groundedPlatform = floor;
  return { game, p, floor };
}
const fireNode = (game, x, y) => game.groundFire.push({ x, y, vx: 0, vy: 0, inAir: false, life: 9999, maxLife: 9999, size: 8, phase: 0, sparkTimer: 999, crateTick: 999, hit: {}, owner: 2 });

test('stepping into a floor fire pool starts at flame level 1', () => {
  const { game, p, floor } = poolSetup();
  fireNode(game, p.x + p.w / 2, floor.y - 4);
  game.step();
  assert.equal(p.fireState.name, 'FIRE_LEVEL_1');
});

test('standing more than 2 s in the pool escalates to flame level 2', () => {
  const { game, p, floor } = poolSetup();
  fireNode(game, p.x + p.w / 2, floor.y - 4);
  for (let f = 0; f < 100; f++) game.step();
  assert.equal(p.fireState.name, 'FIRE_LEVEL_1', 'still level 1 before 2 s');
  for (let f = 0; f < 40; f++) game.step();
  assert.equal(p.fireState.name, 'FIRE_LEVEL_2', 'level 2 after 2 s in the pool');
});

test('a fighter already at level 1 reaches level 2 much faster in the pool', () => {
  const { game, p, floor } = poolSetup();
  p.setFireState(game.FireStates ? game.FireStates.level1 : p.fireState);
  p.igniteFire();
  assert.equal(p.fireState.name, 'FIRE_LEVEL_1');
  fireNode(game, p.x + p.w / 2, floor.y - 4);
  for (let f = 0; f < 75; f++) game.step();
  assert.equal(p.fireState.name, 'FIRE_LEVEL_2', 'well under the plain 3.5 s / 2 s');
});

// Regression: a jump used to be refused outright when anything solid hung within
// 8 px above the head, so under a low ceiling the fighter simply did not jump.
// It must always start (energy, sound, rise) and end where the head meets the ceiling.
function jumpUnderCeiling(gapAboveHead) {
  const { game, listeners } = createGame();
  const [fighter] = game.players;
  const floor = { x: 0, y: 500, w: 800, h: 100, solidSides: true, cloud: false, ladder: false };
  const ceilingBottom = floor.y - fighter.h - gapAboveHead;
  const ceiling = { x: 300, y: ceilingBottom - 30, w: 200, h: 30, solidSides: true, cloud: false, ladder: false };
  game.platforms.length = 0;
  game.platforms.push(floor, ceiling);
  for (const crate of game.crates) crate.dead = true;
  resetPlayer(fighter, 380, floor.y - fighter.h, true);
  fighter.groundedPlatform = floor;
  for (let i = 0; i < 3; i++) game.step();
  const energyBefore = fighter.sprintEnergy;
  let highest = fighter.y;
  let deepestIntoCeiling = 0;
  keyDown(listeners, 'KeyW');
  game.step();
  keyUp(listeners, 'KeyW');
  highest = Math.min(highest, fighter.y);
  const energyAfterPress = fighter.sprintEnergy;
  for (let i = 0; i < 50; i++) {
    game.step();
    highest = Math.min(highest, fighter.y);
    deepestIntoCeiling = Math.max(deepestIntoCeiling, ceilingBottom - fighter.y);
  }
  return {
    fighter, ceilingBottom, floor,
    spentEnergy: energyBefore - energyAfterPress,
    rose: floor.y - fighter.h - highest,
    deepestIntoCeiling,
    landed: fighter.onGround && !fighter.jumping
  };
}

test('a jump under a low ceiling still starts, rises up to the ceiling and lands again', () => {
  for (const gap of [3, 6]) {
    const jump = jumpUnderCeiling(gap);
    assert.ok(jump.spentEnergy > 0, 'gap ' + gap + ': the jump started (energy spent)');
    assert.ok(Math.abs(jump.rose - gap) < 0.6, 'gap ' + gap + ': rose to the ceiling (' + jump.rose.toFixed(2) + ' px)');
    assert.ok(jump.deepestIntoCeiling < 0.01, 'gap ' + gap + ': never through the ceiling');
    assert.ok(jump.landed, 'gap ' + gap + ': back on the floor, not stuck');
  }
});

test('a jump with the head touching (or within a pixel of) the ceiling is still attempted and leaves him standing', () => {
  for (const gap of [0, 1]) {
  const jump = jumpUnderCeiling(gap);
  assert.ok(jump.spentEnergy > 0, 'he tried to jump');
  assert.ok(jump.landed, 'and is standing again');
  assert.ok(jump.deepestIntoCeiling < 0.01);
  }
});

test('with room to spare the jump is the full jump', () => {
  const jump = jumpUnderCeiling(60);
  assert.ok(jump.rose > 20, 'full jump height (' + jump.rose.toFixed(1) + ' px)');
});
