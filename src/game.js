/**
 * Superfighters clone — Phase 1 base engine (Vanilla JS / Canvas 2D).
 *
 * Physics constants are extracted from the shipped game artifact
 * `Superfighters.js` (IceStone flex-ts-sdk build, game version 1.0.24,
 * sha256 e6c66c404fa8d4a037e0db46ee09bb638e8f9f040dde612b1e24107c6cc564ef).
 *
 * Extraction evidence (bounded identifier search, REA ev_5ee9ea272a0b...):
 * - Resolution:  GamepadData { gameWidth: 800, gameHeight: 600 };
 *                class Superfighters { baseWidth: 800, baseHeight: 600 };
 *                BitmapData defaults (800, 600).
 * - Frame rate:  SWF metadata frameRate="24" and asc compiler argument
 *                "default-frame-rate":"24"; the asc runtime throttles
 *                Stage.ENTER_FRAME to that rate (~24.3 logic ticks/s). The
 *                browser rAF render rate is 60 (requestAnimationFrameRate),
 *                which is only the render cadence, not the simulation rate.
 *                This port deliberately runs the extracted per-tick values at
 *                the 60 Hz step (fast mode, 2.5x the artifact's real time);
 *                TIME_SCALE = 1 documents that no slow-motion conversion is
 *                applied (see below).
 * - PlayerState class defaults (asc.clp$):
 *     PlayerGravity: 0.6, PlayerJumpPower: -5, PlayerJumpPushPower: -0.7,
 *     PlayerJumpPushTime: 4, PlayerWallJumpPower: -5, FallTriggerSpeed: 8.5,
 *     _runSpeed: 1.7, ClimbSpeed: 1.5, SlideSpeed: 3, RollSpeed: 2,
 *     DiveSpeed: 3.5, StaggerSpeed: 1, KickPower: 1.6, PunchGlideSpeed: 2,
 *     Mass: 0.7, _hp: 100, _airVelocityY: 0, _airVelocityX: 0, game_speed: 1.
 * - Integration: substepped loop —
 *     _ = ceil(TotalAirVelocity); if (_ <= 1) _ = 1;
 *     h = AirVelocityX * game_speed; c = AirVelocityY * game_speed;
 *     per substep: x += h/_; y += c/_;
 *                  if (!Climbing) { AirVelocityY += PlayerGravity * game_speed / _;
 *                                   h = AirVelocityX * game_speed;
 *                                   c = AirVelocityY * game_speed; }
 * - BeginJump:   AirVelocityY += PlayerJumpPower; Jumping = true;
 *                JumpPushTimeLeft = PlayerJumpPushTime; PlayerJumpPushEnabled = true.
 * - Airborne:    0 == AirVelocityY -> AirVelocityY = 0.1 (starts the fall).
 * - Air control: AirVelocityX += ±0.8 * RunSpeed per frame (edge-distance gated).
 *
 * Phase 2 additions (sprint + melee combo), same extraction method:
 * - RunSpeed getter: sprinting ? 2 * _runSpeed : _runSpeed  (3.4 px/tick in the
 *   artifact). This port tunes the base to 1.275 px/step, so sprint is 2.55.
 * - Sprint activation (Running setter): releasing a run arms _sprintActivationDuration = 3
 *   ticks; pressing a direction again within the window sprints (double-tap). The
 *   setter is direction-agnostic. Releasing a sprint arms
 *   _reSprintActivationDuration = 2 ticks (re-press sprints again immediately).
 *   The port has no dedicated sprint key: double-tap is the only sprint input.
 * - Energy (OnGround, game_speed=1): sprint-running drains 1.2/tick; regen +1/tick
 *   running, +2/tick idle, cap 100, floor 0 (setter clamps negative to 0).
 *   In fast mode that is 1.2/1/2 per step.
 * - DrainEnergy: JUMP 5, SPRINT_JUMP 12, SPRINT_DIVE 12, ROLL 5.
 * - Punch combo: 3 links. Pressing MELEE while punching past MinPunchComboFrame
 *   (6/7/8 per link) increments PunchComboNr (cap 3); Punching=false resets it to 1.
 * - Fists damage per link (HitPunchFrameDamage): 6/7/8. Hit stun: 3+5r / 4+5r / 5+5r.
 * - PunchPlayer: victim faces the attacker; aerial victim gets AirVelocityX += 2 * dir
 *   and Fall(); grounded victim is stunned on links 1-2. The completed combo
 *   (PunchComboNr == 3) or a lethal punch launches the victim:
 *   AirVelocityX = 3 * attacker dir, AirVelocityY = -2.5, then Fall()
 *   (port tuning: 4 / -3 to give the finisher a little more push).
 *   The ragdoll lands into Knockdowned (lying) and gets up when the recovery
 *   animation ends (AnimationDone clears Knockdowned).
 * - Combo 3 lunges forward at PunchGlideSpeed = 2, decaying with animation progress.
 * - BeingKicked: victim faces the kicker, AirVelocityX = 4 * dir, AirVelocityY = -2,
 *   50% knockdown vs stagger (we render flash only).
 *
 * Phase 3 additions (fall / knockdown / roll / stagger), same extraction method:
 * - Fall(t=true): arms ragdoll — drops grabs, direction keys add ±(RunSpeed-1) momentum;
 *   when called with t=false while Staggering, knocks back: AirVelocityX = -LastDirX *
 *   StaggerSpeed, AirVelocityY = -2. Sets Falling=true.
 * - StartStagger(t): OnGround + CanStagger -> Staggering=true, StaggerTimer = 6 + 8 *
 *   random (if below 6); otherwise falls. StaggerSpeed = 1.
 * - PlayerLands (from Falling): impact = abs(AirVelocityY) - 3, * 1.5, 0 if < 3 —
 *   HP -= impact; then BODYFALL + IncreaseKnockdownGrade + Falling=false +
 *   Knockdowned=true (lying on the ground).
 * - FallTriggerSpeed = 8.5 (extracted): landing at that downward speed applies
 *   the impact damage and the knockdown animation. Port deviation: the extracted
 *   mid-air ragdoll is deferred to the landing, so air steering stays until contact.
 * - Falling onto another grounded fighter (port design, requested): a hard landing
 *   (>= FallTriggerSpeed) centred over the other body deals FALL_ON_PLAYER_DAMAGE
 *   (6) and puts BOTH fighters into the knockdown/lying animation.
 * - AnimationDone clears Knockdowned and Rolling (recovery is animation-driven).
 * - Roll: Rolling=true + DrainEnergy("ROLL") = 5. RollSpeed = 2.
 * - Stagger movement (extracted): MovePlayer(LastDirX, LastDirX * StaggerSpeed) —
 *   the staggered body shuffles toward where it faces (toward the attacker).
 *
 * Phase 4 additions (melee weapons + jump-kick), same extraction method:
 * - Melee weapons (Range per combo link, fists HitPunchFrameDamage per link):
 *     fists:   Range [10, 11, 13], damage [6, 7, 8],  PickupRadius 0
 *     machete: Range [13, 13, 19], damage [8, 9, 10], PickupRadius 10
 *     axe:     Range [18, 18, 20], damage [11, 12, 13], PickupRadius 10
 *     sword:   Range [18, 18, 23], damage [13, 14, 15], PickupRadius 10
 * - PunchPlayer: victim Disarm() == CheckAimDrop(true) — ONLY affects AIMING states:
 *   AimMode 0 aborts ranged aim (gun falls), AimMode 1 drops a held throwable.
 *   Melee weapons are NOT dropped by punches (verified in artifact + user correction).
 * - Jump-kick: QueueJumpKick && Jumping && !JumpKickPerformed && AirbornTimer >= 2.5
 *   (AirbornTimer += game_speed while Jumping) -> Kick(!1, !0), one per air time.
 *
 * Phase 5 additions (firearms + grenades), same extraction method:
 * - RangedDown/RangedUp (FIRE press/release): holding arms Aiming with AimMode 0
 *   (grounded, not throwing); airborne arms _startAimASAP (aim on landing).
 *   Releasing with AimMode 0 calls FireWeapon() after BackToIdleTimer = 6.
 * - FireWeapon: gated by CurrentWeaponCooldown + DrawDelay; Ammo > 0 -> set
 *   WeaponCooldown + CurrentFireFrame = 1; else WeaponEmptyRecoil (click,
 *   EmptyWeaponRecoilBack = 2).
 * - ThrowDown/ThrowUp (THROW press/release): AimMode 1, ThrowTimer = 72 cooked
 *   while held; releasing sets Throwing = true and calls ReleaseThrowable().
 * - ReleaseThrowable: spawn at (MidX - 4.5*dir, MidY - 7.5), velocity =
 *   (5.5*cos(angle), 5.5*sin(angle) - 2), spin 10*dir, userData [ThrowTimer, owner],
 *   SetBullet(true); Ammo--.
 * - AbortAiming(e): on Ammo <= 0 || e (forced) the gun becomes a world item:
 *   forced drop velocity (-2*dir, -(2+2r)) [hit while aiming], empty toss (2*dir, -1).
 * - Firearm ProjectileData (Speed, Damage, Crit%, CritDmg, Pushback, ImpulseForce,
 *   WeaponCooldown, AccuracyDeflection):
 *     pistol 30/10/5/15/15/0.6/6/1
 *     rifle 35/8/6/10/20/0.45/6 - uzi 30/7/4/10/10/0.4/6
 *     magnum 40/25/40/35/50/1.05/8 - sniper 40/30/75/60/50/1.25/18
 * - Bullet movement (extracted): substeps n = round(TotalVel / 4) min 1, position
 *   += Vel * game_speed / n; walls stop the bullet (VelY = 0, VelX -> ±0.1).
 * - Grenade weapon: WeaponThrowableData(3) -> 3 grenades per pickup, ThrowTimer 72.
 * - Aim model (extracted, EXACT): UpperAimPitch/LowerAimPitch = ±90 (full vertical
 *   sweep). While aiming, KEY_UP -> AimUp(): pitch += speed, speed -= 2 (the pitch
 *   ACCELERATES at 2 deg/frame^2, clamped at -90); KEY_DOWN -> AimDown(): speed += 2,
 *   clamped at +90; none -> AimIdle: ResetChangePitchSpeed (the pitch FREEZES where
 *   it is). CurrentAimAngle = dir == 1 ? pitch : 180 - pitch (the artifact formula).
 *   Turning while aiming: AimTurningAround = true, scaleX/LastDirX flip,
 *   CurrentAimPitch = 0, speed = 0; RangedUp is BLOCKED while
 *   AimTurningAroundDelay (!!(_aimTurningAround || _aimTurningAroundTimer > 0)) —
 *   a release during the turn-around does not fire. BackToIdleTimer = 6 after firing.
 *   AimLazer originates at the weapon muzzle (ANIM_WPN + AIM_POSITION offsets).
 *
 * Phase 6 additions (death + slow-motion + bot AI), same extraction method:
 * - ActivateSlowmotion(t): returns true when the kill leaves a single fighting
 *   side (the round ends) -> AddSlowmotion(new SlowmoData(0, 48, 24, .2)):
 *   ramp 48 frames down to game_speed 0.2, then 24 frames back out.
 * - GibPlayer: chunk explosion + slowmo (gib boxes with random velocities,
 *   (6r-3, 3-4r)). KillPlayer is an empty stub in the artifact.
 * - Remove: Disarm + IgnorePlayer + Gone=true (the body leaves the round).
 * - Bot AI (artifact structure, simplified to the observed behaviors):
 *   SetBotKey drives the SAME key channels the human input uses. Artifact
 *   states: BotChooseTarget (+ threat evaluation Aim/Weapon/Weakness),
 *   BotCalculatePathGrid + BotStateFollowPath, BotStateMelee, BotStateShoot,
 *   BotStateAim (BotAimY), BotStateGrabWeapon / BotAutoPickupItem,
 *   BotDodgeBullet / BotDodgeRocket, BotRandomize, BotGoForReset. The clone
 *   implements: target choice, pursue (sprint when far — RunOften), jump at
 *   obstacles / when the target is above, melee combo at close range, aim+fire
 *   with pitch toward the target (BotAimY), grenade cooking, bullet dodging
 *   via roll, weapon pickup when unarmed — all driven through synthetic key
 *   events on the real input channels.
 *
 * Phase 7 additions (dive / tackle), same extraction method:
 * - Dive(): gated by CanDive (!CollisionHead - no dive under a ceiling);
 *   KeyTurnPlayer faces the pressed direction; ShortDiveAvailable ? DiveSpeed 1
 *   : 3.5; Diving = true; Jumping = true; AirVelocityX += LastDirX * DiveSpeed;
 *   AirVelocityY -= 3.
 * - Trigger: Sprinting + DOWN -> full dive (drains SPRINT_DIVE = 12); a
 *   double-tap arms ShortDiveAvailable for 3 ticks (short dive, no sprint).
 * - CheckDivePlayerImpact (per substep while diving): |midX diff| <= 8 and
 *   |midY diff| <= 10 -> the victim is CATCHED (tackled); two divers colliding
 *   triggers DiveCollision on BOTH: AirVelocityX = 3.5 * LastDirX, LastDirX
 *   flips, Falling = true.
 * - Dive impact damage (port design, requested): the diver takes 12 and the
 *   victim planted on the ground takes half (6); both flash. An airborne
 *   victim takes the full 12.
 * - PlayerLands while Diving -> Roll() - the fall-impact formula only lives in
 *   the Falling branch, so a dive landing NEVER takes fall damage.
 *
 * Wall collisions (extracted): bound__Walljump probes the edge at
 * x + PlayerEdgeDistance * dir, flips the facing, sets WallJumping = true and
 * AirVelocityY = PlayerWallJumpPower (-5), with a DUST particle. AbleToWalljump
 * only fires with |AirVelocityY| <= 3 (wall-slide speed). The artifact's
 * CollisionStatic / CollisionStaticCloud split defines ONE-WAY (cloud)
 * platforms: pass from below, land on top, no head bump, no side block.
 * - Cloud drop-through (KneelPressed, extracted): the first DOWN arms a 250 ms
 *   window; the second press sets _jumpDownPosYDisable = y + 10 and
 *   _performJumpDownLevel, so only that 10 px of cloud is passable and the
 *   fighter lands on the next red shelf instead of falling through the stack.
 *   DOWN is still read while rolling, so a roll can chain into the drop.
 *
 * Phase 8 additions (grab / drag / throw), same extraction method:
 * - The tackle CATCH IS THE GRAB: CheckDivePlayerImpact sets GrabbedPlayerNr
 *   (its setter auto-arms _grabbed_player) and calls the victim's
 *   GrabbedByOtherPlayer(true, dir).
 * - GrabbedByOtherPlayer(t, dir): dir != 0 flips the victim's LastDirX (faces
 *   the grabber); t=true: CheckAimDrop + CancelAFS + "GRABBED" animation;
 *   t=false: velocities zeroed AND Knockdowned = true (dropped bodies lie).
 * - UpdateGrabbedPlayer runs in the grabber's movement loop: the victim is
 *   pinned at (grabber.x + 6 * grabber.dir, grabber.y - 2) — dragged along.
 * - No throw-with-impulse is extractable as its own function; the throw
 *   reuses BeingKicked (AirVelocityX = 4 * dir, AirVelocityY = -2) and the
 *   "THROW" animation (ShowAnimation("THROW") appears in the build).
 *
 * Design choices (not extracted, ours to tune): player body 28x44, punch animation
 * length 18 frames per link, kick cooldown 24 frames, roll animation 16 frames,
 * lying animation 30 frames, roll trigger (DOWN while running), sprint = double-tap
 * a movement direction,
 * FIRE/THROW key bindings, bullet knockback 3*dir, crit = flat CriticalDamage bonus,
 * grenade explosion radius/falloff, muzzle flash, bullets ignore their shooter,
 * ammo on pickup, turn-around animation 8 frames, dead bodies stay lying (no
 * recovery while hp <= 0), round auto-restart 180 frames, bot decision cadence
 * 6-12 frames, bot toggle key B (P2).
 *
 * Design choices (not extracted, ours to tune): player body 28x44, punch animation
 * length 18 frames per link, kick cooldown 24 frames, roll animation 16 frames,
 * lying animation 30 frames, roll trigger (DOWN while running), sprint = double-tap
 * a movement direction,
 * FIRE/THROW key bindings, aim pitch speed/max (continuous pitch model extracted,
 * UpperAimPitch value not found), bullet knockback 3*dir (between punch 2 and kick 4),
 * crit = flat CriticalDamage bonus, grenade explosion radius/falloff, muzzle flash,
 * bullets ignore their shooter, ammo on pickup (pistol 8, grenade 3). *
 * Design choices (not extracted, ours to tune): player body 28x44, punch animation
 * length 18 frames per link, kick cooldown 24 frames, roll animation 16 frames,
 * lying animation 30 frames, roll trigger (DOWN while running), sprint = double-tap
 * a movement direction,
 * weapon pickups placed on platforms, Agent suit/tie colors, colors, HUD.
 *
 * Scale and camera (design choices): the fighter body, its melee boxes, and its
 * sprite are authored at 28x44 and rendered/collided at PLAYER_SIZE_SCALE (0.6).
 * The camera is a pure viewport transform over the unchanged level geometry: it
 * frames both fighters, zooming in when they close in and out when they separate.
 * Level coordinates, extraction values, and physics constants are untouched.
 *
 * Destructible glass (extracted from SOLID_GLASS_01): AddGlass anchors two
 * 5 hp panes. A punch/kick (Damage_Impact with resistance 10) or a bullet
 * (Damage_Bullet with resistance 10) breaks one in a single hit and spawns
 * GLASS_SHARD_1 pieces along the pane; explosions also shatter them. A new
 * round rebuilds the panes.
 */
(function () {
  'use strict';

  // ---------- Constants (extracted) ----------
  var GAME_WIDTH = 800;
  var GAME_HEIGHT = 600;
  var FPS = 60; // requestAnimationFrameRate = 60
  var STEP_MS = 1000 / FPS;

  // ---------- Simulation time base ----------
  // The artifact simulates at ~24 logic ticks/s (SWF frameRate="24").
  // This port keeps the extracted per-tick values as per-step values, so the
  // simulation advances one artifact tick per 60 Hz step (fast mode).
  // TIME_SCALE = 1 means no conversion is applied. It is kept as a named
  // constant so the rate can be changed in one place if needed.
  var TIME_SCALE = 1;
  var VEL_SCALE = TIME_SCALE; // 1
  var ACCEL_SCALE = TIME_SCALE * TIME_SCALE; // 1
  var TICKS_TO_STEPS = 1 / TIME_SCALE; // 1

  var PLAYER_GRAVITY = 0.6 * ACCEL_SCALE; // extracted PlayerGravity
  var PLAYER_JUMP_POWER = -5 * VEL_SCALE; // -5 px/tick -> -5 px/step
  var PLAYER_JUMP_PUSH_POWER = -0.7 * ACCEL_SCALE; // -0.7 px/tick per tick -> -0.7 px/step^2
  var PLAYER_JUMP_PUSH_TIME = 4 * TICKS_TO_STEPS; // 4 ticks -> 4 steps
  // Base run speed eased down 25% from the extracted 1.7 (requested). Sprint
  // stays 2x this value, so both paces drop by the same proportion.
  var PLAYER_RUN_SPEED = 1.7 * VEL_SCALE; // original extracted RunSpeed (1.7 px/tick)
  var AIR_CONTROL_FACTOR = 0.8; // proportional to RunSpeed, so it scales itself
  var AIR_FALL_MIN = 0.1 * VEL_SCALE; // 0.1 px/step
  var FALL_TRIGGER_SPEED = 8.5 * VEL_SCALE; // 8.5 px/step
  var FALL_ON_PLAYER_DAMAGE = 6; // design: a hard fall onto another fighter
  // Cloud drop-through (extracted KneelPressed): the first DOWN arms a 250 ms
  // window (15 steps at 60 Hz); the second press sinks the body 10 px before
  // cloud collisions come back, so exactly one red shelf is crossed.
  var CLOUD_DROP_WINDOW = 15;
  var CLOUD_DROP_CLEAR = 10;
  // ---------- Constants (extracted — sprint & melee combo) ----------
  var SPRINT_RUN_SPEED = 2 * PLAYER_RUN_SPEED; // RunSpeed getter: sprinting ? 2 * _runSpeed
  // Double-tap windows are input-feel choices expressed directly in 60 Hz steps.
  var SPRINT_ACTIVATION_WINDOW = 9; // 150 ms at 60 Hz
  var RESPRINT_WINDOW = 5; // 83 ms at 60 Hz
  var SPRINT_DRAIN = 1.2 * VEL_SCALE; // 1.2/step
  var REGEN_RUNNING = 1 * VEL_SCALE; // 1/step
  var REGEN_IDLE = 2 * VEL_SCALE; // 2/step
  var ENERGY_COST_JUMP = 5; // DrainEnergy("JUMP")
  var ENERGY_COST_SPRINT_JUMP = 12; // DrainEnergy("SPRINT_JUMP")
  // ---------- Combat cadence (24 fps artifact -> 60 Hz port) ----------
  // The artifact simulates at 24 logic fps; this port runs 1 tick per 60 Hz
  // step, so every animation-driven combat timing scales by 60/24 = 2.5 to
  // keep the original's real-time cadence (punches per second, stun windows,
  // recovery). Without this, the fight plays 2.5x faster than the original.
  var ANIM_TICKS_TO_STEPS = FPS / 24; // 2.5

  var COMBO_LINKS = 3; // PunchComboNr cap
  // Passive HP regen (extracted PlayerState): after HP_DAMAGE_REGEN_DELAY steps
  // without taking damage, HP recovers 0.1 per step (0.1 * game_speed).
  var HP_REGEN_RATE = 0.1 * VEL_SCALE;
  var HP_DAMAGE_REGEN_DELAY = 24 * 3 * TICKS_TO_STEPS; // 24 * 3 ticks -> 72 steps
  var COMBO_HIT_FRAME = [4, 5, 6].map(function (f) { return Math.round(f * ANIM_TICKS_TO_STEPS); }); // HitPunchComboFrame
  var COMBO_MIN_FRAME = [6, 7, 8].map(function (f) { return Math.round(f * ANIM_TICKS_TO_STEPS); }); // MinPunchComboFrame
  var COMBO_STUN_BASE = [3, 4, 5].map(function (f) { return Math.round(f * ANIM_TICKS_TO_STEPS); }); // + COMBO_STUN_RAND * random at the hit site
  var COMBO_STUN_RAND = Math.round(5 * ANIM_TICKS_TO_STEPS); // scaled 5-tick random window
  var TRADE_STUN = Math.round(2 * ANIM_TICKS_TO_STEPS); // trade loser stun
  var PUNCH_GLIDE_SPEED = 2; // combo 3 lunge (decays with progress)
  var KICK_DAMAGE = 4; // KickDamage (== JumpKickDamage)
  // Knockback velocities use the extracted per-tick values directly.
  var KICK_KNOCKBACK_X = 4 * VEL_SCALE; // BeingKicked: AirVelocityX = 4 * dir
  var KICK_KNOCKBACK_Y = -2 * VEL_SCALE; // BeingKicked: AirVelocityY = -2
  var PUNCH_AERIAL_KNOCKBACK = 2 * VEL_SCALE; // PunchPlayer: AirVelocityX += 2 * dir
  // Combo finisher knockback (extracted 3 / -2.5)
  var COMBO_KNOCKBACK_X = 3 * VEL_SCALE;
  var COMBO_KNOCKBACK_Y = -2.5 * VEL_SCALE;
  var STAGGER_SPEED = 1 * VEL_SCALE; // PlayerState.StaggerSpeed
  var STAGGER_BASE = 6; // StartStagger: StaggerTimer = 6 + 8 * random
  var STAGGER_RAND = 8;
  var ROLL_SPEED = 2; // PlayerState.RollSpeed (dodge burst; animation is 60 Hz)
  var ROLL_ENERGY_COST = 5; // DrainEnergy("ROLL")
  var JUMPKICK_AIRBORN_MIN = 2.5 * TICKS_TO_STEPS; // 2.5 ticks -> 6.25 steps

  // ---------- Constants (extracted — firearms & grenades) ----------
  var BULLET_SUBSTEP_PX = 4; // bullet substeps n = round(TotalVel / 4), min 1
  var AIM_SQUARE_DISTANCE = 8; // CalculateAimSquare's step budget (8 x 2px)
  var GUNS = {
    pistol: {
      kind: 'gun', name: 'Pistol', ammo: 8, speed: 20, damage: 10,
      critChance: 5, critDamage: 15, pushback: 15, impulseForce: 0.6,
      cooldown: 6, spread: 1, pellets: 1, shape: 'pistol',
      laserSight: false
    }
  };
  GUNS.sniper = {
    kind: 'gun', name: 'Sniper', ammo: 4, speed: 40, damage: 30,
    critChance: 75, critDamage: 60, pushback: 50, impulseForce: 1.25,
    cooldown: 18, spread: 0, pellets: 1, shape: 'pistol',
    laserSight: true // the ONLY LaserSight weapon in the build
  };
  var GRENADE = {
    name: 'Grenade', throwSpeed: 5.5, upBias: -2, throwTimer: 72, ammo: 3,
    radius: 90, damageMax: 30, damageMin: 5, shape: 'grenade'
  };
  // Health pickups (extracted WeaponPowerupData): Ammo IS the heal amount,
  // applied as HP += Ammo on pickup (clamped at 100 by the HP setter)
  // CRATE props (extracted AddBox "CRATE"): 14x14, BodyData hp 40, dynamic
  // (gravity), Kickable KickPower 1.7, PlayerFragile, AffectedByExplosions,
  // breaks into 3 debris pieces.
  var CRATE_SIZE = 20; // big enough to hide behind (the fighter is 16.8x26.4)
  var CRATE_HP = 20; // breaks after a couple of punches (fists deal 6/7/8)
  var CRATE_GRAVITY = PLAYER_GRAVITY;
  var CRATE_FRICTION = 0.85;
  var CRATE_BOUNCE = 0.35;
  var CRATE_KICK_POWER = 1.7;
  // Kick impulse on a crate (extracted Kick(): ApplyImpulse(dir*KickPower,
  // -KickPower) plus the (0,-0.4) contact push). KickPower 1.7 m/s with the
  // 30 px/m scale at 24 fps = 1.7*30/24 = 2.125 px/tick; total vertical
  // -(1.7+0.4)*30/24 = -2.625. Same screen distance as the original.
  var CRATE_KICK_PUSH_X = (1.7 * 30) / 24; // ≈ 2.125 px/step
  var CRATE_KICK_PUSH_Y = (-(1.7 + 0.4) * 30) / 24; // ≈ -2.625 px/step
  var HEALTH_PILLS = { kind: 'health', name: 'Pills', ammo: 25, shape: 'pills' };
  var HEALTH_MEDKIT = { kind: 'health', name: 'Medkit', ammo: 50, shape: 'medkit' };
  // AbortAiming drop velocities (extracted): forced [hit while aiming], empty [toss]
  var DROP_TOSS_FORCED = { vx: -2, vy: 2 + 2 }; // vx *= -dir
  var DROP_TOSS_EMPTY = { vx: 2, vy: -1 }; // vx *= dir

  // ---------- Constants (design choices — firearms) ----------
  var AIM_PITCH_MAX = 90; // extracted: UpperAimPitch/LowerAimPitch (both aim modes)
  var AIM_TURNAROUND_FRAMES = 8; // design: turn-around animation duration
  var BULLET_KNOCKBACK = 3 * VEL_SCALE; // between punch and kick, same per-tick units
  var BULLET_AERIAL_KNOCKBACK_MULT = 1.5;
  var GRENADE_EXPLOSION_FRAMES = 10; // visual ring duration

  // ---------- Constants (extracted — death & slow-motion) ----------
  var SLOWMO_RAMP_IN = 48; // SlowmoData(0, 48, 24, 0.2)
  var SLOWMO_RAMP_OUT = 24;
  var SLOWMO_SPEED = 0.2; // target game_speed

  // ---------- Constants (extracted — dive / tackle) ----------
  // Dive speed eased down from the extracted 3.5 (requested: less momentum).
  var DIVE_SPEED = 1.4 * VEL_SCALE; // PlayerState.DiveSpeed (full sprint dive)
  var DIVE_SPEED_SHORT = 0.7 * VEL_SCALE; // short dive (ShortDiveAvailable)
  var DIVE_HOP = -2 * VEL_SCALE; // AirVelocityY -= 2 on dive
  var SPRINT_DIVE_COST = 12; // DrainEnergy("SPRINT_DIVE")
  var TACKLE_ALIGN_X = 8; // CheckDivePlayerImpact: |midX diff| <= 8
  var TACKLE_ALIGN_Y = 10; // |midY diff| <= 10
  var DIVE_COLLISION_BOUNCE = 3.5 * VEL_SCALE; // DiveCollision: AirVelocityX = 3.5 * dir
  var SHORT_DIVE_WINDOW = 8; // _shortDiveTimer, expressed in 60 Hz steps
  // Dive impact damage (design choice, requested): only the tackled fighter
  // takes it; lowered from 12 so the catch itself does not decide the round.
  var DIVE_IMPACT_DAMAGE = 3;

  // ---------- Constants (extracted — wall collisions) ----------
  var EDGE_DISTANCE = 4; // PlayerState.PlayerEdgeDistance
  var WALL_SLIDE_MAX = 3 * VEL_SCALE; // AbleToWalljump's vertical-speed bound
  var WALLJUMP_VERTICAL = -5 * VEL_SCALE; // PlayerState.PlayerWallJumpPower
  var WALLJUMP_HORIZONTAL = PLAYER_RUN_SPEED; // WallJumpSpeed (= _runSpeed)
  var CLIMB_SPEED = 1.5 * VEL_SCALE; // PlayerState.ClimbSpeed

  // ---------- Constants (design choices — death, round & bot) ----------
  var ROUND_RESTART_FRAMES = 180; // auto-restart after a kill
  var BOT_TOGGLE_CODE = 'KeyB'; // P2 bot toggle
  var BOT_THINK_MIN = 6; // BotRandomize-ish decision cadence
  var BOT_THINK_RAND = 6;
  var BOT_MELEE_RANGE = 40;
  var BOT_SHOOT_MIN = 60;
  var BOT_SHOOT_MAX = 500;
  var BOT_SPRINT_DISTANCE = 220; // RunOften
  var BOT_PICKUP_RANGE = 150; // BotAutoPickupItem / BotStateGrabWeapon
  var BOT_DODGE_BULLET_PX = 90; // BotDodgeBullet trigger window
  var BOT_COOK_MIN = 20; // grenade cook frames
  var BOT_COOK_RAND = 20;

  // ---------- Constants (design choices) ----------
  var PLAYER_WIDTH = 28;
  var PLAYER_HEIGHT = 44;
  var PLAYER_SIZE_SCALE = 0.6; // the user-requested 40% smaller fighter body
  var PUNCH_ANIM_FRAMES = Math.round(12 * ANIM_TICKS_TO_STEPS); // PUNCH anim ≈ 12 artifact frames per link
  var PUNCH_RANGE = 16;
  var KICK_COOLDOWN = Math.round(8 * ANIM_TICKS_TO_STEPS); // extracted KickingCooldown = 8 ticks
  var KICK_RANGE = 20;
  var ROLL_ANIM_FRAMES = 16; // roll duration in frames
  var LYING_ANIM_FRAMES = 30; // knocked-down recovery length

  // ---------- Characters (original pixel-art design, Superfighters-style) ----------
  // The shipped build embeds its fighters as compiled MovieClips inside the Flash VM
  // bytecode — no extractable sprite sheets (NewSkin(e: MovieClip) system), and no
  // "Agent" name exists in the artifact's extractable data (26 hits are all
  // navigator.userAgent). "Agent" is our own Superfighters-style design: dark suit,
  // collar, tie and sunglasses. One roster entry per user request; P1/P2 differ by
  // tie color (design choice).
  var CHARACTERS = [
    {
      name: 'Agent', skin: '#e8b48a', hair: '#17171f', suit: '#23232e',
      pants: '#1a1a22', shoes: '#101014', tie: '#b03030'
    },
    {
      name: 'Agent', skin: '#dcae82', hair: '#17171f', suit: '#2a2a38',
      pants: '#1e1e28', shoes: '#101014', tie: '#3a7a8c'
    }
  ];

  // ---------- Melee weapons (extracted: Range + HitPunchFrameDamage per link) ----------
  var MELEE_WEAPONS = {
    fists: { kind: 'melee', name: 'Fists', range: [10, 11, 13], damage: [6, 7, 8], shape: null },
    machete: { kind: 'melee', name: 'Machete', range: [13, 13, 19], damage: [8, 9, 10], shape: 'machete' },
    axe: { kind: 'melee', name: 'Axe', range: [18, 18, 20], damage: [11, 12, 13], shape: 'axe' },
    sword: { kind: 'melee', name: 'Sword', range: [18, 18, 23], damage: [13, 14, 15], shape: 'sword' }
  };
  GUNS.pistol.kind = 'gun';

  GRENADE.kind = 'throwable';

  // Weapon pickups lying in the level (walk over to pick up)
  var weaponItems = [
    { weapon: MELEE_WEAPONS.machete, x: 200, y: 522, taken: false },
    { weapon: MELEE_WEAPONS.axe, x: 470, y: 484, taken: false },
    { weapon: MELEE_WEAPONS.sword, x: 650, y: 560, taken: false },
    { weapon: GUNS.pistol, x: 320, y: 522, taken: false },
    { weapon: GRENADE, x: 620, y: 484, taken: false }
  ];

  // Dynamic crates (extracted CRATE props; pushable, kickable, standable)
  var crates = [];
  function createCrate(x, yBottom) {
    var c = {
      x: x, y: yBottom - CRATE_SIZE, w: CRATE_SIZE, h: CRATE_SIZE,
      sx: x, sy: yBottom - CRATE_SIZE, // home spot: crates that fall off respawn here
      vx: 0, vy: 0, hp: CRATE_HP, angle: 0, spin: 0,
      resting: true, hp0: CRATE_HP
    };
    crates.push(c);
    return c;
  }
  var crateSpawns = [
    [38, 459], [58, 459], [48, 443], // stacked pair by the fence (no overlap)
    [330, 459], // by the right side of the outdoor floor
    [140, 352], // on the upper cloud shelf
    [464, 339], [488, 339], // first floor, left of the jail window
    [500, 339], [522, 339], // central platform
    [760, 261], // second floor
    [520, 249] // on the long upper ledge
  ];
  for (var _cs = 0; _cs < crateSpawns.length; _cs++) createCrate(crateSpawns[_cs][0], crateSpawns[_cs][1]);

  var crateRespawns = []; // { x, y, timer } — destroyed crates come back home
  var CRATE_RESPAWN_DELAY = 300; // 5 s at 60 Hz

  // Box2D-style contact: a moving crate resolves against both fighters.
  // Falling on a fighter knocks him down (BodyData CanKnockDownPlayer, crush
  // damage 0); sliding past shoves him; rising under him carries him.
  function crateHitsPlayer(c, p) {
    if (c.dead || p.hp <= 0) return;
    if (!rectsOverlap(p.getBounds(), c)) return;
    var overlapX = Math.min(p.x + p.w, c.x + c.w) - Math.max(p.x, c.x);
    var overlapY = Math.min(p.y + p.h, c.y + c.h) - Math.max(p.y, c.y);
    if (overlapY <= overlapX) {
      if (c.vy > 2 && !p.knockedDown) { // a real fall, not the ground micro-bounce
        // the crate falls on him (from above or onto his head): CanKnockDownPlayer
        // knocks him down and the crate slides past his side
        p.knockedDown = true;
        p.knockedDownFrame = 0;
        p.falling = false;
        p.jumping = false;
        p.rolling = false;
        p.diving = false;
        p.stunTimer = 0;
        p.airVelocityX = c.vx;
        p.airVelocityY = 0;
        p.x = (p.x + p.w / 2 < c.x + c.w / 2) ? c.x - p.w : c.x + c.w;
      } else if (p.y + p.h / 2 <= c.y + c.h / 2) {
        // the fighter is on top of the crate
        if (p.falling) {
          // PlayerLands on the crate: impact damage + Knockdowned, lying on it
          var cImp = Math.abs(p.airVelocityY) - 3;
          cImp *= 1.5;
          if (cImp < 3) cImp = 0;
          p.hp -= cImp;
          p.falling = false;
          p.jumping = false;
          p.airVelocityX = 0;
          p.airVelocityY = 0;
          p.knockedDown = true;
          p.knockedDownFrame = 0;
          p.y = c.y - p.h;
          p.onGround = true;
          p.groundedCrate = c;
          p.groundedPlatform = null;
        } else {
          // carried: stay glued to the crate's top and ride its motion
          p.y = c.y - p.h;
          if (p.airVelocityY > 0) p.airVelocityY = 0;
          p.onGround = true;
          p.groundedCrate = c;
          p.groundedPlatform = null;
          p.x += c.vx * 0.6;
        }
      } else {
        // the crate is over his head and not falling: shove him aside
        p.x = (p.x + p.w / 2 < c.x + c.w / 2) ? c.x - p.w : c.x + c.w;
      }
    } else {
      // lateral contact: the crate shoves him aside (no knockdown)
      p.x = (p.x + p.w / 2 < c.x + c.w / 2) ? c.x - p.w : c.x + c.w;
    }
  }

  // Spawn settle: lift a crate until it clears everything, then drop it onto
  // the first support below, so the scene opens with every crate in place
  // (no visible falling on the first frames).
  function crateHitsPlatform(c) {
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (plat.ladder) continue; // clouds hold props like everything else
      if (rectsOverlap(c, plat)) return plat;
    }
    return null;
  }

  function settleCrate(c) {
    var guard = 0;
    // unclip only against platforms (against crates it just stacks on top)
    while (guard++ < 800) {
      var plat = crateHitsPlatform(c);
      if (!plat) break;
      c.y -= 2;
    }
    // drop until it lands on a platform or snaps onto another crate's top
    var step = 1;
    guard = 0;
    while (guard++ < 400) {
      c.y += step;
      if (crateHitsPlatform(c)) {
        c.y -= step;
        if (step > 0.05) { step /= 2; continue; }
        break;
      }
      var stacked = null;
      for (var j = 0; j < crates.length; j++) {
        var o = crates[j];
        if (o === c || o.dead) continue;
        if (c.x < o.x + o.w && c.x + c.w > o.x &&
            c.y + c.h > o.y && c.y + c.h <= o.y + o.h &&
            c.y + c.h - step <= o.y + 0.05) { // was falling from above its top
          stacked = o;
          break;
        }
      }
      if (stacked) { c.y = stacked.y - c.h; break; }
    }
    c.vy = 0;
    c.resting = true;
  }

  function updateCrates() {
    for (var ri = crateRespawns.length - 1; ri >= 0; ri--) {
      var rq = crateRespawns[ri];
      rq.timer--;
      if (rq.timer <= 0) {
        settleCrate(createCrate(rq.x, rq.y));
        crateRespawns.splice(ri, 1);
      }
    }
    for (var i = crates.length - 1; i >= 0; i--) {
      var c = crates[i];
      if (c.dead) { crates.splice(i, 1); continue; }
      // The pit destroys the crate; it respawns at home after a delay
      if (c.y > 620) {
        breakCrate(c);
        crateRespawns.push({ x: c.sx, y: c.sy + CRATE_SIZE, timer: CRATE_RESPAWN_DELAY });
        crates.splice(i, 1);
        continue;
      }
      c.vy += CRATE_GRAVITY;
      var speed = Math.max(Math.abs(c.vx), Math.abs(c.vy));
      var steps = Math.max(1, Math.ceil(speed / 6));
      var grounded = false;
      for (var st = 0; st < steps; st++) {
        var prevBottom = c.y + c.h;
        c.x += c.vx / steps;
        c.y += c.vy / steps;
        // platform landings + solid sides (clouds hold props, only players drop through)
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.ladder) continue;
          var overlapX = c.x < plat.x + plat.w && c.x + c.w > plat.x;
          if (!overlapX) continue;
          var top = platformBoundaryForSpan(plat, c.x, c.x + c.w, false);
          if (c.vy >= 0 && top !== null && prevBottom <= top + 1e-7 && c.y + c.h >= top - 1e-7) {
            c.y = top - c.h;
            if (c.vy > 1.2) { c.vy = -c.vy * CRATE_BOUNCE; c.spin *= 0.5; }
            else c.vy = 0;
            c.vx *= 0.8;
            if (Math.abs(c.vx) < 0.05) c.vx = 0;
            grounded = true;
            continue;
          }
          // solid side push-out (crate flew into a wall)
          if (!plat.solidSides) continue;
          var prevInsideX = prevBottom - c.h < plat.x + plat.w && prevBottom - c.h + c.w > plat.x;
          var insideY = c.y < plat.y + plat.h && c.y + c.h > plat.y;
          if (prevInsideX && insideY) continue; // spawned overlapping; let vertical resolve
          if (insideY && top !== null && c.y + c.h > top + 1) {
            if (c.vx > 0 && c.x + c.w > plat.x && c.x < plat.x) { c.x = plat.x - c.w; c.vx = -c.vx * 0.4; }
            else if (c.vx < 0 && c.x < plat.x + plat.w && c.x + c.w > plat.x + plat.w) { c.x = plat.x + plat.w; c.vx = -c.vx * 0.4; }
          }
        }
        // invisible side walls: crates bounce off the map edges
        if (c.x < 0) { c.x = 0; c.vx = Math.abs(c.vx) * 0.4; }
        else if (c.x + c.w > GAME_WIDTH) { c.x = GAME_WIDTH - c.w; c.vx = -Math.abs(c.vx) * 0.4; }

        // crate-on-crate: land on top when falling from above
        for (var oi = 0; oi < crates.length; oi++) {
          var o = crates[oi];
          if (o === c || o.dead) continue;
          if (!(c.x < o.x + o.w && c.x + c.w > o.x)) continue;
          var oTop = o.y;
          var prevCBottom = prevBottom;
          if (c.vy >= 0 && prevCBottom <= oTop + 1e-7 && c.y + c.h >= oTop - 1e-7) {
            c.y = oTop - c.h;
            c.vy = 0;
            c.vx *= 0.8;
            grounded = true;
            o.vx += c.vx * 0.25; // weight transfer
          } else if (Math.abs(c.vx) > Math.abs(o.vx) + 0.01 && c.y + c.h > o.y + 2) {
            // ramming another crate sideways: transfer momentum and stop
            var cxEdge = (c.vx > 0) ? o.x - c.w : o.x + o.w;
            if ((c.vx > 0 && c.x > cxEdge) || (c.vx < 0 && c.x < cxEdge)) {
              c.x = cxEdge;
              o.vx += c.vx * 0.5;
              c.vx *= 0.5;
            }
          }
        }
      }
      // resting friction + settle rotation
      if (grounded) {
        c.vx *= CRATE_FRICTION;
        if (Math.abs(c.vx) < 0.05) c.vx = 0;
        c.spin *= 0.8;
        if (Math.abs(c.spin) < 0.01) c.spin = 0;
        if (c.vy === 0) {
          c.resting = true;
          c.angle *= 0.6;
          if (Math.abs(c.angle) < 0.02) c.angle = 0;
        }
      } else {
        c.resting = false;
        if (c.vy !== 0) c.angle += c.spin;
      }
      // resolve the moved crate against both fighters (Box2D contacts)
      crateHitsPlayer(c, player1);
      crateHitsPlayer(c, player2);
    }

    // Separate any overlapping crate pairs (3 passes: stacks resolve bottom-up
    // transitively). Vertical overlaps stack, horizontal ones push apart.
    for (var pass = 0; pass < 3; pass++) {
      for (var ai = 0; ai < crates.length; ai++) {
        for (var bi = ai + 1; bi < crates.length; bi++) {
          var ca = crates[ai], cb = crates[bi];
          if (ca.dead || cb.dead) continue;
          var ovX = Math.min(ca.x + ca.w, cb.x + cb.w) - Math.max(ca.x, cb.x);
          var ovY = Math.min(ca.y + ca.h, cb.y + cb.h) - Math.max(ca.y, cb.y);
          if (ovX <= 0 || ovY <= 0) continue;
          if (ovY <= ovX) {
            var upper = (ca.y + ca.h / 2 <= cb.y + cb.h / 2) ? ca : cb;
            var lower = (upper === ca) ? cb : ca;
            upper.y = lower.y - upper.h;
            if (upper.vy > 0) upper.vy = 0;
            upper.resting = true;
          } else {
            var moving = (Math.abs(ca.vx) >= Math.abs(cb.vx)) ? ca : cb;
            var other2 = (moving === ca) ? cb : ca;
            if (moving.x + moving.w / 2 < other2.x + other2.w / 2) moving.x = other2.x - moving.w;
            else moving.x = other2.x + other2.w;
            if (Math.abs(other2.vx) < Math.abs(moving.vx) * 0.5) {
              other2.vx += moving.vx * 0.5;
              moving.vx *= 0.5;
            }
          }
        }
      }
    }
  }

  function breakCrate(c) {
    if (c.dead) return;
    c.dead = true;
    // 3 debris pieces (extracted onDestruction spawns crate_debris_01..03)
    var debris = [[-3, -5], [4, -1], [-1, 5]];
    for (var d = 0; d < debris.length; d++) {
      glassShards.push({
        x: c.x + c.w / 2 + debris[d][0], y: c.y + c.h / 2 + debris[d][1],
        vx: c.vx + Math.random() * 4 - 2, vy: c.vy - Math.random() * 3,
        angle: Math.random() * Math.PI, spin: Math.random() * 0.3 - 0.15,
        size: 6 + Math.random() * 4, life: 30, color: '#c89050'
      });
    }
  }

  function damageCrate(c, amount, pushX, pushY) {
    if (c.dead) return;
    c.hp -= amount;
    c.vx += pushX; c.vy += pushY;
    c.spin += (pushX >= 0 ? 1 : -1) * 0.25;
    c.resting = false;
    if (c.hp <= 0) breakCrate(c);
  }

  function hitCratesInReach(attacker, reach, damage, pushX, pushY) {
    var dir = attacker.lastDirX;
    var hitBox = {
      x: dir > 0 ? attacker.x + attacker.w : attacker.x - reach,
      y: attacker.y,
      w: reach, h: attacker.h
    };
    for (var i = 0; i < crates.length; i++) {
      var c = crates[i];
      if (c.dead) continue;
      if (!rectsOverlap(hitBox, c)) continue;
      damageCrate(c, damage, dir * (pushX || 3), pushY || -2.5);
    }
  }

  // Phase 5 entities
  var bullets = []; // { x, y, vx, vy, damage, crit, owner, trail[] }
  var weaponRespawnTimer = 300;
  var grenades = []; // { x, y, vx, vy, fuse, spin }
  var explosions = []; // { x, y, radius, frame }
  var glassShards = []; // { x, y, vx, vy, angle, spin, size, life }

  // Phase 6: round + slow-motion + bot (extracted model)
  var gameSpeed = 1; // game_speed: slow-motion scales all simulation
  var roundOver = null; // { winnerId } or null
  var restartTimer = 0; // ROUND_RESTART_FRAMES countdown after a kill
  var botActive = false; // P2 driven by the bot
  var slowmoPhase = null; // { t: frames elapsed } during the round-end slowmo

  // ---------- Canvas ----------
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  // ---------- Optional player sprites (SVG shapes 592..634) ----------
  var spriteImages = Object.create(null);
  var spriteReady = false;
  var spriteTotal = 0, spriteLoaded = 0;
  var SPRITE_MAP = (typeof window !== 'undefined' && window.PLAYER_SPRITE_MAP) ? window.PLAYER_SPRITE_MAP : {};
  if (typeof Image !== 'undefined') {
    var _indices = [];
    for (var _i = 592; _i <= 634; _i++) _indices.push(_i);
    if (SPRITE_MAP) {
      for (var _k in SPRITE_MAP) {
        var _v = SPRITE_MAP[_k];
        if (Array.isArray(_v)) { for (var _j = 0; _j < _v.length; _j++) _indices.push(_v[_j]); }
        else _indices.push(_v);
      }
    }
    // unique
    var _seen = Object.create(null);
    var _uniq = [];
    for (var _u = 0; _u < _indices.length; _u++) {
      if (!_seen[_indices[_u]]) { _seen[_indices[_u]] = true; _uniq.push(_indices[_u]); }
    }
    for (var _si = 0; _si < _uniq.length; _si++) {
      (function (n) {
        var img = new Image();
        img.onload = function () { spriteLoaded++; if (spriteLoaded >= spriteTotal) spriteReady = true; };
        img.onerror = function () { spriteLoaded++; if (spriteLoaded >= spriteTotal) spriteReady = true; };
        spriteImages[n] = img;
        spriteTotal++;
        img.src = 'superfighters/shapes/' + n + '.svg';
      })(_uniq[_si]);
    }
  }

  function playerSpriteKey(p) {
    if (p.knockedDown) return 'knockedDown';
    if (p.rolling) return 'roll';
    if (p.diving) return 'dive';
    if (p.falling) return 'fall';
    if (p.punching) return 'attack';
    if (p.crouching) return (p.inCover && SPRITE_MAP['cover'] != null) ? 'cover' : 'crouch';
    if (p.aiming) return 'guard';
    if (p.kickFlash > 0) {
      if (!p.onGround || p.jumpKickPerformed || p.jumpKickQueued) return 'kickWithJump';
      return 'kick';
    }
    if (!p.onGround) return p.airVelocityY < 0 ? 'jump' : 'fall';
    if (p.pressDownKey && p.pressDownKey() && !p.running) return 'crouch';
    if (p.running) return p.sprinting ? 'run' : 'walk';
    return 'idle';
  }

  function drawPlayerSprite(p) {
    if (!spriteReady) return false;
    var key = playerSpriteKey(p);
    var entry = SPRITE_MAP[key];
    if (entry == null) return false;
    var frameIndex = 0;
    if (Array.isArray(entry)) {
      var divisor = (key === 'attack') ? 4 : 8;
      var counter = (key === 'attack') ? (p.punchFrame || 0) : (p.walkFrame || 0);
      frameIndex = Math.floor(counter / divisor) % entry.length;
    }
    var idx = Array.isArray(entry) ? entry[frameIndex] : entry;
    var img = spriteImages[idx];
    if (!img || !img.complete || !img.naturalWidth) return false;
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h);
    if (p.lastDirX < 0) ctx.scale(-1, 1);
    // Shared scale: every sprite keeps the idle sprite's pixel density so wide
    // frames (fall 19x19, dive 23x12) never render taller or wider than the body
    var SPRITE_BASE_HEIGHT = 21; // natural height of the idle sprite (592)
    var k = p.h / SPRITE_BASE_HEIGHT;
    var w = img.naturalWidth * k;
    var h = img.naturalHeight * k;
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
    return true;
  }

  // ---------- Input ----------
  var keys = Object.create(null);
  var keysJustPressed = Object.create(null);
  var keysJustReleased = Object.create(null);

  var PREVENT_DEFAULT_CODES = [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'
  ];

  window.addEventListener('keydown', function (e) {
    if (PREVENT_DEFAULT_CODES.indexOf(e.code) !== -1) e.preventDefault();
    if (e.code === BOT_TOGGLE_CODE) {
      botActive = !botActive; // toggle the P2 bot
      return;
    }
    if (!keys[e.code]) keysJustPressed[e.code] = true;
    keys[e.code] = true;
  });
  window.addEventListener('keyup', function (e) {
    if (keys[e.code]) keysJustReleased[e.code] = true;
    keys[e.code] = false;
  });
  window.addEventListener('blur', function () {
    for (var code in keys) keys[code] = false;
    for (code in keysJustReleased) delete keysJustReleased[code];
  });

  function consumeJustPressed(code) {
    if (keysJustPressed[code]) {
      keysJustPressed[code] = false;
      return true;
    }
    return false;
  }

  function consumeJustReleased(code) {
    if (keysJustReleased[code]) {
      keysJustReleased[code] = false;
      return true;
    }
    return false;
  }

  function clearJustPressed() {
    keysJustPressed = Object.create(null);
    keysJustReleased = Object.create(null);
  }

  // ---------- Platforms ----------
  function Platform(x, y, w, h, solidSides, cloud) {
    this.shape = 'rect';
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.solidSides = solidSides !== undefined ? solidSides : true;
    this.cloud = cloud || false; // one-way: pass from below, land on top
    this.oneWay = this.cloud;
  }

  // Police Station (map case 4, GenerateMapPoliceStation, inspected with REA).
  // The source mapArea is (105, -81, 800, 600); map coordinates are in pixels
  // after multiplying Box2D units by 30. CreateGroundBox adds 0.5 px to each
  // full dimension before building both the fixture and its visual box.
  var MAP_AREA = { x: 105, y: -81, width: GAME_WIDTH, height: GAME_HEIGHT };
  var TILE_COLLISION_PADDING = 0.5;
  var GROUND_SUPPORT_TOLERANCE = 1; // retain the engine's existing 1 px support probe

  function mapPointToCanvas(x, y) {
    return { x: x - MAP_AREA.x, y: y - MAP_AREA.y };
  }

  function Tile(mat, x, y, w, h, flag) {
    // x,y are source pixel centers; w,h are the original CreateGroundBox sizes.
    var paddedW = w + TILE_COLLISION_PADDING;
    var paddedH = h + TILE_COLLISION_PADDING;
    this.material = mat;
    this.x = x - MAP_AREA.x - paddedW / 2;
    this.y = y - MAP_AREA.y - paddedH / 2;
    this.w = paddedW;
    this.h = paddedH;
    this.shape = 'rect';
    this.flag = flag || 'NONE';
    this.solidSides = this.flag === 'NONE';
    this.cloud = this.flag === 'CLOUD';
    this.oneWay = this.cloud;
    this.ladder = this.flag === 'LADDER';
  }

  function PolygonPlatform(vertices, material, tiltValue) {
    this.shape = 'polygon';
    this.vertices = vertices;
    this.x = Infinity;
    this.y = Infinity;
    var right = -Infinity;
    var bottom = -Infinity;
    for (var i = 0; i < vertices.length; i++) {
      this.x = Math.min(this.x, vertices[i].x);
      this.y = Math.min(this.y, vertices[i].y);
      right = Math.max(right, vertices[i].x);
      bottom = Math.max(bottom, vertices[i].y);
    }
    this.w = right - this.x;
    this.h = bottom - this.y;
    this.material = material;
    this.flag = 'NONE';
    this.tiltValue = tiltValue;
    this.solidSides = true;
    this.cloud = false;
    this.oneWay = false;
    this.ladder = false;
  }

  function CirclePlatform(center, radius, material) {
    this.shape = 'circle';
    this.cx = center.x;
    this.cy = center.y;
    this.radius = radius;
    this.x = this.cx - radius;
    this.y = this.cy - radius;
    this.w = radius * 2;
    this.h = radius * 2;
    this.material = material;
    this.flag = 'NONE';
    this.solidSides = true;
    this.cloud = false;
    this.oneWay = false;
    this.ladder = false;
  }

  function GlassPane(center, width, height) {
    this.shape = 'rect';
    this.x = center.x - width / 2;
    this.y = center.y - height / 2;
    this.w = width;
    this.h = height;
    this.material = 'Glass';
    this.flag = 'NONE';
    this.solidSides = true;
    this.cloud = false;
    this.oneWay = false;
    this.ladder = false;
    this.glass = true;
    this.broken = false;
  }

  var platforms = [
    new Tile('Ground', 302.5, 413, 369, 70), // the lower-left floor
    new Tile('Ground', 590, 407, 230, 82), // the raised central floor
    // Ramp removed; pit covered by solid structure below.
    new Tile('Ground', 818.5, 416, 171, 64), // the right floor
    new Tile('Ground', 886, 372, 36, 24), // the block over the right floor
    new Tile('Ground', 876, 309, 56, 102), // the right wall, middle segment
    new Tile('Ground', 876, 117.5, 56, 233), // the right wall, top segment
    new Tile('Ground', 886, 246, 36, 24), // the right wall, seam block
    new Tile('Ground', 822, 163, 52, 34), // the elevated block, mid-right
    new Tile('Ground', 777, 174, 38, 12), // the ledge by the spawns (600,159)
    new Tile('Ground', 637.5, 174, 171, 12), // long upper ledge (5.7 m in the source)
    new Tile('Ground', 716.5, 200, 13, 40), // the hanging pillar
    new Tile('Ground', 725, 448, 20, 60), // cover the pit left of the lower door
    new Tile('Ground', 558.5, 201, 13, 42), // the second hanging pillar
    new Tile('Metal', 733, 192, 20, 2, 'CLOUD'), // the cloud shelves
    new Tile('Metal', 749.5, 215, 45, 2, 'CLOUD'),
    new Tile('Metal', 749.5, 237, 45, 2, 'CLOUD'),
    new Tile('Ground', 629, 276, 154, 36), // the big central platform
    new Tile('Ground', 777, 282, 142, 48), // the big right platform
    new Tile('Ground', 558.5, 312, 13, 36), // the pillar under the central platform
    new Tile('Ground', 712.5, 321, 13, 30), // the pillar under the right platform
    new Tile('Ground', 125, 341.5, 14, 73), // the post over the left floor
    new Tile('Metal', 240, 273, 38, 4, 'CLOUD'), // the high clouds
    new Tile('Metal', 307, 273, 38, 4, 'CLOUD'),
    new Tile('Metal', 273.5, 273, 13, 146, 'LADDER'), // the vertical ladder
    // Source CreateGroundCircle: radius 7/30 m + 0.5 px.
    new CirclePlatform(mapPointToCanvas(125, 301), 7.5, 'Metal'),
    new Tile('Ground', 663, 302.5, 8, 17), // the small block
    new Tile('Ground', 662.5, 359.5, 15, 13), // source width is 0.5 m
    new Tile('Ground', 877, -43.5, 58, 89), // the top-right corner frame
    new Tile('Metal', 230, 317, 58, 4, 'CLOUD')
  ];

  // AddGlass creates two hinged vertical panes. AddBox pads the source [length,3]
  // dimensions by 1 px before the body is created.
  var glassPanes = [
    new GlassPane(mapPointToCanvas(553.5, 239.5), 4, 38),
    new GlassPane(mapPointToCanvas(661, 325.5), 4, 32)
  ];
  platforms.push(glassPanes[0], glassPanes[1]);

  // Map portals (extracted: Police Station has two right-side door portals at the wall
  // recesses). PortalData(sourceRect, targetRect, triggerVelocity(1,0), allowPlayers=true,
  // inverseX=false). Teleport preserves vertical offset within the door and moves to the
  // target door's center; trigger only while moving in the door direction.
  var doorPortals = [
    { x: 848 - MAP_AREA.x, y: 228 - MAP_AREA.y, w: 20, h: 44, target: 1 }, // upper entrance
    { x: 848 - MAP_AREA.x, y: 344 - MAP_AREA.y, w: 20, h: 44, target: 0 }  // lower entrance
  ];

  // Player spawn points (extracted playerSpawns, 16 points)
  var playerSpawns = [
    { x: 79, y: 450 }, { x: 167, y: 451 }, { x: 263, y: 451 }, { x: 338, y: 451 },
    { x: 397, y: 437 }, { x: 466, y: 438 }, { x: 585, y: 439 }, { x: 645, y: 457 },
    { x: 716, y: 456 }, { x: 723, y: 331 }, { x: 570, y: 332 }, { x: 633, y: 330 },
    { x: 483, y: 331 }, { x: 495, y: 240 }, { x: 567, y: 241 }, { x: 677, y: 239 }
  ];

  // The 9 source anchors (AddHangingLamp(point, 20)); y is the rope anchor.
  function hangingLampAnchor(x, y) {
    var point = mapPointToCanvas(x, y);
    point.ropeLength = 20;
    return point;
  }
  var hangingLamps = [
    hangingLampAnchor(588, 180), hangingLampAnchor(635, 180), hangingLampAnchor(686, 180),
    hangingLampAnchor(795, 180), hangingLampAnchor(823, 180),
    hangingLampAnchor(739, 306), hangingLampAnchor(767, 306),
    hangingLampAnchor(796, 306), hangingLampAnchor(825, 306)
  ];

  // Source AddObject("LIFT_SMALL_01", 17.9, 12.1): its AddBox branch sets 25x6,
  // then the shared fixture builder adds 1 px to each full dimension (26x7).
  // CreateElevator(d, 183, .6) constrains it vertically with a .6 rad/s motor.
  // Without the original Box2D joints, use their derived 183 px travel as a
  // one-sided cosine approximation, not as an exact replay of the joint path.
  var elevatorCenter = mapPointToCanvas(17.9 * 30, 12.1 * 30);
  var elevator = {
    shape: 'rect',
    x: elevatorCenter.x - 13, y: elevatorCenter.y - 3.5, w: 26, h: 7,
    baseY: elevatorCenter.y - 3.5, travel: 183, omega: 0.6, t: 0,
    material: 'Metal', flag: 'ELEVATOR', solidSides: false,
    cloud: false, oneWay: true, ladder: false, elevator: true
  };
  platforms.push(elevator);

  // The original generator also makes 69 randomized AddObject placements
  // (crates, barrels, gas cans, furniture, lamps, and a propeller). This clone
  // has no matching object/destruction system or source sprites; do not invent
  // collision boxes for those props.

  // Weapon spawn points (extracted weaponSpawns, 6 points)
  var weaponSpawnPoints = [
    { x: 88, y: 454 }, { x: 412, y: 442 }, { x: 698, y: 460 },
    { x: 538, y: 334 }, { x: 514, y: 244 }
  ];

  function platformIsOneWay(plat) {
    return !!(plat.cloud || plat.oneWay);
  }

  function horizontalOverlap(left, right, plat) {
    return left < plat.x + plat.w && right > plat.x;
  }

  function pointInPolygon(x, y, vertices) {
    var inside = false;
    for (var i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      var a = vertices[i];
      var b = vertices[j];
      var crosses = (a.y > y) !== (b.y > y);
      if (crosses && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  }

  function polygonIntersectsRect(vertices, rect) {
    var axes = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
    var corners = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.w, y: rect.y },
      { x: rect.x + rect.w, y: rect.y + rect.h },
      { x: rect.x, y: rect.y + rect.h }
    ];
    for (var i = 0; i < vertices.length; i++) {
      var next = vertices[(i + 1) % vertices.length];
      var edgeX = next.x - vertices[i].x;
      var edgeY = next.y - vertices[i].y;
      axes.push({ x: -edgeY, y: edgeX });
    }
    for (var axisIndex = 0; axisIndex < axes.length; axisIndex++) {
      var axis = axes[axisIndex];
      var polyMin = Infinity;
      var polyMax = -Infinity;
      var rectMin = Infinity;
      var rectMax = -Infinity;
      for (var p = 0; p < vertices.length; p++) {
        var polyProjection = vertices[p].x * axis.x + vertices[p].y * axis.y;
        polyMin = Math.min(polyMin, polyProjection);
        polyMax = Math.max(polyMax, polyProjection);
      }
      for (var c = 0; c < corners.length; c++) {
        var rectProjection = corners[c].x * axis.x + corners[c].y * axis.y;
        rectMin = Math.min(rectMin, rectProjection);
        rectMax = Math.max(rectMax, rectProjection);
      }
      if (polyMax <= rectMin || rectMax <= polyMin) return false;
    }
    return true;
  }

  function rectsOverlap(a, b) {
    if (
      a.x >= b.x + b.w ||
      a.x + a.w <= b.x ||
      a.y >= b.y + b.h ||
      a.y + a.h <= b.y
    ) {
      return false;
    }
    if (b.shape === 'circle') {
      var closestX = Math.max(a.x, Math.min(b.cx, a.x + a.w));
      var closestY = Math.max(a.y, Math.min(b.cy, a.y + a.h));
      var dx = b.cx - closestX;
      var dy = b.cy - closestY;
      return dx * dx + dy * dy < b.radius * b.radius;
    }
    if (b.shape === 'polygon') return polygonIntersectsRect(b.vertices, a);
    return true;
  }

  function pointInPlatform(x, y, plat) {
    if (x < plat.x || x > plat.x + plat.w || y < plat.y || y > plat.y + plat.h) {
      return false;
    }
    if (plat.shape === 'circle') {
      var dx = x - plat.cx;
      var dy = y - plat.cy;
      return dx * dx + dy * dy < plat.radius * plat.radius;
    }
    if (plat.shape === 'polygon') return pointInPolygon(x, y, plat.vertices);
    return x > plat.x && x < plat.x + plat.w && y > plat.y && y < plat.y + plat.h;
  }

  function polygonBoundaryAtX(plat, x, lowerBoundary) {
    var ys = [];
    var vertices = plat.vertices;
    for (var i = 0; i < vertices.length; i++) {
      var a = vertices[i];
      var b = vertices[(i + 1) % vertices.length];
      var minX = Math.min(a.x, b.x);
      var maxX = Math.max(a.x, b.x);
      if (x < minX - 1e-7 || x > maxX + 1e-7) continue;
      if (Math.abs(b.x - a.x) < 1e-7) {
        if (Math.abs(x - a.x) < 1e-7) ys.push(a.y, b.y);
      } else {
        var t = (x - a.x) / (b.x - a.x);
        if (t >= -1e-7 && t <= 1 + 1e-7) ys.push(a.y + (b.y - a.y) * t);
      }
    }
    if (!ys.length) return null;
    var result = lowerBoundary ? -Infinity : Infinity;
    for (var j = 0; j < ys.length; j++) {
      result = lowerBoundary ? Math.max(result, ys[j]) : Math.min(result, ys[j]);
    }
    return result;
  }

  function platformBoundaryForSpan(plat, left, right, lowerBoundary) {
    if (!horizontalOverlap(left, right, plat)) return null;
    if (plat.shape !== 'polygon' && plat.shape !== 'circle') {
      return lowerBoundary ? plat.y + plat.h : plat.y;
    }
    if (plat.shape === 'circle') {
      var contactX = Math.max(left, Math.min(plat.cx, right));
      var dx = contactX - plat.cx;
      var offsetY = Math.sqrt(Math.max(0, plat.radius * plat.radius - dx * dx));
      return lowerBoundary ? plat.cy + offsetY : plat.cy - offsetY;
    }
    var overlapLeft = Math.max(left, plat.x);
    var overlapRight = Math.min(right, plat.x + plat.w);
    var candidates = [overlapLeft, overlapRight];
    for (var i = 0; i < plat.vertices.length; i++) {
      var vertexX = plat.vertices[i].x;
      if (vertexX >= overlapLeft && vertexX <= overlapRight) candidates.push(vertexX);
    }
    var boundary = lowerBoundary ? -Infinity : Infinity;
    for (var j = 0; j < candidates.length; j++) {
      var y = polygonBoundaryAtX(plat, candidates[j], lowerBoundary);
      if (y === null) continue;
      boundary = lowerBoundary ? Math.max(boundary, y) : Math.min(boundary, y);
    }
    return boundary === Infinity || boundary === -Infinity ? null : boundary;
  }

  // ---------- Player ----------
  function Player(id, x, y, charIndex, binding) {
    this.id = id;
    this.char = CHARACTERS[charIndex] || CHARACTERS[0];
    this.x = x;
    this.y = y;
    this.baseW = this.char.w || PLAYER_WIDTH;
    this.baseH = this.char.h || PLAYER_HEIGHT;
    this.w = this.baseW * PLAYER_SIZE_SCALE;
    this.h = this.baseH * PLAYER_SIZE_SCALE;

    // Input binding (e.code values)
    this.binding = binding;

    // PlayerState (extracted names kept where requested)
    this.airVelocityY = 0;
    this.airVelocityX = 0;
    this.onGround = true;
    this.groundedPlatform = null;
    this.lastDirX = 1;
    this.jumping = false;
    this.jumpPushTimeLeft = 0;
    this.falling = false;
    this.hp = 100;
    this.hpDamageTimer = 0; // blocks passive regen after taking a hit

    // Sprint state (extracted model)
    this.running = false;
    this.sprinting = false;
    this.walkFrame = 0;
    this.sprintEnergy = 100; // _sprintEnergy
    this.sprintArmed = 0; // _sprintActivationDuration
    this.reSprintWindow = 0; // _reSprintActivationDuration

    // Melee combo state (extracted model)
    this.stunTimer = 0;
    this.punching = false;
    this.punchFrame = 0;
    this.punchComboNr = 1; // _punchComboNr (1..3)
    this.punchQueued = false;
    this.punchHitPerformed = false;

    // Phase 3 state machine (extracted model)
    this.falling = false; // ragdoll: out of control until landing
    this.knockedDown = false; // lying on the ground (recovered by animation)
    this.knockedDownFrame = 0;
    this.crouching = false; // Kneel: holding DOWN standing still (cover pose)
    this.inCover = false; // crouched with the back flush against a crate
    this.crouchCrate = null; // the crate he is taking cover behind
    this.rolling = false;
    this.rollFrame = 0;
    this.staggering = false;
    this.staggerTimer = 0;

    // Phase 7: dive / tackle (extracted model)
    this.diving = false;
    this.shortDiveAvailable = false; // _shortDiveAvailable
    this.shortDiveTimer = 0; // _shortDiveTimer (3 frames after a double-tap)

    // Map portals (extracted Police Station doors)
    this.portalCooldown = 0;
    this._portalLocked = false;

    // Wall collisions (extracted model)
    this.wallJumping = false; // blocks re-jumps until landing
    this.wallPose = 0;
    this.climbing = false; // Climbing: on a ladder
    this.cloudDropArmed = 0; // double-DOWN arming window (frames)
    this.performJumpDown = false; // _performJumpDownLevel: clouds are passable
    this.jumpDownPosYDisable = 0; // _jumpDownPosYDisable: y where it clears

    // Phase 4: weapons + jump-kick (extracted model)
    this.equipped = MELEE_WEAPONS.fists;
    this.airbornTimer = 0; // AirbornTimer += game_speed while Jumping
    this.softLandingTimer = 0;
    this.jumpKickPerformed = false; // one jump-kick per air time
    this.jumpKickQueued = false;

    // Phase 5: ranged/throwable slots + aiming (extracted model)
    this.ranged = null; // { gun, ammo } — CurrentRangeWeapon
    this.throwable = { ammo: GRENADE.ammo }; // { ammo } — CurrentThrowableWeapon (3 grenades by default)
    this.aiming = false;
    this.aimMode = 0; // 0 = firearm, 1 = throwable
    this.aimPitch = 0; // degrees, negative = up
    this.aimPitchSpeed = 0; // CurrentChangePitchSpeed (accelerates ±2/frame^2)
    this.aimTurningAround = false;
    this.aimTurningAroundTimer = 0;
    this.throwTimer = 0; // cooked fuse while aiming a grenade
    this.startAimASAP = false; // _startAimASAP
    this.weaponCooldown = 0; // CurrentWeaponCooldown
    this.muzzleFlash = 0;

    // Attack state
    this.kickCooldown = 0;
    this.kickFlash = 0;
    this.hitFlash = 0;
  }

  Player.prototype.getBounds = function () {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  };

  Player.prototype.pointInPortal = function (x, y, p) {
    return x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h;
  };

  Player.prototype.getTargetPos = function (targetPortal, sourcePortal, x, y) {
    // Matches extracted GetTargetPositionFromCurrent (preserves vertical offset)
    return {
      x: targetPortal.x + targetPortal.w / 2,
      y: targetPortal.y + (y - sourcePortal.y)
    };
  };

  Player.prototype.pressLeft = function () {
    return !!keys[this.binding.left];
  };

  Player.prototype.pressRight = function () {
    return !!keys[this.binding.right];
  };

  Player.prototype.pressUp = function () {
    return !!keys[this.binding.up];
  };

  Player.prototype.pressDownKey = function () {
    return !!keys[this.binding.down];
  };

  Player.prototype.justUp = function () {
    return consumeJustPressed(this.binding.up);
  };

  Player.prototype.justPunch = function () {
    return consumeJustPressed(this.binding.punch);
  };

  Player.prototype.justKick = function () {
    return consumeJustPressed(this.binding.kick);
  };

  Player.prototype.consumeDown = function () {
    return consumeJustPressed(this.binding.down);
  };

  Player.prototype.drainEnergy = function (cost) {
    this.sprintEnergy -= cost;
    if (this.sprintEnergy < 0) this.sprintEnergy = 0; // setter clamps at 0
  };

  // HP setter (extracted): dead fighters take no further damage, and any hit
  // that lowers HP arms the regen block (24*3 steps without healing)
  Player.prototype.damage = function (amount) {
    if (this.hp <= 0) return;
    if (amount < this.hp) this.hpDamageTimer = HP_DAMAGE_REGEN_DELAY;
    this.hp -= amount;
    if (this.hp <= 0) this.hp = 0;
    if (this.hp > 100) this.hp = 100;
  };

  Player.prototype.beginJump = function () {
    // BeginJump: blocked under a low ceiling (extracted: CollisionHead(-2) gate)
    var probe = this.getBounds();
    probe.y -= 8;
    for (var i = 0; i < platforms.length; i++) {
      // The clouds have no ceiling (the build's CollisionHead ignores the cloud
      // layer) and the LADDER is not a ceiling either
      if (platformIsOneWay(platforms[i]) || platforms[i].ladder) continue;
      if (rectsOverlap(probe, platforms[i])) return; // head would hit
    }
    // BeginJump: AirVelocityY += PlayerJumpPower
    this.airVelocityY += PLAYER_JUMP_POWER;
    this.groundedPlatform = null;
    this.jumping = true;
    this.jumpPushTimeLeft = PLAYER_JUMP_PUSH_TIME;
    // DrainEnergy: sprinting jumps cost SPRINT_JUMP, otherwise JUMP
    this.drainEnergy(this.sprinting ? ENERGY_COST_SPRINT_JUMP : ENERGY_COST_JUMP);
    if (this.sprintEnergy <= 0) this.sprinting = false;
  };

  Player.prototype.meleeConnects = function (other) {
    // Extracted MeleeStrike sweep: the punch raycasts from the fighter's CENTER
    // (MidPosX + dir * 4 .. MeleeWeaponRange, at MidPosY - 4) — this is why
    // fully overlapped fighters still hit each other in the original.
    var reach = this.equipped.range[this.punchComboNr - 1] * PLAYER_SIZE_SCALE;
    var cy = this.y + this.h / 2 - 4;
    var b = other.getBounds();
    for (var d = 4; d <= reach; d += 2) {
      var sx = this.x + this.w / 2 + this.lastDirX * d;
      if (sx > b.x && sx < b.x + b.w && cy > b.y && cy < b.y + b.h) return true;
    }
    return false;
  };

  // MeleeStrike trade (extracted): when BOTH fighters connect on the same
  // frame, only the higher PlayerNr side resolves it — a coin flip decides
  // who lands the punch; the loser eats a 2-frame stun instead.
  Player.prototype.punchTradeWith = function (other) {
    if (!other || other.hp <= 0) return false;
    if (other.id <= this.id) return false; // only the higher number resolves
    if (!other.punching || other.punchHitPerformed) return false;
    if (other.punchFrame + 1 < COMBO_HIT_FRAME[other.punchComboNr - 1]) return false;
    if (!this.meleeConnects(other)) return false;
    var theirReach = other.equipped.range[other.punchComboNr - 1] * PLAYER_SIZE_SCALE;
    var theirBox = {
      x: other.lastDirX > 0 ? other.x + other.w : other.x - theirReach,
      y: other.y + 8 * PLAYER_SIZE_SCALE,
      w: theirReach,
      h: 20 * PLAYER_SIZE_SCALE
    };
    return rectsOverlap(theirBox, this.getBounds());
  };

  // PunchPlayer (extracted): damage, stun, and the three launch cases
  Player.prototype.applyPunch = function (other) {
    var wasDead = other.hp <= 0;
    // PunchPlayer: victim faces the attacker; aimed weapons drop (CheckAimDrop)
    if (other.aiming) other.abortAiming(true);
    other.lastDirX = -this.lastDirX;
    if (other.jumping) {
      // Jumping victim: AirVelocityX += 2 * attacker dir, then Fall()
      other.airVelocityX += PUNCH_AERIAL_KNOCKBACK * this.lastDirX;
      other.falling = true;
    } else {
      // Grounded victim: stun on links 1 and 2 (combo 3 launches below)
      other.stunTimer = COMBO_STUN_BASE[this.punchComboNr - 1] + COMBO_STUN_RAND * Math.random();
    }
    // Damage only applies to a live victim (HP -= damage gated on HP > 0)
    if (other.hp > 0) {
      other.damage(this.equipped.damage[this.punchComboNr - 1]); // fists 6/7/8
      other.hitFlash = 6;
    }

    // Launch case 1: a lethal punch on a RUNNING/SPRINTING victim sends them
    // flying in THEIR OWN facing direction (dead man's momentum)
    if (other.hp <= 0 && !wasDead && (other.running || other.sprinting)) {
      other.airVelocityX = other.lastDirX * 3;
      other.airVelocityY = -2.5;
      other.falling = true;
    } else if (this.punchComboNr === COMBO_LINKS || other.hp <= 0) {
      // Launch case 2: completed 3-hit combo (or a lethal punch) launches the
      // victim: AirVelocityX = 3 * attacker dir, AirVelocityY = -2.5, Fall().
      // The ragdoll lands into Knockdowned (lying) and gets up after recovery.
      other.airVelocityX = COMBO_KNOCKBACK_X * this.lastDirX;
      other.airVelocityY = COMBO_KNOCKBACK_Y;
      other.falling = true;
    }
    // Launch case 3: any lethal punch on a standing victim also tips them over
    if (other.hp <= 0 && !other.knockedDown && !this.falling) {
      other.airVelocityX = this.lastDirX * 2;
      other.airVelocityY = -2.5;
      other.falling = true;
    }
    if (other.falling) {
      other.onGround = false;
      other.groundedPlatform = null;
      other.jumping = false;
      other.knockedDown = false;
      other.knockedDownFrame = 0;
      other.stunTimer = 0;
    }
  };

  Player.prototype.tryPunchHit = function (other) {
    if (!other) return;
    if (other.rolling) return; // rolling dodges melee
    if (other.knockedDown && other.onGround) return; // no beat-down on a lying body
    if (!this.meleeConnects(other)) return;
    if (this.punchTradeWith(other)) {
      // The swing is spent either way; the coin flip picks the winner
      if (Math.random() < 0.5) this.applyPunch(other);
      else this.stunTimer = TRADE_STUN;
      return;
    }
    this.applyPunch(other);
  };

  // NOTE (verified in the artifact): the artifact's Disarm() is CheckAimDrop(true) —
  // it only affects AIMING states: AimMode 0 aborts ranged-weapon aim (the gun falls),
  // AimMode 1 drops a held throwable. Melee weapons are never dropped by punches.

  Player.prototype.dropGunItem = function (forced) {
    // AbortAiming: the gun becomes a world item (forced: tossed behind the owner)
    var vx, vy;
    if (forced) {
      vx = DROP_TOSS_FORCED.vx * this.lastDirX;
      vy = -DROP_TOSS_FORCED.vy * (1 + Math.random());
    } else {
      vx = DROP_TOSS_EMPTY.vx * this.lastDirX;
      vy = DROP_TOSS_EMPTY.vy;
    }
    weaponItems.push({
      weapon: this.ranged.gun,
      ammo: this.ranged.ammo,
      x: this.x + this.w / 2,
      y: this.y + this.h,
      taken: false,
      pickupDelay: 30, // grace before re-grab (anti ping-pong)
      vx: vx,
      vy: vy,
      ttl: forced ? 0 : 45 // empty gun disappears shortly after being tossed
    });
    this.ranged = null;
  };

  Player.prototype.abortAiming = function (forced) {
    // CheckAimDrop(true): AimMode 0 drops the gun (empty or forced);
    // AimMode 1 cancels a held grenade.
    this.aiming = false;
    this.startAimASAP = false;
    if (this.aimMode === 0) {
      if (this.ranged && (this.ranged.ammo <= 0 || forced)) this.dropGunItem(forced);
    }
    this.aimMode = 0;
    this.aimPitch = 0;
  };

  Player.prototype.fireWeapon = function () {
    // FireWeapon: cooldown gate; empty -> the gun is tossed forward (AbortAiming
    // drop with Ammo <= 0); else cooldown + bullets + ammo--
    if (this.weaponCooldown > 0 || !this.ranged) return;
    var gun = this.ranged.gun;
    if (this.ranged.ammo <= 0) {
      this.dropGunItem(false); // empty toss: (2*dir, -1)
      return;
    }
    this.weaponCooldown = gun.cooldown;
    this.muzzleFlash = 2;
    var alpha = (this.aimPitch * Math.PI) / 180;
    var dir = this.lastDirX;
    var muzzleX = dir > 0 ? this.x + this.w + 6 : this.x - 6;
    var muzzleY = this.y + 16;
    for (var i = 0; i < gun.pellets; i++) {
      var deflection = ((Math.random() * 2 - 1) * gun.spread * Math.PI) / 180;
      var speed = gun.speed;
      bullets.push({
        x: muzzleX,
        y: muzzleY,
        vx: Math.cos(alpha + deflection) * speed * dir,
        vy: Math.sin(alpha + deflection) * speed,
        damage: gun.damage,
        critDamage: gun.critDamage,
        crit: Math.random() * 100 < gun.critChance,
        owner: this.id,
        trail: []
      });
    }
    this.ranged.ammo--;
    if (this.ranged.ammo <= 0) {
      // Empty gun is tossed forward and disappears (Superfighters behavior)
      this.dropGunItem(false);
      this.aiming = false;
      this.aimPitch = 0;
      this.aimPitchSpeed = 0;
    }
  };

  Player.prototype.releaseThrowable = function () {
    // ReleaseThrowable: 5.5 px/frame along the aim angle with -2 up bias
    if (!this.throwable || this.throwable.ammo <= 0) {
      this.aiming = false;
      return;
    }
    var alpha = (this.aimPitch * Math.PI) / 180;
    var dir = this.lastDirX;
    grenades.push({
      x: this.x + this.w / 2 - 4.5 * dir,
      y: this.y + this.h / 2 - 7.5,
      vx: GRENADE.throwSpeed * Math.cos(alpha) * dir,
      vy: GRENADE.throwSpeed * Math.sin(alpha) + GRENADE.upBias,
      fuse: this.throwTimer,
      spin: 0
    });
    this.throwTimer = 0;
    this.throwable.ammo--;
    this.aiming = false;
  };

  Player.prototype.onLadder = function () {
    // The ladder touch (extracted): the CENTER POINT (MidPosX/MidPosY) inside
    // the ladder's band - the body-overlap version hijacked jump starts beside
    // the ladder
    var cx = this.x + this.w / 2;
    var cy = this.y + this.h / 2;
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (!plat.ladder) continue;
      if (cx > plat.x && cx < plat.x + plat.w && cy > plat.y && cy < plat.y + plat.h) {
        return true;
      }
    }
    return false;
  };

  Player.prototype.wallContact = function (dir) {
    // Edge-edge probe (extracted): the facing edge + EDGE_DISTANCE ahead
    var ex = this.x + (dir > 0 ? this.w + EDGE_DISTANCE : -EDGE_DISTANCE);
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (platformIsOneWay(plat) || plat.ladder || !plat.solidSides) continue;
      if (rectsOverlap({ x: ex - 0.5, y: this.y, w: 1, h: this.h }, plat)) {
        return true;
      }
    }
    // The level's own walls
    return (dir > 0 && this.x + this.w >= GAME_WIDTH - 1) ||
      (dir < 0 && this.x <= 1);
  };

  Player.prototype.tryWalljump = function () {
    // Walljump (extracted): flip the facing, Sprinting = false,
    // WallJumping = true, AirVelocityY = PlayerWallJumpPower; WallJumpSpeed
    // (= _runSpeed) pushes away from the wall
    if (this.onGround || this.wallJumping) return false;
    var dir = this.pressLeft() ? -1 : this.pressRight() ? 1 : this.lastDirX;
    if (!this.wallContact(dir)) return false;
    this.lastDirX = -dir;
    this.sprinting = false;
    this.wallJumping = true;
    this.airVelocityY = WALLJUMP_VERTICAL;
    this.airVelocityX = -dir * WALLJUMP_HORIZONTAL; // away from the wall
    this.wallPose = 10;
    return true;
  };

  Player.prototype.calculateAimSquare = function (other) {
    // CalculateAimSquare (extracted): cast a ray from the muzzle in 2px steps
    // up to AIM_SQUARE_DISTANCE (8) steps; stops at platforms, players, or the
    // world's edge - the aim square floats at the last clear point
    var alpha = (this.aimPitch * Math.PI) / 180;
    var dx = Math.cos(alpha) * this.lastDirX;
    var dy = Math.sin(alpha);
    var cx = this.lastDirX > 0 ? this.x + this.w + 6 : this.x - 6;
    var cy = this.y + 16;
    var otherBox = other ? other.getBounds() : null;
    for (var s = 0; s < AIM_SQUARE_DISTANCE; s++) {
      var nx = cx + dx * 2;
      var ny = cy + dy * 2;
      if (nx < 0 || nx > GAME_WIDTH || ny < 0 || ny > GAME_HEIGHT) break;
      var blocked = false;
      for (var i = 0; i < platforms.length; i++) {
        var plat = platforms[i];
        if (pointInPlatform(nx, ny, plat)) {
          blocked = true;
          break;
        }
      }
      if (!blocked && otherBox && rectsOverlap({ x: nx - 1, y: ny - 1, w: 2, h: 2 }, otherBox)) {
        blocked = true;
      }
      if (blocked) break;
      cx = nx;
      cy = ny;
    }
    return { x: cx, y: cy };
  };

  Player.prototype.canDive = function () {
    // CanDive (extracted): !CollisionHead() — no dive under a ceiling;
    // the cloud layer is ignored (same as beginJump's head probe)
    var probe = this.getBounds();
    probe.y -= 6;
    for (var i = 0; i < platforms.length; i++) {
      if (platformIsOneWay(platforms[i]) || platforms[i].ladder) continue;
      if (rectsOverlap(probe, platforms[i])) return false;
    }
    return true;
  };

  Player.prototype.startDive = function (short) {
    // Dive (extracted): KeyTurnPlayer already handled by the movement dir;
    // DiveSpeed = ShortDiveAvailable ? 1 : DiveSpeed (tuned to 2.0 here);
    // Diving = Jumping = true; AirVelocityX += LastDirX * DiveSpeed;
    // AirVelocityY -= 3.
    var speed = short ? DIVE_SPEED_SHORT : DIVE_SPEED;
    this.diving = true;
    this.jumping = true;
    this.onGround = false;
    this.groundedPlatform = null;
    this.airVelocityX += this.lastDirX * speed;
    this.airVelocityY += DIVE_HOP;
  };

  Player.prototype.diveCollision = function () {
    // DiveCollision (extracted): two divers clash — bounce, flip, ragdoll
    this.airVelocityX = DIVE_COLLISION_BOUNCE * this.lastDirX;
    this.lastDirX = -this.lastDirX;
    this.falling = true;
    this.diving = false;
  };

  Player.prototype.checkDiveImpact = function (other) {
    // CheckDivePlayerImpact (extracted, runs per substep while diving):
    // |midX diff| <= 8 and |midY diff| <= 10 over an overlapping body
    if (!this.diving || this.grabbedPlayerNr) return;
    var myCx = this.x + this.w / 2;
    var theirCx = other.x + other.w / 2;
    var myCy = this.y + this.h / 2;
    var theirCy = other.y + other.h / 2;
    if (Math.abs(myCx - theirCx) > TACKLE_ALIGN_X) return;
    if (Math.abs(myCy - theirCy) > TACKLE_ALIGN_Y) return;
    if (!rectsOverlap(this.getBounds(), other.getBounds())) return;
    if (other.diving) {
      // DIVE CATCH: both divers bounce (mutual DiveCollision)
      other.diveCollision();
      this.diveCollision();
      return;
    }
    // DIVE IMPACT (requested): only the tackled fighter takes damage.
    other.damage(DIVE_IMPACT_DAMAGE);
    other.hitFlash = 6;
    // TACKLE CATCH: the victim is GRABBED and dragged along the dive
    // (extracted: GrabbedPlayerNr auto-arms _grabbed_player + GRABBED anim)
    if (this.hp > 0) {
      this.grabbedPlayerNr = other.id;
      other.grabbedByPlayer(this);
    }
  };

  // TakingCover (extracted): find the ground-level crate to take cover behind.
  // Moving toward it: within a step's reach. Standing still: any side within
  // the roll distance (walk+S must end in cover, not be stolen by the roll).
  Player.prototype.findCoverCrate = function (dir) {
    var myFeet = this.y + this.h;
    var best = null, bestGap = 1e9;
    for (var i = 0; i < crates.length; i++) {
      var c = crates[i];
      if (c.dead) continue;
      if (Math.abs((c.y + c.h) - myFeet) > 6) continue; // cover is ground level
      var gapR = c.x - (this.x + this.w); // crate ahead when moving right
      var gapL = this.x - (c.x + c.w); // crate ahead when moving left
      // Magnetize only when ALREADY touching the crate (within 6 px); from
      // farther away, pressing DOWN while running is a roll, not cover.
      var gap = -1;
      if (dir > 0 && gapR >= -2 && gapR <= 6) gap = gapR;
      else if (dir < 0 && gapL >= -2 && gapL <= 6) gap = gapL;
      else if (dir === 0) {
        if (gapR >= -2 && gapR <= 6) gap = gapR;
        else if (gapL >= -2 && gapL <= 6) gap = gapL;
      }
      if (gap >= 0 && gap < bestGap) { best = c; bestGap = gap; }
    }
    return best;
  };

  // Slide the fighter flush against the crate face (2 px/step, no teleport)
  Player.prototype.snapToCover = function (c, dir) {
    var crateRight = c.x >= this.x + this.w - 2;
    var crateLeft = (c.x + c.w) <= this.x + 2;
    var target;
    if (crateLeft) target = c.x + c.w;
    else if (crateRight) target = c.x - this.w;
    else if (dir > 0) target = c.x - this.w;
    else target = c.x + c.w;
    if (this.x < target) this.x = Math.min(target, this.x + 2);
    else if (this.x > target) this.x = Math.max(target, this.x - 2);
  };

  Player.prototype.checkFallOnPlayer = function (other) {
    // A hard fall that lands on top of a grounded fighter: the lower fighter
    // takes a little damage and both collapse into the knockdown animation.
    if (!other || other.hp <= 0 || !other.onGround || other.grabbedBy) return;
    var myCx = this.x + this.w / 2;
    var theirCx = other.x + other.w / 2;
    if (Math.abs(myCx - theirCx) > TACKLE_ALIGN_X) return;
    // Same support level: a landing on a higher shelf must not hit someone below.
    if (Math.abs(this.y + this.h - (other.y + other.h)) > TACKLE_ALIGN_Y) return;
    other.damage(FALL_ON_PLAYER_DAMAGE);
    other.hitFlash = 6;
    if (other.aiming) other.abortAiming(true);
    other.stunTimer = 0;
    other.staggering = false;
    other.punching = false;
    other.rolling = false;
    other.rollFrame = 0;
    other.diving = false;
    other.falling = false;
    other.jumping = false;
    other.airVelocityX = 0;
    other.airVelocityY = 0;
    other.knockedDown = true;
    other.knockedDownFrame = 0;
  };

  Player.prototype.grabbedByPlayer = function (grabber) {
    // GrabbedByOtherPlayer(true, dir): CheckAimDrop + CancelAFS + "GRABBED";
    // the victim faces the grabber and loses all control (dragged)
    this.grabbedBy = grabber;
    this.lastDirX = -grabber.lastDirX;
    this.airVelocityX = 0;
    this.airVelocityY = 0;
    this.stunTimer = 0;
    this.staggering = false;
    this.rolling = false;
    this.punching = false;
    this.diving = false;
    this.knockedDown = false; // lifted off the floor: no longer lying
    this.knockedDownFrame = 0;
    this.jumpPushTimeLeft = 0;
    if (this.aiming) this.abortAiming(true);
    this.onGround = false;
    this.groundedPlatform = null;
  };

  Player.prototype.dropGrabbed = function (launched) {
    // DropGrabbedPlayer (extracted): release the held victim.
    // launched=true throws them (BeingKicked: 4*dir, -2); otherwise they land
    // Knockdowned with zeroed velocities.
    var victim = this.grabbedVictim();
    this.grabbedPlayerNr = 0;
    if (!victim) return;
    victim.grabbedBy = null;
    if (launched) {
      victim.airVelocityX = KICK_KNOCKBACK_X * this.lastDirX; // 4 * dir
      victim.airVelocityY = KICK_KNOCKBACK_Y; // -2
      victim.onGround = false;
      victim.groundedPlatform = null;
      victim.falling = true; // ragdoll -> lands -> Knockdowned
    } else {
      // DropGrabbedPlayer (extracted): UpdateGrabbedPlayer(true) puts the
      // victim on the grabber's coordinates; GrabbedByOtherPlayer(false)
      // zeroes the velocities and sets Knockdowned. Do NOT snap to a fixed
      // floor Y: the normal landing collision has to settle the body on the
      // surface it was actually dropped over, or raised platforms are skipped.
      victim.x = this.x;
      victim.y = this.y;
      victim.airVelocityX = 0;
      victim.airVelocityY = 0;
      victim.knockedDown = true; // extracted: dropped bodies lie
      victim.knockedDownFrame = 0;
      victim.falling = false;
      victim.jumping = false;
    }
  };

  Player.prototype.grabbedVictim = function () {
    return this.grabbedPlayerNr === 1 ? player1 : this.grabbedPlayerNr === 2 ? player2 : null;
  };

  Player.prototype.startStagger = function () {
    // StartStagger: OnGround + CanStagger -> stagger (timer 6 + 8 * random).
    // The successful stagger does NOT touch velocity in the artifact; the
    // backward drift formula only applies when the stagger fails (Fall(false)).
    this.staggering = true;
    if (this.staggerTimer < STAGGER_BASE) {
      this.staggerTimer = STAGGER_BASE + STAGGER_RAND * Math.random();
    }
  };

  Player.prototype.aimUp = function (t) {
    // AimUp (extracted): accelerate the pitch upward, clamp at -90
    if (this.aimPitch > -AIM_PITCH_MAX) {
      if (t !== 0) this.aimPitchSpeed = -t;
      if (this.aimPitchSpeed > 0) this.aimPitchSpeed = 0;
      this.aimPitch += this.aimPitchSpeed; // game_speed = 1
      this.aimPitchSpeed -= 2;
      if (this.aimPitch < -AIM_PITCH_MAX) this.aimPitch = -AIM_PITCH_MAX;
    }
  };

  Player.prototype.aimDown = function (t) {
    // AimDown (extracted): accelerate the pitch downward, clamp at +90
    if (this.aimPitch < AIM_PITCH_MAX) {
      if (t !== 0) this.aimPitchSpeed = t;
      if (this.aimPitchSpeed < 0) this.aimPitchSpeed = 0;
      this.aimPitch += this.aimPitchSpeed; // game_speed = 1
      this.aimPitchSpeed += 2;
      if (this.aimPitch > AIM_PITCH_MAX) this.aimPitch = AIM_PITCH_MAX;
    }
  };

  Player.prototype.turnAround = function (d) {
    // AimLeft/AimRight (extracted): flip facing, reset the pitch, block firing
    this.aimTurningAround = true;
    this.aimTurningAroundTimer = AIM_TURNAROUND_FRAMES;
    this.lastDirX = d;
    this.aimPitch = 0;
    this.aimPitchSpeed = 0;
    this.muzzleFlash = 0;
  };

  Player.prototype.aimTurningAroundDelay = function () {
    // Extracted getter: !!(aimTurningAround || aimTurningAroundTimer > 0)
    return !!this.aimTurningAround || this.aimTurningAroundTimer > 0;
  };

  Player.prototype.tryKickHit = function (other) {
    // Same reason as tryPunchHit: the kick box follows the scaled body/leg.
    var kickReach = KICK_RANGE * PLAYER_SIZE_SCALE;
    var hitBox = {
      x: this.lastDirX > 0 ? this.x + this.w : this.x - kickReach,
      y: this.y + this.h - 24 * PLAYER_SIZE_SCALE,
      w: kickReach,
      h: 20 * PLAYER_SIZE_SCALE
    };
    if (!rectsOverlap(hitBox, other.getBounds())) return;
    if (other.rolling) return; // rolling dodges melee
    if (other.knockedDown && other.onGround) return; // no beat-down on a lying body
    // BeingKicked: aimed weapons drop; victim faces the kicker, then 50% knockdown
    if (other.aiming) other.abortAiming(true);
    other.lastDirX = -this.lastDirX;
    other.airVelocityX = KICK_KNOCKBACK_X * this.lastDirX;
    other.airVelocityY = KICK_KNOCKBACK_Y;
    other.onGround = false;
    other.groundedPlatform = null;
    other.damage(KICK_DAMAGE); // KickDamage == JumpKickDamage: 4
    other.hitFlash = 6;
    // Extracted BeingKicked: the victim ALWAYS goes down from the kick —
    // knockback (4, -2) plus Fall() (the ragdoll lands into Knockdowned)
    other.falling = true;
  };

  Player.prototype.breakGlassInReach = function (legsOnly) {
    // KickHit sweeps the fighter's own height. The body is scaled to 0.6 but
    // the extracted panes keep their original size, so a punch must still
    // cover head-high glass (the pane by the pit hangs above the floor).
    var reach = (legsOnly ? KICK_RANGE : this.equipped.range[this.punchComboNr - 1]) *
      PLAYER_SIZE_SCALE;
    var boxH = legsOnly ? 24 * PLAYER_SIZE_SCALE : this.h + 4;
    var boxY = legsOnly ? this.y + this.h - boxH : this.y - 2;
    var box = {
      x: this.lastDirX > 0 ? this.x + this.w : this.x - reach,
      y: boxY,
      w: reach,
      h: boxH
    };
    for (var i = platforms.length - 1; i >= 0; i--) {
      var plat = platforms[i];
      if (plat.glass && !plat.broken && rectsOverlap(box, plat)) breakGlassPane(plat);
    }
  };

  Player.prototype.clampToPlatformsX = function () {    // Horizontal resolution for the lunge: side collisions + level bounds
    var bounds = this.getBounds();
    for (var pi = 0; pi < platforms.length; pi++) {
      var plat = platforms[pi];
      if (platformIsOneWay(plat) || plat.ladder || !plat.solidSides) continue;
      if (rectsOverlap(bounds, plat)) {
        var surfaceY = platformBoundaryForSpan(plat, this.x, this.x + this.w, false);
        if (surfaceY !== null && this.y + this.h <= surfaceY + GROUND_SUPPORT_TOLERANCE) {
          continue;
        }
        // Push out through the shallower side
        var fromLeft = Math.abs(this.x + this.w - plat.x);
        var fromRight = Math.abs(plat.x + plat.w - this.x);
        if (fromLeft < fromRight) this.x = plat.x - this.w;
        else this.x = plat.x + plat.w;
        bounds = this.getBounds();
      }
    }
    if (this.x < 0) this.x = 0;
    if (this.x > GAME_WIDTH - this.w) this.x = GAME_WIDTH - this.w;
  };

  Player.prototype.update = function (other) {
    // Dragged by a grabber: pinned to their front (extracted UpdateGrabbedPlayer:
    // x + 6 * dir, y - 2) - no own physics, no input
    if (this.grabbedBy) {
      var gr = this.grabbedBy;
      this.x = gr.x + gr.w + 6 * gr.lastDirX;
      this.y = gr.y - 2;
      if (this.throwPose > 0) this.throwPose--;
      return;
    }
    var frameStartX = this.x;
    var groundedAtFrameStart = this.onGround;
    var startingGroundPlatform = this.groundedPlatform;
    if (this.kickCooldown > 0) this.kickCooldown--;
    if (this.kickFlash > 0) this.kickFlash--;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.stunTimer > 0) this.stunTimer--; // _stunTimer -= game_speed
    if (this.softLandingTimer > 0) this.softLandingTimer--;
    if (this.portalCooldown > 0) this.portalCooldown--;
    if (this.staggering) {
      this.staggerTimer--;
      if (this.staggerTimer <= 0) this.staggering = false;
    }

    // Input gating: stun / ragdoll / lying / rolling / DEAD lock the player
    var locked =
      this.falling || this.knockedDown || this.rolling || this.diving || this.hp <= 0;
    var controllable = this.stunTimer <= 0 && !locked;
    // The DOWN just-press feeds two features (roll/dive and cloud drop-through).
    // Consume it ONCE: reading it twice made the second read always false, so
    // double-DOWN could never arm the drop-through.
    // A roll still reads DOWN: that is how a roll can chain into a cloud drop.
    var downPressed = (controllable || this.rolling) && this.consumeDown();
    var dir = 0;
    if (controllable) {
      if (this.pressLeft()) dir -= 1;
      if (this.pressRight()) dir += 1;
    }

    // TakingCover intent (extracted): holding DOWN while there is a ground-level
    // crate ahead (or one already at the back) takes cover instead of rolling.
    this.crouchCrate = null;
    if (controllable && this.pressDownKey() && this.hp > 0 &&
        !this.aiming && !this.falling && !this.knockedDown && !this.climbing) {
      this.crouchCrate = this.findCoverCrate(dir);
    }

    // Roll / dive disambiguation (DOWN key):
    //   running + NOT sprinting -> roll (extracted Roll, costs 5)
    //   sprinting + DOWN -> full dive / tackle (DiveSpeed 2.0, costs 12)
    //   double-tap window (ShortDiveTimer > 0) + DOWN -> short dive (speed 1)
    // NOT while aiming: the aiming stance owns the DOWN key (pitch sweep)
    if (this.shortDiveTimer > 0) this.shortDiveTimer--;
    if (
      controllable &&
      !this.aiming &&
      downPressed &&
      this.onGround &&
      !this.rolling &&
      !this.diving &&
      !this.onLadder() &&
      !this.crouchCrate
    ) {
      if (this.sprinting) {
        this.drainEnergy(SPRINT_DIVE_COST);
        this.startDive(false);
      } else if (this.shortDiveTimer > 0) {
        this.shortDiveTimer = 0;
        this.drainEnergy(ROLL_ENERGY_COST);
        this.startDive(true);
      } else if (this.running) {
        this.drainEnergy(ROLL_ENERGY_COST);
        this.rolling = true;
        this.rollFrame = 0;
      }
    }

    // ---------- Sprint state machine (extracted Running setter model) ----------
    // Faithful to the artifact: the setter is DIRECTION-AGNOSTIC. Releasing a
    // run arms _sprintActivationDuration (3 ticks); pressing a direction again
    // while it is warm sets Sprinting and arms the short dive
    // (_shortDiveAvailable, _shortDiveTimer = 3 ticks). Releasing a sprint arms
    // _reSprintActivationDuration (2 ticks) so the next press sprints again.
    var wasRunning = this.running;
    this.running = dir !== 0;
    if (this.sprintArmed > 0) this.sprintArmed--;
    if (this.reSprintWindow > 0) this.reSprintWindow--;
    if (this.running && !wasRunning) {
      if (this.reSprintWindow > 0) {
        // Re-press right after a sprint: sprint again immediately
        this.reSprintWindow = 0;
        this.sprintArmed = 0;
        this.sprinting = true;
      } else if (this.sprintArmed > 0) {
        // Double-tap within the activation window
        this.sprintArmed = 0;
        this.sprinting = true;
        this.shortDiveAvailable = true;
        this.shortDiveTimer = SHORT_DIVE_WINDOW;
      }
    } else if (!this.running) {
      if (this.sprinting) {
        this.sprinting = false;
        this.reSprintWindow = RESPRINT_WINDOW;
      } else if (wasRunning && !this.jumping) {
        this.sprintArmed = SPRINT_ACTIVATION_WINDOW;
      }
    }
    // Sprint ends when movement stops or energy is gone
    if (this.sprinting && (dir === 0 || this.sprintEnergy <= 0)) this.sprinting = false;

    // ---------- Energy drain / regen (OnGround, game_speed = 1) ----------
    // Passive HP regen (extracted): heal 0.1/step once no damage was taken for
    // HP_DAMAGE_REGEN_DELAY steps. The extracted HP setter refuses every write
    // while dead (_hp <= 0 -> return), so a downed fighter never self-revives.
    if (this.hp > 0 && this.hp < 100 && this.hpDamageTimer <= 0) {
      this.hp += HP_REGEN_RATE * gameSpeed;
      if (this.hp > 100) this.hp = 100;
    } else if (this.hpDamageTimer > 0) {
      this.hpDamageTimer -= gameSpeed;
    }
    if (this.onGround) {
      if (this.sprinting && this.running) {
        this.sprintEnergy -= SPRINT_DRAIN;
        if (this.sprintEnergy <= 0) {
          this.sprintEnergy = 0;
          this.sprinting = false;
        }
      } else if (this.sprintEnergy < 100) {
        this.sprintEnergy += this.running ? REGEN_RUNNING : REGEN_IDLE;
        if (this.sprintEnergy > 100) this.sprintEnergy = 100;
      }
    }

    // Walk cycle counter, advanced once per simulation step.
    if (this.running && this.onGround) this.walkFrame += TIME_SCALE;
    else this.walkFrame = 0;

    // ---------- Aiming (extracted RangedDown/Up + ThrowDown/Up model) ----------
    if (this.weaponCooldown > 0) this.weaponCooldown--;
    if (this.muzzleFlash > 0) this.muzzleFlash--;

    var aimingControllable = controllable && !this.punching;
    // Ragdoll / stunned while aiming: forced drop (the gun falls behind you)
    if (this.aiming && !aimingControllable) this.abortAiming(true);

    var aimingControllable = controllable && !this.punching;
    if (aimingControllable && this.onGround && this.startAimASAP) {
      this.startAimASAP = false; // aim starts ASAP on landing
      if (this.ranged) {
        this.aiming = true;
        this.aimMode = 0;
      } else if (this.throwable && this.throwable.ammo > 0) {
        this.aiming = true;
        this.aimMode = 1;
        this.throwTimer = GRENADE.throwTimer;
      }
    }
    if (this.aiming) {
      // Turn-around first: flipping resets the pitch and blocks firing
      if (this.pressLeft() && this.lastDirX === 1) this.turnAround(-1);
      else if (this.pressRight() && this.lastDirX === -1) this.turnAround(1);
      // Pitch: UP key sweeps up, DOWN sweeps down — the artifact's model:
      // the pitch change ACCELERATES 2 deg/frame^2 and freezes on release
      if (this.aimTurningAroundDelay()) {
        this.aimTurningAroundTimer--;
        if (this.aimTurningAroundTimer <= 0) this.aimTurningAround = false;
      } else if (this.pressDownKey()) {
        this.aimDown(0);
      } else if (this.pressUp()) {
        this.aimUp(0);
      } else {
        this.aimPitchSpeed = 0; // AimIdle: ResetChangePitchSpeed
      }
      // LEFT/RIGHT turn the aim direction only
      if (this.pressLeft()) this.lastDirX = -1;
      if (this.pressRight()) this.lastDirX = 1;
      // Aim square (extracted AimLazer: _aim_mc floats near the muzzle)
      this.aimSquare = this.calculateAimSquare(other);
      // Grenade fuse cooks while held; zero -> explodes in your hand
      if (this.aimMode === 1) {
        this.throwTimer--;
        if (this.throwTimer <= 0) {
          this.throwTimer = 0;
          explodeGrenade(this.x + this.w / 2, this.y + this.h / 2, null);
          this.aiming = false;
          this.throwable.ammo--;
        }
      }
    }
    // FIRE press: RangedDown (grounded arms the aim; airborne arms startAimASAP)
    if (aimingControllable && consumeJustPressed(this.binding.fire)) {
      if (this.onGround) {
        if (!this.aiming && this.ranged) {
          this.aiming = true;
          this.aimMode = 0;
        }
      } else {
        this.startAimASAP = true;
      }
    }
    // FIRE release: RangedUp -> FireWeapon (AimMode 0). BLOCKED during the
    // turn-around (extracted: a release while turning does not fire).
    if (this.aiming && this.aimMode === 0 && consumeJustReleased(this.binding.fire)) {
      if (!this.aimTurningAroundDelay()) {
        this.fireWeapon();
        // BackToIdleTimer: the aim stance returns to idle after the shot
        this.aiming = false;
        this.aimPitch = 0;
        this.aimPitchSpeed = 0;
      }
    }
    // THROW press: ThrowDown
    if (aimingControllable && consumeJustPressed(this.binding.throw)) {
      if (this.onGround) {
        if (!this.aiming && this.throwable && this.throwable.ammo > 0) {
          this.aiming = true;
          this.aimMode = 1;
          this.throwTimer = GRENADE.throwTimer;
        }
      } else {
        this.startAimASAP = true;
      }
    }
    // THROW release: ThrowUp -> ReleaseThrowable (AimMode 1)
    if (this.aiming && this.aimMode === 1 && consumeJustReleased(this.binding.throw)) {
      this.releaseThrowable();
    }

    // ---------- Grabbing: throw on MELEE, forced drops on lock ----------
    if (this.grabbedPlayerNr) {
      var held = this.grabbedVictim();
      if (
        !held ||
        held.hp <= 0 ||
        held.falling ||
        held.knockedDown ||
        this.falling ||
        this.knockedDown ||
        this.stunTimer > 0 ||
        this.hp <= 0
      ) {
        this.dropGrabbed(false); // extracted auto-drops (Fall/Stun/Death)
      } else {
        // Drag refresh (extracted UpdateGrabbedPlayer runs in the loop)
        held.x = this.x + this.w + 6 * this.lastDirX;
        held.y = this.y - 2;
        var throwPressed = controllable && this.justPunch();
        if (throwPressed) {
          // THROW: launch the held victim (BeingKicked reaction) + THROW pose
          this.throwPose = 8;
          this.dropGrabbed(true);
        }
      }
    }

    // ---------- Melee input (combo chain + kick) ----------
    var meleePressed = controllable && this.justPunch();
    if (meleePressed && this.aiming) {
      // MELEE while aiming aborts the aim (no punch)
      this.abortAiming(false);
    } else if (meleePressed) {
      // Extracted Melee(): airborne MELEE queues the jump kick (executes once
      // AirbornTimer >= 2.5); there is no dedicated kick key anymore.
      if (this.jumping && !this.onGround) {
        this.jumpKickQueued = true;
      } else if (this.punching) {
        // Chaining: press again past the link's minimum animation frame
        // (extracted MinPunchComboFrame, separate from the hit frame)
        if (
          this.punchFrame >= COMBO_MIN_FRAME[this.punchComboNr - 1] &&
          this.punchComboNr < COMBO_LINKS
        ) {
          this.punchQueued = true;
          this.punchComboNr++;
          this.punchHitPerformed = false; // setter resets the hit flag per link
        }
      } else if (this.kickCooldown <= 0) {
        // Extracted: with no enemy in melee range, MELEE tries a KICK on
        // nearby kickable objects (crates) before falling back to a punch
        var kickReach = KICK_RANGE * PLAYER_SIZE_SCALE;
        var kickBox = {
          x: this.lastDirX > 0 ? this.x + this.w : this.x - kickReach,
          y: this.y,
          w: kickReach, h: this.h
        };
        var kickTarget = null;
        for (var kci = 0; kci < crates.length; kci++) {
          var kc = crates[kci];
          if (!kc.dead && rectsOverlap(kickBox, kc)) { kickTarget = kc; break; }
        }
        if (kickTarget && !this.meleeConnects(other)) {
          this.kickCooldown = KICK_COOLDOWN;
          this.kickFlash = KICK_COOLDOWN;
          damageCrate(kickTarget, KICK_DAMAGE, this.lastDirX * CRATE_KICK_PUSH_X, CRATE_KICK_PUSH_Y);
          this.breakGlassInReach(true);
        } else {
          this.punching = true;
          this.punchFrame = 0;
          this.punchQueued = false;
          this.punchHitPerformed = false;
        }
      } else if (!this.punching) {
        // Extracted: the kick cooldown only blocks KICKS — keep pressing MELEE
        // and the punch combo starts flowing right after the crate kick
        this.punching = true;
        this.punchFrame = 0;
        this.punchQueued = false;
        this.punchHitPerformed = false;
      }
    }
    if (
      this.jumpKickQueued &&
      this.jumping &&
      !this.jumpKickPerformed &&
      this.airbornTimer >= JUMPKICK_AIRBORN_MIN
    ) {
      this.jumpKickQueued = false;
      this.jumpKickPerformed = true;
      this.kickFlash = KICK_COOLDOWN;
      this.tryKickHit(other);
      this.breakGlassInReach(true);
      hitCratesInReach(this, KICK_RANGE * PLAYER_SIZE_SCALE, KICK_DAMAGE, CRATE_KICK_PUSH_X, CRATE_KICK_PUSH_Y);
    }

    // ---------- Punch animation progression ----------
    // (extracted: the punch animation is driven inside the !IsStunned gate,
    // so a stun mid-combo freezes the swing until the stun clears)
    if (this.punching && this.stunTimer <= 0) {
      this.punchFrame++;
      // Combo 3 lunge: PunchGlideSpeed * (1 - progress)
      if (this.punchComboNr === COMBO_LINKS) {
        var progress = this.punchFrame / PUNCH_ANIM_FRAMES;
        this.x += this.lastDirX * PUNCH_GLIDE_SPEED * (1 - progress);
        this.clampToPlatformsX();
      }
      // Hit lands at the link's hit frame, once per link
      if (
        this.punchFrame >= COMBO_HIT_FRAME[this.punchComboNr - 1] &&
        !this.punchHitPerformed
      ) {
        this.punchHitPerformed = true;
        this.tryPunchHit(other);
        this.breakGlassInReach(false);
        hitCratesInReach(this, this.equipped.range[this.punchComboNr - 1] * PLAYER_SIZE_SCALE, this.equipped.damage[this.punchComboNr - 1], 3);
      }
      if (this.punchFrame >= PUNCH_ANIM_FRAMES) {
        if (this.punchQueued) {
          // Next link starts immediately
          this.punchQueued = false;
          this.punchFrame = 0;
        } else {
          // Chain broken: Punching=false resets PunchComboNr to 1
          this.punching = false;
          this.punchFrame = 0;
          this.punchComboNr = 1;
        }
      }
    }

    // Crouch (Kneel): hold DOWN standing still — or against a crate with a
    // move key held — to take cover; movement locks, the back goes flush
    this.crouching = controllable && this.onGround && this.pressDownKey() &&
      (dir === 0 || this.crouchCrate) && !this.aiming && !this.rolling &&
      !this.diving && !this.climbing && this.hp > 0;
    this.inCover = false;
    if (this.crouching && this.crouchCrate) {
      this.snapToCover(this.crouchCrate, dir);
      this.inCover = true;
      // back against the crate: face the open side (away from the cover)
      this.lastDirX = (this.crouchCrate.x > this.x + this.w / 2) ? -1 : 1;
    }

    // ---------- Movement ----------
    if (this.crouching) {
      this.airVelocityX = 0;
    } else if (dir !== 0) {
      if (dir < 0) this._portalLocked = false;
      this.lastDirX = dir;
      if (this.onGround) {
        this.airVelocityX = dir * (this.sprinting ? SPRINT_RUN_SPEED : PLAYER_RUN_SPEED);
      } else {
        this.airVelocityX += dir * AIR_CONTROL_FACTOR * (this.sprinting ? SPRINT_RUN_SPEED : PLAYER_RUN_SPEED);
        // The air cap must not eat dive momentum (Dive adds its 2.0 directly)
        if (!this.diving) {
          var maxAirX = 2 * PLAYER_RUN_SPEED;
          if (this.airVelocityX > maxAirX) this.airVelocityX = maxAirX;
          if (this.airVelocityX < -maxAirX) this.airVelocityX = -maxAirX;
        }
      }
    } else if (this.onGround) {
      this.airVelocityX = 0;
    }

    // Jump (edge-triggered, extracted order: Climbing ? LadderJump : BeginJump)
    if (controllable && !this.aiming && this.justUp()) {
      if (this.onGround) this.beginJump();
      else if (!this.tryWalljump()) { /* wall jump first (extracted) */ }
    }
    if (this.jumpPushTimeLeft > 0 && this.pressUp() && !this.climbing) {
      this.airVelocityY += PLAYER_JUMP_PUSH_POWER;
      this.jumpPushTimeLeft--;
    } else {
      this.jumpPushTimeLeft = 0;
    }

    // AirbornTimer while jumping (jump-kick gate)
    if (this.jumping && !this.onGround) this.airbornTimer++;
    else {
      this.airbornTimer = 0;
      this.jumpKickPerformed = false;
      this.jumpKickQueued = false;
    }

    // Airborne: 0 velocity is replaced by AIR_FALL_MIN so the fall starts
    if (!this.onGround && this.airVelocityY === 0) this.airVelocityY = AIR_FALL_MIN;

    // Wall slide (extracted AbleToWalljump's bound): against a wall while
    // falling, the descent slows to the slide speed
    if (!this.onGround && this.airVelocityY > WALL_SLIDE_MAX && this.wallContact(this.lastDirX)) {
      this.airVelocityY = WALL_SLIDE_MAX;
    }

    // Drop-through on a CLOUD platform (the red-outlined bars): double-DOWN.
    // KneelPressed (extracted): first press arms a 250 ms window; the second
    // sets _jumpDownPosYDisable = y + 10 and disables cloud collisions only
    // until the body has sunk those 10 px (one shelf at a time).
    if (this.cloudDropArmed > 0) this.cloudDropArmed--;
    if (
      downPressed &&
      !this.aiming &&
      this.onGround &&
      this.groundedPlatform &&
      this.groundedPlatform.cloud
    ) {
      if (this.cloudDropArmed > 0) {
        this.cloudDropArmed = 0;
        this.jumpDownPosYDisable = this.y + CLOUD_DROP_CLEAR;
        this.performJumpDown = true;
        this.airVelocityX = 0;
        this.airVelocityY = 0;
        this.onGround = false;
        this.groundedPlatform = null;
        this.jumping = true;
        this.rolling = false; // the drop ends the roll (no air drift)
        this.rollFrame = 0;
      } else {
        this.cloudDropArmed = CLOUD_DROP_WINDOW;
      }
    }
    if (this.performJumpDown && this.y > this.jumpDownPosYDisable) {
      this.performJumpDown = false;
    }

    // Ladder climb (extracted gate, exact): the CENTER POINT must be inside the
    // ladder's band (hitTestPoint on the mid position) - the UP key needs it;
    // the DOWN key allows the grounded drop-in. The body-overlap version was
    // catching jump starts beside the ladder and hijacking the jump's vy.
    var onLadderCenter = this.onLadder();
    // Cancel horizontal drift only when first touching the ladder (not while already on it)
    if (onLadderCenter && !this._wasOnLadder) this.airVelocityX = 0;
    this._wasOnLadder = onLadderCenter;
    this.climbing =
      ((this.pressUp() && onLadderCenter) ||
        (this.pressDownKey() && onLadderCenter)) &&
      !this.knockedDown &&
      this.hp > 0;
    if (this.climbing) {
      if (this.pressUp()) this.airVelocityY = -CLIMB_SPEED;
      else if (this.pressDownKey()) this.airVelocityY = CLIMB_SPEED;
      else this.airVelocityY = 0;
      // horizontal movement allowed while on the ladder
    }

    // ---------- Substepped integration (engine-faithful) ----------
    // _ = ceil(TotalAirVelocity); min 1 substep; per substep:
    //   x += h/_; y += c/_; resolve collisions;
    //   if (!Climbing) AirVelocityY += PlayerGravity * game_speed / _;
    // h and c are the per-frame displacements: velocities * game_speed.
    var totalAirVelocity = Math.sqrt(
      this.airVelocityX * this.airVelocityX +
        this.airVelocityY * this.airVelocityY
    );
    var steps = Math.ceil(totalAirVelocity);
    if (steps <= 1) steps = 1;

    var h = this.airVelocityX * gameSpeed;
    var c = this.airVelocityY * gameSpeed;
    var groundedThisFrame = false;
    var landVy = 0;
    var groundedPlatformThisFrame = null;
    var groundedCrateThisFrame = null;

    for (var s = 0; s < steps; s++) {
      // Horizontal substep + resolution. If already within a platform's x span,
      // the vertical axis owns the interaction (e.g. walking under a platform).
      var prevX = this.x;
      this.x += h / steps;
      var bounds = this.getBounds();
      for (var pi = 0; pi < platforms.length; pi++) {
        var plat = platforms[pi];
        if (!plat.solidSides || platformIsOneWay(plat) || plat.ladder) continue;
        if (this.climbing) continue;
        if (plat.elevator && this.groundedPlatform === plat && !this.performJumpDown && this.onGround) continue;
        if (!rectsOverlap(bounds, plat)) continue;
        var surfaceY = platformBoundaryForSpan(plat, this.x, this.x + this.w, false);
        if (c >= 0 && surfaceY !== null && this.y + this.h <= surfaceY + GROUND_SUPPORT_TOLERANCE) {
          continue; // above the top surface; let vertical collision resolve the landing
        }
        var wasInsideX = prevX < plat.x + plat.w && prevX + this.w > plat.x;
        if (wasInsideX) continue;
        if (plat.elevator) continue;
        if (h > 0) this.x = plat.x - this.w;
        else if (h < 0) this.x = plat.x + plat.w;
        this.airVelocityX = 0;
        h = 0;
        bounds = this.getBounds();
      }

      // Vertical substep + resolution
      var subY0 = this.y;
      this.y += c / steps;
      bounds = this.getBounds();
      if (c < 0 && !this.climbing) {
        // rising into a crate's underside: head bump
        for (var hbi = 0; hbi < crates.length; hbi++) {
          var hb = crates[hbi];
          if (hb.dead) continue;
          if (this.x < hb.x + hb.w && this.x + this.w > hb.x &&
              subY0 >= hb.y + hb.h - 1e-7 && this.y <= hb.y + hb.h + 1e-7) {
            this.y = hb.y + hb.h;
            this.airVelocityY = 0;
            c = 0;
            bounds = this.getBounds();
            break;
          }
        }
      }
      for (pi = 0; pi < platforms.length; pi++) {
        plat = platforms[pi];
        if (plat.ladder) continue;
        if (this.climbing) continue; // climbing ignores all platform collisions
        if (plat.cloud && this.performJumpDown) continue;

        // A landing requires downward motion, horizontal overlap, and the
        // player's FEET crossing the platform's top surface.
        surfaceY = platformBoundaryForSpan(plat, this.x, this.x + this.w, false);
        var previousFeet = subY0 + this.h;
        var currentFeet = this.y + this.h;
        if (
          c > 0 &&
          surfaceY !== null &&
          previousFeet <= surfaceY + 1e-7 &&
          currentFeet >= surfaceY - 1e-7
        ) {
          if (plat.elevator && this.performJumpDown) continue;
          this.y = surfaceY - this.h;
          groundedThisFrame = true;
          groundedPlatformThisFrame = plat;
          landVy = c; // captured for the ragdoll impact formula
          this.airVelocityY = 0;
          c = 0;
          bounds = this.getBounds();
          break;
        }
        // Keep standing on an elevator that moves up into the player
        if (
          plat.elevator &&
          !this.performJumpDown &&
          surfaceY !== null &&
          previousFeet <= surfaceY + 2 &&
          currentFeet >= surfaceY - 2 &&
          this.onGround &&
          this.groundedPlatform === plat
        ) {
          this.y = surfaceY - this.h;
          groundedThisFrame = true;
          groundedPlatformThisFrame = plat;
          if (landVy > 0) landVy = 0;
          this.airVelocityY = 0;
          c = 0;
          bounds = this.getBounds();
          break;
        }

        // One-way clouds/elevators have no underside collision.
        if (platformIsOneWay(plat) || !plat.solidSides || c >= 0) continue;

        var undersideY = platformBoundaryForSpan(plat, this.x, this.x + this.w, true);
        if (
          undersideY !== null &&
          subY0 >= undersideY - 1e-7 &&
          this.y <= undersideY + 1e-7
        ) {
          // Head impact: only resolve when the player's top crosses the solid's underside.
          if (plat.elevator) continue;
          this.y = undersideY;
          this.airVelocityY = 0;
          c = 0;
          bounds = this.getBounds();
          break;
        }
      }

      // Dynamic crates: land on top when airborne...
      if (!groundedThisFrame && !this.climbing) {
        for (var ci = 0; ci < crates.length; ci++) {
          var crate = crates[ci];
          if (crate.dead) continue;
          if (!(this.x < crate.x + crate.w && this.x + this.w > crate.x)) continue;
          var cPrevFeet = subY0 + this.h;
          var cCurFeet = this.y + this.h;
          if (c > 0 && cPrevFeet <= crate.y + 1e-7 && cCurFeet >= crate.y - 1e-7) {
            this.y = crate.y - this.h;
            groundedThisFrame = true;
            groundedCrateThisFrame = crate;
            landVy = c;
            this.airVelocityY = 0;
            c = 0;
            break;
          }
        }
      }
      // Crates are immovable to footsteps: the fighter runs against them
      // (the walk animation keeps playing) but they never budge. Only hits
      // (punch, kick, jump kick) and explosions move a crate.
      for (var ci2 = 0; ci2 < crates.length; ci2++) {
        var crate2 = crates[ci2];
        if (crate2.dead) continue;
        if (!(this.y + this.h > crate2.y + 2)) continue; // beside it, not on top
        var pxb = this.getBounds();
        if (!rectsOverlap(pxb, crate2)) continue;
        var wasBeside = prevX < crate2.x + crate2.w && prevX + this.w > crate2.x;
        if (wasBeside) continue; // spawned overlapping; vertical handles it
        if (h > 0) this.x = crate2.x - this.w;
        else if (h < 0) this.x = crate2.x + crate2.w;
        h = 0;
        bounds = this.getBounds();
        break;
      }

      // Dive tackle: checked per substep while diving (extracted flow)
      if (this.diving) this.checkDiveImpact(other);

      // Gravity applied per substep, then velocity recomputed
      // (the extracted gate: Climbing || grounded skips the gravity term;
      // leaving the ladder resumes the normal fall immediately)
      if (!groundedThisFrame && !this.climbing) {
        this.airVelocityY += (PLAYER_GRAVITY * gameSpeed) / steps;
        c = this.airVelocityY * gameSpeed;
      } else if (groundedThisFrame && groundedPlatformThisFrame && groundedPlatformThisFrame.elevator && !this.performJumpDown) {
        this.airVelocityY = 0;
        c = 0;
        this.y = platformBoundaryForSpan(groundedPlatformThisFrame, this.x, this.x + this.w, false) - this.h;
      }
    }

    // Standing check + ragdoll landing (extracted PlayerLands model)
    if (groundedThisFrame) {
      this.onGround = true;
      this.groundedPlatform = groundedPlatformThisFrame;
      this.groundedCrate = groundedCrateThisFrame;
      if (this.diving) {
        // Diving landing (extracted): DropGrabbedPlayer() FIRST, then Roll() -
        // the catch is momentary (it only lasts the dive flight) and the dive
        // takes NO fall damage (the impact formula lives in the Falling branch)
        this.diving = false;
        this.jumping = false;
        if (this.grabbedPlayerNr) this.dropGrabbed(false);
        this.rolling = true;
        this.rollFrame = 0;
        this.drainEnergy(ROLL_ENERGY_COST); // Roll() drains ROLL
      } else if (this.falling) {
        // Ragdoll lands: impact damage, then lying on the ground
        // impact = (abs(vy) - 3) * 1.5, zero when below 3
        this.falling = false;
        this.jumping = false;
        this.airVelocityX = 0;
        var impact = Math.abs(landVy) - 3;
        impact *= 1.5;
        if (impact < 3) impact = 0;
        this.damage(impact);
        this.knockedDown = true; // IncreaseKnockdownGrade + Knockdowned = true
        this.knockedDownFrame = 0;
        if (landVy >= FALL_TRIGGER_SPEED) this.checkFallOnPlayer(other);
      } else if (this.hp > 0 && landVy >= FALL_TRIGGER_SPEED) {
        // Hard landing (port deviation from the extracted mid-air ragdoll):
        // the player keeps air control during the whole fall and only takes
        // the extracted impact formula + knockdown when it touches the floor.
        if (this.aiming) this.abortAiming(true); // Fall() -> CheckAimDrop
        this.jumping = false;
        this.airVelocityX = 0;
        var hardImpact = Math.abs(landVy) - 3;
        hardImpact *= 1.5;
        if (hardImpact < 3) hardImpact = 0;
        this.damage(hardImpact);
        this.knockedDown = true;
        this.knockedDownFrame = 0;
        this.checkFallOnPlayer(other);
      } else {
        // Soft landing: low-impact touchdown, play soft landing sprite briefly
        this.softLandingTimer = 8;
      }
    } else if (this.onGround && !this.falling && !this.diving) {
      if (this.groundedPlatform && this.groundedPlatform.elevator && !this.performJumpDown) {
        var elevSurface = platformBoundaryForSpan(this.groundedPlatform, this.x, this.x + this.w, false);
        if (elevSurface !== null) {
          this.y = elevSurface - this.h;
          this.onGround = true;
        } else {
          this.groundedPlatform = null;
          this.onGround = false;
        }
      } else {
        // Keep support only when the feet remain within 1 px of a real top
        // surface. A full-body overlap with a wall is not ground contact.
        var feetY = this.y + this.h;
        var support = null;
        var supportGap = GROUND_SUPPORT_TOLERANCE + 1e-7;
        for (pi = 0; pi < platforms.length; pi++) {
          plat = platforms[pi];
          if (plat.ladder) continue;
          if (plat.cloud && this.performJumpDown) continue;
          if (plat.elevator && this.performJumpDown) continue;
          surfaceY = platformBoundaryForSpan(plat, this.x, this.x + this.w, false);
          if (surfaceY === null) continue;
          var allowedGap = GROUND_SUPPORT_TOLERANCE;
          if (plat === startingGroundPlatform && groundedAtFrameStart && this.airVelocityY >= 0) {
            var oldSurfaceY = platformBoundaryForSpan(
              plat,
              frameStartX,
              frameStartX + this.w,
              false
            );
            if (oldSurfaceY !== null) allowedGap += Math.abs(surfaceY - oldSurfaceY);
          }
          var gap = Math.abs(feetY - surfaceY);
          if (gap <= allowedGap && gap < supportGap) {
            support = plat;
            supportGap = gap;
          }
        }
        // crates are ground support too: standing on a pushed crate rides it
        var feetY2 = this.y + this.h;
        for (var sci = 0; sci < crates.length; sci++) {
          var sc = crates[sci];
          if (sc.dead) continue;
          if (this.x < sc.x + sc.w && this.x + this.w > sc.x &&
              feetY2 >= sc.y - GROUND_SUPPORT_TOLERANCE && feetY2 <= sc.y + GROUND_SUPPORT_TOLERANCE) {
            this.y = sc.y - this.h;
            this.x += sc.vx * 0.6; // ride along
            this.onGround = true;
            this.groundedPlatform = null;
            this.groundedCrate = sc;
            support = sc;
            break;
          }
        }
        this.onGround = support !== null;
        if (support) {
          this.y = platformBoundaryForSpan(support, this.x, this.x + this.w, false) - this.h;
          this.groundedPlatform = support;
        } else {
          this.groundedPlatform = null;
        }
      }
    }

    // Death: hp <= 0 ragdolls out of control; the lying recovery is skipped
    // while dead (the body stays on the ground). A grounded death collapses
    // straight into the lying pose; an aerial one ragdolls until it lands.
    if (this.hp <= 0 && !this.knockedDown) {
      this.stunTimer = 0;
      this.staggering = false;
      this.staggerTimer = 0;
      this.rolling = false;
      this.rollFrame = 0;
      this.punching = false;
      this.punchFrame = 0;
      this.jumpPushTimeLeft = 0;
      if (this.aiming) this.abortAiming(true);
      if (this.onGround) {
        this.knockedDown = true;
        this.knockedDownFrame = 0;
        this.falling = false;
        this.airVelocityX = 0;
      } else {
        this.falling = true;
      }
    }

    // Lying recovery: animation-driven (Knockdowned cleared when the anim ends);
    // dead bodies stay lying (no recovery while hp <= 0)
    if (this.knockedDown && this.hp > 0) {
      this.knockedDownFrame++;
      if (this.knockedDownFrame >= LYING_ANIM_FRAMES) {
        this.knockedDown = false;
        this.knockedDownFrame = 0;
      }
    }

    // Roll progression: moves at RollSpeed, ends with its animation
    if (this.rolling) {
      this.rollFrame++;
      this.x += this.lastDirX * ROLL_SPEED;
      this.clampToPlatformsX();
      if (this.rollFrame >= ROLL_ANIM_FRAMES) {
        this.rolling = false;
        this.rollFrame = 0;
      }
    }

    // Map portals (extracted Police Station): pass through the black entrance
    // to teleport to the other one.
    if (this.portalCooldown <= 0 && !this.grabbedBy && this.hp > 0 && this.lastDirX > 0 && !this._portalLocked) {
      var px = this.x + this.w / 2;
      var py = this.y + this.h / 2;
      for (var pi2 = 0; pi2 < doorPortals.length; pi2++) {
        var d = doorPortals[pi2];
        if (px < d.x - 24) continue;
        if (px > d.x + d.w) continue;
        if (py < d.y || py > d.y + d.h) continue;
        var dt = doorPortals[d.target];
        var res = this.getTargetPos(dt, d, px, py);
        this.x = res.x - this.w / 2;
        this.y = res.y - this.h;
        this.airVelocityX = 0;
        this.airVelocityY = 0;
        this.portalCooldown = 20;
        this._portalLocked = true;
        this.onGround = false;
        this.groundedPlatform = null;
        updateCamera(true);
        break;
      }
    }

    // Weapon pickup: walk over an item (PickupRadius is 10 in the artifact —
    // we use body overlap, a design simplification). Three slots: melee,
    // ranged, throwable; picking up over an occupied slot drops the old weapon.
    // NOTE: the loop iterates a SNAPSHOT length — dropping inside the loop must
    // not feed itself. Fresh drops carry pickupDelay (grace before re-grab).
    if (controllable && !this.aiming) {
      var itemCount = weaponItems.length; // snapshot: pushes land next frame
      for (var wi = 0; wi < itemCount; wi++) {
        var item = weaponItems[wi];
        if (item.taken || item.pickupDelay > 0) continue;
        if (!rectsOverlap(this.getBounds(), {
          x: item.x - 8, y: item.y - 12, w: 16, h: 16
        })) continue;
        var kind = item.weapon.kind;
        if (kind === 'melee') {
          if (this.equipped !== MELEE_WEAPONS.fists) {
            weaponItems.push({ weapon: this.equipped, x: this.x + this.w / 2, y: this.y + this.h, taken: false, pickupDelay: 30 });
          }
          this.equipped = item.weapon;
          item.taken = true;
        } else if (kind === 'gun') {
          var itemAmmo = (item.ammo !== undefined) ? item.ammo : item.weapon.ammo;
          if (itemAmmo <= 0) { continue; } // empty guns can't be picked up
          if (this.ranged) {
            weaponItems.push({ weapon: this.ranged.gun, ammo: this.ranged.ammo, x: this.x + this.w / 2, y: this.y + this.h, taken: false, pickupDelay: 30 });
          }
          this.ranged = { gun: item.weapon, ammo: itemAmmo };
          item.taken = true;
        } else if (kind === 'throwable') {
          if (this.throwable && this.throwable.ammo > 0) {
            weaponItems.push({ weapon: GRENADE, x: this.x + this.w / 2, y: this.y + this.h, taken: false, pickupDelay: 30 });
          }
          this.throwable = { ammo: item.weapon.ammo };
          item.taken = true;
        } else if (kind === 'health') {
          // isHealth pickup (extracted): HP += Ammo, clamped at 100. Left on the
          // ground while at full health so a medkit is never wasted.
          if (this.hp >= 100) continue;
          this.hp += item.weapon.ammo;
          if (this.hp > 100) this.hp = 100;
          item.taken = true;
        }
      }
    }

    // Level bounds
    if (this.x < 0) {
      this.x = 0;
      this.airVelocityX = 0;
    }
    if (this.x > GAME_WIDTH - this.w) {
      this.x = GAME_WIDTH - this.w;
      this.airVelocityX = 0;
    }
    if (this.y < 0) {
      this.y = 0;
      this.airVelocityY = 0;
    }

    // Landing recovery (not while ragdoll / lying — the launch must survive)
    if (this.onGround && !this.falling && !this.knockedDown) {
      if (!(this.groundedPlatform && this.groundedPlatform.elevator && !this.performJumpDown)) {
        this.airVelocityY = 0;
      }
      this.jumping = false;
      this.jumpPushTimeLeft = 0;
      this.wallJumping = false; // the wall state clears on landing
    }
  };

  // ---------- Rendering ----------
  // ----- Police Station tile art (Superfighters palette) -----
  // The palette mirrors the original's gray/blue brick + warm wood accents.
  var TILE = 30; // the artifact's pixels-per-meter scale

  var BRICK = {
    base: '#4e5561',      // gray-blue brick body
    dark: '#3a404a',      // mortar shadow
    light: '#5d6570',     // brick highlight
    accent: '#8a4a3b'     // exposed red brick accents
  };
  var METAL = {
    base: '#6a7482',
    dark: '#4a5361',
    light: '#8a94a2'
  };
  var WOOD = {
    base: '#6b4f2e',
    light: '#8a6a41',
    dark: '#4a3820'
  };

  // A brick segment: base + mortar seams + random-ish highlight brick
  function drawBrickWall(x, y, w, h) {
    px(x, y, w, h, BRICK.dark); // mortar background
    var rows = Math.ceil(h / 14);
    for (var r = 0; r < rows; r++) {
      var by = y + r * 14;
      var bh = Math.min(12, y + h - by);
      if (bh <= 0) break;
      // staggered bricks: every other row offset by a half tile
      var offset = r % 2 === 0 ? 0 : TILE / 2;
      for (var bx = x - offset; bx < x + w; bx += TILE) {
        var cx = Math.max(bx, x);
        var cw = Math.min(bx + TILE - 2, x + w) - cx;
        if (cw <= 0) continue;
        px(cx, by, cw, bh, BRICK.base);
        px(cx, by, cw, 2, BRICK.light); // top highlight
      }
    }
    // The outer top edge
    px(x, y, w, 2, BRICK.light);
  }

  function drawMetalBox(x, y, w, h) {
    px(x, y, w, h, METAL.base);
    px(x, y, w, 2, METAL.light);
    px(x, y + h - 2, w, 2, METAL.dark);
  }

  function drawCloudShelf(x, y, w, h) {
    // The thin metal shelf (CLOUD): the darker underside like the original
    px(x, y, w, h, METAL.light);
    px(x, y, w, 1, '#a8b2be');
    px(x, y + h - 1, w, 1, METAL.dark);
    // The support brackets every 20px
    for (var sx = x + 10; sx < x + w - 6; sx += 20) {
      px(sx, y + h, 2, 3, METAL.dark);
    }
  }

  function drawLadder(x, y, w, h) {
    // The vertical ladder: two rails + rungs every 12px
    px(x, y, 3, h, METAL.light);
    px(x + w - 3, y, 3, h, METAL.light);
    for (var ry = y + 6; ry < y + h - 4; ry += 12) {
      px(x, ry, w, 3, METAL.base);
    }
  }

  function drawPortalEntrance(p, isUpper) {
    // Dark recessed entrance (no door panel). Looks like an open passage.
    var x = p.x, y = p.y, w = p.w, h = p.h;
    // Frame around the opening
    px(x - 1, y - 1, w + 2, 1, '#2f333b');
    px(x - 1, y + h, w + 2, 1, '#1f2228');
    px(x - 1, y, 1, h, '#2f333b');
    px(x + w, y, 1, h, '#1f2228');
    // Pitch black interior
    px(x, y, w, h, '#000000');
    // Subtle inner shadow
    px(x, y + h - 2, w, 1, '#101215');
    if (isUpper) {
      // Emergency exit sign above the upper entrance
      px(x - 3, y - 10, w + 6, 8, '#8a1f1f');
      px(x - 3, y - 10, w + 6, 2, '#b92b2b');
      px(x - 3, y - 4, w + 6, 2, '#6f1717');
      // "EXIT" style bars
      px(x + 2, y - 7, 3, 4, '#f5f5f5');
      px(x + w - 5, y - 7, 3, 4, '#f5f5f5');
      px(x + 6, y - 6, w - 12, 2, '#f5f5f5');
      // Arrow pointing up/out
      px(x + w / 2 - 1, y - 8, 2, 2, '#f5f5f5');
      px(x + w / 2 - 2, y - 7, 4, 1, '#f5f5f5');
    }
  }

  function drawElevator(e) {
    // The cables up to the level's top
    px(e.x + 5, 0, 2, e.y, '#3a3e45');
    px(e.x + e.w - 7, 0, 2, e.y, '#3a3e45');
    // The platform
    drawMetalBox(e.x, e.y, e.w, e.h);
    // The piston glow (the motor)
    px(e.x + e.w / 2 - 3, e.y + e.h, 6, 3, '#c8a86a');
  }

  function drawPolygonPlatform(p) {
    ctx.beginPath();
    ctx.moveTo(p.vertices[0].x, p.vertices[0].y);
    for (var i = 1; i < p.vertices.length; i++) {
      ctx.lineTo(p.vertices[i].x, p.vertices[i].y);
    }
    ctx.closePath();
    ctx.fillStyle = BRICK.base;
    ctx.fill();
    ctx.strokeStyle = '#40e0ff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.vertices[0].x, p.vertices[0].y);
    ctx.lineTo(p.vertices[1].x, p.vertices[1].y);
    ctx.strokeStyle = BRICK.light;
    ctx.stroke();
  }

  function drawCirclePlatform(p) {
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = METAL.base;
    ctx.fill();
    ctx.strokeStyle = '#40e0ff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawGlassPane(p) {
    ctx.fillStyle = 'rgba(142,220,235,0.38)';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    px(p.x, p.y, p.w, 1, '#c9f6ff');
    px(p.x, p.y, 1, p.h, '#9eeaf2');
    // The artifact draws a 6 px window_seg every 6 px along the pane
    ctx.strokeStyle = 'rgba(220,250,255,0.55)';
    ctx.lineWidth = 1;
    for (var y = p.y + 6; y < p.y + p.h - 3; y += 6) {
      ctx.beginPath();
      ctx.moveTo(p.x, y);
      ctx.lineTo(p.x + p.w, y);
      ctx.stroke();
    }
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  }

  // The Superfighters crate: black frame, tan ring, peach fill, two parallel
  // diagonals running bottom-left -> top-right (drawn in local top-left coords)
  function drawCrateBox(x, y, s) {
    var m = Math.max(2, Math.round(s * 0.12));
    px(x, y, s, s, '#0a0a0a'); // black frame
    var m2 = m + Math.max(1, Math.round(s * 0.06));
    px(x + m, y + m, s - 2 * m, s - 2 * m, '#c89050'); // tan ring
    var fillX = x + m2, fillY = y + m2, fillS = s - 2 * m2;
    px(fillX, fillY, fillS, fillS, '#f0b878'); // peach fill
    // two parallel diagonals, clipped to the fill
    ctx.save();
    ctx.beginPath();
    ctx.rect(fillX, fillY, fillS, fillS);
    ctx.clip();
    ctx.strokeStyle = '#b5713a';
    ctx.lineWidth = Math.max(2, Math.round(s * 0.09));
    var d = Math.round(s * 0.22);
    ctx.beginPath();
    ctx.moveTo(x + m, y + s - m); ctx.lineTo(x + s - m, y + m); // main diagonal
    ctx.moveTo(x + m + d, y + s - m); ctx.lineTo(x + s - m, y + m + d); // parallel offset
    ctx.stroke();
    ctx.restore();
  }

  function drawCrates() {
    for (var i = 0; i < crates.length; i++) {
      var c = crates[i];
      if (c.dead) continue;
      ctx.save();
      ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
      ctx.rotate(c.angle);
      drawCrateBox(-c.w / 2, -c.h / 2, c.w);
      // damage cracks
      if (c.hp < c.hp0 * 0.6) {
        ctx.strokeStyle = '#3a2c16';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-c.w / 2 + 3, 0); ctx.lineTo(0, 3); ctx.lineTo(c.w / 2 - 4, -2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawGlassShards() {
    for (var i = 0; i < glassShards.length; i++) {
      var s = glassShards[i];
      var alpha = Math.min(1, s.life / 16);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      var base = s.color || '205,245,255';
      var rgb = base[0] === '#' ? hexToRgb(base) : base;
      ctx.fillStyle = 'rgba(' + rgb + ',' + alpha + ')';
      ctx.beginPath();
      ctx.moveTo(-s.size / 2, -1);
      ctx.lineTo(s.size / 2, -0.5);
      ctx.lineTo(s.size / 4, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTileOutline(p, color) {
    // The collider's outline: the structures are NEVER invisible
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
  }

  function drawPlatform(p) {
    if (p.elevator) return drawElevator(p);
    if (p.glass) return drawGlassPane(p);
    if (p.shape === 'polygon') return drawPolygonPlatform(p);
    if (p.shape === 'circle') return drawCirclePlatform(p);
    if (p.ladder) return drawLadder(p.x, p.y, p.w, p.h);
    if (p.cloud) { drawCloudShelf(p.x, p.y, p.w, p.h); return drawTileOutline(p, '#ff5050'); }
    if (p.material === 'Metal') { drawMetalBox(p.x, p.y, p.w, p.h); return drawTileOutline(p, '#40e0ff'); }
    if (p.x < STATION.x0 - 40 && p.w > 100) return drawOutdoorGround(p);
    if (p.w > 90) return drawConcreteSlab(p.x, p.y, p.w, p.h);
    drawBrickWall(p.x, p.y, p.w, p.h);
  }

  // Concrete floor slabs (the station's floors): light gray with white top edge
  function drawConcreteSlab(x, y, w, h) {
    px(x, y, w, h, '#b6bac2');
    px(x, y, w, 3, '#e8ecf0'); // white top edge
    px(x, y + 3, w, 1, '#9aa0aa');
    px(x, y + h - 3, w, 3, '#7a7e88'); // bottom shadow
    var rand = mulberry32(Math.floor(x * 31 + y * 17));
    for (var m = 0; m < w / 26; m++) {
      var mx = x + 4 + rand() * (w - 8);
      var my = y + 6 + rand() * Math.max(1, h - 10);
      px(mx, my, 2, 1, '#9aa0aa'); // speckles
    }
  }

  // The outdoor ground: olive-yellow turf with pebbles (left side of the map)
  function drawOutdoorGround(p) {
    px(p.x, p.y, p.w, p.h, '#6a6a2e');
    px(p.x, p.y, p.w, 6, '#b0b050'); // turf top
    px(p.x, p.y, p.w, 2, '#d0d068');
    var rand = mulberry32(Math.floor(p.x * 13 + p.y * 7));
    for (var peb = 0; peb < p.w / 9; peb++) {
      var gx = p.x + rand() * p.w;
      var gy = p.y + 7 + rand() * Math.max(1, p.h - 10);
      px(gx, gy, 3, 2, rand() > 0.5 ? '#8a8a3e' : '#565624');
    }
  }

  function px(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  // Head/hair overlays per character style (local coords, facing right)
  function drawHair(c, w, hx) {
    var s = c.hairStyle || 'agent';
    if (s === 'agent') {
      // Slicked-back dark hair + sunglasses band
      px(hx, 0, 18, 4, c.hair);
      px(hx, 4, 4, 3, c.hair); // back of the hair
      px(hx + 1, 4, 16, 4, '#0c0c10'); // sunglasses band
      px(hx + 14, 5, 2, 2, '#3a7a8c'); // earpiece
      return;
    }
    if (s === 'mask') {
      px(hx, 0, 18, 12, c.hair);
      px(hx + 10, 5, 5, 3, '#fff'); // eye slit
      px(hx + 12, 6, 2, 1, '#d84f3f'); // red pupil
      return;
    }
    if (s === 'helmet') {
      px(hx, 0, 18, 6, '#8a8f96');
      px(hx, 5, 18, 1, '#5d6167');
      px(hx, 6, 18, 1, '#6b7078');
      return;
    }
    if (s === 'bandana') {
      px(hx, 0, 18, 5, '#8a2b2b');
      px(hx - 3, 3, 4, 4, '#8a2b2b'); // knot + tail at the back
      return;
    }
    if (s === 'cap') {
      px(hx, 0, 18, 5, c.hair);
      px(hx + 8, 4, 12, 2, c.hair); // brim
      return;
    }
    // flat hair
    px(hx, 0, 18, 5, c.hair);
    px(hx, 5, 3, 5, c.hair); // back sideburn
  }

  // Weapon shape in the hand (local coords, held pointing right)
  function drawWeaponShape(c, x, y) {
    if (c.shape === 'pills') {
      px(x + 1, y, 8, 6, '#e8e4da'); // pill box
      px(x + 1, y + 2, 8, 2, '#d0453a'); // red band
    } else if (c.shape === 'medkit') {
      px(x, y - 1, 12, 8, '#e8e4da'); // kit box
      px(x + 5, y + 1, 2, 4, '#d0453a'); // cross vertical
      px(x + 3, y + 2, 6, 2, '#d0453a'); // cross horizontal
    } else if (c.shape === 'machete') {
      px(x, y, 3, 4, '#3a3a3a'); // grip
      px(x + 3, y - 1, 9, 3, '#c8ccd2'); // blade
      px(x + 10, y - 2, 2, 5, '#c8ccd2'); // tip
    } else if (c.shape === 'axe') {
      px(x, y, 12, 3, '#6b4f2e'); // handle
      px(x + 10, y - 4, 5, 9, '#9aa2ab'); // head
      px(x + 13, y - 2, 2, 5, '#7a828b'); // edge
    } else if (c.shape === 'sword') {
      px(x, y, 3, 4, '#3a3a3a'); // grip
      px(x + 3, y - 1, 2, 5, '#8a8f96'); // guard
      px(x + 5, y - 1, 12, 3, '#dfe3e8'); // blade
      px(x + 17, y - 2, 2, 5, '#dfe3e8'); // tip
    } else if (c.shape === 'pistol') {
      px(x, y, 8, 3, '#2e2e34'); // slide
      px(x, y + 3, 3, 5, '#2e2e34'); // grip
      px(x + 8, y, 2, 2, '#55555e'); // muzzle
    } else if (c.shape === 'grenade') {
      px(x, y, 6, 6, '#3f5a3f'); // body
      px(x + 1, y - 2, 3, 2, '#2a3f2a'); // pin
    }
  }

  // Fighter sprite in LOCAL coords (origin = top-left of the AABB, facing right)
  function drawFighterPose(p) {
    var c = p.char;
    var W = p.baseW;
    var H = p.baseH;
    var headH = 12;
    var legH = Math.round(H * 0.23); // legs zone
    var torsoTop = headH;
    var torsoH = H - headH - legH;
    var hx = Math.round(W / 2 - 9);
    var suit = c.suit || c.shirt;

    // Walk cycle: 2-phase leg shuffle + 1px body bob
    var walking = p.running && p.onGround && !p.sprinting;
    var sprinting = p.sprinting && p.running;
    var phase = (p.walkFrame >> 3) & 1;
    var y0 = walking && phase ? 1 : 0;
    if (sprinting) y0 = (p.walkFrame >> 2) & 1 ? 1 : 0; // faster bob when sprinting

    // Legs (pants) + shoes, alternating stride
    var legSpread = walking || sprinting ? (phase ? 2 : -2) : 0;
    px(7 + legSpread, torsoTop + torsoH - 2 + y0, 5, legH - 2, c.pants);
    px(W - 12 - legSpread, torsoTop + torsoH - 2 + y0, 5, legH - 2, c.pants);
    px(5 + legSpread, H - 4 + y0, 8, 4, c.shoes);
    px(W - 13 - legSpread, H - 4 + y0, 8, 4, c.shoes);

    // Aerial kick pose: legs thrust forward
    if (p.kickFlash > 0 && !p.onGround) {
      px(W - 4, torsoTop + torsoH - 2, KICK_RANGE, 5, c.pants);
      px(W - 4 + KICK_RANGE, torsoTop + torsoH - 3, 6, 6, c.shoes);
    }

    // Back arm (behind torso, skin)
    px(W / 2 - 9, torsoTop + 5 + y0, 4, torsoH - 8, c.skin);

    // Torso: suit + collar + tie
    px(W / 2 - 8, torsoTop + y0, 16, torsoH, suit);
    px(W / 2 - 4, torsoTop + y0, 8, 3, '#e8e8ea'); // shirt collar
    px(W / 2 - 1, torsoTop + 3 + y0, 2, torsoH - 7, c.tie); // tie
    px(W / 2 - 8, torsoTop + torsoH - 3 + y0, 16, 3, c.pants); // belt

    // Head (skin) + hair style
    px(hx, y0, 18, headH, c.skin);
    drawHair(c, W, hx);

    // Eye (white with pupil, facing right) — hidden behind sunglasses
    if ((c.hairStyle || 'agent') !== 'agent') {
      px(W - 11, 5 + y0, 4, 4, '#fff');
      px(W - 9, 6 + y0, 2, 2, '#1a1a1a');
    }

    // THROW pose: arm raised high after a throw
    if (p.throwPose > 0) {
      ctx.save();
      ctx.translate(W - 4, torsoTop + 4 + y0);
      ctx.rotate(-1.2);
      px(0, 0, 4, 14, c.skin);
      ctx.restore();
    }

    // Front arm: punch strike extends, otherwise hangs by the side
    if (p.punching) {
      var strike =
        p.punchFrame >= COMBO_HIT_FRAME[p.punchComboNr - 1] - 2 &&
        p.punchFrame <= COMBO_HIT_FRAME[p.punchComboNr - 1] + 6;
      var reach = p.equipped.range[p.punchComboNr - 1];
      var len = strike ? reach : 8;
      px(W - 6, torsoTop + 5 + y0, len, 4, c.skin);
      if (strike && p.equipped.shape) {
        drawWeaponShape(p.equipped, W - 6 + len - 6, torsoTop + 3 + y0);
      } else {
        px(W - 6 + len, torsoTop + 4 + y0, 4, 5, c.skin); // fist
      }
    } else if (p.ranged) {
      // Gun in the hand: raised along the aim pitch while aiming, low otherwise
      ctx.save();
      ctx.translate(W - 4, torsoTop + 7 + y0);
      if (p.aiming && p.aimMode === 0) ctx.rotate((p.aimPitch * Math.PI) / 180);
      drawWeaponShape(p.ranged.gun, -2, -2);
      ctx.restore();
    } else {
      px(W - 6, torsoTop + 5 + y0, 4, torsoH - 10, c.skin);
      if (p.equipped.shape) {
        // Weapon held low while idle
        drawWeaponShape(p.equipped, W - 4, torsoTop + torsoH - 4);
      }
    }
    // Grenade in the other hand while aiming a throw
    if (p.aiming && p.aimMode === 1) {
      px(W / 2 - 12, torsoTop + 6 + y0, 6, 6, '#3f5a3f');
    }

    // Grounded kick: extended leg
    if (p.kickFlash > 0 && p.onGround) {
      px(W - 4, torsoTop + torsoH - 2, KICK_RANGE, 5, c.pants);
      px(W - 4 + KICK_RANGE, torsoTop + torsoH - 3, 6, 6, c.shoes);
    }
  }

  // Health bar above the head (PlayerBars-style): only shown while damaged,
  // with the classic green -> yellow -> red thresholds
  function drawHealthBar(p) {
    if (p.hp >= 100 || p.hp <= 0) return;
    var barW = 24;
    var barH = 3;
    var x = p.x + p.w / 2 - barW / 2;
    var y = p.y - 7;
    ctx.fillStyle = 'rgba(10,12,16,0.75)';
    ctx.fillRect(x - 1, y - 1, barW + 2, barH + 2);
    var fill = (p.hp / 100) * barW;
    ctx.fillStyle = p.hp > 50 ? '#3ecf5a' : p.hp > 25 ? '#e8c34a' : '#d0453a';
    ctx.fillRect(x, y, fill, barH);
  }

  function drawPlayer(p) {
    if (drawPlayerSprite(p)) return;
    // Grabbed pose: tumbled over the grabber's shoulder (GRABBED anim)
    if (p.grabbedBy) {
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h - 8 * PLAYER_SIZE_SCALE);
      ctx.rotate((Math.PI / 2) * 0.7 * p.grabbedBy.lastDirX);
      ctx.scale(PLAYER_SIZE_SCALE, PLAYER_SIZE_SCALE);
      ctx.translate(-p.baseW / 2, -p.baseH / 2);
      drawFighterPose(p);
      ctx.restore();
      return;
    }

    // Diving pose: superman flight — body rotated forward, streaks
    if (p.diving) {
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate((Math.PI / 2) * 0.8 * p.lastDirX);
      ctx.scale(PLAYER_SIZE_SCALE, PLAYER_SIZE_SCALE);
      ctx.translate(-p.baseW / 2, -p.baseH / 2);
      drawFighterPose(p);
      ctx.restore();
      // Speed streaks behind the dive
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      for (var dv = 0; dv < 4; dv++) {
        ctx.fillRect(
          p.lastDirX > 0 ? p.x - 10 - 8 * dv : p.x + p.w + 3 + 8 * dv,
          p.y + 12 + dv * 6,
          8,
          2
        );
      }
      return;
    }

    // Falling ragdoll: the body tumbles forward as the descent speeds up
    if (p.falling) {
      var fallT = Math.max(0, Math.min(1, p.airVelocityY / FALL_TRIGGER_SPEED));
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h - 6 * PLAYER_SIZE_SCALE);
      ctx.rotate((Math.PI / 2) * fallT * p.lastDirX);
      ctx.scale(PLAYER_SIZE_SCALE, PLAYER_SIZE_SCALE);
      ctx.translate(-p.baseW / 2, -(p.baseH - 6));
      drawFighterPose(p);
      ctx.restore();
      // Ragdoll streaks
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (var st = 0; st < 3; st++) {
        ctx.fillRect(
          p.lastDirX > 0 ? p.x - 6 - st * 4 : p.x + p.w + 3 + st * 4,
          p.y + 6 + st * 8,
          3,
          10
        );
      }
      return;
    }

    // Lying pose (knocked down): rotate the fighter 90°, collider stays upright
    if (p.knockedDown) {
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h - 6 * PLAYER_SIZE_SCALE);
      ctx.rotate((Math.PI / 2) * p.lastDirX);
      ctx.scale(PLAYER_SIZE_SCALE, PLAYER_SIZE_SCALE);
      ctx.translate(-p.baseW / 2, -(p.baseH - 6));
      drawFighterPose(p);
      ctx.restore();
      return;
    }

    // Rolling pose: tucked ball with a spinning highlight
    if (p.rolling) {
      var r = Math.min(p.w, p.h) / 2 - 3;
      var cx = p.x + p.w / 2;
      var cy = p.y + p.h - r - 3;
      ctx.fillStyle = p.char.shirt;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(p.rollFrame * 0.45 * p.lastDirX);
      px(-r + 3, -2, 5, 5, p.char.skin); // rotating head patch
      ctx.restore();
      return;
    }

    // Stagger jitter: shake sideways
    var jx = p.staggering ? (Math.random() * 4 - 2) : 0;

    ctx.save();
    ctx.translate(jx, 0);

    // Sprite is drawn facing right in LOCAL AABB coords, then flipped in place
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(PLAYER_SIZE_SCALE, PLAYER_SIZE_SCALE);
    if (p.lastDirX < 0) {
      ctx.translate(p.baseW, 0);
      ctx.scale(-1, 1);
    }
    drawFighterPose(p);
    ctx.restore();

    // Sprint motion streak
    if (p.sprinting && p.running) {
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      for (var st2 = 1; st2 <= 3; st2++) {
        ctx.fillRect(
          p.lastDirX > 0 ? p.x - 7 * st2 : p.x + p.w - 4 + 7 * st2,
          p.y + 10 + 8 * st2,
          5,
          2
        );
      }
    }

    // Hit tint overlay
    if (p.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,80,80,0.35)';
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }

    // Stun stars
    if (p.stunTimer > 0) {
      ctx.fillStyle = 'rgba(255,255,140,0.95)';
      ctx.fillRect(p.x + 4, p.y - 6, 4, 4);
      ctx.fillRect(p.x + p.w - 8, p.y - 9, 4, 4);
      ctx.fillRect(p.x + p.w / 2 - 2, p.y - 12, 4, 4);
    }

    // Aim indicator (extracted AimLazer): a small square floating at the ray's
    // end near the muzzle. The dotted LASER is SNIPER-ONLY (LaserSight flag)
    if (p.aiming && p.aimSquare) {
      var asx = p.aimSquare.x;
      var asy = p.aimSquare.y;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(asx - 2, asy - 2, 4, 4);
      ctx.fillStyle = 'rgba(255,80,80,0.9)';
      ctx.fillRect(asx - 1, asy - 1, 2, 2);
    }

    // Muzzle flash
    if (p.muzzleFlash > 0) {
      var mx = p.lastDirX > 0 ? p.x + p.w + 6 : p.x - 6;
      ctx.fillStyle = 'rgba(255,240,180,0.9)';
      ctx.fillRect(mx - 3, p.y + 13, 7, 7);
      ctx.fillStyle = 'rgba(255,180,60,0.7)';
      ctx.fillRect(mx - 6, p.y + 14, 13, 4);
    }

    // Sprint energy bar (hidden while full)
    if (p.sprintEnergy < 100) {
      var barW = p.w;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(p.x, p.y - 4, barW, 3);
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(p.x, p.y - 4, (barW * p.sprintEnergy) / 100, 3);
    }

    // HP bar + name tag (width follows the scaled body)
    var hpBarW = Math.max(20, Math.round(p.w + 8));
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(p.x + p.w / 2 - hpBarW / 2, p.y - 9, hpBarW, 4);
    var hpT = Math.max(0, p.hp) / 100;
    ctx.fillStyle = hpT > 0.4 ? '#6fce62' : '#e2574c';
    ctx.fillRect(p.x + p.w / 2 - hpBarW / 2 + 1, p.y - 8, (hpBarW - 2) * hpT, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(p.char.name, p.x + p.w / 2, p.y - 12);
    ctx.textAlign = 'left';

    ctx.restore();
  }

  function drawHud() {
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textAlign = 'left';
    ctx.fillText('P1: A/D move  W jump/aim-up  S roll/aim-down  F punch  G kick  R fire  T nade', 10, 18);
    ctx.textAlign = 'right';
    ctx.fillText(
      'P2: \u2190/\u2192 move  \u2191 jump/aim  \u2193 roll  M punch  N kick  . fire  , nade',
      GAME_WIDTH - 10,
      18
    );
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'center';
    ctx.fillText('double-tap A/D or \u2190/\u2192 to sprint \u2014 hold R to aim, release to shoot \u2014 hold T to cook the grenade \u2014 hit while aiming drops your gun', GAME_WIDTH / 2, 32);
    ctx.fillText('B toggles the P2 bot' + (botActive ? ' (ON)' : ' (OFF)'), GAME_WIDTH / 2, 46);
    ctx.textAlign = 'left';
    if (roundOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, GAME_HEIGHT / 2 - 46, GAME_WIDTH, 92);
      ctx.fillStyle = '#fff';
      ctx.font = '28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        roundOver.winnerId === 0 ? 'DOUBLE KILL' : 'PLAYER ' + roundOver.winnerId + ' WINS',
        GAME_WIDTH / 2,
        GAME_HEIGHT / 2 - 6
      );
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px monospace';
      ctx.fillText('round restarts in ' + Math.ceil(restartTimer / FPS) + 's', GAME_WIDTH / 2, GAME_HEIGHT / 2 + 24);
      ctx.textAlign = 'left';
    }
  }

  // ---------- Game state ----------
  var player1 = new Player(1, playerSpawns[0].x, playerSpawns[0].y, 0, {
    left: 'KeyA',
    right: 'KeyD',
    down: 'KeyS',
    up: 'KeyW',
    punch: 'KeyF',
    kick: 'KeyG',
    fire: 'KeyR',
    throw: 'KeyT'
  });
  player1.y -= player1.h; // spawn.y is the feet level
  var player2 = new Player(2, playerSpawns[1].x, playerSpawns[1].y, 1, {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    down: 'ArrowDown',
    up: 'ArrowUp',
    punch: 'KeyM',
    kick: 'KeyN',
    fire: 'Period',
    throw: 'Comma'
  });
  player2.y -= player2.h; // spawn.y is the feet level
  player2.y -= player2.h; // spawn.y is the feet level
  // Camera is a viewport transform, so map coordinates and collision geometry
  // remain unchanged. It zooms in on nearby players and zooms out to fit both.
  var CAMERA_MIN_ZOOM = 0.72;
  var CAMERA_MAX_ZOOM = 1.5;
  var CAMERA_PADDING_X = 72;
  var CAMERA_PADDING_Y = 72;
  var CAMERA_POSITION_SMOOTHING = 0.18;
  var CAMERA_ZOOM_SMOOTHING = 0.12;
  var camera = {
    x: (player1.x + player1.w / 2 + player2.x + player2.w / 2) / 2,
    y: (player1.y + player1.h / 2 + player2.y + player2.h / 2) / 2,
    zoom: 1
  };

  function clampCameraCenter(center, worldSize, zoom) {
    var halfView = worldSize / (2 * zoom);
    if (halfView >= worldSize / 2) return worldSize / 2;
    return Math.max(halfView, Math.min(worldSize - halfView, center));
  }

  function updateCamera(snap) {
    var left = Math.min(player1.x, player2.x);
    var right = Math.max(player1.x + player1.w, player2.x + player2.w);
    var top = Math.min(player1.y, player2.y);
    var bottom = Math.max(player1.y + player1.h, player2.y + player2.h);
    var spanX = Math.max(right - left, 1);
    var spanY = Math.max(bottom - top, 1);
    var fitZoom = Math.min(
      (GAME_WIDTH - 2 * CAMERA_PADDING_X) / spanX,
      (GAME_HEIGHT - 2 * CAMERA_PADDING_Y) / spanY
    );
    var targetZoom = Math.max(CAMERA_MIN_ZOOM, Math.min(CAMERA_MAX_ZOOM, fitZoom));
    var targetX = clampCameraCenter((left + right) / 2, GAME_WIDTH, targetZoom);
    var targetY = clampCameraCenter((top + bottom) / 2, GAME_HEIGHT, targetZoom);

    var zoomBlend = snap ? 1 : CAMERA_ZOOM_SMOOTHING;
    var positionBlend = snap ? 1 : CAMERA_POSITION_SMOOTHING;
    camera.zoom += (targetZoom - camera.zoom) * zoomBlend;
    camera.x += (targetX - camera.x) * positionBlend;
    camera.y += (targetY - camera.y) * positionBlend;
    camera.x = clampCameraCenter(camera.x, GAME_WIDTH, camera.zoom);
    camera.y = clampCameraCenter(camera.y, GAME_HEIGHT, camera.zoom);
  }

  // Snap the first rendered frame to the spawn framing instead of easing from 1x.
  updateCamera(true);

  // Settle every crate onto its support BEFORE the first rendered frame so the
  // scene opens with everything already in place (no falling crates on start).
  // Bottom-first order: supports land before the crates stacked on them.
  var _settleOrder = crates.slice().sort(function (a, b) { return b.y - a.y; });
  for (var _cs2 = 0; _cs2 < _settleOrder.length; _cs2++) settleCrate(_settleOrder[_cs2]);

  // ---------- World entities: bullets / grenades / explosions / dropped items ----------
  function updateBullets() {
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      var totalVel = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      // Extracted: substeps n = round(TotalVel / 4), min 1
      var steps = Math.round(totalVel / BULLET_SUBSTEP_PX);
      if (steps < 1) steps = 1;
      var dead = false;
      for (var s = 0; s < steps && !dead; s++) {
        b.x += b.vx / steps;
        b.y += b.vy / steps;
        if (!b.trail) b.trail = [];
        b.trail.push({ x: b.x, y: b.y });
        if (b.trail.length > 12) b.trail.shift();
        if (b.x < 0 || b.x > GAME_WIDTH || b.y < 0 || b.y > GAME_HEIGHT) {
          dead = true;
          break;
        }
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.cloud || plat.ladder || plat.oneWay) continue; // bullets pass through clouds/ladders/one-way
          if (pointInPlatform(b.x, b.y, plat)) {
            // SOLID_GLASS_01 is transparent to nothing: a bullet shatters it.
            if (plat.glass) breakGlassPane(plat);
            dead = true;
            break;
          }
        }
        if (dead) break;
        for (var bci = 0; bci < crates.length; bci++) {
          var bcrate = crates[bci];
          if (bcrate.dead) continue;
          if (b.x > bcrate.x && b.x < bcrate.x + bcrate.w && b.y > bcrate.y && b.y < bcrate.y + bcrate.h) {
            damageCrate(bcrate, b.damage, 0, 0);
            dead = true; // the crate eats the bullet
            break;
          }
        }
        if (dead) break;
        var targets = [player1, player2];
        for (var t = 0; t < targets.length; t++) {
          var p = targets[t];
          if (p.id === b.owner) continue; // bullets ignore their shooter
          if (
            b.x > p.x && b.x < p.x + p.w &&
            b.y > p.y && b.y < p.y + p.h
          ) {
            p.damage(b.crit ? b.damage + b.critDamage : b.damage);
            p.hitFlash = 6;
            var kb = BULLET_KNOCKBACK * (p.onGround ? 1 : BULLET_AERIAL_KNOCKBACK_MULT);
            p.airVelocityX = b.vx > 0 ? kb : -kb;
            p.airVelocityY = -1.2 * VEL_SCALE;
            p.onGround = false;
            p.groundedPlatform = null;
            if (p.aiming) p.abortAiming(true); // hit while aiming: the gun drops
            dead = true;
            break;
          }
        }
      }
      if (dead) bullets.splice(i, 1);
    }
  }

  function explodeGrenade(x, y) {
    explosions.push({ x: x, y: y, radius: GRENADE.radius, frame: 0 });
    breakGlassInRadius(x, y, GRENADE.radius); // AffectedByExplosions
    // AffectedByExplosions: crates take blast damage and fly with it
    for (var ci = 0; ci < crates.length; ci++) {
      var c = crates[ci];
      if (c.dead) continue;
      var cdx = c.x + c.w / 2 - x;
      var cdy = c.y + c.h / 2 - y;
      var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
      if (cdist > GRENADE.radius) continue;
      var cfalloff = 1 - cdist / GRENADE.radius;
      damageCrate(c, GRENADE.damageMax * cfalloff, (cdx >= 0 ? 1 : -1) * 7 * cfalloff, -5 * cfalloff);
    }
    var targets = [player1, player2];
    for (var t = 0; t < targets.length; t++) {
      var p = targets[t];
      var dx = p.x + p.w / 2 - x;
      var dy = p.y + p.h / 2 - y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > GRENADE.radius) continue;
      var falloff = 1 - dist / GRENADE.radius;
      p.damage(GRENADE.damageMin + (GRENADE.damageMax - GRENADE.damageMin) * falloff);
      p.hitFlash = 6;
      var kb = 6 * VEL_SCALE * falloff;
      p.airVelocityX = (dx >= 0 ? 1 : -1) * kb;
      p.airVelocityY = (-2 - 4 * falloff) * VEL_SCALE;
      p.onGround = false;
      p.groundedPlatform = null;
      p.falling = true; // the explosion ragdolls
      if (p.aiming) p.abortAiming(true);
    }
  }

  function updateGrenades() {
    for (var i = grenades.length - 1; i >= 0; i--) {
      var g = grenades[i];
      g.fuse--;
      if (g.fuse <= 0) {
        explodeGrenade(g.x, g.y);
        grenades.splice(i, 1);
        continue;
      }
      g.vy += PLAYER_GRAVITY;
      g.spin += g.vx;
      var steps = Math.max(1, Math.round(Math.sqrt(g.vx * g.vx + g.vy * g.vy) / BULLET_SUBSTEP_PX));
      var prevY = g.y;
      for (var s = 0; s < steps; s++) {
        prevY = g.y;
        g.x += g.vx / steps;
        g.y += g.vy / steps;
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.ladder) continue;
          var surfaceY = platformBoundaryForSpan(plat, g.x - 3, g.x + 3, false);
          if (surfaceY !== null && prevY <= surfaceY && g.y >= surfaceY) {
            g.y = surfaceY - 2; // rest just above the surface
            g.vy = -g.vy * 0.35; // bounce
            g.vx *= 0.7;
            if (Math.abs(g.vy) < 0.8) g.vy = 0;
            break;
          }
        }
        if (g.x < 3 || g.x > GAME_WIDTH - 3) {
          g.vx = -g.vx * 0.5;
          g.x = Math.max(3, Math.min(GAME_WIDTH - 3, g.x));
        }
      }
    }
  }

  function updateExplosions() {
    for (var i = explosions.length - 1; i >= 0; i--) {
      explosions[i].frame++;
      if (explosions[i].frame >= GRENADE_EXPLOSION_FRAMES) explosions.splice(i, 1);
    }
  }

  // ---------- Destructible glass (SOLID_GLASS_01) ----------
  // Extracted from the artifact: the pane is a 5 hp body with PlayerFragile,
  // Kickable, IsGlass and AffectedByExplosions. Any punch/kick (Damage_Impact,
  // resistance 10) or bullet (Damage_Bullet, resistance 10) exceeds those 5 hp,
  // so a single hit shatters it. onDestruction spawns one GLASS_SHARD_1 every
  // ~6 px along the pane plus random spin/velocity.
  var GLASS_SHARD_LIFE = 50;

  function spawnGlassShards(pane) {
    var vertical = pane.h >= pane.w;
    var length = vertical ? pane.h : pane.w;
    var count = Math.max(2, Math.floor(length / 6));
    var cx = pane.x + pane.w / 2;
    var cy = pane.y + pane.h / 2;
    for (var i = 0; i < count; i++) {
      var along = count > 1 ? (i / (count - 1) - 0.5) * length : 0;
      glassShards.push({
        x: cx + (vertical ? (Math.random() - 0.5) * pane.w : along),
        y: cy + (vertical ? along : (Math.random() - 0.5) * pane.h),
        vx: (Math.random() - 0.5) * 3,
        vy: -Math.random() * 1.6 - 0.4,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.45,
        size: 3 + Math.random() * 3,
        life: GLASS_SHARD_LIFE
      });
    }
  }

  function breakGlassPane(pane) {
    if (!pane.glass || pane.broken) return false;
    pane.broken = true;
    var idx = platforms.indexOf(pane);
    if (idx !== -1) platforms.splice(idx, 1);
    spawnGlassShards(pane);
    return true;
  }

  function breakGlassInRadius(x, y, radius) {
    for (var i = platforms.length - 1; i >= 0; i--) {
      var plat = platforms[i];
      if (!plat.glass) continue;
      var nx = Math.max(plat.x, Math.min(x, plat.x + plat.w));
      var ny = Math.max(plat.y, Math.min(y, plat.y + plat.h));
      var dx = nx - x;
      var dy = ny - y;
      if (dx * dx + dy * dy <= radius * radius) breakGlassPane(plat);
    }
  }

  function updateGlassShards() {
    for (var i = glassShards.length - 1; i >= 0; i--) {
      var s = glassShards[i];
      s.vy += PLAYER_GRAVITY;
      s.x += s.vx;
      s.y += s.vy;
      s.angle += s.spin;
      s.life--;
      if (s.life <= 0) glassShards.splice(i, 1);
    }
  }

  function restoreGlassPanes() {
    glassShards.length = 0;
    for (var i = 0; i < glassPanes.length; i++) {
      var pane = glassPanes[i];
      if (pane.broken) {
        pane.broken = false;
        platforms.push(pane);
      }
    }
  }

  function updateWeaponItems() {
    // Dropped weapons fly with physics and come to rest; pickupDelay is the
    // grace period before a dropped weapon can be grabbed again
    for (var i = weaponItems.length - 1; i >= 0; i--) {
      var it = weaponItems[i];
      if (it.taken) { weaponItems.splice(i, 1); continue; }
      if (it.ttl && it.ttl > 0) {
        it.ttl--;
        if (it.ttl <= 0) { weaponItems.splice(i, 1); continue; }
      }
      if (it.pickupDelay > 0) it.pickupDelay--;
      if (!it.vx && !it.vy) continue;
      it.vy += PLAYER_GRAVITY;
      var steps = Math.max(1, Math.round(Math.sqrt(it.vx * it.vx + it.vy * it.vy) / BULLET_SUBSTEP_PX));
      var prevY = it.y;
      for (var s = 0; s < steps; s++) {
        prevY = it.y;
        it.x += it.vx / steps;
        it.y += it.vy / steps;
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.ladder) continue;
          var surfaceY = platformBoundaryForSpan(plat, it.x - 4, it.x + 4, false);
          if (surfaceY !== null && prevY <= surfaceY && it.y >= surfaceY) {
            it.y = surfaceY; // rest on the surface
            if (it.vy > 0) {
              it.vy = -it.vy * 0.4;
              if (Math.abs(it.vy) < 1) it.vy = 0;
            }
            it.vx *= 0.8;
            if (Math.abs(it.vx) < 0.05) it.vx = 0;
            break;
          }
        }
      }
    }
    // Random respawn of weapons at spawn points every ~5-8 seconds
    weaponRespawnTimer--;
    if (weaponRespawnTimer <= 0) {
      weaponRespawnTimer = 300 + Math.floor(Math.random() * 180);
      var catalog = [MELEE_WEAPONS.machete, MELEE_WEAPONS.axe, MELEE_WEAPONS.sword, GUNS.pistol, HEALTH_PILLS, HEALTH_MEDKIT];
      var wp = weaponSpawnPoints[Math.floor(Math.random() * weaponSpawnPoints.length)];
      weaponItems.push({
        weapon: catalog[Math.floor(Math.random() * catalog.length)],
        x: wp.x,
        y: wp.y,
        taken: false,
        pickupDelay: 0,
        ttl: 480
      });
    }
  }

  // ---------- Round: death, slow-motion, restart (extracted model) ----------
  var SPAWN1 = { x: 80, y: 516 };
  var SPAWN2 = { x: 560, y: 440 };

  function startSlowmo() {
    // SlowmoData(0, 48, 24, 0.2): ramp in 48f to game_speed 0.2, out 24f
    slowmoPhase = { mode: 'in', t: 0 };
  }

  function updateSlowmo() {
    if (!slowmoPhase) return;
    if (slowmoPhase.mode === 'in') {
      slowmoPhase.t++;
      gameSpeed = 1 - (1 - SLOWMO_SPEED) * (slowmoPhase.t / SLOWMO_RAMP_IN);
      if (slowmoPhase.t >= SLOWMO_RAMP_IN) {
        slowmoPhase.mode = 'hold';
        gameSpeed = SLOWMO_SPEED;
      }
    } else if (slowmoPhase.mode === 'hold') {
      if (!roundOver) {
        slowmoPhase.mode = 'out';
        slowmoPhase.t = 0;
      }
    } else {
      slowmoPhase.t++;
      gameSpeed = SLOWMO_SPEED + (1 - SLOWMO_SPEED) * (slowmoPhase.t / SLOWMO_RAMP_OUT);
      if (slowmoPhase.t >= SLOWMO_RAMP_OUT) {
        slowmoPhase = null;
        gameSpeed = 1;
      }
    }
  }

  var lastPickedSpawn = -1;
  function pickSpawnPoint() {
    var idx = Math.floor(Math.random() * playerSpawns.length);
    if (idx === lastPickedSpawn) idx = (idx + 1) % playerSpawns.length;
    lastPickedSpawn = idx;
    return playerSpawns[idx];
  }

  // Teleport a fighter onto a spawn point. Keeps hp on purpose: this is also
  // the mid-round "fell outside the level" respawn.
  function placeAtSpawnPoint(p, sp) {
    p.x = sp.x;
    p.y = sp.y - p.h; // spawn.y is the FEET level
    p.airVelocityX = 0;
    p.airVelocityY = 0;
    p.onGround = true;
    p.groundedPlatform = null;
    p.falling = false;
    p.knockedDown = false;
    p.knockedDownFrame = 0;
    p.wallJumping = false;
    // A respawn is a teleport: snap the framing instead of panning across the map.
    updateCamera(true);
  }

  function respawnAtSpawnPoint(p) {
    // PlayerOutsideLevel -> the level's spawn table (16 extracted points)
    placeAtSpawnPoint(p, pickSpawnPoint());
  }

  // A new round is a full reset: without hp = 100 the loser keeps hp <= 0 and
  // the death block drops him straight back into the lying pose.
  function resetFighterForRound(p) {
    p.hp = 100;
    p.lastDirX = 1;
    p.jumping = false;
    p.jumpPushTimeLeft = 0;
    p.rolling = false;
    p.rollFrame = 0;
    p.staggering = false;
    p.staggerTimer = 0;
    p.stunTimer = 0;
    p.punching = false;
    p.punchFrame = 0;
    p.punchComboNr = 1;
    p.punchQueued = false;
    p.punchHitPerformed = false;
    p.jumpKickPerformed = false;
    p.jumpKickQueued = false;
    p.airbornTimer = 0;
    p.diving = false;
    p.shortDiveAvailable = false;
    p.shortDiveTimer = 0;
    p.portalCooldown = 0;
    p._portalLocked = false;
    p.climbing = false;
    p.wallJumping = false;
    p.wallPose = 0;
    p.cloudDropArmed = 0;
    p.performJumpDown = false;
    p.jumpDownPosYDisable = 0;
    p.running = false;
    p.sprinting = false;
    p.walkFrame = 0;
    p.sprintEnergy = 100;
    p.sprintArmed = 0;
    p.reSprintWindow = 0;
    p.equipped = MELEE_WEAPONS.fists;
    p.ranged = null;
    p.throwable = { ammo: GRENADE.ammo };
    p.aiming = false;
    p.aimMode = 0;
    p.aimPitch = 0;
    p.aimPitchSpeed = 0;
    p.aimTurningAround = false;
    p.aimTurningAroundTimer = 0;
    p.throwTimer = 0;
    p.startAimASAP = false;
    p.weaponCooldown = 0;
    p.muzzleFlash = 0;
    p.aimSquare = null;
    p.kickCooldown = 0;
    p.kickFlash = 0;
    p.hitFlash = 0;
    p.grabbedBy = null;
    p.grabbedPlayerNr = 0;
    p.throwPose = 0;
    p.grabPhase = 0;
    p.grabT = 0;
    placeAtSpawnPoint(p, pickSpawnPoint());
  }

  function populateWeaponSpawns() {
    // The level's 6 weapon spawn points get a random catalog weapon
    var catalog = [MELEE_WEAPONS.machete, MELEE_WEAPONS.axe, MELEE_WEAPONS.sword, GUNS.pistol, HEALTH_PILLS, HEALTH_MEDKIT];
    weaponItems.length = 0;
    for (var i = 0; i < weaponSpawnPoints.length; i++) {
      var wp = weaponSpawnPoints[i];
      weaponItems.push({
        weapon: catalog[Math.floor(Math.random() * catalog.length)],
        x: wp.x,
        y: wp.y,
        taken: false,
        pickupDelay: 0,
        ttl: 480 // despawn after 480 ticks (8s) like Superfighters
      });
    }
  }

  function restartRound() {
    roundOver = null;
    restartTimer = 0;
    lastPickedSpawn = -1;
    resetFighterForRound(player1);
    resetFighterForRound(player2);
    populateWeaponSpawns();
    bullets.length = 0;
    grenades.length = 0;
    explosions.length = 0;
    weaponRespawnTimer = 300;
    restoreGlassPanes();
    for (var i = weaponItems.length - 1; i >= 6; i--) weaponItems.splice(i, 1);
    for (i = 0; i < weaponItems.length; i++) {
      weaponItems[i].taken = false;
      weaponItems[i].vx = 0;
      weaponItems[i].vy = 0;
      weaponItems[i].pickupDelay = 0;
    }
    if (slowmoPhase) slowmoPhase.mode = 'out'; // ramp the speed back up
    if (!slowmoPhase) gameSpeed = 1;
  }

  // ---------- Bot AI (artifact states, synthetic SetBotKey input) ----------
  // The bot writes into the SAME key channels the human uses (SetBotKey
  // semantics): keys + keysJustPressed/Released transitions.

  function botHold(bot, code, want) {
    var has = !!keys[code];
    if (want && !has) {
      keys[code] = true;
      keysJustPressed[code] = true;
    } else if (!want && has) {
      keys[code] = false;
      keysJustReleased[code] = true;
    }
    if (bot.lastApplied === undefined) bot.lastApplied = {};
    bot.lastApplied[code] = want; // remember what THE BOT set (release-ownership)
  }

  function botObstacleAhead(bot, dir) {
    // BotObstacleAt / BotCanJump: a side-wall blocks the walk path
    var probeX = bot.x + (dir > 0 ? bot.w + 6 : -6);
    var feetY = bot.y + bot.h - 2;
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (
        pointInPlatform(probeX, feetY, plat) ||
        (probeX > plat.x && probeX < plat.x + plat.w &&
          feetY >= plat.y + plat.h && feetY < plat.y + plat.h + 30)
      ) {
        return true;
      }
    }
    return bot.x <= 2 || bot.x + bot.w >= GAME_WIDTH - 2;
  }


  function nearestUntakenItem(bot, maxDist) {
    var best = null;
    var bestD = maxDist;
    for (var i = 0; i < weaponItems.length; i++) {
      var it = weaponItems[i];
      if (it.taken) continue;
      var d = Math.abs(it.x - (bot.x + bot.w / 2));
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best;
  }

  function botRungGoal(bot, goalFeetY) {
    // The nearest climb point (just outside a platform edge) whose top is one
    // full jump above the bot's current feet and at/below the goal level
    var feet = bot.y + bot.h;
    var bc = bot.x + bot.w / 2;
    var best = null;
    var bestD = 1e9;
    var drift = 0;
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (plat.y > goalFeetY + 4) continue;  // below the goal level
      if (plat.y > feet - 26) continue;      // no climb needed
      if (plat.y < feet - 78) continue;      // beyond a single full jump
      var c1 = plat.x - bot.w / 2 - 4;       // just outside the left edge
      var c2 = plat.x + plat.w + bot.w / 2 + 4; // just outside the right edge
      var d1 = Math.abs(c1 - bc);
      var d2 = Math.abs(c2 - bc);
      if (d1 < bestD) { bestD = d1; best = c1; drift = 1; }
      if (d2 < bestD) { bestD = d2; best = c2; drift = -1; }
    }
    return best !== null ? { x: best, drift: drift } : null;
  }

  function botLineClear(bot, target) {
    // Sample the bullet path muzzle -> target center; any platform in between
    // blocks the shot. Fine sampling (12px) — coarse samples graze edges.
    var mx = bot.x + (bot.lastDirX > 0 ? bot.w + 6 : -6);
    var my = bot.y + 16;
    var tdx = (target.x + target.w / 2) - mx;
    var tdy = (target.y + target.h / 2) - my;
    var dist = Math.sqrt(tdx * tdx + tdy * tdy);
    var steps = Math.ceil(dist / 12);
    for (var s = 1; s <= steps; s++) {
      var x = mx + (tdx * s) / steps;
      var y = my + (tdy * s) / steps;
      for (var pi = 0; pi < platforms.length; pi++) {
        var plat = platforms[pi];
        if (pointInPlatform(x, y, plat)) {
          return false;
        }
      }
    }
    return true;
  }

  function botPlan(bot, target) {
    bot.think = BOT_THINK_MIN + Math.floor(Math.random() * BOT_THINK_RAND);
    bot.wantDir = 0;
    bot.wantSprint = false;
    bot.wantJump = false;
    bot.wantPunch = false;
    bot.wantKick = false;
    bot.wantRoll = false;
    bot.wantShoot = false;
    bot.wantNade = false;
    if (target.hp <= 0 || bot.hp <= 0) return; // BotGoForReset stub: idle

    var dx = (target.x + target.w / 2) - (bot.x + bot.w / 2);
    var dy = (target.y + target.h / 2) - (bot.y + bot.h / 2);
    var adx = Math.abs(dx);
    var gap = adx - (target.w + bot.w) / 2; // empty space between the bodies
    var dir = dx > 0 ? 1 : -1;

    // BotDodgeBullet: a bullet closing in from the front -> roll (needs running)
    var dodging = false;
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      if (b.owner === bot.id) continue;
      var toBot = (bot.x + bot.w / 2) - b.x;
      var closing = Math.abs(toBot) < BOT_DODGE_BULLET_PX && Math.sign(toBot) === Math.sign(b.vx || 1);
      if (closing && bot.onGround) dodging = true;
    }
    if (dodging) {
      bot.wantDir = dir;
      bot.wantRoll = true;
      return;
    }

    // While dragging a grabbed victim: keep walking (the grab cycle throws)
    if (bot.grabbedPlayerNr) {
      bot.wantDir = dir;
      return;
    }

    // Tackle opportunity: sprint at the target when medium-close to catch them
    if (gap < 90 && gap > 14 && Math.abs(dy) < 20 && bot.onGround && Math.random() < 0.5) {
      bot.wantDir = dir;
      bot.wantSprint = true;
      bot.wantRoll = true; // DOWN while sprinting = dive tackle catch
      return;
    }

    // BotStateMelee: the melee zone owns the decision — close and punch, never
    // detour to items while a target is this close
    if (gap < 14 && Math.abs(dy) < 30) {
      bot.wantDir = dir;
      if (gap < 5) {
        bot.wantPunch = Math.random() < 0.7;
        bot.wantKick = !bot.wantPunch && Math.random() < 0.5;
      }
      return;
    }

    // BotStateShoot / BotStateAim: armed, target IN FRONT of the muzzle, clear
    // path — the bot stops to shoot (BotStateShoot is a stance in the artifact)
    if (bot.ranged && bot.ranged.ammo > 0 && adx > BOT_SHOOT_MIN && adx < BOT_SHOOT_MAX && Math.abs(dy) < 90) {
      var smx = bot.x + (bot.lastDirX > 0 ? bot.w + 6 : -6);
      var front = ((target.x + target.w / 2) - smx) * bot.lastDirX > 0;
      if (front && botLineClear(bot, target)) {
        bot.wantShoot = true;
        bot.wantDir = 0; // hold position while shooting
        return;
      }
    }

    // Grenade at mid range, occasionally
    if (bot.throwable && bot.throwable.ammo > 0 && adx > BOT_MELEE_RANGE + 40 && adx < 260 && Math.random() < 0.35) {
      bot.wantNade = true;
      bot.wantDir = dir;
      return;
    }

    // The target below (the bot is on a platform, the target on lower ground):
    // walk to the nearest edge of the platform the bot stands on and drop
    if (dy > 30 && bot.onGround) {
      var ownPlat = null;
      var probeY = bot.y + bot.h + 1;
      for (var oi = 0; oi < platforms.length; oi++) {
        var op = platforms[oi];
        if (op.y < 560) continue; // only elevated platforms matter here
        if (
          bot.x + bot.w > op.x && bot.x < op.x + op.w &&
          probeY > op.y && probeY < op.y + op.h
        ) { ownPlat = op; break; }
      }
      if (ownPlat) {
        var leftEdge = ownPlat.x - bot.w / 2 - 2;
        var rightEdge = ownPlat.x + ownPlat.w + bot.w / 2 + 2;
        bot.wantDir =
          Math.abs(leftEdge - (bot.x + bot.w / 2)) <
          Math.abs(rightEdge - (bot.x + bot.w / 2))
            ? -1
            : 1;
        return;
      }
    }

    // Vertical navigation (shared): the target or an item is above the jump
    // reach -> navigate rung by rung to the nearest climbable edge
    var targetAbove = (target.y + target.h) < bot.y + bot.h - 30;
    var upGoal = null;
    var unarmed = bot.equipped === MELEE_WEAPONS.fists && !bot.ranged;
    var item = unarmed ? nearestUntakenItem(bot, BOT_PICKUP_RANGE) : null;
    if (targetAbove) upGoal = target.y + target.h;
    else if (item && item.y < bot.y + bot.h - 14) upGoal = item.y + 8;

    if (upGoal !== null) {
      var rung = botRungGoal(bot, upGoal);
      if (rung) {
        var rdist = rung.x - (bot.x + bot.w / 2);
        if (Math.abs(rdist) < 10) {
          bot.wantDir = rung.drift; // at the climb point: arc inward
          bot.wantJump = true;
        } else {
          bot.wantDir = rdist > 0 ? 1 : -1;
          bot.wantJump = false; // the arc is led by the climb point
        }
        bot.wantSprint = false;
        return;
      }
    }

    // BotStateGrabWeapon / BotAutoPickupItem: unarmed and the item is reachable
    if (item) {
      var idist = item.x - (bot.x + bot.w / 2);
      if (Math.abs(idist) < 10) bot.wantDir = 0;
      else bot.wantDir = idist > 0 ? 1 : -1;
      bot.wantSprint = false;
      bot.wantShoot = false;
      return;
    }

    // BotStateFollowPath (simplified): pursue while there is a gap; sprint far;
    // jump at obstacles
    bot.wantDir = dir;
    bot.wantSprint = adx > BOT_SPRINT_DISTANCE; // RunOften
    if (botObstacleAhead(bot, dir)) bot.wantJump = true;
  }

  function botDrive(bot, target) {
    if (bot.lastApplied === undefined) bot.lastApplied = {};
    if (!botActive) {
      // Release ONLY the keys the bot itself had set; the human's held keys
      // are untouched (this forced-release was blocking P2's arrows entirely)
      for (var bk in bot.lastApplied) {
        if (bot.lastApplied[bk] && keys[bk]) {
          keys[bk] = false;
          keysJustReleased[bk] = true;
        }
        bot.lastApplied[bk] = false;
      }
      return;
    }
    if (bot.think === undefined || bot.think <= 0) botPlan(bot, target);
    bot.think--;

    // Single authority per key: compute ALL desires first, apply ONCE at the end
    // (multiple holders used to cancel each other's up/down holds every frame)
    var upWant = false;
    var downWant = false;

    // Jump: edge + HOLD for the push (a full 47px jump clears the platform deltas)
    if (bot.jumpHold === undefined) bot.jumpHold = 0;
    if (bot.wantJump) {
      keysJustPressed[bot.binding.up] = true; // jump edge (BotCanJump)
      keys[bot.binding.up] = true;
      bot.jumpHold = 12;
      bot.wantJump = false;
    }
    if (bot.jumpHold > 0) {
      bot.jumpHold--;
      upWant = bot.jumpHold > 0;
    }

    // Roll: one-frame down edge (needs running)
    if (bot.wantRoll) {
      downWant = true;
      bot.wantRoll = false;
    }

    // Grab cycle (from the tackle catch): drag toward an obstacle then throw
    if (bot.grabPhase === undefined) bot.grabPhase = 0;
    if (bot.grabPhase === 0 && bot.grabbedPlayerNr) {
      bot.grabPhase = 1;
      bot.grabT = 25 + Math.floor(Math.random() * 30); // drag frames
    }
    if (bot.grabPhase === 1) {
      if (!bot.grabbedPlayerNr) {
        bot.grabPhase = 0;
      } else {
        bot.grabT--;
        if (bot.grabT <= 0) {
          keysJustPressed[bot.binding.punch] = true; // THROW the held victim
          bot.grabPhase = 0;
        }
      }
    }

    // Fire cycle (BotStateAim -> BotStateShoot): press, sweep the pitch to the
    // target's center with the angle solver, release to fire when aligned
    if (bot.firePhase === undefined) bot.firePhase = 0;
    if (bot.firePhase === 0 && bot.wantShoot && !bot.aiming && bot.onGround) {
      bot.firePhase = 1;
      bot.fireT = 6 + Math.floor(Math.random() * 10);
      botHold(bot, bot.binding.fire, true); // arm the aim (RangedDown)
    }
    if (bot.firePhase === 1) {
      if (!bot.aiming || !bot.ranged || bot.ranged.ammo <= 0 || bot.hp <= 0) {
        botHold(bot, bot.binding.fire, false); // interrupted: drop the cycle
        bot.firePhase = 0;
      } else {
        var mx = bot.x + (bot.lastDirX > 0 ? bot.w + 6 : -6);
        var my = bot.y + 16;
        var tdx = (target.x + target.w / 2) - mx;
        var tdy = (target.y + target.h / 2) - my;
        // The pitch is measured from the FACING direction: the bullet's vx is
        // dir * cos(pitch) * speed, so the needed angle uses the forward dx
        var forwardDx = tdx * bot.lastDirX;
        var needed = Math.atan2(tdy, forwardDx) * (180 / Math.PI);
        var err = needed - bot.aimPitch;
        if (err < -3) upWant = true;   // sweep up
        if (err > 3) downWant = true;  // sweep down
        bot.fireT--;
        if (Math.abs(err) < 3 || bot.fireT <= -30) {
          botHold(bot, bot.binding.fire, false); // release fires (RangedUp)
          bot.firePhase = 0;
          bot.wantShoot = false;
        }
      }
    }

    // Grenade cycle (ThrowDown/ThrowUp): cook then release
    if (bot.nadePhase === undefined) bot.nadePhase = 0;
    if (bot.nadePhase === 0 && bot.wantNade && !bot.aiming && bot.onGround) {
      bot.nadePhase = 1;
      bot.nadeT = BOT_COOK_MIN + Math.floor(Math.random() * BOT_COOK_RAND);
      botHold(bot, bot.binding.throw, true);
    }
    if (bot.nadePhase === 1) {
      if (!bot.aiming || !bot.throwable || bot.throwable.ammo <= 0) {
        botHold(bot, bot.binding.throw, false);
        bot.nadePhase = 0;
      } else {
        bot.nadeT--;
        if (bot.nadeT <= 0) {
          botHold(bot, bot.binding.throw, false); // release throws
          bot.nadePhase = 0;
          bot.wantNade = false;
        }
      }
    }

    // Movement + attack edges (applied once)
    // Sprint has no key: the bot double-taps the movement direction (release for
    // one frame, press again) exactly like a player, through the same channels.
    if (bot.sprintTap === undefined) bot.sprintTap = 0;
    var moveDir = bot.wantDir;
    if (bot.sprintTap > 0) {
      bot.sprintTap--;
      if (bot.sprintTap === 0) bot.sprintPress = true;
      moveDir = 0;
    } else if (bot.wantSprint && !bot.sprinting && bot.onGround && bot.wantDir !== 0 && bot.sprintEnergy > 10) {
      bot.sprintTap = 1;
      moveDir = 0;
    }
    if (bot.sprintPress) {
      bot.sprintPress = false;
      moveDir = bot.wantDir;
    }
    botHold(bot, bot.binding.left, moveDir < 0);
    botHold(bot, bot.binding.right, moveDir > 0);
    botHold(bot, bot.binding.up, upWant);
    botHold(bot, bot.binding.down, downWant);
    if (bot.wantPunch) {
      keysJustPressed[bot.binding.punch] = true; // melee edge (combo chains)
      bot.wantPunch = false;
    }
    if (bot.wantKick) {
      keysJustPressed[bot.binding.kick] = true;
      bot.wantKick = false;
    }
  }

  populateWeaponSpawns(); // the level starts with weapons spawned (like the original)

  // ---------- Main loop (fixed timestep at 60 FPS) ----------
  var accumulator = 0;
  var lastTime = performance.now();

  function updateElevator() {
    elevator.t += (elevator.omega * gameSpeed) / FPS;
    // The source's 183 px linkage and rotating motor return to the base height
    // after one cycle; cosine keeps the extracted start position and travel.
    elevator.y = elevator.baseY - (elevator.travel / 2) * (1 - Math.cos(elevator.t));
  }

  function updateStep() {
    // Move the platform before players so grounding and rider carry use the
    // same fixed simulation step.
    updateElevator();
    botDrive(player2, player1);
    player1.update(player2);
    player2.update(player1);
    updateBullets();
    updateGrenades();
    updateExplosions();
    updateGlassShards();
    updateWeaponItems();
    updateCrates();

    // The pit (OutsideTheWorld): out of the map -> respawn at a level spawn
    if (player1.y > 640) respawnAtSpawnPoint(player1);
    if (player2.y > 640) respawnAtSpawnPoint(player2);
    updateCamera();
    // Round end detection (ActivateSlowmotion: the kill leaves one side)
    if (!roundOver) {
      if (player1.hp <= 0 && player2.hp <= 0) {
        roundOver = { winnerId: 0 }; // double kill: draw
        startSlowmo();
        restartTimer = ROUND_RESTART_FRAMES;
      } else if (player1.hp <= 0) {
        roundOver = { winnerId: 2 };
        startSlowmo();
        restartTimer = ROUND_RESTART_FRAMES;
      } else if (player2.hp <= 0) {
        roundOver = { winnerId: 1 };
        startSlowmo();
        restartTimer = ROUND_RESTART_FRAMES;
      }
    } else {
      restartTimer--;
      if (restartTimer <= 0) restartRound();
    }
    updateSlowmo();
    clearJustPressed();
  }

  function drawBullets() {
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      if (b.trail && b.trail.length > 1) {
        var grad = ctx.createLinearGradient(b.trail[0].x, b.trail[0].y, b.x, b.y);
        grad.addColorStop(0, 'rgba(255,233,163,0)');
        grad.addColorStop(1, 'rgba(255,233,163,0.9)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.trail[0].x, b.trail[0].y);
        for (var t = 1; t < b.trail.length; t++) {
          ctx.lineTo(b.trail[t].x, b.trail[t].y);
        }
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,244,210,0.95)';
        ctx.beginPath();
        ctx.arc(b.x, b.y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,233,163,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  function drawGrenades() {
    for (var i = 0; i < grenades.length; i++) {
      var g = grenades[i];
      px(g.x - 3, g.y - 3, 7, 7, '#3f5a3f');
      px(g.x - 3, g.y - 3, 7, 2, '#2a3f2a');
      // Fuse blink accelerates near zero
      var blink = g.fuse > 40 ? (g.fuse >> 3) & 1 : (g.fuse >> 1) & 1;
      if (blink) px(g.x - 1, g.y - 5, 3, 2, '#ff5050');
    }
  }

  function drawExplosions() {
    for (var i = 0; i < explosions.length; i++) {
      var e = explosions[i];
      var t = e.frame / GRENADE_EXPLOSION_FRAMES;
      var r = e.radius * (0.3 + 0.7 * t);
      ctx.strokeStyle = 'rgba(255,200,80,' + (1 - t) + ')';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,200,' + (1 - t) * 0.7 + ')';
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  var STATION = { x0: 470 }; // where the police station facade begins

  // ---------- Map dressing (Police Station pixel-art, procedural) ----------
  function drawCrate(x, yBottom, size) {
    var s = size || 16;
    drawCrateBox(x, yBottom - s, s);
  }

  function drawBarrel(x, yBottom) {
    var w = 13, h = 17, y = yBottom - h;
    px(x, y, w, h, '#c04038');
    px(x, y, w, 2, '#e06a58');
    px(x, y + h - 2, w, 2, '#802820');
    px(x, y + 4, w, 2, '#802820');
    px(x, y + h - 7, w, 2, '#802820');
    px(x + 1, y + 2, 2, h - 4, 'rgba(255,255,255,0.15)');
  }

  function drawFence(x0, x1, groundY) {
    // Chain-link fence: posts + two wires + diamond hint
    ctx.strokeStyle = '#5a6a72';
    ctx.lineWidth = 1;
    for (var x = x0; x <= x1; x += 62) {
      px(x, groundY - 34, 3, 34, '#8a949c');
      px(x - 1, groundY - 36, 5, 3, '#8a949c');
    }
    ctx.beginPath();
    ctx.moveTo(x0, groundY - 30); ctx.lineTo(x1, groundY - 30);
    ctx.moveTo(x0, groundY - 16); ctx.lineTo(x1, groundY - 16);
    ctx.moveTo(x0, groundY - 3); ctx.lineTo(x1, groundY - 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,140,150,0.35)';
    ctx.beginPath();
    for (var d = x0; d < x1; d += 8) {
      ctx.moveTo(d, groundY - 30); ctx.lineTo(d + 6, groundY - 3);
      ctx.moveTo(d + 6, groundY - 30); ctx.lineTo(d, groundY - 3);
    }
    ctx.stroke();
  }

  function drawWindmill(x, baseY) {
    // Tower: tapering teal truss with cross braces
    var topY = baseY - 250;
    var halfBase = 26, halfTop = 9;
    ctx.strokeStyle = '#2e9c8a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - halfBase, baseY); ctx.lineTo(x - halfTop, topY + 14);
    ctx.moveTo(x + halfBase, baseY); ctx.lineTo(x + halfTop, topY + 14);
    ctx.stroke();
    ctx.lineWidth = 2;
    for (var lvl = 1; lvl <= 6; lvl++) {
      var t = lvl / 6;
      var y = baseY - (baseY - topY - 14) * t;
      var half = halfBase + (halfTop - halfBase) * t;
      ctx.beginPath();
      ctx.moveTo(x - half, y); ctx.lineTo(x + half, y); // ring
      if (lvl < 6) {
        var t2 = (lvl + 1) / 6;
        var y2 = baseY - (baseY - topY - 14) * t2;
        var half2 = halfBase + (halfTop - halfBase) * t2;
        ctx.moveTo(x - half, y); ctx.lineTo(x + half2, y2); // brace
        ctx.moveTo(x + half, y); ctx.lineTo(x - half2, y2);
      }
      ctx.stroke();
    }
    // Hub + 8 spinning blades (windmill_propeller)
    var hubX = x, hubY = topY;
    var angle = Date.now() / 1000 * 0.9;
    ctx.strokeStyle = '#d8dce4';
    ctx.lineWidth = 3;
    for (var b = 0; b < 8; b++) {
      var a = angle + (b * Math.PI) / 4;
      var dx = Math.cos(a), dy = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(hubX + dx * 6, hubY + dy * 6);
      ctx.lineTo(hubX + dx * 52, hubY + dy * 52);
      ctx.stroke();
      // paddle
      var px0 = hubX + dx * 20, py0 = hubY + dy * 20;
      ctx.save();
      ctx.translate(px0, py0);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = '#e8ecf4';
      ctx.fillRect(-2, -3, 30, 6);
      ctx.restore();
    }
    px(hubX - 4, hubY - 4, 8, 8, '#1a1e28');
  }

  function drawSignPost(x, yBottom) {
    px(x - 1, yBottom - 26, 3, 26, '#c8ccd4');
    px(x - 8, yBottom - 38, 16, 13, '#e8e4da');
    ctx.strokeStyle = '#d0453a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 5, yBottom - 35); ctx.lineTo(x + 5, yBottom - 28);
    ctx.moveTo(x + 5, yBottom - 35); ctx.lineTo(x - 5, yBottom - 28);
    ctx.stroke();
  }

  function drawJailWindow(x, y, w, h) {
    // Dark window with white bars (the station's cell windows)
    px(x - 2, y - 2, w + 4, h + 4, '#c8ccd4'); // frame
    px(x, y, w, h, '#05060a');
    var bars = Math.max(3, Math.floor(w / 12));
    for (var b = 0; b < bars; b++) {
      px(x + 3 + (b * (w - 6)) / Math.max(1, bars - 1) - 1, y, 2, h, '#e8ecf4');
    }
    px(x, y + h / 2 - 1, w, 2, '#e8ecf4'); // horizontal bar
  }

  function drawRedLamas(x, y, w, h) {
    // The red slatted wall of the ground floor
    px(x, y, w, h, '#1a0f0c');
    for (var ly = y + 2; ly < y + h - 2; ly += 6) {
      px(x + 2, ly, w - 4, 4, '#b03828');
      px(x + 2, ly, w - 4, 1, '#d85848');
    }
    for (var pxl = x + 4; pxl < x + w - 4; pxl += 26) {
      px(pxl, y + 2, 3, h - 4, '#701e18'); // vertical dividers
    }
  }

  function drawShelfUnit(x, yBottom, w, h) {
    var y = yBottom - h;
    px(x, y, 3, h, '#8a8f96');
    px(x + w - 3, y, 3, h, '#8a8f96');
    for (var sy = y + 14; sy < yBottom - 2; sy += 18) {
      px(x, sy, w, 2, '#9aa2ab');
      drawCrate(x + 7, sy, 11);
      px(x + w - 20, sy - 8, 12, 8, '#c04038'); // small crate on the shelf
    }
    ctx.strokeStyle = '#6a7482';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + w - 3, yBottom - 3);
    ctx.moveTo(x + w - 3, y + 3); ctx.lineTo(x + 3, yBottom - 3);
    ctx.stroke();
  }

  function drawPipe(x, y, w, h) {
    px(x, y, w, h, '#2e9c8a');
    px(x, y, w, 2, '#5ec4b2');
    if (h > w) {
      px(x - 2, y + 8, w + 4, 3, '#1a6e60');
      px(x - 2, y + h - 12, w + 4, 3, '#1a6e60');
    }
  }

  function drawConcreteSteps(x0, groundY) {
    // The concrete staircase by the station's left edge
    for (var i = 0; i < 4; i++) {
      var w = 50 + i * 12;
      var x = x0 + (3 - i) * 12 - 12;
      var y = groundY + 14 + i * 14;
      px(x, y, w, 14, '#b6bac2');
      px(x, y, w, 2, '#e8ecf0');
      px(x, y + 12, w, 2, '#7a7e88');
    }
  }

  function drawMapDressing(viewX, viewW) {
    var right = viewX + viewW;
    function vis(x, w) { return x + w >= viewX && x <= right; }
    // ---- exterior side ----
    if (viewX < STATION.x0) {
      drawFence(6, 376, 459);
      drawWindmill(168, 459);
      drawSignPost(19, 386);
      // props on the outdoor floor
      drawBarrel(96, 459);
      drawBarrel(348, 459);
      drawBarrel(104, 396); // on the low cloud shelf
    }
    // ---- station side ----
    // ground floor: windows + red slats + pipe
    if (vis(620, 200)) {
      drawJailWindow(628, 478, 56, 54);
      drawRedLamas(700, 476, 96, 68);
      drawPipe(612, 476, 6, 66);
      drawBarrel(560, 466);
    }
    // first floor
    if (vis(450, 300)) {
      drawJailWindow(470, 356, 56, 48);
      drawJailWindow(560, 356, 56, 48);
      drawShelfUnit(655, 339, 55, 76);
      drawPipe(735, 345, 5, 60);
    }
    // second floor
    if (vis(450, 300)) {
      drawJailWindow(470, 266, 56, 48);
      drawJailWindow(640, 266, 60, 48);
      drawBarrel(740, 261);
    }
    drawConcreteSteps(560, 512);
  }

  function drawBackdrop(viewX, viewY, viewW, viewH) {
    var left = viewX, right = viewX + viewW;
    var top = Math.max(viewY, -300);
    var skyBottom = 460; // the horizon line: ground sits at ~459
    // Sky gradient (blue, brighter at the top like the screenshot)
    var grad = ctx.createLinearGradient(0, top, 0, skyBottom);
    grad.addColorStop(0, '#2226e0');
    grad.addColorStop(1, '#1012a2');
    ctx.fillStyle = grad;
    ctx.fillRect(left, top, viewW, skyBottom - top);
    if (viewY + viewH > skyBottom) {
      px(left, skyBottom, viewW, viewY + viewH - skyBottom, '#0a0c10');
    }
    // The station interior is a dark hall, not open sky
    px(STATION.x0, top, GAME_WIDTH - STATION.x0, viewY + viewH - top, '#0b0d13');
    drawClouds(left, right, viewY, viewH);
    drawSkyline(left, right, viewY, viewH);
    // Right brick facade column (the map's right edge)
    if (right > GAME_WIDTH - 22) drawBrickWall(GAME_WIDTH - 22, top, 22, viewY + viewH - top);
    // A dark vignette at the pit bottom (below the floors)
    var pit = ctx.createLinearGradient(0, 460, 0, GAME_HEIGHT);
    pit.addColorStop(0, 'rgba(10,12,16,0)');
    pit.addColorStop(1, 'rgba(10,12,16,0.95)');
    ctx.fillStyle = pit;
    ctx.fillRect(viewX, 460, viewW, GAME_HEIGHT - 460);
  }

  // Deterministic PRNG so clouds/skyline don't reshuffle every frame
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawClouds(left, right, viewY, viewH) {
    if (viewY > 340) return;
    var cell = 150;
    var c0 = Math.floor((left - 100) / cell), c1 = Math.ceil((right + 100) / cell);
    for (var c = c0; c <= c1; c++) {
      if (c % 3 === 0) continue; // gaps between clouds
      var rand = mulberry32(c * 7919 + 13);
      var x = c * cell + rand() * 60;
      var y = 40 + rand() * 300;
      if (x > STATION.x0 - 40) continue;
      var w = 46 + rand() * 50;
      var h = 10 + rand() * 8;
      ctx.fillStyle = '#3a3ee8';
      // cloud silhouette: base slab + bumps on top
      ctx.fillRect(x, y + h, w, 6);
      var bumps = 3 + Math.floor(rand() * 3);
      for (var b = 0; b < bumps; b++) {
        var bw = w / bumps;
        var bh = h + rand() * 10;
        ctx.fillRect(x + b * bw, y + h - bh, bw, bh);
      }
    }
  }

  function drawSkyline(left, right, viewY, viewH) {
    if (viewY > 460) return;
    var cell = 34;
    var c0 = Math.floor(left / cell), c1 = Math.ceil(right / cell);
    for (var c = c0; c <= c1; c++) {
      if (c * cell > STATION.x0 - 20) break;
      var rand = mulberry32(c * 104729 + 7);
      var w = cell - 4 - rand() * 8;
      var h = 40 + rand() * 75;
      var x = c * cell + 2;
      var y = 459 - h;
      px(x, y, w, h, '#151570');
      if (rand() > 0.55) {
        // chimney
        px(x + w * 0.3, y - 14 - rand() * 10, 4, 16, '#151570');
      }
      if (rand() > 0.7) {
        px(x + 3, y + 8, w - 6, 2, '#1c1c86'); // window strip
      }
    }
  }


  function drawHangingLamp(l) {
    // The source anchor, 20 px rope, and lamp body 4 px below the rope end.
    var lampY = l.y + l.ropeLength + 4;
    px(l.x, l.y, 2, l.ropeLength, '#2a2e35');
    px(l.x - 6, lampY - 2, 14, 4, '#3a3e45');
    px(l.x - 4, lampY + 2, 10, 4, '#e8c88a');
    px(l.x - 2, lampY + 6, 6, 2, '#c8a86a');
    // The glow
    ctx.fillStyle = 'rgba(232,200,138,0.08)';
    ctx.beginPath();
    ctx.arc(l.x + 1, lampY + 4, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // Visible world rect, used by the backdrop so it always fills the viewport
    var viewW = GAME_WIDTH / camera.zoom;
    var viewH = GAME_HEIGHT / camera.zoom;
    ctx.save();
    ctx.translate(GAME_WIDTH / 2, GAME_HEIGHT / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    drawBackdrop(camera.x - viewW / 2, camera.y - viewH / 2, viewW, viewH);
    drawMapDressing(camera.x - viewW / 2, viewW);
    for (var i = 0; i < platforms.length; i++) drawPlatform(platforms[i]);
    drawGlassShards();
    for (i = 0; i < hangingLamps.length; i++) drawHangingLamp(hangingLamps[i]);
    for (var wi = 0; wi < weaponItems.length; wi++) {
      var item = weaponItems[wi];
      if (item.taken) continue;
      if (item.ttl && item.ttl <= 192) {
        if (Math.floor(item.ttl / 8) % 2 === 0) continue;
      }
      drawWeaponShape(item.weapon, item.x - 6, item.y - 10);
    }
    drawBullets();
    drawGrenades();
    drawExplosions();
    drawCrates();
    drawPlayer(player1);
    drawPlayer(player2);
    drawHealthBar(player1);
    drawHealthBar(player2);
    // Far-right wall entrances (extracted Police Station) — drawn on top so the
    // player disappears as they enter the black door
    drawPortalEntrance(doorPortals[0], true);
    drawPortalEntrance(doorPortals[1], false);
    ctx.restore();
    drawHud();
  }

  function frame(now) {
    accumulator += Math.min(now - lastTime, 100);
    lastTime = now;
    // Epsilon guards against FP drift producing 0-step / 2-step frames
    while (accumulator >= STEP_MS - 1e-9) {
      updateStep();
      accumulator -= STEP_MS;
    }
    render();
    window.requestAnimationFrame(frame);
  }

  // Debug/test hook (inspect players and platforms from the console)
  window.__sf = {
    players: [player1, player2],
    platforms: platforms,
    crates: crates,
    glassPanes: glassPanes,
    glassShards: glassShards,
    doorPortals: doorPortals,
    camera: camera,
    weapons: MELEE_WEAPONS,
    guns: GUNS,
    grenade: GRENADE,
    weaponItems: weaponItems,
    bullets: bullets,
    grenades: grenades,
    explosions: explosions,
    get gameSpeed() { return gameSpeed; },
    get roundOver() { return roundOver; },
    get botActive() { return botActive; },
    set botActive(v) { botActive = v; },
    restartRound: restartRound,
    explodeGrenade: explodeGrenade,
    damageCrate: damageCrate,
    step: updateStep,
    render: render
  };

  window.requestAnimationFrame(frame);
})();
