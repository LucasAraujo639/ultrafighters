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
 * - MeleeStrike hitbox (port fix, user report): the extractor's center raycast put
 *   every sample inside the 0.6-scaled body, so punches only connected on fully
 *   overlapped fighters and whiffed against anyone standing next to them. The
 *   band is anchored on the FRONT EDGE (4 px inset, Reach ahead, mid-chest row)
 *   and overlaps the victim's whole AABB: the hit depends only on the enemy
 *   hitbox being in range, never on the victim's facing.
 * - PunchPlayer: victim faces the attacker (a first hit from behind turns them
 *   around to face the combo, extracted behavior); aerial victim gets
 *   AirVelocityX += 2 * dir
 *   and Fall(); grounded victim is stunned on links 1-2. The completed combo
 *   (PunchComboNr == 3) or a lethal punch launches the victim:
 *   AirVelocityX = 3 * attacker dir, AirVelocityY = -2.5, then Fall()
 *   (port tuning: 4 / -3 to give the finisher a little more push).
 *   The launcher SPINS the victim away (lastDirX = attacker dir), so the
 *   final flight, landing pose and get-up leave the victim BACK-turned,
 *   flying off with their back to the attacker. Launch case 1 (a lethal punch
 *   on a running victim) keeps the extracted dead-man's momentum and facing.
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
 * - ReleaseThrowable: spawn at the release pose's hand (sprite-model point:
 *   THROW_RELEASE_HAND for the shipped shared 699 release lean, aiming grip
 *   (MidX - 4.5*dir, MidY - 7.5) as fallback), velocity =
 *   (5.5*cos(angle), 5.5*sin(angle) - 2), spin 10*dir, userData [ThrowTimer, owner],
 *   SetBullet(true); Ammo--. The shipped lean (699, shared by grenade and
 *   molotov) holds 6 of the 8 throwPose steps and the pose tail shows the
 *   quick 705 recovery cell.
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
 * Phase 9 additions (top HUD health plate), same extraction method:
 * - PlayerBars.DrawGUIBars draws into the gui_player plate: the HEALTH bar
 *   is 4 px tall, the white sprint-energy bar 4 px tall starting 6 px
 *   lower, each filling from bars_start with length ratio * the strip;
 *   the fill COLOR is GetColor(255 - round(255*r), round(255*r), 40)
 *   (rgb(0,255,40) full -> rgb(255,0,40) empty, blue fixed at 40) and the
 *   energy bar paints white (0xFFFFFF). The plate black backing, its
 *   P1/P2 sign (PlayerTeamColor.SOLO 230,230,230) and a head-portrait box
 *   come from the gui_player_819 art (tinted red placeholder in the dump).
 * - PlayerState._barHP: the DISPLAYED value trails the real HP. The HP
 *   setter snapshots _barHP to the OLD HP, then _healthBarSpeed =
 *   (new - old) / 6 and opens _showHealthTimer = 6; while that timer runs
 *   _barHP += _healthBarSpeed each tick (idle floor -24) — the bar glides
 *   over 6 ticks (0.25 s) after every change instead of jumping. Passive
 *   regen ALSO writes through the setter, so it keeps the bar glued to HP.
 * - Port mapping (user request: top-of-screen plates): P1 top-left, P2
 *   top-right; every HP write (damage / fire / crate impacts / medkits /
 *   regen) routes through the mirrored setter and the trail window scales
 *   6 ticks -> 15 steps at 60 Hz (ANIM_TICKS_TO_STEPS). Death hides the
 *   sign and the bar fills; the plate and portrait remain (Update early
 *   return only clears the drawn children).
 *
 * Scale and camera (design choices): the fighter body, its melee boxes, and its
 * sprite are authored at 28x44 and rendered/collided at PLAYER_SIZE_SCALE (0.6).
 * The camera is a pure viewport transform over the unchanged level geometry: it
 * frames both fighters, zooming in when they close in and out when they separate.
 * Level coordinates, extraction values, and physics constants are untouched.
 *
 * Knockback roll (requested, no artifact counterpart — port design): a launched
 * body (combo finisher / kick / throw / dive flight / explosion blast — all of
 * them set Falling) that hits a solid side or a crate MID-FLIGHT above
 * KNOCKBACK_ROLL_WALL_SPEED keeps a share of the impact pushing AWAY from the
 * surface and TUMBLES (bounce + roll). The tumble renders sprite
 * 606 (knockbackRoll map key), flipped by the impact velocity sign (pushed
 * right rolls facing right, pushed left gets the mirror). Landing rolls are
 * gone (bug fix requested: run + jump must NEVER show or trigger the roll):
 * a touchdown is not an impact event, so plain falls, launched flights that
 * touched down without hitting anything, AND controlled hard landings land
 * the old way (extracted impact formula + lying knockdown, no tumble). The
 * only roll sources are the high-impact family — explosion blast (the blast
 * flight always touches down into the tumble), a crate side slammed at
 * speed, or a head-on wall slam after a flight. CONTROLLED fighters need a
 * sprint-grade crash (KNOCKBACK_ROLL_PLAYER_WALL_SPEED) to tumble off a
 * wall or crate — or the LONG-FREE-FALL grade (KNOCKBACK_ROLL_FREEFALL_VY):
 * dropping from great height and slamming a solid side tumbles as long as
 * the body was really moving INTO the surface; same-floor jump/run touch
 * speeds and straight-down grazes never reach the bars. When the roll
 * stops (or the frame cap fires) the body hands back to the lying knockdown
 * recovery, which returns control when its animation ends. Punching a
 * tumbling body is not allowed (same guard as the lying body); grabs,
 * harder landings on top, or a NEW launch cancel the tumble. The descent
 * sprite never repeats the tumble cell: 606 is the impact roll pose alone
 * (normal jump descent renders the plain [602, 603] pair).
 *
 * Destructible glass (extracted from SOLID_GLASS_01 / b2ContactListener): the
 * panes are hinged dynamic bodies, never walls. ANY contact with a moving body
 * (fighter, crate, grenade, thrown weapon) shatters the pane; a punch or kick
 * (Damage_Impact, resistance 10) also shatters it with KickPower 1.4. Bullets
 * (Strength 0) and rockets PIERCE the pane and keep flying; flames never touch
 * it. Explosions blast the pane with a distance falloff. Shards (GLASS_SHARD_1,
 * one per 6 px) inherit the pane's impulse. A new round rebuilds the panes.
 *
 * Phase 10 additions (the One Matrix mod, requested cheat — port design):
 * - CheatCodeManager now owns TWO written words ('gokussj' -> SSJ2 shell,
 *   'matrix' -> The One shell). Both demand the open-sky ritual and
 *   hand the shells over on the same Arrow-Key fighter: typing the other
 *   word swaps modes, re-typing the current word sheds the mode. While the
 *   typed tail is a live cheat-word prefix, the letters are swallowed
 *   before the bindings (the word's M never fires P2's gun, the word's J
 *   no longer detonates a straggler tele-strike mid-ritual).
 * - MatrixModeState (State pattern, mirrors SuperSaiyan2State) re-themes
 *   J/K/L/;/' (same binding codes, meaning flows by active shell):
 *     J (hold)  Bullet Time — a fourth slow track eases the GLOBAL pace to
 *               30% (MATRIX_BT_TARGET) while the avatar's moveSpeed()
 *               strips the matrix share, so NEOS physics (displacement,
 *               gravity, regen, fire/burn cadence) stays real-time (6s
 *               hold cap + cooldown on release).
 *     K (press) Dodge — backward arc hop with a 14-step shot shield; the
 *               deflection scan flips frontal bullets (they re-own the
 *               avatar's id) and blows rockets off course.
 *     L (hold)  Wall Run — solid sides AND cover crates (131) act as
 *               surfaces inside the probe band, gravity stays skipped
 *               (matrixAirStance) while the fuel gauge drains; ARROW-UP
 *               kicks off the wall (flips facing, spends 20 fuel).
 *     ; (press) Code Reload — the ranged magazine refills whole with a
 *               digital-rain glyph burst (150-step cooldown).
 *     ' (press) Glitch Teleport — warps behind the rival's back side when
 *               the spot is clear (blocked spots retry outward/vertical
 *               hops; a fully blocked warp spends no cooldown).
 * - FX fields: matrixRain glyphs, matrixGlitch shards, visor + aura on
 *   drawPlayerOverlay, bullet-time tint + projectile streaks world layer,
 *   ambient green code motes through the shared SSJ particle system.
 * - The gokussj ritual plays a TRANSFORMATION CUTSCENE built from user art
 *   in the mods folder: the fighter flexes through mods/5000.png..5003.png
 *   (four poses, TRANSFORM_POSE_STEPS each, bottom-anchored at the feet,
 *   smoothing off for the chunky pixels) while mods/gokutransformacion.mp3
 *   rolls. The cutscene PINS the fighter (input lock, zero velocity,
 *   gravity skipped) and cancels on death, grabs, knockdowns or restarts;
 *   the Matrix handover clears it (the One never inherits Goku's flex).
 *
 * Explosion ground fire (extracted Fires.as / FireNodeData): every blast run
 * through explodeAt (grenade, rocket — a red barrel will call the same
 * pipeline) also fires TriggerFireAt('BARREL'): 18 embers fan over the lower
 * semicircle (angle = PI / (count/2) * i), launch speed 2.2 + random 0.4,
 * starting 3 px off the blast point with a -rand(0.5) vy bias. Each ember is
 * a FireNodeData: it GLIDES while SlowingDown (VelX/VelY *= 0.9 per 24 fps
 * tick) until TotalVel <= 2, then VelY += 0.2 gravity pulls it down until it
 * lands on a static; landed, the burn timer counts down and the pool lives
 * 1 - 2 s here (GASCAN/BARREL values), embers landing within 3 px merge into
 * the survivor (the longer timer wins) and the death stretch collapses
 * radius + alpha fast (fire_effect_ground kills its sprite at alpha 0.4).
 * The drawn ember is a radial-gradient circle: white-hot yellow core, an
 * intense orange ring and a dark orange edge fading to alpha 0 — drawn with
 * 'lighter' so overlapping embers bloom. Standing in the pool ignites the
 * fighter at level 1 (the fire state machine keeps the escalation clock);
 * crates inside the pool burn on the extracted ObjectFireDamage cadence.
 * Landed embers breathe small damage-less spark puffs (AddEffectGround).
 */
(function () {
  'use strict';

  // ---------- Constants (extracted) ----------
  var GAME_WIDTH = 800;
  var GAME_HEIGHT = 600;
  // Fullscreen viewport: the canvas fills the window. VIEW_* is the visible
  // area in world-sized logical units (cover-scaled, so it never exceeds the
  // world); VIEW_SCALE maps logical units to canvas pixels.
  var VIEW_WIDTH = GAME_WIDTH;
  var VIEW_HEIGHT = GAME_HEIGHT;
  var VIEW_SCALE = 1;
  var FPS = 60; // requestAnimationFrameRate = 60
  var STEP_MS = 1000 / FPS;

  // ---------- Simulation time base ----------
  // The artifact simulates at ~24 logic ticks/s (SWF frameRate="24").
  // This port keeps the extracted per-tick values as per-step values, so the
  // simulation advances one artifact tick per 60 Hz step (fast mode).
  // TIME_SCALE = 1 means no conversion is applied. It is kept as a named
  // constant so the rate can be changed in one place if needed.
  // The artifact simulates at 24 fps and this port renders at 60 Hz: running
  // 1 tick per step made everything 2.5x faster in real time. TIME_SCALE 0.75
  // is the brisk base pace; the SLOWMO pickups bring the whole game down to
  // the 0.5 feel (0.75 * 2/3) when a Slowmo powerup is used.
  var TIME_SCALE = 0.75;
  var VEL_SCALE = TIME_SCALE; // 0.75
  // The original fighter is 15 % smaller and 15 % slower (walk, run, sprint and jump).
  // One factor drives both so size and pace stay in proportion.
  var FIGHTER_REDUCTION = 0.85;
  var ACCEL_SCALE = TIME_SCALE * TIME_SCALE; // 0.5625
  var TICKS_TO_STEPS = 1 / TIME_SCALE; // 1

  var PLAYER_GRAVITY = 0.6 * ACCEL_SCALE; // extracted PlayerGravity
  // Jump arc stretched in time (heavier, more controlled): the power scales by
  // the factor and the in-jump gravity by its square, so the jump keeps its
  // HEIGHT and simply takes 1 / JUMP_TIME_FACTOR longer to rise and fall.
  // Ragdoll falls, crashes and knockbacks keep the plain PLAYER_GRAVITY.
  var JUMP_TIME_FACTOR = 0.85;
  // The reduction slows the jump by its factor and, with the lower power, lowers
  // the arc in proportion to the smaller body (same airtime: gravity scales with it).
  var PLAYER_JUMP_GRAVITY = PLAYER_GRAVITY * JUMP_TIME_FACTOR * JUMP_TIME_FACTOR * FIGHTER_REDUCTION;
  var PLAYER_JUMP_POWER = -5 * VEL_SCALE * JUMP_TIME_FACTOR * FIGHTER_REDUCTION; // -5 px/tick -> -5 px/step
  var PLAYER_JUMP_PUSH_POWER = -0.7 * ACCEL_SCALE * JUMP_TIME_FACTOR * JUMP_TIME_FACTOR * FIGHTER_REDUCTION; // -0.7 px/tick per tick -> -0.7 px/step^2
  var PLAYER_JUMP_PUSH_TIME = 4 * TICKS_TO_STEPS; // 4 ticks -> 4 steps
  // Base run speed eased down 25% from the extracted 1.7 (requested). Sprint
  // stays 2x this value, so both paces drop by the same proportion.
  var RUN_SPEED_BOOST = 1.1 * 0.8; // walk AND run 20% slower (sprint stays 2x the walk)
  var PLAYER_RUN_SPEED = 1.7 * VEL_SCALE * RUN_SPEED_BOOST * FIGHTER_REDUCTION; // extracted RunSpeed (1.7 px/tick) x boost x reduction
  var AIR_CONTROL_FACTOR = 0.8; // proportional to RunSpeed, so it scales itself
  var AIR_FALL_MIN = 0.1 * VEL_SCALE; // 0.1 px/step
  var FALL_TRIGGER_SPEED = 9.5625 * VEL_SCALE; // 10.625 * 0.9
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
  // Combo 3 lunges forward at PunchGlideSpeed = 2, decaying with animation progress.
  // Port tuning (user): halved to 1 so the finisher slides half the distance.
  var PUNCH_GLIDE_SPEED = 1; // combo 3 lunge (originally extracted 2)
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
  var ROLL_COOLDOWN_STEPS = 60; // exactly 1 s at 60 Hz between two rolls
  var JUMPKICK_AIRBORN_MIN = 2.5 * TICKS_TO_STEPS; // 2.5 ticks -> 6.25 steps

  // ---------- SSJ2 (requested cheat: 'gokussj' + J/K/L/;/' abilities) ----------
  // The transformation belongs to the Arrow-Key fighter (P2's binding) and
  // multiplies the extracted base attributes; Ki is the ability resource.
  var SSJ2_SEQUENCE = 'gokussj';
  var SSJ2_CHEAT_COOLDOWN = 30;      // steps between accepted cheat fires
  var SSJ2_RUN_SPEED_MULT = 1.45;    // base _runSpeed boost while transformed
  var SSJ2_MELEE_DAMAGE_MULT = 1.8;  // fist/weapon damage multiplier
  var SSJ2_JUMP_BOOST = 1.15;        // jump power multiplier
  var SSJ2_KI_MAX = 100;
  var SSJ2_KI_START = 45;            // Ki granted by the transformation
  var SSJ2_KI_PASSIVE = 0.06;        // slow trickle, steps^-1
  var SSJ2_KI_REGEN = 0.95;          // per step while ';' is held (~1.8 s full)
  var SSJ2_KI_COST_TELEPORT = 8;     // free Instant Transmission (')
  var SSJ2_KI_COST_TELE_COMBO = 14;  // Instant Transmission Strike (J)
  var SSJ2_KI_COST_BEAM = 34;        // Kamehameha (K)
  var SSJ2_FLIGHT_MIN_KI = 6;        // minimum Ki to engage flight (L)
  var SSJ2_FLIGHT_DRAIN = 0.22;      // per step airborne with flight engaged
  var SSJ2_FLIGHT_SPEED = 4.0 * VEL_SCALE;  // flight velocity cap (X and Y)
  var SSJ2_FLIGHT_ACCEL = 0.5 * VEL_SCALE;  // flight Y acceleration per step
  var SSJ2_FLIGHT_GLIDE = 0.84;      // no-input velocity damping per step
  var SSJ2_TELEPORT_DISTANCE = 95;   // free warp length in the facing dir
  var SSJ2_TELEPORT_ENEMY_SEEK = 260; // warp-to-enemy range for the free warp
  var SSJ2_TELEPORT_COOLDOWN = 14;   // steps between free warps
  var SSJ2_COMBO_COOLDOWN = 55;      // steps between Instant Transmission Strikes
  var SSJ2_TELEPORT_VANISH = 18;    // Dragon-Ball vanish: 0.3 s invisible before the blow lands
  var SSJ2_BEAM_COOLDOWN = 45;       // steps between Kamehameha volleys
  var SSJ2_BEAM_FIRE_STEPS = 32;     // seconds worth of 60 Hz beam steps
  var SSJ2_BEAM_HEIGHT = 18;         // destructive band thickness (px, full charge)
  var SSJ2_BEAM_PULSE_STEPS = 4;     // damage pulses every N steps
  var SSJ2_BEAM_DAMAGE_PULSE = 8;    // HP per pulse on a fighter (full charge)
  var SSJ2_BEAM_CRATE_PULSE = 12;    // crate damage per pulse (full charge)
  var SSJ2_BEAM_KNOCKBACK = 5.5 * VEL_SCALE;
  // kame_charge.mp3 (6.27 s ≈ 376 steps at 60 Hz) IS the charge clock: the orb
  // grows LINEARLY for as long as the file plays, and the file's own `ended`
  // event reabsorbs the energy when K is still held. The fallback covers test
  // sandboxes and failed audio loads (no metadata, no `ended` event).
  var SSJ2_BEAM_CHARGE_FALLBACK_STEPS = 376;
  var SSJ2_KAME_ORB_MIN_R = 2;       // charge orb radius on the first step (px)
  var SSJ2_KAME_ORB_MAX_R = 18;      // charge orb radius at the audio end (px)
  var SSJ2_KAME_REABSORB_STEPS = 20; // collapse-back animation steps before idle
  var SSJ2_COMBO_HITS = 5;           // blows of the Instant Transmission Strike
  var SSJ2_COMBO_HIT_DAMAGE = 5;     // HP per blow
  var SSJ2_COMBO_STEPS_PER_HIT = 24; // steps between blows (~0.4 s: vanish 0.3 s + 0.1 s gap)
  var SSJ2_COMBO_LAUNCH_X = 6 * VEL_SCALE;   // finisher ragdoll launch
  var SSJ2_COMBO_LAUNCH_Y = -4 * VEL_SCALE;
  var SSJ2_PARTICLE_LIFE = 24;       // aura particle lifetime (steps)
  // Mods layer (the mods/ folder): the transformation keeps the ORIGINAL
  // sprite and layers two images around it — the Goku hair over the head and
  // the blue flame silhouette BEHIND the body (leve transparencia).
  var SSJ2_MOD_HAIR_SRC = 'mods/pelogoku.png';
  var SSJ2_MOD_AURA_SRC = 'mods/aura.png';
  // The transformation cutscene (user art, the mods folder): four flex poses
  // the fighter cycles the moment the ritual lands, backed by the shipped
  // ritual audio (mods/gokutransformacion.mp3). The frames replace the body
  // cell for the whole window; the audio rolls past the cutscene under the
  // landed SSJ2 shell (it is roughly the same length).
  var SSJ2_MOD_TRANSFORM_SRCS = [
    'mods/5000.png', 'mods/5001.png', 'mods/5002.png', 'mods/5003.png'
  ];
  var SSJ2_TRANSFORM_AUDIO_SRC = 'mods/gokutransformacion.mp3';
  var SSJ2_TELEPORT_AUDIO_SRC = 'mods/sounds/goku-teleport-sound.mp3';
  var SSJ2_HEAVY_PUNCH_AUDIO_SRC = 'mods/sounds/dragon-ball-z-heavy-punch.mp3';
  var SSJ2_KAME_CHARGE_AUDIO_SRC = 'mods/sounds/kame_charge.mp3';
  var SSJ2_KAME_WAVE_AUDIO_SRC = 'mods/sounds/kameha-wave.mp3';
  var SSJ2_RECHARGE_AUDIO_SRC = 'mods/sounds/recarganormal.mp3';
  // ---- Goku mod phases: SSJ -> SSJ2 -> Ultra Instinct (UI) ----
  // The typed word activates the fighter in the SSJ phase. Holding the Ki
  // recharge at full Ki for 3 s plays the transformation art sequence and
  // lands SSJ2; inside SSJ2 the same hold for 5 s (with the furious recharge
  // audio) plays the SSJ2 -> UI sequence and lands Ultra Instinct.
  // Secret J/K sequences: each one plays the base transformation
  // (mods/transformationbase) and then lands the fighter in its own phase.
  var SSJ_SECRET_SEQUENCES = [
    { word: 'jkjkjkjkjkjkjk', landingPhase: 'ssj' },
    { word: 'jjkkjjkkjjkkjj', landingPhase: 'ssj2' },
    { word: 'jjjkkkjjjkkkjk', landingPhase: 'ui' }
  ];
  var SSJ_WORD = SSJ_SECRET_SEQUENCES[0].word; // the default (plain SSJ) sequence
  var SSJ_PHASE_SSJ = 'ssj';
  var SSJ_PHASE_SSJ2 = 'ssj2';
  var SSJ_PHASE_UI = 'ui';
  // Phase transformation kinds (the cutscene slot's `kind` / art `set` key).
  var PHASE_TRANSFORM = { ACTIVATE: 'toBase', TO_SSJ2: 'toSsj2', TO_UI: 'toUi' };
  var BASE_TRANSFORM_STEPS_PER_FRAME = 7; // transformation.png..transformation11.png (~1.3 s at 60 Hz)
  var BASE_TRANSFORM_FRAME_COUNT = 11;
  var SSJ_PARTICLE_CAP = 220;            // live aura particles (oldest dropped first)
  var SSJ_RING_CAP = 40;                 // live shock rings
  var SSJ_RING_START_RADIUS = 4;
  var SSJ_RING_DEFAULT_GROW = 1.7;
  var SSJ_AURA_BAR_FOOT_LIFT = 0;       // px the vertical energy bars start above the feet line
  var SSJ_AURA_RATE_IDLE = 0.2;          // aura spawn chance per step
  var SSJ_AURA_RATE_CHARGING = 0.55;
  var SSJ_FLIGHT_TRAIL_CHANCE = 0.5;
  var SSJ_CHARGE_RING_CHANCE = 0.05;
  var SSJ_TO_SSJ2_HOLD_STEPS = 3 * 60;   // full Ki held ~3 s
  var SSJ2_TO_UI_HOLD_STEPS = 3 * 60;    // full Ki held > 3 s
  var SSJ_PHASE_SPEED = { ssj: 1.2, ssj2: 1.2, ui: 0.55 }; // slightly faster / slow UI walk
  var SSJ_BEAM_SIZE = { ssj: 0.5, ssj2: 1.6 };             // small vs large Kamehameha
  var SSJ_TRANSFORM_STEPS_PER_FRAME = 6;                    // SSJ -> SSJ2 art cadence
  var UI_TRANSFORM_STEPS_PER_FRAME = 16;                    // SSJ2 -> UI: very slow, strained
  // art 1..5, then the strict strain sequence 6,5,6,5,6,7,6,7,6,7,8,7,8,7,8 (0-based indexes)
  var UI_TRANSFORM_SEQUENCE = [0, 1, 2, 3, 4]
    .concat([5, 4, 5, 4, 5, 6, 5, 6, 5, 6, 7, 6, 7, 6, 7]);
  var UI_INTRO_FRAMES = 5;           // art 1..5 build-up before the strain loop
  var UI_INTRO_STEPS_PER_FRAME = 44; // held much longer than the loop frames
  var UI_COSMIC_AUDIO_SRC = 'mods/sounds/explosioncosmica.mp3';
  var UI_COSMIC_RADIUS = 520;
  var UI_COSMIC_PUSH = 16;
  var UI_COSMIC_MIN_FORCE = 0.35;     // far objects still get thrown at this share of the push
  var UI_COSMIC_PROP_SPEED = 0.6;     // crates / barrels
  var UI_COSMIC_FIGHTER_SPEED = 0.8;
  var UI_COSMIC_ITEM_SPEED = 6;       // loose weapons
  var SSJ2_FURIOUS_VOLUME = 0.5;                            // furious recharge audio at 50%
  var UI_GLOW_HOLD_STEPS = 10 * 60;   // intense white silhouette for the first 10 s
  var UI_GLOW_FADE_STEPS = 30 * 60;   // then it dims very slowly
  var UI_DURATION_STEPS = 60 * 60;    // the Ultra Instinct state lasts 1 minute
  var SSJ2_MELEE_FRAMES = 10;        // attack art 1..10
  var SSJ2_MELEE_STEPS_PER_FRAME = 3;
  var SSJ2_MELEE_HIT_FRAMES = [2, 5, 9]; // frame indexes that connect
  var SSJ2_MELEE_HIT_DAMAGE = 6;
  var SSJ2_MELEE_REACH = 54;
  var SSJ2_MELEE_COOLDOWN = 14;
  var UI_KI_PASSIVE = 0.18;          // UI has no recharge key: Ki trickles back
  var UI_KI_COST_ORB = 18;
  var UI_KI_COST_RAYS = 20;
  var UI_KI_COST_TELE = 12;
  var UI_ORB_SPEED = 3.2;
  var UI_ORB_STEER = 0.16;           // rad-free steering: velocity eases toward the arrows
  var UI_ORB_RADIUS = 5;             // visual size of the glowing ball
  var UI_ORB_HIT_RADIUS = 2.5;       // collision circle: only the bright core detonates it
  var UI_ORB_LIFE = 220;
  var UI_ORB_COOLDOWN = 30;
  var UI_ORB_BLAST_RADIUS = 58;
  // Heal glow (medkit / pills): a white shimmer born at the feet that sweeps up
  // the whole silhouette, fading in and out over HEAL_GLOW_STEPS.
  var HEAL_GLOW_STEPS = 40;
  var HEAL_GLOW_BASE_ALPHA = 0.4;     // whole-body wash at peak intensity
  var HEAL_GLOW_SWEEP_BAND = 0.45;    // sweep band height as a share of the body
  var HEAL_GLOW_BLUR_PX = 12;
  var PLAYER_MAX_HP = 100;           // full health bar (Player.setHp clamps to it)
  var UI_ORB_BLAST_HEALTH_FRACTION = 0.25; // the orb blast always costs a quarter of the full bar
  var UI_ORB_BLAST_DAMAGE = PLAYER_MAX_HP * UI_ORB_BLAST_HEALTH_FRACTION;
  var BARREL_BLAST_OPTIONS = { uiImmune: true };
  var BARREL_FIRST_WAVE_OPTIONS = { noFire: true, uiImmune: true };
  // Grenade blast (extracted Explosions.as: explosionDamagePlayers 20, objects
  // take a flat explosionDamage 25). Fighters feel the wide radius; crates
  // and barrels only react when the grenade pops almost against them.
  var GRENADE_OBJECT_REACH = 20;   // px from the object surface (players use GRENADE.radius)
  var GRENADE_OBJECT_DAMAGE = 25;  // flat blast damage on a crate in reach
  var GRENADE_CLUSTER_RADIUS = 60; // grenades this close pop together on the same step
  var GRENADE_BLAST_OPTIONS = {
    noFire: true,
    objectReach: GRENADE_OBJECT_REACH,
    objectDamage: GRENADE_OBJECT_DAMAGE
  };
  // Bazooka blast: 25% weaker than the extracted 100 / 30 damage.
  var ROCKET_BLAST_DAMAGE_REDUCTION = 0.25;
  var ROCKET_BLAST_RADIUS = 110;
  var ROCKET_BLAST_DAMAGE_MAX = 100 * (1 - ROCKET_BLAST_DAMAGE_REDUCTION);
  var ROCKET_BLAST_DAMAGE_MIN = 30 * (1 - ROCKET_BLAST_DAMAGE_REDUCTION);
  var NO_BLAST_OPTIONS = {};
  var UI_RAYS_COUNT = 9;             // light beams per burst
  var UI_RAYS_INTERVAL = 4;          // steps between beams
  var UI_RAY_SPEED = 9;
  var UI_RAY_DAMAGE = 4;
  var UI_RAYS_COOLDOWN = 5 * 60;  // J: exactly 5 s between bursts (60 steps/s)
  var UI_COSMIC_AUDIO_DELAY_MS = 1000; // sync the blast sound with the visual detonation
  var uiCosmicAudioTimer = null;
  var UI_TELE_STEPS_PER_FRAME = 6;   // atackui1..4 cadence
  var UI_TELE_HIT_DAMAGE = 7;
  var UI_TELE_COOLDOWN = 0;   // no wait between teleport strikes
  // Normalization: the mod art ships at different resolutions (a 1000px
  // figure next to 300px ones). Every figure is scaled by ONE factor derived
  // from the reference standing height, and oversized sheets are first
  // brought down to that reference.
  var MOD_ART_REF_HEIGHT = 500;      // px of a reference standing figure
  var MOD_ART_BODY_MULT = 1.4;       // drawn figure height in hitbox heights
  var MOD_SPRITE_DEFS = {
    ssj2Idle: ['transformacionssj2/idle.png'],
    ssj2Attack: [
      'transformacionssj2/attacksjj2-1.png', 'transformacionssj2/attacksjj2-2.png',
      'transformacionssj2/attackssj2-3.png', 'transformacionssj2/attackssj2-4.png',
      'transformacionssj2/attackssj-5.png', 'transformacionssj2/attackssj2-6.png',
      'transformacionssj2/attackssj2-7.png', 'transformacionssj2/attackssj2-8.png',
      'transformacionssj2/attackssj2-9.png', 'transformacionssj2/attackssj2-10.png'
    ],
    ssj2Charge: [
      'transformacionssj2/recargarki2.png', 'transformacionssj2/recargarki3.png',
      'transformacionssj2/recargarki4.png', 'transformacionssj2/recargarki5.png',
      'transformacionssj2/recargarki6.png', 'transformacionssj2/recargarki7.png',
      'transformacionssj2/recagarki8.png', 'transformacionssj2/recargarki9.png',
      'transformacionssj2/recargarki10.png', 'transformacionssj2/recargarki11.png',
      'transformacionssj2/recargarki12.png', 'transformacionssj2/recargarki13.png',
      'transformacionssj2/recargarki14.png', 'transformacionssj2/recargarki15.png',
      'transformacionssj2/recargarki16.png'
    ],
    toBase: [],
    toSsj2: [],
    toUi: [
      'transformacionssj2toui/transformationupgrade.png',
      'transformacionssj2toui/transformationupgrade2.png', 'transformacionssj2toui/transformationupgrade3.png',
      'transformacionssj2toui/transformationupgrade4.png', 'transformacionssj2toui/transformationupgrade5.png',
      'transformacionssj2toui/transformationupgrade6.png', 'transformacionssj2toui/transformationupgrade7.png',
      'transformacionssj2toui/transformationupgrade8.png'
    ],
    uiIdle: ['ultrainstinct/idleui.png'],
    uiWalk: [], // walkui1..9 (the shipped sheet skips a couple of numbers)
    uiAttack: [
      'ultrainstinct/atackui1.png', 'ultrainstinct/atackui2.png',
      'ultrainstinct/atackui3.png', 'ultrainstinct/atackui4.png'
    ]
  };
  for (var _tbi = 1; _tbi <= BASE_TRANSFORM_FRAME_COUNT; _tbi++) {
    MOD_SPRITE_DEFS.toBase.push('transformationbase/transformation' + (_tbi === 1 ? '' : _tbi) + '.png');
  }
  for (var _tsi = 1; _tsi <= 16; _tsi++) MOD_SPRITE_DEFS.toSsj2.push('transfromaciongokutossj2/transformacion' + _tsi + '.png');
  for (var _uwi = 1; _uwi <= 9; _uwi++) MOD_SPRITE_DEFS.uiWalk.push('ultrainstinct/walkui' + _uwi + '.png');
  var SSJ2_FURIOUS_AUDIO_SRC = 'mods/sounds/gokurecargafuriosa.mp3';
  var UI_THEME_AUDIO_SRC = 'mods/sounds/ultrainstinct.mp3';
  var TRANSFORM_POSE_FRAMES = 4; // the cutscene pose count
  var TRANSFORM_POSE_STEPS = 30; // steps each pose holds (2 s total)
  var TRANSFORM_POSE_HEIGHT_MULT = 2.6; // drawn art height in body heights
  var SSJ2_AURA_BASE_ALPHA = 0.62;   // backing flame base opacity (breathing)

  // ---------- The One (Matrix) mode (requested cheat: 'matrix' + J/K/L/;/') ----------
  // The transformation belongs to the Arrow-Key fighter (same owner as SSJ2)
  // and re-themes the ability keys J/K/L/;/' as The One's repertoire. The two
  // mod shells are mutually exclusive states on the same fighter: typing the
  // other cheat word swaps the shell, re-typing the current word drops it.
  var MATRIX_SEQUENCE = 'matrix';       // typed konami word (open sky required)
  var MATRIX_BT_TARGET = 0.3;           // J Bullet Time: world crawls to 30%
  var MATRIX_BT_RAMP = 10;              // steps to ease in/out of bullet time
  var MATRIX_BT_HOLD_CAP = 360;         // continuous hold cap (6 s at 60 Hz)
  var MATRIX_BT_COOLDOWN = 45;          // steps after release before re-engage
  var MATRIX_DODGE_COOLDOWN = 50;       // K dodge: steps between dodges
  var MATRIX_DODGE_TIME = 14;           // dodge grace: bullet-shield steps
  var MATRIX_DODGE_GRAVITY = -2.55;     // backward arc hop (px/step velocity)
  var MATRIX_DODGE_PUSH = 2.5;          // backward push away from the facing
  var MATRIX_DEFLECT_RANGE = 110;       // frontal half-cone reach in px
  var MATRIX_DEFLECT_VRANGE = 62;       // vertical band the deflection reads
  var MATRIX_DEFLECT_KEEP = 0.5;        // reflected bullet keeps this share of speed
  var MATRIX_WALL_RUN_SPEED = 2.3;      // L: vertical run speed along the wall
  var MATRIX_WALL_FUEL_MAX = 90;        // wall-run gauge (steps on the wall)
  var MATRIX_WALL_FUEL_REGEN = 3;       // fuel per step while grounded
  var MATRIX_WALL_COOLDOWN = 45;        // steps after a kick / fuel-out
  var MATRIX_WALL_DISTANCE = 7;         // wall/cover proximity that arms L
  var MATRIX_WALL_KICK_JUMP = -4.6;     // ArrowUp kick-off vertical power
  var MATRIX_WALL_KICK_PUSH = 2.6;      // kick-off horizontal push (away)
  var MATRIX_WALL_JUMP_COST = 20;       // fuel burned by the kick
  var MATRIX_RELOAD_COOLDOWN = 150;     // ;: steps between instant reloads
  var MATRIX_RELOAD_RAIN_N = 130;       // digital rain glyph count per reload
  var MATRIX_RAIN_LIFE = 46;            // digital rain glyph lifetime (steps)
  var MATRIX_TELEPORT_COOLDOWN = 90;    // ': steps between glitch warps
  var MATRIX_TELEPORT_SEEK = 520;       // nearest-enemy search radius (px)
  var MATRIX_AMBIENT_MOTE_N = 2;        // ambient aura motes spawned per step
  var MATRIX_MOTE_LIFE = 18;            // aura mote lifetime (steps)
  var MATRIX_BT_MAX_STREAKS = 26;       // bullet-time streak draw budget

  // ---------- Knockback roll (requested: hard-impact tumble) ----------
  // The roll is a reaction to being KNOCKED INTO the world, not to a plain
  // fall: a launched body (combination finisher / kick / throw / dive flight /
  // explosion blast — all of them set Falling) that slams a solid side or a
  // crate above KNOCKBACK_ROLL_WALL_SPEED rebounds a small share of the impact
  // and TUMBLES away, decelerating only by ground friction until it comes to
  // rest (then the lying recovery plays through). A slam-grade TOUCHDOWN (a
  // fall from great height hitting the ground at the FALL_TRIGGER_SPEED bar)
  // tumbles too: the body pops off the floor and rolls its momentum away —
  // unless it crushed another fighter underneath (both collapse as shipped).
  // Same-floor jumps, shelf hops, plain launched landings below the bar and
  // soft controlled touchdowns keep the extracted knockdown: a soft touchdown
  // is never a tumble trigger.
  var KNOCKBACK_ROLL_WALL_SPEED = 1 * VEL_SCALE;    // |vx| that makes a mid-air obstacle hit tumble
  // A CONTROLLED fighter rebounding off a wall needs a real crash speed
  // (sprint grade): slower contacts (walk bumps, wall slides) keep stopping
  // the plain way — no tumble on routine wall touches. AIRBORNE the bar is
  // unreachable by design: air drift climbs past 3.0 within a few held steps
  // (cap 3.4), so a jumping body only tumbles via the long-free-fall grade
  // or dive momentum — never from plain jump drift (user bug report).
  var KNOCKBACK_ROLL_PLAYER_WALL_SPEED = 3 * VEL_SCALE;
  var KNOCKBACK_ROLL_BOUNCE = 0.4;  // rebound share of the wall impact speed
  var KNOCKBACK_ROLL_POP = 1.5 * VEL_SCALE; // small vertical bounce when a fast touchdown turns into a tumble
  var BLAST_ROLL_PENDING_STEPS = 90; // explosion roll window: any blast launch touching down within it tumbles
  var KNOCKBACK_ROLL_FRICTION = 0.92; // per-step ground damping while tumbling
  // Doll spin degrees per ROLLED pixel (the artifact rotates dynamic bodies by
  // their motion — Player.as:2245 ShapeMC.rotation = GetAngle for crates/gore;
  // a shipped ROLL clip here would be keyframes, our only cell is 606)
  var KNOCKBACK_ROLL_SPIN_RATE = 12;
  var KNOCKBACK_ROLL_STOP_SPEED = 0.12 * VEL_SCALE; // |vx| treated as a full stop
  var KNOCKBACK_ROLL_MIN_FRAMES = 6;  // minimum tumble length (60 Hz steps)
  var KNOCKBACK_ROLL_MAX_FRAMES = 72; // hard cap so momentum can never loop
  // Long-free-fall crash grade (requested trigger 3): dropping from GREAT
  // height and slamming a solid side tumbles even at walk drift, as long as
  // the body was really moving INTO the surface (a straight-down graze is
  // not a slam). The bar is the damage-grade fall speed (FALL_TRIGGER_SPEED)
  // so same-floor jumps and one-shelf hops never reach it.
  var KNOCKBACK_ROLL_FREEFALL_VY = FALL_TRIGGER_SPEED;
  var KNOCKBACK_ROLL_FREEFALL_VX = 0.5 * VEL_SCALE;

  // ---------- Constants (extracted — HP bar trail) ----------
  // PlayerState._barHP: the displayed bar value trails the real HP. The HP
  // setter snaps _barHP to the old HP, computes
  // _healthBarSpeed = (newHP - _barHP) / 6 and opens _showHealthTimer = 6;
  // while that timer is open _barHP += _healthBarSpeed each tick, with an
  // idle floor of -24. 6 ticks at 24 fps = 0.25 s -> scaled to 60 Hz steps.
  var BAR_TRAIL_STEPS = Math.round(6 * ANIM_TICKS_TO_STEPS); // 15 steps
  var BAR_TRAIL_IDLE = Math.round(-24 * ANIM_TICKS_TO_STEPS); // -60

  // ---------- Constants (extracted — firearms & grenades) ----------
  var BULLET_SUBSTEP_PX = 4; // bullet substeps n = round(TotalVel / 4), min 1
  var AIM_SQUARE_DISTANCE = 8; // CalculateAimSquare's step budget (8 x 2px)
  // Magnum and Sniper deal 35% less than their extracted values.
  var HIGH_POWER_DAMAGE_FACTOR = 1 - 0.35;

  // ---------- Firearm finisher knockback (requested) ----------
  // Some guns launch the victim with the SAME ragdoll push as the 3rd punch of
  // the melee combo (COMBO_KNOCKBACK_X/Y). The rule says WHEN that happens:
  //   ALL_PELLETS  - every pellet of one shot connected with the same victim
  //   SINGLE_HIT   - one bullet is enough
  //   BURST_WINDOW - N hits on the same victim inside a time window
  var BULLET_KNOCKBACK_RULE = {
    NONE: 'none',
    ALL_PELLETS: 'allPellets',
    SINGLE_HIT: 'singleHit',
    BURST_WINDOW: 'burstWindow'
  };
  var SMG_BURST_HITS_REQUIRED = 4;      // bullets that must land...
  var SMG_BURST_WINDOW_STEPS = 40;      // ...within this many game-speed steps (~0.67 s)

  // ---------- Sound effects (src/audio-manager.js) ----------
  // The game only raises named events; files, volumes and voice pools live in
  // the AudioManager. Without it (test sandbox, audio disabled) every call is
  // a silent no-op, so gameplay never depends on sound.
  var audioApi = (typeof SuperfightersAudio !== 'undefined') ? SuperfightersAudio : null;
  var SFX = audioApi ? audioApi.SFX : {};
  var sfx = audioApi ? audioApi.createAudioManager({ audioConstructor: typeof Audio !== 'undefined' ? Audio : null }) : null;
  if (sfx) sfx.preload();
  function playSfx(name, options) {
    if (sfx && name) sfx.play(name, options);
  }
  function playSfxAfterSteps(name, steps) {
    if (sfx && name) sfx.playAfterSteps(name, steps);
  }
  // Heavy props rules (src/heavy-props.js). Absent in a bare sandbox: the
  // props are then simply not spawned.
  var heavyApi = (typeof SuperfightersHeavyProps !== 'undefined') ? SuperfightersHeavyProps : null;
  var HEAVY_KIND = heavyApi ? heavyApi.HEAVY_PROP_KIND : {};
  var HEAVY_CONFIG = heavyApi ? heavyApi.HEAVY_PROP_CONFIG : {};
  // Fire propagation rules (src/fire-propagation.js); without it every prop
  // burns as before and nothing spreads.
  // Rigid-body hit response (src/rigid-impact.js): torque from off-centre
  // impulses with a dead-band, damped spin, rectangular tip-over. Without it
  // props keep the legacy fixed-spin behaviour.
  var rigidApi = (typeof SuperfightersRigidImpact !== 'undefined') ? SuperfightersRigidImpact : null;
  // Contact dynamics (src/impact-dynamics.js): torque from the height of a
  // bullet hit, OBB hit tests, edge-pivot overhang torque, mass-weighted chain
  // separation, melee recoil and the toppling-prop knockback roll. Without it
  // the props keep the rigid-impact behaviour above.
  var impactApi = (typeof SuperfightersImpactDynamics !== 'undefined') ? SuperfightersImpactDynamics : null;
  var fireApi = (typeof SuperfightersFire !== 'undefined') ? SuperfightersFire : null;
  var doorApi = (typeof SuperfightersDoorPortal !== 'undefined') ? SuperfightersDoorPortal : null;
  var hitboxApi = (typeof SuperfightersFighterHitbox !== 'undefined') ? SuperfightersFighterHitbox : null;
  var roundFlowApi = (typeof SuperfightersRoundFlow !== 'undefined') ? SuperfightersRoundFlow : null;
  function propMaterial(prop) {
    return prop.heavyConfig ? prop.heavyConfig.material : 'wood'; // plain crates are wood
  }
  function propIsFlammable(prop) {
    return fireApi ? fireApi.isFlammable(propMaterial(prop)) : true;
  }
  var SHOTGUN_PUMP_FIRST_DELAY_STEPS = 14;  // fire -> first pump half
  var SHOTGUN_PUMP_SECOND_DELAY_STEPS = 26; // fire -> second pump half (cooldown is 40)
  var LANDING_SOUND_MIN_SPEED = 2;          // vertical speed below which a touchdown is silent
  var FOOTSTEP_STRIDE_PX = 16;              // ground distance between two footsteps
  var CRATE_SLIDE_SOUND_MIN_SPEED = 0.6;    // a crate faster than this scrapes the floor
  var FLAME_BURST_PUFFS = 8;         // puffs per flamethrower burst
  var FLAME_BURST_PAUSE_STEPS = 24;  // pause between bursts

  var GUNS = {
    pistol:  { kind: 'gun', name: 'Pistol',  ammo: 12, cooldown: 15, spread: 1,   pellets: 1, burst: 1, burstInterval: 0,   speed: 30, damage: 10, critChance: 5,  critDamage: 15, pushback: 15, shape: 'pistol', impulseForce: 0.6 },
    rifle:   { kind: 'gun', name: 'Rifle',   ammo: 25, cooldown: 35, spread: 3,   pellets: 1, burst: 5, burstInterval: 5,   speed: 35, damage: 8,  critChance: 6,  critDamage: 10, pushback: 20, shape: 'rifle', impulseForce: 0.45 },
    uzi:     { kind: 'gun', name: 'Uzi',     ammo: 25, cooldown: 25, spread: 6,   pellets: 1, burst: 5, burstInterval: 2.5, speed: 30, damage: 7,  critChance: 4,  critDamage: 10, pushback: 10, shape: 'uzi', impulseForce: 0.4, knockbackRule: BULLET_KNOCKBACK_RULE.BURST_WINDOW },
    shotgun: { kind: 'gun', name: 'Shotgun', ammo: 32, cooldown: 40, spread: 4.3, pellets: 4, burst: 1, burstInterval: 0,   speed: 30, damage: 6,  critChance: 0,  critDamage: 6,  pushback: 33, shape: 'shotgun', impulseForce: 0.35, knockbackRule: BULLET_KNOCKBACK_RULE.ALL_PELLETS },
    magnum:  { kind: 'gun', name: 'Magnum',  ammo: 6,  cooldown: 20, spread: 0.5, pellets: 1, burst: 1, burstInterval: 0,   speed: 40, damage: 25 * HIGH_POWER_DAMAGE_FACTOR, critChance: 40, critDamage: 35 * HIGH_POWER_DAMAGE_FACTOR, pushback: 50, shape: 'magnum', impulseForce: 1.05 },
    sniper:  { kind: 'gun', name: 'Sniper',  ammo: 5,  cooldown: 45, spread: 0,   pellets: 1, burst: 1, burstInterval: 0,   speed: 40, damage: 30 * HIGH_POWER_DAMAGE_FACTOR, critChance: 75, critDamage: 60 * HIGH_POWER_DAMAGE_FACTOR, pushback: 50, shape: 'sniper', impulseForce: 1.25, knockbackRule: BULLET_KNOCKBACK_RULE.SINGLE_HIT },
    bazooka: { kind: 'gun', name: 'Bazooka', ammo: 3,  cooldown: 25, spread: 2,   pellets: 1, burst: 1, burstInterval: 0,   speed: 18, damage: 0,  critChance: 0,  critDamage: 0,  pushback: 0,  shape: 'bazooka', rocket: true, impulseForce: 3 },
    flamethrower: { kind: 'gun', name: 'Flamethrower', ammo: 60, cooldown: 2, spread: 6, pellets: 1, burst: 1, burstInterval: 0, speed: 10, damage: 2, critChance: 0, critDamage: 0, pushback: 2, shape: 'flamethrower', flame: true }
  };
  GUNS.pistol.kind = 'gun';
  // Aim (draw) and fire sound per weapon shape. The shotgun racks its pump
  // right after each blast.
  var GUN_SOUNDS = {
    pistol: { aim: SFX.PISTOL_AIM, fire: SFX.PISTOL_FIRE },
    rifle: { aim: SFX.RIFLE_AIM, fire: SFX.RIFLE_FIRE },
    uzi: { aim: SFX.UZI_AIM, fire: SFX.UZI_FIRE },
    magnum: { aim: SFX.MAGNUM_AIM, fire: SFX.MAGNUM_FIRE },
    shotgun: { aim: SFX.SHOTGUN_AIM, fire: SFX.SHOTGUN_FIRE, pump: true },
    sniper: { aim: SFX.SNIPER_AIM, fire: SFX.SNIPER_FIRE },
    bazooka: { aim: SFX.BAZOOKA_AIM, fire: SFX.BAZOOKA_FIRE },
    flamethrower: { aim: SFX.FLAMETHROWER_AIM, fire: null } // flame sound plays once per burst (see updateAim), not per puff
  };
  // Dry-fire click per weapon shape (only two empty-chamber recordings ship:
  // light for the small arms, heavy for the big ones). Each shape has its own
  // entry so a dedicated recording can be dropped in without touching logic.
  var DRY_FIRE_KICK_FRAMES = 6;  // duration of the empty-trigger flinch
  var DRY_FIRE_KICK_PIXELS = 3;  // peak backward shove of the aim piece (raw sprite px)
  var DRY_FIRE_SFX_BY_SHAPE = {
    pistol: SFX.NO_AMMO_LIGHT, uzi: SFX.NO_AMMO_LIGHT, rifle: SFX.NO_AMMO_LIGHT,
    magnum: SFX.NO_AMMO_HEAVY, shotgun: SFX.NO_AMMO_HEAVY, sniper: SFX.NO_AMMO_HEAVY,
    bazooka: SFX.NO_AMMO_HEAVY, flamethrower: SFX.NO_AMMO_HEAVY
  };
  // Pickup sound per item shape (one distinct sound per weapon; the three
  // melee weapons share the katana unsheathe).
  var PICKUP_SOUNDS = {
    machete: SFX.PICKUP_BLADE, axe: SFX.PICKUP_BLADE, sword: SFX.PICKUP_BLADE,
    pistol: SFX.PICKUP_PISTOL, magnum: SFX.PICKUP_MAGNUM, uzi: SFX.PICKUP_UZI,
    rifle: SFX.PICKUP_RIFLE, shotgun: SFX.PICKUP_SHOTGUN, sniper: SFX.PICKUP_SNIPER,
    bazooka: SFX.PICKUP_BAZOOKA, flamethrower: SFX.PICKUP_FLAMETHROWER,
    grenade: SFX.PICKUP_GRENADE, molotov: SFX.PICKUP_MOLOTOV
  };
  function playPickupSound(weapon) {
    playSfx(PICKUP_SOUNDS[weapon.shape]);
  }
  var PUNCH_HIT_SOUNDS = [SFX.PUNCH_HIT_FIRST, SFX.PUNCH_HIT_SECOND, SFX.PUNCH_FINISHER]; // combo links 1..3
  function playGunAimSound(gun) {
    var sounds = GUN_SOUNDS[gun.shape];
    if (sounds) playSfx(sounds.aim);
  }
  function playGunFireSound(gun) {
    var sounds = GUN_SOUNDS[gun.shape];
    if (!sounds) return;
    playSfx(sounds.fire);
    if (sounds.pump) {
      playSfxAfterSteps(SFX.SHOTGUN_PUMP_FIRST, SHOTGUN_PUMP_FIRST_DELAY_STEPS);
      playSfxAfterSteps(SFX.SHOTGUN_PUMP_SECOND, SHOTGUN_PUMP_SECOND_DELAY_STEPS);
    }
  }
  // Throw power scales the extracted launch vector (cos*5.5, sin*5.5 - 2 in
  // Player.ReleaseThrowable) as a whole. The doubled throw was too strong, so
  // it was cut 50% (2 * 0.5) = the extracted strength, then raised 30%
  // because that felt too slow: 1.3x the original throw.
  var GRENADE_THROW_POWER_BOOST = 2;
  var GRENADE_THROW_POWER_REDUCTION = 0.5;
  var GRENADE_THROW_POWER_RECOVERY = 1.3;
  var GRENADE_THROW_POWER_MULTIPLIER =
    GRENADE_THROW_POWER_BOOST * GRENADE_THROW_POWER_REDUCTION * GRENADE_THROW_POWER_RECOVERY;
  var GRENADE_FUSE_SECONDS = 3.5; // button press -> detonation (cooking in hand + flight)
  var GRENADE_FUSE_FRAMES = GRENADE_FUSE_SECONDS * FPS;
  var GRENADE_BULLET_HIT_HALF = 12;  // bullet hitbox half-width around a grenade (px)
  var GRENADE_BULLET_HIT_HALF_Y = 16; // half-height: covers the muzzle-to-grenade drop of a delayed quick-shot
  var GRENADE_THROW_SPEED_SCALE = 0.7; // slower launch than the shared throw power
  var GRENADE_THROW_LIFT_SCALE = 1.35; // a bit more upward bias -> higher apex
  var GRENADE_GRAVITY_SCALE = 0.55;    // half-floating flight (frag grenades only)
  var GRENADE = {
    name: 'Grenade', throwSpeed: 5.5 * GRENADE_THROW_POWER_MULTIPLIER, upBias: -2, throwTimer: GRENADE_FUSE_FRAMES, ammo: 3,
    radius: 90, damageMax: 20, damageMin: 4, shape: 'grenade'
  };
  GRENADE.throwSpeed *= TIME_SCALE;
  GRENADE.upBias *= TIME_SCALE;
  GRENADE.upBias *= GRENADE_THROW_POWER_MULTIPLIER; // the whole launch vector doubles, not just its magnitude

  // Slowmo powerups (extracted WeaponPowerupData): t_time IS the duration in
  // seconds; the slowmo ramp takes the whole game to ~0.2 in the artifact.
  // Here the pickup eases gameSpeed to SLOWMO_ITEM_TARGET over t_time seconds
  // with a 1-second ramp back out. The target sits at a 0.4 effective feel
  // (requested: one notch deeper than the old 0.5) on top of the TIME_SCALE
  // base, which is what makes the dodge window readable for the player.
  var SLOWMO_ITEM_TARGET = 0.4 / 0.75; // factor over base pace: effective 0.4
  var SLOWMO_ITEM_RAMP = 24 * ANIM_TICKS_TO_STEPS; // 1 s ramp (extracted 24 ticks)
  // The ammo crawl inside a slow cam (requested): while the window holds
  // (gameSpeed < 1) every projectile — bullets, grenades/molotovs, flamethrower
  // puffs, rockets — moves a further SLOWMO_AMMO_EXTRA share of that slowed
  // pace, so ordinary bullets become readable and sidestep-able. Fuses and
  // flame lives tick on the same share, so thrown ordnance hangs mid-flight
  // like the rest of the scene instead of detonating on hidden schedule. At a
  // healthy gameSpeed the share is exactly 1: ammo only ever slows down.
  var SLOWMO_AMMO_EXTRA = 0.35;
  var MOLOTOV = { kind: 'throwable', name: 'Molotov', throwSpeed: 5.5, upBias: -2, throwTimer: 72, ammo: 3, shape: 'molotov', fire: true };
  var SLOWMO_05 = { kind: 'powerup', power: 'slowmo', name: 'Slowmo 0.5', time: 5, shape: 'slowmo' };
  var SLOWMO_10 = { kind: 'powerup', power: 'slowmo', name: 'Slowmo 1.0', time: 10, shape: 'slowmo' };
  // Health pickups (extracted WeaponPowerupData): Ammo IS the heal amount,
  // applied as HP += Ammo on pickup (clamped at 100 by the HP setter)
  // CRATE props (extracted AddBox "CRATE"): 14x14, BodyData hp 40, dynamic
  // (gravity), Kickable KickPower 1.7, PlayerFragile, AffectedByExplosions,
  // breaks into 3 debris pieces.
  var CRATE_SIZE = 20; // big enough to hide behind (the fighter is 16.8x26.4)
  // Burning crates (extracted: AddFireToObject -> ObjectOnFire; a burning body
  // takes Damage_Fire every fire tick until it breaks). Fire contact only
  // LIGHTS the crate; it then burns down over this many steps (~40 ticks of
  // the 24 fps fire clock) showing progressive charring, and breaks.
  var CRATE_BURN_DURATION_STEPS = 100;
  var CRATE_BURN_FLAME_INTERVAL = 4;
  var CRATE_HP = 20; // breaks after a couple of punches (fists deal 6/7/8)
  var CRATE_SPRITE = 131; // shipped crate art (superfighters/shapes/131.svg)
  var CRATE_GRAVITY = PLAYER_GRAVITY;
  // The game's gravity is ~4x the real one, which makes a prop this size topple
  // like a toy. Tipping over uses this share of it, so a box swings and falls
  // at the pace of a heavy object (the tipping point itself does not move: it
  // is geometry, atan(width / height)).
  var PROP_TIP_GRAVITY_SHARE = 0.3;
  var RIDER_TELEPORT_PX = 12;           // px/step: a rider 'moving' this far was respawned or thrown, not walking
  // Weighted props: the punch impulse stopped flinging the crate across the
  // floor (a punch now nudges a heavy prop; the friction retention below
  // carries the coast so the shove reads fluid instead of sticky)
  var CRATE_FRICTION = 0.9;
  // Extracted Wood material (MaterialsData: density 3, friction 0.6,
  // restitution 0.3) under Box2D Coulomb friction: a grounded body loses a
  // CONSTANT friction * gravity of speed per step, so a shoved crate stops
  // quickly instead of gliding on an exponential tail like ice.
  var CRATE_WOOD_FRICTION = 0.6;
  var CRATE_OVERHANG_SLIDE = 0.08; // px/step^2 of outward slide beyond friction once the centre hangs off an edge
  var CRATE_GROUND_DECELERATION = CRATE_WOOD_FRICTION * CRATE_GRAVITY; // px/step^2
  var CRATE_PUNCH_PUSH_Y = 0;      // punches shove, they never vault the prop (heavy)
  var CRATE_BOUNCE = 0.35;
  var CRATE_QUARTER_TURN = Math.PI / 2;
  var CRATE_TUMBLE_PER_VX = 0.04;   // rad/step of spin per px/step of slide speed
  var CRATE_TUMBLE_MAX_SPIN = 0.3;  // fastest tumble (rad/step)
  var CRATE_KICK_POWER = 1.7;
  // Kick impulse on a crate (extracted Kick(): ApplyImpulse(dir*KickPower,
  // -KickPower) plus the (0,-0.4) contact push). KickPower 1.7 m/s with the
  // 30 px/m scale at 24 fps = 1.7*30/24 = 2.125 px/tick; total vertical
  // -(1.7+0.4)*30/24 = -2.625. Same screen distance as the original.
  var CRATE_KICK_PUSH_X = ((1.7 * 30) / 24) * TIME_SCALE; // ≈ 1.6 px/step
  var PUNCH_FORCE_SHARE = 0.75;    // a bare-handed blow carries 75% of a kick's push
  var CRATE_PUNCH_PUSH_X = CRATE_KICK_PUSH_X * PUNCH_FORCE_SHARE;
  var CRATE_KICK_PUSH_Y = ((-(1.7 + 0.4) * 30) / 24) * TIME_SCALE; // ≈ -1.05 px/step

  // Explosive barrel props (shipped art 127.svg): a rigidbody tuned EXACTLY
  // like the crates, but destruction runs in two stages. Stage 1 — any
  // projectile or blast hit launches the barrel on a directed impulse and
  // swaps the art to the burning 161.svg (BurningState). Stage 2 — the first
  // solid contact while burning (ground touchdown, wall, crate, barrel or a
  // fighter) detonates: explodeAt ring + ground fire, plus a shower of
  // shipped flaming micro-fragments (153/164) that land as damaging fire
  // patches and burn out on a lifetime timer.
  var BARREL_SPRITE = 127;       // pristine red barrel (superfighters/shapes/127.svg)
  var BARREL_BURN_SPRITE = 161;  // burning-barrel stage-1 art (161.svg)
  var BARREL_FIRE_DEBRIS_SPRITES = [153, 164]; // flaming micro-fragments art
  // The explosive barrel is the SAME drum as the cement barrel (same 11x15
  // art at the 1.25 prop scale, mass, floor friction and response to blows,
  // heavy-props.js); only its burn/blast stages and the way a cylinder rolls
  // differ. Without the heavy-props rules it keeps the original barrel tuning.
  var BARREL_BODY = heavyApi ? HEAVY_CONFIG[HEAVY_KIND.CEMENT_BARREL] : null;
  var BARREL_MASS = BARREL_BODY ? BARREL_BODY.mass : 2;
  var BARREL_KICK_SPEED_RATIO = BARREL_BODY ? BARREL_BODY.kickSpeedRatio : 1.8 / 1.7;
  var BARREL_LIFT_RATIO = BARREL_BODY ? BARREL_BODY.liftRatio : 1 / 1.3;
  var BARREL_LIFT_TORQUE_RATIO = BARREL_BODY ? BARREL_BODY.liftTorqueRatio : 1 / 1.3;
  var BARREL_MELEE_VERTICAL_RATIO = BARREL_BODY ? BARREL_BODY.meleeVerticalRatio : 1;
  var BARREL_TORQUE_SCALE = BARREL_BODY ? BARREL_BODY.torqueScale : 1;
  var BARREL_MAX_HIT_SPIN = BARREL_BODY ? BARREL_BODY.maxHitSpin : 0.35;
  // the fire barrel shares the cement drum's body, but responds to hits with its own row
  var BARREL_RESPONSE = BARREL_BODY && heavyApi.EXPLOSIVE_BARREL_IMPACT_MULTIPLIERS
    ? heavyApi.EXPLOSIVE_BARREL_IMPACT_MULTIPLIERS
    : { vertical: 1, torque: 1, horizontal: 1 };
  var BARREL_HIT_VARIATION_SCALE = BARREL_BODY ? BARREL_BODY.hitVariationScale : undefined; // same narrow wobble as the cement drum
  var BARREL_W = BARREL_BODY ? BARREL_BODY.width : 14;
  var BARREL_H = BARREL_BODY ? BARREL_BODY.height : 19;
  // Coulomb floor friction (mu * g, like the crates): standing on its base the
  // drum slides with the cement barrel's grip; lying on its side it ROLLS, and
  // rolling resistance is a small fraction of that, so it keeps going.
  var BARREL_SLIDE_FRICTION = BARREL_BODY ? BARREL_BODY.friction : null;
  var BARREL_ROLL_FRICTION = 0.06;
  var BARREL_LYING_SIN = Math.SQRT1_2; // |sin(angle)| past 45 deg: it lies on its side
  // Tip-over model: the barrel is a rigid rounded cylinder seen from the side.
  // It has two stable poses (upright 14x19, lying 19x14) separated by a
  // gravity barrier at atan(W/H): below it the barrel falls back upright, past
  // it gravity topples it onto its side. Shoves are angular impulses (the base
  // grips while the top keeps going); the fall accelerates and bounces a little.
  var BARREL_TIP_BARRIER = Math.atan(BARREL_W / BARREL_H); // ~36 deg
  var BARREL_TIP_GRAVITY = 0.01;   // rad/step^2 toward the nearest stable pose
  var BARREL_TIP_BOUNCE = 0.2;     // restitution when it lands on its side / base
  var BARREL_TIP_IMPULSE = 0.17;   // rad/step of spin per px/step of shove
  var BARREL_TIP_MAX_SPIN = 0.22;  // rad/step cap (a hard shove never snaps it over in one step)
  var BARREL_SPIN_KICK = 0.15;     // scale of ignition / blast spin kicks
  var BARREL_GRAVITY = CRATE_GRAVITY;   // identical rigidbody tuning...
  var BARREL_FRICTION = CRATE_FRICTION; // ...to the crates (mass feel, ground
  var BARREL_BOUNCE = CRATE_BOUNCE;     // friction, restitution)
  var BARREL_HOP_VY = -3.5;      // ignition lift: the launch reads before stage 2
  var BARREL_BULLET_IMPULSE_MULT = 0.12; // F = v_bullet * k on the launch (base)
  var BARREL_IMPULSE_FORCE_MULT = 0.03;  // + the bullet's impulseForce (0.4-1.25)
  var BARREL_BULLET_SPIN_SCATTER = 0.6; // random spin kick left once the hit height drives the torque
  var BARREL_DET_SPEED = 1.2;    // surface-impact speed a burning barrel goes up on
  // Blast staging needs real contact: the ring only stages the barrel when
  // its center lands within a touching band of the barrel BODY (closest point
  // of the AABB), so a grenade popping across the yard never lights one
  var BARREL_BLAST_TRIGGER_DIST = 24; // px from the barrel surface to stage it
  var BARREL_BLAST_POINT_BLANK = 10;  // inside this the chain pop happens now
  var BARREL_SMOULTER_FUSE = 120; // a burning barrel dormant at rest still pops (2 s)
  var BARREL_TOUCH_BURN_DAMAGE = 3; // fire damage when the burning barrel grazes
  var BARREL_BLAST_RADIUS = 65; // blast radius tightened (was 100) to fit the map scale
  var BARREL_BLAST_DAMAGE_MAX = 40;
  var BARREL_BLAST_DAMAGE_MIN = 8;
  var BARREL_DEBRIS_MIN = 6;     // fragments per detonation
  var BARREL_DEBRIS_MAX = 8;
  var BARREL_DEBRIS_BURST = 5.5; // 0..360 deg radial launch speed (px/step)
  var BARREL_DEBRIS_LIFE_MIN = 180; // 3 s floor patch at 60 Hz (requested 3-5 s)
  var BARREL_DEBRIS_LIFE_MAX = 300; // 5 s
  var BARREL_DEBRIS_CAP = 40;    // chain detonations never flood the patch array
  var HEALTH_PILLS = { kind: 'health', name: 'Pills', ammo: 25, shape: 'pills' };
  var HEALTH_MEDKIT = { kind: 'health', name: 'Medkit', ammo: 50, shape: 'medkit' };
  // AbortAiming drop velocities (extracted): forced [hit while aiming], empty [toss]
  var DROP_TOSS_FORCED = { vx: -2, vy: 2 + 2 }; // vx *= -dir
  var DROP_TOSS_EMPTY = { vx: 2, vy: -1 }; // vx *= dir

  // ---------- Constants (design choices — firearms) ----------
  var AIM_PITCH_MAX = 90; // extracted: UpperAimPitch/LowerAimPitch (both aim modes)
  // Aim pitch acceleration: the artifact accelerates the pitch at ±2 deg per
  // TICK squared (24 fps); converted to 60 Hz steps that is 2 / ANIM_TICKS²
  // per step², so the full sweep to ±90° keeps the artifact's real-time pace
  // (~0.4 s) instead of running 2.5x faster.
  var AIM_PITCH_ACCEL = 2 / (ANIM_TICKS_TO_STEPS * ANIM_TICKS_TO_STEPS);
  var AIM_TURNAROUND_FRAMES = 8; // design: turn-around animation duration
  var BULLET_KNOCKBACK = 3 * VEL_SCALE; // between punch and kick, same per-tick units
  var BULLET_AERIAL_KNOCKBACK_MULT = 1.5;
  var GRENADE_EXPLOSION_FRAMES = 10; // visual ring duration

  // ---------- Constants (design choices — gore) ----------
  // Strong blasts (bazooka 110, grenade 90) show viscera ONLY when the fighter
  // dies in them (hp <= 0): the corpse tears open, chunks of flesh and blood
  // droplets burst out with the blast impulse (flat falloff, like the crate
  // AffectedByExplosions push) and whatever lands scars the floor until the
  // round restarts. Survivors of the same blast stay clean — they only ragdoll.
  // The sprites are the shipped gore art: shapes 147/150/153/181/183 = splats
  // and meat chunks, 141 the skin strip, 164/167/170/529/570/573/1310 the
  // small droplets. Shape 161 is deliberately NOT here: that bitmap (160) is
  // the exploded red BARREL art, not viscera.
  var GORE_EXPLOSION_MIN_RADIUS = 90; // any blast this strong gibs a dead fighter
  var GORE_GRAVITY = PLAYER_GRAVITY * 0.55; // soft debris falls slower than fighters
  var GORE_CHUNK_COUNT = 10; // meat/splat chunks per gib
  var GORE_DROP_COUNT = 18; // droplets per gib
  var GORE_MIN_CHUNKS = 4; // edge-of-radius kills keep a visible burst
  var GORE_MIN_DROPS = 6;
  var CRUSH_GORE_RANGE_SCALE = 0.3; // crushed fighters burst open, but the gore only splashes a short way
  var GORE_BURST_SPEED = 7; // px/step at full blast falloff (a bit over the body knockback)
  var GORE_AIR_LIFE = 150; // airborne pieces fade out after ~2.5 s of flight
  var GORE_FADE_LIFE = 45; // alpha fades over the last 45 ticks (glass-shard style)
  var GORE_STAIN_MAX = 90; // frozen gore decal cap (oldest vanish)
  var GORE_STAIN_CHUNK_PROB = 0.6; // landed chunks stay as a splat most of the time

  // ---------- Constants (extracted — explosion ground fire) ----------
  // Fires.as fires ONE splash per blast: TriggerFireAt('BARREL') fans 18
  // embers over the lower semicircle, each launching at 2.2 (+ random 0.4)
  // from 3 px off the blast point with a -rand(0.5) vy lift bias.
  // FireNodeData owns the life (UpdateFires at 24 fps): embers glide with a
  // 0.9 drag while SlowingDown until TotalVel <= 2, then VelY += 0.2 gravity
  // wins and the ember falls until the statics swallow it. Landed, the burn
  // timer runs down; a landing within 3 px of another ember merges (the
  // longer BurnTimer wins, the duplicate node ends). The pool here burns
  // 1 - 2 s on the floor max (requested), and the death stretch collapses
  // the radius + alpha fast (fire_effect_ground ended its sprite at 0.4).
  var EXPLOSION_FIRE_COUNT = 18; // the barrel fan (TriggerFireAt _loc10_)
  var EXPLOSION_FIRE_SPEED = 2.2 * VEL_SCALE; // launch speed (_loc8_)
  var EXPLOSION_FIRE_SPEED_JITTER = 0.4 * VEL_SCALE; // launch spread (_loc9_)
  var EXPLOSION_FIRE_START_OFFSET = 3; // px off the blast point (TriggerFireAt)
  var EMBER_RISE_BIAS = 0.5; // rand lift taken off vy (TriggerFireAt vy line)
  var FLAME_NODE_LIFE = 96 * 60 / 24;      // _burn_timer 96 ticks (24 fps) -> steps
  var FLAME_FIRE_INTERVAL = 2 * 60 / 24;   // FlameAway counter 2 ticks -> 5 steps
  var FLAME_GLIDE_STOP = 2 * 24 / 60;      // TotalVel <= 2 per tick -> px/step
  var FLAME_FALL_GRAVITY = 0.2 * (24 / 60) * (24 / 60); // VelY += 0.2 per tick, per step
  var FLAME_CONTACT_BURN = 20;             // BurnState += 20 per flamethrower contact
  var FLAME_CONTACT_STEPS = 5;             // PlayerOverlap runs every 84 ms (~5 steps)
  var FLAME_CONTACT_HP = 0.6 * 24 / 60;    // FireContact(true, 3): extra 0.2 * 3 per tick
  var MOLOTOV_FIRE_COUNT = 22;              // TriggerFireAt: nodes in the full circle
  var MOLOTOV_FIRE_SPEED = 3;               // launch speed (_loc8_)
  var MOLOTOV_FIRE_SPEED_JITTER = 0.5;      // launch spread (_loc9_)
  var MOLOTOV_FIRE_LIFE = 4 * FPS;          // the floor fire stays lit exactly 4 s once landed
  var MOLOTOV_FLAME_SCALE = 1.8;            // bigger, more dangerous-looking flames
  var MOLOTOV_TRAIL_FLAMES = 2;             // flame particles per trail emission
  var MOLOTOV_TRAIL_CADENCE = 2;            // steps between flame particles on the flying bottle
  var MOLOTOV_TRAIL_OFFSET_Y = 5;           // the rag sits 5 px above the bottle centre
  var MOLOTOV_BURN_RADIUS = 20;            // TriggerFireAt: players within 20 px burn at once
  var EMBER_AIR_DRAG = 0.9; // per-24fps-tick glide drag (UpdateFires non-flame)
  var EMBER_FALL_GRAVITY = 0.2 * 24 / FPS; // VelY += 0.2 per 24fps tick -> 60 Hz
  var EMBER_GLIDE_STOP = 2 * VEL_SCALE; // TotalVel <= 2 ends SlowingDown
  var EMBER_LAND_PROBE = 2; // half-width of the landing scan span (grenade rest)
  var EMBER_MERGE_DIST = 12; // GetNearbyFireNode merge (3 px on the 30 px/m scale)
  var EMBER_GROUND_LIFE_MIN = 60; // 1 s on the floor at 60 Hz (requested max)
  var EMBER_GROUND_LIFE_MAX = 120; // 2 s on the floor at 60 Hz
  var EMBER_DIE_FRACTION = 0.3; // the last stretch shrinks radius + alpha fast
  var EMBER_CONTACT_SIZE = 12; // FireArea-scale ember hitbox on the pool
  var EMBER_CONTACT_DAMAGE = 3; // ground residue is a lighter touch than a 4 puff
  var EMBER_CRATE_BURN_DAMAGE = 2; // object fire pulse (Damage_Fire 2)
  var EMBER_CRATE_BURN_CADENCE = 5; // ObjectFireDamage ran at 84 ms (~5 steps)
  var EMBER_SPARK_LEVEL_MIN = 8; // spark puff cadence floor (AddEffectGround 3-5)
  var EMBER_SPARK_LEVEL_MAX = 12; // spark puff cadence ceiling (24 fps steps)

  // ---------- Constants (extracted — death & slow-motion) ----------
  var SLOWMO_RAMP_IN = 48; // SlowmoData(0, 48, 24, 0.2)
  var SLOWMO_RAMP_OUT = 24;
  var SLOWMO_SPEED = 0.2; // target game_speed

  // ---------- Constants (extracted — rocket ride / StuckToProjectile) ----------
  // A bazooka rocket that hits a fighter does NOT gib them: it hooks a ride.
  // The victim is parked ON the rocket (StuckToProjectile), a global dramatic
  // slow cam freezes the world (UpdateRockets -> AddSlowmotion(SlowmoData(0,
  // 12, 6, 0.01))), and the victim steers while riding:
  //   left/right keys -> rocket Angle ±20 * game_speed per tick (Player.as
  //   389-393: _keyPressed[KEY_LEFT] -= / _keyPressed[KEY_RIGHT] +=)
  //   RocketRideTimer += game_speed per tick, > 150 -> the rocket detonates
  //   alone (Player.as 383-386). Every detonation gibs the rider.
  var ROCKET_STEER_DEG = 20; // deg per game-speed tick (±20)
  var ROCKET_WOBBLE_DEG = 8; // random (rand * 8 - 4) per tick in UpdateRockets
  var ROCKET_RIDE_MAX = 150; // RocketRideTimer cap -> own rocket detonates
  var ROCKET_RIDE_SPEED_MULT = 0.5; // velocity halves while a rider is attached
  var SLOWMO_ROCKET_STAY = Math.round(12 * ANIM_TICKS_TO_STEPS); // 12 ticks hold
  var SLOWMO_ROCKET_OUT = Math.round(6 * ANIM_TICKS_TO_STEPS);   // 6 ticks fade
  var SLOWMO_ROCKET_SPEED = 0.01; // the freeze factor (SlowmoData 4th arg)

  // ---------- Constants (extracted — dive / tackle) ----------
  // Dive speed eased down from the extracted 3.5 (requested: less momentum).
  var DIVE_SPEED = 1.05 * VEL_SCALE; // PlayerState.DiveSpeed (full sprint dive)
  var DIVE_SPEED_SHORT = 0.55 * VEL_SCALE; // short dive (ShortDiveAvailable)
  var DIVE_HOP = -2 * VEL_SCALE; // AirVelocityY -= 2 on dive
  // The roll that closes a dive is slower and shorter-reaching than a plain roll.
  var DIVE_LANDING_ROLL_SPEED = 1.2;
  var DIVE_LANDING_ROLL_FRAMES = 22;
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
  var WALLJUMP_VERTICAL = -5 * VEL_SCALE * JUMP_TIME_FACTOR; // PlayerState.PlayerWallJumpPower
  var WALLJUMP_HORIZONTAL = PLAYER_RUN_SPEED; // WallJumpSpeed (= _runSpeed)
  var CLIMB_SPEED = 1.5 * VEL_SCALE; // PlayerState.ClimbSpeed

  // ---------- Constants (design choices — death, round & bot) ----------
  var ROUND_RESTART_FRAMES = 180; // legacy auto-restart after a kill (without round-flow.js)
  var ROUND_CONTINUE_CODE = 'Space'; // after the round-end slow motion, Space loads the next round
  var ROUND_END_SLOWMO_STEPS = roundFlowApi ? roundFlowApi.ROUND_END_SLOWMO_SECONDS * FPS : 0; // real-time steps
  var BOT_TOGGLE_CODE = 'KeyB'; // P2 bot toggle
  var PAUSE_TOGGLE_CODE = 'KeyP'; // Pause toggle (freeze/resume the sim)
  var BOT_THINK_MIN = 6; // BotRandomize-ish decision cadence
  var BOT_THINK_RAND = 6;
  // Melee punches must land from closer: fighter-vs-fighter reach shrinks to 60%.
  var MELEE_HIT_REACH_FACTOR = 0.6;
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
  var PLAYER_SIZE_SCALE = 0.6 * FIGHTER_REDUCTION; // the requested 40% smaller fighter body, then 15 % smaller again
  // The collision body is narrower than the artifact's 28 px frame (that width
  // includes the swinging arms): the torso and legs fit through gaps a full-width
  // box would jam in. Height and the drawn sprite are untouched (it is drawn from the centre).
  // While rolling the body folds up: the collider is half as tall and 30 % narrower
  // (feet and centre stay put), so a roll can squeeze through narrow gaps. It
  // stands back up to full size as soon as there is room above.
  var ROLL_COLLIDER_HEIGHT_SHARE = 0.5;
  var ROLL_COLLIDER_WIDTH_SHARE = 0.7;
  var PLAYER_BODY_WIDTH_SHARE = 0.7; // 20 % narrower first, then 50 % more narrowing on top (0.8 -> 0.7 of the frame)
  var PUNCH_ANIM_FRAMES = Math.round(12 * ANIM_TICKS_TO_STEPS); // PUNCH anim ≈ 12 artifact frames per link
  var PUNCH_RANGE = 16;
  var KICK_COOLDOWN = Math.round(8 * ANIM_TICKS_TO_STEPS); // extracted KickingCooldown = 8 ticks
  // BackToIdle (extracted RangedUp): after firing, the aim stance STAYS with
  // the pitch where it was; only after AIM_HOLD_TIME without firing does the
  // fighter drop back to the fighting idle (pitch reset).
  // Extracted: BackToIdleTimer = 6 ticks (rearmed on every shot AND while the
  // fire sequence plays), decremented 1 per tick -> 6 ticks = 0.25 s.
  var AIM_HOLD_TIME = Math.round(6 * ANIM_TICKS_TO_STEPS); // 6 ticks at 24 fps = 15 steps
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

  // ===================================================================
  // COVER SYSTEM — reusable "take cover behind a prop" mechanics.
  //
  // ICoverable contract (any interactive prop can opt in):
  //   x, y, w, h     — current bounding rect (the prop keeps it updated)
  //   isCoverAlive() — optional: false when the prop cannot shelter anyone
  //                    anymore. Convention when missing: a destructible
  //                    prop with hp > 0 and !dead.
  //   onCoverEnter(p) / onCoverExit(p) — optional notification hooks.
  //
  // CoverSystem — shared registry + proximity scans. Whole prop arrays
  // register as *sources* (the crates today, barrels/sandbags tomorrow), so
  // the scans always read live props with no spawn/destroy bookkeeping.
  //
  // CoverComponent — the per-fighter cover state machine: entering by
  // ROLLING toward a prop within the interaction range (or kneeling flush
  // against one), aiming and firing freely from cover, and automatically
  // returning to the cover pose once the attack ends. Walking out through
  // the open side, jumping, rolling away, climbing, a knockdown, or the
  // prop breaking all detach the fighter.
  // ===================================================================
  var COVER_SNAP_GAP = 6;         // gap (px) that counts as "flush against" the prop
  var COVER_POST_ROLL_GAP = 10;   // attach window right after a roll ends
  var COVER_ROLL_PROXIMITY = 30;  // rolling toward a nearer prop pre-arms the attach
  var COVER_GROUND_TOLERANCE = 6; // prop base vs feet alignment (cover is ground level)

  var CoverSystem = {
    coverables: [], // individually registered ICoverable props (standalone)
    sources: [],    // arrays of ICoverable props (crates today, barrels tomorrow)
    registerSource: function (list) {
      if (this.sources.indexOf(list) < 0) this.sources.push(list);
    },
    register: function (obj) {
      if (this.coverables.indexOf(obj) < 0) this.coverables.push(obj);
    },
    reset: function () {
      this.sources.length = 0;
      this.coverables.length = 0;
    },
    contains: function (obj) {
      if (!obj) return false;
      var props = this._allProps();
      for (var i = 0; i < props.length; i++) if (props[i] === obj) return true;
      return false;
    },
    isAlive: function (obj) {
      if (typeof obj.isCoverAlive === 'function') return !!obj.isCoverAlive();
      if (obj.dead) return false; // destructible-prop convention
      return typeof obj.hp === 'number' ? obj.hp > 0 : true;
    },
    _allProps: function () {
      var props = [];
      for (var si = 0; si < this.sources.length; si++) {
        var list = this.sources[si];
        for (var j = 0; j < list.length; j++) props.push(list[j]);
      }
      for (var ei = 0; ei < this.coverables.length; ei++) props.push(this.coverables[ei]);
      return props;
    },
    // Ground-level prop adjacent in `dir` (0 = either side), gap <= snapGap
    // from the fighter's hitbox: the cover proximity hitbox.
    findNear: function (player, dir, snapGap, groundTolerance) {
      var myFeet = player.y + player.h;
      var best = null, bestGap = 1e9;
      var tol = groundTolerance || COVER_GROUND_TOLERANCE;
      var props = this._allProps();
      for (var i = 0; i < props.length; i++) {
        var c = props[i];
        if (!this.isAlive(c)) continue;
        if (Math.abs((c.y + c.h) - myFeet) > tol) continue; // cover is ground level
        var gapR = c.x - (player.x + player.w); // prop ahead moving right
        var gapL = player.x - (c.x + c.w);      // prop ahead moving left
        var gap = -1;
        if (dir > 0 && gapR >= -2 && gapR <= snapGap) gap = gapR;
        else if (dir < 0 && gapL >= -2 && gapL <= snapGap) gap = gapL;
        else if (dir === 0) {
          if (gapR >= -2 && gapR <= snapGap) gap = gapR;
          else if (gapL >= -2 && gapL <= snapGap) gap = gapL;
        }
        if (gap >= 0 && gap < bestGap) { best = c; bestGap = gap; }
      }
      return best;
    },
    // Prop ahead of the fighter within `proximity`: the roll-into-cover
    // target. Must be reachable by the roll, i.e. straight ahead at the
    // same ground level.
    findRollTarget: function (player, dir, proximity) {
      if (!dir) return null;
      var myFeet = player.y + player.h;
      var best = null, bestGap = 1e9;
      var props = this._allProps();
      for (var i = 0; i < props.length; i++) {
        var c = props[i];
        if (!this.isAlive(c)) continue;
        if (Math.abs((c.y + c.h) - myFeet) > COVER_GROUND_TOLERANCE) continue;
        var gap = dir > 0 ? c.x - (player.x + player.w) : player.x - (c.x + c.w);
        if (gap < -2 || gap > proximity) continue;
        if (gap < bestGap) { best = c; bestGap = gap; }
      }
      return best;
    }
  };
  // Per-fighter cover state machine. Player.step drives it: seek (kneel
  // intent), armRollEnter/updateRoll/tryAttachAfterRoll (roll-into-cover),
  // update (hold validation + pose), reset (round restart).
  function CoverComponent(player) {
    this.owner = player;
    this.target = null;     // attached ICoverable (null = not in cover)
    this.side = 0;          // +1: prop to the owner's right, -1: to the left
    this.seekTarget = null; // kneel intent: prop found flush while holding DOWN
    this.pending = null;    // roll-into-cover: prop the roll was aimed at
  }

  CoverComponent.prototype.isAttached = function () {
    return this.target !== null;
  };

  CoverComponent.prototype.reset = function () {
    this.detach('reset');
    this.seekTarget = null;
    this.pending = null;
  };

  // Kneel intent: holding DOWN while flush against a ground-level prop.
  // DOWN is REQUIRED (the goal was the extracted taking-cover gate): plain
  // adjacency without the key must never hijack kicks/punches or facing.
  CoverComponent.prototype.seek = function (dir) {
    var p = this.owner;
    this.seekTarget =
      p.hp > 0 && p.pressDownKey() && !p.aiming && !p.falling && !p.knockedDown && !p.climbing
        ? CoverSystem.findNear(p, dir, COVER_SNAP_GAP, COVER_GROUND_TOLERANCE)
        : null;
    return this.seekTarget;
  };

  // Roll-into-cover: pre-arm the prop ahead within the interaction range so
  // the roll latches onto it (only the human gains this intent; the bot
  // keeps the plain dodge, its pathfinding does not model cover).
  CoverComponent.prototype.armRollEnter = function () {
    var p = this.owner;
    this.pending = p.hp > 0 && !p.botControlled
      ? CoverSystem.findRollTarget(p, p.lastDirX, COVER_ROLL_PROXIMITY)
      : null;
    return this.pending;
  };

  // Roll update: closing in on the pending prop ends the roll attached to
  // it. Returns true when the caller must end the roll right now.
  CoverComponent.prototype.updateRoll = function () {
    if (!this.pending || !this.owner.rolling) return false;
    var t = this.pending;
    if (!CoverSystem.isAlive(t)) { this.pending = null; return false; }
    var p = this.owner;
    var gap = p.lastDirX > 0 ? t.x - (p.x + p.w) : p.x - (t.x + t.w);
    if (gap > COVER_SNAP_GAP) return false;
    this.attach(t); // the roll stops the moment the body closes in on the prop
    this.pending = null;
    return true;
  };

  // Late latch: a roll that ends just short of a prop still attaches
  CoverComponent.prototype.tryAttachAfterRoll = function () {
    var p = this.owner;
    this.pending = null;
    var t = p.onGround && p.hp > 0
      ? CoverSystem.findNear(p, p.lastDirX, COVER_POST_ROLL_GAP, COVER_GROUND_TOLERANCE)
      : null;
    if (t) this.attach(t);
    return this.target;
  };

  CoverComponent.prototype.attach = function (prop) {
    var p = this.owner;
    if (!CoverSystem.isAlive(prop) || !p.onGround) return false;
    if (this.target === prop) return true;
    if (this.target) this.detach('switch');
    this.target = prop;
    this.side = (prop.x + prop.w / 2) > (p.x + p.w / 2) ? 1 : -1;
    p.inCover = true; // the pose flag the renderer reads (cover sprite)
    if (!p.aiming) p.lastDirX = this.openSideDirection(); // back to the prop: face the open side
    if (typeof prop.onCoverEnter === 'function') prop.onCoverEnter(p);
    return true;
  };

  // Facing that points away from the sheltering prop (the open side).
  // Falls back to the current facing when not attached.
  CoverComponent.prototype.openSideDirection = function () {
    if (this.side === 0) return this.owner.lastDirX;
    return this.side > 0 ? -1 : 1;
  };

  // Facing toward the prop (aiming over it from cover).
  CoverComponent.prototype.coverFacingDirection = function () {
    return -this.openSideDirection();
  };

  CoverComponent.prototype.detach = function (why) {
    if (this.target) {
      if (typeof this.target.onCoverExit === 'function') this.target.onCoverExit(this.owner);
      this.target = null;
      this.side = 0;
      this.owner.inCover = false;
    }
  };

  // Per-step hold validation: keeps the fighter glued to the cover while the
  // state supports it and auto-detaches otherwise. Returns true while holding.
  CoverComponent.prototype.update = function (controllable, dir) {
    var p = this.owner;
    if (this.target) {
      var t = this.target;
      var broken = !CoverSystem.contains(t) || !CoverSystem.isAlive(t) ||
        !controllable || !p.onGround || p.punching || p.grabbedBy ||
        Math.abs((t.y + t.h) - (p.y + p.h)) > COVER_GROUND_TOLERANCE ||
        // walking out through the open side ends the cover
        (dir !== 0 && dir === p.lastDirX && !p.aiming && !p.pressDownKey());
      if (broken) this.detach('broken');
    }
    // kneel flush against the prop found this frame (proximity + DOWN)
    if (!this.target && this.seekTarget) {
      if (controllable && p.onGround && p.hp > 0 && !p.rolling && !p.falling &&
          !p.knockedDown && CoverSystem.isAlive(this.seekTarget)) {
        this.attach(this.seekTarget);
      }
      this.seekTarget = null;
    }
    if (!p.rolling) this.pending = null; // a cancelled/finished roll drops the arm
    return this.target !== null;
  };

  // Dynamic crates (extracted CRATE props; pushable, kickable, standable).
  // The whole array registers as a cover source: every crate alive inside
  // it is automatically an ICoverable (hp/dead match the default contract).
  var crates = [];
  CoverSystem.registerSource(crates);
  // `heavyKind` (optional) turns the crate into a heavy prop: it keeps every
  // crate contact (push, stack, stand, blast) but takes its size, mass, hit
  // points and art from the heavy-props config.
  function createCrate(x, yBottom, heavyKind) {
    var config = heavyKind ? HEAVY_CONFIG[heavyKind] : null;
    var width = config ? config.width : CRATE_SIZE;
    var height = config ? config.height : CRATE_SIZE;
    var hitPoints = config ? config.hitPoints : CRATE_HP;
    var c = {
      x: x, y: yBottom - height, w: width, h: height,
      sx: x, sy: yBottom - height, // home spot: crates that fall off respawn here
      vx: 0, vy: 0, hp: hitPoints, angle: 0, spin: 0,
      resting: true, hp0: hitPoints,
      heavyKind: heavyKind || null,
      heavyConfig: config,
      mass: config ? config.mass : CRATE_MASS,
      baseW: width, baseH: height, // unrotated art size; w/h follow the rotation (rotated hitbox)
      bouncing: false // true from a bounce launch until the prop touches down again
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

  // Heavy props: [kind, x, yBottom] (the settle pass drops them onto the floor).
  var heavyCrateSpawns = heavyApi ? [
    [HEAVY_KIND.METAL_CRATE, 250, 459],  // outdoor floor, beside the fence crates
    [HEAVY_KIND.BOUNCER, 540, 447],      // indoor ground floor
    [HEAVY_KIND.CEMENT_BARREL, 150, 459], // outdoor floor
    [HEAVY_KIND.TABLE, 400, 447]         // indoor ground floor
  ] : [];
  for (var _hs = 0; _hs < heavyCrateSpawns.length; _hs++) {
    createCrate(heavyCrateSpawns[_hs][1], heavyCrateSpawns[_hs][2], heavyCrateSpawns[_hs][0]);
  }

  var crateRespawns = []; // { x, y, timer } — destroyed crates come back home
  var CRATE_RESPAWN_DELAY = 300; // 5 s at 60 Hz

  // Box2D-style contact: a moving crate resolves against both fighters.
  // Falling on a fighter knocks him down (BodyData CanKnockDownPlayer, crush
  // damage 0); sliding past shoves him; rising under him carries him.
  // ---------- Anti-tunnelling ----------
  // Substepping: a prop never travels more than PROP_MAX_SUBSTEP_PX in one
  // collision pass (fast props take up to PROP_MAX_SUBSTEPS micro-steps per
  // frame); velocities are clamped so no impulse can outrun the colliders.
  var PROP_MAX_SPEED = 14;           // px/step: hard cap for crates, barrels, scraps
  var PROP_MAX_SUBSTEP_PX = 3;       // smaller than the thinnest prop
  var PROP_MAX_SUBSTEPS = 8;
  var FIGHTER_MAX_AIR_SPEED = 16;    // px/step cap on airVelocityX/Y (the fighter already substeps ceil(speed))
  var PROP_CONTACT_SLOP = 0.5;              // px of overlap still read as "touching"
  var PROP_SIDE_CONTACT_MIN_OVERLAP_Y = 2;  // px of shared height below which a contact is a graze, not a side hit
  var PROP_SIDE_RESTITUTION = 0.1;          // wood/metal props barely bounce off each other
  var PROP_DEEP_OVERLAP_SHARE = 0.6; // overlap share of the body that counts as "tunnelled into a solid"

  function clampSpeed(value, limit) {
    return value > limit ? limit : (value < -limit ? -limit : value);
  }
  function clampPropSpeed(prop) {
    prop.vx = clampSpeed(prop.vx, PROP_MAX_SPEED);
    prop.vy = clampSpeed(prop.vy, PROP_MAX_SPEED);
  }
  function propSubsteps(speed) {
    return Math.min(PROP_MAX_SUBSTEPS, Math.max(1, Math.ceil(speed / PROP_MAX_SUBSTEP_PX)));
  }

  // ---------- Props through the station doors ----------
  // The black entrances are linked doorways (doorPortals). A prop sliding or
  // flying into one toward the door side comes out of the linked doorway with
  // its velocity and its height above the doorway floor intact (door-portal.js),
  // exactly like fighters and thrown explosives. It stays locked until it has
  // left the doorway, and it waits outside if the exit is occupied.
  function propExitIsClear(prop, spot) {
    var footprint = { x: spot.x, y: spot.y, w: prop.w, h: prop.h };
    var lists = [crates, barrels];
    for (var li = 0; li < lists.length; li++) {
      for (var i = 0; i < lists[li].length; i++) {
        var other = lists[li][i];
        if (other === prop || other.dead || other.fragment) continue;
        if (rectsOverlap(footprint, other)) return false;
      }
    }
    var fighters = [player1, player2];
    for (var f = 0; f < fighters.length; f++) {
      if (fighters[f].hp > 0 && rectsOverlap(footprint, fighters[f].getBounds())) return false;
    }
    return true;
  }

  function propThroughDoor(prop) {
    if (!doorApi || prop.dead || prop.fragment || isAnchored(prop)) return;
    var result = doorApi.transit({ x: prop.x, y: prop.y, w: prop.w, h: prop.h, vx: prop.vx || 0, locked: !!prop.doorLocked }, doorPortals);
    prop.doorLocked = result.locked;
    if (!result.teleport) return;
    if (!propExitIsClear(prop, result.teleport)) { prop.doorLocked = false; return; } // exit occupied: wait at the entrance
    prop.x = result.teleport.x;
    prop.y = result.teleport.y;
    prop.prevX = prop.x;
    prop.prevY = prop.y;
    prop.resting = false;
  }

  // A tunnelled prop (deep inside a solid wall/floor) is pushed out along the
  // axis of least penetration, never further than it is buried.
  function pushOutOfSolids(body) {
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (plat.ladder || plat.glass || !plat.solidSides || platformIsOneWay(plat)) continue;
      var overlapX = Math.min(body.x + body.w, plat.x + plat.w) - Math.max(body.x, plat.x);
      var overlapY = Math.min(body.y + body.h, plat.y + plat.h) - Math.max(body.y, plat.y);
      if (overlapX <= body.w * PROP_DEEP_OVERLAP_SHARE || overlapY <= body.h * PROP_DEEP_OVERLAP_SHARE) continue;
      if (overlapY <= overlapX) {
        if (body.y + body.h / 2 < plat.y + plat.h / 2) { body.y -= overlapY; if (body.vy > 0) body.vy = 0; }
        else { body.y += overlapY; if (body.vy < 0) body.vy = 0; }
      } else if (body.x + body.w / 2 < plat.x + plat.w / 2) { body.x -= overlapX; body.vx = Math.min(0, body.vx); }
      else { body.x += overlapX; body.vx = Math.max(0, body.vx); }
    }
  }

  // A prop shoves a fighter it overlaps out of its side. The side is the one
  // the fighter was on BEFORE the prop moved this step (judged from the prop's
  // previous position), so a fast prop can never "pass" his centre and spit
  // him out on the far side. If a wall or the arena edge pins him, he is the
  // obstacle: the prop stops flush against him instead of sinking into him.
  function shovePlayerBesideProp(p, c) {
    var propCenterBefore = (c.prevX !== undefined ? c.prevX : c.x) + c.w / 2;
    var side = (p.x + p.w / 2 < propCenterBefore) ? -1 : 1;
    p.x = side < 0 ? c.x - p.w : c.x + c.w;
    p.x = Math.max(0, Math.min(GAME_WIDTH - p.w, p.x));
    p.clampToPlatformsX();
    var pinned = side < 0 ? p.x + p.w > c.x + PROP_CONTACT_SLOP : p.x < c.x + c.w - PROP_CONTACT_SLOP;
    if (!pinned || isAnchored(c)) return;
    c.x = side < 0 ? p.x + p.w : p.x - c.w;
    if (c.vx * side > 0) c.vx = 0; // it was driving into him (toward his side): the pinned body stops it
  }

  // Does this prop's blow carry the inertia to tip the fighter over his feet
  // (impact-dynamics.js fighterKnockoverImpact)? Only then the knockback
  // roll; a weaker blow only shoves him. Without the rules module the legacy
  // per-family speed floor stays in charge.
  var DEFAULT_KNOCKBACK_TRANSFER = 0.8;
  function propMassOf(prop) {
    if (barrels.indexOf(prop) !== -1) return BARREL_MASS;
    return prop.mass || CRATE_MASS;
  }
  function propKnocksFighterOver(c, p) {
    var toward = (p.x + p.w / 2 < c.x + c.w / 2) ? -1 : 1;
    return impactApi.fighterKnockoverImpact({
      propMass: propMassOf(c),
      propWidth: c.baseW || c.w,
      propHeight: c.baseH || c.h,
      propVx: c.vx,
      propSpin: c.spin || 0,
      propCenterY: c.y + c.h / 2,
      towardFighter: toward,
      fighterWidth: p.baseW * PLAYER_SIZE_SCALE, // his stance, not the narrower collision body: keeps the tipping model calibrated
      fighterHeight: p.h,
      fighterFeetY: p.y + p.h,
      gravity: PLAYER_GRAVITY
    }).topples;
  }

  // A prop that arrives fast enough (bounce, blast launch) hands its
  // kinetic energy to the fighter: shoved, thrown off his feet, into the roll.
  function heavyImpactKnockback(c, p) {
    var config = c.heavyConfig;
    if (p.knockbackRoll || p.rolling || p.matrixDodgeTimer > 0 || isAnchored(c)) return false;
    if (p.groundedCrate === c || p.groundedBarrel === c) return false; // riding it, not struck by it
    var speed = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
    if (impactApi && impactApi.fighterKnockoverImpact) {
      if (!propKnocksFighterOver(c, p)) return false;
    } else if (!config || !config.knockbackMinSpeed || speed < config.knockbackMinSpeed) {
      return false;
    }
    var transfer = config && config.knockbackTransfer !== undefined ? config.knockbackTransfer : DEFAULT_KNOCKBACK_TRANSFER;
    var dir = Math.abs(c.vx) > 0.2 ? (c.vx > 0 ? 1 : -1) : ((p.x + p.w / 2 < c.x + c.w / 2) ? -1 : 1);
    p.x = Math.max(0, Math.min(GAME_WIDTH - p.w, dir > 0 ? c.x + c.w : c.x - p.w));
    if (p.aiming) p.abortAiming(true, 'vanish');
    p.knockedDown = false;
    p.onGround = false;
    p.groundedCrate = null;
    p.groundedPlatform = null;
    if (speed >= HEAVY_LAUNCH_KNOCKBACK_SPEED) {
      // a prop that arrives flying (blast launch, long fall) throws him hard
      p.airVelocityX = dir * Math.max(speed * transfer, KNOCKBACK_ROLL_WALL_SPEED * 1.5);
      p.airVelocityY = -KNOCKBACK_ROLL_POP;
    } else {
      // a prop only nudged by a blow (punch, kick) knocks him off balance:
      // the same short, slow tumble as a prop leaning onto him
      p.airVelocityX = dir * Math.min(TOPPLE_ROLL_MAX_SPEED, Math.max(speed * TOPPLE_KNOCKBACK_TRANSFER, TOPPLE_ROLL_MIN_SPEED));
      p.airVelocityY = -KNOCKBACK_ROLL_POP * TOPPLE_ROLL_POP_SHARE;
    }
    p.startKnockbackRoll(dir);
    return true;
  }
  var HEAVY_LAUNCH_KNOCKBACK_SPEED = 5; // px/step: above it the prop is flying, not merely shoved

  // A prop that loses its balance (tipping over an edge, tumbling after a
  // hit or a rebound) and swings onto a fighter: its momentum, linear plus
  // the sweep of the rotation (impact-dynamics.js), decides whether he only
  // gets knocked down (straight drop, handled below) or loses his footing and
  // goes into the knockback roll. The prop pays for it: half its motion goes
  // into the fighter.
  // The fighter only loses his footing: a short, slow tumble, never a launch.
  var TOPPLE_KNOCKBACK_TRANSFER = 0.3;  // share of the prop's momentum handed to the fighter's speed
  var TOPPLE_ROLL_MIN_SPEED = 0.5;      // px/step: the roll still reads as a push away from the prop
  var TOPPLE_ROLL_MAX_SPEED = 1.1;      // px/step: he rolls a body length or two, not across the room
  var TOPPLE_ROLL_POP_SHARE = 0.4;      // share of the usual knockback hop: he barely leaves the floor
  var TOPPLE_REACTION_SHARE = 0.5;      // motion the prop keeps after bowling him over
  function topplingPropKnockback(c, p) {
    // a grounded prop that leans over still counts: the ground solver flags it
    // `resting` while it rotates, so only an actual lack of spin rules it out
    if (!impactApi || isAnchored(c) || p.groundedCrate === c || p.groundedBarrel === c) return false;
    if (Math.abs(c.spin) < impactApi.TOPPLE_MIN_SPIN) return false;
    if (p.knockbackRoll || p.rolling || p.knockedDown || p.matrixDodgeTimer > 0 || p.grabbedBy) return false;
    if (c.y + c.h / 2 >= p.y + p.h) return false; // it lies below his feet: nothing falls on him
    // only a blow with the inertia to tip him over his feet (the closing
    // speed of the prop's contact point, spin sweep included) rolls him
    if (!propKnocksFighterOver(c, p)) return false;
    var away = (p.x + p.w / 2 < c.x + c.w / 2) ? -1 : 1;
    var halfDiagonal = Math.sqrt(c.w * c.w + c.h * c.h) / 2;
    var momentum = propMassOf(c) * (Math.sqrt(c.vx * c.vx + c.vy * c.vy) + Math.abs(c.spin) * halfDiagonal);
    p.x = Math.max(0, Math.min(GAME_WIDTH - p.w, away > 0 ? c.x + c.w : c.x - p.w));
    p.clampToPlatformsX();
    if (p.aiming) p.abortAiming(true, 'vanish');
    p.onGround = false;
    p.groundedCrate = null;
    p.groundedPlatform = null;
    var thrown = momentum / impactApi.FIGHTER_MASS * TOPPLE_KNOCKBACK_TRANSFER;
    p.airVelocityX = away * Math.min(TOPPLE_ROLL_MAX_SPEED, Math.max(thrown, TOPPLE_ROLL_MIN_SPEED));
    p.airVelocityY = -KNOCKBACK_ROLL_POP * TOPPLE_ROLL_POP_SHARE;
    p.startKnockbackRoll(away);
    c.vx *= TOPPLE_REACTION_SHARE;
    c.spin *= TOPPLE_REACTION_SHARE;
    return true;
  }

  // A prop only crushes from ABOVE: the fighter must be below its middle and not be
  // riding it (standing on a deck that gets cut falls with it, he is not under it).
  function propIsAboveFighter(c, p) {
    return p.groundedCrate !== c && c.y + c.h / 2 < p.y + p.h / 2;
  }

  // Per-prop, per-fighter cooldown so one landing crushes once, not every step.
  var propStepClock = 0;
  var PROP_CRUSH_IMMUNITY_STEPS = 120; // a crushed fighter is ignored by that prop this long (2 s)
  var PROP_PIN_MAX_STEPS = 40; // longest a flattened fighter is held down waiting for the second landing
  function crushCooldownReady(c, p, config) {
    var last = c.lastCrushStep && c.lastCrushStep[p.id];
    return last === undefined || propStepClock - last > config.crushCooldownSteps;
  }

  // A prop that only clips a fighter: small damage that can never kill him, plus blood.
  function grazeFighter(c, p, config) {
    c.lastGrazeStep = c.lastGrazeStep || {};
    var last = c.lastGrazeStep[p.id];
    if (last !== undefined && propStepClock - last <= config.crushCooldownSteps) return;
    c.lastGrazeStep[p.id] = propStepClock;
    p.damage(Math.max(0, Math.min(config.glanceDamage, p.hp - 1)));
    p.hitFlash = 6;
    spawnBloodHit(p.x + p.w / 2, p.y + p.h * 0.3, p.x + p.w / 2 >= c.x + c.w / 2 ? 1 : -1);
  }

  function flattenFighter(p) {
    p.knockedDown = true;
    p.knockedDownFrame = 0;
    p.falling = false;
    p.jumping = false;
    p.rolling = false;
    p.knockbackRoll = false;
    p.knockbackRollFrame = 0;
    p.knockbackRollAngle = 0;
    p.blastRollPending = 0;
    p.diving = false;
    p.stunTimer = 0;
    p.airVelocityX = 0;
    p.airVelocityY = 0;
    if (p.aiming) p.abortAiming(true, 'vanish');
  }

  // Crushed under a heavy prop: damage plus the bazooka-blast throw (scaled).
  function crushFighterUnderProp(c, p, damage, blastShare) {
    c.lastCrushStep = c.lastCrushStep || {};
    c.lastCrushStep[p.id] = propStepClock;
    c.pinnedFighter = null;
    c.bouncing = false; // spent: one crush per bounce
    p.damage(damage);
    p.hitFlash = 6;
    if (p.hp <= 0 && !p.gibbed) {
      // died crushed: the body bursts like under an explosion, the gore stays close
      p.gibbed = true;
      spawnGoreFromFighter(p, 1, CRUSH_GORE_RANGE_SCALE);
      return;
    }
    var away = (p.x + p.w / 2 >= c.x + c.w / 2) ? 1 : -1;
    launchFighterLikeBlast(p, away, blastShare);
  }

  // Props touch the fighter's silhouette (head, torso, arms, legs, feet:
  // fighter-hitbox.js), not his whole bounding box. Without the module the box
  // stays the contact shape.
  function fighterTouchesRect(p, rect) {
    var bounds = p.getBounds();
    return hitboxApi ? hitboxApi.silhouetteOverlaps(bounds, p.lastDirX || 1, rect) : rectsOverlap(bounds, rect);
  }

  // ---------- Walking under a prop that only reaches his head ----------
  // impact-dynamics.js headContact: a graze is ignored, a deeper one is pressed
  // through (the prop is lifted just enough to clear him). Returns true when the
  // contact is a head contact (so no side block / shove applies).
  var HEAD_PRESS_MAX_PROP_VY = 1; // px/step: faster than this the prop is dropping onto his head
  function headPressesProp(p, prop, isBarrel) {
    if (!impactApi || !impactApi.headContact || isAnchored(prop) || prop.burning) return false;
    if (prop.y + prop.h / 2 >= p.y) return false;                  // its middle is not above his head: it is beside him
    if ((prop.vy || 0) > HEAD_PRESS_MAX_PROP_VY) return false;     // a falling prop lands on him, it is not perched over him
    var contact = impactApi.headContact(prop.y + prop.h - p.y);   // depth of his head inside the underside
    if (contact === 'none') return false;
    if (contact === 'press') {
      var lift = impactApi.headPressLiftSpeed(prop.y + prop.h - p.y, isBarrel ? BARREL_GRAVITY : CRATE_GRAVITY);
      if (prop.vy > lift) prop.vy = lift;
      prop.resting = false;
    }
    return true;
  }

  // ---------- Jumping into a prop's underside: the head bump ----------
  // The rising fighter's HEAD meets the prop. It is a real collision
  // (impact-dynamics.js headBumpOutcome): the prop is thrown up (lighter, more),
  // nudged a little away from the side the head hit and spun by the offset;
  // the fighter keeps the rise the collision leaves him. Anchored props (the
  // hanging deck) simply stop him.
  function headBumpTarget(p, previousY) {
    var head = hitboxApi ? hitboxApi.headRect(p.getBounds(), p.lastDirX || 1) : p.getBounds();
    var lists = [crates, barrels];
    for (var li = 0; li < lists.length; li++) {
      var list = lists[li];
      for (var i = 0; i < list.length; i++) {
        var prop = list[i];
        if (prop.dead || prop.fragment) continue;
        if (!(head.x < prop.x + prop.w && head.x + head.w > prop.x)) continue;
        var underside = prop.y + prop.h;
        if (previousY >= underside - 1e-7 && p.y <= underside + 1e-7) return { prop: prop, head: head, isBarrel: li === 1 };
      }
    }
    return null;
  }

  // Applies the collision to the prop and returns the fighter's remaining upward speed (px/step, >= 0 keeps rising, < 0 pushed down).
  function applyHeadBump(p, target, riseSpeed) {
    var prop = target.prop;
    if (!impactApi || !impactApi.headBumpOutcome) return 0; // legacy: a solid ceiling
    var outcome = impactApi.headBumpOutcome({
      fighterRiseSpeed: riseSpeed,
      propMass: target.isBarrel ? BARREL_MASS : (prop.mass || CRATE_MASS),
      propWidth: prop.baseW || prop.w,
      propCenterX: prop.x + prop.w / 2,
      headCenterX: target.head.x + target.head.w / 2,
      anchored: isAnchored(prop) || (target.isBarrel && prop.burning)
    });
    if (outcome.swingImpulse !== undefined && isAnchored(prop) && prop.anchor && heavyApi && heavyApi.pendulumImpulseSpin) {
      swingHangingPropByRider(prop, outcome.swingImpulse); // the headbutt rocks the hanging deck
    }
    if (outcome.propVy === 0) return outcome.fighterRise;
    prop.vx += outcome.propVx;
    prop.vy += outcome.propVy;
    prop.resting = false;
    clampPropSpeed(prop);
    if (rigidApi) {
      var width = prop.baseW || prop.w;
      var height = prop.baseH || prop.h;
      var leverX = target.head.x + target.head.w / 2 - (prop.x + prop.w / 2);
      var leverY = height / 2; // the push lands on the underside
      var spinChange = rigidApi.spinChangeFromImpulse(width, height, leverX, leverY, outcome.propVx, outcome.propVy, 1);
      if (target.isBarrel) {
        prop.spin = hitSpin(prop.spin, spinChange * BARREL_TORQUE_SCALE, BARREL_MAX_HIT_SPIN, BARREL_W, BARREL_H, BARREL_GRAVITY * PROP_TIP_GRAVITY_SHARE);
      } else {
        addHitSpin(prop, spinChange);
      }
    }
    return outcome.fighterRise;
  }

  function crateHitsPlayer(c, p) {
    if (c.dead || p.hp <= 0) return;
    if (!fighterTouchesRect(p, c)) return;
    if (headPressesProp(p, c, false)) return; // his head under its underside: he walks on, the prop rides up
    // a fighter this prop just crushed is flying clear: the prop must not grab,
    // knock down or re-crush him while the throw plays out
    if (c.lastCrushStep && c.lastCrushStep[p.id] !== undefined && propStepClock - c.lastCrushStep[p.id] <= PROP_CRUSH_IMMUNITY_STEPS) return;
    if (c.anchor && !isAnchored(c)) {
      // the deck is falling on him: lethal crush plus the bazooka-style throw. The freshly
      // cut deck always crushes; one that already landed does so only if it is pushed off
      // an edge and drops fast onto him
      var deck = HEAVY_CONFIG[HEAVY_KIND.HANGING];
      var deckFalling = !c.anchor.landed || c.vy >= deck.landedCrushMinFallSpeed;
      if (deckFalling && propIsAboveFighter(c, p) && crushCooldownReady(c, p, deck) && !(p.matrixDodgeTimer > 0)) {
        crushFighterUnderProp(c, p, deck.crushDamage, deck.crushBlastShare);
        return;
      }
    }
    var lyingBelow = !!(c.heavyConfig && c.bouncing && p.knockedDown && p.onGround);
    var crushFallSpeed = lyingBelow ? c.heavyConfig.crushMinFallSpeed : 2;
    if (c.heavyConfig && c.heavyConfig.flattenDamage !== undefined && c.vy > crushFallSpeed && propIsAboveFighter(c, p) && !(p.matrixDodgeTimer > 0) && !p.rolling) {
      var config = c.heavyConfig;
      var squarely = Math.abs((p.x + p.w / 2) - (c.x + c.w / 2)) < (c.w + p.w) * config.squareHitShare;
      if (squarely && crushCooldownReady(c, p, config)) {
        if (p.knockedDown && p.onGround) {
          // second landing on the lying fighter: crushed, thrown like a (slower) blast
          crushFighterUnderProp(c, p, config.crushDamage, config.crushBlastShare);
        } else {
          // first landing right on top: flattened to the floor; the prop pops back up to fall again
          p.damage(config.flattenDamage);
          p.hitFlash = 6;
          flattenFighter(p);
          c.y = p.y - c.h;
          c.vy = -config.reboundSpeed;
          c.bouncing = true;
          c.pinnedFighter = p; // he stays pinned down until the prop drops again (or it times out)
          c.pinSteps = PROP_PIN_MAX_STEPS;
        }
        return;
      }
      if (!squarely) grazeFighter(c, p, config); // only clipped him: a little health, a splash of blood
    }
    var fallCrush = c.heavyConfig;
    if (fallCrush && fallCrush.fallCrushMinSpeed !== undefined && c.vy > fallCrush.fallCrushMinSpeed &&
        propIsAboveFighter(c, p) && !(p.matrixDodgeTimer > 0) && !p.rolling && !isAnchored(c)) {
      // a dense body dropped on him: the damage is its momentum (mass x fall speed)
      crushFighterUnderProp(c, p, Math.min(100, c.mass * c.vy * fallCrush.fallCrushDamagePerMomentum), fallCrush.fallCrushBlastShare);
      return;
    }
    if (heavyImpactKnockback(c, p)) return;
    if (topplingPropKnockback(c, p)) return;
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
        p.knockbackRoll = false; // crushed before the tumble finished
        p.knockbackRollFrame = 0;
        p.knockbackRollAngle = 0;
        p.blastRollPending = 0; // the crush eats the pending blast roll too
        p.diving = false;
        p.stunTimer = 0;
        p.airVelocityX = c.vx;
        p.airVelocityY = 0;
        // the crush slides him clear at once (vertical fall, bounded by the arena edges)
        p.x = Math.max(0, Math.min(GAME_WIDTH - p.w, (p.x + p.w / 2 < c.x + c.w / 2) ? c.x - p.w : c.x + c.w));
      } else if (p.y + p.h / 2 <= c.y + c.h / 2) {
        // the fighter is on top of the crate
        if (p.falling) {
          // PlayerLands on the crate: impact damage + Knockdowned, lying on it.
          // Blast touchdown exception: the explosion roll window still wins —
          // the blast flight touching a crate top rolls off it, not lying.
          var cImp = Math.abs(p.airVelocityY) - 3;
          cImp *= 1.5;
          if (cImp < 3) cImp = 0;
          p.setHp(p.hp - cImp);
          p.falling = false;
          p.jumping = false;
          p.airVelocityX = 0;
          p.airVelocityY = 0;
          p.y = c.y - p.h;
          p.knockbackRoll = false; // a tumble flying into a crate ends lying
          p.knockbackRollFrame = 0;
          p.knockbackRollAngle = 0;
          if (p.blastRollPending > 0) {
            p.blastRollPending = 0;
            p.onGround = false;
            p.groundedCrate = null;
            p.groundedPlatform = null;
            p.airVelocityY = -KNOCKBACK_ROLL_POP;
            p.startKnockbackRoll();
          } else {
            p.knockedDown = true;
            p.knockedDownFrame = 0;
            p.onGround = true;
            p.groundedCrate = c;
            p.groundedPlatform = null;
          }
        } else {
          // carried: stay glued to the crate's top and ride its motion
          p.y = c.y - p.h;
          if (p.airVelocityY > 0) p.airVelocityY = 0;
          p.onGround = true;
          p.groundedCrate = c;
          p.groundedPlatform = null;
          rideSupport(p, c);
        }
      } else {
        // the crate is over his head and not falling: shove him aside
        shovePlayerBesideProp(p, c);
      }
    } else {
      // lateral contact: the crate shoves him aside (no knockdown)
      shovePlayerBesideProp(p, c);
    }
  }

  // Spawn settle: lift a crate until it clears everything, then drop it onto
  // the first support below, so the scene opens with every crate in place
  // (no visible falling on the first frames).
  function crateHitsPlatform(c) {
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (plat.ladder || plat.glass) continue; // clouds hold props like everything else
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

  function igniteCrate(c) {
    if (c.dead || c.onFire || !propIsFlammable(c)) return;
    c.onFire = true;
    c.burnProgress = 0;
  }

  // A burning crate loses hp every step (scaled by game speed) and sheds
  // damage-less flame puffs; at 0 hp it breaks like any other crate.
  function updateBurningCrates() {
    for (var i = 0; i < crates.length; i++) {
      var c = crates[i];
      if (c.dead || !c.onFire) continue;
      if (burnProp(c)) breakCrate(c);
    }
  }

  // One burn step shared by every flammable prop (crates and fragments): the
  // damage-over-time, the flame puffs and the heat pulse. True when burnt out.
  function burnProp(prop) {
    prop.burnProgress += gameSpeed;
    prop.hp -= (prop.hp0 / CRATE_BURN_DURATION_STEPS) * gameSpeed;
    if (Math.floor(prop.burnProgress) % CRATE_BURN_FLAME_INTERVAL === 0) {
      flames.push({
        x: prop.x + Math.random() * prop.w, y: prop.y + prop.h * Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 0.8, vy: -0.3 - Math.random() * 0.3,
        life: 14 + Math.random() * 8, damage: 0,
        owner: -1, hit: {}, size: 3 + Math.random() * 3
      });
    }
    if (fireApi && Math.floor(prop.burnProgress) % fireApi.FIRE_SPREAD_PULSE_STEPS === 0) spreadFireFrom(prop);
    return prop.hp <= 0;
  }

  // Heat pulse: nearby flammable props warm up and ignite once hot enough.
  function spreadFireFrom(source) {
    var sx = source.x + source.w / 2;
    var sy = source.y + source.h / 2;
    for (var i = 0; i < crates.length + propFragments.length; i++) {
      var target = i < crates.length ? crates[i] : propFragments[i - crates.length];
      if (target === source || target.dead || target.onFire || !propIsFlammable(target)) continue;
      var dx = target.x + target.w / 2 - sx;
      var dy = target.y + target.h / 2 - sy;
      var heat = fireApi.heatFromPulse(Math.sqrt(dx * dx + dy * dy), fireApi.FIRE_SPREAD_RADIUS);
      if (heat <= 0) continue;
      target.heat = (target.heat || 0) + heat;
      if (target.heat >= fireApi.IGNITION_HEAT) igniteCrate(target);
    }
  }

  // The small spin a blow leaves on a heavy prop bleeds off quickly while it
  // hops, so it lands barely leaning instead of keeping its lean all the way
  // through the air. A real tumble (blast, fall) is above the threshold and
  // keeps turning freely.
  var PROP_HIT_SPIN_AIR_DAMPING = 0.95; // per step: ~half of a hit's spin is gone after 14 steps
  var PROP_FREE_TUMBLE_SPIN = 0.1;      // rad/step: faster than a blow can spin it = a real tumble
  // A spin with the inertia to topple the body on landing is kept whole:
  // only a blow's small rocking spin bleeds off.
  function airSpinDamping(prop, width, height, gravity) {
    if (Math.abs(prop.spin) >= PROP_FREE_TUMBLE_SPIN) return undefined;
    if (rigidApi && rigidApi.hasTipMomentum && rigidApi.hasTipMomentum(prop, width, height, gravity)) return undefined;
    return PROP_HIT_SPIN_AIR_DAMPING;
  }

  // Gravity torque on a box whose centre of mass hangs past the edge it rests
  // on: it pivots on that edge, so the further it sticks out the faster it
  // tips (tau = m g d). Never weaker than the legacy constant nudge, so a box
  // barely past the edge still leaves instead of balancing on a corner.
  function overhangSpinStep(c, direction, supportLeft, supportRight) {
    var legacy = direction * rigidApi.OVERHANG_SPIN_PER_STEP;
    if (!impactApi) return legacy;
    var centerX = c.x + c.w / 2;
    var pastEdge = direction > 0 ? centerX - supportRight : centerX - supportLeft;
    var torque = impactApi.overhangSpinAcceleration(pastEdge, c.baseW || c.w, c.baseH || c.h, CRATE_GRAVITY);
    return Math.abs(torque) > Math.abs(legacy) ? torque : legacy;
  }

  // Side contact between two props: the overlap is shared by inverse mass and
  // bounded per pass (impact-dynamics.js), so a row of pushed crates
  // compresses and spreads over a few steps instead of swapping places or
  // jumping a whole body width. A hanging deck counts as immovable.
  function separationMass(prop) {
    return isAnchored(prop) ? Infinity : (prop.mass || 1);
  }
  function separatePropsSideways(a, b, overlapX) {
    var left = propWasLeftOf(a, b) ? a : b;
    var right = left === a ? b : a;
    var split = impactApi.pairSeparation(overlapX, separationMass(left), separationMass(right));
    left.x -= split.a;
    right.x += split.b;
    // still closing in: the contact eats the approach speed, so the pair
    // stops driving into each other on the next steps
    if (left.vx > right.vx) collidePropsSideways(left, right);
  }

  // Which side each body is on is judged from where they stood at the start
  // of the step (prevX), never from a position a fast move already crossed.
  function propWasLeftOf(a, b) {
    var aX = a.prevX !== undefined ? a.prevX : a.x;
    var bX = b.prevX !== undefined ? b.prevX : b.x;
    return aX + a.w / 2 <= bX + b.w / 2;
  }

  // A side ram: the mover overlaps `other` in height (more than a graze),
  // other lies AHEAD of it along its motion and it closes in faster.
  function propRamsFromSide(mover, other) {
    var overlapY = Math.min(mover.y + mover.h, other.y + other.h) - Math.max(mover.y, other.y);
    if (overlapY <= PROP_SIDE_CONTACT_MIN_OVERLAP_Y) return false;
    if (mover.vx === 0) return false;
    var otherAhead = mover.vx > 0 ? propWasLeftOf(mover, other) : propWasLeftOf(other, mover);
    if (!otherAhead) return false;
    return mover.vx > 0 ? mover.vx > other.vx + 0.01 : mover.vx < other.vx - 0.01;
  }

  // Momentum exchange of a side impact, by mass (impact-dynamics.js); the
  // legacy fixed 50/50 split without the rules module.
  function collidePropsSideways(mover, other) {
    if (!impactApi) { other.vx += mover.vx * 0.5; mover.vx *= 0.5; return; }
    var after = impactApi.sideCollisionVelocities(mover.vx, separationMass(mover), other.vx, separationMass(other), PROP_SIDE_RESTITUTION);
    mover.vx = after.a;
    if (!isAnchored(other)) other.vx = after.b;
  }

  // Start-of-step positions of every solid prop: contact sides and the
  // stack-versus-side decision read these, not the already-moved positions.
  function snapshotPropPositions() {
    for (var i = 0; i < crates.length + barrels.length; i++) {
      var prop = i < crates.length ? crates[i] : barrels[i - crates.length];
      prop.prevX = prop.x;
      prop.prevY = prop.y;
    }
  }

  // Two overlapping props: were they stacked (one above the other) or side by
  // side at the start of the step? Only an ambiguous (diagonal) arrival falls
  // back to the axis of least penetration.
  function propContactIsStack(a, b, overlapX, overlapY) {
    if (a.prevX !== undefined && b.prevX !== undefined) {
      var prevOverlapX = Math.min(a.prevX + a.w, b.prevX + b.w) - Math.max(a.prevX, b.prevX);
      var prevOverlapY = Math.min(a.prevY + a.h, b.prevY + b.h) - Math.max(a.prevY, b.prevY);
      if (prevOverlapX <= PROP_CONTACT_SLOP && prevOverlapY > PROP_SIDE_CONTACT_MIN_OVERLAP_Y) return false;
      if (prevOverlapY <= PROP_SIDE_CONTACT_MIN_OVERLAP_Y && prevOverlapX > PROP_CONTACT_SLOP) return true;
    }
    return overlapY <= overlapX;
  }

  function updateCrates() {
    propStepClock++;
    for (var pinIndex = 0; pinIndex < crates.length; pinIndex++) {
      var pinner = crates[pinIndex];
      if (!pinner.pinnedFighter) continue;
      if (pinner.dead || --pinner.pinSteps <= 0 || !pinner.bouncing) { pinner.pinnedFighter = null; continue; }
      if (pinner.pinnedFighter.knockedDown) pinner.pinnedFighter.knockedDownFrame = 0; // keep him lying
    }
    for (var ri = crateRespawns.length - 1; ri >= 0; ri--) {
      var rq = crateRespawns[ri];
      rq.timer--;
      if (rq.timer <= 0) {
        settleCrate(createCrate(rq.x, rq.y, rq.heavyKind));
        crateRespawns.splice(ri, 1);
      }
    }
    for (var i = crates.length - 1; i >= 0; i--) {
      var c = crates[i];
      if (c.dead) { crates.splice(i, 1); continue; }
      if (isAnchored(c)) { // hangs from its rope: a pendulum, not a falling body
        updateHangingSway(c);
        crateHitsPlayer(c, player1);
        crateHitsPlayer(c, player2);
        continue;
      }
      // The pit destroys the crate; it respawns at home after a delay
      if (c.y > 620 && c.anchor) { c.dead = true; crates.splice(i, 1); continue; } // a cut deck is gone for good
      if (c.y > 620) {
        breakCrate(c);
        crateRespawns.push({ x: c.sx, y: c.sy + c.h, heavyKind: c.heavyKind, timer: CRATE_RESPAWN_DELAY });
        crates.splice(i, 1);
        continue;
      }
      c.vy += CRATE_GRAVITY;
      clampPropSpeed(c);
      var speed = Math.max(Math.abs(c.vx), Math.abs(c.vy));
      var steps = propSubsteps(speed);
      var grounded = false;
      var supportLeft = Infinity;   // horizontal span the box actually rests on
      var supportRight = -Infinity;
      for (var st = 0; st < steps; st++) {
        var prevBottom = c.y + c.h;
        c.x += c.vx / steps;
        c.y += c.vy / steps;
        // a crate ramming the pane shatters it (dynamic contact, Result handler)
        for (var cgi = 0; cgi < glassPanes.length; cgi++) {
          var cgpane = glassPanes[cgi];
          if (!cgpane.broken && rectsOverlap(c, cgpane)) breakGlassPane(cgpane);
        }
        // platform landings + solid sides (clouds hold props, only players drop through)
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.ladder || plat.glass) continue;
          var overlapX = c.x < plat.x + plat.w && c.x + c.w > plat.x;
          if (!overlapX) continue;
          var top = platformBoundaryForSpan(plat, c.x, c.x + c.w, false);
          if (c.vy >= 0 && top !== null && prevBottom <= top + 1e-7 && c.y + c.h >= top - 1e-7) {
            c.y = top - c.h;
            if (c.vy > 1.2) {
              // first-touchdown impact: absorb speed and brake the slide
              c.vy = -c.vy * CRATE_BOUNCE;
              c.spin = c.spin * 0.5 + c.vx * CRATE_TUMBLE_PER_VX * 0.5; // glancing hit keeps it turning
              c.vx *= 0.8;
            } else c.vy = 0; // resting micro-cross: no extra horizontal brake
            if (Math.abs(c.vx) < 0.05) c.vx = 0;
            grounded = true;
            supportLeft = Math.min(supportLeft, Math.max(c.x, plat.x));
            supportRight = Math.max(supportRight, Math.min(c.x + c.w, plat.x + plat.w));
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

        // crate-on-prop: land on top when falling from above (crates AND
        // barrels are support bodies — a crate stacked on a barrel otherwise
        // sinks straight through it and the stack reads broken)
        for (var oi = 0; oi < crates.length + barrels.length; oi++) {
          var o = oi < crates.length ? crates[oi] : barrels[oi - crates.length];
          if (o === c || o.dead) continue;
          if (!(c.x < o.x + o.w && c.x + c.w > o.x)) continue;
          var oTop = o.y;
          var prevCBottom = prevBottom;
          if (c.vy >= 0 && prevCBottom <= oTop + 1e-7 && c.y + c.h >= oTop - 1e-7) {
            c.y = oTop - c.h;
            var landingSpeed = c.vy;
            if (landingSpeed > 1.2) c.vx *= 0.8; // impact brake only (weight feel)
            c.vy = 0;
            grounded = true;
            supportLeft = Math.min(supportLeft, Math.max(c.x, o.x));
            supportRight = Math.max(supportRight, Math.min(c.x + c.w, o.x + o.w));
            // falling onto a burning barrel is a stage-2 solid contact
            if (o.burning && landingSpeed > 2) detonateBarrel(o);
            o.vx += c.vx * 0.25; // weight transfer
          } else if (propRamsFromSide(c, o)) {
            // ramming another prop from the side: it stops flush against it
            // and the two share the momentum (a stack riding over is never a
            // side ram: its vertical overlap is a graze)
            c.x = c.vx > 0 ? o.x - c.w : o.x + o.w;
            collidePropsSideways(c, o);
          }
        }
      }
      if (c.anchor && grounded && !c.anchor.landed) {
        // the fallen deck stays on the floor as a heavy solid prop (no longer lethal)
        crateHitsPlayer(c, player1);
        crateHitsPlayer(c, player2);
        c.anchor.landed = true;
        playSfx(SFX.BULLET_HIT_METAL);
        spawnHangingLandingDebris(c);
      }
      // resting friction + settle rotation. A rigid box lands FLAT: whatever
      // tumble it carried eases onto the nearest quarter turn (a crate lying
      // on its side looks identical to upright), never back to a fixed 0.
      if (grounded) {
        c.bouncing = false; // a bounce ends on touchdown
        if (Math.abs(c.vx) > CRATE_SLIDE_SOUND_MIN_SPEED) playSfx(SFX.CRATE_PUSH);
        // Coulomb friction (original Box2D): deceleration = mu * g, independent of mass
        var groundBrake = CRATE_GRAVITY * (c.heavyConfig && c.heavyConfig.friction !== undefined ? c.heavyConfig.friction : CRATE_WOOD_FRICTION);
        c.vx = c.vx > 0 ? Math.max(0, c.vx - groundBrake) : Math.min(0, c.vx + groundBrake);
        if (Math.abs(c.vx) < 0.05) c.vx = 0;
        if (rigidApi) {
          // rigid rotation: damped spin + gravity tip-over (no forced snap)
          if (c.vy === 0) {
            c.resting = true;
            rigidApi.stepGroundRotation(c, c.baseW || c.w, c.baseH || c.h, CRATE_GRAVITY * PROP_TIP_GRAVITY_SHARE);
            // centre of mass past the edge it rests on: gravity torques it over
            // the void and it slides off, tumbling, instead of hovering
            var overhang = rigidApi.overhangDirection(c.x + c.w / 2, supportLeft, supportRight);
            if (overhang !== 0) {
              c.spin = rigidApi.clamp(c.spin + overhangSpinStep(c, overhang, supportLeft, supportRight), CRATE_TUMBLE_MAX_SPIN);
              c.vx += overhang * (groundBrake + CRATE_OVERHANG_SLIDE);
              c.resting = false;
            }
          }
        } else {
          c.spin *= 0.8;
          if (Math.abs(c.spin) < 0.01) c.spin = 0;
          if (c.vy === 0) {
            c.resting = true;
            c.angle += c.spin;
            var cSnap = Math.round(c.angle / CRATE_QUARTER_TURN) * CRATE_QUARTER_TURN;
            c.angle += (cSnap - c.angle) * 0.35;
            if (Math.abs(c.angle - cSnap) < 0.02) { c.angle = cSnap; c.spin = 0; }
          }
        }
        c.wasGrounded = true;
      } else {
        // sliding off a ledge tips the box over the edge: the horizontal
        // momentum becomes angular momentum (it tumbles as it falls)
        if (c.wasGrounded && Math.abs(c.vx) > 0.3 && c.spin === 0) {
          c.spin = (c.vx > 0 ? 1 : -1) * Math.min(CRATE_TUMBLE_MAX_SPIN, Math.abs(c.vx) * CRATE_TUMBLE_PER_VX);
        }
        c.wasGrounded = false;
        c.resting = false;
        if (c.vy !== 0) {
          if (rigidApi) rigidApi.stepAirRotation(c, airSpinDamping(c, c.baseW || c.w, c.baseH || c.h, CRATE_GRAVITY * PROP_TIP_GRAVITY_SHARE));
          else c.angle += c.spin;
        }
      }
      syncRotatedFootprint(c);
      propThroughDoor(c);
      pushOutOfSolids(c); // a prop that tunnelled into a wall is brought back out
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
          if (ovY <= 2) continue; // a graze is not a contact: the fall resolver owns it
          if (propContactIsStack(ca, cb, ovX, ovY)) {
            // deep vertical penetration = a real stack: bottom-up resolve
            var upper = (ca.y + ca.h / 2 <= cb.y + cb.h / 2) ? ca : cb;
            var lower = (upper === ca) ? cb : ca;
            if (isAnchored(upper)) continue; // a hanging deck is never pressed down
            upper.y = lower.y - upper.h;
            if (upper.vy > 0) upper.vy = 0;
            upper.resting = true;
          } else {
            // grazing side contact (a washer under 3 px) is never a stack:
            // push the bodies apart horizontally so slides read clean; a real
            // side ram still shares impulse, once, gated to arrive faster
            var moving = (Math.abs(ca.vx) >= Math.abs(cb.vx)) ? ca : cb;
            if (isAnchored(moving)) moving = (moving === ca) ? cb : ca; // the hanging deck holds its ground
            var other2 = (moving === ca) ? cb : ca;
            if (impactApi) {
              separatePropsSideways(ca, cb, ovX); // shares the overlap AND the impact by mass
              continue;
            }
            if (moving.x + moving.w / 2 < other2.x + other2.w / 2) moving.x = other2.x - moving.w;
            else moving.x = other2.x + other2.w;
            if (Math.abs(moving.vx) > Math.abs(other2.vx) + 0.3 &&
                Math.abs(other2.vx) < Math.abs(moving.vx) * 0.5) {
              other2.vx += moving.vx * 0.5;
              moving.vx *= 0.5;
            }
          }
        }
      }
    }
  }

  // ---------- Hanging prop (sprite 2) ----------
  // A solid deck that dangles from a rope. While anchored it is a kinematic
  // crate (fighters stand on it and are blocked by it exactly like any crate)
  // that swings as a damped pendulum: a fighter's weight tilts it, bullets and
  // blasts push it. Only a bullet crossing the rope or a blast reaching the
  // anchor cuts it loose (rules: heavy-props.js); the released body falls
  // under engine gravity, crushes whoever is below and shatters on impact.
  var HANGING_PROP_DEBRIS_COUNT = 5;
  var HANGING_PROP_MAX_SWING_SPEED = 0.15; // rad/step cap on an impulse (subtle swing)
  var HANGING_MAX_LEVER_SHARE = 1.6;       // the deck's bottom edge is ~1.5x the centre of mass depth
  var HANGING_RIDER_MASS = 0.7;            // fighter mass in crate units (fallback without impact-dynamics.js)
  // [centerX, bodyBottomY]: over the cloud ledge right of the ladder, high enough to walk under
  var hangingPropSpawns = heavyApi ? [[202, 321.75]] : [];

  function isAnchored(prop) {
    return !!prop.anchor && !prop.anchor.released;
  }

  function createHangingProp(centerX, bodyBottomY) {
    var config = HEAVY_CONFIG[HEAVY_KIND.HANGING];
    var prop = createCrate(centerX - config.width / 2, bodyBottomY, HEAVY_KIND.HANGING);
    prop.resting = true;
    prop.anchor = {
      released: false, angle: 0, omega: 0,
      pivotX: centerX, pivotY: prop.y - config.ropeLength,
      swingLength: config.ropeLength + prop.h / 2
    };
    return prop;
  }

  function rebuildHangingProps() {
    for (var i = crates.length - 1; i >= 0; i--) {
      if (crates[i].anchor) crates.splice(i, 1);
    }
    for (var s2 = 0; s2 < hangingPropSpawns.length; s2++) createHangingProp(hangingPropSpawns[s2][0], hangingPropSpawns[s2][1]);
  }
  function releaseHangingProp(prop) {
    if (prop.dead || !isAnchored(prop)) return;
    prop.anchor.released = true;
    prop.vy = 0;
    prop.vx = prop.anchor.omega * prop.anchor.swingLength; // keeps the swing speed as it drops
    prop.angle = -prop.anchor.angle; // canvas angle: clockwise positive, swing toward +x is anticlockwise
    playSfx(SFX.BULLET_HIT_METAL); // the rope snaps with a metallic clang
  }

  // Metal flakes on impact; the deck itself stays.
  function spawnHangingLandingDebris(prop) {
    for (var d = 0; d < HANGING_PROP_DEBRIS_COUNT; d++) {
      glassShards.push({
        x: prop.x + Math.random() * prop.w, y: prop.y + prop.h * 0.5,
        vx: Math.random() * 6 - 3, vy: -Math.random() * 3,
        angle: Math.random() * Math.PI, spin: Math.random() * 0.3 - 0.15,
        size: 4 + Math.random() * 4, life: 30, color: '#8a8f96'
      });
    }
  }

  // Physical pendulum (heavy-props.js pendulumStep): gravity swings the deck
  // back, fighters standing on it lean it with their weight, and the swing
  // carries the body along its arc (it rises a hair at the ends). When the
  // tilt is steep the deck slides a fighter off.
  function hangingRiders(prop) {
    var anchor = prop.anchor;
    var riders = [];
    var fighters = [player1, player2];
    for (var i = 0; i < fighters.length; i++) {
      var fighter = fighters[i];
      if (fighter.hp <= 0 || fighter.groundedCrate !== prop) continue;
      riders.push({
        mass: impactApi ? impactApi.FIGHTER_MASS : HANGING_RIDER_MASS,
        offsetX: fighter.x + fighter.w / 2 - anchor.pivotX,
        depth: prop.y - anchor.pivotY
      });
    }
    return riders;
  }

  function updateHangingSway(prop) {
    var config = HEAVY_CONFIG[HEAVY_KIND.HANGING];
    var anchor = prop.anchor;
    heavyApi.pendulumStep(anchor, {
      gravity: CRATE_GRAVITY,
      swingLength: anchor.swingLength,
      riders: hangingRiders(prop)
    }, config, gameSpeed);
    var previousCenterX = prop.x + prop.w / 2;
    var centerX = anchor.pivotX + anchor.swingLength * Math.sin(anchor.angle);
    var centerY = anchor.pivotY + anchor.swingLength * Math.cos(anchor.angle);
    prop.x = centerX - prop.w / 2;
    prop.y = centerY - prop.h / 2; // on the arc: the body rises slightly toward the ends of the swing
    prop.vx = centerX - previousCenterX; // standing fighters ride the swing
    prop.vy = 0;
    prop.angle = -anchor.angle; // the sprite is drawn with this angle: hitbox and art swing the same way
    if (Math.abs(anchor.angle) > config.unstableAngle) {
      var slide = (anchor.angle < 0 ? 1 : -1) * config.edgeSlidePush * gameSpeed;
      var fighters = [player1, player2];
      for (var j = 0; j < fighters.length; j++) {
        if (fighters[j].hp > 0 && fighters[j].groundedCrate === prop) fighters[j].x += slide;
      }
    }
  }

  // Impulse (bullet, blast, kick) swings the anchored deck instead of moving it.
  // Very heavy: punches and kicks only budge it a hair (meleeSwingShare); the
  // real swing comes from blasts (and, lightly, bullets). The height of the
  // hit is the lever: dw = J * depth / I, so a blow low on the deck swings it
  // more than one next to the rope (bulletSwingGain is the response at the
  // centre of mass).
  function swingHangingProp(prop, pushX, contact) {
    var config = HEAVY_CONFIG[HEAVY_KIND.HANGING];
    var anchor = prop.anchor;
    var kind = contact ? contact.kind : null;
    var share = kind === 'melee' ? config.meleeSwingShare : (kind === 'bullet' ? config.bulletSwingShare : 1);
    var depth = contact && contact.y !== undefined ? contact.y - anchor.pivotY : anchor.swingLength;
    var leverShare = Math.max(0, Math.min(HANGING_MAX_LEVER_SHARE, depth / anchor.swingLength));
    var gained = pushX * config.bulletSwingGain * share * leverShare;
    anchor.omega = Math.max(-HANGING_PROP_MAX_SWING_SPEED, Math.min(HANGING_PROP_MAX_SWING_SPEED, anchor.omega + gained));
  }

  // A fighter's footwork on the deck: his feet push the top face back as he
  // speeds up, brakes or pushes off (dw = J * depth / I). The deck is free to
  // swing (nothing holds its base), so the full impulse counts.
  function swingHangingPropByRider(prop, impulseX) {
    var anchor = prop.anchor;
    var config = HEAVY_CONFIG[HEAVY_KIND.HANGING];
    var gained = heavyApi.pendulumImpulseSpin(config, anchor.swingLength, impulseX, prop.y - anchor.pivotY);
    anchor.omega = Math.max(-HANGING_PROP_MAX_SWING_SPEED, Math.min(HANGING_PROP_MAX_SWING_SPEED, anchor.omega + gained));
  }

  // True when the shot cut the rope (the shot is spent). Body hits fall through
  // to the ordinary crate pass, which swings the deck and rings the metal.
  function cutHangingPropsByBullet(bullet) {
    for (var i = 0; i < crates.length; i++) {
      var prop = crates[i];
      if (prop.dead || !isAnchored(prop)) continue;
      if (heavyApi.segmentCrossesAnchor(prop, bullet.x - bullet.vx, bullet.y - bullet.vy, bullet.x, bullet.y)) {
        releaseHangingProp(prop);
        return true;
      }
    }
    return false;
  }

  function cutHangingPropsByBlast(x, y, reach) {
    for (var i = 0; i < crates.length; i++) {
      var prop = crates[i];
      if (!prop.dead && isAnchored(prop) && heavyApi.blastReachesAnchor(prop, x, y, reach)) releaseHangingProp(prop);
    }
  }

  // Drawn pivoting around the ceiling anchor so the rope and body swing together.
  function drawAnchoredProp(prop) {
    var config = prop.heavyConfig;
    ctx.save();
    ctx.translate(prop.anchor.pivotX, prop.anchor.pivotY);
    ctx.rotate(-prop.anchor.angle); // swing toward +x = anticlockwise: the art follows the hitbox
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, config.ropeLength);
    ctx.stroke();
    var img = spriteReady ? spriteImages[config.sprite] : null;
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, -prop.baseW / 2, config.ropeLength, prop.baseW, prop.baseH);
    } else {
      ctx.fillStyle = '#6a6f78';
      ctx.fillRect(-prop.baseW / 2, config.ropeLength, prop.baseW, prop.baseH);
    }
    ctx.restore();
  }

  // ---------- Wood fragments (table debris) ----------
  // Non-solid scraps: they never block a fighter, they only tumble to the
  // floor, burn (and spread the fire) and vanish after their lifetime.
  var propFragments = [];
  var FRAGMENT_PIT_Y = 620;
  var FRAGMENT_FRICTION = 0.85;
  var FRAGMENT_FADE_STEPS = 120; // blink out during the last 2 s
  // Contact zone: the art is only a few px wide, so a fighter walking over a
  // scrap would never feel it. The contact box is the sprite grown by a margin
  // (never below a minimum size); stepping into it scatters the scrap.
  var FRAGMENT_CONTACT_PADDING = 5;      // px added on every side
  var FRAGMENT_CONTACT_MIN_W = 14;
  var FRAGMENT_CONTACT_MIN_H = 9;
  var FRAGMENT_NUDGE_SPEED = 0.9;        // px/step sideways, plus a random share
  var FRAGMENT_NUDGE_HOP = 1.1;          // px/step upward kick-up
  var FRAGMENT_NUDGE_COOLDOWN = 10;      // steps before the same scrap reacts again
  var FRAGMENT_MELEE_SPEED_SHARE = 1.0;  // kicks/punches fling scraps at the full push
  var FRAGMENT_BLAST_SPEED = 6;          // px/step at the centre of a blast

  function createPropFragment(kind, centerX, centerY) {
    var config = HEAVY_CONFIG[kind];
    var fragment = {
      x: centerX - config.width / 2, y: centerY - config.height / 2,
      w: config.width, h: config.height,
      vx: 0, vy: 0, angle: Math.random() * Math.PI, spin: 0,
      heavyKind: kind, heavyConfig: config,
      hp: config.hitPoints, hp0: config.hitPoints,
      age: 0, lifetime: config.lifetimeSteps,
      onFire: false, burnProgress: 0, heat: 0, dead: false, grounded: false, nudgeCooldown: 0
    };
    propFragments.push(fragment);
    return fragment;
  }

  function fragmentContactBox(f) {
    var w = Math.max(f.w + FRAGMENT_CONTACT_PADDING * 2, FRAGMENT_CONTACT_MIN_W);
    var h = Math.max(f.h + FRAGMENT_CONTACT_PADDING * 2, FRAGMENT_CONTACT_MIN_H);
    return { x: f.x + f.w / 2 - w / 2, y: f.y + f.h / 2 - h / 2, w: w, h: h };
  }

  // Throws a scrap away from (originX) with a random hop and tumble.
  function flingFragment(f, direction, speed) {
    f.vx = direction * speed;
    f.vy = -(FRAGMENT_NUDGE_HOP * (0.6 + Math.random() * 0.8));
    f.spin = (Math.random() - 0.5) * 0.6;
    f.grounded = false;
    f.nudgeCooldown = FRAGMENT_NUDGE_COOLDOWN;
  }

  // A fighter walking, running or landing on scraps kicks them up and aside.
  function nudgeFragmentsByFighters() {
    var fighters = [player1, player2];
    var rustled = false;
    for (var i = 0; i < propFragments.length; i++) {
      var f = propFragments[i];
      if (f.nudgeCooldown > 0) { f.nudgeCooldown -= gameSpeed; continue; }
      var zone = fragmentContactBox(f);
      for (var j = 0; j < fighters.length; j++) {
        var fighter = fighters[j];
        if (fighter.hp <= 0 || !rectsOverlap(fighter.getBounds(), zone)) continue;
        var away = (f.x + f.w / 2 >= fighter.x + fighter.w / 2) ? 1 : -1;
        flingFragment(f, away, FRAGMENT_NUDGE_SPEED * (0.7 + Math.random() * 0.6));
        rustled = true;
        break;
      }
    }
    if (rustled) playSfx(SFX.CRATE_PUSH); // the scrape of wood under the boots
  }

  // Kicks and punches fling the scraps in reach; blasts throw them radially.
  function hitFragmentsInReach(attacker, reach, pushX) {
    var dir = attacker.lastDirX;
    var hitBox = { x: dir > 0 ? attacker.x + attacker.w : attacker.x - reach, y: attacker.y, w: reach, h: attacker.h };
    for (var i = 0; i < propFragments.length; i++) {
      var f = propFragments[i];
      if (rectsOverlap(hitBox, fragmentContactBox(f))) flingFragment(f, dir, Math.abs(pushX || 1) * FRAGMENT_MELEE_SPEED_SHARE * (0.7 + Math.random() * 0.6));
    }
  }

  function blastFragments(x, y, radius) {
    for (var i = 0; i < propFragments.length; i++) {
      var f = propFragments[i];
      var dx = f.x + f.w / 2 - x;
      var dy = f.y + f.h / 2 - y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius) continue;
      var falloff = 1 - distance / radius;
      var norm = distance || 1;
      f.vx = (dx / norm) * FRAGMENT_BLAST_SPEED * falloff;
      f.vy = (dy / norm) * FRAGMENT_BLAST_SPEED * falloff - FRAGMENT_NUDGE_HOP;
      f.spin = (Math.random() - 0.5) * 0.8;
      f.grounded = false;
    }
  }

  function updatePropFragments() {
    nudgeFragmentsByFighters();
    for (var i = propFragments.length - 1; i >= 0; i--) {
      var f = propFragments[i];
      if (f.dead) { propFragments.splice(i, 1); continue; }
      f.age += gameSpeed;
      if (f.age >= f.lifetime || f.y > FRAGMENT_PIT_Y) { propFragments.splice(i, 1); continue; }
      if (f.onFire && burnProp(f)) { propFragments.splice(i, 1); continue; }
      f.grounded = false;
      f.vy += CRATE_GRAVITY * gameSpeed;
      clampPropSpeed(f);
      // anti-tunnelling: a blast-flung scrap moves in micro-steps no longer
      // than the thinnest platform it could cross
      var fragmentSteps = propSubsteps(Math.max(Math.abs(f.vx), Math.abs(f.vy)) * gameSpeed);
      var supportLeft = Infinity;
      var supportRight = -Infinity;
      for (var fs = 0; fs < fragmentSteps && !f.grounded; fs++) {
        var previousBottom = f.y + f.h;
        f.x += f.vx * gameSpeed / fragmentSteps;
        f.y += f.vy * gameSpeed / fragmentSteps;
        if (f.x < 0) { f.x = 0; f.vx = Math.abs(f.vx) * 0.4; }
        else if (f.x + f.w > GAME_WIDTH) { f.x = GAME_WIDTH - f.w; f.vx = -Math.abs(f.vx) * 0.4; }
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.ladder || plat.glass) continue;
          if (!(f.x < plat.x + plat.w && f.x + f.w > plat.x)) continue;
          var top = platformBoundaryForSpan(plat, f.x, f.x + f.w, false);
          if (f.vy >= 0 && top !== null && previousBottom <= top + 1e-7 && f.y + f.h >= top - 1e-7) {
            f.y = top - f.h;
            f.vy = 0;
            f.grounded = true;
            supportLeft = Math.min(supportLeft, Math.max(f.x, plat.x));
            supportRight = Math.max(supportRight, Math.min(f.x + f.w, plat.x + plat.w));
          }
        }
      }
      var fragmentOverhang = f.grounded && rigidApi ? rigidApi.overhangDirection(f.x + f.w / 2, supportLeft, supportRight) : 0;
      if (fragmentOverhang !== 0) {
        // hanging over the void: gravity tips it over the edge and it slides off
        f.vx += fragmentOverhang * CRATE_OVERHANG_SLIDE;
        f.spin = rigidApi.clamp(f.spin + overhangSpinStep(f, fragmentOverhang, supportLeft, supportRight), CRATE_TUMBLE_MAX_SPIN);
        f.angle += f.spin * gameSpeed;
      } else if (f.grounded) {
        f.vx *= FRAGMENT_FRICTION;
        if (Math.abs(f.vx) < 0.05) f.vx = 0;
        f.spin = 0;
      } else {
        f.angle += f.spin * gameSpeed;
      }
    }
  }

  function drawPropFragments() {
    for (var i = 0; i < propFragments.length; i++) {
      var f = propFragments[i];
      var remaining = f.lifetime - f.age;
      if (remaining < FRAGMENT_FADE_STEPS && Math.floor(f.age / 4) % 2 === 0) continue; // blink before vanishing
      ctx.save();
      ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
      ctx.rotate(f.angle);
      var img = spriteReady ? spriteImages[f.heavyConfig.sprite] : null;
      if (img && img.complete && img.naturalWidth) {
        ctx.drawImage(img, -f.w / 2, -f.h / 2, f.w, f.h);
      } else {
        ctx.fillStyle = '#a8743a';
        ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
      }
      if (f.onFire) {
        ctx.fillStyle = 'rgba(255,140,30,0.45)';
        ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
      }
      ctx.restore();
    }
  }

  // Spawns the prop's own fragments at its exact centre with a small random
  // scatter; a burning prop passes its fire on to the wooden pieces.
  function spawnPropFragments(c) {
    var kinds = c.heavyConfig.debrisKinds;
    var scatter = c.heavyConfig.debrisScatterSpeed || 2;
    var cx = c.x + c.w / 2;
    var cy = c.y + c.h / 2;
    for (var i = 0; i < kinds.length; i++) {
      var fragment = createPropFragment(kinds[i], cx, cy);
      fragment.vx = c.vx + (Math.random() - 0.5) * 2 * scatter;
      fragment.vy = c.vy - Math.random() * scatter;
      fragment.spin = (Math.random() - 0.5) * 0.4;
      if (c.onFire) igniteCrate(fragment);
    }
  }

  // The hitbox follows the sprite: a prop's AABB is the axis-aligned extent of
  // its rotated rectangle (wooden crates included), anchored at the bottom so
  // it never sinks into (or floats off) the surface it rests on. A box that
  // tilts on its corner therefore rises smoothly instead of sinking its
  // corners into the floor and jumping up when it settles.
  function syncRotatedFootprint(c) {
    if (!heavyApi || c.baseW === undefined) return;
    var extent = heavyApi.rotatedExtent(c.baseW, c.baseH, c.angle);
    if (Math.abs(extent.w - c.w) < 0.01 && Math.abs(extent.h - c.h) < 0.01) return;
    var centerX = c.x + c.w / 2;
    var bottom = c.y + c.h;
    c.w = extent.w;
    c.h = extent.h;
    c.x = centerX - c.w / 2;
    c.y = bottom - c.h;
  }

  function breakCrate(c) {
    if (c.dead) return;
    c.dead = true;
    playSfx(SFX.CRATE_BREAK);
    if (c.heavyConfig && c.heavyConfig.debrisKinds) { spawnPropFragments(c); return; }
    // 3 wood fragments (extracted onDestruction spawns crate_debris_01..03)
    // carrying the shipped fragment art (6/9/141): flung from the crate's
    // middle with a random impulse, spin and size, fading like all debris
    var crateDebrisSprites = [6, 9, 141];
    var debris = [[-3, -5], [4, -1], [-1, 5]];
    for (var d = 0; d < debris.length; d++) {
      glassShards.push({
        x: c.x + c.w / 2 + debris[d][0], y: c.y + c.h / 2 + debris[d][1],
        vx: c.vx + Math.random() * 6 - 3,      // random impulse sideways
        vy: c.vy - Math.random() * 3,          // and a kick upward
        angle: Math.random() * Math.PI, spin: Math.random() * 0.3 - 0.15,
        size: 6 + Math.random() * 4, life: 30, color: '#c89050',
        sprite: crateDebrisSprites[d],         // shipped wood fragment art
        scale: 1.2 + Math.random() * 0.5       // fragment-size variance
      });
    }
  }

  // Impulse model (original Box2D ApplyImpulse): `contact` (optional) gives the
  // application point {x, y}. A push through the centre only slides the prop;
  // `pushAtContact` applies the push at the contact point (bullets, blasts),
  // and `liftY` is the second, off-centre impulse of a melee hit (original
  // Kick(): (0,-0.4) at the fighter's foot) — that one is the torque.
  var CRATE_TORQUE_SCALE = 0.1;     // share of the computed torque a plain crate responds to
  // Weight of the plain wooden crate under a blow (heavier than the original's
  // light box: a kick slides it, it never vaults it).
  var CRATE_MASS = 1;                  // vs the fighter's 0.7: bullets and side impacts feel it
  var CRATE_KICK_SPEED_RATIO = 0.68;     // horizontal launch share; the hop adds airtime, so the same slide needs a gentler push
  var CRATE_MELEE_VERTICAL_RATIO = 0.9;  // share of a blow's upward push the plain crate keeps (a small hop)
  var CRATE_LIFT_RATIO = 0.85;           // share of the boot's off-centre lift (the torque survives, the hop does not)
  var GENERIC_POP_TORQUE_SHARE = 0.5;    // share of the default upward pop that levers a prop (the rest just lifts it)
  var DEFAULT_MELEE_PUSH_Y = -2.5;       // upward push of a blow whose caller gives none
  // A shot carries far less impulse than a kick, so a plain crate answers its
  // torque in full: a pistol round high on the box rocks it ~8 deg, a burst can topple it.
  var CRATE_BULLET_TORQUE_SCALE = 1;
  var DEFAULT_BULLET_IMPULSE = 0.6; // Box2D impulse of a shot whose gun declares none (pistol)
  var CRATE_MAX_HIT_SPIN = 0.025;   // rad/step: slowest of tilts (about 3 deg per step at most)
  function propMeleeVerticalRatio(c) {
    var config = c.heavyConfig;
    return config && config.meleeVerticalRatio !== undefined ? config.meleeVerticalRatio : CRATE_MELEE_VERTICAL_RATIO;
  }

  function applyHitImpulse(c, pushX, pushY, contact) {
    var config = c.heavyConfig;
    // Melee and blasts are mass-weighted in the original (impulse = power * mass):
    // the launch SPEED does not drop with mass, only the prop's own kick ratio
    // applies. Bullets (and anything unlabelled) are plain impulses: dv = J / m.
    if (contact && rigidApi) {
      // no two hits alike: wobble force, direction, contact point and lever
      var varied = rigidApi.varyHit({ pushX: pushX, pushY: pushY, x: contact.x, y: contact.y, torqueBoost: contact.torqueBoost }, contact.kind, Math.random, config ? config.hitVariationScale : undefined);
      pushX = varied.pushX;
      pushY = varied.pushY;
      contact = {
        kind: contact.kind, x: varied.x, y: varied.y, liftY: contact.liftY,
        pushAtContact: contact.pushAtContact, torqueBoost: varied.torqueBoost,
        genericPop: contact.genericPop
      };
    }
    var weighted = !!(contact && (contact.kind === 'melee' || contact.kind === 'blast'));
    var melee = !!(contact && contact.kind === 'melee');
    var speedRatio = melee && !config ? CRATE_KICK_SPEED_RATIO : 1;
    if (config && weighted) {
      // mass-weighted: heavy props keep only a share of the launch speed (kick, blast)
      var ratioKey = melee ? 'kickSpeedRatio' : 'blastSpeedRatio';
      if (config[ratioKey] !== undefined) speedRatio = config[ratioKey];
    }
    var dvx = weighted ? pushX * speedRatio : (config ? heavyApi.impulseForMass(pushX, c.mass) : pushX / (c.mass || 1));
    var dvy = weighted ? pushY * speedRatio : (config ? heavyApi.impulseForMass(pushY, c.mass) : pushY / (c.mass || 1));
    // a blow's upward push has its own weight ratio, independent of how far
    // the body slides: heavy props hop only a little, light ones more
    if (melee) dvy = pushY * propMeleeVerticalRatio(c);
    // per-family response to blows and blasts (heavy-props.js): hop, slide, spin
    var response = weighted ? propImpactMultipliers(c) : NEUTRAL_RESPONSE;
    dvx *= response.horizontal;
    dvy *= response.vertical;
    if (impactApi && rigidApi && contact && contact.kind === 'bullet' && contact.pushAtContact) {
      applyBulletContactResponse(c, dvx, dvy, contact);
      return;
    }
    c.vx += dvx;
    c.vy += dvy;
    clampPropSpeed(c);
    if (!contact || !rigidApi) return;
    var width = c.baseW || c.w;
    var height = c.baseH || c.h;
    var leverX = contact.x - (c.x + c.w / 2);
    var leverY = contact.y - (c.y + c.h / 2);
    var spinChange = 0;
    if (contact.pushAtContact) {
      // a generic upward pop mostly lifts through the centre of mass: only a share of it torques
      spinChange += rigidApi.spinChangeFromImpulse(width, height, leverX, leverY, dvx, dvy * (contact.genericPop ? GENERIC_POP_TORQUE_SHARE : 1), contact.torqueBoost);
    }
    if (contact.liftY) {
      // the boot's lift is split: its HOP is scaled by the body's weight, its
      // TORQUE (levering one edge) keeps the original strength
      var liftDv = contact.liftY * (config && config.liftRatio !== undefined ? config.liftRatio : CRATE_LIFT_RATIO) * response.vertical;
      var liftTorqueDv = contact.liftY * (config && config.liftTorqueRatio !== undefined ? config.liftTorqueRatio : 1);
      c.vy += liftDv;
      spinChange += rigidApi.spinChangeFromImpulse(width, height, leverX, leverY, 0, liftTorqueDv, contact.torqueBoost);
    }
    addHitSpin(c, spinChange, undefined, response.torque);
  }

  // Crates are bulky: a hit tilts them slowly, as if the fighter struggled to
  // lift one edge off the floor (low torque response and a low spin ceiling).
  // `plainTorqueScale` overrides the plain crate's response (bullets use their own).
  function addHitSpin(c, spinChange, plainTorqueScale, torqueMultiplier) {
    var config = c.heavyConfig;
    var plainScale = plainTorqueScale !== undefined ? plainTorqueScale : CRATE_TORQUE_SCALE;
    var torqueScale = config && config.torqueScale !== undefined ? config.torqueScale : (c.heavyKind ? 1 : plainScale);
    var spinCeiling = config && config.maxHitSpin !== undefined ? config.maxHitSpin : (c.heavyKind ? rigidApi.MAX_SPIN : CRATE_MAX_HIT_SPIN);
    var multiplier = torqueMultiplier === undefined ? 1 : torqueMultiplier;
    c.spin = hitSpin(c.spin, spinChange * torqueScale * multiplier, spinCeiling * multiplier,
      c.baseW || c.w, c.baseH || c.h, CRATE_GRAVITY * PROP_TIP_GRAVITY_SHARE);
  }

  // A blow's spin: the usual cap keeps ordinary hits a rock, but a strong blow
  // keeps part of the surplus, enough inertia to topple the body before it
  // ever reaches its tipping angle (rigid-impact.js inertialHitSpin).
  // The ceiling of that surplus is the body's own tipping energy: a blow can
  // give it just enough inertia to roll over its edge from flat (with a
  // margin), never a whirl.
  var TIP_INERTIA_MARGIN = 1.25;
  function hitSpin(currentSpin, spinChange, softCap, width, height, gravity) {
    if (!rigidApi.inertialHitSpin || width === undefined) return rigidApi.clamp(currentSpin + spinChange, softCap);
    var tipSpin = rigidApi.criticalTipSpin(0, width, height, gravity) * TIP_INERTIA_MARGIN;
    return rigidApi.inertialHitSpin(currentSpin, spinChange, softCap, Math.max(softCap, tipSpin));
  }

  var NEUTRAL_RESPONSE = { vertical: 1, torque: 1, horizontal: 1 };
  function propImpactMultipliers(c) {
    return heavyApi ? heavyApi.impactMultipliersFor(c.heavyConfig) : NEUTRAL_RESPONSE;
  }

  // A shot's torque depends on the HEIGHT it lands at (impact-dynamics.js):
  // on the floor, the upper half tips the prop forward over its leading corner
  // and slides it less; the lower half sweeps the base (more slide) and rocks
  // the top back toward the shooter. Airborne props take the free-body r x J.
  function applyBulletContactResponse(c, dvx, dvy, contact) {
    var response = impactApi.bulletResponse({
      width: c.baseW || c.w,
      height: c.baseH || c.h,
      centerX: c.x + c.w / 2,
      centerY: c.y + c.h / 2,
      contactX: contact.x,
      contactY: contact.y,
      dvx: dvx,
      grounded: !!(c.wasGrounded || c.resting)
    });
    c.vx += response.dvx;
    c.vy += dvy;
    clampPropSpeed(c);
    addHitSpin(c, response.spin * (contact.torqueBoost || 1), CRATE_BULLET_TORQUE_SCALE);
  }

  function damageCrate(c, amount, pushX, pushY, contact) {
    if (c.dead) return;
    var config = c.heavyConfig;
    if (isAnchored(c)) { swingHangingProp(c, pushX, contact); return; } // hits swing it; only the rope matters
    if (config) {
      c.hp -= amount * config.damageTakenMultiplier; // armour scales the damage
    } else {
      c.hp -= amount;
    }
    if (propIgnoresBulletPush(c, contact)) {
      if (c.hp <= 0) breakCrate(c); // the shot still damages it; it just never budges
      return;
    }
    if (rigidApi) {
      applyHitImpulse(c, pushX, pushY, contact);
    } else {
      c.vx += config ? heavyApi.impulseForMass(pushX, c.mass) : pushX;
      c.vy += config ? heavyApi.impulseForMass(pushY, c.mass) : pushY;
      c.spin += (pushX >= 0 ? 1 : -1) * 0.25 / (c.mass || 1);
    }
    if (config) launchBounceIfStruck(c, amount, pushX);
    c.resting = false;
    if (c.hp <= 0) breakCrate(c);
  }

  // Props flagged bulletImmovable (metal crate) take no push, hop or spin from shots.
  function propIgnoresBulletPush(c, contact) {
    return !!(c.heavyConfig && c.heavyConfig.bulletImmovable && contact && contact.kind === 'bullet');
  }

  // A strong hit on a resting bouncer can pop it off the floor.
  function launchBounceIfStruck(c, impact, pushX) {
    if (c.bouncing || !c.wasGrounded) return;
    if (!heavyApi.shouldBounce(c.heavyConfig, impact, Math.random)) return;
    var config = c.heavyConfig;
    var side = pushX === 0 ? (Math.random() < 0.5 ? -1 : 1) : (pushX > 0 ? 1 : -1);
    c.vy = -config.bounceLaunchSpeed;
    c.vx += pushX * config.bounceDriftShare;           // the hop carries the hit's direction
    c.spin = side * config.bounceSpin;                 // a lazy tumble; it eases flat on landing
    c.bouncing = true;
    c.wasGrounded = false;
  }

  // Where a melee hit meets the prop (original Kick(): the fighter's foot at
  // (x + 4*dir, y - 4)). Punches carry a lighter lift; an airborne kick is
  // "charged" and levers the prop harder.
  var MELEE_LIFT_IMPULSE = (-0.4 * 30 / 24) * TIME_SCALE; // original (0,-0.4) off-centre impulse
  var MELEE_FOOT_OFFSET_X = 4;
  var MELEE_FOOT_OFFSET_Y = 4;
  var AERIAL_KICK_TORQUE_BOOST = 1.8;
  var PUNCH_FIST_HEIGHT_SHARE = 0.45; // fist height as a share of the fighter's height from his head
  function meleeContact(attacker, kind) {
    if (kind === 'punch') {
      // a punch lands at fist height and pushes there: it tips the prop over
      // (top shoved forward) instead of levering it from below like a boot
      return {
        kind: 'melee',
        x: attacker.x + attacker.w / 2 + attacker.lastDirX * MELEE_FOOT_OFFSET_X,
        y: attacker.y + attacker.h * PUNCH_FIST_HEIGHT_SHARE,
        liftY: 0,
        pushAtContact: true,
        torqueBoost: 1
      };
    }
    return {
      kind: 'melee',
      x: attacker.x + attacker.w / 2 + attacker.lastDirX * MELEE_FOOT_OFFSET_X,
      y: attacker.y + attacker.h - MELEE_FOOT_OFFSET_Y,
      liftY: MELEE_LIFT_IMPULSE,
      torqueBoost: kind === 'aerialKick' ? AERIAL_KICK_TORQUE_BOOST : 1
    };
  }

  // ---------- A blow on a prop with a fighter right behind it ----------
  // The other fighter standing against the far face of the struck prop (in
  // cover behind it, or just in front of it from the blow's side) takes the
  // push through the prop: he rolls. The prop gives part of its motion back
  // (impact-dynamics.js blockedBlowReboundSpeed) and can come back at the
  // attacker, who rolls too only if the rebound carries the inertia to tip him.
  var BLOCKED_BLOW_CONTACT_GAP_PX = 4;      // px between the prop's far face and the fighter that still counts as "right behind it"
  var BLOCKED_BLOW_MIN_OVERLAP_Y = 4;       // px of shared height: a fighter below or above it is not covered by it
  var BLOCKED_BLOW_MIN_SPEED = 0.2;         // px/step the blow must give the prop for anything to travel through it
  function blockedBlowVictim(prop, attacker, dir) {
    if (!impactApi || !impactApi.blockedBlowReboundSpeed || isAnchored(prop) || prop.dead || prop.burning) return null;
    var fighters = [player1, player2];
    for (var i = 0; i < fighters.length; i++) {
      var p = fighters[i];
      if (p === attacker || p.hp <= 0) continue;
      if (p.knockbackRoll || p.rolling || p.knockedDown || p.matrixDodgeTimer > 0 || p.grabbedBy) continue;
      if (p.groundedCrate === prop || p.groundedBarrel === prop) continue; // standing on it, not behind it
      var gap = dir > 0 ? p.x - (prop.x + prop.w) : prop.x - (p.x + p.w);
      if (gap > BLOCKED_BLOW_CONTACT_GAP_PX || gap < -prop.w * PROP_DEEP_OVERLAP_SHARE) continue;
      var sharedHeight = Math.min(p.y + p.h, prop.y + prop.h) - Math.max(p.y, prop.y);
      if (sharedHeight < BLOCKED_BLOW_MIN_OVERLAP_Y) continue;
      return p;
    }
    return null;
  }

  // Called right after the blow's impulse was applied to `prop`.
  function reactToBlockedBlow(prop, victim, dir) {
    if (!victim) return;
    var speed = (prop.vx || 0) * dir; // speed the blow gave it, toward the victim
    if (speed < BLOCKED_BLOW_MIN_SPEED) return;
    if (victim.aiming) victim.abortAiming(true, 'vanish');
    victim.onGround = false;
    victim.groundedCrate = null;
    victim.groundedBarrel = null;
    victim.groundedPlatform = null;
    victim.airVelocityX = dir * Math.min(TOPPLE_ROLL_MAX_SPEED, Math.max(speed * TOPPLE_KNOCKBACK_TRANSFER, TOPPLE_ROLL_MIN_SPEED));
    victim.airVelocityY = -KNOCKBACK_ROLL_POP * TOPPLE_ROLL_POP_SHARE;
    victim.startKnockbackRoll(dir);
    prop.vx = -dir * impactApi.blockedBlowReboundSpeed(speed); // it comes back toward whoever swung
    prop.resting = false;
  }

  function hitCratesInReach(attacker, reach, damage, pushX, pushY, hitKind) {
    var dir = attacker.lastDirX;
    var hitBox = {
      x: dir > 0 ? attacker.x + attacker.w : attacker.x - reach,
      y: attacker.y,
      w: reach, h: attacker.h
    };
    var heaviestHit = null;
    for (var i = 0; i < crates.length; i++) {
      var c = crates[i];
      if (c.dead) continue;
      if (!rectsOverlap(hitBox, c)) continue;
      var blow = meleeContact(attacker, hitKind || 'punch');
      blow.genericPop = !pushY; // the default upward pop lifts the prop; it is not an off-centre push
      var coveredFighter = blockedBlowVictim(c, attacker, dir);
      damageCrate(c, damage, dir * (pushX || 3), pushY || DEFAULT_MELEE_PUSH_Y, blow);
      reactToBlockedBlow(c, coveredFighter, dir);
      if (!heaviestHit || (c.mass || 1) > (heaviestHit.mass || 1)) heaviestHit = c;
    }
    if (heaviestHit) applyMeleeRecoil(attacker, heaviestHit, pushX || 3);
    hitFragmentsInReach(attacker, reach, pushX);
  }

  // Newton's third law on a blow: a heavy body barely gives, so part of the
  // swing comes back and the attacker rebounds a step (impact-dynamics.js).
  // Light props absorb the blow. The rebound is a velocity bled by
  // updateMeleeRecoil, so it reads as a shove, never as a teleport.
  function applyMeleeRecoil(attacker, prop, swingSpeed) {
    if (!impactApi || attacker.groundedCrate === prop) return; // a stomp from on top has nothing to push off
    var recoil = impactApi.meleeRecoilSpeed(prop.mass || 1, swingSpeed);
    if (recoil <= 0) return;
    var away = (attacker.x + attacker.w / 2 < prop.x + prop.w / 2) ? -1 : 1;
    attacker.meleeRecoilVelocityX = away * recoil;
  }

  function updateMeleeRecoil(p) {
    if (!p.meleeRecoilVelocityX) return;
    if (!impactApi || p.hp <= 0 || !p.onGround || p.knockedDown || p.knockbackRoll || p.rolling || p.grabbedBy) {
      p.meleeRecoilVelocityX = 0; // any other motion state owns the body
      return;
    }
    p.x += p.meleeRecoilVelocityX;
    p.clampToPlatformsX();
    p.meleeRecoilVelocityX = impactApi.decayRecoil(p.meleeRecoilVelocityX);
  }

  // ---------- Riding a moving prop: friction-limited carry ----------
  // The fighter rides a prop only as far as his feet grip it
  // (impact-dynamics.js frictionCarrySpeed): a slow slide or swing carries
  // him along, a kicked prop shoots out from under him while his inertia
  // keeps him nearly where he was. Applied once per step, whichever pass
  // (fighter support or crate contact) gets to him first.
  var simulationStep = 0;
  var LEGACY_RIDE_SHARE = 0.6; // without impact-dynamics.js: the old fixed share of the prop speed

  function rideSupport(p, prop) {
    if (p.carryStep === simulationStep) return;
    var continuing = p.carrySupport === prop && p.carryStep === simulationStep - 1;
    p.carryStep = simulationStep;
    p.carrySupport = prop;
    if (!impactApi || !impactApi.frictionCarrySpeed) { p.x += prop.vx * LEGACY_RIDE_SHARE; return; }
    var carry = continuing ? (p.supportCarryVx || 0) : 0; // he lands with his own (ground) speed
    p.supportCarryVx = impactApi.frictionCarrySpeed(carry, prop.vx || 0, CRATE_GRAVITY);
    p.x += p.supportCarryVx;
    // Newton's third law: the grip that speeds him up drags the prop back
    // (momentum is shared by mass). A hanging deck's speed is its swing's.
    if (!isAnchored(prop) && prop.vx) {
      var propMass = barrels.indexOf(prop) !== -1 ? BARREL_MASS : (prop.mass || CRATE_MASS);
      prop.vx -= (p.supportCarryVx - carry) * impactApi.FIGHTER_MASS / propMass;
    }
  }

  // A fighter whose feet were on (or just above) a barrel's top at the start
  // of the step, now overlapped because the barrel moved up into him.
  var RIDER_LIFT_CATCH_PX = 1.5;   // px of feet height above the top that still counts as standing on it
  var RIDER_LIFT_MAX_SINK_PX = 6;  // px: deeper than this he is beside the barrel, not on it
  function barrelLiftsRider(b, p) {
    if (b.burning || b.prevY === undefined || !(b.y < b.prevY)) return false;
    var feetY = p.y + p.h;
    return feetY <= b.prevY + RIDER_LIFT_CATCH_PX && feetY - b.y <= RIDER_LIFT_MAX_SINK_PX;
  }

  // ---------- Rider inertia: a fighter on a prop rocks it a little ----------
  // His feet push the top face back whenever he speeds up, brakes or turns,
  // each stride's push-off and planted weight nudge it again, and a landing
  // presses down at his offset from the centre (impact-dynamics.js). The
  // prop's ground tipping turns that into a small rock gravity brings back.
  function riderSupportProp(p) {
    if (!p.onGround || p.hp <= 0) return null;
    var crate = p.groundedCrate;
    if (crate && !crate.dead && crates.indexOf(crate) !== -1) {
      return { prop: crate, hanging: isAnchored(crate), mass: crate.mass || CRATE_MASS, width: crate.baseW || crate.w, height: crate.baseH || crate.h };
    }
    var barrel = p.groundedBarrel;
    if (barrel && !barrel.dead && !barrel.burning && barrels.indexOf(barrel) !== -1) {
      return { prop: barrel, mass: BARREL_MASS, width: BARREL_W, height: BARREL_H };
    }
    return null;
  }

  function forgetRiderSupport(p) {
    p.riderSupport = null;
    p.riderFallVy = p.onGround ? 0 : Math.max(0, p.airVelocityY || 0);
  }

  function updateRiderInertia(p) {
    if (!impactApi || !impactApi.riderSurfaceSpin) return;
    var support = riderSupportProp(p);
    if (!support) { forgetRiderSupport(p); return; }
    var prop = support.prop;
    var landed = p.riderSupport !== prop;
    var speedX = 0;
    var accelX = 0;
    var footfall = false;
    if (landed) {
      p.riderStride = 0;
    } else {
      // motion relative to the face: the ride-along carry is not footwork
      speedX = (p.x - p.riderPrevX) - (prop.x - p.riderPrevPropX);
      if (Math.abs(speedX) > RIDER_TELEPORT_PX) speedX = 0;
      accelX = speedX - p.riderPrevSpeedX;
      p.riderStride += Math.abs(speedX);
      footfall = impactApi.strideCompleted(p.riderStride);
      if (footfall) p.riderStride = 0;
    }
    var landingVy = landed ? p.riderFallVy : 0;
    var footwork = {
      width: support.width,
      height: support.height,
      propMass: support.mass,
      offsetX: (p.x + p.w / 2) - (prop.x + prop.w / 2),
      accelX: accelX,
      speedX: speedX,
      footfall: footfall,
      landingVy: landingVy
    };
    // a hanging deck swings on its rope; its weight torque is in the pendulum step
    var spinChange = support.hanging ? 0 : impactApi.riderSurfaceSpin(footwork);
    if (support.hanging) swingHangingPropByRider(prop, impactApi.riderSurfaceImpulse(footwork).x);
    if (spinChange !== 0) {
      var cap = landingVy > 0 ? impactApi.RIDER_LANDING_MAX_SPIN : impactApi.RIDER_MAX_SPIN;
      prop.spin = impactApi.addRiderSpin(prop.spin || 0, spinChange, cap);
      prop.resting = false;
    }
    p.riderSupport = prop;
    p.riderPrevX = p.x;
    p.riderPrevPropX = prop.x;
    p.riderPrevSpeedX = speedX;
    p.riderFallVy = 0;
  }

  // ---------- Explosive barrels (CRATE-identical rigidbody props) ----------
  // Same Box2D-style contacts as the crates (they push fighters, stack on top
  // of solid bodies, bounce off walls) plus the two-stage destruction cycle:
  // bullet/blast/flame contact stages 1 (launch + BurningState, art 127 -> 161)
  // and the next solid contact while burning detonates the stage 2 barrel.
  var barrels = [];
  CoverSystem.registerSource(barrels);
  function createBarrel(x, yBottom) {
    var b = {
      x: x, y: yBottom - BARREL_H, w: BARREL_W, h: BARREL_H,
      sx: x, sy: yBottom - BARREL_H, // home spot (spawn anchor, no respawn queue)
      vx: 0, vy: 0, angle: 0, spin: 0,
      mass: BARREL_MASS,      // shared contact rules: separation, recoil, toppling impact
      baseW: BARREL_W, baseH: BARREL_H, // upright art size (OBB hit test, edge torque)
      burning: false,         // stage 1: 161.svg art + fire contact damage
      burnFuse: 0,            // smoulter count for a dormant burning barrel
      resting: true
    };
    barrels.push(b);
    return b;
  }
  var barrelSpawns = [
    [470, 249], [560, 339], [650, 339], [690, 227], [760, 261]
  ];
  for (var _bs = 0; _bs < barrelSpawns.length; _bs++) createBarrel(barrelSpawns[_bs][0], barrelSpawns[_bs][1]);

  function rebuildBarrels() {
    barrels.length = 0;
    for (var i = 0; i < barrelSpawns.length; i++) createBarrel(barrelSpawns[i][0], barrelSpawns[i][1]);
    // bottom-first settle so a restarted round opens with every prop in place
    var _bso = barrels.slice().sort(function (a, b) { return b.y - a.y; });
    for (var _bsi = 0; _bsi < _bso.length; _bsi++) settleBarrel(_bso[_bsi]);
  }

  function barrelHitsPlatform(b) {
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (plat.ladder || plat.glass) continue; // clouds hold props like everything else
      if (rectsOverlap(b, plat)) return plat;
    }
    return null;
  }

  // Spawn settle: mirror settleCrate (lift, then drop onto the first support;
  // stack on crate/other-barrel tops instead of clipping)
  function settleBarrel(b) {
    var guard = 0;
    while (guard++ < 800) {
      var plat = barrelHitsPlatform(b);
      if (!plat) break;
      b.y -= 2;
    }
    var step = 1;
    guard = 0;
    while (guard++ < 400) {
      b.y += step;
      if (barrelHitsPlatform(b)) {
        b.y -= step;
        if (step > 0.05) { step /= 2; continue; }
        break;
      }
      var stacked = null;
      // solid props stack below: crates first, then other barrels
      var stacks = crates.concat(barrels);
      for (var j = 0; j < stacks.length; j++) {
        var o = stacks[j];
        if (o === b || o.dead) continue;
        if (b.x < o.x + o.w && b.x + b.w > o.x &&
            b.y + b.h > o.y && b.y + b.h <= o.y + o.h &&
            b.y + b.h - step <= o.y + 0.05) { // was falling from above its top
          stacked = o;
          break;
        }
      }
      if (stacked) { b.y = stacked.y - b.h; break; }
    }
    b.vy = 0;
    b.resting = true;
  }

  // Stage 1: directed launch + BurningState. The bullet's trajectory gives
  // the MAIN impulse, but a random scatter (mirroring the original's
  // Math.random()*12-6 on the wreck velocity) keeps the launch from being
  // a pure clone of the shot line: the shot nudges, it does not define.
  var barrelWaveSource = null;
  function igniteBarrel(b, launchVx, launchVy, spinKick) {
    if (b.dead || b.burning) return false;
    b.burning = true;
    b.burnFuse = BARREL_SMOULTER_FUSE;
    b.resting = false;
    b.vx += launchVx || 0;
    b.vy += launchVy || 0;
    b.spin += (spinKick || 0) * BARREL_SPIN_KICK;
    // First shockwave: the very first hit pops an immediate blast ring from
    // the barrel (it keeps flying; the second wave comes on touchdown).
    if (!b.firstWave) {
      b.firstWave = true;
      barrelFirstWave(b);
    }
    return true;
  }

  function barrelFirstWave(b) {
    var prev = barrelWaveSource;
    barrelWaveSource = b; // explodeAt must not detonate the barrel that emits it
    try {
      explodeAt(b.x + b.w / 2, b.y + b.h / 2, BARREL_BLAST_RADIUS, BARREL_BLAST_DAMAGE_MAX, BARREL_BLAST_DAMAGE_MIN, BARREL_FIRST_WAVE_OPTIONS);
    } finally { barrelWaveSource = prev; }
  }

  // Stage 2: remove the main entity, spawn the flaming micro-fragments
  // (153/164) on a 0..360 deg launch and hand the bang to explodeAt — the
  // ring, the ground fire spread and the crate pushes ride along free.
  function detonateBarrel(b) {
    if (b.dead) return;
    b.dead = true;
    spawnBarrelDebris(b);
    explodeBarrelBoom(b.x + b.w / 2, b.y + b.h / 2);
  }

  // Measured melee/kick impulse hit like the crate pass, but a burning barrel goes up
  // on ANY fighter contact (stage-2 rule). No hp drain either way (damage is
  // only consumed for the crate API parity): physical blows only shove; the
  // destruction always travels through the fire.
  // direct shove of one barrel (stomp from above: the barrel is under the
  // fighter's feet, not inside the side reach box)
  // Melee shove on a barrel, same impulse model as the crates: the push is
  // divided by the barrel's mass and the off-centre foot lift only spins it
  // when it clears the torque dead-band (no more "any shove tips it").
  function applyBarrelHit(b, dir, pushX, pushY, attacker, hitKind) {
    var genericPop = !pushY; // see hitCratesInReach: the default pop lifts, it does not torque
    var contact = rigidApi && attacker ? meleeContact(attacker, hitKind || 'punch') : null;
    var hit = { pushX: dir * (pushX || 3), pushY: pushY || DEFAULT_MELEE_PUSH_Y, torqueBoost: contact ? contact.torqueBoost : 1, x: contact ? contact.x : 0, y: contact ? contact.y : 0 };
    if (contact) hit = rigidApi.varyHit(hit, 'melee', Math.random, BARREL_HIT_VARIATION_SCALE); // no two shoves alike, within the drum's narrow band
    var dvx = hit.pushX * BARREL_KICK_SPEED_RATIO * BARREL_RESPONSE.horizontal; // weighted kick: speed, not impulse
    var dvy = hit.pushY * BARREL_MELEE_VERTICAL_RATIO * BARREL_RESPONSE.vertical; // same small hop as the cement drum
    b.vx += dvx;
    b.vy += dvy;
    if (contact) {
      var liftDv = contact.liftY * BARREL_LIFT_RATIO * BARREL_RESPONSE.vertical;
      b.vy += liftDv;
      var leverX = hit.x - (b.x + b.w / 2);
      var leverY = hit.y - (b.y + b.h / 2);
      // the lift's torque keeps its strength; only the hop is weight-scaled
      var spinChange = rigidApi.spinChangeFromImpulse(BARREL_W, BARREL_H, leverX, leverY, 0, contact.liftY * BARREL_LIFT_TORQUE_RATIO, hit.torqueBoost);
      if (contact.pushAtContact) spinChange += rigidApi.spinChangeFromImpulse(BARREL_W, BARREL_H, leverX, leverY, dvx, dvy * (genericPop ? GENERIC_POP_TORQUE_SHARE : 1), hit.torqueBoost);
      b.spin = hitSpin(b.spin, spinChange * BARREL_TORQUE_SCALE * BARREL_RESPONSE.torque, BARREL_MAX_HIT_SPIN * BARREL_RESPONSE.torque,
        BARREL_W, BARREL_H, BARREL_GRAVITY * PROP_TIP_GRAVITY_SHARE);
    }
    b.resting = false;
  }

  function shoveBarrel(b, dir, pushX, pushY, attacker, hitKind) {
    if (b.burning) { detonateBarrel(b); return; }
    applyBarrelHit(b, dir, pushX, pushY, attacker, hitKind);
  }

  function hitBarrelsInReach(attacker, reach, damage, pushX, pushY, hitKind) {
    void damage;
    var dir = attacker.lastDirX;
    var hitBox = {
      x: dir > 0 ? attacker.x + attacker.w : attacker.x - reach,
      y: attacker.y,
      w: reach, h: attacker.h
    };
    for (var i = barrels.length - 1; i >= 0; i--) {
      var b = barrels[i];
      if (b.dead) continue;
      if (!rectsOverlap(hitBox, b)) continue;
      if (b.burning) { detonateBarrel(b); continue; }
      var coveredByBarrel = blockedBlowVictim(b, attacker, dir);
      applyBarrelHit(b, dir, pushX, pushY, attacker, hitKind || 'punch');
      reactToBlockedBlow(b, coveredByBarrel, dir);
      applyMeleeRecoil(attacker, b, pushX || 3);
    }
  }

  function spawnBarrelDebris(b) {
    var count = BARREL_DEBRIS_MIN + ((Math.random() * (BARREL_DEBRIS_MAX - BARREL_DEBRIS_MIN + 1)) | 0);
    var cx = b.x + b.w / 2;
    var cy = b.y + b.h / 2;
    for (var i = 0; i < count; i++) {
      // fully random launch: every fragment takes its OWN angle (0..360) and
      // its own vertical kick, so the shower reads scattered in BOTH axes
      // instead of a fixed upward fan
      var ang = Math.random() * Math.PI * 2;
      var speed = BARREL_DEBRIS_BURST * (0.35 + Math.random() * 1.3);
      var vyKick = (Math.random() - 0.5) * 8; // random vertical: up, flat or down
      var life = BARREL_DEBRIS_LIFE_MIN + Math.random() * (BARREL_DEBRIS_LIFE_MAX - BARREL_DEBRIS_LIFE_MIN);
      // inherit the barrel's launch momentum (original: wreck velocity +
      // Math.random()*2-1) so the shower carries the barrel's flight
      var inheritX = (b.vx || 0) * 0.35;
      var inheritY = (b.vy || 0) * 0.35;
      barrelDebris.push({
        x: cx + (Math.random() - 0.5) * b.w * 1.4,
        y: cy + (Math.random() - 0.5) * b.h * 1.4,
        vx: Math.cos(ang) * speed + (Math.random() - 0.5) * 2 + inheritX,
        vy: Math.sin(ang) * speed + vyKick + inheritY,
        sprite: BARREL_FIRE_DEBRIS_SPRITES[Math.random() < 0.55 ? 0 : 1],
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 1.0,
        scale: 0.7 + Math.random() * 0.9,
        h: 8, // patch footprint (fire touchbox) around the sprite centre
        life: life, maxLife: life, // 3-5 s of burning on the floor
        landed: false,
        hit: {} // one burn bite per fighter (the igniteFire machine takes over)
      });
    }
    if (barrelDebris.length > BARREL_DEBRIS_CAP) {
      barrelDebris.splice(0, barrelDebris.length - BARREL_DEBRIS_CAP);
    }
  }

  function updateBarrelDebris() {
    var fighters = [player1, player2];
    for (var i = barrelDebris.length - 1; i >= 0; i--) {
      var d = barrelDebris[i];
      // the patch fuse only burns while it lies on the ground (spec: fallen
      // fragments stay lit for the lifetime timer, 3-5 s)
      if (d.landed) {
        d.life -= ammoMoveScale(); // patches hang with the scene in slow cams
        if (d.life <= 0) { barrelDebris.splice(i, 1); continue; }
      } else {
        d.vy += PLAYER_GRAVITY;
        var subSpeed = Math.max(Math.abs(d.vx), Math.abs(d.vy));
        var subs = Math.max(1, Math.ceil(subSpeed / 4));
        for (var s = 0; s < subs && !d.landed; s++) {
          var prevBottom = d.y + d.h / 2;
          d.x += d.vx / subs;
          d.y += d.vy / subs;
          d.angle += d.spin / subs;
          for (var pi = 0; pi < platforms.length; pi++) {
            var plat = platforms[pi];
            if (plat.ladder || plat.glass) continue; // clouds hold, mirrors embers
            var surfaceY = platformBoundaryForSpan(plat, d.x - EMBER_LAND_PROBE, d.x + EMBER_LAND_PROBE, false);
            if (surfaceY !== null && prevBottom <= surfaceY + 1e-7 && d.y + d.h / 2 >= surfaceY - 1e-7) {
              d.y = surfaceY - d.h / 2; // settle ON the surface
              d.vy = 0;
              d.vx *= 0.5;
              if (Math.abs(d.vx) < 0.08) d.vx = 0;
              d.landed = true;
              d.spin *= 0.5;
              break;
            }
          }
          if (d.x < 2 || d.x > GAME_WIDTH - 2) {
            d.vx = -d.vx * 0.3;
            d.x = Math.max(2, Math.min(GAME_WIDTH - 2, d.x));
          }
        }
      }
      if (d.y > 640) { barrelDebris.splice(i, 1); continue; } // the pit wins
      if (!d.landed) continue;

      // grounded patch: the fragment bites once per fighter (BurnDamage) and
      // the fire machine keeps the per-second burn running from igniteFire
      var touch = 10 * d.scale;
      var touchRect = { x: d.x - touch / 2, y: d.y - touch / 2, w: touch, h: touch };
      for (var t = 0; t < fighters.length; t++) {
        var p = fighters[t];
        if (p.hp <= 0 || d.hit[p.id]) continue;
        if (p.matrixDodgeTimer > 0) continue; // Matrix dodge: fragments arc past
        if (isUltraInstinct(p)) continue; // Ultra Instinct: barrel debris passes through
        if (!rectsOverlap(p.getBounds(), touchRect)) continue;
        d.hit[p.id] = true;
        p.damage(EMBER_CONTACT_DAMAGE); // the same patch bite the pool uses
        p.fireFlash = Math.max(p.fireFlash, 4);
        if (p.aiming) p.abortAiming(true, "keep");
        p.igniteFire(); // burn L1 escalates over time from here
      }
    }
  }

  // The hitbox follows the cylinder's pose: width/height blend between the
  // upright 14x19 and the lying 19x14 with |sin(angle)|, keeping the center
  // column fixed and the feet on the floor while grounded (or the center in
  // the air), so the box always matches what is drawn.
  function reshapeBarrel(b, grounded) {
    var nw, nh;
    if (heavyApi) {
      // the exact bounds of the rotated drum (as the cement barrel): a tilted
      // barrel's corners never poke out of its hitbox
      var extent = heavyApi.rotatedExtent(BARREL_W, BARREL_H, b.angle);
      nw = extent.w;
      nh = extent.h;
    } else {
      var sn = Math.abs(Math.sin(b.angle));
      nw = BARREL_W + (BARREL_H - BARREL_W) * sn;
      nh = BARREL_H - (BARREL_H - BARREL_W) * sn;
    }
    b.x += (b.w - nw) / 2;
    b.y += grounded ? (b.h - nh) : (b.h - nh) / 2;
    b.w = nw;
    b.h = nh;
  }

  // Floor friction of the drum: Coulomb grip while it stands (as the cement
  // barrel), low rolling resistance once it lies on its side. Legacy
  // per-step damping without the heavy-props rules.
  function applyBarrelFloorFriction(b) {
    if (BARREL_SLIDE_FRICTION === null) {
      b.vx *= BARREL_FRICTION;
    } else {
      var lying = Math.abs(Math.sin(b.angle)) > BARREL_LYING_SIN;
      var brake = BARREL_GRAVITY * (lying ? BARREL_ROLL_FRICTION : BARREL_SLIDE_FRICTION);
      b.vx = b.vx > 0 ? Math.max(0, b.vx - brake) : Math.min(0, b.vx + brake);
    }
    if (Math.abs(b.vx) < 0.05) b.vx = 0;
  }

  // LEGACY fallback (only without the rigid-impact rules module): constant
  // gravity toward the nearest stable pose (upright / on its side) and the barrel bounces slightly on
  // arrival, so it topples and settles instead of easing or snapping.
  function stepBarrelTip(b) {
    var turn = Math.round(b.angle / Math.PI) * Math.PI;
    var target = Math.abs(b.angle - turn) < BARREL_TIP_BARRIER
      ? turn
      : Math.round((b.angle - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
    var d = b.angle - target;
    if (Math.abs(d) < 0.01 && Math.abs(b.spin) < 0.012) {
      b.angle = target;
      b.spin = 0;
      return true; // settled
    }
    b.spin -= (d > 0 ? 1 : -1) * BARREL_TIP_GRAVITY;
    if (b.spin > BARREL_TIP_MAX_SPIN) b.spin = BARREL_TIP_MAX_SPIN;
    else if (b.spin < -BARREL_TIP_MAX_SPIN) b.spin = -BARREL_TIP_MAX_SPIN;
    b.angle += b.spin;
    var nd = b.angle - target;
    if ((d > 0) !== (nd > 0) && d !== 0) { // crossed the pose: land and bounce
      b.angle = target;
      b.spin = -b.spin * BARREL_TIP_BOUNCE;
      if (Math.abs(b.spin) < 0.015) b.spin = 0;
    }
    return false;
  }

  // Centre of mass past the edge the barrel stands on: gravity torques it
  // over the void (same edge-pivot rule as the crates) and it slides off.
  // True while it overhangs.
  function tipBarrelOverEdge(b, supportLeft, supportRight) {
    if (!rigidApi) return false;
    var overhang = rigidApi.overhangDirection(b.x + b.w / 2, supportLeft, supportRight);
    if (overhang === 0) return false;
    b.spin = rigidApi.clamp(b.spin + overhangSpinStep(b, overhang, supportLeft, supportRight), BARREL_TIP_MAX_SPIN);
    b.vx += overhang * CRATE_OVERHANG_SLIDE;
    return true;
  }

  // Complete barrel physics step: crate-identical mover + the burning rules.
  // While burning with real speed, ANY solid contact (ground touchdown, wall
  // side, crate, other barrel, fighter) detonates — stage 2.
  // A rolling drum can end up a hair below the top of the next surface (adjacent
  // stair treads and floors differ by under a pixel, and the rotating body
  // grows its box). Within this slop it still LANDS on it; without it the drum
  // read as already inside the floor, was pushed sideways and fell out of the map.
  var BARREL_LANDING_SLOP_PX = 1.5;
  function updateBarrels() {
    for (var i = barrels.length - 1; i >= 0; i--) {
      var b = barrels[i];
      if (b.dead) { barrels.splice(i, 1); continue; }
      // The pit (OutsideTheWorld) swallows barrels whole: nothing detonates
      // under the world, the blast would clip the arena beach above it
      if (b.y > 620) { barrels.splice(i, 1); continue; }
      // an outside shove (punch, kick, ram, bullet) is a velocity change since
      // last step: on the ground it becomes a tipping torque
      if (!rigidApi && b.lastVx !== undefined && b.wasGrounded) {
        var shove = b.vx - b.lastVx;
        if (Math.abs(shove) > 1e-3) {
          var cs = Math.cos(b.angle), sn2 = Math.sin(b.angle);
          // upright takes the full torque; a barrel lying on its side only
          // rolls over (and can stand back up) under a hard shove
          b.spin += shove * BARREL_TIP_IMPULSE * (cs * cs + 1.0 * sn2 * sn2);
        }
      }
      b.vy += BARREL_GRAVITY;
      clampPropSpeed(b);
      var speed = Math.max(Math.abs(b.vx), Math.abs(b.vy));
      var steps = propSubsteps(speed);
      var grounded = false;
      var boom = false;
      var supportLeft = Infinity;   // horizontal span the barrel actually rests on
      var supportRight = -Infinity;
      for (var st = 0; st < steps && !boom; st++) {
        var prevBottom = b.y + b.h;
        b.x += b.vx / steps;
        b.y += b.vy / steps;
        // thrown/burning barrels pierce the panes like the crates do; glass
        // is not a detonation surface (Result handler, no crash)
        for (var cgi = 0; cgi < glassPanes.length; cgi++) {
          var cgpane = glassPanes[cgi];
          if (!cgpane.broken && rectsOverlap(b, cgpane)) breakGlassPane(cgpane);
        }
        // platform landings + solid side push-out (surface contact checks)
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.ladder || plat.glass) continue;
          var overlapX = b.x < plat.x + plat.w && b.x + b.w > plat.x;
          if (!overlapX) continue;
          var top = platformBoundaryForSpan(plat, b.x, b.x + b.w, false);
          if (b.vy >= 0 && top !== null && prevBottom <= top + BARREL_LANDING_SLOP_PX && b.y + b.h >= top - 1e-7) {
            if (b.burning && b.vy > BARREL_DET_SPEED) { boom = true; break; } // touchdown crash
            b.y = top - b.h;
            if (b.vy > 1.2) {
              // first-touchdown impact: absorb speed and brake the slide
              b.vy = -b.vy * BARREL_BOUNCE;
              b.spin *= 0.5;
              b.vx *= 0.8;
            } else b.vy = 0; // resting micro-cross: no extra horizontal brake
            if (Math.abs(b.vx) < 0.05) b.vx = 0;
            grounded = true;
            supportLeft = Math.min(supportLeft, Math.max(b.x, plat.x));
            supportRight = Math.max(supportRight, Math.min(b.x + b.w, plat.x + plat.w));
            continue;
          }
          if (!plat.solidSides) continue;
          var prevInsideX = prevBottom - b.h < plat.x + plat.w && prevBottom - b.h + b.w > plat.x;
          var insideY = b.y < plat.y + plat.h && b.y + b.h > plat.y;
          if (prevInsideX && insideY) continue; // spawned overlapping; let vertical resolve
          if (insideY && top !== null && b.y + b.h > top + 1) {
            if (b.vx > 0 && b.x + b.w > plat.x && b.x < plat.x) {
              b.x = plat.x - b.w;
              if (b.burning && Math.abs(b.vx) > BARREL_DET_SPEED) { boom = true; break; } // wall slam
              b.vx = -b.vx * 0.4;
            } else if (b.vx < 0 && b.x < plat.x + plat.w && b.x + b.w > plat.x + plat.w) {
              b.x = plat.x + plat.w;
              if (b.burning && Math.abs(b.vx) > BARREL_DET_SPEED) { boom = true; break; }
              b.vx = -b.vx * 0.4;
            }
          }
        }
        if (boom) break;
        // invisible side walls: the map edges are solid too
        if (b.x < 0) {
          if (b.burning && b.vx < -BARREL_DET_SPEED) { boom = true; break; }
          b.x = 0;
          b.vx = Math.abs(b.vx) * 0.4;
        } else if (b.x + b.w > GAME_WIDTH) {
          if (b.burning && b.vx > BARREL_DET_SPEED) { boom = true; break; }
          b.x = GAME_WIDTH - b.w;
          b.vx = -Math.abs(b.vx) * 0.4;
        }
        // crate contacts: landing on a crate top or ramming its side — the
        // burning barrel detonates on either (a crate is a solid surface)
        for (var oi = 0; oi < crates.length && !boom; oi++) {
          var o = crates[oi];
          if (o.dead) continue;
          if (!(b.x < o.x + o.w && b.x + b.w > o.x)) continue;
          var oTop = o.y;
          if (b.vy >= 0 && prevBottom <= oTop + 1e-7 && b.y + b.h >= oTop - 1e-7) {
            if (b.burning && b.vy > BARREL_DET_SPEED) { boom = true; break; }
            b.y = oTop - b.h;
            if (b.vy > 1.2) b.vx *= 0.8; // impact brake only (weight feel)
            b.vy = 0;
            o.vx += b.vx * 0.25; // weight transfer
            grounded = true;
            supportLeft = Math.min(supportLeft, Math.max(b.x, o.x));
            supportRight = Math.max(supportRight, Math.min(b.x + b.w, o.x + o.w));
          } else if (propRamsFromSide(b, o)) {
            // ramming a crate from the side (a hopping barrel pushing up
            // through a stack is NOT a side ram: that overlap is a graze)
            if (b.burning && Math.abs(b.vx) > BARREL_DET_SPEED) { boom = true; break; }
            b.x = b.vx > 0 ? o.x - b.w : o.x + o.w;
            collidePropsSideways(b, o);
          }
        }
        if (boom) break;
        // barrel-on-barrel: same solid rules (one more detonation surface)
        for (var obi = 0; obi < barrels.length && !boom; obi++) {
          var ob = barrels[obi];
          if (ob === b || ob.dead) continue;
          if (!(b.x < ob.x + ob.w && b.x + b.w > ob.x)) continue;
          var obTop = ob.y;
          if (b.vy >= 0 && prevBottom <= obTop + 1e-7 && b.y + b.h >= obTop - 1e-7) {
            if (b.burning && b.vy > BARREL_DET_SPEED) { boom = true; break; }
            b.y = obTop - b.h;
            if (b.vy > 1.2) b.vx *= 0.8; // impact brake only (weight feel)
            b.vy = 0;
            ob.vx += b.vx * 0.25;
            grounded = true;
            supportLeft = Math.min(supportLeft, Math.max(b.x, ob.x));
            supportRight = Math.max(supportRight, Math.min(b.x + b.w, ob.x + ob.w));
          } else if (propRamsFromSide(b, ob)) {
            // side ram (see the crate branch above)
            if (b.burning && Math.abs(b.vx) > BARREL_DET_SPEED) { boom = true; break; }
            b.x = b.vx > 0 ? ob.x - b.w : ob.x + ob.w;
            collidePropsSideways(b, ob);
          }
        }
        if (boom) break;
        // fighter contacts: burning contact lights AND detonates; inert ones
        // mirror crateHitsPlayer (fall crush knockdown, lateral shove)
        var fts = [player1, player2];
        for (var fi = 0; fi < fts.length && !boom; fi++) {
          var p = fts[fi];
          if (p.hp <= 0) continue;
          if (p.groundedBarrel === b) {
            // perched: the fighter rides, no shove; a barrel rising under him lifts him on its top
            if (p.y + p.h > b.y && p.x < b.x + b.w && p.x + p.w > b.x) {
              p.y = b.y - p.h;
              if (p.airVelocityY > 0) p.airVelocityY = 0;
            }
            continue;
          }
          if (!fighterTouchesRect(p, b)) continue;
          if (headPressesProp(p, b, true)) continue;
          if (b.burning && !isUltraInstinct(p)) {
            p.damage(BARREL_TOUCH_BURN_DAMAGE);
            p.fireFlash = Math.max(p.fireFlash, 4);
            if (p.aiming) p.abortAiming(true, "keep");
            p.igniteFire(); // the flying pot burns on touch before it pops
            boom = true;
            break;
          }
          // the barrel rose under a fighter standing on it (a kick's hop): it
          // lifts him on its top, exactly like a crate, instead of shoving him off
          if (barrelLiftsRider(b, p)) {
            p.y = b.y - p.h;
            if (p.airVelocityY > 0) p.airVelocityY = 0;
            p.onGround = true;
            p.groundedBarrel = b;
            p.groundedPlatform = null;
            rideSupport(p, b);
            continue;
          }
          // a toppling barrel with momentum bowls him into the knockback roll
          if (topplingPropKnockback(b, p)) continue;
          var barrelCrushes = b.vy > 2 && b.y + b.h / 2 < p.y + p.h / 2;
          if (barrelCrushes) {
            // the drop slides him clear at once (vertical fall, bounded by the arena edges)
            p.x = Math.max(0, Math.min(GAME_WIDTH - p.w, (p.x + p.w / 2 < b.x + b.w / 2) ? b.x - p.w : b.x + b.w));
          } else {
            shovePlayerBesideProp(p, b); // lateral contact: bounded shove, never through a wall
          }
          if (barrelCrushes) {
            // crushed by a falling barrel (CanKnockDownPlayer, no ride)
            p.knockedDown = true;
            p.knockedDownFrame = 0;
            p.falling = false;
            p.jumping = false;
            p.rolling = false;
            p.knockbackRoll = false;
            p.knockbackRollFrame = 0;
            p.knockbackRollAngle = 0;
            p.blastRollPending = 0;
            p.diving = false;
            p.stunTimer = 0;
            p.airVelocityX = b.vx;
            p.airVelocityY = 0;
          }
        }
        if (boom) break;
      }
      if (boom) { detonateBarrel(b); continue; }
      propThroughDoor(b);
      // resting friction + rigid-body tip dynamics
      if (grounded) {
        applyBarrelFloorFriction(b);
        var tipSettled = rigidApi ? rigidApi.stepGroundRotation(b, BARREL_W, BARREL_H, BARREL_GRAVITY * PROP_TIP_GRAVITY_SHARE) : stepBarrelTip(b);
        reshapeBarrel(b, true);
        var overhanging = b.vy === 0 && tipBarrelOverEdge(b, supportLeft, supportRight);
        b.resting = b.vy === 0 && b.vx === 0 && tipSettled && !overhanging;
      } else {
        b.resting = false;
        b.angle += b.spin; // tumbling through the air
        var barrelAirDamping = airSpinDamping(b, BARREL_W, BARREL_H, BARREL_GRAVITY * PROP_TIP_GRAVITY_SHARE);
        b.spin *= barrelAirDamping === undefined ? 1 : barrelAirDamping;
        if (rigidApi) b.pose = rigidApi.poseForAngle(b.angle); // the face it will land on
        reshapeBarrel(b, false);
      }
      b.wasGrounded = grounded;
      b.lastVx = b.vx;
      // a burning barrel that ends dormant still goes up (grazes below the
      // crash speed never leave a forever-burning pot on the floor)
      if (b.burning) {
        b.burnFuse -= 1;
        if (b.burnFuse <= 0) detonateBarrel(b);
      }
    }

    // Separate overlapping barrel/body pairs so nothing clips (push-offs in
    // the same style as the crate separation passes)
    for (var pass = 0; pass < 2; pass++) {
      for (var ai = 0; ai < barrels.length; ai++) {
        var ba = barrels[ai];
        if (ba.dead) continue;
        for (var ci = 0; ci < crates.length; ci++) {
          var cb = crates[ci];
          if (cb.dead) continue;
          var ovX = Math.min(ba.x + ba.w, cb.x + cb.w) - Math.max(ba.x, cb.x);
          var ovY = Math.min(ba.y + ba.h, cb.y + cb.h) - Math.max(ba.y, cb.y);
          if (ovX <= 0 || ovY <= 0) continue;
          if (ovY <= 2) continue; // a graze is not a contact: the fall resolver owns it
          if (propContactIsStack(ba, cb, ovX, ovY)) {
            // deep vertical penetration: whichever body sits higher ends up
            // ON TOP (a crate resting on a barrel keeps perching on it)
            var upperB = (cb.y + cb.h / 2 <= ba.y + ba.h / 2) ? cb : ba;
            var lowerB = (upperB === cb) ? ba : cb;
            upperB.y = lowerB.y - upperB.h;
            if (upperB.vy > 0) upperB.vy = 0;
            upperB.resting = true;
          } else {
            // side graze/collision: the overlap is shared by mass (bounded)
            if (impactApi) separatePropsSideways(ba, cb, ovX);
            else if (ba.x + ba.w / 2 < cb.x + cb.w / 2) ba.x = cb.x - ba.w;
            else ba.x = cb.x + cb.w;
          }
        }
        for (var bi2 = 0; bi2 < barrels.length; bi2++) {
          var bb = barrels[bi2];
          if (bb === ba || bb.dead) continue;
          var bbOvX = Math.min(ba.x + ba.w, bb.x + bb.w) - Math.max(ba.x, bb.x);
          var bbOvY = Math.min(ba.y + ba.h, bb.y + bb.h) - Math.max(ba.y, bb.y);
          if (bbOvX <= 0 || bbOvY <= 0) continue;
          if (bbOvY <= 2) continue; // a graze is not a contact: the fall resolver owns it
          if (propContactIsStack(ba, bb, bbOvX, bbOvY)) {
            var upper = (ba.y + ba.h / 2 <= bb.y + bb.h / 2) ? ba : bb;
            var lower = (upper === ba) ? bb : ba;
            upper.y = lower.y - upper.h;
            if (upper.vy > 0) upper.vy = 0;
            upper.resting = true;
          } else {
            // a burning barrel pressed into an inert one detonates (solid
            // body contact, stage 2); inert pairs just push apart
            if (ba.burning !== bb.burning && Math.max(Math.abs(ba.vx), Math.abs(bb.vx)) > 0.3) {
              detonateBarrel(ba.burning ? ba : bb);
            } else if (impactApi) {
              separatePropsSideways(ba, bb, bbOvX);
            } else {
              if (ba.x + ba.w / 2 < bb.x + bb.w / 2) { ba.x = bb.x - ba.w; bb.x = ba.x + ba.w; }
              else { ba.x = bb.x + bb.w; bb.x = ba.x - bb.w; }
            }
          }
        }
      }
    }
  }

  // Whatever rests ON a moving prop rides along: feet flush with the lower's
  // top + horizontal overlap. Without this a punched barrel slides out from
  // under its crate and the upper prop is left hovering before an ugly drop
  // (the exactly-the-rider artifact the crate stacks never had, because the
  // crate pair pass already carries crates over crates).
  function updatePropStackRiders() {
    var props = crates.concat(barrels);
    for (var li = 0; li < props.length; li++) {
      var lower = props[li];
      if (lower.dead || Math.abs(lower.vx) < 0.05) continue;
      for (var ui = 0; ui < props.length; ui++) {
        if (ui === li) continue;
        var upper = props[ui];
        if (upper.dead) continue;
        if (Math.abs(upper.y + upper.h - lower.y) > 2.5) continue; // flush stack
        // the upper must really sit on the lower (half of its width perched):
        // side bodies that merely touch at a corner are NOT riders
        var hold = Math.min(upper.x + upper.w, lower.x + lower.w) - Math.max(upper.x, lower.x);
        if (hold < Math.min(upper.w, lower.w) * 0.5) continue;
        // carry share mirrors the fighter-perch carry (p.x += crate.vx * 0.6):
        // POSITION only. A velocity handoff double-counts the rider's own
        // mover (it outran the braking lower and slid off), and a stale share
        // hovered forever after the lower stopped
        upper.x += lower.vx * 0.6;
      }
    }
  }

  // Phase 5 entities
  var nextShotId = 0;
  var bulletImpactClock = 0; // game-speed steps; times the SMG burst window
  var bullets = []; // { x, y, vx, vy, damage, crit, owner, trail[] }
  var weaponRespawnTimer = 300;
  var grenades = []; // { x, y, vx, vy, fuse, spin, type: 'grenade'|'molotov' }
  var flames = []; // { x, y, vx, vy, life, damage, owner, hit } — fire props (ember spark puffs set damage: 0)
  var explosions = []; // { x, y, radius, frame }
  // Explosion ground fire (Fires.as fire nodes): { x, y, vx, vy, size, life,
  // maxLife, inAir, slowing, hit, phase, sparkTimer, crateTick } embers.
  var groundFire = [];
  // Stage-2 barrel fire patches: the flaming micro-fragments (153/164) fall
  // out of a detonation, land on the floor and burn for their lifetime timer
  // (3-5 s), burning every fighter that steps on them.
  var barrelDebris = []; // { x, y, vx, vy, sprite, angle, spin, scale, h, life, maxLife, landed, hit }
  var glassShards = []; // { x, y, vx, vy, angle, spin, size, life }
  var gore = []; // airborne gore: { x, y, vx, vy, sprite, angle, spin, kind, scale, life }
  var goreStains = []; // landed gore decals: { x, y, sprite, angle, scale, alpha }

  // Gore sprite IDs (superfighters/shapes): big splats/meat chunks (147, 150,
  // 181, 183), the skin strip (141) and small droplets (167, 170, 529, 570,
  // 573, 1310). 161 is the exploded-barrel art and 153/164 are the flaming
  // BARREL fragments (BARREL_FIRE_DEBRIS_SPRITES) — never gore: shipped
  // sprite reference sheets mark them barrel debris.
  var GORE_SPRITES = [141, 147, 150, 181, 183, 167, 170, 529, 570, 573, 1310];
  var GORE_CHUNK_SPRITE_IDS = [141, 147, 150, 181, 183];

  // Phase 6: round + slow-motion + bot (extracted model)
  var gameSpeed = 1; // game_speed: slow-motion scales all simulation
  var roundOver = null; // { winnerId } or null
  var restartTimer = 0; // ROUND_RESTART_FRAMES countdown after a kill (legacy flow)
  var roundFlow = roundFlowApi ? roundFlowApi.createRoundFlow() : null; // PLAYING -> SLOWMO -> AWAITING_CONTINUE
  var botActive = false; // P2 driven by the bot
  var slowmoPhase = null; // { t: frames elapsed } during the round-end slowmo
  var itemSlowmo = null; // { mode: 'in'|'hold'|'out', t, target, hold } — Slowmo pickup
  // ---------- Bazooka missile: body, rear flame and fading exhaust trail ----------
  var MISSILE_BODY_LENGTH = 14;       // px, nose to tail
  var MISSILE_BODY_THICKNESS = 4;     // px
  var MISSILE_FLAME_LENGTH = 9;       // px, rear propulsion flame (flickers)
  var EXHAUST_PARTICLES_PER_STEP = 2; // emitted from the tail every sim step
  var EXHAUST_PARTICLE_LIFE = 28;     // steps until fully faded
  var EXHAUST_PARTICLE_CAP = 400;     // hard ceiling: no leak on spam / slow frames
  var EXHAUST_DRIFT_SPEED = 0.25;     // random sideways drift of each puff
  var EXHAUST_RISE_SPEED = 0.12;      // smoke lifts slowly
  var EXHAUST_FIRE_SHARE = 0.4;       // life fraction spent as incandescent spark
  var rocketExhaust = []; // { x, y, vx, vy, life, maxLife, size }

  var rocketSlowmo = null; // { mode: 'hold'|'out', t } — StuckToProjectile slow cam

  // ---------- Canvas ----------
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var layoutSettingsWidgets = null;
  function resizeCanvasToWindow() {
    var pixelWidth = Math.max(1, window.innerWidth || GAME_WIDTH);
    var pixelHeight = Math.max(1, window.innerHeight || GAME_HEIGHT);
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    VIEW_SCALE = Math.max(pixelWidth / GAME_WIDTH, pixelHeight / GAME_HEIGHT);
    VIEW_WIDTH = pixelWidth / VIEW_SCALE;
    VIEW_HEIGHT = pixelHeight / VIEW_SCALE;
    ctx.imageSmoothingEnabled = false;
    if (layoutSettingsWidgets) layoutSettingsWidgets();
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    resizeCanvasToWindow();
    window.addEventListener('resize', resizeCanvasToWindow);
  }

  // ---------- Weapon sprites (extracted DefineSprite PNG folders) ----------
  // Weapon sprite SVG IDs as identified by the user (superfighters/shapes/)
  var weaponSpriteDefs = {
    pistol: '213.svg',
    magnum: '787.svg',
    uzi: '892.svg',
    rifle: '223.svg',
    shotgun: '228.svg',
    sniper: '233.svg',
    bazooka: '252.svg',
    flamethrower: '505.svg',
    machete: '296.svg',
    axe: '500.svg',
    sword: '291.svg',
    grenade: '278.svg',
    molotov: '286.svg',
    pills: '782.svg',
    medkit: '777.svg',
    slowmo: '882.svg'
  };
  var WEAPON_SPRITE_WIDTH = { // pickup/hand width in px (original scale)
    pistol: 15, uzi: 15, magnum: 14, rifle: 20, shotgun: 20, sniper: 22,
    bazooka: 22, flamethrower: 18, sword: 20, machete: 16, axe: 18,
    grenade: 10, molotov: 10, slowmo: 12, pills: 10, medkit: 12
  };
  var weaponSpriteImages = {}; // shape -> { img, sx, sy, sw, sh }
  if (typeof Image !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
    for (var _wshape in weaponSpriteDefs) {
      (function (shape, path) {
        var img = new Image();
        img.onload = function () {
          // the shape's own rect is already the weapon silhouette: keep it whole
          weaponSpriteImages[shape] = { img: img, w: img.width, h: img.height };
        };
        img.src = 'superfighters/shapes/' + path;
      })(_wshape, weaponSpriteDefs[_wshape]);
    }
  }

  // Shipped in-flight art of the throwables (wpn_grenade_thrown = shape 276,
  // wpn_molotov_thrown = shape 284), drawn 1:1 centered on the projectile and
  // spun by its travel. Missing images fall back to the procedural canister.
  var THROWN_SPIN_RADIANS_PER_PX = 0.15; // g.spin accumulates horizontal travel
  var thrownSpriteDefs = { grenade: '276.svg', molotov: '284.svg' };
  var thrownSpriteImages = {};
  // Position marker (shape 494, 27.5x27.5, registration at its center) drawn
  // under every thrown grenade so its whereabouts read at a glance.
  var GRENADE_MARKER_SCALE = 0.5; // shrunk from natural size (user: too big)
  var grenadeMarkerImage = null;
  if (typeof Image !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
    var _markerImg = new Image();
    _markerImg.onload = function () { grenadeMarkerImage = _markerImg; };
    _markerImg.src = 'superfighters/shapes/494.svg';
  }
  if (typeof Image !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
    for (var _thrownType in thrownSpriteDefs) {
      (function (type, path) {
        var img = new Image();
        img.onload = function () { thrownSpriteImages[type] = img; };
        img.src = 'superfighters/shapes/' + path;
      })(_thrownType, thrownSpriteDefs[_thrownType]);
    }
  }

  // ---------- Aim stance sprites (extracted DefineSprite aim_* animations) ----------
  // While aiming, ANIM_WPN rotation = CurrentAimPitch in the shipped build
  // (PlayerAnimation.as: _this.ANIM_WPN.rotation = CurrentAimPitch; gotoAndStop(1)),
  // so the aiming UPPER BODY (head + arm + gun) rotates with the pitch while the
  // bent torso + legs stay planted on the ground. The fighter here is Johnny,
  // the white tank top character (shape family 582..662, idle = 592).
  // The two-piece aim model (verified by exact pixel-match against the symbol
  // previews in superfighters/sprites/):
  //   bottom piece: shape 662 (bent torso + legs), drawn unrotated at the feet
  //   top piece per weapon (matches its aim symbol's whole preview):
  //     aim_pistol 667 -> 666, aim_magnum 671 -> 670, aim_rifle 675 -> 674,
  //     aim_uzi 679 -> 678, aim_shotgun 684 -> 682, aim_sniper 688 -> 687,
  //     aim_bazooka 692 -> 691, aim_flamethrower 698 -> 697, aim_throw 702 -> 701
  //   THROWABLES aim with their own BODY cells (both rendered AT THE SAME
  //   TIME while the throw key is held, per the user contract):
  //     grenade hold = 699 body (lean with the grenade in hand) + the 701
  //                    arm piece superimposed on top, rotating with the pitch;
  //     molotov hold = 703 body (lean with the bottle raised) + the same 701
  //                    arm piece superimposed, rotating with the pitch.
  //   The body cells replace the 662 bottom for the throwables only; ranged
  //   guns keep the 662 bottom + their own top piece underneath.
  // The top piece is placed with its bottom-left at AIM_TOP_X / AIM_TOP_Y
  // (raw sprite units from the feet anchor) so both pieces join at the seam;
  // it rotates by the aim pitch around the SHOULDER (sx/sy = the measured
  // arm-joint inside each top piece, natural coords).
  // mx/my = muzzle tip in natural top-piece coords (x from left, y from top).
  var AIM_BOTTOM = { sprite: 662, w: 12, h: 16 };
  var AIM_TOP_X = -5; // top piece registration, x from the feet anchor
  var AIM_TOP_Y = -10; // top piece registration, y from the feet anchor
  // Seam tuck: pitching UP slides the top piece a few px down-right;
  // pitching DOWN translates it in the mirrored sense (right + down),
  // matching the piece's own mass swing away from the shoulder pivot.
  // Linear in |pitch|/AIM_PITCH_MAX.
  var AIM_SWAY_UP = { x: 2, y: 2 };     // raw sprite px at pitch -90
  var AIM_SWAY_DOWN = { x: 8, y: 2 };   // raw sprite px at pitch +90 (inverted sense)
  // Pre-aim ("raising the weapon") top pieces, shown unrotated for
  // AIM_PREPARATION_STEPS before the regular aim piece takes over; the
  // flamethrower also swaps its bottom piece (693) for the same window.
  // Long enough that a quick-shot right after a (slower, floatier) grenade
  // throw pops it beyond the blast radius of the thrower (GRENADE.radius = 90):
  // at 25 steps the grenade sits ~100 px away, so the thrower takes no damage
  var THROW_AIM_BLOCK_STEPS = Math.round(0.2 * FPS); // 0.2 s lockout before FIRE can aim after a throw
  var AIM_PREPARATION_STEPS = Math.round(3 * ANIM_TICKS_TO_STEPS); // 3 ticks at 24 fps = 8 steps
  var AIM_PREPARATION_SPRITES = {
    pistol:       { sprite: 664, w: 12, h: 14 },
    magnum:       { sprite: 668, w: 12, h: 15 },
    rifle:        { sprite: 672, w: 13, h: 20 },
    uzi:          { sprite: 676, w: 12, h: 16 },
    shotgun:      { sprite: 680, w: 12, h: 20 },
    sniper:       { sprite: 685, w: 12, h: 29 },
    bazooka:      { sprite: 689, w: 12, h: 18 },
    flamethrower: { sprite: 695, w: 13, h: 21, body: 693, bodyW: 14, bodyH: 16 }
  };
  var AIM_SPRITE_DEFS = {
    pistol:       { sprite: 666, w: 18, h: 12, mx: 16.5, my: 4, sx: 2, sy: 6 },
    magnum:       { sprite: 670, w: 20, h: 12, mx: 18.5, my: 4, sx: 2, sy: 6 },
    rifle:        { sprite: 674, w: 24, h: 13, mx: 22.5, my: 7, sx: 2, sy: 8 },
    uzi:          { sprite: 678, w: 19, h: 12, mx: 17.5, my: 4, sx: 2, sy: 6 },
    shotgun:      { sprite: 682, w: 21, h: 13, mx: 20.5, my: 7, sx: 2, sy: 8 },
    sniper:       { sprite: 687, w: 32, h: 13, mx: 25.5, my: 7, sx: 2, sy: 8 },
    bazooka:      { sprite: 691, w: 25, h: 12, mx: 23.5, my: 4, sx: 8, sy: 6 },
    flamethrower: { sprite: 697, w: 25, h: 13, mx: 21.5, my: 7, sx: 2, sy: 8 },
    grenade:      { body: 699, bodyW: 16, bodyH: 16, sprite: 701, w: 14, h: 12, mx: 12.5, my: 5, sx: 2, sy: 6 },
    molotov:      { body: 703, bodyW: 16, bodyH: 16, sprite: 701, w: 14, h: 12, mx: 12.5, my: 5, sx: 2, sy: 6 }
  };

  function aimSpriteDefFor(p) {
    if (!p.aiming) return null;
    // AimMode 1 = a held grenade/molotov; AimMode 0 = the ranged weapon
    var shape = p.aimMode === 1
      ? (p.throwable && p.throwable.ammo > 0
          ? (p.throwable.type === 'molotov' ? 'molotov' : 'grenade')
          : null)
      : (p.ranged ? p.ranged.gun.shape : null);
    return (shape && AIM_SPRITE_DEFS[shape]) || null;
  }

  // The pre-aim piece of the weapon being raised (null once the preparation
  // window is over, for throwables, or when the weapon has no such art).
  function aimPreparationDefFor(p) {
    if (!p.aiming || p.aimMode !== 0 || !(p.aimPrepTimer > 0) || !p.ranged) return null;
    return AIM_PREPARATION_SPRITES[p.ranged.gun.shape] || null;
  }

  // ---------- Melee swing + throw-release cells (shipped shape frames) ----------
  // Melee weapon swings play per-link body cells while the shipped slash
  // TRACE flashes as its own particle at the hit frame (user-verified cells,
  // body order like the shipped AXE_0X/SWORD_0X/MACHETE_0X clips):
  //   axe:     link 1 = 644 (crouch windup), 645 (swing front)
  //            link 2 = 648 (low chop)
  //            link 3 = 651 (overhead hold)
  //   sword:   link 1 = 653 (crouch windup), 654 (sweep front)
  //            link 2 = 657 (point sweep)
  //            link 3 = 660 (overhead hold)
  //   machete: link 1 = 636 (crouch windup), 637 (sweep front)
  //            link 2 = 639 (low chop)
  //            link 3 = 642 (overhead hold)
  // The slash traces (750/753/756 red axe, 759/762/765 machete, 768/771/774
  // sword) are the shipped SwingComboEffects particles (TRACE_*_01/02/03):
  // ONE per combo link, spawned AT the hit frame exactly like MeleeStrike
  // does (particle_data(MeleeSwingEffect, _this_x, _this_y) with ScaleX =
  // LastDirX). Each shipped trace clip animates arc/arc/blank over 2 clip
  // frames (24fps), so the overlay lives MELEE_TRACE_LIFE game steps.
  // Traces NEVER replace the body and do not cycle with the cells — no
  // flicker on long links.
  // Fists keep the vanilla PUNCH_0X links through 'attackLinks'.
  // sprite-map.js may override per weapon through PLAYER_SPRITE_MAP.
  // meleeAttackLinks: { sword|axe|machete: [[link1 cells], [link2], [link3]] }.
  var MELEE_ATTACK_LINKS = {
    axe: [[644, 645], [648], [651]],
    sword: [[653, 654], [657], [660]],
    machete: [[636, 637], [639], [642]]
  };
  // Slash-trace shape ids per weapon (link 1..3).
  var MELEE_TRACE_IDS = {
    axe: [750, 753, 756],
    sword: [768, 771, 774],
    machete: [759, 762, 765]
  };
  // Shipped trace life: 2 visible clip frames (arc, arc) + the blank 3rd
  // before EndParticle — at 24fps that is 2 display ticks ~= 5 game steps.
  var MELEE_TRACE_LIFE = 5;

  // ---------- Weapon-combo anchor data (shipped symbol placements) ----------
  // The weapon-swing cells are raw CROPS of the shipped sheet whose bbox
  // includes the weapon lead-in: centering every crop makes the FIGHTER hop
  // between link frames (the axe/sword/machete extend 1..14 px of dead margin
  // to one side). MELEE_CELL_ANCHORS re-anchors each crop: bx = the fighter's
  // to one side). MELEE_CELL_ANCHORS re-anchors each crop: bx = the fighter's
  // torso center-x measured inside the crop (weapon pixels excluded), feet =
  // the last leg row (rows under it are outline/blade padding). Drawing maps
  // bx onto the AABB center +1 art px (exactly where the idle cell's own bias
  // puts it) and feet+1 onto the AABB bottom line, so every link lands the
  // fighter on the same axis and the mirrored side becomes the true
  // reflection.
  var MELEE_CELL_ANCHORS = {
    644: { bx: 9.5, feet: 27 }, // axe L1 windup
    645: { bx: 15.5, feet: 19 }, // axe L1 strike (axe swings out far-left)
    648: { bx: 10.5, feet: 26 }, // axe L2 chop
    651: { bx: 8.5, feet: 16 }, // axe L3 slide (crop is cut above the feet)
    653: { bx: 10.5, feet: 27 }, // sword L1 windup
    654: { bx: 23.5, feet: 19 }, // sword L1 sweep (blade reaches far-left)
    657: { bx: 12, feet: 27 }, // sword L2
    660: { bx: 8.5, feet: 23 }, // sword L3 hold
    636: { bx: 13.5, feet: 21 }, // machete L1 windup
    637: { bx: 8, feet: 20 }, // machete L1 strike
    639: { bx: 14.5, feet: 22 }, // machete L2
    642: { bx: 9.5, feet: 19 } // machete L3
  };
  // The slash-trace exports carry their symbol registration: MeleeStrike
  // spawns them at the FIGHTER origin (this.x + w/2, feet line) with
  // ScaleX = LastDirX, so the art hangs off (ox, oy) relative to that point;
  // the numbers below are the shipped reg points inside each trace crop.
  // axe: L1 (31x12 arc around the torso), L2 (hook rising high), L3 (slide
  // slash hugging the ground ahead); machete L1..3; sword L1..3.
  var MELEE_TRACE_ANCHORS = {
    750: { ox: 13, oy: 16 },
    753: { ox: 4.5, oy: 26 },
    756: { ox: -2, oy: 23 },
    759: { ox: 9, oy: 20 },
    762: { ox: 14, oy: 24 },
    765: { ox: -7, oy: 24 },
    768: { ox: 21.5, oy: 16 },
    771: { ox: 9.5, oy: 28 },
    774: { ox: -2.5, oy: 23 }
  };
  // Weapon-combo pacing: at the port's brisk base pace the axe/sword/machete
  // swing links replay so fast the poses read as a single flash (user tuning).
  // MELEE_ANIM_SLOW stretches every timing of the weapon melee combo — link
  // length, hit frame, chain-min frame and the render cell hold — by one
  // factor so art and effects stay in phase. Fists keep the punch cadence.
  var MELEE_ANIM_SLOW = 1.5;

  // Throw-release body frames (single full-body shipped cells): BOTH throws
  // share the forward release lean (699, item leaving the extended hand tip),
  // and both ends show the quick recovery cell 705 (arm whipped back up) for
  // the last THROW_RELEASE_END_STEPS of the pose clock.
  var THROW_RELEASE_SPRITES = { grenade: 699, molotov: 699 };
  var THROW_RELEASE_END = 705;
  var THROW_RELEASE_END_STEPS = 2;
  // Natural-coord HAND/grip points of the release frames (from each frame's
  // top-left, measured on the bitmap crops): the projectile instances at
  // these coordinates through the same feet/scale/mirror transform the pose
  // itself uses in drawPlayerSprite. The shared 699 lean leaves both items
  // from the same extended hand tip.
  var THROW_RELEASE_HAND = {
    grenade: { x: 1.5, y: 5.5 },
    molotov: { x: 1.5, y: 5.5 }
  };
  // Idle sprite's natural height drives the shared player sprite scale
  // (drawPlayerSprite divides p.h by this, hoisted for release-pose math).
  var SPRITE_BASE_HEIGHT = 21;

  function meleeLinksFor(shape) {
    if (!shape) return null;
    // sprite-map.js override first (one weapon at a time), then the shipped
    // row mapping above
    if (SPRITE_MAP && SPRITE_MAP.meleeAttackLinks && SPRITE_MAP.meleeAttackLinks[shape]) {
      return SPRITE_MAP.meleeAttackLinks[shape];
    }
    return MELEE_ATTACK_LINKS[shape] || null;
  }

  // ---------- Optional player sprites (SVG shapes 592..725) ----------
  // The shipped fighter art (Johnny, the white tank top character) comes as
  // DefineSprite SVG crops of bitmap 591 (superfighters/images/591.png):
  //   627, 628, 630, 631, 633, 634 - the punch swing (windup, slash, twist, hip
  //     drive, wind-back arm, thrust), mapped under 'attack' in sprite-map.js
  //   718, 720                       - GetHit (flinch braced, head-back recoil),
  //     shown while hitFlash runs after taking a punch
  //   724, 725                       - BeingKicked tumble (combo finisher / kick
  //     launch), shown while the ragdoll flies ('launched', p.falling)
  // All of them load through the generic PLAYER_SPRITE_MAP loader below.
  // Burning-fighter flame frames (superfighters/shapes/): the frames of the
  // ORIGINAL burning-player fire_effect (symbol 173). They play cycled very
  // fast (2 render steps per frame -> ~6 full loops/s) for the level-2 burn.
  var FIRE_FLAME_SPRITES = [186, 188, 190, 192, 194];
  var FIRE_FLAME_STEPS_PER_FRAME = 2;
  var spriteImages = Object.create(null);
  // Mods art (mods/): pelogoku hair over the head + aura flame behind the
  // body. Declared at this scope so the draw paths can probe it even when the
  // Image constructor is unavailable (node test sandbox).
  var modImages = Object.create(null);
  var modAudio = Object.create(null); // { transform: HTMLAudioElement | null }
  var modSprites = Object.create(null); // set name -> [Image|null] (MOD_SPRITE_DEFS order)
  var spriteReady = false;
  var spriteTotal = 0, spriteLoaded = 0;
  var SPRITE_MAP = (typeof window !== 'undefined' && window.PLAYER_SPRITE_MAP) ? window.PLAYER_SPRITE_MAP : {};
  if (typeof Image !== 'undefined') {
    var _indices = [];
    for (var _i = 592; _i <= 634; _i++) _indices.push(_i);
    if (SPRITE_MAP) {
      for (var _k in SPRITE_MAP) {
        var _v = SPRITE_MAP[_k];
        if (Array.isArray(_v) && Array.isArray(_v[0])) {
          // nested per-clip arrays (attackLinks)
          for (var _n = 0; _n < _v.length; _n++) {
            for (var _nn = 0; _nn < _v[_n].length; _nn++) _indices.push(_v[_n][_nn]);
          }
        } else if (Array.isArray(_v)) { for (var _j = 0; _j < _v.length; _j++) _indices.push(_v[_j]); }
        else _indices.push(_v);
      }
    }
    // Aim stance shapes (Johnny: bottom 662 + top pieces 666..701)
    _indices.push(AIM_BOTTOM.sprite);
    for (var _ak in AIM_SPRITE_DEFS) {
      _indices.push(AIM_SPRITE_DEFS[_ak].sprite);
      // throwable aim defs carry their own body cell (699 grenade / 703
      // molotov, superimposed under the rotating 701 arm piece)
      if (AIM_SPRITE_DEFS[_ak].body != null) _indices.push(AIM_SPRITE_DEFS[_ak].body);
    }
    for (var _pk in AIM_PREPARATION_SPRITES) {
      _indices.push(AIM_PREPARATION_SPRITES[_pk].sprite);
      if (AIM_PREPARATION_SPRITES[_pk].body != null) _indices.push(AIM_PREPARATION_SPRITES[_pk].body);
    }
    // Burning-flame frames (the original fire_effect animation)
    for (var _fl = 0; _fl < FIRE_FLAME_SPRITES.length; _fl++) _indices.push(FIRE_FLAME_SPRITES[_fl]);
    // Gore art: flesh chunks + blood splats and droplets (shipped shapes)
    for (var _go = 0; _go < GORE_SPRITES.length; _go++) _indices.push(GORE_SPRITES[_go]);
    // Cover prop art: the shipped destructible crate (131) + the three wood
    // fragments it spawns when it breaks (6/9/141; 141 also lists as gore —
    // the dedupe pass below removes the double load)
    _indices.push(131);
    _indices.push(6);
    _indices.push(9);
    _indices.push(141);
    // Barrels: the pristine 127 art, the burning 161 stage-1 art and the two
    // flaming micro-fragments (153/164) the detonation leaves on the floor
    _indices.push(BARREL_SPRITE);
    _indices.push(BARREL_BURN_SPRITE);
    // Heavy props (hanging 2, metal crate 134, bouncer 1063)
    for (var _hk in HEAVY_CONFIG) _indices.push(HEAVY_CONFIG[_hk].sprite);
    _indices.push(BARREL_FIRE_DEBRIS_SPRITES[0]);
    _indices.push(BARREL_FIRE_DEBRIS_SPRITES[1]);
    // Rocket-ride art: the shipped bazooka_rocket rocket frames (527 anim) +
    // the rider's head (sprite 707, hooked at the missile tip while stuck,
    // shown instead of the idle body for the whole ride)
    _indices.push(521);
    _indices.push(523);
    _indices.push(525);
    _indices.push(526);
    _indices.push(707);
    // Ladder climb art (shipped shapes 709/710/711 up loop, 713 down)
    _indices.push(709);
    _indices.push(710);
    _indices.push(711);
    _indices.push(713);
    // Melee weapon swing cells (three links per weapon) + slash trace cells
    for (var _mw in MELEE_ATTACK_LINKS) {
      var _mcells = MELEE_ATTACK_LINKS[_mw];
      for (var _mc = 0; _mc < _mcells.length; _mc++) {
        for (var _mc2 = 0; _mc2 < _mcells[_mc].length; _mc2++) _indices.push(_mcells[_mc][_mc2]);
      }
    }
    for (var _mtw in MELEE_TRACE_IDS) {
      var _mtl = MELEE_TRACE_IDS[_mtw];
      for (var _mt = 0; _mt < _mtl.length; _mt++) _indices.push(_mtl[_mt]);
    }
    if (SPRITE_MAP && SPRITE_MAP.meleeAttackLinks) {
      // Any sprite-map melee override still has to load its own cells
      for (var _umw in SPRITE_MAP.meleeAttackLinks) {
        var _umcells = SPRITE_MAP.meleeAttackLinks[_umw];
        if (Array.isArray(_umcells)) {
          for (var _umc = 0; _umc < _umcells.length; _umc++) {
            if (Array.isArray(_umcells[_umc])) {
              for (var _umc2 = 0; _umc2 < _umcells[_umc].length; _umc2++) _indices.push(_umcells[_umc][_umc2]);
            } else _indices.push(_umcells[_umc]);
          }
        }
      }
    }
    _indices.push(THROW_RELEASE_SPRITES.grenade);
    _indices.push(THROW_RELEASE_SPRITES.molotov);
    // Quick end-of-pose recovery cell shared by every throw release
    _indices.push(THROW_RELEASE_END);
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
    // The mod images load without a shared counter: their draw sites
    // gate on complete && naturalWidth, so a missing file silently falls
    // back to the procedural hair / no backing flame. The four cutscene
    // poses ride the same lazy system (transform0..transform3).
    (function () {
      var _mods = { hair: SSJ2_MOD_HAIR_SRC, aura: SSJ2_MOD_AURA_SRC };
      for (var _tf = 0; _tf < SSJ2_MOD_TRANSFORM_SRCS.length; _tf++) {
        _mods['transform' + _tf] = SSJ2_MOD_TRANSFORM_SRCS[_tf];
      }
      for (var _setName in MOD_SPRITE_DEFS) {
        modSprites[_setName] = [];
        for (var _sp = 0; _sp < MOD_SPRITE_DEFS[_setName].length; _sp++) {
          var _simg = new Image();
          _simg.src = 'mods/' + MOD_SPRITE_DEFS[_setName][_sp];
          modSprites[_setName].push(_simg);
        }
      }
      for (var _mk in _mods) {
        (function (name, src) {
          var img = new Image();
          modImages[name] = img;
          img.src = src;
        })(_mk, _mods[_mk]);
      }
      // The ritual audio preloads once; playback fires with the pose start
      // (a keydown-initiated gesture chain, so browser policies allow it).
      if (typeof Audio !== 'undefined') {
        if (!modAudio.transform) {
          try {
            modAudio.transform = new Audio(SSJ2_TRANSFORM_AUDIO_SRC);
            modAudio.transform.preload = 'auto';
          } catch (e) { /* a missing audio support never breaks the ritual */ }
        }
        if (!modAudio.teleport) {
          try { modAudio.teleport = new Audio(SSJ2_TELEPORT_AUDIO_SRC); modAudio.teleport.preload = 'auto'; } catch (e) {}
        }
        if (!modAudio.heavyPunch) {
          try { modAudio.heavyPunch = new Audio(SSJ2_HEAVY_PUNCH_AUDIO_SRC); modAudio.heavyPunch.preload = 'auto'; } catch (e) {}
        }
        if (!modAudio.kameCharge) {
          try { modAudio.kameCharge = new Audio(SSJ2_KAME_CHARGE_AUDIO_SRC); modAudio.kameCharge.preload = 'auto'; } catch (e) {}
        }
        if (!modAudio.kameWave) {
          try { modAudio.kameWave = new Audio(SSJ2_KAME_WAVE_AUDIO_SRC); modAudio.kameWave.preload = 'auto'; } catch (e) {}
        }
        if (!modAudio.furious) {
          try { modAudio.furious = new Audio(SSJ2_FURIOUS_AUDIO_SRC); modAudio.furious.preload = 'auto'; } catch (e) {}
        }
        if (!modAudio.uiTheme) {
          try { modAudio.uiTheme = new Audio(UI_THEME_AUDIO_SRC); modAudio.uiTheme.preload = 'auto'; } catch (e) {}
        }
        if (!modAudio.recharge) {
          try { modAudio.recharge = new Audio(SSJ2_RECHARGE_AUDIO_SRC); modAudio.recharge.preload = 'auto'; } catch (e) {}
        }
      }
    })();
  }

  function playerSpriteKey(p) {
    if (p.ssjGhost) return 'idle'; // the static double left at the teleport origin
    if (p.knockbackRoll) return 'knockbackRoll'; // tumbling beats the lying pose
    if (p.knockedDown) return 'knockedDown';
    if (p.rolling) return 'roll';
    if (p.diving) return 'dive';
    if (p.falling) return 'launched';
    // Ladder climb: going up loops the climb cells, going down uses the
    // dedicated descent cell.
    if (p.climbing) {
      if (p.airVelocityY < 0) {
        if (SPRITE_MAP && SPRITE_MAP['climb'] != null) return 'climb';
        if (SPRITE_MAP && SPRITE_MAP['climbUp'] != null) return 'climbUp';
        if (SPRITE_MAP && SPRITE_MAP['climbup'] != null) return 'climbup';
        return 'climb';
      }
      if (SPRITE_MAP && SPRITE_MAP['climbDown'] != null) return 'climbDown';
      if (SPRITE_MAP && SPRITE_MAP['climbdown'] != null) return 'climbdown';
      if (SPRITE_MAP && SPRITE_MAP['climbDownward'] != null) return 'climbDownward';
      return 'climbDown';
    }
    // GetHit: the artifact renders its STUN clip (STUN_0X) for the whole stun,
    // so the hit reaction sprite holds through the flash AND the stun window.
    if (p.hitFlash > 0 || p.stunTimer > 0) return 'gethit';
    // Throw release: the hand-extended shipped lean holds while the pose
    // clock runs (699 shared by grenade and molotov; the pose tail swaps to
    // the 705 recovery cell). A grab-throw reuses the grenade pose.
    if (p.throwPose > 0) {
      return p.throwPoseType === 'molotov' && THROW_RELEASE_SPRITES.molotov != null
        ? 'throwMolotov'
        : 'throwGrenade';
    }
    // plain SSJ floating: the static idle cell, the body only drifts
    if (p.ssj2 && p.ssjFlying && p.ssjPhase === SSJ_PHASE_SSJ && !p.punching) return 'idle';
    if (p.punching) return 'attack';
    if (p.crouching) return (p.inCover && SPRITE_MAP['cover'] != null) ? 'cover' : 'crouch';
    if (p.aiming) return 'guard';
    if (p.kickFlash > 0) {
      if (!p.onGround || p.jumpKickPerformed || p.jumpKickQueued) return 'kickWithJump';
      return 'kick';
    }
    // a jump holds the single jump cell from take-off to touchdown; only an
    // unjumped drop (walking off a ledge) shows the fall cells
    if (!p.onGround) return p.jumping ? 'jump' : 'fall';
    if (p.pressDownKey && p.pressDownKey() && !p.running) return 'crouch';
    if (p.running) return p.sprinting ? 'run' : 'walk';
    return 'idle';
  }

  // SSJ2 hair over the shipped body cell: PROCEDURAL FALLBACK for when the
  // mod hair image is missing (mods/pelogoku.png). The transformation is
  // total, so a deep-gold cap covers the agent's baked hair row and the five
  // swept spikes emerge above it. All coords are LOCAL to the sprite draw
  // already in place (feet anchor, mirror included), pre-multiplied by the
  // sprite scale k — deterministic tufts so the silhouette is stable per frame.
  function addSsj2SpriteHair(headLx, headTopLy, headW, k, capH) {
    var goldBright = '#ffe95c';
    var goldDeep = '#f8b400';
    // hair cap over the baked hair rows (one row of slack under the spikes)
    px(headLx, headTopLy, headW, (capH || 4.5) * k, goldDeep);
    // swept spikes: five staggered tufts standing up over the head band
    for (var s = 0; s < 5; s++) {
      var spikeH = (4 + ((s * 7919 + 3) % 5)) * k;
      var sxp = headLx + (s * (headW - 3 * k)) / 4;
      px(sxp, headTopLy - spikeH, 3 * k, spikeH + 1.5 * k, s % 2 ? goldDeep : goldBright);
      px(sxp - 0.5 * k, headTopLy + 0.5 * k, 0.5 * k, 1.5 * k, s % 2 ? goldDeep : goldBright);
    }
  }

  // The mod hair: the full pelogoku.png is squeezed onto one deterministic
  // box built from the head band rect (the same rect the gold fallback uses)
  // — base covers the baked hair down to the brow line, the tall Goku spikes
  // climb a cap-height above the hairline. Drawn over the body cell within
  // the feet-anchored/mirrored frame, so it rides every pose and facing.
  // Looking up/down tilts the head further than the body: the hair rotates
  // about its BASE (nape pivot) by a share of the aim pitch and slides back
  // a little so the roots stay glued to the head instead of swinging off it.
  var HAIR_HEAD_TILT_SHARE = 0.4;     // hair tilt per degree of aim pitch
  var HAIR_LOOK_UP_NAPE_SHIFT = 0.8;  // art px the roots slide back at full look-up
  function hairHeadTilt(aimPitchDeg) {
    var pitch = aimPitchDeg || 0;
    return {
      radians: (pitch * HAIR_HEAD_TILT_SHARE * Math.PI) / 180,
      napeShift: pitch < 0 ? (-pitch / AIM_PITCH_MAX) * HAIR_LOOK_UP_NAPE_SHIFT : 0
    };
  }

  function drawSsj2HeadHair(headLx, headTopLy, headW, k, capH, aimPitchDeg) {
    capH = capH == null ? 4.5 : capH;
    var hair = modImages.hair;
    if (hair && hair.complete && hair.naturalWidth) {
      var hw = headW + 2.2 * k;                       // a hair-width over the head band
      var hh = (capH + capH + 1.2) * k;               // brow cover + spikes above
      var hx = headLx + headW / 2 - hw / 2;           // centered on the head
      var hy = headTopLy + capH * k - hh;             // base lands on the brow line
      var tilt = hairHeadTilt(aimPitchDeg);
      if (tilt.radians === 0 && tilt.napeShift === 0) {
        ctx.drawImage(hair, hx, hy, hw, hh);
        return;
      }
      var pivotX = hx + hw / 2 - tilt.napeShift * k;   // base of the hair = nape
      var pivotY = hy + hh;
      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.rotate(tilt.radians);
      ctx.drawImage(hair, -hw / 2, -hh, hw, hh);       // drawn about the pivot
      ctx.restore();
      return;
    }
    addSsj2SpriteHair(headLx, headTopLy, headW, k, capH);
  }

  // The mod aura: the full aura.png flame silhouette rises BEHIND the body
  // cell. Anchored to the feet line inside the same translate/scale(-1)
  // frame as the body — it stays glued while posing and flips with the
  // facing. A breathing alpha (leve transparencia) + a slow vertical bob
  // give it the aura shimmer without hiding the original sprite.
  function drawSsj2AuraBehind(p, k) {
    var aura = modImages.aura;
    if (!aura || !aura.complete || !aura.naturalWidth) return;
    var t = p.ssjTimer || 0;
    var breathe = 0.5 + 0.5 * Math.sin(t * 0.11);
    var aw = Math.max(p.w, p.h * 0.85) * (2.05 + 0.14 * breathe);
    var ah = p.h * (1.75 + 0.1 * breathe);            // tip climbs ~3/4 body above the head
    var ax = -aw / 2;
    var ay = -ah + k * (0.4 + 0.35 * Math.sin(t * 0.07)); // base floats just off the feet line
    ctx.save();
    ctx.globalAlpha = SSJ2_AURA_BASE_ALPHA * (0.82 + 0.18 * breathe);
    ctx.drawImage(aura, ax, ay, aw, ah);
    ctx.restore();
  }

  // ---------- Mod art (SSJ2 / UI phases) ----------
  function modSpriteImg(setName, i) {
    var arr = modSprites[setName];
    var im = arr && arr[i];
    return (im && im.complete && im.naturalWidth) ? im : null;
  }

  var UI_HURT_SPRITE_KEYS = { gethit: 1, knockedDown: 1, launched: 1, knockbackRoll: 1 };
  var MOD_ART_OK_KEYS = {
    idle: 1, walk: 1, run: 1, jump: 1, fall: 1, crouch: 1, attack: 1,
    kick: 1, kickWithJump: 1, guard: 1
  };

  // The art for the fighter's current phase/stance, or null while the shipped
  // fighter cell should draw (plain SSJ, or any hurt/tumble/launch state).
  function modArtFor(p, key) {
    if (!p.ssj2 || p.hp <= 0 || p.gibbed) return null;
    var pose = p.transformationPose;
    if (pose) return pose.kind ? modSpriteImg(pose.set, pose.frame) : null;
    var phase = p.ssjPhase;
    if (phase === SSJ_PHASE_SSJ2) {
      if (p.ssjMelee) return modSpriteImg('ssj2Attack', Math.min(SSJ2_MELEE_FRAMES - 1, p.ssjMelee.frame));
      if (p.ssjCharging) {
        var cn = MOD_SPRITE_DEFS.ssj2Charge.length;
        var cimg = modSpriteImg('ssj2Charge', Math.floor((p.ssjTimer || 0) / 3) % cn);
        if (cimg) return cimg;
      }
      return MOD_ART_OK_KEYS[key] ? modSpriteImg('ssj2Idle', 0) : null;
    }
    if (phase === SSJ_PHASE_UI) {
      // UI strike (';'): static idle during the wind-up, then the warped fighter
      // plays atackui1 -> atackui4 in order (last frame = end of the animation).
      if (p.ssjUiTele) {
        if (p.ssjUiTele.stage === 'pre') return modSpriteImg('uiIdle', 0);
        return modSpriteImg('uiAttack', p.ssjUiTele.frame) || modSpriteImg('uiIdle', 0);
      }
      // Hit/hurt poses never show in UI: the fighter keeps the static idle art
      if (UI_HURT_SPRITE_KEYS[key]) return modSpriteImg('uiIdle', 0);
      if (!MOD_ART_OK_KEYS[key]) return null;
      if (p.onGround && (key === 'walk' || key === 'run')) {
        var ready = [];
        for (var wi = 0; wi < modSprites.uiWalk.length; wi++) {
          var wimg = modSpriteImg('uiWalk', wi);
          if (wimg) ready.push(wimg); // the sheet skips a few numbers: only loaded frames cycle
        }
        if (ready.length) return ready[Math.floor((p.walkFrame || 0) / 5) % ready.length];
      }
      return modSpriteImg('uiIdle', 0);
    }
    return null;
  }

  // ONE scale for every mod figure: the reference standing height maps to
  // MOD_ART_BODY_MULT hitbox heights, and oversized sheets (a 1000px figure
  // next to 300px ones) are first brought down to that reference, so no phase
  // ever draws giant or misaligned.
  // Ultra Instinct landing glow: full intensity for 10 s, then a smooth fade.
  function uiGlowAmount(p) {
    var age = p.ssjUiAge || 0;
    if (age <= UI_GLOW_HOLD_STEPS) return 1;
    return Math.max(0, 1 - (age - UI_GLOW_HOLD_STEPS) / UI_GLOW_FADE_STEPS);
  }

  function modSilhouette(img) {
    if (img._sil !== undefined) return img._sil;
    img._sil = null;
    try {
      var c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      var cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      cx.globalCompositeOperation = 'source-in';
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, c.width, c.height);
      img._sil = c;
    } catch (e) { img._sil = null; }
    return img._sil;
  }

  // Feet-anchored frame (already translated/mirrored): the figure turns into a
  // blazing white silhouette with only diffuse hints of the art showing through.
  function drawUiGlowFigure(img, w, h, glow) {
    var sil = modSilhouette(img);
    ctx.save();
    ctx.globalAlpha = 1 - 0.8 * glow; // details stay only as faint, diffuse patches
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
    if (!sil) return;
    ctx.save();
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = 14 * glow;
    ctx.globalAlpha = Math.min(1, 0.92 * glow);
    ctx.drawImage(sil, -w / 2, -h, w, h);
    ctx.shadowBlur = 34 * glow;
    ctx.globalAlpha = 0.55 * glow;
    ctx.drawImage(sil, -w / 2, -h, w, h);
    ctx.restore();
  }

  // Share (0..1) of the heal glow still to play, shaped as a smooth in/out arc.
  function healGlowIntensity(p) {
    if (!p.healGlowTimer || p.healGlowTimer <= 0) return 0;
    var progress = 1 - p.healGlowTimer / HEAL_GLOW_STEPS;
    return Math.sin(Math.PI * progress);
  }

  // Feet-anchored frame (translated/mirrored). Paints the white silhouette of
  // the cell over itself: a soft wash on the whole body plus a bright band
  // that travels from the feet to the head.
  function drawHealGlowFigure(p, img, dx, dy, w, h) {
    var intensity = healGlowIntensity(p);
    if (intensity <= 0) return;
    var sil = modSilhouette(img);
    if (!sil) return;
    var progress = 1 - p.healGlowTimer / HEAL_GLOW_STEPS;
    ctx.save();
    ctx.globalAlpha = HEAL_GLOW_BASE_ALPHA * intensity;
    ctx.drawImage(sil, dx, dy, w, h);
    // the sweep band, bottom -> top of the cell
    var bandH = h * HEAL_GLOW_SWEEP_BAND;
    var bandBottom = dy + h + bandH - progress * (h + bandH * 2);
    ctx.beginPath();
    ctx.rect(dx - w, bandBottom - bandH, w * 3, bandH);
    ctx.clip();
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = HEAL_GLOW_BLUR_PX * intensity;
    ctx.globalAlpha = Math.min(1, 0.95 * intensity + 0.05);
    ctx.drawImage(sil, dx, dy, w, h);
    ctx.restore();
  }

  function modArtScale(p, img) {
    var s = (p.h * MOD_ART_BODY_MULT) / MOD_ART_REF_HEIGHT;
    if (img.naturalHeight > 700) s *= MOD_ART_REF_HEIGHT / img.naturalHeight;
    return s;
  }

  function drawPlayerSprite(p) {
    // SSJ2 keeps the SHIPPED fighter cells for every state (user request:
    // the character must render with its original sprite). The transformation
    // markers wrap around that body: the mod hair (mods/pelogoku.png, gold
    // procedural fallback) rides the sprite head, and the mod aura
    // (mods/aura.png) breathes BEHIND the body — the lightning / beam FX stay
    // in the always-on overlay (drawSsjAura).
    if (!spriteReady) return false;
    var key = playerSpriteKey(p);
    // Throw release poses OUTRANK the aim pieces (they can share a step when
    // the aim re-arms mid-release): the hand-extended body frame wins.
    var releasePose = key === 'throwGrenade' || key === 'throwMolotov';
    // Aim stance: the FEET anchor + pivot rotation draw the lean pose rotated
    // by the aim pitch (ANIM_WPN.rotation = CurrentAimPitch in the artifact)
    var aimDef = releasePose ? null : aimSpriteDefFor(p);
    var prepDef = aimDef ? aimPreparationDefFor(p) : null;
    var entry;
    if (prepDef) {
      entry = prepDef.sprite;
    } else if (aimDef) {
      entry = aimDef.sprite;
    } else if (releasePose) {
      // The release pose plays TWO cells: the start cell — user map override
      // or the shipped shared 699 lean — for most of the pose clock, and the
      // quick 705 recovery cell for the last THROW_RELEASE_END_STEPS steps.
      // An ARRAY override still monopolizes the whole pose (mapped preview).
      var _relShape = key === 'throwMolotov' ? 'molotov' : 'grenade';
      var _mapped = SPRITE_MAP[key];
      if (Array.isArray(_mapped)) {
        entry = _mapped;
      } else {
        entry = THROW_RELEASE_END != null && p.throwPose <= THROW_RELEASE_END_STEPS
          ? THROW_RELEASE_END
          : (_mapped != null ? _mapped : THROW_RELEASE_SPRITES[_relShape]);
      }
    } else {
      entry = SPRITE_MAP[key];
    }
    var linkIndex = Math.max(1, Math.min(COMBO_LINKS, p.punchComboNr || 1)) - 1;
    if (key === 'attack') {
      // Melee WEAPONS swing their own shipped cells (three links each, same
      // cadence as the punch clips); fists keep the vanilla PUNCH_0X links.
      var meleeShape = p.equipped && p.equipped.shape;
      var meleeLinks = meleeLinksFor(meleeShape);
      if (meleeLinks) {
        entry = meleeLinks[linkIndex];
      } else if (SPRITE_MAP && SPRITE_MAP['attackLinks']) {
        entry = SPRITE_MAP['attackLinks'][linkIndex];
      }
    }
    if (entry == null) {
      // Fallback tumble cell (shipped shape) so the hard-impact roll still
      // renders with a bare sprite map; climbs keep their shipped fallbacks.
      if (key === 'knockbackRoll') entry = 606;
      else if (key === 'climb' || key === 'climbUp' || key === 'climbup' || key === 'climb_up') entry = [709, 710, 711];
      else if (key === 'climbDown' || key === 'climbdown' || key === 'climb_down' || key === 'climbDownward') entry = 713;
      else return false;
    }
    var frameIndex = 0;
    if (Array.isArray(entry)) {
      if (key === 'gethit') {
        // GetHit (shipped shapes 718 flinch + 720 head-back recoil): the
        // artifact plays its STUN clip across the whole stun (PlayerAnimation:
        // IsStunned -> STUN_0X loop). User-tuned ~70% slower: the flinch holds
        // the first 8 steps of the pose clock, then the recoil settles for the
        // rest of the flash/stun window - one deliberate late swap per hit
        // instead of a mid-flash toggle.
        frameIndex = p.getHitClock < 8 ? 0 : Math.min(1, entry.length - 1);
      } else if (key === 'launched') {
        // Launched (shipped BeingKicked tumble, cells laid 724, 725, 726 left
        // to right on bitmap 591): the pose follows the FLIGHT PHASE (rise ->
        // apex -> fall) so the ragdoll flails through three poses instead of
        // snapping between two frames instantly.
        frameIndex = p.airVelocityY < -0.4
          ? 0
          : p.airVelocityY < 0.4 ? 1 : Math.min(2, entry.length - 1);
      } else {
        // Pose advance measured in ARTIFACT TICKS (PlayerAnimation.as:
        // _current_frame += game_speed per 24 fps logic tick -> one pose per
        // ~2.5 steps real time) but stretched to the sheet's cell sets: our
        // state arrays carry only the key artist cells of each shipped clip,
        // so each cell holds proportionally longer to match the shipped
        // cadence and feel.
        var divisor, counter;
        if (key === 'attack') {
          // Per-link cell hold keeps the strike on the hit frame: link 1 is a
          // 3-cell clip (strike at 628 near frame 10), link 2 a 2-cell clip
          // that settles on 633, link 3 a single-sided thrust. Weapon swings
          // stretch the holds by MELEE_ANIM_SLOW to match the slowed timing.
          var animScale = meleeLinks ? MELEE_ANIM_SLOW : 1;
          divisor = Math.round([8, 12, 8][linkIndex] * animScale);
          counter = p.punchFrame || 0;
        } else if (key === 'roll') {
          divisor = 8; // 16-step roll over the 2 shipped cells
          counter = p.rollFrame || 0;
        } else if (key === 'knockbackRoll') {
          divisor = 4; // the tumble replays its pose fast; shape 606 is one cell
          counter = p.knockbackRollFrame || 0;
        } else if (key === 'knockedDown') {
          divisor = 15; // ~30-step lying animation over the 2 shipped cells
          counter = p.knockedDownFrame || 0;
        } else if (key === 'fall' || key === 'jump') {
          divisor = 8; // airborne clock: the descent cycles the fall cells (no tumble cell — 606 is impact-roll only)
          counter = p.airbornTimer || 0;
        } else if (key === 'climb' || key === 'climbUp' || key === 'climbup' || key === 'climb_up') {
          divisor = 8; // ladder climb: cycle the up cells (709/710/711) in a loop
          counter = p.climbFrame || 0;
        } else {
          divisor = 10; // walk/run stride (~25% slower than the 8-steps pace)
          counter = p.walkFrame || 0;
        }
        frameIndex = Math.floor(counter / divisor) % entry.length;
      }
    }
    var idx = Array.isArray(entry) ? entry[frameIndex] : entry;
    var img = spriteImages[idx];
    if (!img || !img.complete || !img.naturalWidth) return false;
    // The transformation cutscene replaces the body cell wholesale: the mod
    // flex art (mods/5000.png..5003.png) draws bottom-anchored at the feet,
    // scaled to TRANSFORM_POSE_HEIGHT_MULT body heights. Pixel look: disable
    // smoothing for the pose so the chunky art stays readable when shrunk.
    var poseArt = null;
    if (p.transformationPose && !p.transformationPose.kind) {
      var poseImg = modImages['transform' + p.transformationPose.frame];
      if (poseImg && poseImg.complete && poseImg.naturalWidth) poseArt = poseImg;
    }
    var poseScale = null;
    if (poseArt) img = poseArt;
    // SSJ2 / UI phases swap the whole cell for the mod art (one normalized scale)
    var shippedCellHeight = img.naturalHeight; // the original sprite the base cutscene must match
    var modArt = (!aimDef && !poseArt) ? modArtFor(p, key) : null;
    if (modArt) img = modArt;
    // Weapon-swing cells re-anchor through MELEE_CELL_ANCHORS: map the
    // fighter's in-crop torso center onto the AABB center +1 art px (the
    // idle cell's own shipped bias) and the feet row onto the AABB bottom
    // line, removing the bbox-center hop between links (weapon lead-in).
    // mapped pixel centers: px -> (dx + (px + 0.5) * k); target X(bx) = +1k,
    // Y(feet bottom edge) = -1k -> dx = -(bx - 0.5) * k, dy = -(feet + 2) * k
    var cellAnchor = (key === 'attack' && !modArt && MELEE_CELL_ANCHORS[idx]) || null;
    ctx.save();
    // The knockback tumble pivots around the BODY CENTER and spins by its
    // accumulated rolled-distance angle (artifact-crate style); everything
    // else anchors at the feet. The rotate call comes BEFORE the mirror so
    // the spin stays in the motion's direction regardless of the flip.
    var tumble = key === 'knockbackRoll';
    if (tumble) {
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate(((p.knockbackRollAngle || 0) * Math.PI) / 180);
    } else {
      ctx.translate(p.x + p.w / 2, p.y + p.h);
    }
    // Native sprite faces right; the shipped tumble art (launched: head toward
    // the flight origin) is mirrored so it reads flying AWAY from the attack.
    // The lying pose joins the same inverted convention so the flight -> floor
    // landing keeps one head direction (the shipped lying cells alone snap).
    // User-requested mirror: the launch family inverts the flip convention.
    // The knockback roll flips by its IMPACT velocity instead (rebound
    // included): pushed right rolls facing right, pushed left gets scaleX(-1).
    var mirror;
    if (key === 'knockbackRoll') {
      mirror = (p.knockbackRollDir || p.lastDirX) < 0;
    } else {
      mirror = (key === 'launched' || key === 'knockedDown') ? p.lastDirX > 0 : p.lastDirX < 0;
    }
    if (mirror) ctx.scale(-1, 1);
    // Shared scale: every sprite keeps the idle sprite's pixel density so wide
    // frames (fall 19x19, dive 23x12) never render taller or wider than the body
    var k = p.h / SPRITE_BASE_HEIGHT;
    var w = img.naturalWidth * k;
    var h = img.naturalHeight * k;
    if (modArt || poseArt) {
      // every mod figure (activation poses included) shares ONE normalized
      // scale from the very first frame of the transformation
      var mas = modArtScale(p, img);
      var activation = p.transformationPose;
      if (activation && activation.kind === PHASE_TRANSFORM.ACTIVATE) {
        // base cutscene: frame 1 is the standing Goku, so one scale makes it
        // exactly as tall as the original sprite; later frames grow from it
        var firstFrame = modSpriteImg(PHASE_TRANSFORM.ACTIVATE, 0);
        if (firstFrame && firstFrame.naturalHeight) mas = (shippedCellHeight * k) / firstFrame.naturalHeight;
      }
      w = img.naturalWidth * mas;
      h = img.naturalHeight * mas;
    }
    // SSJ2 mod aura: drawn FIRST inside the feet-anchored frame so the body
    // cell renders over it. The hard-impact tumble skips it (a spinning
    // flame reads wrong mid-roll; the grounded/air poses keep the aura).
    if (p.ssj2 && p.hp > 0 && !tumble && p.ssjPhase !== SSJ_PHASE_UI && !poseArt && !(p.transformationPose && p.transformationPose.kind)) drawSsj2AuraBehind(p, k);
    if (prepDef) {
      // Raising the weapon: unrotated pre-aim top piece on the bent torso
      var prepBodyShape = prepDef.body != null ? prepDef.body : AIM_BOTTOM.sprite;
      var prepBodyW = prepDef.body != null ? prepDef.bodyW : AIM_BOTTOM.w;
      var prepBodyH = prepDef.body != null ? prepDef.bodyH : AIM_BOTTOM.h;
      var prepBodyImg = spriteImages[prepBodyShape];
      if (!prepBodyImg || !prepBodyImg.complete || !prepBodyImg.naturalWidth) return false;
      ctx.drawImage(prepBodyImg, -(prepBodyW / 2) * k, -prepBodyH * k, prepBodyW * k, prepBodyH * k);
      ctx.drawImage(img, AIM_TOP_X * k, (AIM_TOP_Y - prepDef.h) * k, prepDef.w * k, prepDef.h * k);
    } else if (aimDef) {
      // The feet-anchored BODY under the aim: throwables carry their own body
      // cell (699 grenade / 703 molotov); guns use the 662 bent torso. Then
      // the aiming UPPER BODY piece (ANIM_WPN.rotation = CurrentAimPitch)
      var botShape = aimDef.body != null ? aimDef.body : AIM_BOTTOM.sprite;
      var botW = aimDef.body != null ? aimDef.bodyW : AIM_BOTTOM.w;
      var botH = aimDef.body != null ? aimDef.bodyH : AIM_BOTTOM.h;
      var botImg = spriteImages[botShape];
      if (!botImg || !botImg.complete || !botImg.naturalWidth) return false;
      ctx.drawImage(
        botImg,
        -(botW / 2) * k, -botH * k,
        botW * k, botH * k
      );
      // The top piece pivots around the SHOULDER joint (skin/arm band left
      // edge, measured per piece in its natural coords): the arm and head
      // swing from the shoulder exactly like a real aiming turn. The small
      // sway translation keeps the seam tucked (down-right when aiming up,
      // up-left when aiming down).
      var aimT = Math.abs(p.aimPitch) / AIM_PITCH_MAX; // 0..1 at the extremes
      var sway = p.aimPitch < 0 ? AIM_SWAY_UP : AIM_SWAY_DOWN;
      var shoulderX = (AIM_TOP_X + aimDef.sx + sway.x * aimT - DRY_FIRE_KICK_PIXELS * p.dryFireKickAmount()) * k;
      var shoulderY = (AIM_TOP_Y - (aimDef.h - aimDef.sy) + sway.y * aimT) * k;
      ctx.save();
      ctx.translate(shoulderX, shoulderY);
      ctx.rotate((p.aimPitch * Math.PI) / 180);
      ctx.drawImage(img, -aimDef.sx * k, -(aimDef.h - aimDef.sy) * k, aimDef.w * k, aimDef.h * k);
      // SSJ2: the mod hair rides the rotated aim piece (its head sits at the
      // piece's top-left: small head, slim cap, goggles clear)
      if (p.ssj2 && p.hp > 0) {
        drawSsj2HeadHair(-aimDef.sx * k + 1 * k, -(aimDef.h - aimDef.sy) * k, 9 * k, k, 3, p.aimPitch);
      }
      ctx.restore();
    } else {
      if (cellAnchor) {
        ctx.drawImage(
          img,
          -(cellAnchor.bx - 0.5) * k,
          -(cellAnchor.feet + 2) * k,
          w,
          h
        );
        drawHealGlowFigure(p, img, -(cellAnchor.bx - 0.5) * k, -(cellAnchor.feet + 2) * k, w, h);
      } else {
        if (poseArt) {
          // the big pixel-art pose: crisp cells, no smoothing smear
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, -w / 2, -h, w, h);
          ctx.imageSmoothingEnabled = true;
        } else if (modArt) {
          var glow = (p.ssjPhase === SSJ_PHASE_UI && !p.transformationPose) ? uiGlowAmount(p) : 0;
          if (glow > 0) {
            drawUiGlowFigure(img, w, h, glow); // white silhouette that fades with time
          } else {
            ctx.drawImage(img, -w / 2, -h, w, h); // mod art carries its own hair/aura
            drawHealGlowFigure(p, img, -w / 2, -h, w, h);
          }
        } else {
          ctx.drawImage(img, -w / 2, tumble ? -h / 2 : -h, w, h);
          drawHealGlowFigure(p, img, -w / 2, tumble ? -h / 2 : -h, w, h);
          // SSJ2: mod hair over the shipped cell head — the head band rides
          // the cell top, roughly centered (below the dive pose, whose head
          // sits sideways, is skipped). The cutscene pose carries its own
          // hair/face: the gold cap would paint over a different head.
          if (p.ssj2 && p.hp > 0 && key !== 'dive' && !poseArt) {
            drawSsj2HeadHair(-5.5 * k, -h, 11 * k, k, 4.5);
          }
        }
      }
    }
    ctx.restore();
    // Slash trace particle (MeleeStrike: spawned at (_this_x, _this_y) with
    // ScaleX = LastDirX): world-space overlay anchored at the fighter's
    // SYMBOL ORIGIN (center-x on the feet line, captured at the hit), flipped
    // by the CAPTURED facing about that axis. The trace art hangs off its own
    // registration point (MELEE_TRACE_ANCHORS), so the arc paints around the
    // torso on BOTH facings instead of sliding off the crop's left edge.
    if (p.meleeTrace) {
      var _traceImg = spriteImages[p.meleeTrace.shape];
      if (_traceImg && _traceImg.complete && _traceImg.naturalWidth) {
        ctx.save();
        // The captured point IS the fighter's axis: mirror by scaling about
        // it, never by translating the pivot to the AABB edge (the old
        // top-left convention that made mirrored traces slide sideways).
        ctx.translate(p.meleeTrace.x, p.meleeTrace.y);
        if (p.meleeTrace.dir < 0) ctx.scale(-1, 1);
        var _tAnchor = MELEE_TRACE_ANCHORS[p.meleeTrace.shape];
        if (_tAnchor) {
          ctx.drawImage(
            _traceImg,
            -_tAnchor.ox * k,
            -_tAnchor.oy * k,
            _traceImg.naturalWidth * k,
            _traceImg.naturalHeight * k
          );
        } else {
          ctx.drawImage(_traceImg, 0, 0, _traceImg.naturalWidth * k, _traceImg.naturalHeight * k);
        }
        ctx.restore();
      }
    }
    return true;
  }

  // ---------- Input ----------
  var keys = Object.create(null);
  var keysJustPressed = Object.create(null);
  var keysJustReleased = Object.create(null);
  var paused = false; // KeyP freezes the sim while the overlay shows "PAUSED"

  var PREVENT_DEFAULT_CODES = [
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'
  ];

  window.addEventListener('keydown', function (e) {
    if (PREVENT_DEFAULT_CODES.indexOf(e.code) !== -1) e.preventDefault();
    if (e.code === BOT_TOGGLE_CODE) {
      botActive = !botActive; // toggle the P2 bot
      return;
    }
    // The cheat ritual owns the letters of the cheat words: a typed 'matrix'
    // must never act as P2's fire key, so the swallow happens before the
    // binding states ever see the event.
    if (CheatCodeManager.wantsKey(e.code)) {
      // The word's first letter already reached the fire key (instant aim): the
      // second letter proves it was typing, so undo that aim without a shot.
      if (CheatCodeManager.buffer === MATRIX_SEQUENCE.charAt(0)) {
        keys.KeyM = false;
        keysJustPressed.KeyM = false;
        delete keysJustReleased.KeyM;
        var typist = player2;
        if (typist && typist.aiming && typist.binding.fire === 'KeyM') typist.abortAiming(false, 'keep');
      }
      CheatCodeManager.onKeyDown(e.code);
      return;
    }
    if (!keys[e.code]) keysJustPressed[e.code] = true;
    keys[e.code] = true;
    // The cheat listener still sees every other key: only the typed LETTER
    // sequence matters, never which fighter the engine binds the key to.
    CheatCodeManager.onKeyDown(e.code);
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

  // ---------- CheatCodeManager ('gokussj' -> SSJ2 / 'matrix' -> The One) ----------
  // Konami-style typed buffer: the tail of the letter stream must spell one
  // of the cheat words (no non-letter key in between). The sequence never
  // consumes the keys, so typing it never interferes with the bindings (the
  // WASD letters P1 walks with are plain letters to the buffer).
  // Both shells live on the Arrow-Key fighter and are mutually exclusive:
  // a new word swaps the mode, the CURRENT word re-typed drops the mode.
  var CHEAT_TRUNCATE = 14; // longest cheat word ('jkjkjkjkjkjkjk') sets the buffer size
  function cheatKeyCodeToChar(code) {
    // e.code 'KeyA'..'KeyZ' -> 'a'..'z'; every other key breaks the stream
    if (typeof code === 'string' && code.length === 4 && code.indexOf('Key') === 0) {
      return code.charAt(3).toLowerCase();
    }
    return null;
  }

  // The ritual's owner: the fighter bound to the Arrow Keys (P2's binding in
  // this build), found by its left-code rather than assumed by slot order.
  function arrowKeyPlayer() {
    var roster = [player1, player2];
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].binding.left === 'ArrowLeft') return roster[i];
    }
    return null;
  }

  // Open-sky probe ("aire libre"): the body column drawn straight up to the
  // top of the world must be free of SOLID collision boxes. Clouds, ladders
  // and the one-way elevator are passable sky furniture; walls, hung slabs,
  // glass panes and stacked crates all count as a roof.
  function ssjOpenAirAbove(p) {
    var probe = { x: p.x + 2, y: p.y - 400, w: p.w - 4, h: 400 };
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (platformIsOneWay(plat) || plat.ladder) continue;
      if (rectsOverlap(probe, plat)) return false;
    }
    for (i = 0; i < crates.length; i++) {
      if (crates[i].dead) continue;
      if (rectsOverlap(probe, crates[i])) return false;
    }
    return true;
  }

  // The transformations themselves: land one of the two shells after the
  // open-sky ritual. The installation flash is spawned by the state
  // (SuperSaiyan2State / MatrixModeState enter), so any direct instantiation
  // path bursts exactly once.
  function isUltraInstinct(p) {
    return !!p.ssj2 && p.ssjPhase === SSJ_PHASE_UI;
  }

  function activateSsj2(p, landingPhase) {
    if (!p || p.ssj2) return;
    p.ssjKi = Math.max(p.ssjKi, SSJ2_KI_START);
    p.setSsj2(new SuperSaiyan2State());
    startBaseTransformation(p, landingPhase || SSJ_PHASE_SSJ);
  }

  // ---------- Transformation cutscene (mods 5000-5003 + ritual audio) ----------
  // The moment the shell lands the fighter flexes through the four user art
  // frames while gokutransformacion.mp3 rolls. The pose PINS the fighter
  // (input lock + zero velocities, gravity stays skipped) and cancels
  // cleanly on death, grabs, knockdowns or round restarts.
  function startTransformationAudio() {
    if (typeof Audio === 'undefined') return; // test/vm sandbox: no audio
    var a = modAudio.transform;
    if (!a) {
      try {
        a = new Audio(SSJ2_TRANSFORM_AUDIO_SRC);
        a.preload = 'auto';
        modAudio.transform = a;
      } catch (e) { return; } // a missing audio support never blocks the pose
    }
    try {
      a.currentTime = 0;
      var pr = a.play();
      if (pr && pr.catch) pr.catch(function () {}); // autoplay rejections stay silent
    } catch (e) { /* never break the ritual over audio */ }
  }

  // ---------- SSJ2 ability audio helpers ----------
  // Shared primitives (every ability sound used its own copy of these): play
  // an element from its start without ever throwing or leaving an unhandled
  // autoplay rejection, and stop one without ever throwing.
  function playAudioSafely(audio) {
    try {
      var playback = audio.play();
      if (playback && playback.catch) playback.catch(function () {});
    } catch (e) { /* audio never breaks gameplay */ }
  }

  function restartAudio(audio) {
    try {
      audio.pause(); // elements keep playing (not queueing) on a plain play()
      audio.currentTime = 0;
    } catch (e) { /* audio never breaks gameplay */ }
    playAudioSafely(audio);
  }

  function stopAudio(audio) {
    if (!audio) return;
    try { audio.onended = null; audio.pause(); audio.currentTime = 0; } catch (e) { /* ignore */ }
  }

  function ssjPlayAudio(key, src) {
    if (typeof Audio === 'undefined') return null;
    var a = modAudio[key];
    if (!a) {
      try { a = new Audio(src); a.preload = 'auto'; modAudio[key] = a; } catch (e) { return null; }
    }
    return a;
  }

  // Pressing J again owns the whole chain: both channels are interrupted and
  // rewound BEFORE the new teleport starts, so rapid J taps never queue
  // (no delayed teleport tails, no overlapped heavy punches). The chain
  // generation token also cancels any stale "heavy punch after teleport"
  // scheduling from a chain a newer press already superseded.
  var SSJ_TELE_PUNCH_CHAIN = 0;
  function ssjPlayTeleportThenHeavyPunch() {
    if (typeof Audio === 'undefined') return;
    var chain = ++SSJ_TELE_PUNCH_CHAIN; // a newer press invalidates this chain
    var t = ssjPlayAudio('teleport', SSJ2_TELEPORT_AUDIO_SRC);
    var h = ssjPlayAudio('heavyPunch', SSJ2_HEAVY_PUNCH_AUDIO_SRC);
    if (h) {
      // kill the previous chain's pending punch (or one still ringing out)
      try { h.onended = null; h.pause(); h.currentTime = 0; } catch (e) {}
    }
    if (!t) return;
    try {
      t.onended = null;
      t.pause(); // audio elements keep playing (not queueing) on plain play()
      t.currentTime = 0;
      var pr = t.play();
      if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {}
    t.onended = function () {
      if (chain !== SSJ_TELE_PUNCH_CHAIN) return; // superseded by a newer J press
      if (!h) return;
      try { h.currentTime = 0; var pr2 = h.play(); if (pr2 && pr2.catch) pr2.catch(function () {}); } catch (e) {}
    };
  }

  function ssjStartKameChargeAudio(p) {
    if (typeof Audio === 'undefined') return;
    var a = ssjPlayAudio('kameCharge', SSJ2_KAME_CHARGE_AUDIO_SRC);
    if (!a) return;
    try { a.onended = null; } catch (e) {}
    try {
      a.loop = false;
      a.pause(); // a still-playing previous charge never keeps sounding
      a.currentTime = 0; // every charge starts the file from second 0
      var pr = a.play();
      if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {}
    a.onended = function () {
      // the file finished BY ITSELF while K stayed held: the energy is
      // reabsorbed (collapse animation), the beam never fires and
      // kameha-wave.mp3 never plays
      try { ssjReabsorbKame(p); } catch (e) {}
    };
  }

  function ssjStopKameChargeAudio() {
    if (typeof Audio === 'undefined') return;
    stopAudio(modAudio.kameCharge);
  }

  function ssjPlayKameWave() {
    if (typeof Audio === 'undefined') return;
    var a = ssjPlayAudio('kameWave', SSJ2_KAME_WAVE_AUDIO_SRC);
    if (!a) return;
    try { a.currentTime = 0; } catch (e) {}
    playAudioSafely(a);
  }

  function ssjStartRechargeAudio() {
    if (typeof Audio === 'undefined') return;
    var a = ssjPlayAudio('recharge', SSJ2_RECHARGE_AUDIO_SRC);
    if (!a) return;
    try { a.onended = null; } catch (e) {}
    var startMid = function () {
      try {
        var mid = (a.duration && isFinite(a.duration)) ? a.duration / 2 : 0;
        a.currentTime = mid;
        a.loop = false;
        var pr = a.play();
        if (pr && pr.catch) pr.catch(function () {});
      } catch (e) {}
    };
    if (a.readyState && a.readyState >= 1 && a.duration && isFinite(a.duration)) {
      startMid();
    } else {
      try { a.addEventListener('loadedmetadata', startMid, { once: true }); } catch (e) { startMid(); }
      try { a.load(); } catch (e) {}
    }
    a.onended = function () {
      var mid = (a.duration && isFinite(a.duration)) ? a.duration / 2 : 0;
      try { a.currentTime = mid; var pr = a.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    };
  }

  function ssjStopRechargeAudio() {
    if (typeof Audio === 'undefined') return;
    stopAudio(modAudio.recharge);
  }

  // The secret sequence's cutscene: transformation.png..transformation11.png
  // play once, then the fighter lands in `landingPhase` (SSJ / SSJ2 / UI).
  function startBaseTransformation(p, landingPhase) {
    if (!p || p.hp <= 0 || p.transformationPose) return;
    p.transformationPose = {
      kind: PHASE_TRANSFORM.ACTIVATE, set: PHASE_TRANSFORM.ACTIVATE, frame: 0, t: 0,
      frames: MOD_SPRITE_DEFS.toBase.length, seq: null, landingPhase: landingPhase
    };
    p.transformationPose.slots = p.transformationPose.frames;
    if (p.aiming) p.abortAiming(false);
    p.rolling = false;
    p.rollFrame = 0;
    p.diving = false;
    if (p.endMatrixWallRun) p.endMatrixWallRun('exit'); // the ritual owns the stance
    startTransformationAudio();
  }

  // Where a phase-transformation cutscene stands at pose.t: the art slot to
  // show and the total length in steps. The UI sequence opens with a long,
  // slow build-up (UI_INTRO_*) before the faster strain loop.
  function phaseTransformTimeline(pose) {
    var stepsPerFrame = pose.kind === PHASE_TRANSFORM.TO_UI ? UI_TRANSFORM_STEPS_PER_FRAME
      : pose.kind === PHASE_TRANSFORM.ACTIVATE ? BASE_TRANSFORM_STEPS_PER_FRAME
      : SSJ_TRANSFORM_STEPS_PER_FRAME;
    var lastSlot = pose.slots - 1;
    if (!pose.seq) {
      return {
        slot: Math.min(lastSlot, Math.floor(pose.t / stepsPerFrame)),
        totalSteps: stepsPerFrame * pose.slots
      };
    }
    var introSteps = UI_INTRO_FRAMES * UI_INTRO_STEPS_PER_FRAME;
    var slot = pose.t < introSteps
      ? Math.floor(pose.t / UI_INTRO_STEPS_PER_FRAME)
      : UI_INTRO_FRAMES + Math.min(lastSlot - UI_INTRO_FRAMES, Math.floor((pose.t - introSteps) / stepsPerFrame));
    return { slot: slot, totalSteps: introSteps + (pose.slots - UI_INTRO_FRAMES) * stepsPerFrame };
  }

  Player.prototype.updateTransformationPose = function () {
    var pose = this.transformationPose;
    if (!pose) return;
    // death, grabs, knockdowns or tumbles cut the cutscene short
    if (this.hp <= 0 || this.grabbedBy || this.knockedDown || this.knockbackRoll) {
      this.transformationPose = null;
      if (pose.kind === PHASE_TRANSFORM.TO_UI) { this.ssjFuriousLocked = false; ssjStopFuriousAudio(); ssjStopCosmicAudio(); this.ssjFuriousOn = false; }
      return;
    }
    pose.t++;
    if (pose.kind) {
      // phase transformation (toSsj2 / toUi): the art sequence plays once, then the phase lands
      var timeline = phaseTransformTimeline(pose);
      pose.frame = pose.seq ? pose.seq[timeline.slot] : timeline.slot;
      if (pose.t >= timeline.totalSteps) {
        this.transformationPose = null;
        completePhaseTransform(this, pose.kind, pose.landingPhase);
        return;
      }
    } else {
      pose.frame = Math.min(TRANSFORM_POSE_FRAMES - 1, Math.floor(pose.t / TRANSFORM_POSE_STEPS));
      if (pose.t >= TRANSFORM_POSE_STEPS * TRANSFORM_POSE_FRAMES) {
        this.transformationPose = null;
        return;
      }
    }
    // the ritual pins the fighter wherever he stands (or floats)
    this.airVelocityX = 0;
    this.airVelocityY = 0;
    this.jumping = false;
    this.jumpPushTimeLeft = 0;
    this.rolling = false;
    this.rollFrame = 0;
    this.diving = false;
    this.falling = false;
  };

  function activateMatrix(p) {
    if (!p || p.matrix) return;
    p.setMatrix(new MatrixModeState());
  }

  // The typed cheat words share letters with the bindings (J/K/L/;/' are
  // ability keys, M is P2's fire). While the typed tail is still a live
  // PREFIX of one of the cheat words the letters are swallowed: they key the
  // buffer and never reach the bindings, so typing a ritual never fires a
  // stray shot or a stray strike. Any inclusion-breaking letter stops the
  // swallow and the keys flow normally again.
  function cheatPrefixSet(w) {
    var set = Object.create(null);
    for (var n = 1; n <= w.length; n++) set[w.slice(0, n)] = true;
    return set;
  }
  var SSJ_PREFIXES = Object.create(null);
  SSJ_SECRET_SEQUENCES.forEach(function (seq) {
    var prefixes = cheatPrefixSet(seq.word);
    for (var prefix in prefixes) SSJ_PREFIXES[prefix] = true;
  });
  function matchedSsjSequence(buffer) {
    for (var i = 0; i < SSJ_SECRET_SEQUENCES.length; i++) {
      if (buffer === SSJ_SECRET_SEQUENCES[i].word) return SSJ_SECRET_SEQUENCES[i];
    }
    return null;
  }
  var MATRIX_PREFIXES = cheatPrefixSet(MATRIX_SEQUENCE);
  // J and K are ability keys once a shell is live, so the typed word's
  // letters are only swallowed while the Arrow-Key fighter is still plain.
  function ssjWordSwallowable() {
    var t = arrowKeyPlayer();
    return !!t && !t.ssj2 && !t.matrix;
  }

  var CheatCodeManager = {
    buffer: '',
    cooldown: 0,
    blockedHint: 0,
    blockedFor: 0,
    reset: function () {
      this.buffer = '';
    },
    // The input front-end asks before filling the key states: true = the
    // swallowed letter belongs to the typed ritual this step.
    wantsKey: function (code) {
      if (this.cooldown > 0) return false;
      var ch = cheatKeyCodeToChar(code);
      if (!ch) return false;
      var tail = (this.buffer + ch).slice(-CHEAT_TRUNCATE);
      // The FIRST letter of the word ('m') is also P2's fire key: it must reach
      // the input state at keydown (instant aim), so only later letters are swallowed.
      if (MATRIX_PREFIXES[tail] && tail.length > 1) return true;
      return !!SSJ_PREFIXES[tail] && ssjWordSwallowable();
    },
    onKeyDown: function (code) {
      if (this.cooldown <= 0 && cheatKeyCodeToChar(code) === null) {
        // consecutive means consecutive: any letter-less event breaks it
        this.buffer = '';
        return;
      }
      if (this.cooldown > 0) {
        return; // the ritual is recharging; keep ignoring the typing
      }
      var ch = cheatKeyCodeToChar(code);
      if (!ch) return;
      this.buffer = (this.buffer + ch).slice(-CHEAT_TRUNCATE);
      // The SSJ word is the exact 14-letter J/K alternation; 'matrix' is a tail match.
      var sequence = matchedSsjSequence(this.buffer);
      if (sequence) {
        this.buffer = '';
        this.fire('gokussj', sequence.landingPhase);
      } else if (this.buffer.slice(-MATRIX_SEQUENCE.length) === MATRIX_SEQUENCE) {
        this.buffer = '';
        this.fire('matrix');
      }
    },
    fire: function (word, landingPhase) {
      this.cooldown = SSJ2_CHEAT_COOLDOWN;
      var target = arrowKeyPlayer();
      if (!target) return;
      if (!ssjOpenAirAbove(target)) {
        // blocked: visible feedback, nothing happens to the fighter
        this.blockedHint = FPS;
        this.blockedFor = target.id;
        return;
      }
      if (word === 'gokussj') {
        // A live shell is never dropped by the J/K word (they are ability
        // keys now); a Matrix shell steps aside first: one mode at a time.
        if (target.ssj2) return;
        if (target.matrix) target.setMatrix(null);
        activateSsj2(target, landingPhase);
      } else {
        if (target.ssj2) target.setSsj2(null);
        if (target.matrix) target.setMatrix(null); // re-typed word drops the mode
        else activateMatrix(target);
      }
    },
    update: function () {
      if (this.cooldown > 0) this.cooldown--;
      if (this.blockedHint > 0) this.blockedHint--;
    }
  };

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

  // Map data model (map-refactor): layer separation + loader entry point.
  function TileMapLayer(name, tiles) {
    this.name = name;
    this.tiles = tiles || [];
  }
  function MapData(layers) {
    this.layers = layers || {};
    this.platforms = (layers && layers.colliders) ? layers.colliders : [];
  }
  function MapLoader() { this.loaded = false; }
  MapLoader.prototype.load = function (buildFn) {
    var data = (typeof buildFn === 'function') ? buildFn() : null;
    this.loaded = true;
    return data;
  };

  // Police Station (map case 4, GenerateMapPoliceStation, inspected with REA).
  // The source mapArea is (105, -81, 800, 600); map coordinates are in pixels
  // after multiplying Box2D units by 30. CreateGroundBox adds 0.5 px to each
  // full dimension before building both the fixture and its visual box.
  var MAP_AREA = { x: 105, y: -81, width: GAME_WIDTH, height: GAME_HEIGHT };
  var TILE_COLLISION_PADDING = 0.5;
  var GROUND_SUPPORT_TOLERANCE = 1; // retain the engine's existing 1 px support probe
  var ELEVATOR_SQUEEZE_SLIDE = 3; // px/frame sideways escape when the lift pins a rider
  // A head bump needs a real intrusion, not a fraction-of-a-pixel graze: a jump
  // beside the hung glass (whose column shares the pit pillar's x edge) died at
  // ~0.05 px of side overlap and killed the whole vertical velocity.
  var HEAD_BUMP_DEPTH = 1;
  var CORNER_PENETRATION_EPSILON = 0.75; // ignore sub-pixel contact noise at corners
  // A body already overlapping a solid by up to this depth (a graze that got
  // past the axis passes) is still ejected: solids are impassable. Deeper
  // overlaps are spawn/teleport/lift-squeeze cases owned by other systems.
  var SHALLOW_EMBED_EJECT_MAX = 14;
  // Wall recesses (door portals) are 24px tall, shorter than the body: the
  // fighter legitimately overlaps their ceiling/floor, so no ejection there.
  var DOORWAY_APPROACH_MARGIN_X = 24;
  var DOORWAY_RECESS_DEPTH_X = 60; // the recess runs on to the map's right wall
  var STEP_UP_MAX = 16; // stairs: lips up to this tall are walked up without jumping

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
    // SOLID_GLASS_01 blocks the walk (it hangs from the frame) but it never
    // shatters from walking; only the dive tackle crashes through it. It holds
    // no one vertically: nothing lands or bumps into the pane itself.
    this.solidSides = true;
    this.cloud = false;
    this.oneWay = false;
    this.ladder = false;
    this.glass = true;
    this.broken = false;
    // BodyData(box [length x 3] px) * MaterialData glass density 3.
    // Used by the impulse conversions below (kick / bullets / explosion).
    this.mass = 3 * (Math.max(this.w, this.h) / 30) * (3 / 30);
    this.velocity = { x: 0, y: 0 };
  }

  var platforms = [
    new Tile('Ground', 302.5, 413, 369, 70), // the lower-left floor
    new Tile('Ground', 590, 407, 230, 82), // the raised central floor (solid block: no stair assist)
    // The sprite's concrete staircase (map x 705..733, 365.5 -> 383.5) is built as
    // small steps (~3.6 px rises) that the stair assist walks as a smooth slope
    // down to the right floor; the block under them stays solid (covers the pit).
    // The raised central floor's own edge carries no assist (noStep below).
    // (steps are appended after the platforms array is created)
    new Tile('Ground', 818.5, 416, 171, 64), // the right floor
    new Tile('Ground', 886, 372, 36, 24), // the block over the right floor
    new Tile('Ground', 876, 309, 56, 102), // the right wall, middle segment
    new Tile('Ground', 876, 117.5, 56, 233), // the right wall, top segment
    new Tile('Ground', 886, 246, 36, 24), // the right wall, seam block
    new Tile('Ground', 822, 163, 52, 34), // the elevated block, mid-right
    new Tile('Ground', 777, 174, 38, 12), // the ledge by the spawns (600,159)
    new Tile('Ground', 637.5, 174, 171, 12), // long upper ledge (5.7 m in the source)
    new Tile('Ground', 716.5, 200, 13, 40), // the hanging pillar
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
    new Tile('Ground', 662.5, 359.5, 15, 13), // source width is 0.5 m (the bucket: a solid cover, never a step)
    new Tile('Ground', 876, -43.5, 56, 89), // the top-right corner frame (flush with the right wall)
    new Tile('Metal', 230, 317, 58, 4, 'CLOUD')
  ];

  (function () {
    // map x edges / top of each stair step, matching the art's 5 diagonal steps
    var edges = [705, 709.5, 714.5, 719.5, 724.5, 729.5, 733];
    var tops = [365.5, 369, 372.6, 376.2, 379.8, 383.5];
    for (var si = 0; si < tops.length; si++) {
      var sh = 448.5 - tops[si];
      var sw = edges[si + 1] - edges[si];
      platforms.push(new Tile('Ground', (edges[si] + edges[si + 1]) / 2, tops[si] + sh / 2, sw, sh));
    }
  })();
  platforms[1].noStep = true;
  for (var nsi = 0; nsi < platforms.length; nsi++) {
    var nsp = platforms[nsi]; // the bucket on the central floor blocks like a box
    if (nsp.shape === 'rect' && nsp.w === 15.5 && nsp.h === 13.5) nsp.noStep = true;
  } // the raised central floor is a plain solid block, never a stair

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
    { x: 848 - MAP_AREA.x, y: 234 - MAP_AREA.y, w: 20, h: 24, target: 1 }, // upper entrance (extracted PortalData rect 848,234,20,24)
    { x: 848 - MAP_AREA.x, y: 360 - MAP_AREA.y, w: 20, h: 24, target: 0 }  // lower entrance (extracted PortalData rect 848,360,20,24)
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

  // Layered map data (map-refactor): colliders = platforms, props = crates+barrels.
  var mapData = new MapData({
    background: [],
    colliders: platforms,
    props: (typeof crates !== 'undefined' ? crates : []).concat(typeof barrels !== 'undefined' ? barrels : []),
    spawns: { players: playerSpawns, weapons: weaponSpawnPoints }
  });
  var mapLoader = new MapLoader();
  mapLoader.load(function () { return mapData; });

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
    this.w = this.baseW * PLAYER_SIZE_SCALE * PLAYER_BODY_WIDTH_SHARE;
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
    this.gibbed = false; // strong-blast deaths replace the body with viscera
    this.hpDamageTimer = 0; // blocks passive regen after taking a hit
    // PlayerBars/PlayerState (extracted): the bar tracks _barHP, which
    // glides toward hp over the BAR_TRAIL window after every HP change
    this.barHP = 100;         // PlayerState._barHP (the displayed value)
    this.healthBarSpeed = 0;  // PlayerState._healthBarSpeed (per-step glide)
    this.showHealthTimer = BAR_TRAIL_IDLE; // PlayerState._showHealthTimer

    // Sprint state (extracted model)
    this.running = false;
    this.sprinting = false;
    this.walkFrame = 0;
    this.climbFrame = 0; // sprite-only: ladder climb animation clock
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
    this.inCover = false; // crouched with the back flush against a coverable
    this.coverAimFacingApplied = false; // aim-from-cover facing already swung toward the prop
    this.cover = new CoverComponent(this); // reusable cover state machine
    this.rolling = false;
    this.rollFrame = 0;
    // Knockback roll (requested): the tumbling reaction to a violent wall /
    // crate slam; dir is the flip token (velocity sign of the impact).
    // blastRollPending: the explosion roll window (fuse) — a blast launch
    // touching down within it tumbles instead of lying, whatever it hits.
    this.knockbackRoll = false;
    this.knockbackRollFrame = 0;
    this.knockbackRollDir = 0;
    this.knockbackRollAngle = 0; // accumulated doll spin while tumbling (deg)
    this.blastRollPending = 0;
    this.staggering = false;
    this.staggerTimer = 0;

    // Phase 7: dive / tackle (extracted model)
    this.diving = false;
    this.rollCooldown = 0; // steps until the next roll is allowed
    this.rollFromDive = false; // the current roll is a dive landing
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
    this.ranged = { gun: GUNS.pistol, ammo: GUNS.pistol.ammo }; // everyone starts with a common pistol in the inventory
    this.throwable = { ammo: GRENADE.ammo }; // { ammo } — CurrentThrowableWeapon (3 grenades by default)
    // Consumable slot (requested change): a slowmo pickup BANKS here instead of
    // firing immediately; the binding.consume key pops it into the slow cam.
    this.carriedSlowmo = null;
    // Banked medikit / pills: picked up at full HP, consumed later with the
    // same CONSUME key (see Player.prototype.pickConsumableToUse).
    this.carriedHealth = null;
    this.aiming = false;
    this.aimMode = 0; // 0 = firearm, 1 = throwable
    this.aimPitch = 0; // degrees, negative = up
    this.aimPitchSpeed = 0; // CurrentChangePitchSpeed (accelerates ±2 deg/tick² at 24 fps)
    this.aimTurningAround = false;
    this.aimTurningAroundTimer = 0;
    this.throwTimer = 0; // cooked fuse while aiming a grenade
    this.throwPose = 0; // throw release pose clock (steps)
    this.throwAimBlockTimer = 0; // steps left before FIRE can arm the aim again after a throw
    this.throwPoseType = null; // 'grenade' | 'molotov' — picks the release body cell
    this.meleeTrace = null; // slash-trace particle { shape, dir, x, y, clock }
    this.startAimASAP = false; // _startAimASAP
    this.weaponCooldown = 0; // CurrentWeaponCooldown
    this.muzzleFlash = 0;
    this.dryFireKickTimer = 0; // frames left of the empty-trigger flinch
    this.burstQueue = 0; // remaining shots of the rifle/uzi burst
    this.burstTimer = 0;
    this.aimHoldTimer = 0; // BackToIdle: aim stays alive this long after a shot
    this.aimPrepTimer = 0; // steps left of the weapon-raise delay (no firing meanwhile)
    this.aimWasActive = false; // previous step's aiming flag (rising-edge detection)
    this.throwAimWasActive = false; // same edge detector for the grenade / molotov aim
    this.footstepDistance = 0;      // ground distance since the last footstep sound
    this.footstepLastX = x;
    this.flameBurstRemaining = 0; // puffs left in the current flamethrower burst
    this.fireQueuedDuringPrep = false; // trigger released mid-raise: fires when ready
    this.rocketRide = null; // StuckToRocket: { rocket, timer } while riding their misfire

    // Attack state
    this.kickCooldown = 0;
    this.kickFlash = 0;
    this.hitFlash = 0;
    this.healGlowTimer = 0; // steps left of the white heal shimmer (medkit / pills)
    this.fireFlash = 0; // fire tint timer: never switches the sprite (flames draw OVER it)
    this.getHitClock = 0; // sprite-only: steps since the last combat hit (fades with hitFlash/stun)

    // Fire state machine (State pattern): normal / level1 / level2
    this.fireState = FireStates.normal;
    this.fireTimer = 0; // escalation counter driven by the burning states

    // SSJ2 cheat shell ('gokussj'): null while the fighter is plain. The
    // state object (SuperSaiyan2State) enters/exits through setSsj2 below;
    // ki is the ability gauge and the stance flags below are owned by the
    // SSJ2 machine (flight, charge, beam, tele-combo).
    this.ssj2 = null;
    this.ssjKi = 0;
    this.ssjFlying = false;
    this.ssjCharging = false;
    this.ssjBeam = null; // { phase: 'charge'|'fire', timer, dir } while the beam runs
    this.ssjCombo = null; // { victimId, hits, timer, side } Instant Transmission Strike
    this.ssjTeleCooldown = 0;
    this.ssjComboCooldown = 0;
    this.ssjBeamCooldown = 0;
    this.ssjRechargeAudioOn = false;
    // Phase ladder (SSJ -> SSJ2 -> UI) and the per-phase stances
    this.ssjPhase = SSJ_PHASE_SSJ;
    this.ssjHold = 0;              // steps the Ki recharge has been held at full Ki
    this.ssjFuriousOn = false;     // gokurecargafuriosa.mp3 running for this hold
    this.ssjFuriousLocked = false; // past 5 s: the audio plays out even when released
    this.ssjMelee = null;          // SSJ2 J: { t, frame, lastHitFrame }
    this.ssjUiTele = null;         // UI teleport strike: { origin, t, frame }
    this.ssjRays = null;           // UI J: { left, timer } light-beam burst
    this.ssjMeleeCooldown = 0;
    this.ssjOrbCooldown = 0;
    this.ssjRaysCooldown = 0;
    this.ssjUiTeleCooldown = 0;
    this.ssjUiAge = 0;             // steps since Ultra Instinct landed (glow + 60 s limit)

    // Matrix (The One) cheat shell ('matrix'): null while the fighter is
    // plain. The shell owns five abilities (bullet time / dodge / wall run /
    // code reload / glitch teleport) plus the cool-downs and stances here.
    this.matrix = null;
    this.matrixTimer = 0;          // transformation age (steps)
    this.matrixBtHeld = false;     // J held: bullet-time request
    this.matrixBtOn = false;       // bullet time currently engaged
    this.matrixBtCap = 0;          // continuous hold counter
    this.matrixBtCooldown = 0;     // steps until J may re-engage
    this.matrixDodgeTimer = 0;     // dodge grace window (bullet shield)
    this.matrixDodgeCooldown = 0;  // steps until K may dodge again
    this.matrixWallRunning = false;
    this.matrixWallSide = 0;       // +1: wall at the fighter's right, -1: left
    this.matrixWallFuel = MATRIX_WALL_FUEL_MAX;
    this.matrixWallCooldown = 0;
    this.matrixReloadCooldown = 0;
    this.matrixTeleCooldown = 0;
    this.matrixGlitchTimer = 0;    // sprite glitch-shard clock after a warp
    this.matrixHopTimer = 0;       // hop-momentum grace (dodge arc / wall kick)
    // Transformation cutscene (mods 5000-5003): { frame, t } while the
    // gokussj ritual flexes through the four user art poses.
    this.transformationPose = null;
  }

  // ---------- Fire state machine (State pattern) ----------
  // Superfighters-style afterburn, with the shipped build's numbers:
  // the burn meter climbs +1/tick on the attached fire node (24 fps) and
  // FireRank1DaemonDamage drains HP while burning:
  //   FireRank1Damage = 0.2/tick -> 0.08/step (4.8 HP/s)
  //   FireRank2Damage = 0.4/tick -> 0.16/step (9.6 HP/s)
  // Rank 1 attaches from BurnState >= FireRank1Minimum (15); rank 2 from
  // FireRank2Minimum (100). The climb 15 -> 100 on the node feed alone takes
  // 85 ticks = 3.54 s, so a level-1 burn escalates to level 2 in ~3.5 s when
  // the fighter does not roll (Roll -> DecreaseBurnState, the extracted -50
  // meter drop). Flames set the fighter burning at level 1; rolling on the
  // floor while level 1 extinguishes, while level 2 cools to level 1 and a
  // second roll goes out. The player delegates to the current state object.
  var FIRE_L1_DAMAGE = 0.08;   // 0.2 HP per 24 fps tick, converted to a 60 Hz step
  var FIRE_L2_DAMAGE = 0.32;   // doubled (was 0.16): level 2 drains twice the HP per step
  var FIRE_RANK1_MIN = 15;     // FireRank1Minimum: BurnState that lights level 1
  var FIRE_RANK2_MIN = 100;    // FireRank2Minimum: BurnState that lights level 2
  var FIRE_POOL_ESCALATE_STEPS = 2 * 60; // standing 2 s in a fire pool lights level 2
  var FIRE_POOL_L1_ACCEL = 3;            // already at level 1: the level-1 clock runs 4x (1 + 3) in a pool
  var FIRE_L1_ESCALATE = 212;  // steps burning at level 1 before escalating (85 ticks at 24 fps = 3.54 s)
  var FireStates = {
    normal: {
      name: 'NONE',
      enter: function (p) { p.fireTimer = 0; p.burnMeter = 0; },
      update: function () {},
      ignite: function (p) { p.setFireState(FireStates.level1); },
      roll: function () {}
    },
    level1: {
      name: 'FIRE_LEVEL_1',
      enter: function (p) {
        p.fireTimer = 0;
        p.burnMeter = Math.min(Math.max(p.burnMeter || 0, FIRE_RANK1_MIN), FIRE_RANK2_MIN - 1);
      },
      update: function (p) {
        if (p.hp <= 0) { p.setFireState(FireStates.normal); return; }
        p.setHp(p.hp - FIRE_L1_DAMAGE * p.moveSpeed()); // burns, not so much (setter blocks regen while burning)
        p.fireFlash = Math.max(p.fireFlash, 2); // tint only: never the GetHit sprite
        p.fireTimer += p.moveSpeed();
        if (p.fireTimer >= FIRE_L1_ESCALATE) p.setFireState(FireStates.level2); // it heats up
      },
      ignite: function () {}, // already burning (no re-ignite at a lower level)
      roll: function (p) { p.setFireState(FireStates.normal); } // roll goes out
    },
    level2: {
      name: 'FIRE_LEVEL_2',
      enter: function (p) { p.fireTimer = 0; p.burnMeter = Math.max(p.burnMeter || 0, FIRE_RANK2_MIN); },
      update: function (p) {
        if (p.hp <= 0) { p.setFireState(FireStates.normal); return; }
        p.setHp(p.hp - FIRE_L2_DAMAGE * p.moveSpeed()); // drains much more HP
        p.fireFlash = Math.max(p.fireFlash, 3);
      },
      ignite: function () {},
      roll: function (p) { p.setFireState(FireStates.level1); p.burnMeter = 50; } // one roll cools to L1 (DecreaseBurnState: meter -> 50)
    }
  };

  Player.prototype.setFireState = function (s) {
    // Ultra Instinct is fireproof: no flame level can ever be entered
    if (s !== FireStates.normal && isUltraInstinct(this)) s = FireStates.normal;
    this.fireState = s;
    if (s && s.enter) s.enter(this);
  };
  // Any flame contact (flamethrower puff, molotov fire pool) ignites: the
  // burning starts at level 1 and the escalation clock starts running
  Player.prototype.igniteFire = function () {
    if (this.fireState) this.fireState.ignite(this);
  };
  // Burn meter feed (extracted State.BurnState +=): a flamethrower puff adds
  // 20 per contact, a shattering molotov sets 100. >= 15 lights level 1 and
  // >= 100 jumps straight to level 2.
  Player.prototype.addBurn = function (amount) {
    if (!this.fireState) return;
    this.burnMeter = (this.burnMeter || 0) + amount;
    if (this.burnMeter >= FIRE_RANK2_MIN) {
      if (this.fireState !== FireStates.level2) this.setFireState(FireStates.level2);
    } else if (this.burnMeter >= FIRE_RANK1_MIN && this.fireState === FireStates.normal) {
      this.setFireState(FireStates.level1);
    }
  };
  // The roll input feeds the machine (rollwhile standing on the floor)
  Player.prototype.notifyRoll = function () {
    playSfx(SFX.ROLL);
    if (this.fireState && this.fireState.roll) this.fireState.roll(this);
  };
  Player.prototype.updateFire = function () {
    if (this.fireState && this.fireState.update) this.fireState.update(this);
  };

  // ==================================================================
  // SSJ2 STATE ( State pattern, wired like the fire machine above )
  //
  // The 'gokussj' cheat swaps the Arrow-Key fighter into this state shell.
  // It is deliberately a CLASS (requested architect name), not a decorator:
  // enter/exit own the transformation flash and the stance cleanup, and
  // update() owns the steady-state resources (passive Ki + aura particles).
  // The abilities (fly/charge/beam/tele-combo) live on the Player as SSJ2
  // hooks below, driven from Player.update while this state is active.
  // ==================================================================
  function SuperSaiyan2State() {}

  SuperSaiyan2State.prototype.name = 'SSJ2';

  SuperSaiyan2State.prototype.enter = function (p) {
    p.ssjTimer = 0;
    p.ssjPhase = SSJ_PHASE_SSJ; // every activation starts as plain Super Saiyan
    p.ssjUiAge = 0;
    p.ssjHold = 0;
    p.ssjFuriousOn = false;
    p.ssjFuriousLocked = false;
    p.ssjMelee = null;
    p.ssjUiTele = null;
    p.ssjRays = null;
    p.ssjFlying = false; // flight only starts when the player asks for it (L)
    p.ssjCharging = false;
    p.ssjBeam = null;
    p.ssjCombo = null;
    // the burst is spawned by activateSsj2 (it must happen even if the
    // state object were swapped directly in tests)
    spawnSsjTransformBurst(p);
  };

  SuperSaiyan2State.prototype.exit = function (p) {
    p.ssjPhase = SSJ_PHASE_SSJ;
    p.ssjHold = 0;
    p.ssjMelee = null;
    p.ssjUiTele = null;
    p.ssjRays = null;
    p.ssjFlying = false;
    p.ssjCharging = false;
    p.ssjBeam = null;
    p.ssjCombo = null;
  };

  SuperSaiyan2State.prototype.update = function (p) {
    p.ssjTimer++;
    // steady-state resource trickle so the gauge never hard-locks at zero
    if (p.ssjKi < SSJ2_KI_MAX && p.hp > 0) {
      p.ssjKi = Math.min(SSJ2_KI_MAX, p.ssjKi + (p.ssjPhase === SSJ_PHASE_UI ? UI_KI_PASSIVE : SSJ2_KI_PASSIVE) * gameSpeed);
    }
  };

  Player.prototype.setSsj2 = function (state) {
    if (this.ssj2 && this.ssj2.exit) this.ssj2.exit(this);
    this.ssj2 = state || null;
    if (this.ssj2 && this.ssj2.enter) this.ssj2.enter(this);
  };

  // Any SSJ2 stance pins the fighter in place (charge posture, beam
  // gathering/firing, the tele-combo spirit sequence): movement input is
  // ignored while one is running.
  Player.prototype.ssjMoveLocked = function () {
    return !!this.ssj2 && (!!this.ssjCharging || !!this.ssjBeam || !!this.ssjCombo ||
      !!this.ssjMelee || !!this.ssjUiTele);
  };

  // A grounded melee combo (fists or weapon) roots the fighter: no walking, no
  // turning and no run momentum while the swing lasts. The only displacement is
  // the inertia of the final link's lunge (applied directly to x in the punch
  // update). Airborne swings keep their air control.
  Player.prototype.meleeMoveLocked = function () {
    return this.punching && this.onGround;
  };

  // Ability stances also cancel gravity: the SSJ2 fighter station-keeps
  // while gathering energy or striking through teleport hops.
  Player.prototype.ssjAirStance = function () {
    return this.ssjFlying || this.ssjCharging || !!this.ssjBeam || !!this.ssjCombo ||
      !!this.ssjMelee || !!this.ssjUiTele;
  };

  // Attribute getter used by the movement + combat code paths.
  Player.prototype.ssjSpeedMult = function () {
    return this.ssj2 ? (SSJ_PHASE_SPEED[this.ssjPhase] || SSJ2_RUN_SPEED_MULT) : 1;
  };
  // SSJ (phase 1) cannot run (sprint) or roll/dive
  Player.prototype.ssjNoRun = function () {
    // UI also: only walking and flying, no run / roll / drop to the floor
    return !!this.ssj2 && (this.ssjPhase === SSJ_PHASE_SSJ || this.ssjPhase === SSJ_PHASE_UI);
  };
  Player.prototype.ssjMeleeMult = function () {
    return this.ssj2 ? SSJ2_MELEE_DAMAGE_MULT : 1;
  };
  Player.prototype.ssjJumpMult = function () {
    return this.ssj2 ? SSJ2_JUMP_BOOST : 1;
  };

  // ---------- SSJ2 world field (particles, rings, beams) ----------
  // Cosmetic only: everything here is skipped when paused (the arrays are
  // touched from updateStep, never from render).
  var ssjParticles = [];
  var ssjRings = [];
  var ssjBeams = [];

  function spawnSsjParticle(x, y, vx, vy, life, size, color) {
    if (ssjParticles.length >= SSJ_PARTICLE_CAP) ssjParticles.shift();
    ssjParticles.push({
      x: x, y: y, vx: vx, vy: vy,
      life: life, maxLife: life, size: size, color: color
    });
  }

  function spawnSsjRing(x, y, color, life, grow) {
    if (ssjRings.length >= SSJ_RING_CAP) ssjRings.shift();
    ssjRings.push({ x: x, y: y, r: SSJ_RING_START_RADIUS, life: life, maxLife: life, color: color, grow: grow || SSJ_RING_DEFAULT_GROW });
  }

  function spawnSsjParticleBurst(x, y, color, n, speed) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = (0.6 + Math.random()) * (speed || 2.4);
      spawnSsjParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, 14 + Math.random() * 10, 1.5 + Math.random() * 2, color);
    }
  }

  // Transformation/teleport flash in screen-space handles (world coords).
  function spawnSsjTransformBurst(p) {
    var cx = p.x + p.w / 2;
    var cy = p.y + p.h / 2;
    spawnSsjRing(cx, cy, '150,225,255', 20, 2.6);
    spawnSsjRing(cx, cy, '255,255,255', 12, 3.4);
    spawnSsjParticleBurst(cx, cy, '#8fd8ff', 22, 3.2);
    spawnSsjParticleBurst(cx, cy, '#e6faff', 10, 2.2);
  }

  function spawnSsjTeleportFx(p) {
    var cx = p.x + p.w / 2;
    var cy = p.y + p.h / 2;
    spawnSsjRing(cx, cy, '180,225,255', 13, 2.2);
    spawnSsjParticleBurst(cx, cy, '#bfe3ff', 10, 2.6);
  }

  // Aura particle spawner: runs on the update side (deterministic with the
  // paused gate) instead of leaking spawns into the renderer.
  Player.prototype.updateSsjAuraSpawn = function () {
    if (this.hp <= 0 || !this.ssj2) return;
    var cx = this.x + this.w / 2;
    var feet = this.y + this.h;
    var rate = this.ssjCharging ? SSJ_AURA_RATE_CHARGING : SSJ_AURA_RATE_IDLE;
    if (Math.random() < rate) {
      spawnSsjParticle(
        cx + (Math.random() * 2 - 1) * this.w * 0.9,
        feet - Math.random() * this.h * 0.9,
        (Math.random() * 2 - 1) * 0.5,
        -(1.1 + Math.random() * 1.5),
        SSJ2_PARTICLE_LIFE,
        1.2 + Math.random() * 1.6,
        Math.random() < 0.7 ? '#7fdcff' : '#dff6ff'
      );
    }
    if (this.ssjFlying && Math.random() < SSJ_FLIGHT_TRAIL_CHANCE) {
      // engine trail streaks while flying
      spawnSsjParticle(
        cx + (Math.random() * 2 - 1) * this.w * 0.6,
        this.y + this.h,
        0, 0.8 + Math.random(),
        10, 1 + Math.random() * 1.2,
        '#9fd8ff'
      );
    }
    if (this.ssjCharging && Math.random() < SSJ_CHARGE_RING_CHANCE) {
      spawnSsjRing(cx, feet, '140,220,255', 15, 1.3);
    }
  };

  // ---------- SSJ2 ability: free Instant Transmission (') ----------
  // Teleports a short hop toward the facing; when the rival is close the
  // warp snaps level to THEM instead. Blocked spots fall back to shorter
  // fractions of the hop, and to the original position (no move) last.
  function ssjSpotBlocked(box) {
    if (box.x < 4 || box.y < -110 || box.x + box.w > GAME_WIDTH - 4) return true;
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (platformIsOneWay(plat) || plat.ladder) continue;
      if (rectsOverlap(box, plat)) return true;
    }
    for (i = 0; i < crates.length; i++) {
      if (!crates[i].dead && rectsOverlap(box, crates[i])) return true;
    }
    return false;
  }

  function ssjTeleportTo(p, tx, ty) {
    var sx = p.x;
    var sy = p.y;
    var fractions = [1, 0.66, 0.33, 0];
    for (var i = 0; i < fractions.length; i++) {
      var f = fractions[i];
      var nx = sx + (tx - sx) * f;
      var ny = sy + (ty - sy) * f;
      if (!ssjSpotBlocked({ x: nx, y: ny, w: p.w, h: p.h })) {
        p.x = nx;
        p.y = ny;
        p.airVelocityX = 0;
        p.airVelocityY = 0;
        p.jumping = false;
        p.jumpPushTimeLeft = 0;
        // the landing state resolves on the very next physics pass
        p.onGround = false;
        p.groundedPlatform = null;
        spawnSsjTeleportFx(p);
        return true;
      }
    }
    return false;
  }

  function ssjInstantTransmission(p, enemy) {
    spawnSsjTeleportFx(p); // vanish flash at the leaving spot
    if (enemy && enemy.hp > 0) {
      var ex = enemy.x + enemy.w / 2;
      var sx = p.x + p.w / 2;
      if (Math.abs(ex - sx) <= SSJ2_TELEPORT_ENEMY_SEEK) {
        // snap level to the enemy, one body short on THEIR near side
        var tx = ex > sx ? enemy.x - p.w - 5 : enemy.x + enemy.w + 5;
        if (ssjTeleportTo(p, tx, enemy.y)) {
          p.lastDirX = ex > sx ? 1 : -1; // face the arrival target
          spawnSsjRing(p.x + p.w / 2, p.y + p.h / 2, '185,235,255', 12, 2.4);
          return;
        }
      }
    }
    var tx2 = p.x + p.lastDirX * SSJ2_TELEPORT_DISTANCE;
    ssjTeleportTo(p, tx2, p.y);
  }

  // ---------- SSJ2 ability: Instant Transmission Strike (J) ----------
  // Teleports beside the nearest target and lands a rapid chase combo: each
  // blow re-teleports to the OTHER side of the victim before connecting.
  function runSsjTeleComboTick(p, victim) {
    var combo = p.ssjCombo;
    // Dragon-Ball vanish window: the striker stays invisible for TELEPORT_VANISH
    // steps after each hop, then reappears beside the victim and connects
    if (combo.vanish > 0) {
      combo.vanish--;
      // stay pinned beside the victim while invisible (Dragon-Ball vanish)
      p.x = Math.max(4, Math.min(GAME_WIDTH - 4 - p.w, p.x));
      p.y = victim.y;
      p.airVelocityX = 0;
      p.airVelocityY = 0;
      p.onGround = false;
      p.groundedPlatform = null;
      if (combo.vanish === 0) {
        // reappear + land the blow
        if (victim.hp > 0) {
          victim.damage(SSJ2_COMBO_HIT_DAMAGE);
          victim.hitFlash = 6;
          victim.getHitClock = 0;
          victim.lastDirX = -p.lastDirX; // the victim faces the striker
          victim.stunTimer = Math.max(victim.stunTimer, 6); // chained reaction
          spawnSsjParticleBurst(victim.x + victim.w / 2, victim.y + victim.h / 2, '#ffe97a', 6, 3);
        }
        combo.hits--;
        if (combo.hits <= 0) {
          // finisher: the same extracted ragdoll launch as the punch combo end
          if (victim.hp > 0) {
            victim.airVelocityX = p.lastDirX * SSJ2_COMBO_LAUNCH_X;
            victim.airVelocityY = SSJ2_COMBO_LAUNCH_Y;
            victim.falling = true;
            victim.onGround = false;
            victim.groundedPlatform = null;
            victim.jumping = false;
            victim.knockedDown = false;
            victim.knockbackRoll = false;
          }
          p.ssjCombo = null;
          p.ssjComboCooldown = SSJ2_COMBO_COOLDOWN;
        }
      }
    }
    // teleport trigger (runs in parallel with the vanish countdown)
    combo.timer++;
    if (combo.vanish > 0) return; // still vanished: no new hop yet
    if (combo.timer < SSJ2_COMBO_STEPS_PER_HIT) return;
    combo.timer = 0;
    combo.side = -combo.side;
    var side = combo.side > 0 ? 1 : -1;
    var px = side > 0 ? victim.x + victim.w + 3 : victim.x - p.w - 3;
    px = Math.max(4, Math.min(GAME_WIDTH - 4 - p.w, px));
    // vanish flash at the leaving spot
    spawnSsjTeleportFx(p);
    p.x = px;
    p.y = victim.y;
    p.lastDirX = side > 0 ? -1 : 1; // face the victim
    p.airVelocityX = 0;
    p.airVelocityY = 0;
    p.onGround = false;
    p.groundedPlatform = null;
    spawnSsjTeleportFx(p); // reappear flash at the destination
    combo.vanish = SSJ2_TELEPORT_VANISH; // invisible window before the blow
  }

  // ---------- SSJ2 ability: Kamehameha (K) ----------
  // Hold K: the orb grows linearly while kame_charge.mp3 plays. Releasing K
  // before the file ends fires the beam (size/damage ∝ the charge held);
  // holding through the file's own end reabsorbs the energy with a collapse
  // animation (no beam, no wave audio). The beam crosses the whole screen
  // and chews through fighters / crates / glass in its band.
  // Fired on the K RELEASE (never by holding through the whole charge audio).
  // `charge` (0..1) is the fraction of the charge audio that had already run:
  // it scales the beam's height, damage and knockback lineally.
  function fireSsjBeam(p, charge) {
    var scale = Math.max(0, Math.min(1, charge == null ? 1 : charge));
    ssjStopKameChargeAudio();
    ssjPlayKameWave();
    var dir = p.lastDirX || 1;
    var muzzleY = p.y + p.h * 0.42;
    ssjBeams.push({
      owner: p.id,
      dir: dir,
      x: dir > 0 ? p.x + p.w + 2 : p.x - 2,
      y: muzzleY,
      life: SSJ2_BEAM_FIRE_STEPS,
      grow: 0,
      scale: scale, // proportional size/damage of the volley
      size: SSJ_BEAM_SIZE[p.ssjPhase] || 1 // small SSJ vs large SSJ2 Kamehameha
    });
    spawnSsjParticleBurst(
      dir > 0 ? p.x + p.w + 6 : p.x - 6, muzzleY,
      '#bfe9ff', 14, 3.4
    );
    spawnSsjRing(p.x + p.w / 2, muzzleY, '160,220,255', 16, 3);
  }

  // kame_charge.mp3 is the charge clock: the file's metadata converts its
  // length into steps; the fallback covers sandboxes and failed audio loads.
  function ssjKameChargeCapSteps() {
    var a = modAudio.kameCharge;
    if (a && typeof a.duration === 'number' && isFinite(a.duration) && a.duration > 0) {
      return Math.max(2, Math.round(a.duration * FPS));
    }
    return SSJ2_BEAM_CHARGE_FALLBACK_STEPS;
  }

  // The charge audio ran out while K was still held: the gathered energy is
  // reabsorbed — the orb collapses back into the fighter, NO beam fires and
  // NO kameha-wave.mp3 plays. When the collapse ends the stance returns to
  // Idle/Ready under the volley cooldown window.
  function ssjReabsorbKame(p) {
    var b = p && p.ssjBeam;
    if (!b || b.phase !== 'charge') return;
    b.charge = Math.min(1, b.timer / (b.chargeCap || SSJ2_BEAM_CHARGE_FALLBACK_STEPS));
    b.phase = 'reabsorb';
    b.timer = 0;
    ssjStopKameChargeAudio();
    spawnSsjParticleBurst(p.x + p.w / 2, p.y + p.h * 0.42, '#9fd8ff', 6, 1.8);
  }

  function runSsjBeamTick(p) {
    var beamState = p.ssjBeam;
    beamState.timer++;
    // the gathering stance pins the fighter wherever they stand
    p.airVelocityX = 0;
    p.airVelocityY = 0;
    if (beamState.phase === 'reabsorb') {
      // the un-launched charge collapses back into the fighter
      if (beamState.timer >= SSJ2_KAME_REABSORB_STEPS) {
        p.ssjBeam = null;
        p.ssjBeamCooldown = SSJ2_BEAM_COOLDOWN;
      }
      return; // no gather sparks while the orb shrinks
    }
    if (Math.random() < 0.4) {
      spawnSsjParticle(
        p.x + p.w / 2 + beamState.dir * 9 + (Math.random() * 6 - 3),
        p.y + p.h * 0.42 + (Math.random() * 6 - 3),
        0, -(0.4 + Math.random() * 0.7),
        10, 1.2 + Math.random(),
        Math.random() < 0.5 ? '#bfe9ff' : '#ffffff'
      );
    }
    if (beamState.phase === 'charge') {
      // K released BEFORE the charge audio ended: fire whatever was gathered
      // (smaller/less damage than a long hold, exactly proportional)
      if (!keys[p.binding.ssjBeam]) {
        var charge = Math.min(1, beamState.timer / (beamState.chargeCap || SSJ2_BEAM_CHARGE_FALLBACK_STEPS));
        beamState.phase = 'fire';
        beamState.timer = 0;
        fireSsjBeam(p, charge);
        return;
      }
      // K held up to the end of the charge audio: reabsorb, never fire
      if (beamState.timer >= beamState.chargeCap) ssjReabsorbKame(p);
      return;
    }
    // firing: damage runs through the beam entity pulses in updateSsj2World
    if (beamState.timer >= SSJ2_BEAM_FIRE_STEPS) {
      p.ssjBeam = null;
      p.ssjBeamCooldown = SSJ2_BEAM_COOLDOWN;
    }
  }

  function ssjBeamPulseDamage(beam) {
    // the volley scales with its charge: height, damage and pushback all
    // read the fraction the orb had reached when K was released
    var scale = (typeof beam.scale === 'number')
      ? Math.max(0.1, Math.min(1, beam.scale)) : 1;
    var sizeMult = (typeof beam.size === 'number') ? beam.size : 1;
    var bandH = SSJ2_BEAM_HEIGHT * scale * sizeMult;
    var band = {
      x: beam.dir > 0 ? beam.x : 0,
      y: beam.y - bandH / 2,
      w: beam.dir > 0 ? GAME_WIDTH - beam.x : Math.max(0, beam.x),
      h: bandH
    };
    var targets = [player1, player2];
    for (var t = 0; t < targets.length; t++) {
      var p = targets[t];
      if (p.id === beam.owner) continue;
      if (p.hp <= 0) continue;
      if (!rectsOverlap(band, p.getBounds())) continue;
      p.damage(Math.max(1, Math.round(SSJ2_BEAM_DAMAGE_PULSE * scale * sizeMult)));
      p.hitFlash = 6;
      p.getHitClock = 0;
      p.airVelocityX = beam.dir * SSJ2_BEAM_KNOCKBACK * scale;
      p.airVelocityY = -2.5 * VEL_SCALE;
      p.falling = true;
      p.onGround = false;
      p.groundedPlatform = null;
      p.jumping = false;
      p.knockedDown = false;
      p.knockbackRoll = false;
      if (p.aiming) p.abortAiming(true);
      spawnSsjParticleBurst(p.x + p.w / 2, p.y + p.h / 2, '#bfe9ff', 8, 3);
    }
    for (var ci = 0; ci < crates.length; ci++) {
      var c = crates[ci];
      if (c.dead) continue;
      if (!rectsOverlap(band, c)) continue;
      damageCrate(c, Math.max(1, Math.round(SSJ2_BEAM_CRATE_PULSE * scale)), beam.dir * 7, -3);
    }
    for (var pi = 0; pi < platforms.length; pi++) {
      var plat = platforms[pi];
      if (!plat.glass) continue;
      if (rectsOverlap(band, plat)) {
        breakGlassPane(plat, beam.dir * 2.5 * scale, 0);
      }
    }
  }

  // ---------- per-step SSJ2 service (runs from updateStep) ----------
  function updateSsj2World() {
    CheatCodeManager.update();
    updateUiOrbs();
    updateUiRays();
    // particles
    for (var i = ssjParticles.length - 1; i >= 0; i--) {
      var q = ssjParticles[i];
      q.x += q.vx * gameSpeed;
      q.y += q.vy * gameSpeed;
      q.vy += 0.02 * gameSpeed; // sparks feather downward slightly
      q.vx *= 0.98;
      q.life--;
      if (q.life <= 0) ssjParticles.splice(i, 1);
    }
    for (i = ssjRings.length - 1; i >= 0; i--) {
      var ring = ssjRings[i];
      ring.r += ring.grow * gameSpeed;
      ring.life--;
      if (ring.life <= 0) ssjRings.splice(i, 1);
    }
    // beams tick their damage pulses independently of the firing stance
    for (i = ssjBeams.length - 1; i >= 0; i--) {
      var beam = ssjBeams[i];
      beam.life--;
      beam.grow = Math.min(1, beam.grow + 0.3 * gameSpeed);
      if (beam.life <= 0) {
        ssjBeams.splice(i, 1);
        continue;
      }
      if (beam.life % SSJ2_BEAM_PULSE_STEPS === 0) ssjBeamPulseDamage(beam);
    }
  }

  // ---------- phase helpers (SSJ -> SSJ2 -> UI) ----------
  function ssjSetupAudio(key, src) { return ssjPlayAudio(key, src); }

  function ssjStartFuriousAudio() {
    ssjCancelFuriousFade();
    var a = ssjSetupAudio('furious', SSJ2_FURIOUS_AUDIO_SRC);
    if (!a) return;
    try {
      a.loop = false;
      a.volume = SSJ2_FURIOUS_VOLUME;
    } catch (e) {}
    restartAudio(a); // starts the instant full Ki is held
  }

  var ssjFuriousFadeTimer = null;
  var SSJ2_FURIOUS_FADE_MS = 1800; // gradual fade-out once Ultra Instinct lands

  function ssjCancelFuriousFade() {
    if (ssjFuriousFadeTimer !== null && typeof clearInterval !== 'undefined') { clearInterval(ssjFuriousFadeTimer); ssjFuriousFadeTimer = null; }
  }

  function ssjStopFuriousAudio() {
    ssjCancelFuriousFade();
    if (typeof Audio === 'undefined') return;
    stopAudio(modAudio.furious);
  }

  // Smooth volume ramp to silence (no hard cut), then the track is stopped.
  function ssjFadeOutFuriousAudio(durationMs) {
    ssjCancelFuriousFade();
    if (typeof Audio === 'undefined') return;
    var a = modAudio.furious;
    if (!a || a.paused || typeof setInterval === 'undefined') return;
    var total = durationMs || SSJ2_FURIOUS_FADE_MS;
    var tick = 50;
    var startVol = a.volume;
    var elapsed = 0;
    ssjFuriousFadeTimer = setInterval(function () {
      elapsed += tick;
      var k = Math.min(1, elapsed / total);
      try { a.volume = Math.max(0, startVol * (1 - k)); } catch (e) {}
      if (k >= 1) {
        ssjCancelFuriousFade();
        try { a.pause(); a.currentTime = 0; a.volume = SSJ2_FURIOUS_VOLUME; } catch (e) {}
      }
    }, tick);
  }

  function ssjPlayUiTheme() {
    var a = ssjSetupAudio('uiTheme', UI_THEME_AUDIO_SRC);
    if (!a) return;
    try { a.loop = false; } catch (e) {}
    restartAudio(a);
  }

  function ssjStopUiTheme() {
    if (typeof Audio === 'undefined') return;
    stopAudio(modAudio.uiTheme);
  }

  function ssjPlayOnce(key, src) {
    var a = ssjPlayAudio(key, src);
    if (!a) return;
    restartAudio(a);
  }

  // A phase transformation (SSJ -> SSJ2, SSJ2 -> UI) reuses the cutscene
  // pose slot: the fighter is pinned while the art sequence plays, then the
  // new phase lands (completePhaseTransform).
  function startPhaseTransform(p, kind) {
    if (!p || p.hp <= 0 || p.transformationPose) return;
    var set = kind === PHASE_TRANSFORM.TO_SSJ2 ? PHASE_TRANSFORM.TO_SSJ2 : PHASE_TRANSFORM.TO_UI;
    p.transformationPose = {
      kind: kind, set: set, frame: 0, t: 0,
      frames: MOD_SPRITE_DEFS[set].length
    };
    p.transformationPose.seq = kind === PHASE_TRANSFORM.TO_UI ? UI_TRANSFORM_SEQUENCE : null;
    p.transformationPose.slots = p.transformationPose.seq ? p.transformationPose.seq.length : p.transformationPose.frames;
    p.ssjHold = 0;
    p.ssjCharging = false;
    p.ssjBeam = null;
    p.ssjMelee = null;
    if (p.aiming) p.abortAiming(false);
    p.rolling = false;
    p.diving = false;
    if (p.ssjRechargeAudioOn) { p.ssjRechargeAudioOn = false; ssjStopRechargeAudio(); }
    if (kind === PHASE_TRANSFORM.TO_SSJ2) startTransformationAudio();
    // past the 5 s of Ki hold: the cosmic roar layers OVER the recharge audio
    if (kind === PHASE_TRANSFORM.TO_UI) ssjStartCosmicAudio();
    spawnSsjTransformBurst(p);
  }

  function ssjStartCosmicAudio() {
    var a = ssjPlayAudio('cosmic', UI_COSMIC_AUDIO_SRC);
    if (!a) return;
    var playIt = function () {
      uiCosmicAudioTimer = null;
      try { a.loop = false; } catch (e) {}
      restartAudio(a);
    };
    if (typeof setTimeout !== 'function') { playIt(); return; }
    if (uiCosmicAudioTimer) clearTimeout(uiCosmicAudioTimer);
    uiCosmicAudioTimer = setTimeout(playIt, UI_COSMIC_AUDIO_DELAY_MS);
  }

  function ssjStopCosmicAudio() {
    if (uiCosmicAudioTimer && typeof clearTimeout === 'function') { clearTimeout(uiCosmicAudioTimer); uiCosmicAudioTimer = null; }
    if (typeof Audio === 'undefined') return;
    stopAudio(modAudio.cosmic);
  }

  // The cosmic blast on landing UI: no damage, a huge shockwave that throws
  // every prop and the rival (the caster is immune).
  function cosmicShockwave(p) {
    var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    // Radial repulsion: whatever stands anywhere on the stage is thrown along
    // the line from the caster's centre through its own centre (strictly away
    // from him, 360 degrees). Strength fades with distance but never to zero.
    function repulsion(o, w, h) {
      var dx = o.x + w / 2 - cx, dy = o.y + h / 2 - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return { ux: 0, uy: -1, force: 1 }; // dead centre: straight up
      return {
        ux: dx / dist,
        uy: dy / dist,
        force: Math.max(UI_COSMIC_MIN_FORCE, 1 - dist / UI_COSMIC_RADIUS * 0.7)
      };
    }
    for (var ci = 0; ci < crates.length; ci++) {
      var c = crates[ci];
      if (c.dead) continue;
      var r = repulsion(c, c.w, c.h);
      c.vx += r.ux * UI_COSMIC_PUSH * UI_COSMIC_PROP_SPEED * r.force;
      c.vy += r.uy * UI_COSMIC_PUSH * UI_COSMIC_PROP_SPEED * r.force;
      c.spin += (r.ux >= 0 ? 1 : -1) * 0.5 * r.force;
      c.resting = false;
    }
    for (var bi = 0; bi < barrels.length; bi++) {
      var b = barrels[bi];
      if (b.dead) continue;
      var rb = repulsion(b, b.w, b.h);
      b.vx += rb.ux * UI_COSMIC_PUSH * UI_COSMIC_PROP_SPEED * rb.force;
      b.vy += rb.uy * UI_COSMIC_PUSH * UI_COSMIC_PROP_SPEED * rb.force;
      b.spin += (rb.ux >= 0 ? 1 : -1) * 0.4 * rb.force;
      b.resting = false;
    }
    for (var wi = 0; wi < weaponItems.length; wi++) {
      var w = weaponItems[wi];
      if (w.taken) continue;
      var rw = repulsion(w, 0, 0);
      w.vx = (w.vx || 0) + rw.ux * UI_COSMIC_ITEM_SPEED;
      w.vy = (w.vy || 0) + rw.uy * UI_COSMIC_ITEM_SPEED;
    }
    var fighters = [player1, player2];
    for (var fi = 0; fi < fighters.length; fi++) {
      var q = fighters[fi];
      if (q.hp <= 0 || q === p) continue; // the caster holds firm inside his own blast
      var rf = repulsion(q, q.w, q.h);
      q.airVelocityX = rf.ux * UI_COSMIC_PUSH * UI_COSMIC_FIGHTER_SPEED * rf.force;
      q.airVelocityY = rf.uy * UI_COSMIC_PUSH * UI_COSMIC_FIGHTER_SPEED * rf.force;
      q.onGround = false;
      q.groundedPlatform = null;
      q.falling = true;
    }
    breakGlassInRadius(cx, cy, UI_COSMIC_RADIUS * 0.6);
    explosions.push({ x: cx, y: cy, radius: 160, frame: 0 });
    spawnSsjRing(cx, cy, '255,255,255', 40, 7);
    spawnSsjRing(cx, cy, '170,200,255', 28, 5);
    spawnSsjRing(cx, cy, '255,255,255', 18, 3.5);
    spawnSsjParticleBurst(cx, cy, '#ffffff', 40, 6);
  }

  function completePhaseTransform(p, kind, landingPhase) {
    p.ssjHold = 0;
    if (kind === PHASE_TRANSFORM.ACTIVATE) {
      // the base cutscene lands the sequence's own phase (plain SSJ stays put)
      if (landingPhase === SSJ_PHASE_UI) { completePhaseTransform(p, PHASE_TRANSFORM.TO_UI); return; }
      if (landingPhase === SSJ_PHASE_SSJ2) p.ssjPhase = SSJ_PHASE_SSJ2;
      p.ssjFlying = false;
    } else if (kind === PHASE_TRANSFORM.TO_SSJ2) {
      p.ssjPhase = SSJ_PHASE_SSJ2;
      p.ssjFlying = false; // updateSsj2 engages the permanent flight next step
    } else if (kind === PHASE_TRANSFORM.TO_UI) {
      p.ssjPhase = SSJ_PHASE_UI;
      p.ssjUiAge = 0;
      p.ssjFlying = false; // updateSsj2 engages the permanent float next step
      p.ssjFuriousOn = false;
      p.ssjFuriousLocked = false; // the recharge audio fades out gradually
      ssjFadeOutFuriousAudio();
      ssjPlayUiTheme();
      cosmicShockwave(p);
    }
    spawnSsjTransformBurst(p);
  }

  // ---------- SSJ2 melee (J): attack art 1..10 ----------
  function runSsjMeleeTick(p) {
    var m = p.ssjMelee;
    m.t++;
    p.airVelocityX = 0;
    p.airVelocityY = 0;
    var frame = Math.min(SSJ2_MELEE_FRAMES - 1, Math.floor(m.t / SSJ2_MELEE_STEPS_PER_FRAME));
    m.frame = frame;
    if (frame !== m.lastHitFrame && SSJ2_MELEE_HIT_FRAMES.indexOf(frame) !== -1) {
      m.lastHitFrame = frame;
      var dir = p.lastDirX || 1;
      var box = {
        x: dir > 0 ? p.x + p.w : p.x - SSJ2_MELEE_REACH,
        y: p.y - 4, w: SSJ2_MELEE_REACH, h: p.h + 8
      };
      var rival = p.ssjComboVictim();
      var last = frame === SSJ2_MELEE_HIT_FRAMES[SSJ2_MELEE_HIT_FRAMES.length - 1];
      if (rival && rival.matrixDodgeTimer <= 0 && rectsOverlap(box, rival.getBounds())) {
        rival.damage(SSJ2_MELEE_HIT_DAMAGE);
        rival.hitFlash = 6;
        rival.getHitClock = 0;
        rival.lastDirX = -dir;
        rival.stunTimer = Math.max(rival.stunTimer, 6);
        if (rival.aiming) rival.abortAiming(true, 'vanish'); // a melee blow knocks the gun out
        spawnSsjParticleBurst(rival.x + rival.w / 2, rival.y + rival.h / 2, '#ffe97a', 6, 3);
        if (last) {
          rival.airVelocityX = dir * SSJ2_COMBO_LAUNCH_X;
          rival.airVelocityY = SSJ2_COMBO_LAUNCH_Y;
          rival.falling = true;
          rival.onGround = false;
          rival.groundedPlatform = null;
          rival.jumping = false;
          rival.knockedDown = false;
          rival.knockbackRoll = false;
        }
        ssjPlayOnce('heavyPunch', SSJ2_HEAVY_PUNCH_AUDIO_SRC);
      }
      hitCratesInReach(p, SSJ2_MELEE_REACH, SSJ2_MELEE_HIT_DAMAGE, 3, -2.5);
      hitBarrelsInReach(p, SSJ2_MELEE_REACH, SSJ2_MELEE_HIT_DAMAGE, 3, -2.5);
    }
    if (m.t >= SSJ2_MELEE_FRAMES * SSJ2_MELEE_STEPS_PER_FRAME) {
      p.ssjMelee = null;
      p.ssjMeleeCooldown = SSJ2_MELEE_COOLDOWN;
    }
  }

  // ---------- UI abilities ----------
  var ssjOrbs = [];   // red steerable energy balls
  var ssjRays = [];   // light-beam burst projectiles

  function startUiOrb(p) {
    var dir = p.lastDirX || 1;
    ssjOrbs.push({
      owner: p.id,
      x: p.x + p.w / 2 + dir * (p.w * 0.7),
      y: p.y + p.h * 0.42,
      vx: dir * UI_ORB_SPEED, vy: 0,
      life: UI_ORB_LIFE, r: UI_ORB_RADIUS
    });
    ssjPlayOnce('kameWave', SSJ2_KAME_WAVE_AUDIO_SRC);
    spawnSsjRing(p.x + p.w / 2, p.y + p.h * 0.42, '255,90,90', 12, 1.8);
  }

  function explodeUiOrb(o) {
    // the super explosion: the shared blast (glass, crates, barrels, fighters)
    // minus the owner, plus a red shockwave
    explodeAt(o.x, o.y, UI_ORB_BLAST_RADIUS, UI_ORB_BLAST_DAMAGE, UI_ORB_BLAST_DAMAGE,
      { exceptId: o.owner, noFire: true, fullImpact: true, silent: true }); // the cosmic blast has its own audio
    spawnSsjRing(o.x, o.y, '255,70,70', 22, 3.6);
    spawnSsjRing(o.x, o.y, '255,230,200', 14, 4.4);
    spawnSsjParticleBurst(o.x, o.y, '#ff5a4d', 26, 4);
    spawnSsjParticleBurst(o.x, o.y, '#fff0d0', 12, 3);
  }

  // Circle (UI_ORB_HIT_RADIUS) vs rectangle: the closest point of the rect to
  // the orb centre must lie inside the circle.
  function uiOrbTouchesRect(orb, rect) {
    var nearestX = Math.max(rect.x, Math.min(orb.x, rect.x + rect.w));
    var nearestY = Math.max(rect.y, Math.min(orb.y, rect.y + rect.h));
    var dx = orb.x - nearestX;
    var dy = orb.y - nearestY;
    return dx * dx + dy * dy <= UI_ORB_HIT_RADIUS * UI_ORB_HIT_RADIUS;
  }

  function updateUiOrbs() {
    for (var i = ssjOrbs.length - 1; i >= 0; i--) {
      var o = ssjOrbs[i];
      var owner = o.owner === player1.id ? player1 : player2;
      // steering: the arrows bend the flight in real time
      if (owner && owner.hp > 0) {
        var ax = (owner.pressRight() ? 1 : 0) - (owner.pressLeft() ? 1 : 0);
        var ay = (owner.pressDownKey() ? 1 : 0) - (owner.pressUp() ? 1 : 0);
        if (ax || ay) {
          var m = Math.sqrt(ax * ax + ay * ay);
          o.vx += (ax / m * UI_ORB_SPEED - o.vx) * UI_ORB_STEER;
          o.vy += (ay / m * UI_ORB_SPEED - o.vy) * UI_ORB_STEER;
        }
      }
      var steps = 2;
      var boom = false;
      for (var st = 0; st < steps && !boom; st++) {
        o.x += o.vx / steps;
        o.y += o.vy / steps;
        var targets = [player1, player2];
        for (var t = 0; t < targets.length; t++) {
          var tp = targets[t];
          if (tp.id === o.owner || tp.hp <= 0) continue;
          if (uiOrbTouchesRect(o, tp.getBounds())) { boom = true; break; }
        }
        if (!boom) {
          for (var pi = 0; pi < platforms.length; pi++) {
            var plat = platforms[pi];
            if (platformIsOneWay(plat) || plat.ladder || plat.glass) continue;
            if (uiOrbTouchesRect(o, plat)) { boom = true; break; }
          }
        }
        if (!boom) {
          for (var ci = 0; ci < crates.length; ci++) {
            if (!crates[ci].dead && uiOrbTouchesRect(o, crates[ci])) { boom = true; break; }
          }
        }
        if (!boom) {
          for (var bi = 0; bi < barrels.length; bi++) {
            if (!barrels[bi].dead && uiOrbTouchesRect(o, barrels[bi])) { boom = true; break; }
          }
        }
        if (o.x < -20 || o.x > GAME_WIDTH + 20 || o.y < -140 || o.y > 640) boom = true;
      }
      o.life--;
      if (o.life <= 0) boom = true;
      if (Math.random() < 0.6) {
        spawnSsjParticle(o.x, o.y, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 10, 1.4, '#ff7a6a');
      }
      if (boom) {
        explodeUiOrb(o);
        ssjOrbs.splice(i, 1);
      }
    }
  }

  // Everything breakable the Ultra Instinct body touches shatters at once,
  // without slowing him down.
  function uiSmashContact(p) {
    var hit = { x: p.x - 2, y: p.y - 2, w: p.w + 4, h: p.h + 4 };
    var broke = false, i;
    for (i = 0; i < crates.length; i++) {
      var c = crates[i];
      if (c.dead || !rectsOverlap(hit, c)) continue;
      breakCrate(c);
      broke = true;
    }
    for (i = 0; i < barrels.length; i++) {
      var b = barrels[i];
      if (b.dead || !rectsOverlap(hit, b)) continue;
      detonateBarrel(b);
      broke = true;
    }
    var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    for (i = 0; i < glassPanes.length; i++) {
      var g = glassPanes[i];
      if (g.broken || !rectsOverlap(hit, g)) continue;
      breakGlassPane(g, p.lastDirX * 3, 0);
      broke = true;
    }
    if (broke) ssjPlayOnce('crashBox', 'mods/sounds/CrashBox.mp3');
  }

  function startUiRays(p) {
    p.ssjRays = { left: UI_RAYS_COUNT, timer: 0 };
    p.ssjRaysCooldown = UI_RAYS_COOLDOWN; // the 5 s run from the keypress
    ssjPlayOnce('kameCharge', SSJ2_KAME_CHARGE_AUDIO_SRC);
  }

  function runUiRaysTick(p) {
    var r = p.ssjRays; // the burst fires while the fighter keeps walking freely
    r.timer++;
    if (r.timer % UI_RAYS_INTERVAL === 0 && r.left > 0) {
      var rival = p.ssjComboVictim();
      var dir = p.lastDirX || 1;
      var sx = p.x + p.w / 2 + dir * 6;
      var sy = p.y + p.h * 0.4 + (Math.random() - 0.5) * 14;
      var ang;
      if (rival) {
        ang = Math.atan2(rival.y + rival.h / 2 - sy, rival.x + rival.w / 2 - sx);
      } else {
        ang = dir > 0 ? 0 : Math.PI;
      }
      ang += (Math.random() - 0.5) * 1.1; // fan out, then home in
      ssjRays.push({
        owner: p.id, x: sx, y: sy,
        vx: Math.cos(ang) * UI_RAY_SPEED, vy: Math.sin(ang) * UI_RAY_SPEED,
        life: 90, trail: []
      });
      r.left--;
      spawnSsjParticleBurst(sx, sy, '#e6f6ff', 3, 2);
    }
    if (r.left <= 0 && r.timer > UI_RAYS_COUNT * UI_RAYS_INTERVAL) {
      p.ssjRays = null;
    }
  }

  function updateUiRays() {
    for (var i = ssjRays.length - 1; i >= 0; i--) {
      var ray = ssjRays[i];
      var owner = ray.owner === player1.id ? player1 : player2;
      var rival = owner === player1 ? player2 : player1;
      if (rival && rival.hp > 0) {
        // homing: bend the heading toward the rival, constant speed
        var want = Math.atan2(rival.y + rival.h / 2 - ray.y, rival.x + rival.w / 2 - ray.x);
        var cur = Math.atan2(ray.vy, ray.vx);
        var d = want - cur;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        cur += Math.max(-0.22, Math.min(0.22, d));
        ray.vx = Math.cos(cur) * UI_RAY_SPEED;
        ray.vy = Math.sin(cur) * UI_RAY_SPEED;
      }
      ray.trail.push({ x: ray.x, y: ray.y });
      if (ray.trail.length > 6) ray.trail.shift();
      ray.x += ray.vx;
      ray.y += ray.vy;
      ray.life--;
      var dead = ray.life <= 0 || ray.x < -20 || ray.x > GAME_WIDTH + 20 || ray.y < -140 || ray.y > 640;
      if (!dead && rival && rival.hp > 0 && rectsOverlap({ x: ray.x - 2, y: ray.y - 2, w: 4, h: 4 }, rival.getBounds())) {
        rival.damage(UI_RAY_DAMAGE);
        rival.hitFlash = 6;
        rival.getHitClock = 0;
        rival.stunTimer = Math.max(rival.stunTimer, 4);
        if (rival.aiming) rival.abortAiming(true, 'vanish');
        spawnSsjParticleBurst(ray.x, ray.y, '#dff6ff', 5, 2.4);
        dead = true;
      }
      if (!dead) {
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (platformIsOneWay(plat) || plat.ladder || plat.glass) continue;
          if (rectsOverlap({ x: ray.x - 1, y: ray.y - 1, w: 2, h: 2 }, plat)) { dead = true; break; }
        }
      }
      if (dead) ssjRays.splice(i, 1);
    }
  }

  // UI teleport (Ki recharge key): warp beside the rival, throw the
  // atackui1..4 sequence, then snap back to the EXACT starting spot.
  function startUiTele(p) {
    var rival = p.ssjComboVictim();
    if (!rival) return false;
    // stage 'pre': the wind-up plays on the spot, then the warp + strike
    p.ssjUiTele = {
      origin: { x: p.x, y: p.y }, origDir: p.lastDirX || 1, stage: 'pre',
      t: 0, frame: 0, lastHitFrame: -1, victimId: rival.id
    };
    return true;
  }

  // wind-up art: upgrade1, then recargarki16 <-> upgrade4 exactly 3 times
  var UI_TELE_PRE = [[PHASE_TRANSFORM.TO_UI, 0]];
  for (var _tp = 0; _tp < 3; _tp++) UI_TELE_PRE.push(['ssj2Charge', -1], [PHASE_TRANSFORM.TO_UI, 3]);
  var UI_TELE_PRE_STEPS = 8;

  function uiTeleWarp(p, tl) {
    var rival = p.ssjComboVictim();
    if (!rival) { p.ssjUiTele = null; return; }
    var ex = rival.x + rival.w / 2;
    var sx = p.x + p.w / 2;
    var side = ex > sx ? -1 : 1; // arrive on the side we came from
    var tx = side < 0 ? rival.x - p.w - 4 : rival.x + rival.w + 4;
    spawnSsjTeleportFx(p);
    if (!ssjTeleportTo(p, tx, rival.y)) { p.ssjUiTele = null; return; }
    p.lastDirX = side < 0 ? 1 : -1; // face the rival
    tl.stage = 'strike';
    tl.t = 0;
    tl.frame = 0;
    ssjPlayOnce('teleport', SSJ2_TELEPORT_AUDIO_SRC);
  }

  function runUiTeleTick(p) {
    var tl = p.ssjUiTele;
    p.airVelocityX = 0;
    p.airVelocityY = 0;
    tl.t++;
    if (tl.stage === 'pre') {
      tl.frame = Math.min(UI_TELE_PRE.length - 1, Math.floor(tl.t / UI_TELE_PRE_STEPS));
      if (tl.t >= UI_TELE_PRE.length * UI_TELE_PRE_STEPS) uiTeleWarp(p, tl);
      return;
    }
    var rival = p.ssjComboVictim();
    var frames = MOD_SPRITE_DEFS.uiAttack.length;
    tl.frame = Math.min(frames - 1, Math.floor(tl.t / UI_TELE_STEPS_PER_FRAME));
    if ((tl.frame === 1 || tl.frame === frames - 1) && tl.lastHitFrame !== tl.frame) {
      tl.lastHitFrame = tl.frame;
      if (rival) {
        rival.damage(UI_TELE_HIT_DAMAGE);
        rival.hitFlash = 6;
        rival.getHitClock = 0;
        rival.lastDirX = -p.lastDirX;
        rival.stunTimer = Math.max(rival.stunTimer, 8);
        if (rival.aiming) rival.abortAiming(true, 'vanish');
        spawnSsjParticleBurst(rival.x + rival.w / 2, rival.y + rival.h / 2, '#ffffff', 7, 3);
        if (tl.frame === frames - 1) {
          rival.airVelocityX = p.lastDirX * SSJ2_COMBO_LAUNCH_X;
          rival.airVelocityY = SSJ2_COMBO_LAUNCH_Y;
          rival.falling = true;
          rival.onGround = false;
          rival.groundedPlatform = null;
          rival.jumping = false;
          rival.knockedDown = false;
          rival.knockbackRoll = false;
        }
        ssjPlayOnce('heavyPunch', SSJ2_HEAVY_PUNCH_AUDIO_SRC);
      }
    }
    if (tl.t >= frames * UI_TELE_STEPS_PER_FRAME) {
      // back to the exact starting spot (fractions only when something now blocks it)
      spawnSsjTeleportFx(p);
      var home = { x: tl.origin.x, y: tl.origin.y, w: p.w, h: p.h };
      if (!ssjSpotBlocked(home)) {
        p.x = home.x;
        p.y = home.y;
        p.airVelocityX = 0;
        p.airVelocityY = 0;
        p.onGround = false;
        p.groundedPlatform = null;
        spawnSsjTeleportFx(p);
      } else {
        ssjTeleportTo(p, home.x, home.y);
      }
      p.ssjUiTele = null;
      p.ssjUiTeleCooldown = UI_TELE_COOLDOWN;
    }
  }

  // ---------- per-player SSJ driver (runs from Player.update) ----------
  Player.prototype.updateSsj2 = function (controllable, other) {
    if (this.ssjTeleCooldown > 0) this.ssjTeleCooldown--;
    if (this.ssjComboCooldown > 0) this.ssjComboCooldown--;
    if (this.ssjBeamCooldown > 0) this.ssjBeamCooldown--;
    if (this.ssjMeleeCooldown > 0) this.ssjMeleeCooldown--;
    if (this.ssjOrbCooldown > 0) this.ssjOrbCooldown--;
    if (this.ssjRaysCooldown > 0) this.ssjRaysCooldown--;
    if (this.ssjUiTeleCooldown > 0) this.ssjUiTeleCooldown--;
    if (!this.ssj2) return;
    this.ssj2.update(this);
    var phase = this.ssjPhase;
    // Ultra Instinct runs out after one minute: back to the plain fighter
    if (phase === SSJ_PHASE_UI && this.hp > 0 && !this.transformationPose) {
      this.ssjUiAge++;
      if (this.ssjUiAge >= UI_DURATION_STEPS) {
        ssjStopUiTheme();
        ssjStopFuriousAudio();
        spawnSsjTransformBurst(this);
        this.setSsj2(null);
        return;
      }
    }
    // Ultra Instinct: unshakable and destructive
    if (phase === SSJ_PHASE_UI && this.hp > 0 && !this.transformationPose) {
      this.falling = false;
      this.knockbackRoll = false;
      this.blastRollPending = 0;
      if (this.fireState !== FireStates.normal) this.setFireState(FireStates.normal); // fireproof
      uiSmashContact(this);
    }
    // SSJ2 and UI float permanently
    if (this.hp > 0 && (phase === SSJ_PHASE_SSJ2 || phase === SSJ_PHASE_UI) && !this.ssjFlying && !this.transformationPose) {
      this.ssjFlying = true;
      this.jumping = false;
      this.jumpPushTimeLeft = 0;
      this.onGround = false;
      this.groundedPlatform = null;
      this.airVelocityY -= 0.6;
    }
    // SSJ flight burns Ki (SSJ2's is native: no drain); running dry powers it down
    if (this.ssjFlying && phase === SSJ_PHASE_SSJ) {
      this.ssjKi -= SSJ2_FLIGHT_DRAIN * gameSpeed;
      if (this.ssjKi <= 0) {
        this.ssjKi = 0;
        this.ssjFlying = false;
        spawnSsjParticleBurst(this.x + this.w / 2, this.y + this.h / 2, '#9fd8ff', 8, 2);
      }
    }
    this.updateSsjAuraSpawn();
    if (!controllable || this.hp <= 0) {
      // deaths and locks drop every stance; the transformation itself stays
      this.ssjCharging = false;
      this.ssjHold = 0;
      if (this.ssjFuriousOn && !this.ssjFuriousLocked) {
        this.ssjFuriousOn = false;
        ssjStopFuriousAudio();
      }
      if (this.ssjRechargeAudioOn) {
        this.ssjRechargeAudioOn = false;
        ssjStopRechargeAudio();
      }
      // a locked/grabbed body cannot keep gathering: the mid-charge cancels
      // (audio stops now, the orb never fires and the wave never plays)
      if (this.ssjBeam && this.ssjBeam.phase === 'charge') {
        ssjStopKameChargeAudio();
        this.ssjBeam = null;
      }
      if (this.hp <= 0) {
        this.ssjFlying = false;
        this.ssjBeam = null;
        this.ssjCombo = null;
        this.ssjMelee = null;
        this.ssjUiTele = null;
        this.ssjRays = null;
        if (this.ssjFuriousOn) { this.ssjFuriousOn = false; this.ssjFuriousLocked = false; ssjStopFuriousAudio(); }
      }
      return;
    }
    var alive = this.hp > 0;

    // ---- ';' Ki charge (HOLD, SSJ/SSJ2): fixed posture, expanding aura.
    // Holding it at FULL Ki walks the phase ladder: SSJ -> SSJ2 after 3 s,
    // SSJ2 -> UI after 5 s (with the furious recharge audio) ----
    var chargeHeld = alive && phase !== SSJ_PHASE_UI && !!keys[this.binding.ssjKi];
    this.ssjCharging = chargeHeld;
    if (chargeHeld) {
      if (this.ssjKi < SSJ2_KI_MAX) {
        this.ssjKi = Math.min(SSJ2_KI_MAX, this.ssjKi + SSJ2_KI_REGEN * gameSpeed);
      }
      this.airVelocityX = 0;
      this.airVelocityY = 0;
      this.runSsjStanceCleanup();
    }
    var atMax = chargeHeld && this.ssjKi >= SSJ2_KI_MAX;
    if (phase !== SSJ_PHASE_UI) {
      if (atMax) {
        this.ssjHold++;
        if (phase === SSJ_PHASE_SSJ2) {
          if (!this.ssjFuriousOn) {
            this.ssjFuriousOn = true;
            ssjStartFuriousAudio();
          }
          if (this.ssjHold > SSJ2_TO_UI_HOLD_STEPS) {
            // past the 5 s: the audio now plays itself out even if the key is released
            this.ssjFuriousLocked = true;
            startPhaseTransform(this, PHASE_TRANSFORM.TO_UI);
            return;
          }
        } else if (this.ssjHold >= SSJ_TO_SSJ2_HOLD_STEPS) {
          startPhaseTransform(this, PHASE_TRANSFORM.TO_SSJ2);
          return;
        }
      } else {
        this.ssjHold = 0;
        if (this.ssjFuriousOn && !this.ssjFuriousLocked) {
          // released before the 5 s: the recharge cancels and the audio cuts at once
          this.ssjFuriousOn = false;
          ssjStopFuriousAudio();
        }
      }
    }
    // recharge audio: loop the second half of recarganormal.mp3 while charging
    // (the furious audio replaces it once the phase hold is running)
    if (this.ssj2 && alive) {
      var wantRecharge = chargeHeld && !this.ssjFuriousOn;
      if (wantRecharge && !this.ssjRechargeAudioOn) {
        this.ssjRechargeAudioOn = true;
        ssjStartRechargeAudio();
      } else if (!wantRecharge && this.ssjRechargeAudioOn) {
        this.ssjRechargeAudioOn = false;
        ssjStopRechargeAudio();
      }
    }

    // ---- L: fly mode toggle (SSJ only; SSJ2 flies on its own, UI walks) ----
    if (alive && phase === SSJ_PHASE_SSJ && consumeJustPressed(this.binding.ssjFly)) {
      if (this.ssjFlying) {
        this.ssjFlying = false;
        spawnSsjTeleportFx(this);
      } else if (
        this.ssjKi >= SSJ2_FLIGHT_MIN_KI &&
        !this.ssjMoveLocked() && !this.aiming
      ) {
        this.ssjFlying = true;
        this.jumping = false;
        this.jumpPushTimeLeft = 0;
        this.onGround = false;
        this.groundedPlatform = null;
        this.airVelocityY -= 0.6; // small lift to break the ground contact
        spawnSsjParticleBurst(this.x + this.w / 2, this.y + this.h, '#9fd8ff', 10, 2.2);
      }
    }

    // UI light-beam burst does not pin the fighter: tick it on its own
    if (this.ssjRays) runUiRaysTick(this);

    // stance runs keep their own tick below and pin the fighter
    if (this.ssjMoveLocked()) {
      var comboVictim = this.ssjComboVictim();
      if (this.ssjCombo) {
        // the rival died mid-sequence (a beam pulse): the strike ends clean
        if (!comboVictim) this.ssjCombo = null;
        else runSsjTeleComboTick(this, comboVictim);
      }
      if (this.ssjBeam) runSsjBeamTick(this);
      if (this.ssjMelee) runSsjMeleeTick(this);
      if (this.ssjUiTele) runUiTeleTick(this);
      if (!this.ssjCombo && !this.ssjUiTele) this.airVelocityX = 0; // launchers set their own
      return; // no new abilities while one is running
    }

    // ---- J: SSJ2 melee (attack art 1..10) / UI light-beam burst; SSJ: reserved ----
    if (alive && phase === SSJ_PHASE_SSJ2 && this.ssjMeleeCooldown <= 0 && consumeJustPressed(this.binding.ssjPunch)) {
      this.ssjMelee = { t: 0, frame: 0, lastHitFrame: -1 };
      this.airVelocityX = 0;
      this.airVelocityY = 0;
      ssjPlayOnce('teleport', SSJ2_TELEPORT_AUDIO_SRC);
    } else if (
      alive && phase === SSJ_PHASE_UI && this.ssjRaysCooldown <= 0 &&
      this.ssjKi >= UI_KI_COST_RAYS && consumeJustPressed(this.binding.ssjPunch)
    ) {
      this.ssjKi -= UI_KI_COST_RAYS;
      startUiRays(this);
    }

    // ---- K: Kamehameha (SSJ small / SSJ2 large) or the UI red orb ----
    if (alive && phase === SSJ_PHASE_UI) {
      if (this.ssjOrbCooldown <= 0 && this.ssjKi >= UI_KI_COST_ORB && consumeJustPressed(this.binding.ssjBeam)) {
        this.ssjKi -= UI_KI_COST_ORB;
        this.ssjOrbCooldown = UI_ORB_COOLDOWN;
        startUiOrb(this);
      }
    } else if (
      alive &&
      this.ssjBeamCooldown <= 0 &&
      this.ssjKi >= SSJ2_KI_COST_BEAM &&
      consumeJustPressed(this.binding.ssjBeam)
    ) {
      this.ssjKi -= SSJ2_KI_COST_BEAM;
      this.ssjBeam = {
        phase: 'charge',
        timer: 0,
        dir: this.lastDirX || 1,
        chargeCap: ssjKameChargeCapSteps(), // the charge audio length is the max hold
        charge: 0
      };
      this.airVelocityX = 0;
      this.airVelocityY = 0;
      spawnSsjRing(this.x + this.w / 2, this.y + this.h * 0.42, '160,220,255', 12, 1.6);
      ssjStartKameChargeAudio(this);
    }

    // ---- Ki recharge key in UI: teleport beside the rival, strike, come back ----
    if (
      alive && phase === SSJ_PHASE_UI && this.ssjUiTeleCooldown <= 0 &&
      this.ssjKi >= UI_KI_COST_TELE && consumeJustPressed(this.binding.ssjKi)
    ) {
      if (startUiTele(this)) this.ssjKi -= UI_KI_COST_TELE;
    }

    // ---- ': free Instant Transmission ----
    if (
      alive &&
      this.ssjTeleCooldown <= 0 &&
      this.ssjKi >= SSJ2_KI_COST_TELEPORT &&
      consumeJustPressed(this.binding.ssjTele)
    ) {
      this.ssjKi -= SSJ2_KI_COST_TELEPORT;
      this.ssjTeleCooldown = SSJ2_TELEPORT_COOLDOWN;
      ssjInstantTransmission(this, other);
    }
  };

  // The strike's victim is always the rival fighter (nearest target by
  // construction in a duel). Dead rivals are not valid targets.
  Player.prototype.ssjComboVictim = function () {
    var rival = this.id === player1.id ? player2 : player1;
    return rival && rival.hp > 0 ? rival : null;
  };

  // One shared guard: stance states never fight the physics cleanup paths.
  Player.prototype.runSsjStanceCleanup = function () {
    if (this.punching) {
      this.punching = false;
      this.punchFrame = 0;
    }
    if (this.aiming) this.abortAiming(false);
  };

  // ==================================================================
  // MATRIX STATE ( "The One" mod — State pattern, wired like SSJ2 )
  //
  // The 'matrix' cheat swaps the Arrow-Key fighter into this shell and
  // re-themes the ability keys J/K/L/;/' as The One's repertoire:
  //   J (hold)  Bullet Time      — the whole world crawls to 30% while the
  //                                avatar keeps their real-time physics
  //   K (press) Dodge/Deflect    — backward arc hop; frontal bullets are
  //                                shielded and shot back at the shooter
  //   L (hold)  Wall Run/Kick    — run up walls and cover (131 props), kick
  //                                off with ARROW-UP, a fuel gauge caps it
  //   ; (press) Code Reload      — instant full magazine + digital rain
  //   ' (press) Glitch Teleport  — warp behind the nearest enemy
  // SSJ2 and Matrix are mutually exclusive shells; the cheat manager swaps
  // them and re-typing the current word drops the transformation.
  // ==================================================================
  function MatrixModeState() {}

  MatrixModeState.prototype.name = 'MATRIX';

  MatrixModeState.prototype.enter = function (p) {
    p.matrixTimer = 0;
    p.transformationPose = null; // the gokussj cutscene never leaks into The One
    p.matrixBtHeld = false;
    p.matrixBtOn = false;
    p.matrixBtCap = 0;
    p.matrixBtCooldown = 0;
    p.matrixDodgeTimer = 0;
    p.matrixDodgeCooldown = 0;
    p.endMatrixWallRun('enter');
    p.matrixReloadCooldown = 0;
    p.matrixTeleCooldown = 0;
    p.matrixGlitchTimer = 0;
    // The download flash: green code ring + burst, the transformation reads
    // as data being written over the fighter.
    spawnSsjRing(p.x + p.w / 2, p.y + p.h / 2, '0,255,110', 18, 2.2);
    spawnSsjRing(p.x + p.w / 2, p.y + p.h / 2, '190,255,190', 12, 3);
    spawnSsjParticleBurst(p.x + p.w / 2, p.y + p.h / 2, '#4dff8a', 18, 2.8);
    spawnSsjParticleBurst(p.x + p.w / 2, p.y + p.h / 2, '#d8ffe0', 8, 2);
    spawnMatrixGlitchBurst(p.x + p.w / 2, p.y + p.h / 2);
  };

  MatrixModeState.prototype.exit = function (p) {
    p.matrixBtHeld = false;
    p.matrixBtOn = false;
    p.matrixBtCap = 0;
    p.matrixDodgeTimer = 0;
    p.endMatrixWallRun('exit');
    p.matrixGlitchTimer = 0;
  };

  MatrixModeState.prototype.update = function (p) {
    p.matrixTimer++;
  };

  Player.prototype.setMatrix = function (state) {
    if (this.matrix && this.matrix.exit) this.matrix.exit(this);
    this.matrix = state || null;
    if (this.matrix && this.matrix.enter) this.matrix.enter(this);
  };

  // Per-player pace: the Matrix avatar keeps REAL-TIME physics during the
  // bullet time while the rest of the world crawls at the matrix share.
  // The avatar divides the global pace by the matrix factor, which cancels
  // exactly the part this mode added (piecewise: 0.3/0.3 -> 1 s feel). The
  // other fighters read the plain global pace and crawl with everything.
  Player.prototype.moveSpeed = function () {
    if (this.matrix && this.matrixBtOn && matrixSlowFactor < 1) {
      return Math.min(1, gameSpeed / matrixSlowFactor);
    }
    return gameSpeed;
  };

  // Wall running cancels the standard gravity: the stance owns the climb.
  Player.prototype.matrixAirStance = function () {
    return this.matrixWallRunning;
  };

  // ---------- Matrix world field (digital rain + glitch blocks) ----------
  // Cosmetic only: everything here is skipped when paused (the arrays are
  // touched from updateStep, never from render).
  var matrixSlowFactor = 1; // the matrix share of the global gameSpeed
  var matrixBtPhase = null; // { mode: 'in'|'out', t } bullet-time ramp
  var matrixRain = [];  // { x, y, vy, len, life }
  var matrixGlitch = []; // { x, y, w, h, life, maxLife }

  // TRUE while any transformed fighter keeps bullet time engaged. Derived
  // from object state (not the driver liveness): a grabbed or rocket-riding
  // avatar cannot run updateMatrix, yet the fact must still be respected.
  function matrixBtWanted() {
    var roster = [player1, player2];
    for (var i = 0; i < roster.length; i++) {
      if (roster[i].matrix && roster[i].matrixBtOn) return true;
    }
    return false;
  }

  function spawnMatrixRainGlyph(x, y, vy) {
    if (matrixRain.length >= 260) matrixRain.shift();
    matrixRain.push({
      x: x, y: y,
      vy: vy || 3.2 + Math.random() * 2.4,
      len: 5 + Math.random() * 9,
      life: MATRIX_RAIN_LIFE
    });
  }

  function spawnMatrixRainBurst(p) {
    var cx = p.x + p.w / 2;
    var top = Math.max(-160, p.y - 130);
    for (var i = 0; i < MATRIX_RELOAD_RAIN_N; i++) {
      spawnMatrixRainGlyph(
        p.x - 30 + Math.random() * (p.w + 60),
        top + Math.random() * Math.min(150, p.y + p.h - top),
        2.6 + Math.random() * 3.4
      );
    }
    spawnSsjRing(cx, p.y + p.h * 0.5, '0,255,110', 16, 2.4);
  }

  function spawnMatrixGlitchBlock(x, y, w, h, life) {
    if (matrixGlitch.length >= 90) matrixGlitch.shift();
    matrixGlitch.push({
      x: x, y: y, w: w, h: h,
      life: life || (7 + Math.floor(Math.random() * 8)),
      maxLife: life || 10
    });
  }

  function spawnMatrixGlitchBurst(cx, cy) {
    // Binary distortion: a tight cluster of small green/white blocks.
    for (var i = 0; i < 15; i++) {
      spawnMatrixGlitchBlock(
        cx - 11 + Math.random() * 22,
        cy - 20 + Math.random() * 34,
        2 + Math.random() * 5,
        1.5 + Math.random() * 4
      );
    }
  }

  // Type shrapnel that lives a few steps at a teleport spot.
  function spawnMatrixTeleportFx(p) {
    var cx = p.x + p.w / 2;
    var cy = p.y + p.h / 2;
    spawnMatrixGlitchBurst(cx, cy);
    spawnSsjRing(cx, cy, '0,255,110', 12, 2.6);
  }

  // ---------- Bullet time (J) ----------
  // The avatar's hold drives the module request flag; updateMatrixSlowmo
  // (inside the slow cam) eases the global gameSpeed to the matrix target.
  Player.prototype.updateMatrixBulletTime = function () {
    var held = !!keys[this.binding.ssjPunch];
    if (
      held && !this.matrixBtOn &&
      this.matrixBtCooldown <= 0 && !this.aimSpinGuard()
    ) {
      // engage: forward hop-flag is not needed — the ease-in is instant
      this.matrixBtOn = true;
      this.matrixBtCap = 0;
      spawnSsjRing(this.x + this.w / 2, this.y + this.h / 2, '0,255,110', 20, 1.6);
    }
    if (this.matrixBtOn) {
      this.matrixBtHeld = true;
      this.matrixBtCap++;
      if (!held || this.matrixBtCap >= MATRIX_BT_HOLD_CAP) {
        // release or cap: disengage, then J must cool before a new hold
        this.matrixBtOn = false;
        this.matrixBtCooldown = MATRIX_BT_COOLDOWN + Math.round(this.matrixBtCap / 6);
        this.matrixBtCap = 0;
        spawnSsjRing(this.x + this.w / 2, this.y + this.h * 0.4, '160,255,190', 14, 2);
      }
    } else {
      this.matrixBtHeld = false;
    }
  };

  // Guard helper: no bullet time inside a stance the shell does not own.
  Player.prototype.aimSpinGuard = function () {
    return this.ssjFlying || this.ssjCharging || !!this.ssjBeam || !!this.ssjCombo ||
      !!this.ssjMelee || !!this.ssjUiTele || !!this.ssjRays;
  };

  // ---------- Dodge + deflection (K) ----------
  Player.prototype.updateMatrixDodge = function () {
    if (
      consumeJustPressed(this.binding.ssjBeam) &&
      this.matrixDodgeCooldown <= 0 &&
      !this.aimSpinGuard()
    ) {
      // backward arc hop: up-and-back over the facing, gravity owns the arc
      this.matrixDodgeTimer = MATRIX_DODGE_TIME;
      this.matrixDodgeCooldown = MATRIX_DODGE_COOLDOWN;
      this.airVelocityX = -this.lastDirX * MATRIX_DODGE_PUSH;
      this.airVelocityY = MATRIX_DODGE_GRAVITY;
      this.onGround = false;
      this.groundedPlatform = null;
      this.jumping = false;
      deflectFrontalShots(this);
      spawnSsjParticleBurst(
        this.x + this.w / 2 - this.lastDirX * 4,
        this.y + this.h * 0.5,
        '#4dff8a', 9, 2.2
      );
      spawnSsjRing(this.x + this.w / 2, this.y + this.h * 0.5, '0,255,110', 11, 2.2);
    } else if (this.matrixDodgeTimer > 0) {
      // the shield re-reads every dodge step: a barrage loses all of it
      deflectFrontalShots(this);
    }
  };

  // Frontal shots within the deflection cone get punished: plain bullets
  // reverse course (and now carry the avatar's owner id, so the shooter
  // eats them); rockets just get blown off course and skip the avatar.
  function deflectFrontalShots(p) {
    var cx = p.x + p.w / 2;
    var cy = p.y + p.h / 2;
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      if (b.dead) continue;
      var frontDx = b.x - cx;
      var frontY = Math.abs(b.y - cy);
      if (Math.abs(frontDx) > MATRIX_DEFLECT_RANGE || frontY > MATRIX_DEFLECT_VRANGE) continue;
      if (Math.sign(frontDx) !== (p.lastDirX > 0 ? 1 : -1)) continue;
      // "coming at the avatar": horizontal motion opposed to the offset
      if (b.vx * frontDx >= 0 && Math.abs(b.vx) > Math.abs(b.vy)) continue;
      if (b.rocket) {
        if (b.rider) continue; // a steered ride is the pilot's problem
        b.rideAngle += 160 + Math.random() * 40;
        b.rideSpeed *= 0.55;
        b.vx *= -MATRIX_DEFLECT_KEEP;
        b.vy *= -MATRIX_DEFLECT_KEEP;
      } else {
        b.vx *= -MATRIX_DEFLECT_KEEP;
        b.vy *= -0.3;
        b.owner = p.id; // the deflected round now hunts the shooter
        b.crit = false;
        spawnMatrixGlitchBlock(b.x, b.y, 4, 3, 6);
      }
      spawnSsjParticleBurst(b.x, b.y, '#b6ffd2', 5, 1.6);
    }
  }

  // ---------- Wall run / wall kick (L) ----------
  // Walls are the solid sides wallContact already probes; COVERS (the 131
  // crate props) count too: a band ahead of the body edge (wall-run reach)
  // is a wall for the run. The band keeps a fining pin: while climbing the
  // body never horizontal-drifts, so the contact cannot slip away.
  function matrixWallProbe(p, dir) {
    var ex = p.x + (dir > 0 ? p.w + EDGE_DISTANCE : -EDGE_DISTANCE);
    var band = { x: dir > 0 ? ex - 0.5 : ex - MATRIX_WALL_DISTANCE, w: 1 + MATRIX_WALL_DISTANCE, y: p.y, h: p.h };
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (platformIsOneWay(plat) || plat.ladder || plat.glass || !plat.solidSides) continue;
      if (rectsOverlap(band, plat)) return true;
    }
    if (p.x + p.w >= GAME_WIDTH - 1 && dir > 0) return true;
    if (p.x <= 1 && dir < 0) return true;
    for (i = 0; i < crates.length; i++) {
      var c = crates[i];
      if (c.dead) continue;
      if (rectsOverlap({ x: band.x, y: p.y - 2, w: band.w, h: p.h + 2 }, c)) return true;
    }
    return false;
  }

  function findMatrixWallSide(p) {
    var facing = p.lastDirX || 1;
    if (matrixWallProbe(p, facing)) return facing;
    if (matrixWallProbe(p, -facing)) return -facing;
    return 0;
  }

  Player.prototype.endMatrixWallRun = function (why) {
    var wasRunning = this.matrixWallRunning;
    this.matrixWallRunning = false;
    this.matrixWallSide = 0;
    if (!wasRunning) return;
    if (why === 'fuel') {
      this.matrixWallCooldown = MATRIX_WALL_COOLDOWN;
      spawnSsjParticleBurst(this.x + this.w / 2, this.y + this.h * 0.6, '#2fbf68', 6, 1.6);
    }
  };

  Player.prototype.updateMatrixWallRun = function () {
    var held = !!keys[this.binding.ssjFly];
    // fuel refreshes on solid ground only
    if (this.onGround) {
      this.matrixWallFuel = Math.min(MATRIX_WALL_FUEL_MAX, this.matrixWallFuel + MATRIX_WALL_FUEL_REGEN);
    }
    if (this.matrixWallCooldown > 0) return;

    if (this.matrixWallRunning) {
      var wallDir = this.matrixWallSide;
      var stillThere = matrixWallProbe(this, wallDir);
      if (
        !held || !stillThere ||
        this.matrixWallFuel <= 0 || this.aimSpinGuard()
      ) {
        this.endMatrixWallRun(this.matrixWallFuel <= 0 ? 'fuel' : 'exit');
        return;
      }
      // ArrowUp while running: KICK off the surface (the edge is consumed
      // here, so the standard jump block never fires a second jump)
      if (consumeJustPressed(this.binding.up)) {
        this.matrixWallRunning = false;
        this.matrixWallSide = 0;
        this.matrixWallFuel = Math.max(0, this.matrixWallFuel - MATRIX_WALL_JUMP_COST);
        this.airVelocityY = MATRIX_WALL_KICK_JUMP;
        this.airVelocityX = -wallDir * MATRIX_WALL_KICK_PUSH;
        this.lastDirX = -wallDir; // face away from the wall after the kick
        this.jumping = true;
        this.jumpPushTimeLeft = 0;
        this.matrixHopTimer = 10; // the kick arc keeps momentum with no input
        spawnSsjParticleBurst(
          this.x + this.w / 2 + wallDir * 4, this.y + this.h * 0.5,
          '#4dff8a', 8, 2
        );
        return;
      }
      // vertical wall run: the stance owns the velocity (gravity is skipped
      // via matrixAirStance); DOWN slides instead of climbing
      if (this.pressDownKey()) {
        this.airVelocityY = MATRIX_WALL_RUN_SPEED * 1.5;
      } else {
        this.airVelocityY = -MATRIX_WALL_RUN_SPEED;
      }
      this.matrixWallFuel--;
      this.airVelocityX = 0; // pinned to the surface this step
      this.jumping = false;
      this.onGround = false;
      this.groundedPlatform = null;
      if (Math.random() < 0.35) {
        spawnSsjParticle(
          this.x + this.w / 2 + wallDir * 3,
          this.y + 4 + Math.random() * (this.h - 8),
          wallDir * 0.4, -0.3,
          12, 1 + Math.random() * 1.2,
          '#6fe89a'
        );
      }
      return;
    }

    // engage: L near a wall or cover (facing a solid side, or back against one)
    if (
      held && controllableEdge(this) && !this.aiming && !this.climbing &&
      !this.inCover && !this.aimSpinGuard()
    ) {
      var side = findMatrixWallSide(this);
      if (side && this.matrixWallFuel >= MATRIX_WALL_JUMP_COST) {
        this.matrixWallRunning = true;
        this.matrixWallSide = side;
        this.onGround = false;
        this.groundedPlatform = null;
        this.airVelocityX = 0;
        this.airVelocityY = -MATRIX_WALL_RUN_SPEED;
        this.jumping = false;
        this.diving = false;
        this.falling = false;
        spawnSsjParticleBurst(
          this.x + this.w / 2 + side * 4, this.y + this.h * 0.5,
          '#4dff8a', 7, 1.8
        );
      }
    }
  };

  function controllableEdge(p) {
    return p.hp > 0 && p.stunTimer <= 0 && !p.falling && !p.knockedDown &&
      !p.rolling && !p.knockbackRoll && !p.diving;
  }

  // ---------- Code reload (;) ----------
  Player.prototype.updateMatrixReload = function () {
    if (this.matrixReloadCooldown > 0) return;
    if (
      consumeJustPressed(this.binding.ssjKi) &&
      !this.aimSpinGuard()
    ) {
      this.matrixReloadCooldown = MATRIX_RELOAD_COOLDOWN;
      if (this.ranged) {
        this.ranged.ammo = this.ranged.gun.ammo; // the magazine refills whole
        this.burstQueue = 0;
        this.burstTimer = 0;
        spawnMatrixRainBurst(this);
        spawnSsjRing(this.x + this.w / 2, this.y + this.h * 0.3, '120,255,140', 12, 2.6);
      }
    }
  };

  // ---------- Glitch teleport (') ----------
  Player.prototype.updateMatrixGlitchTeleport = function (other) {
    if (this.matrixTeleCooldown > 0) return;
    if (
      consumeJustPressed(this.binding.ssjTele) &&
      !this.aimSpinGuard()
    ) {
      var enemy = other && other.hp > 0 ? other : null;
      if (
        enemy &&
        Math.abs(enemy.x + enemy.w / 2 - (this.x + this.w / 2)) <= MATRIX_TELEPORT_SEEK
      ) {
        // behind their back: the side their facing points AWAY from
        var side = -(enemy.lastDirX || 1);
        var spot = null;
        // first candidate is flush behind the back; blocked spots walk
        // outward, then nudge vertically, before the warp gives up
        var candidates = [
          { dx: 0, dy: 0 },
          { dx: side * (this.w * 0.9), dy: 0 },
          { dx: 0, dy: -12 },
          { dx: side * (this.w * 0.9), dy: -12 },
          { dx: 0, dy: 12 }
        ];
        for (var cand = 0; cand < candidates.length && !spot; cand++) {
          var bx = enemy.x + (side > 0 ? enemy.w + this.w * 0.5 + 3 : -this.w * 0.5 - 3) +
            (side > 0 ? candidates[cand].dx : -candidates[cand].dx);
          var by = enemy.y + candidates[cand].dy;
          var box = { x: bx, y: by, w: this.w, h: this.h };
          if (!ssjSpotBlocked(box)) spot = { x: bx, y: by };
        }
        if (spot) {
          this.matrixTeleCooldown = MATRIX_TELEPORT_COOLDOWN;
          this.matrixGlitchTimer = 12;
          spawnMatrixTeleportFx(this); // distortion at the origin
          this.x = spot.x;
          this.y = spot.y;
          this.lastDirX = (enemy.x + enemy.w / 2) > (this.x + this.w / 2) ? 1 : -1;
          this.airVelocityX = 0;
          this.airVelocityY = 0;
          this.onGround = false; // the landing validates the floor below
          this.groundedPlatform = null;
          this.groundedCrate = null;
          this.groundedBarrel = null;
          this.endMatrixWallRun('exit');
          spawnMatrixTeleportFx(this); // distortion at the destination
        }
      }
    }
  };

  // ---------- per-player matrix driver (runs from Player.update) ----------
  Player.prototype.updateMatrix = function (controllable, other) {
    if (!this.matrix) return; // plain fighter: leave any live request alone
    if (this.matrixBtCooldown > 0) this.matrixBtCooldown--;
    if (this.matrixDodgeCooldown > 0) this.matrixDodgeCooldown--;
    if (this.matrixWallCooldown > 0) this.matrixWallCooldown--;
    if (this.matrixReloadCooldown > 0) this.matrixReloadCooldown--;
    if (this.matrixTeleCooldown > 0) this.matrixTeleCooldown--;
    if (this.matrixDodgeTimer > 0) this.matrixDodgeTimer--;
    if (this.matrixGlitchTimer > 0) this.matrixGlitchTimer--;
    if (this.matrixHopTimer > 0) this.matrixHopTimer--;
    if (!this.matrix) return;
    this.matrix.update(this);
    if (!controllable || this.hp <= 0) {
      // locks and deaths drop the stances; the transformation itself stays
      this.matrixBtHeld = false;
      if (this.matrixBtOn) this.matrixBtOn = false;
      this.endMatrixWallRun('exit');
      return;
    }
    this.updateMatrixBulletTime();
    this.updateMatrixDodge();
    this.updateMatrixWallRun();
    this.updateMatrixReload();
    this.updateMatrixGlitchTeleport(other);
    // ambient code motes: green bits drift down around the fighter
    for (var i = 0; i < MATRIX_AMBIENT_MOTE_N; i++) {
      if (Math.random() < 0.4) {
        spawnSsjParticle(
          this.x - 3 + Math.random() * (this.w + 6),
          this.y - 4 + Math.random() * 10,
          (Math.random() * 2 - 1) * 0.2,
          0.7 + Math.random() * 1.1,
          MATRIX_MOTE_LIFE,
          1 + Math.random() * 1.4,
          Math.random() < 0.75 ? '#54ff8f' : '#c8ffdb'
        );
      }
    }
  };

  // ---------- per-step matrix world service (runs from updateStep) ----------
  function updateMatrixWorld() {
    // rain: fast falling glyph streaks (gravity-free, fade by life)
    for (var i = matrixRain.length - 1; i >= 0; i--) {
      var r = matrixRain[i];
      r.y += r.vy;
      r.life--;
      if (r.life <= 0) matrixRain.splice(i, 1);
    }
    // glitch blocks shrink in place
    for (i = matrixGlitch.length - 1; i >= 0; i--) {
      var g = matrixGlitch[i];
      g.life--;
      if (g.life <= 0) matrixGlitch.splice(i, 1);
    }
    // bullet-time ramp bookkeeping: derive the request from the live shells
    var wanted = matrixBtWanted();
    if (wanted && !matrixBtPhase) {
      matrixBtPhase = { mode: 'in', t: 0 };
    } else if (!wanted && matrixBtPhase && matrixBtPhase.mode === 'in') {
      matrixBtPhase.mode = 'out';
      matrixBtPhase.t = 0;
    }
    if (matrixBtPhase) {
      matrixBtPhase.t++;
      if (matrixBtPhase.mode === 'in') {
        // ease in, then HOLD the target while the request survives
        if (matrixBtPhase.t >= MATRIX_BT_RAMP) {
          matrixSlowFactor = MATRIX_BT_TARGET;
        } else {
          matrixSlowFactor = 1 - (1 - MATRIX_BT_TARGET) * (matrixBtPhase.t / MATRIX_BT_RAMP);
        }
      } else {
        matrixSlowFactor = MATRIX_BT_TARGET +
          (1 - MATRIX_BT_TARGET) * (matrixBtPhase.t / MATRIX_BT_RAMP);
        if (matrixBtPhase.t >= MATRIX_BT_RAMP) {
          matrixBtPhase = null;
          matrixSlowFactor = 1;
        }
      }
    } else {
      matrixSlowFactor = 1;
    }
  }


  Player.prototype.inDoorway = function () {
    var bodyBounds = this.getBounds();
    for (var di = 0; di < doorPortals.length; di++) {
      var doorway = doorPortals[di];
      var recess = {
        x: doorway.x - DOORWAY_APPROACH_MARGIN_X, y: doorway.y,
        w: doorway.w + DOORWAY_APPROACH_MARGIN_X + DOORWAY_RECESS_DEPTH_X, h: doorway.h
      };
      if (rectsOverlap(bodyBounds, recess)) return true;
    }
    return false;
  };

  // Folds the collider while the roll lasts and unfolds it once there is room.
  // The feet and the horizontal centre never move; the drawn body stays full size
  // (drawStepped draws from the stored standing dimensions).
  Player.prototype.syncRollCollider = function () {
    var folded = this.rollShrunk;
    if (this.rolling && !folded) {
      var standingW = this.w, standingH = this.h;
      this.rollShrunk = { w: standingW, h: standingH };
      this.w = standingW * ROLL_COLLIDER_WIDTH_SHARE;
      this.h = standingH * ROLL_COLLIDER_HEIGHT_SHARE;
      this.x += (standingW - this.w) / 2;
      this.y += standingH - this.h;
    } else if (!this.rolling && folded) {
      var feet = this.y + this.h;
      var centre = this.x + this.w / 2;
      var standing = { x: centre - folded.w / 2, y: feet - folded.h, w: folded.w, h: folded.h };
      if (standingRoomFor(standing)) {
        this.x = standing.x; this.y = standing.y; this.w = folded.w; this.h = folded.h;
        this.rollShrunk = null;
      } // else: stays folded (and can keep moving) until it is clear above him
    }
  };

  // True when a full-size body at `rect` overlaps no solid platform.
  function standingRoomFor(rect) {
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (!plat.solidSides || platformIsOneWay(plat) || plat.ladder || plat.glass || plat.elevator) continue;
      if (rectsOverlap(rect, plat)) return false;
    }
    return true;
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

  Player.prototype.consumeDown = function () {
    return consumeJustPressed(this.binding.down);
  };

  Player.prototype.drainEnergy = function (cost) {
    this.sprintEnergy -= cost;
    if (this.sprintEnergy < 0) this.sprintEnergy = 0; // setter clamps at 0
  };

  // HP setter (extracted, PlayerState.HP): a dead fighter takes no further
  // HP writes; a loss arms the regen block (24*3 steps without healing).
  // The DISPLAYED bar snapshots the current HP BEFORE the change and then
  // glides to the new value over the BAR_TRAIL window:
  // _healthBarSpeed = (newHP - _barHP) / 6, _showHealthTimer = 6.
  // Which banked consumable the CONSUME key uses: health when hurt (or when
  // slowmo isn't banked), otherwise slowmo.
  Player.prototype.nextConsumableKind = function () {
    if (this.carriedHealth && (this.hp < 100 || !this.carriedSlowmo)) return 'health';
    return this.carriedSlowmo ? 'slowmo' : null;
  };

  Player.prototype.setHp = function (v) {
    if (this.hp <= 0) return;
    if (this.hp > v) this.hpDamageTimer = HP_DAMAGE_REGEN_DELAY;
    this.barHP = this.hp;
    this.hp = v;
    if (this.hp <= 0) this.hp = 0;
    if (this.hp > 100) this.hp = 100;
    this.healthBarSpeed = (this.hp - this.barHP) / BAR_TRAIL_STEPS;
    this.showHealthTimer = BAR_TRAIL_STEPS;
  };

  // ForceHP (extracted PlayerState.ForceHP): snaps BOTH the HP and the
  // display bar (used by the round reset to revive a dead fighter).
  Player.prototype.forceHp = function (v) {
    this.barHP = v;
    this.hp = v;
  };

  // HP writes go through the extracted setter (damage keeps the same gate:
  // a dead fighter takes no further harm).
  Player.prototype.damage = function (amount) {
    this.setHp(this.hp - amount);
  };

  Player.prototype.beginJump = function () {
    // A jump always starts, whatever hangs above the head: under a low ceiling
    // the rise simply ends where the head meets it (the vertical collision
    // pass stops him there), so he never "fails to jump".
    // BeginJump: AirVelocityY += PlayerJumpPower (SSJ2 boosts the leg power)
    this.airVelocityY += PLAYER_JUMP_POWER * this.ssjJumpMult();
    this.groundedPlatform = null;
    this.jumping = true;
    this.jumpPushTimeLeft = PLAYER_JUMP_PUSH_TIME;
    // DrainEnergy: sprinting jumps cost SPRINT_JUMP, otherwise JUMP
    this.drainEnergy(this.sprinting ? ENERGY_COST_SPRINT_JUMP : ENERGY_COST_JUMP);
    if (this.sprintEnergy <= 0) this.sprinting = false;
    playSfx(SFX.JUMP);
  };

  Player.prototype.meleeConnects = function (other) {
    // Extracted MeleeStrike, made scale-faithful and ORIENTATION-INDEPENDENT:
    // the artifact sweeps a ray from MidPosX + dir * 4 .. MeleeWeaponRange at
    // MidPosY - 4 with the artifact body (28x44). Measured from the CENTER of
    // the 0.6-scaled body that form lost every point outside it — the samples
    // stayed inside the fighter's own hull, so a punch only connected when the
    // two bodies already overlapped and whiffed against anyone standing next
    // to them, however they faced. The band below keeps the artifact's shape
    // (a few px inside the edge, reach ahead of it, at the mid-chest row) but
    // anchors it on the FRONT EDGE, and overlaps the victim's whole AABB: the
    // hit depends only on the enemy hitbox being in range, never on which way
    // the victim faces (back-turned victims get caught all the same).
    var reach = this.equipped.range[this.punchComboNr - 1] * PLAYER_SIZE_SCALE * MELEE_HIT_REACH_FACTOR;
    var inset = 4 * PLAYER_SIZE_SCALE; // the artifact's own start inside the edge
    var b = other.getBounds();
    var band = {
      // Facing left: the band reaches LEFT of the fighter and stays anchored
      // into the body; both facings get the same inset + reach width.
      x: this.lastDirX > 0 ? this.x + this.w - inset : this.x - reach,
      w: inset + reach,
      y: this.y + this.h / 2 - 8, // extracted MidPosY - 4 row, ±4 px of leeway
      h: 8
    };
    return rectsOverlap(band, b);
  };

  // MeleeStrike trade (extracted): when BOTH fighters connect on the same
  // frame, only the higher PlayerNr side resolves it — a coin flip decides
  // who lands the punch; the loser eats a 2-frame stun instead.
  Player.prototype.punchTradeWith = function (other) {
    if (!other || other.hp <= 0) return false;
    if (other.id <= this.id) return false; // only the higher number resolves
    if (!other.punching || other.punchHitPerformed) return false;
    var tradeHitFrame = Math.round(
      COMBO_HIT_FRAME[other.punchComboNr - 1] * other.meleeAnimScale()
    );
    if (other.punchFrame + 1 < tradeHitFrame) return false;
    if (!this.meleeConnects(other)) return false;
    var theirReach = other.equipped.range[other.punchComboNr - 1] * PLAYER_SIZE_SCALE * MELEE_HIT_REACH_FACTOR;
    var theirBox = {
      x: other.lastDirX > 0 ? other.x + other.w : other.x - theirReach,
      y: other.y + 8 * PLAYER_SIZE_SCALE,
      w: theirReach,
      h: 20 * PLAYER_SIZE_SCALE
    };
    return rectsOverlap(theirBox, this.getBounds());
  };

  // Combo-finisher launch (extracted 3 / -2.5): the victim turns back to the
  // pusher and flies away in `pushDirX`, landing into Knockdowned. Shared by
  // the 3rd punch and the firearm knockback rules.
  Player.prototype.launchComboFinisher = function (pushDirX) {
    this.lastDirX = pushDirX;
    this.airVelocityX = COMBO_KNOCKBACK_X * pushDirX;
    this.airVelocityY = COMBO_KNOCKBACK_Y;
    this.falling = true;
    this.onGround = false;
    this.groundedPlatform = null;
    this.jumping = false;
    this.knockedDown = false;
    this.knockedDownFrame = 0;
    this.knockbackRoll = false; // a fresh launch overrides any old tumble
    this.knockbackRollFrame = 0;
    this.knockbackRollAngle = 0;
    this.blastRollPending = 0; // the new flight owns the touchdown
    this.stunTimer = 0;
  };

  // PunchPlayer (extracted): damage, stun, and the three launch cases
  Player.prototype.applyPunch = function (other) {
    var wasDead = other.hp <= 0;
    // PunchPlayer: victim faces the attacker; aimed weapons drop (CheckAimDrop)
    if (other.aiming) other.abortAiming(true, "vanish");
    other.lastDirX = -this.lastDirX;
    if (other.jumping) {
      // Jumping victim: AirVelocityX += 2 * attacker dir, then Fall()
      other.airVelocityX += PUNCH_AERIAL_KNOCKBACK * this.lastDirX;
      other.falling = true;
    } else {
      // Grounded victim: stun on links 1 and 2 (combo 3 launches below)
      other.stunTimer = COMBO_STUN_BASE[this.punchComboNr - 1] + COMBO_STUN_RAND * Math.random();
    }
    // Damage only applies to a live victim (HP -= damage gated on HP > 0).
    // SSJ2 multiplies the equipped weapon damage (the artifact gate would
    // run the same code path, the shell just hits harder).
    if (this.equipped.shape) playSfx(SFX.BLADE_HIT);
    else playSfx(PUNCH_HIT_SOUNDS[this.punchComboNr - 1]);
    if (other.hp > 0) {
      other.damage(this.equipped.damage[this.punchComboNr - 1] * this.ssjMeleeMult()); // fists 6/7/8
      other.hitFlash = 6;
      other.getHitClock = 0; // sprite-only: restart the getHit pose timeline
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
      // The finisher SPINS the victim around: after facing the attacker on the
      // earlier links, they end back-turned, flying away from the attacker.
      other.launchComboFinisher(this.lastDirX);
    }
    // Launch case 3: any lethal punch on a standing victim also tips them over
    if (other.hp <= 0 && !other.knockedDown && !this.falling) {
      // Back-turned, face-down launch (same spin-away as launch case 2).
      other.lastDirX = this.lastDirX;
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
      other.knockbackRoll = false; // a fresh launch overrides any old tumble
      other.knockbackRollFrame = 0;
      other.knockbackRollAngle = 0;
      other.blastRollPending = 0; // the new flight owns the touchdown, not the old blast
      other.stunTimer = 0;
    }
  };

  // Slash-trace particle spawn (extracted MeleeStrike): the SwingComboEffects
  // trace spawns at the hit frame with its OWN lifetime — one particle per
  // hit, irrespective of contact. The shipped particle is spawned AT THE
  // FIGHTER's symbol origin — center-x at the feet line — and mirrored about
  // that axis by the facing captured right here (particle ScaleX = LastDirX);
  // the art hangs off its own registration point (MELEE_TRACE_ANCHORS), so
  // the red arc paints around the torso instead of sliding sideways when the
  // fighter faces left (the crop bbox is not the registration).
  Player.prototype.startMeleeTrace = function () {
    var shape = this.equipped && this.equipped.shape;
    var ids = shape && MELEE_TRACE_IDS[shape];
    if (!ids) return; // fists have no slash trace
    this.meleeTrace = {
      shape: ids[Math.min(COMBO_LINKS, this.punchComboNr || 1) - 1],
      dir: this.lastDirX,
      x: this.x + this.w / 2, // fighter's center axis captured at the hit
      y: this.y + this.h, // feet line captured at the hit
      clock: 0
    };
  };

  // Weapon-combo animation stretch (see MELEE_ANIM_SLOW): melee weapons swing
  // their shipped cells; every timing that gates the swing (link length, hit
  // frame, chain window and the render cell hold) scales by the same factor.
  // Fists (no shape / no swing cells) keep the vanilla punch cadence.
  Player.prototype.meleeAnimScale = function () {
    return (
      this.equipped &&
      this.equipped.shape &&
      MELEE_ATTACK_LINKS[this.equipped.shape]
    ) ? MELEE_ANIM_SLOW : 1;
  };

  Player.prototype.tryPunchHit = function (other) {
    if (!other) return;
    if (other.rolling) return; // rolling dodges melee
    if (other.knockbackRoll) return; // a tumbling body is out of reach
    if (other.knockedDown && other.onGround) return; // no beat-down on a lying body
    if (!this.meleeConnects(other)) return;
    if (this.punchTradeWith(other)) {
      // The swing is spent either way; the coin flip picks the winner
      if (Math.random() < 0.5) this.applyPunch(other);
      else { this.stunTimer = TRADE_STUN; this.getHitClock = 0; } // sprite-only: pose timeline restarts
      return;
    }
    this.applyPunch(other);
  };

  // NOTE (verified in the artifact): the artifact's Disarm() is CheckAimDrop(true) —
  // it only affects AIMING states: AimMode 0 aborts ranged-weapon aim (the gun falls),
  // AimMode 1 drops a held throwable. Melee weapons are never dropped by punches.

  Player.prototype.dropGunItem = function (forced, vanish) {
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
      ttl: (forced && !vanish) ? 0 : 45 // empty / punched-out gun falls, blinks and disappears
    });
    this.ranged = null;
  };

  // mode: "keep" = explosion/impact/projectile/fire: aim cancels but the gun stays
  // equipped; "vanish" = melee blow (punch/kick): the gun drops, falls and vanishes
  // Aim has absolute priority over every other grounded action. A FIRE/THROW
  // press (or hold) arms the aim BEFORE movement is resolved this step, so the
  // current run / sprint / melee swing is cancelled immediately. While airborne
  // a held key is buffered (startAimASAP) and fires on touchdown.
  Player.prototype.applyAimPriority = function (controllable) {
    if (!controllable || this.aiming || isUltraInstinct(this)) return;
    if (this.throwAimBlockTimer > 0) return; // just thrown: holding a key cannot arm the aim yet
    var fireHeld = !!keys[this.binding.fire];
    var throwHeld = !!keys[this.binding.throw];
    if (!fireHeld && !throwHeld) return;
    var canAimGun = fireHeld && !!this.ranged;
    var canAimThrow = throwHeld && !!this.throwable && this.throwable.ammo > 0;
    if (!canAimGun && !canAimThrow) return;
    if (!this.onGround) {
      this.startAimASAP = true; // buffered until landing
      return;
    }
    // Only a fresh press interrupts; a key held through other actions arms it
    // as soon as those finish (startAimASAP keeps the intent buffered).
    if (this.punching) {
      this.punching = false;
      this.punchFrame = 0;
      this.punchQueued = false;
      this.punchComboNr = 1;
    }
    this.sprinting = false;
    this.running = false;
    this.airVelocityX = 0; // drop the run/sprint momentum on the same frame
    if (canAimGun) {
      this.aiming = true;
      this.aimMode = 0;
    } else {
      this.aiming = true;
      this.aimMode = 1;
      this.throwTimer = GRENADE.throwTimer;
    }
    this.startAimASAP = false;
  };

  Player.prototype.abortAiming = function (forced, mode) {
    // CheckAimDrop(true): AimMode 0 drops the gun (empty or forced);
    // AimMode 1 cancels a held grenade.
    this.aiming = false;
    this.startAimASAP = false;
    if (this.aimMode === 0) {
      if (mode !== 'keep' && this.ranged && (this.ranged.ammo <= 0 || forced)) this.dropGunItem(forced, mode === 'vanish');
    }
    this.aimMode = 0;
    this.aimPitch = 0;
  };

  // World position of the aim-sprite muzzle/grip point: the aiming UPPER BODY
  // rotates by the aim pitch around the SHOULDER joint measured inside the
  // piece (sx/sy) and sways a few px with the pitch (AIM_SWAY_*), so the
  // weapon tip follows the same transform, mirrored for the left facing.
  // Returns null while not aiming (or without a mapping) — callers keep the
  // procedural muzzle fallback for that case.
  Player.prototype.aimMuzzlePoint = function (dir) {
    var def = aimSpriteDefFor(this);
    if (!def) return null;
    var k = this.h / 21; // the shared sprite scale (base sprite height 21)
    // the shoulder joint + sway, in anchor units
    var aimT = Math.abs(this.aimPitch) / AIM_PITCH_MAX; // 0..1 at the extremes
    var sway = this.aimPitch < 0 ? AIM_SWAY_UP : AIM_SWAY_DOWN;
    var shoulderX = (AIM_TOP_X + def.sx + sway.x * aimT) * k;
    var shoulderY = (AIM_TOP_Y - (def.h - def.sy) + sway.y * aimT) * k;
    // muzzle tip relative the shoulder (canvas units, y down)
    // MUST mirror drawPlayerSprite's placement: the image top-left sits at
    // (shoulder - sx, shoulder - (h - sy)) * k, so an image point (mx, my)
    // lands at shoulder + ((mx - sx), (my - (h - sy))) * k — matching the
    // formula below keeps the bullet exiting the drawn barrel mouth for
    // every piece (the pieces where sy == h - sy agreed only by coincidence).
    var tx = (def.mx - def.sx) * k;
    var ty = (def.my - (def.h - def.sy)) * k;
    var th = (this.aimPitch * Math.PI) / 180;
    var rx = tx * Math.cos(th) - ty * Math.sin(th);
    var ry = tx * Math.sin(th) + ty * Math.cos(th);
    var ox = shoulderX + rx;
    var oy = shoulderY + ry;
    var muzzleX = dir > 0 ? this.x + this.w / 2 + ox : this.x + this.w / 2 - ox;
    var muzzleY = this.y + this.h + oy;
    // a def without a usable grip point must fall back, never poison the world with NaN
    if (!isFinite(muzzleX) || !isFinite(muzzleY)) return null;
    return { x: muzzleX, y: muzzleY };
  };

  // One shot of the weapon's ammo (single bullet or one flame puff)
  Player.prototype.spawnShot = function (gun, alpha, dir) {
    playGunFireSound(gun);
    var m = this.aimMuzzlePoint(dir);
    var muzzleX = m ? m.x : (dir > 0 ? this.x + this.w + 6 : this.x - 6);
    var muzzleY = m ? m.y : this.y + 16;
    var shotId = ++nextShotId; // pellets of one trigger pull share it
    for (var i = 0; i < gun.pellets; i++) {
      var deflection = ((Math.random() * 2 - 1) * gun.spread * Math.PI) / 180;
      var speed = gun.speed * TIME_SCALE;
      var a = alpha + deflection;
      if (gun.flame) {
        // FLAME (extracted Fires.AddFlame): a fire node launched at 9-10 px per
        // 24 fps tick along the aim (+-6 deg). It glides under drag (reach ~140
        // px), then falls; touching a solid it lands as ground fire. No bullet
        // damage: contact feeds the burn meter (see updateFlames).
        var flameSpeed = (9 + Math.random()) * 24 / FPS;
        flames.push({
          x: muzzleX, y: muzzleY,
          vx: Math.cos(a) * flameSpeed * dir,
          vy: Math.sin(a) * flameSpeed,
          life: FLAME_NODE_LIFE, damage: gun.damage,
          owner: this.id, hit: {}, size: 4 + Math.random() * 3,
          slowing: true, thrower: true
        });
      } else {
        bullets.push({
          x: muzzleX, y: muzzleY,
          vx: Math.cos(a) * speed * dir,
          vy: Math.sin(a) * speed,
          damage: gun.damage,
          critDamage: gun.critDamage,
          crit: Math.random() * 100 < gun.critChance,
          owner: this.id,
          trail: [],
          rocket: !!gun.rocket,
          impulse: gun.impulseForce || DEFAULT_BULLET_IMPULSE,
          knockbackRule: gun.knockbackRule || BULLET_KNOCKBACK_RULE.NONE,
          shotId: shotId,
          pelletCount: gun.pellets
        });
        if (gun.rocket) {
          // ProjectileData: the rocket keeps a launch ANGLE (UpdateRockets
          // wobbles ±4 deg around it and the rider steers it), an avoided
          // list preloaded with the owner (NewRocket AddPlayerAvoided), and
          // no rider until it hooks a victim (ride mechanic).
          var _rb = bullets[bullets.length - 1];
          _rb.rideAngle = Math.atan2(_rb.vy, _rb.vx) * 180 / Math.PI;
          _rb.rideSpeed = Math.sqrt(_rb.vx * _rb.vx + _rb.vy * _rb.vy);
          _rb.avoided = [this.id];
          _rb.rider = null;
          _rb.hidden = false;
          _rb.exploded = false;
          _rb.pendingExplode = false;
        }
      }
    }
  };

  // StuckToProjectile (extracted): a rocket that hooks the fighter disarms
  // them (aim abort + forced drop), parks them ON the rocket and — on the
  // caller side — freezes the world with the dramatic slow cam. The rider
  // steers with LEFT/RIGHT until the rocket detonates (always the ride's end).
  Player.prototype.stuckToProjectile = function (rocket) {
    if (this.grabbedPlayerNr) this.dropGrabbed(false); // DropGrabbedPlayer
    this.abortAiming(true, "keep"); // Disarm + CancelAFS: the ride forbids aiming
    this.punching = false;
    this.punchFrame = 0;
    this.running = false;
    this.sprinting = false;
    this.rocketRide = { rocket: rocket, timer: 0 };
  };

  // Weapon-raise delay: arming a ranged weapon starts a short preparation
  // window during which the pre-aim sprites play and firing is blocked.
  Player.prototype.isAimPreparing = function () {
    return this.aiming && this.aimMode === 0 && this.aimPrepTimer > 0;
  };

  Player.prototype.tickAimPreparation = function () {
    var armedNow = this.aiming && this.aimMode === 0 && !!this.ranged;
    var throwAimNow = this.aiming && this.aimMode === 1 && !!this.throwable;
    if (throwAimNow && !this.throwAimWasActive) {
      // grenade: pin pulled; molotov: the rag is lit
      playSfx(this.throwable.type === 'molotov' ? SFX.MOLOTOV_IGNITE : SFX.GRENADE_PIN);
    }
    this.throwAimWasActive = throwAimNow;
    if (armedNow && !this.aimWasActive) {
      playGunAimSound(this.ranged.gun);
      this.aimPrepTimer = AIM_PREPARATION_SPRITES[this.ranged.gun.shape] ? AIM_PREPARATION_STEPS : 0;
      this.fireQueuedDuringPrep = false;
    } else if (!armedNow) {
      this.aimPrepTimer = 0;
      this.fireQueuedDuringPrep = false;
    } else if (this.aimPrepTimer > 0) {
      this.aimPrepTimer--;
      if (this.aimPrepTimer <= 0 && this.fireQueuedDuringPrep) {
        this.fireQueuedDuringPrep = false;
        if (!this.aimTurningAroundDelay()) this.fireWeapon();
      }
    }
    this.aimWasActive = armedNow;
  };

  // Dry fire: no projectile; the weapon's own empty-chamber click plus a short
  // backward flinch of the character and gun, in sync on every trigger pull.
  Player.prototype.dryFire = function () {
    playSfx(DRY_FIRE_SFX_BY_SHAPE[this.ranged.gun.shape] || SFX.NO_AMMO_LIGHT);
    this.dryFireKickTimer = DRY_FIRE_KICK_FRAMES;
  };

  // 0..1 flinch intensity: snaps back at once, eases out over the kick frames
  Player.prototype.dryFireKickAmount = function () {
    return this.dryFireKickTimer / DRY_FIRE_KICK_FRAMES;
  };

  Player.prototype.fireWeapon = function () {
    // FireWeapon: cooldown gate; empty -> the gun is tossed forward; burst
    // weapons (rifle/uzi: extracted FireSequence of 5 shots) queue the rest
    if (this.weaponCooldown > 0 || !this.ranged) return;
    if (this.isAimPreparing()) { this.fireQueuedDuringPrep = true; return; }
    var gun = this.ranged.gun;
    if (this.ranged.ammo <= 0) {
      // Releasing the aim trigger is the moment the empty gun is discarded
      // (toss: 2*dir, -1); the click + flinch already played on the pull
      this.dropGunItem(false);
      this.aiming = false;
      this.aimPitch = 0;
      this.aimPitchSpeed = 0;
      return;
    }
    this.weaponCooldown = gun.cooldown;
    this.muzzleFlash = 2;
    this.aimHoldTimer = AIM_HOLD_TIME; // every shot keeps the aim alive
    var alpha = (this.aimPitch * Math.PI) / 180;
    var dir = this.lastDirX;
    this.spawnShot(gun, alpha, dir);
    this.ranged.ammo--;
    if (gun.burst > 1) {
      this.burstQueue = gun.burst - 1;
      this.burstTimer = gun.burstInterval;
    }
  };

  function weaponItemNearby(p) {
    for (var i = 0; i < weaponItems.length; i++) {
      var it = weaponItems[i];
      if (it.taken || it.pickupDelay > 0) continue;
      var k = it.weapon.kind;
      if (k !== 'melee' && k !== 'gun' && k !== 'throwable') continue;
      if (rectsOverlap(p.getBounds(), { x: it.x - 8, y: it.y - 12, w: 16, h: 16 })) return it;
    }
    return null;
  }

  // Burst continuation (rifle/uzi FireSequence): one queued shot per interval
  Player.prototype.updateBurst = function () {
    if (this.burstQueue <= 0 || !this.ranged) return;
    this.burstTimer--;
    if (this.burstTimer > 0) return;
    this.burstTimer = this.ranged.gun.burstInterval;
    this.burstQueue--;
    this.ranged.ammo--;
    this.muzzleFlash = 2;
    var alpha = (this.aimPitch * Math.PI) / 180;
    this.spawnShot(this.ranged.gun, alpha, this.lastDirX);
  };

  Player.prototype.releaseThrowable = function () {
    // ReleaseThrowable: 5.5 px/frame along the aim angle with -2 up bias
    if (!this.throwable || this.throwable.ammo <= 0) {
      this.aiming = false;
      return;
    }
    var alpha = (this.aimPitch * Math.PI) / 180;
    var dir = this.lastDirX;
    var m = this.aimMuzzlePoint(dir);
    var relKey = this.throwable.type === 'molotov' ? 'molotov' : 'grenade';
    // Spawn at the RELEASE pose's hand: the shipped full-body release lean
    // (699, shared by grenade and molotov) supplies the grip point in its own
    // coords, mapped through the same feet/scale/mirror transform that
    // drawPlayerSprite uses to show the pose (unrotated: no aim pitch).
    // Fall back to the aim sprite's grip point, then the extracted stand-in,
    // whenever the release frame is not resolvable.
    var sp = null;
    var _hand = THROW_RELEASE_HAND[relKey];
    var _relImg = spriteImages[THROW_RELEASE_SPRITES[relKey]];
    if (_hand && _relImg && _relImg.complete && _relImg.naturalWidth) {
      var k = this.h / SPRITE_BASE_HEIGHT;
      var sw = _relImg.naturalWidth * k;
      sp = {
        x: this.x + this.w / 2 + (this.lastDirX < 0 ? -1 : 1) * (_hand.x * k - sw / 2),
        y: this.y + this.h - _relImg.naturalHeight * k + _hand.y * k
      };
    }
    if (!sp) sp = m || { x: this.x + this.w / 2 - 4.5 * dir, y: this.y + this.h / 2 - 7.5 };
    var isFragGrenade = relKey !== 'molotov';
    var throwScale = isFragGrenade ? GRENADE_THROW_SPEED_SCALE : 1;
    var liftScale = isFragGrenade ? GRENADE_THROW_LIFT_SCALE : 1;
    grenades.push({
      type: this.throwable.type || 'grenade',
      x: sp.x,
      y: sp.y,
      vx: GRENADE.throwSpeed * throwScale * Math.cos(alpha) * dir,
      vy: GRENADE.throwSpeed * throwScale * Math.sin(alpha) + GRENADE.upBias * liftScale,
      fuse: this.throwTimer,
      spin: 0,
      owner: this.id,
      age: 0
    });
    playSfx(relKey === 'molotov' ? SFX.MOLOTOV_THROW : SFX.GRENADE_THROW);
    this.throwTimer = 0;
    this.throwable.ammo--;
    // Hold the shipped release frame a few steps while the shot flies
    this.throwPose = 8;
    this.throwPoseType = relKey;
    this.throwAimBlockTimer = THROW_AIM_BLOCK_STEPS; // a short lockout before the next aim
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
      if (platformIsOneWay(plat) || plat.ladder || plat.glass || !plat.solidSides) continue;
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
    playSfx(SFX.JUMP);
    return true;
  };

  Player.prototype.calculateAimSquare = function (other) {
    // CalculateAimSquare (extracted): cast a ray from the muzzle in 2px steps
    // up to AIM_SQUARE_DISTANCE (8) steps; stops at platforms, players, or the
    // world's edge - the aim square floats at the last clear point
    var alpha = (this.aimPitch * Math.PI) / 180;
    var dx = Math.cos(alpha) * this.lastDirX;
    var dy = Math.sin(alpha);
    var m = this.aimMuzzlePoint(this.lastDirX);
    var cx = m ? m.x : (this.lastDirX > 0 ? this.x + this.w + 6 : this.x - 6);
    var cy = m ? m.y : this.y + 16;
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
    playSfx(SFX.DIVE_CATCH);
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
    if (other.aiming) other.abortAiming(true, 'vanish'); // the tackle knocks the gun out, same as a melee blow
    other.hitFlash = 6;
    other.getHitClock = 0; // sprite-only: restart the getHit pose timeline
    // TACKLE CATCH: the victim is GRABBED and dragged along the dive
    // (extracted: GrabbedPlayerNr auto-arms _grabbed_player + GRABBED anim)
    if (this.hp > 0) {
      this.grabbedPlayerNr = other.id;
      other.grabbedByPlayer(this);
    }
  };

  // Slide the fighter flush against the cover face (2 px/step, no teleport).
  // Works against any ICoverable rect (crates today, barrels tomorrow).
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

  Player.prototype.startKnockbackRoll = function (impactDir) {
    // Knockback roll (requested): the ragdoll hands over to a ground tumble.
    // airVelocityX stays ALIVE — the roll bleeds it to zero through friction,
    // while knockbackRollDir (the impact's velocity sign or the body facing
    // when the impact was pure vertical) drives the sprite flip each frame.
    var vx = this.airVelocityX;
    this.knockbackRoll = true;
    this.knockbackRollFrame = 0;
    this.knockbackRollAngle = 0; // every tumble starts rolling from square one
    this.knockbackRollDir = Math.abs(vx) >= 1e-6
      ? (vx > 0 ? 1 : -1)
      : (impactDir || this.lastDirX || 1);
    this.falling = false; // the ragdoll flight ends; the tumble owns the body
    this.jumping = false;
    this.rolling = false; // a voluntary roll over an edge hands off to the tumble
    this.rollFrame = 0;
    this.rollFromDive = false;
    this.diving = false; // a tackle that crashes into a solid ends right here
    this.blastRollPending = 0; // the pending blast roll is consumed by this tumble
  };

  // Slam-grade touchdown (requested trigger: a fall from GREAT height hitting
  // the GROUND with a brusque vertical component): the body pops off the floor
  // and tumbles, keeping its arrival momentum so friction (not a hard stop)
  // bleeds the speed to zero. The pop mirrors the blast touchdown: the tumble
  // needs a beat of airtime to read as a bounce off the floor.
  Player.prototype.startKnockbackGroundRoll = function () {
    this.onGround = false;
    this.groundedPlatform = null;
    this.groundedCrate = null;
    this.groundedBarrel = null;
    this.airVelocityY = -KNOCKBACK_ROLL_POP;
    this.startKnockbackRoll(); // dir falls back to the facing when vx ~ 0
  };

  // Called from the horizontal collision resolution, right where the wall
  // clamp happens. Returns true when the impact crossed the tumbling
  // threshold (the rebound is already written into airVelocityX).
  // GATE: a launched (Falling) ragdoll tumbles from any brisk hit above
  // KNOCKBACK_ROLL_WALL_SPEED; a CONTROLLED fighter tumbles from a grounded
  // sprint crash or a dive slam (KNOCKBACK_ROLL_PLAYER_WALL_SPEED) or from
  // the long-free-fall grade (KNOCKBACK_ROLL_FREEFALL_VY, great height and
  // real drift INTO the surface). Plain AIRBORNE drift never tumbles: air
  // control climbs past the sprint bar within a few steps of a held
  // direction (cap 2 * RunSpeed = 3.4 sits ABOVE the 3.0 bar), so every
  // directional jump or ledge walk-off slamming a wall used to tumble
  // (user bug report) — those now keep the plain stop-and-slide.
  Player.prototype.tryKnockbackRollWall = function (wallDir, allowSprintCrash) {
    if (allowSprintCrash === undefined) allowSprintCrash = true;
    if (this.knockbackRoll || this.hp <= 0) return false;
    var speed = Math.abs(this.airVelocityX);
    if (this.falling) {
      // launched ragdoll: any brisk slam into the world tumbles
      if (speed < KNOCKBACK_ROLL_WALL_SPEED) return false;
    } else {
      // controlled body: sprint/dive bar OR long-free-fall wall slam
      // A diving tackle never tumbles off a wall or crate: it just stops.
      if (this.diving) return false;
      var airborne = !this.onGround;
      var longFallCrash = airborne &&
        Math.abs(this.airVelocityY) >= KNOCKBACK_ROLL_FREEFALL_VY &&
        speed >= KNOCKBACK_ROLL_FREEFALL_VX;
      if (airborne && !this.diving && !longFallCrash) return false;
      // A crate is a pushable prop, not a wall: a ground sprint crash into it
      // must NOT tumble — it just stops the body and the run keeps going.
      if (!allowSprintCrash && !airborne && !this.diving) return false;
      if (speed < KNOCKBACK_ROLL_PLAYER_WALL_SPEED && !longFallCrash) return false;
    }
    // Rebound: keep a KNOCKBACK_ROLL_BOUNCE share of the impact speed pushing
    // AWAY from the wall so the roll leaves the surface it just slammed (the
    // flip and the spin follow that rebound — bounce to the opposite side).
    this.airVelocityX = -wallDir * speed * KNOCKBACK_ROLL_BOUNCE;
    this.startKnockbackRoll(-wallDir);
    return true;
  };

  // True when the tackle's ground travel was stopped this step by a solid
  // side (wall platform clamp) or by a crate in front of the body.
  Player.prototype.tackleRollBlockedBySolid = function (startX, intendedStepX) {
    if (Math.abs(this.x - startX) < Math.abs(intendedStepX) - 1e-6) return true; // level clamp / wall
    var bounds = this.getBounds();
    var reach = intendedStepX > 0 ? 1 : -1;
    var probe = { x: bounds.x + reach, y: bounds.y, w: bounds.w, h: bounds.h };
    for (var ti = 0; ti < crates.length; ti++) {
      var crateAhead = crates[ti];
      if (crateAhead.dead) continue;
      if (!(this.y + this.h > crateAhead.y + 2)) continue; // beside, not on top
      if (rectsOverlap(probe, crateAhead)) {
        this.x = reach > 0 ? crateAhead.x - this.w : crateAhead.x + crateAhead.w;
        return true;
      }
    }
    return false;
  };

  Player.prototype.checkFallOnPlayer = function (other) {
    // A hard fall that lands on top of a grounded fighter: the lower fighter
    // takes a little damage and both collapse into the knockdown animation.
    // Returns true when the crush fired (the caller then skips its own
    // tumble: the shipped both-collapse owns the landing).
    if (!other || other.hp <= 0 || !other.onGround || other.grabbedBy) return false;
    var myCx = this.x + this.w / 2;
    var theirCx = other.x + other.w / 2;
    if (Math.abs(myCx - theirCx) > TACKLE_ALIGN_X) return false;
    // Same support level: a landing on a higher shelf must not hit someone below.
    if (Math.abs(this.y + this.h - (other.y + other.h)) > TACKLE_ALIGN_Y) return false;
    other.damage(FALL_ON_PLAYER_DAMAGE);
    other.hitFlash = 6;
    other.getHitClock = 0; // sprite-only: restart the getHit pose timeline
    if (other.aiming) other.abortAiming(true, "keep");
    other.stunTimer = 0;
    other.staggering = false;
    other.punching = false;
    other.rolling = false;
    other.rollFrame = 0;
    other.knockbackRoll = false; // a squashed body cannot keep tumbling
    other.knockbackRollFrame = 0;
    other.knockbackRollAngle = 0;
    other.diving = false;
    other.falling = false;
    other.jumping = false;
    other.airVelocityX = 0;
    other.airVelocityY = 0;
    other.knockedDown = true;
    other.knockedDownFrame = 0;
    return true;
  };

  Player.prototype.grabbedByPlayer = function (grabber) {
    // GrabbedByOtherPlayer(true, dir): CheckAimDrop + CancelAFS + "GRABBED";
    // the victim faces the grabber and loses all control (dragged)
    this.grabbedBy = grabber;
    this.transformationPose = null; // the cutscene never survives a grab
    this.lastDirX = -grabber.lastDirX;
    this.airVelocityX = 0;
    this.airVelocityY = 0;
    this.stunTimer = 0;
    this.staggering = false;
    this.rolling = false;
    this.knockbackRoll = false;
    this.knockbackRollFrame = 0;
    this.knockbackRollAngle = 0;
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
    // AimUp (extracted): accelerate the pitch upward at ±2 deg/tick² (24 fps),
    // scaled to steps so the sweep keeps the artifact's real-time cadence
    if (this.aimPitch > -AIM_PITCH_MAX) {
      if (t !== 0) this.aimPitchSpeed = -t / ANIM_TICKS_TO_STEPS;
      if (this.aimPitchSpeed > 0) this.aimPitchSpeed = 0;
      this.aimPitch += this.aimPitchSpeed; // game_speed = 1
      this.aimPitchSpeed -= AIM_PITCH_ACCEL;
      if (this.aimPitch < -AIM_PITCH_MAX) this.aimPitch = -AIM_PITCH_MAX;
    }
  };

  Player.prototype.aimDown = function (t) {
    // AimDown (extracted): accelerate the pitch downward at ±2 deg/tick²,
    // clamp at +90; same step conversion as aimUp
    if (this.aimPitch < AIM_PITCH_MAX) {
      if (t !== 0) this.aimPitchSpeed = t / ANIM_TICKS_TO_STEPS;
      if (this.aimPitchSpeed < 0) this.aimPitchSpeed = 0;
      this.aimPitch += this.aimPitchSpeed; // game_speed = 1
      this.aimPitchSpeed += AIM_PITCH_ACCEL;
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
    this.dryFireKickTimer = 0;
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
    playSfx(SFX.KICK_HIT);
    // BeingKicked: aimed weapons drop; victim faces the kicker, then 50% knockdown
    if (other.aiming) other.abortAiming(true, "vanish");
    other.lastDirX = -this.lastDirX;
    other.airVelocityX = KICK_KNOCKBACK_X * this.lastDirX;
    other.airVelocityY = KICK_KNOCKBACK_Y;
    other.onGround = false;
    other.groundedPlatform = null;
    other.damage(KICK_DAMAGE); // KickDamage == JumpKickDamage: 4
    other.hitFlash = 6;
    other.getHitClock = 0; // sprite-only: restart the getHit pose timeline
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
      if (plat.glass && !plat.broken && rectsOverlap(box, plat)) {
        // Kick(): ApplyImpulse((dir * KickPower, -KickPower)) — the shards fly
        // with the struck pane (deconstruct defers the shatter one frame)
        var kv = glassKickVelocity(plat, this.lastDirX);
        breakGlassPane(plat, kv.x, kv.y);
      }
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

  // Footsteps (one per stride of ground travel).
  // Pure audio: reads the movement state, never changes it.
  Player.prototype.playMovementSounds = function () {
    var stepped = Math.abs(this.x - this.footstepLastX);
    this.footstepLastX = this.x;
    var walking = this.onGround && this.hp > 0 && !this.rolling && !this.knockedDown && !this.knockbackRoll && !this.grabbedBy;
    if (walking && stepped > 0) {
      this.footstepDistance += stepped;
      if (this.footstepDistance >= FOOTSTEP_STRIDE_PX) {
        this.footstepDistance = 0;
        playSfx(SFX.FOOTSTEP);
      }
    } else if (!walking) {
      this.footstepDistance = 0;
    }
  };

  Player.prototype.update = function (other) {
    // Throw-release pose clock (armed by releaseThrowable): holds the shipped
    // release body frame for a few steps, then the fighter goes back to idle
    if (this.throwPose > 0) this.throwPose--;
    if (this.throwAimBlockTimer > 0) this.throwAimBlockTimer--;
    // Slash-trace particle clock (spawned at the melee hit frame): the shipped
    // particle lives on its own timer — it keeps ticking even while stunned
    if (this.meleeTrace) {
      this.meleeTrace.clock++;
      // Trace life shares the swing's stretch (MELEE_ANIM_SLOW): the shipped
      // artifact ran the trace clip and the pose clip on the same game_speed,
      // so slowing the links must slow the arcs to keep them in phase.
      if (this.meleeTrace.clock >= Math.round(MELEE_TRACE_LIFE * this.meleeAnimScale())) {
        this.meleeTrace = null;
      }
    }
    // Dragged by a grabber: pinned to their front (extracted UpdateGrabbedPlayer:
    // x + 6 * dir, y - 2) - no own physics, no input
    if (this.grabbedBy) {
      var gr = this.grabbedBy;
      this.x = gr.x + gr.w + 6 * gr.lastDirX;
      this.y = gr.y - 2;
      if (this.throwPose > 0) this.throwPose--;
      return;
    }
    // ---------------------------------------------------------------
    // Rocket ride (extracted StuckToRocket block, Player.as 377-397):
    // the fighter is parked on their hooked rocket and steers it with
    // LEFT/RIGHT (±20 deg per game-speed tick). RocketRideTimer counts
    // up; past 150 ticks the rocket detonates on its own — the crash
    // gibs the rider anyway. Everything else skips this step.
    if (this.rocketRide) {
      var ride = this.rocketRide;
      if (!ride.rocket || ride.rocket.exploded || ride.rocket.dead) {
        this.rocketRide = null; // the projectile was detonated elsewhere
      } else {
        ride.timer += gameSpeed / ANIM_TICKS_TO_STEPS; // artifact ticks
        // steering: LEFT curls the nose up, RIGHT dips it down — the
        // canvas y-down angle convention is the artifact's own
        var steer = (ROCKET_STEER_DEG * gameSpeed) / ANIM_TICKS_TO_STEPS;
        if (this.pressRight()) ride.rocket.rideAngle += steer;
        if (this.pressLeft()) ride.rocket.rideAngle -= steer;
        // UpdatePositionToProjectile: glued to the rocket mid, no gravity
        this.x = ride.rocket.x - this.w / 2;
        this.y = ride.rocket.y - this.h / 2;
        this.airVelocityX = 0;
        this.airVelocityY = 0;
        if (ride.timer > ROCKET_RIDE_MAX) {
          ride.rocket.pendingExplode = true; // the ride can not last forever
        }
        return;
      }
    }
    var frameStartX = this.x;
    var groundedAtFrameStart = this.onGround;
    var startingGroundPlatform = this.groundedPlatform;
    if (this.kickCooldown > 0) this.kickCooldown--;
    if (this.kickFlash > 0) this.kickFlash--;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.healGlowTimer > 0) this.healGlowTimer--;
    if (this.fireFlash > 0) this.fireFlash--;
    if (this.stunTimer > 0) this.stunTimer--; // _stunTimer -= game_speed
    if (this.blastRollPending > 0) this.blastRollPending--; // the blast roll window expires
    // Sprite-only pose clock: advances while a hit reaction would render (the
    // getHit poses phase on it); no gameplay code reads it.
    if (this.hitFlash > 0 || this.stunTimer > 0) this.getHitClock++;
    if (this.softLandingTimer > 0) this.softLandingTimer--;
    if (this.portalCooldown > 0) this.portalCooldown--;
    if (this.staggering) {
      this.staggerTimer--;
      if (this.staggerTimer <= 0) this.staggering = false;
    }

    // ---------- Transformation cutscene (mods 5000-5003) ----------
    this.updateTransformationPose();
    // Input gating: stun / ragdoll / lying / rolling / tumbling / the
    // transformation ritual / DEAD lock the player
    var locked =
      this.falling || this.knockedDown || this.rolling || this.knockbackRoll ||
      this.diving || this.hp <= 0 || !!this.transformationPose;
    var controllable = this.stunTimer <= 0 && !locked;
    // ---------- SSJ2 cheat state (abilities, resources, stances) ----------
    this.updateSsj2(controllable, other);
    // ---------- Matrix (The One) cheat state (abilities + stances) ----------
    this.updateMatrix(controllable, other);
    // ---------- Aim priority (absolute): FIRE/THROW pre-empt run, sprint and melee ----------
    this.applyAimPriority(controllable);
    // The DOWN just-press feeds two features (roll/dive and cloud drop-through).
    // Consume it ONCE: reading it twice made the second read always false, so
    // double-DOWN could never arm the drop-through.
    // A roll still reads DOWN: that is how a roll can chain into a cloud drop.
    var downPressed = (controllable || this.rolling) && this.consumeDown();
    // Hold-DOWN chord: DOWN already held and a direction key goes down NOW
    // (both end up pressed together) rolls toward that direction immediately.
    var chordRoll = controllable && this.pressDownKey() &&
      ((this.pressLeft() && !!keysJustPressed[this.binding.left]) ||
       (this.pressRight() && !!keysJustPressed[this.binding.right]));
    if (chordRoll) downPressed = true;
    var dir = 0;
    // The aiming stance owns LEFT/RIGHT (they only turn the aim); the
    // guard pose is rooted: no walking while aiming a gun or cooking a nade.
    // SSJ2 stances (charge/beam/tele-combo) pin the fighter the same way.
    // A melee swing roots the fighter too: only the last link's own lunge moves him.
    if (controllable && !this.aiming && !this.ssjMoveLocked() && !this.meleeMoveLocked()) {
      if (this.pressLeft()) dir -= 1;
      if (this.pressRight()) dir += 1;
    }

    // TakingCover intent (CoverComponent): holding DOWN while flush against
    // a ground-level coverable takes cover instead of rolling.
    this.cover.seek(dir);

    // Roll / dive disambiguation (DOWN key):
    //   running + NOT sprinting -> roll (extracted Roll, costs 5)
    //   sprinting + DOWN -> full dive / tackle (DiveSpeed 2.0, costs 12)
    //   double-tap window (ShortDiveTimer > 0) + DOWN -> short dive (speed 1)
    // NOT while aiming: the aiming stance owns the DOWN key (pitch sweep)
    if (this.shortDiveTimer > 0) this.shortDiveTimer--;
    if (this.rollCooldown > 0) this.rollCooldown--;
    // (extracted: the roll/dive needs a DIRECTION held — standing DOWN is a
    // plain kneel, which is what lets you grab weapons with crouch + MELEE)
    if (
      controllable &&
      !this.aiming &&
      downPressed &&
      this.onGround &&
      !this.rolling &&
      !this.diving &&
      !this.ssjNoRun() &&
      !this.onLadder() &&
      !this.cover.seekTarget &&
      dir !== 0
    ) {
      if (this.sprinting) {
        this.drainEnergy(SPRINT_DIVE_COST);
        this.startDive(false);
      } else if (this.shortDiveTimer > 0) {
        this.shortDiveTimer = 0;
        this.drainEnergy(ROLL_ENERGY_COST);
        this.startDive(true);
      } else if (this.rollCooldown <= 0) {
        // dir !== 0 is already guaranteed: DOWN pressed together with (or just
        // before) a direction must roll even if `running` has not flipped yet
        this.drainEnergy(ROLL_ENERGY_COST);
        this.cover.armRollEnter(); // rolling toward a coverable: roll-into-cover
        this.rolling = true;
        this.rollFromDive = false;
        this.rollCooldown = ROLL_COOLDOWN_STEPS;
        this.rollFrame = 0;
        this.notifyRoll(); // a roll on the floor feeds the fire state machine
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
    // plain Super Saiyan loses the sprint (and the dive window it opens)
    if (this.ssjNoRun()) {
      this.sprinting = false;
      this.sprintArmed = 0;
      this.reSprintWindow = 0;
      this.shortDiveTimer = 0;
    }

    // ---------- Energy drain / regen (OnGround, game_speed = 1) ----------
    // Health-bar trail tick (extracted PlayerState): while the trail window
    // is open the displayed bar glides one step closer to the real HP
    // (_showHealthTimer counts down per tick, idle floor -24).
    if (this.showHealthTimer > BAR_TRAIL_IDLE) {
      this.showHealthTimer -= 1;
      if (this.showHealthTimer >= 0) this.barHP += this.healthBarSpeed;
      if (this.showHealthTimer <= BAR_TRAIL_IDLE) this.showHealthTimer = BAR_TRAIL_IDLE;
    }
    // Passive HP regen (extracted): heal 0.1/step once no damage was taken for
    // HP_DAMAGE_REGEN_DELAY steps. The extracted HP setter refuses every write
    // while dead (_hp <= 0 -> return), so a downed fighter never self-revives
    // — and regen goes THROUGH the setter, keeping the bar glued to HP.
    if (this.hp > 0 && this.hp < 100 && this.hpDamageTimer <= 0) {
      this.setHp(this.hp + HP_REGEN_RATE * this.moveSpeed());
    } else if (this.hpDamageTimer > 0) {
      this.hpDamageTimer -= this.moveSpeed();
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
    // Ladder climb animation clock: advances while climbing so the shipped
    // climb cells (709/710/711) cycle in a loop going up.
    if (this.climbing) this.climbFrame = (this.climbFrame || 0) + TIME_SCALE;
    else this.climbFrame = 0;

    // ---------- Fire state machine tick (delegated to the current state) ----------
    this.updateFire();

    // ---------- Aiming (extracted RangedDown/Up + ThrowDown/Up model) ----------
    if (this.weaponCooldown > 0) this.weaponCooldown--;
    if (this.muzzleFlash > 0) this.muzzleFlash--;
    if (this.dryFireKickTimer > 0) this.dryFireKickTimer--;

    var aimingControllable = controllable && !this.punching && !isUltraInstinct(this); // UI fights bare-handed: no guns, no grenades
    this.tickAimPreparation();
    // Ragdoll / stunned while aiming: forced drop (the gun falls behind you)
    if (this.aiming && !aimingControllable) this.abortAiming(true);

    var aimingControllable = controllable && !this.punching && !isUltraInstinct(this); // UI fights bare-handed: no guns, no grenades
    if (aimingControllable && this.onGround && this.startAimASAP && this.throwAimBlockTimer <= 0) {
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
      // FLAMETHROWER: while aiming with FIRE held, spit fire puffs (the
      // extracted FireSequence fires every step while the trigger holds)
      if (this.ranged && this.ranged.gun.flame && keys[this.binding.fire] &&
          this.aimMode === 0 && this.weaponCooldown <= 0 && this.ranged.ammo > 0 && !this.isAimPreparing()) {
        if (this.flameBurstRemaining <= 0) {
          this.flameBurstRemaining = FLAME_BURST_PUFFS;
          playSfx(SFX.FLAMETHROWER_FIRE); // one hiss per burst, in sync with its first puff
        }
        this.flameBurstRemaining--;
        this.weaponCooldown = this.flameBurstRemaining > 0 ? FLAME_FIRE_INTERVAL : FLAME_BURST_PAUSE_STEPS; // AddFlame every 2 ticks (24 fps)
        this.ranged.ammo--;
        this.spawnShot(this.ranged.gun, (this.aimPitch * Math.PI) / 180, this.lastDirX);
      }
      if (this.ranged && this.ranged.gun.flame && !keys[this.binding.fire]) this.flameBurstRemaining = 0; // a new press starts a new burst
      // BackToIdle tick: with the trigger released, the aim holds for
      // AIM_HOLD_TIME, then drops back to the fighting idle (pitch 0)
      if (this.isAimPreparing()) this.aimHoldTimer = AIM_HOLD_TIME; // the raise never burns the idle hold
      if (!keys[this.binding.fire] && this.aimHoldTimer > 0 && !this.isAimPreparing()) {
          this.aimHoldTimer--;
          if (this.aimHoldTimer <= 0) {
            this.aiming = false;
            this.aimPitch = 0;
            this.aimPitchSpeed = 0;
          }
        }
this.updateBurst();
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
      // Grenade fuse cooks while held; zero -> explodes in your hand.
      // A molotov has no fuse and shows no flame in the hand: only the fixed
      // 703 hold sprite is drawn, and the bottle waits safely for as long as the key is held.
      var holdingMolotov = this.aimMode === 1 && this.throwable && this.throwable.type === 'molotov';
      if (this.aimMode === 1 && !holdingMolotov) {
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
      if (this.throwAimBlockTimer > 0) {
        // just thrown: FIRE is ignored for a moment (no instant re-aim)
      } else if (this.onGround) {
        if (!this.aiming && this.ranged) {
          this.aiming = true;
          this.aimMode = 0;
        }
        if (this.aiming && this.aimMode === 0 && this.ranged && this.ranged.ammo <= 0) this.dryFire();
      } else {
        this.startAimASAP = true;
      }
    }
    // FIRE release: RangedUp -> FireWeapon (AimMode 0). BLOCKED during the
    // turn-around (extracted: a release while turning does not fire).
    if (this.aiming && this.aimMode === 0 && consumeJustReleased(this.binding.fire)) {
      if (!this.aimTurningAroundDelay()) {
        this.fireWeapon();
        // BackToIdle: the aim STAYS with the pitch where it was; the hold
        // timer (reset by every shot) drops it to idle only after 3 s idle
        this.aimHoldTimer = AIM_HOLD_TIME;
      }
    }
    // THROW press: ThrowDown
    if (aimingControllable && consumeJustPressed(this.binding.throw)) {
      if (this.throwAimBlockTimer > 0) {
        // just thrown: the lockout covers THROW too
      } else if (this.onGround) {
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
        this.knockbackRoll || // a tumbling body cannot hold its grab
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
          // (generic release cell: no held throwable type to shape it)
          this.throwPose = 8;
          this.throwPoseType = null;
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
      // Striking out of cover: detach first and swing the pre-cover facing,
      // so the punch/kick aims at the world instead of the prop behind him
      if (this.cover.isAttached()) {
        this.lastDirX = this.cover.openSideDirection();
        this.cover.detach('melee');
      }
      // Extracted Melee(): airborne MELEE queues the jump kick (executes once
      // AirbornTimer >= 2.5); there is no dedicated kick key anymore.
      if (this.jumping && !this.onGround) {
        this.jumpKickQueued = true;
      } else if (this.punching) {
        // Chaining: press again past the link's minimum animation frame
        // (extracted MinPunchComboFrame, separate from the hit frame)
        var chainMinFrame = Math.round(
          COMBO_MIN_FRAME[this.punchComboNr - 1] * this.meleeAnimScale()
        );
        if (
          this.punchFrame >= chainMinFrame &&
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
        // Extended downward so a crate the fighter stands ON (or is crouched on
        // top of) counts as a kick target: a single MELEE press stomps it.
        // Repeated presses fall through to the punch combo via the cooldown gate.
        var kickBox = {
          x: this.lastDirX > 0 ? this.x + this.w : this.x - kickReach,
          y: this.y - 16 * PLAYER_SIZE_SCALE,
          w: kickReach, h: this.h + 16 * PLAYER_SIZE_SCALE + 2
        };
        var kickTarget = null;
        // Standing/crouched on top of a crate: a single MELEE press stomps
        // that crate (the mounted guard is intentionally bypassed here).
        if (this.groundedBarrel && !this.groundedBarrel.dead) {
          // stomp a barrel from above through the dedicated prop path (no
          // damageCrate NaN: barrels carry no hp)
          this.kickCooldown = KICK_COOLDOWN;
          this.kickFlash = KICK_COOLDOWN;
          playSfx(SFX.KICK_SWING);
          shoveBarrel(this.groundedBarrel, this.lastDirX, CRATE_KICK_PUSH_X, CRATE_KICK_PUSH_Y, this, 'kick');
          this.breakGlassInReach(true);
          this.kickTargetHandled = true;
        } else {
          this.kickTargetHandled = false;
          if (this.groundedCrate && !this.groundedCrate.dead) {
            kickTarget = this.groundedCrate;
          } else {
            for (var kci = 0; kci < crates.length; kci++) {
              var kc = crates[kci];
              if (kc.dead) continue;
              if (rectsOverlap(kickBox, kc)) { kickTarget = kc; break; }
            }
          }
        }
        var grabTarget = this.pressDownKey() && weaponItemNearby(this);
        if (!grabTarget && !kickTarget && kickGrenadesInReach(this)) {
          this.kickCooldown = KICK_COOLDOWN;
          this.kickFlash = KICK_COOLDOWN;
          playSfx(SFX.KICK_SWING);
        } else if (grabTarget) {
          // extracted Melee(): CanGrabWeapon && KneelPressed -> GrabWeapon()
          // returns without starting a punch — the pickup pass swaps the slot
        } else if (kickTarget && !this.meleeConnects(other)) {
          this.kickCooldown = KICK_COOLDOWN;
          this.kickFlash = KICK_COOLDOWN;
          playSfx(SFX.KICK_SWING);
          damageCrate(kickTarget, KICK_DAMAGE, this.lastDirX * CRATE_KICK_PUSH_X, CRATE_KICK_PUSH_Y, meleeContact(this, 'kick'));
          applyMeleeRecoil(this, kickTarget, CRATE_KICK_PUSH_X);
          playSfx(SFX.CRATE_HIT);
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

    // ---------- Consumable slowmo (requested): press-to-activate ----------
    // The CONSUME key pops the banked pickup (Player.update order note: this
    // read runs BEFORE the walk-over pass, so pressing while stepping onto a
    // fresh pickup banks it instead of firing it the same frame).
    if (controllable && (this.carriedSlowmo || this.carriedHealth) && consumeJustPressed(this.binding.consume)) {
      if (this.nextConsumableKind() === 'health') {
        this.setHp(this.hp + this.carriedHealth.ammo);
        playSfx(SFX.HEALTH_PICKUP);
        this.healGlowTimer = HEAL_GLOW_STEPS;
        this.carriedHealth = null;
      } else {
        startItemSlowmo(this.carriedSlowmo.time);
        this.carriedSlowmo = null;
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
      playSfx(SFX.KICK_SWING);
      this.tryKickHit(other);
      kickGrenadesInReach(this);
      this.breakGlassInReach(true);
      hitCratesInReach(this, KICK_RANGE * PLAYER_SIZE_SCALE, KICK_DAMAGE, CRATE_KICK_PUSH_X, CRATE_KICK_PUSH_Y, 'aerialKick');
      hitBarrelsInReach(this, KICK_RANGE * PLAYER_SIZE_SCALE, KICK_DAMAGE, CRATE_KICK_PUSH_X, CRATE_KICK_PUSH_Y, 'aerialKick');
    }

    // ---------- Punch animation progression ----------
    // (extracted: the punch animation is driven inside the !IsStunned gate,
    // so a stun mid-combo freezes the swing until the stun clears)
    if (this.punching && this.stunTimer <= 0) {
      // Weapon swings stretch the whole link (MELEE_ANIM_SLOW): longer hold
      // per link and a proportionally later hit and chain window so the
      // poses and the slash trace stay in phase.
      var animScale = this.meleeAnimScale();
      var linkFrames = Math.round(PUNCH_ANIM_FRAMES * animScale);
      this.punchFrame++;
      // Combo 3 lunge: PunchGlideSpeed * (1 - progress)
      if (this.punchComboNr === COMBO_LINKS) {
        var progress = this.punchFrame / linkFrames;
        this.x += this.lastDirX * PUNCH_GLIDE_SPEED * (1 - progress);
        this.clampToPlatformsX();
      }
      // Hit lands at the link's hit frame, once per link
      var linkHitFrame = Math.round(COMBO_HIT_FRAME[this.punchComboNr - 1] * animScale);
      if (
        this.punchFrame >= linkHitFrame &&
        !this.punchHitPerformed
      ) {
        this.punchHitPerformed = true;
        playSfx(SFX.PUNCH_SWING);
        this.startMeleeTrace();
        this.tryPunchHit(other);
        this.breakGlassInReach(false);
        hitCratesInReach(this, this.equipped.range[this.punchComboNr - 1] * PLAYER_SIZE_SCALE, this.equipped.damage[this.punchComboNr - 1], CRATE_PUNCH_PUSH_X, CRATE_PUNCH_PUSH_Y);
        hitBarrelsInReach(this, this.equipped.range[this.punchComboNr - 1] * PLAYER_SIZE_SCALE, this.equipped.damage[this.punchComboNr - 1], CRATE_PUNCH_PUSH_X, CRATE_PUNCH_PUSH_Y);
      }
      if (this.punchFrame >= linkFrames) {
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

    // ---------- Cover state (CoverComponent-driven) ----------
    // Attaching: ROLL toward a coverable within the interaction range, or
    // kneel (hold DOWN) flush against one. Aim + fire run normally from
    // cover; as soon as the attack ends the cover pose snap back on by
    // itself. Movement is locked either way: the fighter stays glued.
    var coverHold = this.cover.update(controllable, dir);
    this.inCover = coverHold && this.hp > 0;
    this.crouching = (this.inCover && !this.aiming) ||
      (controllable && this.onGround && this.pressDownKey() && dir === 0 &&
      !this.aiming && !this.rolling && !this.diving && !this.climbing && this.hp > 0);
    if (this.inCover) {
      // stay flush: slide 2 px/step toward the cover face (no teleport)
      this.snapToCover(this.cover.target, dir);
      if (!this.aiming) {
        // back against the cover: face the open side (away from it)
        this.lastDirX = this.cover.openSideDirection();
        this.coverAimFacingApplied = false;
      } else if (!this.coverAimFacingApplied) {
        // FIRE press from cover: swing round and aim over the prop
        // (one-shot, so the player can still turn the aim afterwards)
        this.lastDirX = this.cover.coverFacingDirection();
        this.coverAimFacingApplied = true;
      }
    } else {
      this.coverAimFacingApplied = false;
    }

    // ---------- Movement ----------
    if (this.crouching || this.inCover) {
      this.airVelocityX = 0; // covered (or kneeling): glued, no foot movement
      // an in-air SSJ2 charge keeps floating: the stance owns the velocity
      if (this.ssjCharging) this.airVelocityY = 0;
    } else if (dir !== 0 && !this.matrixWallRunning) {
      // Matrix wall run pins the body to the surface: the air drift must not
      // pry it off the wall (the driver owns the stance velocity)
      if (dir < 0) this._portalLocked = false;
      this.lastDirX = dir;
      if (this.onGround) {
        this.airVelocityX = dir * (this.sprinting ? SPRINT_RUN_SPEED : PLAYER_RUN_SPEED) * this.ssjSpeedMult();
      } else {
        this.airVelocityX += dir * AIR_CONTROL_FACTOR * (this.sprinting ? SPRINT_RUN_SPEED : PLAYER_RUN_SPEED);
        // The air cap must not eat dive momentum (Dive adds its 2.0 directly)
        if (!this.diving) {
          var maxAirX = this.ssjFlying ? SSJ2_FLIGHT_SPEED : 2 * PLAYER_RUN_SPEED;
          if (this.airVelocityX > maxAirX) this.airVelocityX = maxAirX;
          if (this.airVelocityX < -maxAirX) this.airVelocityX = -maxAirX;
        }
      }
    } else if (this.ssjFlying && controllable) {
      // flight glide: momentum eases out instead of a hard stop
      this.airVelocityX *= SSJ2_FLIGHT_GLIDE;
      if (Math.abs(this.airVelocityX) < 0.05) this.airVelocityX = 0;
    } else if (this.onGround || (controllable && !this.wallJumping && !this.climbing && this.matrixDodgeTimer <= 0 && this.matrixHopTimer <= 0)) {
      // A knockback roll keeps its momentum: ground friction (below) owns the
      // deceleration; the no-input grounded stop would kill the tumble instantly.
      // The Matrix dodge arc and the wall kick keep hop momentum for their window.
      if (!this.knockbackRoll) this.airVelocityX = 0;
    }

    // Jump (edge-triggered, extracted order: Climbing ? LadderJump : BeginJump)
    // Flight owns UP as ascent: no jump start / wall jump while flying.
    if (controllable && !this.aiming && !this.ssjFlying && this.justUp()) {
      if (this.onGround) this.beginJump();
      else if (!this.tryWalljump()) { /* wall jump first (extracted) */ }
    }
    if (
      !this.ssjFlying && this.jumpPushTimeLeft > 0 &&
      this.pressUp() && !this.climbing
    ) {
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
    // (SSJ2 stances hover instead: flight owns the velocity vector)
    if (!this.onGround && this.airVelocityY === 0 && !this.ssjAirStance()) {
      this.airVelocityY = AIR_FALL_MIN;
    }
    // SSJ2 flight: full vertical control (UP climbs, DOWN dives) with the
    // same damping glide the horizontal axis uses
    if (this.ssjFlying && controllable && !this.ssjMoveLocked() && !this.aiming) {
      if (this.pressUp() && !this.pressDownKey()) {
        this.airVelocityY -= SSJ2_FLIGHT_ACCEL * gameSpeed;
      } else if (this.pressDownKey() && !this.pressUp()) {
        this.airVelocityY += SSJ2_FLIGHT_ACCEL * gameSpeed;
      } else {
        this.airVelocityY *= SSJ2_FLIGHT_GLIDE;
        if (Math.abs(this.airVelocityY) < 0.05) this.airVelocityY = 0;
      }
      if (this.airVelocityY > SSJ2_FLIGHT_SPEED) this.airVelocityY = SSJ2_FLIGHT_SPEED;
      if (this.airVelocityY < -SSJ2_FLIGHT_SPEED) this.airVelocityY = -SSJ2_FLIGHT_SPEED;
    }
    // Wall slide (extracted AbleToWalljump's bound): against a wall while
    // falling, the descent slows to the slide speed — flight ignores it.
    // A slam-grade drift INTO the wall skips the brace: the brace would
    // sanitize the vertical speed before the horizontal clamp evaluates the
    // knockback roll, killing the long-free-fall trigger (great height +
    // real drift into the surface must tumble, not brace).
    var slamDriftIn = !this.onGround &&
      this.airVelocityY >= KNOCKBACK_ROLL_FREEFALL_VY &&
      this.airVelocityX * this.lastDirX >= KNOCKBACK_ROLL_FREEFALL_VX;
    if (
      !this.ssjAirStance() &&
      !this.onGround && this.airVelocityY > WALL_SLIDE_MAX && this.wallContact(this.lastDirX) &&
      !slamDriftIn
    ) {
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
      !this.cover.pending && // a cover-aimed roll lands attached, never drops
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
      else if (this.pressDownKey()) this.airVelocityY = CLIMB_SPEED * 2; // descent is twice as fast as climbing up
      else this.airVelocityY = 0;
      // horizontal movement allowed while on the ladder
    }

    // ---------- Substepped integration (engine-faithful) ----------
    // _ = ceil(TotalAirVelocity); min 1 substep; per substep:
    //   x += h/_; y += c/_; resolve collisions;
    //   if (!Climbing) AirVelocityY += PlayerGravity * game_speed / _;
    // h and c are the per-frame displacements: velocities * game_speed.
    // The Matrix avatar in bullet time reads its own (real-time) pace —
    // moveSpeed() strips the matrix share from the global one.
    this.airVelocityX = clampSpeed(this.airVelocityX, FIGHTER_MAX_AIR_SPEED);
    this.airVelocityY = clampSpeed(this.airVelocityY, FIGHTER_MAX_AIR_SPEED);
    var moveScale = this.moveSpeed();
    var totalAirVelocity = Math.sqrt(
      this.airVelocityX * this.airVelocityX +
        this.airVelocityY * this.airVelocityY
    );
    var steps = Math.ceil(totalAirVelocity);
    if (steps <= 1) steps = 1;

    this.syncRollCollider(); // the roll folds the collider before this step's collisions
    var h = this.airVelocityX * moveScale;
    var c = this.airVelocityY * moveScale;
    var groundedThisFrame = false;
    var landVy = 0;
    var groundedPlatformThisFrame = null;
    var groundedCrateThisFrame = null;
    var groundedBarrelThisFrame = null;

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
        if (plat.glass) {
          // the pane walls you off: only a dive tackle crashes right through
          // (decompiled Dive glass smash). Without the tackle the pane blocks.
          if (this.diving && rectsOverlap(bounds, plat)) {
            breakGlassPane(plat);
            continue; // the smashed pane does not stop the tackle this substep
          }
        }
        if (!rectsOverlap(bounds, plat)) continue;
        var surfaceY = platformBoundaryForSpan(plat, this.x, this.x + this.w, false);
        if (c >= 0 && surfaceY !== null && this.y + this.h <= surfaceY + GROUND_SUPPORT_TOLERANCE) {
          continue; // above the top surface; let vertical collision resolve the landing
        }
        var wasInsideX = prevX < plat.x + plat.w && prevX + this.w > plat.x;
        if (wasInsideX && plat.glass) {
          // The pane never lets a body ride into it (the lift sweeps a rider
          // sideways-overlapped into the pane beside the shaft): push the body
          // out through the nearest face so it stays a solid, impassable wall.
          var gMid = this.x + this.w / 2;
          this.x = gMid < plat.x + plat.w / 2 ? plat.x - this.w : plat.x + plat.w;
          this.airVelocityX = 0;
          h = 0;
          bounds = this.getBounds();
          continue;
        }
        if (wasInsideX) continue;
        if (plat.elevator) continue;
        // Stairs/ramps: a low lip (<= STEP_UP_MAX px) is walked up, never a wall
        if (this.onGround && !plat.glass && !plat.noStep && plat.shape === 'rect' && !this.tumbleLocked) {
          var stepLift = this.y + this.h - plat.y;
          if (stepLift > 0 && stepLift <= STEP_UP_MAX) {
            var stepProbe = { x: this.x, y: plat.y - this.h - 0.01, w: this.w, h: this.h };
            var stepClear = true;
            for (var sqi = 0; sqi < platforms.length; sqi++) {
              var sq = platforms[sqi];
              if (sq === plat || !sq.solidSides || platformIsOneWay(sq) || sq.ladder) continue;
              if (rectsOverlap(stepProbe, sq)) { stepClear = false; break; }
            }
            if (stepClear) {
              this.stepVis = (this.stepVis || 0) + stepLift; // drawn low, eases up the stair
              this.y = stepProbe.y;
              bounds = this.getBounds();
              continue;
            }
          }
        }
        if (h > 0) this.x = plat.x - this.w;
        else if (h < 0) this.x = plat.x + plat.w;
        // Knockback roll (requested): a launched/diving/long-fall body slamming
        // a solid side at speed tumbles off of it; a ground run (sprint) just
        // stops against the wall and keeps running — no rollknoback.
        if (!this.tryKnockbackRollWall(h > 0 ? 1 : -1, false)) this.airVelocityX = 0;
        h = 0;
        bounds = this.getBounds();
      }

      // Vertical substep + resolution
      var subY0 = this.y;
      this.y += c / steps;
      bounds = this.getBounds();
      if (c < 0 && !this.climbing) {
        // rising into a prop's underside: the head bump (the prop gets thrown up)
        var bumped = headBumpTarget(this, subY0);
        if (bumped) {
          var riseSpeed = this.airVelocityY < 0 ? -this.airVelocityY : -c;
          var remainingRise = applyHeadBump(this, bumped, riseSpeed);
          this.y = bumped.prop.y + bumped.prop.h;
          this.airVelocityY = -remainingRise; // keeps rising (negative) or is pushed back down (positive)
          c = 0;
          bounds = this.getBounds();
        }
      }
      for (pi = 0; pi < platforms.length; pi++) {
        plat = platforms[pi];
        if (plat.ladder) continue;
        if (this.climbing) continue; // climbing ignores all platform collisions
        if (plat.glass) continue; // the pane never holds or blocks; contact shatters it
        if (plat.cloud && this.performJumpDown) continue;

        // A landing requires downward motion, horizontal overlap, and the
        // player's FEET crossing the platform's top surface.
        surfaceY = platformBoundaryForSpan(plat, this.x, this.x + this.w, false);
        var previousFeet = subY0 + this.h;
        var currentFeet = this.y + this.h;
        // A rising elevator sweeps its surface up into the feet: judge the
        // crossing against the surface of the previous frame and by RELATIVE
        // motion, so spam-jumping on the lift can never slip through it.
        var elevDy = plat.elevator && plat.prevY !== undefined ? plat.y - plat.prevY : 0;
        var elevRise = elevDy < 0 ? -elevDy : 0;
        if (
          (c > 0 || c + elevRise > 0) &&
          surfaceY !== null &&
          previousFeet <= surfaceY + elevRise + 1.5 * (plat.elevator ? 1 : 0) + 1e-7 &&
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
        // Corner catch: a head that only grazes the block's corner (overlap
        // below HEAD_BUMP_DEPTH) used to slip into the block and stay embedded.
        // Slide it out sideways through the nearest face so the corner is solid.
        var cornerOverlap = Math.min(this.x + this.w, plat.x + plat.w) - Math.max(this.x, plat.x);
        if (
          undersideY !== null &&
          plat.shape === 'rect' && !plat.glass && !plat.elevator &&
          subY0 >= undersideY - 1e-7 &&
          this.y < undersideY &&
          cornerOverlap > 0 && cornerOverlap < HEAD_BUMP_DEPTH
        ) {
          if (this.x + this.w / 2 < plat.x + plat.w / 2) this.x = plat.x - this.w;
          else this.x = plat.x + plat.w;
          bounds = this.getBounds();
          continue;
        }
        if (
          undersideY !== null &&
          subY0 >= undersideY - 1e-7 &&
          this.y < undersideY &&
          Math.min(this.x + this.w, plat.x + plat.w) - Math.max(this.x, plat.x) >= HEAD_BUMP_DEPTH
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
        // Barrels are standable too: same landing-on-top contract as crates
        if (!groundedThisFrame) {
          for (var bi = 0; bi < barrels.length; bi++) {
            var barrel = barrels[bi];
            if (barrel.dead || barrel.burning) continue; // a burning pot is not a perch
            if (!(this.x < barrel.x + barrel.w && this.x + this.w > barrel.x)) continue;
            var bPrevFeet = subY0 + this.h;
            var bCurFeet = this.y + this.h;
            if (c > 0 && bPrevFeet <= barrel.y + 1e-7 && bCurFeet >= barrel.y - 1e-7) {
              this.y = barrel.y - this.h;
              groundedThisFrame = true;
              groundedBarrelThisFrame = barrel;
              landVy = c;
              this.airVelocityY = 0;
              c = 0;
              break;
            }
          }
        }
      }
      // Crates are immovable to footsteps: the fighter runs against them
      // (the walk animation keeps playing) but they never budge. Only hits
      // (punch, kick, jump kick), explosions and a headbutt move a crate.
      for (var ci2 = 0; ci2 < crates.length; ci2++) {
        var crate2 = crates[ci2];
        if (crate2.dead) continue;
        if (!(this.y + this.h > crate2.y + 2)) continue; // beside it, not on top
        var pxb = this.getBounds();
        if (!rectsOverlap(pxb, crate2)) continue;
        if (headPressesProp(this, crate2, false)) continue; // only his head is under it: no wall
        var wasBeside = prevX < crate2.x + crate2.w && prevX + this.w > crate2.x;
        if (wasBeside) continue; // spawned overlapping; vertical handles it
        if (h > 0) this.x = crate2.x - this.w;
        else if (h < 0) this.x = crate2.x + crate2.w;
        // Crates are solid obstacles: launched/diving/long-fall bodies tumble
        // off them, but a ground sprint crash must NOT tumble — it just stops
        // the body so the run keeps going against the box (no rollknoback).
        if (!this.tryKnockbackRollWall(h > 0 ? 1 : -1, false)) this.airVelocityX = 0;
        h = 0;
        bounds = this.getBounds();
        break;
      }

      // Corner safety net: whatever slipped into a solid block's corner this
      // substep (grazing a vertex while jumping) is pushed out along the axis
      // of least penetration, so the geometry stays continuous at its corners.
      if (!this.climbing && !this.tumbleLocked) {
        for (var cpi = 0; cpi < platforms.length; cpi++) {
          var cornerPlat = platforms[cpi];
          if (cornerPlat.shape !== 'rect' || !cornerPlat.solidSides || cornerPlat.ladder ||
              cornerPlat.glass || cornerPlat.elevator || platformIsOneWay(cornerPlat) ||
              cornerPlat === groundedPlatformThisFrame) continue;
          var penX = Math.min(this.x + this.w, cornerPlat.x + cornerPlat.w) - Math.max(this.x, cornerPlat.x);
          var penY = Math.min(this.y + this.h, cornerPlat.y + cornerPlat.h) - Math.max(this.y, cornerPlat.y);
          if (penX <= CORNER_PENETRATION_EPSILON || penY <= CORNER_PENETRATION_EPSILON) continue;
          // Only a block entered THIS substep counts; a body that was already
          // overlapping (spawn/teleport/lift squeeze) is left to the other systems.
          var wasOverlapping = prevX < cornerPlat.x + cornerPlat.w && prevX + this.w > cornerPlat.x &&
            subY0 < cornerPlat.y + cornerPlat.h && subY0 + this.h > cornerPlat.y;
          if (wasOverlapping && (Math.min(penX, penY) > SHALLOW_EMBED_EJECT_MAX || this.inDoorway())) continue;
          if (penX <= penY) {
            this.x += (this.x + this.w / 2 < cornerPlat.x + cornerPlat.w / 2) ? -penX : penX;
          } else if (this.y + this.h / 2 < cornerPlat.y + cornerPlat.h / 2) {
            this.y -= penY;
          } else {
            this.y += penY;
            if (this.airVelocityY < 0) this.airVelocityY = 0;
          }
          bounds = this.getBounds();
        }
      }

      // Dive tackle: checked per substep while diving (extracted flow)
      if (this.diving) this.checkDiveImpact(other);

      // Gravity applied per substep, then velocity recomputed
      // (the extracted gate: Climbing || grounded skips the gravity term;
      // leaving the ladder resumes the normal fall immediately). SSJ2
      // stances station-keep: flight / charge / beam rule out gravity too.
      // Matrix wall running is its own stance: the climb owns the vertical.
      // The transformation ritual freezes the body wherever it stands.
      // Walking off the lift sideways: the body no longer overlaps the lift's
      // span, so the stale contact is dropped (never snap to a null surface,
      // which used to throw the rider to the top of the world).
      var elevRideY = null;
      if (groundedThisFrame && groundedPlatformThisFrame && groundedPlatformThisFrame.elevator && !this.performJumpDown) {
        elevRideY = platformBoundaryForSpan(groundedPlatformThisFrame, this.x, this.x + this.w, false);
        if (elevRideY === null) {
          groundedThisFrame = false;
          groundedPlatformThisFrame = null;
        }
      }
      if (
        !groundedThisFrame && !this.climbing && !this.ssjAirStance() &&
        !this.matrixAirStance() && !this.transformationPose
      ) {
        this.airVelocityY += (((this.jumping && !this.falling) ? PLAYER_JUMP_GRAVITY : PLAYER_GRAVITY) * moveScale) / steps;
        c = this.airVelocityY * moveScale;
      } else if (elevRideY !== null) {
        this.airVelocityY = 0;
        c = 0;
        this.y = elevRideY - this.h;
      }
    }

    // Stairs down: leaving a lip of <= STEP_UP_MAX px keeps the feet on the
    // ground (the body is drawn easing down instead of dropping like a block)
    if (!groundedThisFrame && this.onGround && !this.jumping && !this.falling && !this.climbing &&
        !this.diving && this.airVelocityY >= 0 && h !== 0 && !this.transformationPose) {
      var feet0 = this.y + this.h;
      var bestSurf = null, bestPlat = null;
      for (var sdi = 0; sdi < platforms.length; sdi++) {
        var sdp = platforms[sdi];
        if (!sdp.solidSides || sdp.glass || sdp.ladder || sdp.shape !== 'rect') continue;
        if (this.x + this.w <= sdp.x || this.x >= sdp.x + sdp.w) continue;
        if (sdp.y < feet0 - 0.5 || sdp.y > feet0 + STEP_UP_MAX) continue;
        if (bestSurf === null || sdp.y < bestSurf) { bestSurf = sdp.y; bestPlat = sdp; }
      }
      if (bestPlat) {
        var dropBy = bestSurf - feet0;
        this.y += dropBy;
        this.stepVis = (this.stepVis || 0) - dropBy; // drawn high, eases down
        groundedThisFrame = true;
        groundedPlatformThisFrame = bestPlat;
        this.airVelocityY = 0;
        landVy = 0;
      }
    }
    // the stair ease fades out step by step
    if (this.stepVis) {
      var sv = this.stepVis;
      this.stepVis = Math.abs(sv) <= 1.2 ? 0 : sv - (sv > 0 ? 1.2 : -1.2);
    }

    // Standing check + ragdoll landing (extracted PlayerLands model)
    if (groundedThisFrame) {
      if (!this.onGround && landVy >= LANDING_SOUND_MIN_SPEED) {
        // ragdoll / slam touchdowns thud like a body; a plain hop lands soft
        playSfx(this.falling || landVy >= FALL_TRIGGER_SPEED ? SFX.BODY_FALL : SFX.LAND);
      }
      this.onGround = true;
      this.groundedPlatform = groundedPlatformThisFrame;
      this.groundedCrate = groundedCrateThisFrame;
      this.groundedBarrel = groundedBarrelThisFrame;
      if (this.diving) {
        // Diving landing (extracted): DropGrabbedPlayer() FIRST, then Roll() -
        // the catch is momentary (it only lasts the dive flight) and the dive
        // takes NO fall damage (the impact formula lives in the Falling branch)
        this.diving = false;
        this.jumping = false;
        if (this.grabbedPlayerNr) this.dropGrabbed(false);
        this.rolling = true;
        this.rollFromDive = true;
        this.rollFrame = 0;
        this.notifyRoll(); // the landing roll also feeds the fire machine
        this.drainEnergy(ROLL_ENERGY_COST); // Roll() drains ROLL
      } else if (this.falling) {
        // Ragdoll lands: impact damage, then the touchdown reaction (extracted
        // PlayerLands). Plain launched landings BELOW the slam bar land just
        // like an old fall (a combo or kick flight that hits nothing). THE ONE
        // standing exception (requested): an EXPLOSION blast flight always
        // rolls on touchdown — receiving the blast is a high-impact event by
        // design. A slam-grade touchdown (great height, brusque vertical
        // impact) tumbles too, unless it crushed a fighter underneath.
        // impact = (abs(vy) - 3) * 1.5, zero when below 3
        this.falling = false;
        this.jumping = false;
        var impact = Math.abs(landVy) - 3;
        impact *= 1.5;
        if (impact < 3) impact = 0;
        this.damage(impact);
        var crushed = landVy >= FALL_TRIGGER_SPEED ? this.checkFallOnPlayer(other) : false;
        if (this.blastRollPending > 0) {
          // Blast touchdown: the launch momentum stays ALIVE so the tumble
          // keeps the blast direction, spins and slides away under friction.
          this.blastRollPending = 0;
          this.startKnockbackGroundRoll();
        } else if (!crushed && landVy >= KNOCKBACK_ROLL_FREEFALL_VY) {
          // Slam-grade ground touchdown: pop into the tumble, momentum alive.
          this.startKnockbackGroundRoll();
        } else {
          this.airVelocityX = 0;
          this.knockedDown = true; // IncreaseKnockdownGrade + Knockdowned = true
          this.knockedDownFrame = 0;
        }
      } else if (this.hp > 0 && landVy >= FALL_TRIGGER_SPEED && !this.knockbackRoll) {
        // Slam-grade touchdown (requested trigger: a fall from GREAT height
        // hitting the ground with a brusque vertical component): impact
        // damage, then the body POPS into the knockback tumble and its
        // momentum bleeds away under friction (lying recovery -> get up ->
        // idle). Same-floor jumps and shelf hops land below this bar and keep
        // the soft landing — a run+jump touchdown is still never a tumble
        // (regression-tested). Landing on another fighter keeps the shipped
        // both-collapse instead of the tumble.
        if (this.aiming) this.abortAiming(true, "keep"); // Fall() -> CheckAimDrop
        this.jumping = false;
        var hardImpact = Math.abs(landVy) - 3;
        hardImpact *= 1.5;
        if (hardImpact < 3) hardImpact = 0;
        this.damage(hardImpact); // the touchdown itself costs the extracted impact
        if (this.checkFallOnPlayer(other)) {
          this.airVelocityX = 0;
          this.knockedDown = true;
          this.knockedDownFrame = 0;
        } else {
          this.startKnockbackGroundRoll();
        }
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
        this.groundedBarrel = null; // reset; re-set only if a barrel is found below
        for (var sci = 0; sci < crates.length; sci++) {
          var sc = crates[sci];
          if (sc.dead) continue;
          if (this.x < sc.x + sc.w && this.x + this.w > sc.x &&
              feetY2 >= sc.y - GROUND_SUPPORT_TOLERANCE && feetY2 <= sc.y + GROUND_SUPPORT_TOLERANCE) {
            this.y = sc.y - this.h;
            rideSupport(this, sc); // ride along, as far as the feet grip
            this.onGround = true;
            this.groundedPlatform = null;
            this.groundedCrate = sc;
            support = sc;
            break;
          }
        }
        // barrels are ground support too: stand on the flat top and ride along
        if (support === null) {
          if (this.groundedBarrel && this.groundedBarrel.dead) this.groundedBarrel = null;
          for (var sbi = 0; sbi < barrels.length; sbi++) {
            var sb = barrels[sbi];
            if (sb.dead || sb.burning) continue; // a burning pot is not a perch
            if (this.x < sb.x + sb.w && this.x + this.w > sb.x &&
                feetY2 >= sb.y - GROUND_SUPPORT_TOLERANCE && feetY2 <= sb.y + GROUND_SUPPORT_TOLERANCE) {
              this.y = sb.y - this.h;
              rideSupport(this, sb); // ride along, as far as the feet grip
              this.onGround = true;
              this.groundedPlatform = null;
              this.groundedBarrel = sb;
              support = sb;
              break;
            }
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
      this.knockbackRoll = false; // a dying body ends the tumble right here
      this.knockbackRollFrame = 0;
      this.knockbackRollAngle = 0;
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

    // Roll progression: moves at RollSpeed, ends with its animation.
    // Rolling toward a coverable latches onto it: contact ends the roll
    // attached (roll-into-cover via CoverComponent).
    if (this.rolling) {
      this.rollFrame++;
      var rollStepX = this.lastDirX * (this.rollFromDive ? DIVE_LANDING_ROLL_SPEED : ROLL_SPEED);
      var tackleRollStartX = this.x;
      this.x += rollStepX;
      this.clampToPlatformsX();
      var tackleHitSolid = this.rollFromDive && this.tackleRollBlockedBySolid(tackleRollStartX, rollStepX);
      if (tackleHitSolid) {
        // the ground tackle slams a crate/wall: the push just stops and the
        // roll ends cleanly (no knockback roll)
        this.airVelocityX = 0;
        this.rolling = false;
        this.rollFrame = 0;
        this.rollFromDive = false;
      } else if (this.cover.updateRoll()) {
        this.rolling = false; // latched onto the cover prop
        this.rollFrame = 0;
      } else if (this.rollFrame >= (this.rollFromDive ? DIVE_LANDING_ROLL_FRAMES : ROLL_ANIM_FRAMES)) {
        this.rolling = false;
        this.rollFrame = 0;
        this.cover.tryAttachAfterRoll(); // late latch when it stops close
      }
    }

    // Knockback roll progression (requested): on the ground a constant per-step
    // friction bleeds the impact momentum; once the velocity is (almost) gone —
    // or the cap fires for a body that keeps gliding — the tumble hands the
    // body to the lying knockdown recovery, which itself returns control when
    // its animation ends (idle again).
    if (this.knockbackRoll) {
      this.knockbackRollFrame++;
      // SPIN: thedoll rotates by the rolled distance (artifact bodies rotate
      // with their motion): clockwise tumbling right, ccw tumbling left
      this.knockbackRollAngle += this.airVelocityX * KNOCKBACK_ROLL_SPIN_RATE * this.moveSpeed();
      if (this.onGround) this.airVelocityX *= KNOCKBACK_ROLL_FRICTION;
      var rollSpeed = Math.abs(this.airVelocityX);
      var rollStopped = this.onGround &&
        this.knockbackRollFrame >= KNOCKBACK_ROLL_MIN_FRAMES &&
        rollSpeed <= KNOCKBACK_ROLL_STOP_SPEED;
      var rollCapped = this.knockbackRollFrame >= KNOCKBACK_ROLL_MAX_FRAMES;
      if (rollStopped || rollCapped) {
        this.knockbackRoll = false;
        this.knockbackRollFrame = 0;
        this.knockbackRollAngle = 0; // the lying pose draws unrotated
        this.airVelocityX = 0;
        this.knockedDown = true; // lying recovery -> get up -> idle
        this.knockedDownFrame = 0;
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
    // ranged, throwable; picking up over an occupied slot replaces (deletes) the old weapon.
    // NOTE: the loop iterates a SNAPSHOT length — dropping inside the loop must
    // not feed itself. Fresh drops carry pickupDelay (grace before re-grab).
    // Weapons: extracted CanGrabWeapon — walk-over only picks HEALTH and
    // POWERUPS. Weapons need Kneel (crouch) + MELEE, like the original's
    // Melee() -> CanGrabWeapon && KneelPressed -> GrabWeapon().
    var grabMode = false;
    if (meleePressed && this.pressDownKey()) {
      grabMode = true; // weapons get grabbed this press
    }
    if ((controllable && !this.aiming) || grabMode) {
      var itemCount = weaponItems.length; // snapshot: pushes land next frame
      for (var wi = 0; wi < itemCount; wi++) {
        var item = weaponItems[wi];
        if (item.taken || item.pickupDelay > 0) continue;
        if (!rectsOverlap(this.getBounds(), {
          x: item.x - 8, y: item.y - 12, w: 16, h: 16
        })) continue;
        var kind = item.weapon.kind;
        var isWeapon = kind === 'melee' || kind === 'gun' || kind === 'throwable';
        // empty slot: the weapon is picked up just by walking over it; an
        // occupied slot needs crouch + MELEE, and the swap deletes the old one
        var slotEmpty = kind === 'melee' ? this.equipped === MELEE_WEAPONS.fists
          : kind === 'gun' ? !this.ranged
          : kind === 'throwable' ? !(this.throwable && this.throwable.ammo > 0)
          : false;
        if (isWeapon && !grabMode && !slotEmpty) continue;
        if (kind === 'melee') {
          this.equipped = item.weapon;
          item.taken = true;
          playPickupSound(item.weapon);
        } else if (kind === 'gun') {
          var itemAmmo = (item.ammo !== undefined) ? item.ammo : item.weapon.ammo;
          if (itemAmmo <= 0) { continue; } // empty guns can't be picked up
          this.ranged = { gun: item.weapon, ammo: itemAmmo };
          item.taken = true;
          playPickupSound(item.weapon);
        } else if (kind === 'throwable') {
          var itemThrowableAmmo = (item.ammo !== undefined) ? item.ammo : item.weapon.ammo;
          if (itemThrowableAmmo <= 0) { continue; } // empty throwables can't be picked up
          this.throwable = { ammo: itemThrowableAmmo, type: item.weapon.fire ? 'molotov' : 'grenade' };
          item.taken = true;
          playPickupSound(item.weapon);
        } else if (kind === 'powerup') {
          // Slowmo powerup (requested consumable model): the walk-over BANKS
          // the item in the CONSUME slot; the binding.consume key activates
          // the global slow cam later. Slots stack to one: while carrying, the
          // pickup is left on the ground (like a medkit at full health).
          if (item.weapon.power === 'slowmo') {
            if (this.carriedSlowmo) continue;
            this.carriedSlowmo = item.weapon;
            item.taken = true;
          } else {
            startItemSlowmo(item.weapon.time);
            item.taken = true;
          }
        } else if (kind === 'health') {
          // isHealth pickup (extracted): HP += Ammo, clamped at 100 by the HP
          // setter (so the bar glides to the healed value too). Left on the
          // ground while at full health so a medkit is never wasted; the
          // setter refuses writes on a dead fighter, so a corpse never eats it.
          if (this.hp >= 100) {
            // Full HP: never auto-grabbed. Crouch + MELEE (like a weapon) banks it
            // for later (one slot; a second one stays on the floor).
            if (!grabMode || this.hp <= 0 || this.carriedHealth) continue;
            this.carriedHealth = item.weapon;
            item.taken = true;
            this.healGlowTimer = HEAL_GLOW_STEPS; // grabbing glows even at full HP
            playSfx(SFX.HEALTH_PICKUP);
            continue;
          }
          var healedFrom = this.hp;
          this.setHp(this.hp + item.weapon.ammo);
          if (this.hp > healedFrom) {
            item.taken = true;
            playSfx(SFX.HEALTH_PICKUP);
            this.healGlowTimer = HEAL_GLOW_STEPS;
          }
        }
      }
    }

    this.playMovementSounds();

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

    // Elevator squeeze (anti-jam): the lift carries the rider into an
    // impassable gray structure. Never snap/teleport; slide the body sideways
    // toward the nearest free flank so the lift keeps its vertical path.
    if (this.onGround && this.groundedPlatform && this.groundedPlatform.elevator && !this.performJumpDown) {
      var sqSolid = null;
      var sqB = this.getBounds();
      for (var sqk = 0; sqk < platforms.length; sqk++) {
        var sqp = platforms[sqk];
        if (!sqp.solidSides || platformIsOneWay(sqp) || sqp.ladder || sqp.glass || sqp.elevator) continue;
        if (sqp.shape && sqp.shape !== 'rect') continue;
        if (rectsOverlap(sqB, sqp)) { sqSolid = sqp; break; }
      }
      if (sqSolid) {
        var toLeft = sqSolid.x - this.w - this.x;            // negative shift
        var toRight = sqSolid.x + sqSolid.w - this.x;        // positive shift
        var dir = (-toLeft <= toRight) ? -1 : 1;
        if (this.x + toLeft < 0) dir = 1;
        else if (this.x + toRight > GAME_WIDTH - this.w) dir = -1;
        var need = dir < 0 ? -toLeft : toRight;
        this.x += dir * Math.min(ELEVATOR_SQUEEZE_SLIDE, need);
        this.airVelocityX = 0;
      }
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
    if (levelArt && liftArt) {
      // sprite is 27x8 for the 26x7 collider (1 px padding): top-left anchored
      var pv = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(liftArt, Math.round(e.x), Math.round(e.y), e.w + 1, e.h + 1);
      ctx.imageSmoothingEnabled = pv;
      return;
    }
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
      if (isAnchored(c)) { drawAnchoredProp(c); continue; }
      ctx.save();
      ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
      ctx.rotate(c.angle);
      // The shipped crate art (131.svg), rotated with the crate physics;
      // the procedural paint stays as the fallback while sprites load
      var img = spriteReady ? spriteImages[c.heavyConfig ? c.heavyConfig.sprite : CRATE_SPRITE] : null;
      if (img && img.complete && img.naturalWidth) {
        // heavy props draw their unrotated art size: the AABB (w/h) is the rotated hitbox
        ctx.drawImage(img, -(c.baseW || c.w) / 2, -(c.baseH || c.h) / 2, c.baseW || c.w, c.baseH || c.h);
      } else {
        drawCrateBox(-c.w / 2, -c.h / 2, c.w);
      }
      // progressive burn: the wood chars darker and a flame glow grows
      if (c.onFire) {
        var charred = Math.min(1, Math.max(0, 1 - c.hp / c.hp0));
        ctx.fillStyle = 'rgba(25,12,0,' + (0.65 * charred).toFixed(3) + ')';
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        var glowRadius = c.w * (0.8 + 0.5 * charred);
        var crateGlow = ctx.createRadialGradient(0, 0, 1, 0, 0, glowRadius);
        crateGlow.addColorStop(0, 'rgba(255,200,80,0.55)');
        crateGlow.addColorStop(0.6, 'rgba(255,110,20,0.3)');
        crateGlow.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = crateGlow;
        ctx.fillRect(-glowRadius, -glowRadius, glowRadius * 2, glowRadius * 2);
      }
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

  // Barrel props: the shipped 127.svg art rotated with the physics; the
  // BurningState swaps straight to the shipped 161.svg burning art and the
  // flame glow pulses underneath (the art carries the fire already)
  function drawBarrels() {
    for (var i = 0; i < barrels.length; i++) {
      var b = barrels[i];
      if (b.dead) continue;
      ctx.save();
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      if (b.burning) {
        // the burning barrel blooms behind the art like the ground embers do
        // (deterministic flicker keyed to the prop, no render-path randoms)
        var flick = 0.85 + 0.15 * Math.abs(Math.sin(b.sx * 0.7 + b.y * 0.3 + b.angle * 2));
        var gr = Math.max(b.w * 1.6 * flick, 3);
        var grad = ctx.createRadialGradient(0, 2, 1, 0, 0, gr);
        grad.addColorStop(0.0, 'rgba(255,224,130,0.5)');
        grad.addColorStop(0.55, 'rgba(255,140,32,0.3)');
        grad.addColorStop(1.0, 'rgba(150,50,0,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, gr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.rotate(b.angle);
      var img = spriteReady ? spriteImages[b.burning ? BARREL_BURN_SPRITE : BARREL_SPRITE] : null;
      if (img && img.complete && img.naturalWidth) {
        ctx.drawImage(img, -BARREL_W / 2, -BARREL_H / 2, BARREL_W, BARREL_H);
      } else {
        drawBarrelBody(-BARREL_W / 2, -BARREL_H / 2, BARREL_W, BARREL_H, b.burning);
      }
      ctx.restore();
    }
  }

  // Procedural fallback paint (same contract as drawCrateBox): a red fuel
  // canister with a pale band; the burning variant tints the band hot
  function drawBarrelBody(x, y, w, h, burning) {
    ctx.fillStyle = '#607080';
    ctx.fillRect(x + 1, y - 1, w - 2, h + 2); // loose caps a touch taller
    ctx.fillStyle = burning ? '#e03020' : '#c02818';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = burning ? '#ffd080' : '#e8e8e0';
    ctx.fillRect(x, y + h * 0.3, w, h * 0.4);
  }

  // Detonation fragments: the shipped 153/164 flaming art with a pulsing
  // ember glow; the last stretch fades to ash before the splice takes it
  function drawBarrelDebris() {
    for (var i = 0; i < barrelDebris.length; i++) {
      var d = barrelDebris[i];
      var lifeFrac = Math.max(0, d.life / d.maxLife);
      var die = lifeFrac < EMBER_DIE_FRACTION ? lifeFrac / EMBER_DIE_FRACTION : 1;
      var alpha = (0.35 + 0.65 * Math.min(1, lifeFrac * 2)) * die;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);
      var img = spriteReady ? spriteImages[d.sprite] : null;
      if (img && img.complete && img.naturalWidth) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, -img.naturalWidth * d.scale / 2, -img.naturalHeight * d.scale / 2,
          img.naturalWidth * d.scale, img.naturalHeight * d.scale);
        ctx.restore();
        continue;
      }
      // fallback: dark metal shard + flame tip
      ctx.fillStyle = 'rgba(40,36,40,' + alpha + ')';
      ctx.fillRect(-3 * d.scale, -2 * d.scale, 6 * d.scale, 4 * d.scale);
      ctx.fillStyle = 'rgba(255,120,40,' + alpha + ')';
      ctx.beginPath();
      ctx.arc(0, -3 * d.scale, 1.5 * d.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGlassShards() {
    for (var i = 0; i < glassShards.length; i++) {
      var s = glassShards[i];
      // Debris fade: alpha drops linearly over the last 50 ticks (extracted)
      var alpha = Math.min(1, s.life / GLASS_SHARD_FADE);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      var base = s.color || '205,245,255';
      var rgb = base[0] === '#' ? hexToRgb(base) : base;
      // Wood fragments carry a shipped sprite (6/9/141): draw the art when
      // it is loaded, fall back to the blocky shard paint otherwise
      var img = s.sprite ? spriteImages[s.sprite] : null;
      if (img && img.complete && img.naturalWidth) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, -img.naturalWidth * s.scale / 2, -img.naturalHeight * s.scale / 2,
          img.naturalWidth * s.scale, img.naturalHeight * s.scale);
        ctx.restore();
        continue;
      }
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

  // Head/hair overlays per character style (local coords, facing right).
  // SSJ2 replaces the whole style with the golden swept spikes + lightning
  // fringe before any normal hair can draw (the transformation is total).
  function drawHair(c, w, hx, p) {
    if (p && p.ssj2 && p.hp > 0) {
      var goldBright = '#ffe95c';
      var goldDeep = '#f8b400';
      // back mass hugging the head
      px(hx, 1, 18, 5, goldDeep);
      px(hx, 3, 4, 6, goldDeep);
      // swept spikes: five staggered tufts standing up over the head band
      for (var s = 0; s < 5; s++) {
        var spikeH = 4 + ((s * 7919 + 3) % 5); // deterministic per spike
        var sxp = hx + 1 + s * 4;
        px(sxp, -spikeH, 3, spikeH + 3, s % 2 ? goldDeep : goldBright);
        px(sxp - 1, -1, 1, 3, s % 2 ? goldDeep : goldBright); // angled root
      }
      // fringe over the brow keeps the signature sunglasses band
      px(hx + 1, 4, 16, 4, '#0c0c10'); // sunglasses band
      px(hx + 14, 5, 2, 2, '#d8a63c'); // golden earpiece
      return;
    }
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
  // Floor weapon pickups: the extracted sprite resting on the ground at 1.5x,
  // framed by the original's grey selection brackets
  function drawFloorWeaponItems() {
    for (var wi = 0; wi < weaponItems.length; wi++) {
      var item = weaponItems[wi];
      if (item.taken) continue;
      if (item.ttl && item.ttl <= (item.blinkStart || 192)) {
        if (Math.floor(item.ttl / 8) % 2 === 0) continue;
      }
      var ws = weaponSpriteImages[item.weapon.shape];
      var k = item.weapon.kind;
      var isWeapon = k === 'melee' || k === 'gun' || k === 'throwable';
      if (!ws) {
        drawWeaponShape(item.weapon, item.x - 6, item.y - 10);
        continue;
      }
      // the weapon at 1.1x its natural sprite size; the frame
      // adapts TO the weapon with a fixed 4 px margin on every side
      var tw = ws.w * 1.2;
      var th = ws.h * 1.2;
      var baseY = item.y + 2; // resting ON the floor line
      var cx = item.x;
      var pad = 4;
      var wx = cx - tw / 2;
      var wy = baseY - th;
      var bx = wx - pad;
      var by = wy - pad;
      var boxW = tw + pad * 2;
      var boxH = th + pad * 2;
      ctx.strokeStyle = '#c0c8d0';
      ctx.lineWidth = 2;
      var L = 5;
      ctx.beginPath();
      // top-left
      ctx.moveTo(bx, by + L); ctx.lineTo(bx, by); ctx.lineTo(bx + L, by);
      // top-right
      ctx.moveTo(bx + boxW - L, by); ctx.lineTo(bx + boxW, by); ctx.lineTo(bx + boxW, by + L);
      // bottom-right
      ctx.moveTo(bx + boxW, by + boxH - L); ctx.lineTo(bx + boxW, by + boxH); ctx.lineTo(bx + boxW - L, by + boxH);
      // bottom-left
      ctx.moveTo(bx + L, by + boxH); ctx.lineTo(bx, by + boxH); ctx.lineTo(bx, by + boxH - L);
      ctx.stroke();
      ctx.drawImage(ws.img, wx, wy, tw, th);
    }
  }

  function drawWeaponShape(c, x, y) {
    // Extracted sprite (named DefineSprite PNG): the weapon as-is, scaled to
    // the original pickup/hand width; procedural art is only a fallback.
    var ws = weaponSpriteImages[c.shape];
    if (ws) {
      var target = WEAPON_SPRITE_WIDTH[c.shape] || 16;
      var wsc = target / ws.w;
      ctx.drawImage(ws.img, x, y, ws.w * wsc, ws.h * wsc);
      return;
    }
    if (c.shape === 'pills') {
      px(x + 1, y, 8, 6, '#e8e4da'); // pill box
      px(x + 1, y + 2, 8, 2, '#d0453a'); // red band
    } else if (c.shape === 'slowmo') {
      ctx.strokeStyle = '#7ab8d8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + 6, y + 3, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath(); // clock hands
      ctx.moveTo(x + 6, y + 3); ctx.lineTo(x + 6, y);
      ctx.moveTo(x + 6, y + 3); ctx.lineTo(x + 8, y + 3);
      ctx.stroke();
    } else if (c.shape === 'medkit') {
      px(x, y - 1, 12, 8, '#e8e4da'); // kit box
      px(x + 5, y + 1, 2, 4, '#d0453a'); // cross vertical
      px(x + 3, y + 2, 6, 2, '#d0453a'); // cross horizontal
    } else if (c.shape === 'pistol') {
      px(x + 2, y + 2, 7, 3, '#2e2e34'); // slide
      px(x + 3, y + 5, 3, 4, '#2e2e34'); // grip
      px(x + 2, y + 2, 7, 1, '#4a4a52');
    } else if (c.shape === 'magnum') {
      px(x + 1, y + 2, 9, 3, '#8a8f96'); // barrel + frame
      px(x + 4, y + 4, 2, 3, '#5d6167'); // grip
      px(x + 5, y + 2, 3, 3, '#6b7078'); // cylinder
    } else if (c.shape === 'uzi') {
      px(x, y + 2, 12, 3, '#2e2e34'); // receiver
      px(x + 4, y + 5, 3, 5, '#2e2e34'); // magazine
      px(x + 9, y + 5, 2, 3, '#3a3a42'); // grip
    } else if (c.shape === 'rifle') {
      px(x, y + 3, 16, 2, '#5a3a24'); // wood body
      px(x + 6, y + 1, 6, 2, '#3a3a42'); // receiver
      px(x + 14, y + 2, 4, 3, '#3a3a42'); // muzzle
      px(x + 4, y + 5, 3, 2, '#5a3a24'); // mag
    } else if (c.shape === 'shotgun') {
      px(x, y + 2, 16, 2, '#4a3820'); // barrel pair
      px(x, y + 4, 14, 2, '#3a2c18');
      px(x + 4, y + 6, 4, 2, '#6b4f2e'); // grip
    } else if (c.shape === 'sniper') {
      px(x, y + 3, 18, 2, '#3a3a42'); // body
      px(x + 5, y, 5, 2, '#1c1c22'); // scope
      px(x + 15, y + 2, 4, 3, '#2e2e34'); // muzzle
    } else if (c.shape === 'bazooka') {
      px(x, y + 2, 18, 4, '#2e5c4a'); // tube
      px(x, y + 1, 3, 2, '#1c3c30'); // muzzle
      px(x + 13, y + 5, 3, 2, '#2e5c4a'); // grip
    } else if (c.shape === 'flamethrower') {
      px(x, y + 2, 14, 4, '#8a2e22'); // tank + tube
      px(x + 12, y + 1, 5, 2, '#5d6167'); // nozzle
      px(x + 2, y + 5, 3, 2, '#5d6167'); // valve
    } else if (c.shape === 'molotov') {
      px(x + 3, y, 6, 8, '#b07030'); // bottle
      px(x + 5, y - 2, 2, 3, '#8a5a24'); // neck + rag
      px(x + 3, y + 3, 6, 2, '#d8a040'); // liquid line
    } else if (c.shape === 'grenade') {
      px(x + 2, y + 1, 7, 7, '#3f5a3f');
      px(x + 4, y - 1, 3, 2, '#2a3f2a');
      px(x + 2, y + 4, 7, 2, '#2a3f2a');
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

    // Head (skin) + hair style (SSJ2 sweeps golden spikes over any style)
    px(hx, y0, 18, headH, c.skin);
    drawHair(c, W, hx, p);

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
      var animScale = p.meleeAnimScale();
      var strikeWindowFrame = Math.round(COMBO_HIT_FRAME[p.punchComboNr - 1] * animScale);
      var strike =
        p.punchFrame >= strikeWindowFrame - 2 &&
        p.punchFrame <= strikeWindowFrame + 6;
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
    // PlayerBars (extracted): the head bar is a 50%-alpha clip — a black
    // backing plus a fill colored rgb(255 - 255*r, 255*r, 40) whose length
    // tracks the BarHP trail (not the raw HP), so it drains with the glide.
    var r = Math.max(0, Math.min(1, p.barHP / 100));
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, y - 1, barW + 2, barH + 2);
    ctx.fillStyle = hudHealthColor(r);
    ctx.fillRect(x, y, barW * r, barH);
    ctx.restore();
  }

  // UI teleport: the original stays frozen at the origin while the strike
  // clone works beside the rival.
  // visual-only stair ease: the body is drawn offset from its physics y
  function drawStepped(p, fn) {
    var off = p.stepVis || 0;
    var folded = p.rollShrunk;
    if (!off && !folded) { fn(p); return; }
    var saved = { x: p.x, y: p.y, w: p.w, h: p.h };
    if (folded) {
      // a rolling body is drawn at its standing size (only the collider is folded), feet and centre in place
      var centre = p.x + p.w / 2, feet = p.y + p.h;
      p.w = folded.w; p.h = folded.h; p.x = centre - p.w / 2; p.y = feet - p.h;
    }
    p.y += off;
    try { fn(p); } finally { p.x = saved.x; p.y = saved.y; p.w = saved.w; p.h = saved.h; }
  }

  function drawUiGhost(p) {
    var tl = p.ssjUiTele;
    if (!tl || tl.stage === 'pre' || p.hp <= 0) return;
    var sx = p.x, sy = p.y, sdir = p.lastDirX;
    p.x = tl.origin.x; p.y = tl.origin.y; p.lastDirX = tl.origDir;
    p.ssjUiTele = null; p.ssjGhost = true;
    try { drawPlayer(p); } finally {
      p.ssjGhost = false; p.ssjUiTele = tl;
      p.x = sx; p.y = sy; p.lastDirX = sdir;
    }
  }

  function drawPlayer(p) {
    // A gibbed fighter has no body left: the strong-blast gore replaced it
    // and only the viscera (floor stains) are visible
    if (p.gibbed) return;
    // Rocket ride: the fighter visual IS the ride clip - the rocket renderer
    // draws the misil + the head hooked at its tip; no idle body renders
    if (p.rocketRide) return;
    // Dragon-Ball Instant Transmission: the striker vanishes for TELEPORT_VANISH
    // steps after each hop, then reappears beside the victim and connects
    if (p.ssjCombo && p.ssjCombo.vanish > 0) return;
    if (drawPlayerSprite(p)) { drawWoundMarks(p); return; }
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
    // gun in hand while aiming (original aim stances hold the weapon visible)
    if (p.ranged) {
      drawWeaponShape(p.ranged.gun, p.baseW / 2 + 2, p.baseH / 2 - 6);
    }
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
    if ((p.hitFlash > 0 || p.fireFlash > 0) && !isUltraInstinct(p)) {
      ctx.fillStyle = 'rgba(255,80,80,0.35)';
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }

    // Heal glow (procedural body): white wash over the box + sweeping band
    var procHealGlow = healGlowIntensity(p);
    if (procHealGlow > 0) {
      var procProgress = 1 - p.healGlowTimer / HEAL_GLOW_STEPS;
      ctx.fillStyle = 'rgba(255,255,255,' + (HEAL_GLOW_BASE_ALPHA * procHealGlow).toFixed(3) + ')';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      var procBand = p.h * HEAL_GLOW_SWEEP_BAND;
      var procBandTop = p.y + p.h - procProgress * (p.h + procBand);
      var clippedTop = Math.max(p.y, procBandTop);
      var clippedBottom = Math.min(p.y + p.h, procBandTop + procBand);
      if (clippedBottom > clippedTop) {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * procHealGlow).toFixed(3) + ')';
        ctx.fillRect(p.x, clippedTop, p.w, clippedBottom - clippedTop);
      }
    }

    // Stun stars
    if (p.stunTimer > 0 && !isUltraInstinct(p)) {
      ctx.fillStyle = 'rgba(255,255,140,0.95)';
      ctx.fillRect(p.x + 4, p.y - 6, 4, 4);
      ctx.fillRect(p.x + p.w - 8, p.y - 9, 4, 4);
      ctx.fillRect(p.x + p.w / 2 - 2, p.y - 12, 4, 4);
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

  // Indicators that must render over the SPRITE path too (drawPlayer
  // early-returns once a sprite drew — indicators left inside it never showed).
  // The aim square (extracted AimLazer) and the muzzle flash live here; the
  // square is gated by the settings AJUSTES toggle.
  function drawPlayerOverlay(p) {
    if (aimSquareEnabled && p.aiming && p.aimSquare) {
      var asx = p.aimSquare.x;
      var asy = p.aimSquare.y;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(asx - 2, asy - 2, 4, 4);
      ctx.fillStyle = 'rgba(255,80,80,0.9)';
      ctx.fillRect(asx - 1, asy - 1, 2, 2);
    }
    // Burning fighter flames: small low flames on level 1, the ORIGINAL
    // fire_effect sprites cycling fast on level 2 (the state machine handles
    // the HP drain). The procedural puffs stay as the flame-sprite fallback.
    if (p.fireState && p.fireState !== FireStates.normal && p.hp > 0) {
      var l2 = p.fireState === FireStates.level2;
      if (!(l2 && drawFlameSprites(p))) drawProceduralFlames(p, l2);
    }
    if (p.muzzleFlash > 0) {
      var mf = p.aimMuzzlePoint ? p.aimMuzzlePoint(p.lastDirX) : null;
      var mx = mf ? mf.x : (p.lastDirX > 0 ? p.x + p.w + 6 : p.x - 6);
      var my = mf ? mf.y : p.y + 16;
      ctx.fillStyle = 'rgba(255,240,180,0.9)';
      ctx.fillRect(mx - 3, my - 3.5, 7, 7);
      ctx.fillStyle = 'rgba(255,180,60,0.7)';
      ctx.fillRect(mx - 6, my - 2, 13, 4);
    }
    // SSJ2 orbit / kamehameha charge visuals (the aura itself draws here too)
    drawSsjBeamFx(p);
    drawSsjAura(p);
    // Matrix (The One) visuals: visor, code aura, glitch shards
    drawMatrixAvatar(p);
  }

  // The One's look: a black visor band over the sight line, thin green code
  // motes drifting across the body and, right after a warp, binary shards.
  function drawMatrixAvatar(p) {
    if (!p.matrix || p.hp <= 0 || p.gibbed) return;
    var cx = p.x + p.w / 2;
    var flicker = 0.72 + Math.random() * 0.28;
    ctx.save();
    // digital aura: soft green envelope
    var radius = p.w * 1.7;
    var g = ctx.createRadialGradient(cx, p.y + p.h / 2, 2, cx, p.y + p.h / 2, radius);
    g.addColorStop(0, 'rgba(60,255,140,' + (0.20 * flicker).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(0,255,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - radius, p.y - 12, radius * 2, p.h + 24);
    // dark visor: a slim band across the head's eye line (sprite scale k)
    var k = p.h / 21; // SPRITE_BASE_HEIGHT share kept by the sprite path
    var visorY = p.y + 3.6 * k;
    var visorH = Math.max(2.2, 1.7 * k);
    ctx.fillStyle = 'rgba(8,10,8,0.9)';
    ctx.fillRect(cx - p.w * 0.42, visorY, p.w * 0.84, visorH);
    ctx.fillStyle = 'rgba(110,255,170,' + (0.5 + 0.4 * Math.random()).toFixed(2) + ')';
    ctx.fillRect(cx - p.w * 0.42, visorY + visorH - 1, p.w * 0.84, 0.8);
    // bullet time: the world crawls — the avatar glows steadier
    if (p.matrixBtOn && matrixSlowFactor < 1) {
      ctx.strokeStyle = 'rgba(120,255,170,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - p.w * 0.7, p.y - 6, p.w * 1.4, p.h + 12);
    }
    // warp shards: brief binary distortion over the body
    if (p.matrixGlitchTimer > 0) {
      for (var s = 0; s < 5; s++) {
        ctx.fillStyle = Math.random() < 0.6 ? 'rgba(70,255,130,0.55)' : 'rgba(235,255,240,0.5)';
        ctx.fillRect(
          p.x - 3 + Math.random() * (p.w + 6),
          p.y - 2 + Math.random() * (p.h + 4),
          2 + Math.random() * 6,
          1.2 + Math.random() * 2.4
        );
      }
    }
    ctx.restore();
  }

  // World field: digital rain streaks, glitch shrapnel, bullet-time tint
  // and speed streaks behind every airborne round.
  function drawMatrixWorldFx() {
    // bullet-time tint first (under everything else drawn here)
    if (matrixSlowFactor < 0.999) {
      var depth = Math.min(1, (1 - matrixSlowFactor) / (1 - MATRIX_BT_TARGET));
      ctx.fillStyle = 'rgba(16,78,46,' + (0.16 * depth).toFixed(3) + ')';
      ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      // speed streaks behind projectiles: the crawl made visible
      var drawn = 0;
      for (var i = 0; i < bullets.length && drawn < MATRIX_BT_MAX_STREAKS; i++) {
        var b = bullets[i];
        if (b.hidden && !b.rider) continue;
        var vx = b.vx * (b.rocket ? 1 : 1);
        var vy = b.vy;
        var mag = Math.abs(vx) + Math.abs(vy);
        if (mag < 1) continue;
        drawn++;
        ctx.strokeStyle = 'rgba(140,255,180,' + (0.22 + 0.3 * depth).toFixed(2) + ')';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - vx * 1.2, b.y - vy * 1.2);
        ctx.stroke();
      }
    }
    // digital rain
    for (i = 0; i < matrixRain.length; i++) {
      var r = matrixRain[i];
      var a = Math.max(0, Math.min(1, r.life / MATRIX_RAIN_LIFE));
      ctx.fillStyle = 'rgba(70,255,130,' + (0.55 * a).toFixed(3) + ')';
      ctx.fillRect(r.x, r.y - r.len, 1.6, r.len);
      ctx.fillStyle = 'rgba(220,255,235,' + (0.8 * a).toFixed(3) + ')';
      ctx.fillRect(r.x, r.y - 2.4, 1.6, 2.4); // bright head glyph
    }
    // glitch shrapnel
    for (i = 0; i < matrixGlitch.length; i++) {
      var gbl = matrixGlitch[i];
      var ga = Math.max(0, Math.min(1, gbl.life / gbl.maxLife));
      ctx.fillStyle = 'rgba(60,255,125,' + (0.7 * ga).toFixed(3) + ')';
      ctx.fillRect(gbl.x, gbl.y, gbl.w, gbl.h);
      if (Math.random() < 0.4) {
        ctx.fillStyle = 'rgba(245,255,248,' + (0.5 * ga).toFixed(3) + ')';
        ctx.fillRect(gbl.x, gbl.y, gbl.w * 0.5, gbl.h * 0.6);
      }
    }
  }

  // SSJ2 aura: radial glow, animated flame licks and SSJ2's signature
  // lightning arcs. The sprite body already carries the mod aura.png flame
  // BEHIND it (drawPlayerSprite) — this overlay adds the in-front-of-silhouette
  // sheen in the matching blue family. While the Ki charge (;) is held the
  // aura expands and climbs — the classic gathering stance.
  function drawSsjAura(p) {
    if (!p.ssj2 || p.hp <= 0 || p.gibbed) return;
    var cx = p.x + p.w / 2;
    var bodyTop = p.y;
    var bodyBottom = p.y + p.h;
    var radius = p.w * (p.ssjCharging ? 2.4 : 1.6);
    var flicker = 0.75 + Math.random() * 0.25;
    ctx.save();
    // radial cyan glow
    var g = ctx.createRadialGradient(cx, p.y + p.h / 2, 2, cx, p.y + p.h / 2, radius);
    g.addColorStop(0, 'rgba(150,235,255,' + (0.26 * flicker).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(40,170,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - radius, bodyTop - 14, radius * 2, bodyBottom - bodyTop + 28);
    // flame licks climbing the silhouette
    // Ultra Instinct has no blue energy bars (only SSJ / SSJ2 do)
    var licks = p.ssjPhase === SSJ_PHASE_UI ? 0 : (p.ssjCharging ? 9 : 5);
    for (var i = 0; i < licks; i++) {
      var fx = p.x - 5 + Math.random() * (p.w + 10);
      var rise = (5 + Math.random() * 9) * (p.ssjCharging ? 2 : 1);
      var base = bodyBottom - SSJ_AURA_BAR_FOOT_LIFT; // born a little above the soles, never below the floor
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(92,220,255,0.7)' : 'rgba(0,150,255,0.55)';
      ctx.fillRect(fx - 1.5, base - rise, 3, rise);
      ctx.fillStyle = 'rgba(210,250,255,0.6)';
      ctx.fillRect(fx - 0.5, base - rise * 0.55, 1.5, rise * 0.55);
    }
    // lightning arcs (SSJ2): dense while charging, occasional otherwise
    var bolts = p.ssjCharging ? 3 : (Math.random() < 0.4 ? 1 : 0);
    for (var b = 0; b < bolts; b++) drawSsjLightningBolt(p);
    // flight streaks: short lines trailing against the flight velocity
    if (p.ssjFlying) {
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      var speedX = -p.airVelocityX;
      var speedY = -p.airVelocityY;
      var mag = Math.abs(speedX) + Math.abs(speedY);
      if (mag > 0.4) {
        for (var st = 0; st < 3; st++) {
          var sx = cx + (speedX / mag) * (10 + st * 6);
          var sy = p.y + 8 + st * 6 + (speedY / mag) * (6 + st * 4);
          ctx.fillRect(sx - Math.max(1, speedX) * 3, sy - Math.max(1, speedY) * 3,
            Math.abs(speedX) * 3 + 1, Math.abs(speedY) * 3 + 1);
        }
      }
    }
    ctx.restore();
  }

  function drawSsjLightningBolt(p) {
    var startX = p.x - 5 + Math.random() * (p.w + 10);
    var startY = p.y - 6 + Math.random() * (p.h + 10);
    var x = startX;
    var y = startY;
    ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,205,0.95)' : 'rgba(170,220,255,0.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (var s = 0; s < 4; s++) {
      x += (Math.random() * 2 - 1) * 7;
      y += (Math.random() < 0.55 ? -1 : 1) * (3 + Math.random() * 6);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Kamehameha charge orb at the cupped palms, then the fired beam band.
  // The orb radius grows LINEARLY (frame by frame) for as long as the charge
  // audio plays; on the reabsorb path it shrinks back into the fighter's core.
  function drawSsjBeamFx(p) {
    if (!p.ssjBeam) return;
    var beam = p.ssjBeam;
    var dir = beam.dir;
    var palmX = p.x + p.w / 2 + dir * 8;
    var palmY = p.y + p.h * 0.42;
    var span = SSJ2_KAME_ORB_MAX_R - SSJ2_KAME_ORB_MIN_R;
    var cx = palmX;
    var r;
    if (beam.phase === 'charge') {
      var cap = beam.chargeCap || SSJ2_BEAM_CHARGE_FALLBACK_STEPS;
      r = SSJ2_KAME_ORB_MIN_R + span * Math.min(1, beam.timer / cap);
    } else if (beam.phase === 'reabsorb') {
      // collapse toward the fighter's core, from the reached size down to 0
      var k = Math.min(1, beam.timer / SSJ2_KAME_REABSORB_STEPS);
      var reached = SSJ2_KAME_ORB_MIN_R + span * (beam.charge == null ? 1 : beam.charge);
      r = reached * (1 - k);
      cx = palmX + ((p.x + p.w / 2) - palmX) * k;
    } else {
      return; // a firing stance draws through the world beam band instead
    }
    if (r <= 0.4) return;
    var g = ctx.createRadialGradient(cx, palmY, 1, cx, palmY, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.6, 'rgba(140,210,255,0.8)');
    g.addColorStop(1, 'rgba(90,160,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, palmY, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // The fired beams: white core / cyan sheath spanning the full screen,
  // breathing with the pulse cycle (visual sync with the damage pulses).
  function drawSsjBeams() {
    for (var i = 0; i < ssjBeams.length; i++) {
      var beam = ssjBeams[i];
      var grow = beam.grow;
      var fade = Math.min(1, beam.life / 6);
      var chargeScale = (typeof beam.scale === 'number') ? Math.max(0.1, Math.min(1, beam.scale)) : 1;
      var h = SSJ2_BEAM_HEIGHT * chargeScale * ((typeof beam.size === 'number') ? beam.size : 1) * (0.5 + 0.5 * grow) * (0.85 + 0.15 * Math.sin(beam.life * 1.1)) * fade;
      var x0 = beam.dir > 0 ? beam.x : 0;
      var x1 = beam.dir > 0 ? GAME_WIDTH : beam.x;
      // sheath
      ctx.fillStyle = 'rgba(105,175,255,0.42)';
      ctx.fillRect(x0, beam.y - h * 0.62, x1 - x0, h * 1.24);
      // inner glow
      ctx.fillStyle = 'rgba(150,215,255,0.55)';
      ctx.fillRect(x0, beam.y - h * 0.4, x1 - x0, h * 0.8);
      // white core
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(x0, beam.y - h * 0.16, x1 - x0, h * 0.32);
      // muzzle bloom at the origin
      var bloom = ctx.createRadialGradient(beam.x, beam.y, 2, beam.x, beam.y, h * 1.4);
      bloom.addColorStop(0, 'rgba(255,255,255,0.9)');
      bloom.addColorStop(1, 'rgba(120,190,255,0)');
      ctx.fillStyle = bloom;
      ctx.beginPath();
      ctx.arc(beam.x, beam.y, h * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // UI red energy balls and light-beam rays.
  function drawUiProjectiles() {
    for (var i = 0; i < ssjOrbs.length; i++) {
      var o = ssjOrbs[i];
      var pulse = 1 + 0.15 * Math.sin(o.life * 0.6);
      var rr = o.r * 2.2 * pulse;
      var g = ctx.createRadialGradient(o.x, o.y, 1, o.x, o.y, rr);
      g.addColorStop(0, 'rgba(255,245,235,0.95)');
      g.addColorStop(0.35, 'rgba(255,90,80,0.9)');
      g.addColorStop(1, 'rgba(200,20,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    for (i = 0; i < ssjRays.length; i++) {
      var ray = ssjRays[i];
      ctx.lineCap = 'round';
      for (var t = 1; t < ray.trail.length; t++) {
        var a = t / ray.trail.length;
        ctx.strokeStyle = 'rgba(200,235,255,' + (0.7 * a).toFixed(3) + ')';
        ctx.lineWidth = 1 + 2 * a;
        ctx.beginPath();
        ctx.moveTo(ray.trail[t - 1].x, ray.trail[t - 1].y);
        ctx.lineTo(ray.trail[t].x, ray.trail[t].y);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ray.x, ray.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Particles + pulse rings (sparks, teleport flashes, aura embers).
  function drawSsjParticles() {
    for (var i = 0; i < ssjRings.length; i++) {
      var ring = ssjRings[i];
      ctx.strokeStyle = 'rgba(' + ring.color + ',' + (0.7 * ring.life / ring.maxLife).toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (i = 0; i < ssjParticles.length; i++) {
      var q = ssjParticles[i];
      var a = Math.max(0, Math.min(1, q.life / q.maxLife));
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    ctx.globalAlpha = 1;
  }

  // The level-2 burn plays the ORIGINAL flame frames cycled very fast:
  // 2 render steps per frame, a full [186..194] loop every ~0.17 s (rapid
  // pulse, the level-2 tall burn). Two layered puffs on the body with a
  // +-1..2 px shake mimic the original fire particles' random drift velocity.
  function drawFlameSprites(p) {
    if (!spriteReady) return false;
    p.flameFrame = (p.flameFrame || 0) + 1;
    var idx = FIRE_FLAME_SPRITES[
      Math.floor(p.flameFrame / FIRE_FLAME_STEPS_PER_FRAME) % FIRE_FLAME_SPRITES.length
    ];
    var img = spriteImages[idx];
    if (!img || !img.complete || !img.naturalWidth) return false;
    // Same sprite pixel density as the body (SPRITE_BASE_HEIGHT = 21): the
    // ~15 px frames render at the original's 1.25x fire_effect scale.
    var k = p.h / 21;
    var w = img.naturalWidth * k;
    var h = img.naturalHeight * k;
    var cx = p.x + p.w / 2;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(img, cx - w / 2 + (Math.random() * 2 - 1), p.y + p.h * 0.8 - h, w, h);
    ctx.globalAlpha = 0.75;
    ctx.drawImage(img, cx - w * 0.4 + (Math.random() * 3 - 1.5), p.y + p.h * 0.9 - h * 0.8, w * 0.8, h * 0.8);
    ctx.restore();
    return true;
  }

  // The small procedural flame puffs (level 1, and the level-2 fallback while
  // the SVG flame frames are not ready)
  function drawProceduralFlames(p, big) {
    var n = big ? 4 : 2;
    for (var fi = 0; fi < n; fi++) {
      var fx = p.x + p.w * (0.2 + 0.6 * (n === 1 ? 0.5 : fi / (n - 1))) + (Math.random() * 3 - 1.5);
      var fh = (big ? 11 : 6) + Math.random() * 5;
      ctx.fillStyle = big ? 'rgba(255,84,26,0.8)' : 'rgba(255,150,52,0.7)';
      ctx.fillRect(fx - 1.5, p.y + p.h * 0.72 - fh, 3.5, fh);
      ctx.fillStyle = 'rgba(255,214,96,0.8)';
      ctx.fillRect(fx - 0.5, p.y + p.h * 0.72 - fh * 0.55, 1.5, fh * 0.55);
    }
  }

  // ---------- Settings (bottom-corner button + aim-square toggle) ----------
  // The aim square (the small floating sight drawn at the calculated ray end)
  // can be hidden/shown at runtime. Default OFF: the user prefers playing
  // without the sight, and the settings button brings it back when wanted.
  // The choice persists across sessions when localStorage is available.
  var aimSquareEnabled = false;
  try {
    if (typeof window.localStorage !== 'undefined' && window.localStorage.getItem('sf_aim_square') !== null) {
      aimSquareEnabled = window.localStorage.getItem('sf_aim_square') === '1';
    }
  } catch (_lse) {}
  function saveAimSquareSetting() {
    try { if (typeof window.localStorage !== 'undefined') window.localStorage.setItem('sf_aim_square', aimSquareEnabled ? '1' : '0'); } catch (_lse) {}
  }

  // DEV mode (spawning): ON keeps the fixed development layout (weapons lying
  // on every spot from the start, fixed first spawns); OFF (default) runs the
  // original random flow: empty map, weapons appear progressively, fighters
  // spawn on random valid points. See src/spawn-director.js for the pacing.
  var devModeEnabled = false;
  try {
    if (typeof window.localStorage !== 'undefined' && window.localStorage.getItem('sf_dev_mode') !== null) {
      devModeEnabled = window.localStorage.getItem('sf_dev_mode') === '1';
    }
  } catch (_lse) {}
  function saveDevModeSetting() {
    try { if (typeof window.localStorage !== 'undefined') window.localStorage.setItem('sf_dev_mode', devModeEnabled ? '1' : '0'); } catch (_lse) {}
  }

  var settingsOpen = false;
  var CFG_BTN = { x: VIEW_WIDTH - 94, y: VIEW_HEIGHT - 30, w: 86, h: 22 }; // bottom-right corner
  var CFG_PANEL = { x: VIEW_WIDTH - 232, y: VIEW_HEIGHT - 126, w: 224, h: 88 };
  var CFG_ROW = { x: CFG_PANEL.x + 10, y: CFG_PANEL.y + 26, w: 176, h: 18 }; // the aim-square toggle row
  var CFG_DEV_ROW = { x: CFG_PANEL.x + 10, y: CFG_PANEL.y + 48, w: 176, h: 18 }; // the DEV-mode toggle row

  // Re-anchor the bottom-right settings widgets whenever the viewport changes.
  layoutSettingsWidgets = function () {
    CFG_BTN.x = VIEW_WIDTH - 94; CFG_BTN.y = VIEW_HEIGHT - 30;
    CFG_PANEL.x = VIEW_WIDTH - 232; CFG_PANEL.y = VIEW_HEIGHT - 126;
    CFG_ROW.x = CFG_PANEL.x + 10; CFG_ROW.y = CFG_PANEL.y + 26;
    CFG_DEV_ROW.x = CFG_PANEL.x + 10; CFG_DEV_ROW.y = CFG_PANEL.y + 48;
  };
  layoutSettingsWidgets();

  function pointInRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  function canvasPoint(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (VIEW_WIDTH / r.width),
      y: (e.clientY - r.top) * (VIEW_HEIGHT / r.height)
    };
  }

  if (typeof canvas.addEventListener === 'function') {
    canvas.addEventListener('click', function (e) {
      var m = canvasPoint(e);
      if (pointInRect(m.x, m.y, CFG_BTN)) {
        settingsOpen = !settingsOpen; // open/close the settings panel
        return;
      }
      if (!settingsOpen) return;
      if (pointInRect(m.x, m.y, CFG_ROW)) {
        aimSquareEnabled = !aimSquareEnabled; // toggle the aim square
        saveAimSquareSetting();
        return;
      }
      if (pointInRect(m.x, m.y, CFG_DEV_ROW)) {
        setDevMode(!devModeEnabled); // toggle the fixed/random spawn flow
        return;
      }
      if (!pointInRect(m.x, m.y, CFG_PANEL)) settingsOpen = false; // click outside closes
    });
  }

  // The settings HUD: the corner button plus its small panel while open
  function drawSettings() {
    ctx.fillStyle = 'rgba(10,12,16,0.78)';
    ctx.fillRect(CFG_BTN.x, CFG_BTN.y, CFG_BTN.w, CFG_BTN.h);
    ctx.strokeStyle = settingsOpen ? '#ffd34d' : 'rgba(200,210,230,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(CFG_BTN.x + 0.5, CFG_BTN.y + 0.5, CFG_BTN.w - 1, CFG_BTN.h - 1);
    ctx.fillStyle = '#e8ecf2';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('AJUSTES', CFG_BTN.x + CFG_BTN.w / 2, CFG_BTN.y + 14);

    if (settingsOpen) {
      ctx.fillStyle = 'rgba(10,12,16,0.92)';
      ctx.fillRect(CFG_PANEL.x, CFG_PANEL.y, CFG_PANEL.w, CFG_PANEL.h);
      ctx.strokeStyle = 'rgba(200,210,230,0.8)';
      ctx.strokeRect(CFG_PANEL.x + 0.5, CFG_PANEL.y + 0.5, CFG_PANEL.w - 1, CFG_PANEL.h - 1);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText('CONFIGURACION', CFG_PANEL.x + CFG_PANEL.w / 2, CFG_PANEL.y + 14);
      // aim-square toggle row
      ctx.fillStyle = aimSquareEnabled ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(CFG_ROW.x, CFG_ROW.y, CFG_ROW.w, CFG_ROW.h);
      ctx.strokeStyle = 'rgba(200,210,230,0.5)';
      ctx.strokeRect(CFG_ROW.x + 0.5, CFG_ROW.y + 0.5, CFG_ROW.w - 1, CFG_ROW.h - 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e8ecf2';
      ctx.fillText('Mirilla de apuntado', CFG_ROW.x + 6, CFG_ROW.y + 13);
      ctx.textAlign = 'right';
      ctx.fillStyle = aimSquareEnabled ? '#6fce62' : '#e2574c';
      ctx.fillText(aimSquareEnabled ? 'ON' : 'OFF', CFG_ROW.x + CFG_ROW.w - 8, CFG_ROW.y + 13);
      // DEV-mode toggle row
      ctx.fillStyle = devModeEnabled ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(CFG_DEV_ROW.x, CFG_DEV_ROW.y, CFG_DEV_ROW.w, CFG_DEV_ROW.h);
      ctx.strokeStyle = 'rgba(200,210,230,0.5)';
      ctx.strokeRect(CFG_DEV_ROW.x + 0.5, CFG_DEV_ROW.y + 0.5, CFG_DEV_ROW.w - 1, CFG_DEV_ROW.h - 1);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e8ecf2';
      ctx.fillText('Modo DEV (spawns fijos)', CFG_DEV_ROW.x + 6, CFG_DEV_ROW.y + 13);
      ctx.textAlign = 'right';
      ctx.fillStyle = devModeEnabled ? '#6fce62' : '#e2574c';
      ctx.fillText(devModeEnabled ? 'ON' : 'OFF', CFG_DEV_ROW.x + CFG_DEV_ROW.w - 8, CFG_DEV_ROW.y + 13);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText('click en la fila para alternar · click fuera cierra', CFG_PANEL.x + CFG_PANEL.w / 2, CFG_PANEL.y + CFG_PANEL.h - 6);
      ctx.textAlign = 'left';
    }
  }

  // ---------- Pause overlay (KeyP) ----------
  // A dark veil plus a centered "PAUSED" plate, drawn after HUD/settings so it
  // sits on top of everything while updateStep keeps early-returning frozen.
  function drawPauseOverlay() {
    ctx.fillStyle = 'rgba(10,12,16,0.55)';
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8ecf2';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('PAUSED', VIEW_WIDTH / 2, VIEW_HEIGHT / 2);
    ctx.font = '11px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('press P to resume', VIEW_WIDTH / 2, VIEW_HEIGHT / 2 + 22);
    ctx.textAlign = 'left';
  }

  // ---------- Top HUD health plates (extracted gui_player_819 + DrawGUIBars) ----------
  var PLAYER_TEAM_SOLO_CSS = 'rgb(230,230,230)'; // PlayerTeamColor.SOLO
  // Plate layout (reference screenshot, scaled 1/2.25 to the 800x600 canvas):
  // [P1 label] [green health bar / white energy bar]
  // [portrait] [melee][gun][throwable][slowmo]   <- 4 red slots
  //            ammo digits under the gun and throwable slots
  var HUD_PLATE_X0 = 10;
  var HUD_PLATE_Y = 4;
  var HUD_PLATE_W = 186;
  var HUD_PLATE_H = 70;
  var HUD_PLATE_STEP = 189;     // plate pitch (4 plates across the top)
  var HUD_PLATE_COUNT = 4;
  var HUD_SCALE = 0.75;         // uniform shrink of the plate block (keeps aspect ratio)
  var HUD_SLOT_SIZE = 25;
  var HUD_SLOT_GAP = 7;
  var HUD_SLOTS_X = 53;         // first slot, relative to the plate
  var HUD_SLOTS_Y = 24;
  var HUD_PORTRAIT_X = 8;
  var HUD_PORTRAIT_Y = 24;
  var HUD_PORTRAIT_SIZE = 38;
  var HUD_BAR_X = 53;
  var HUD_BAR_LENGTH = 123;
  var HUD_BAR_HEIGHT = 5;
  var HUD_BAR_GAP = 8;          // energy bar sits this far below the health bar
  var HUD_SLOT_COLOR = '#e8402a';
  var HUD_SLOT_EDGE = '#f7f0e6';

  // GetColor(255 - Math.round(255*r), Math.round(255*r), 40): the
  // Superfighters health ramp — rgb(0,255,40) at full, rgb(255,0,40) at
  // empty, blue channel pinned at 40 for that acidic green edge.
  function hudHealthColor(r) {
    var g = Math.round(255 * r);
    return 'rgb(' + (255 - g) + ',' + g + ',40)';
  }

  function hudRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Red rounded slot with the dark outline of the shipped HUD.
  function drawHudSlot(x, y, size) {
    hudRoundRect(x, y, size, size, 4);
    ctx.fillStyle = HUD_SLOT_COLOR;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = HUD_SLOT_EDGE;
    ctx.stroke();
  }

  // Weapon icon centered in a slot, pixel-crisp, shrunk only if it overflows.
  function drawHudSlotIcon(shape, x, y, size) {
    if (!shape) return;
    var ws = weaponSpriteImages[shape];
    var inner = size - 6;
    if (ws) {
      var sc = Math.min(1, inner / ws.w, inner / ws.h);
      var dw = ws.w * sc, dh = ws.h * sc;
      var prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ws.img, Math.round(x + (size - dw) / 2), Math.round(y + (size - dh) / 2), dw, dh);
      ctx.imageSmoothingEnabled = prev;
    } else {
      drawWeaponShape({ shape: shape }, x + size / 2 - 7, y + size / 2 - 4);
    }
  }

  // The character's head-shot box: the fighter's own idle cell (per-character
  // `portrait` cell override, else the sprite map idle, else the shipped 592).
  function drawHudPortrait(p, x, y, size) {
    drawHudSlot(x, y, size);
    var cell = (p.char && p.char.portrait != null) ? p.char.portrait
      : (SPRITE_MAP && SPRITE_MAP.idle != null ? SPRITE_MAP.idle : 592);
    if (Array.isArray(cell)) cell = cell[0];
    var img = spriteImages[cell];
    if (spriteReady && img && img.complete && img.naturalWidth) {
      var sc = Math.min((size - 6) / img.naturalWidth, (size - 4) / img.naturalHeight);
      var dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
      var prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, Math.round(x + (size - dw) / 2), Math.round(y + size - 2 - dh), dw, dh);
      ctx.imageSmoothingEnabled = prev;
    } else {
      ctx.fillStyle = p.char.hair;
      ctx.fillRect(x + 8, y + 7, size - 16, 10);
      ctx.fillStyle = p.char.skin;
      ctx.fillRect(x + 10, y + 17, size - 20, 12);
    }
  }

  function drawHudDigits(n, x, y) {
    var t = String(Math.max(0, Math.min(99, n | 0)));
    if (t.length < 2) t = '0' + t;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2f2f2';
    ctx.fillText(t, x, y);
    ctx.textAlign = 'left';
  }

  // One fighter's plate: black backing, P-label, health + sprint-energy bars,
  // the character portrait and the four inventory slots:
  //   1 melee weapon (empty on fists)   2 gun + ammo
  //   3 grenade / molotov + count       4 carried slow-motion
  // Death hides only the label and the fills; the plate and slots stay.
  function drawHudPlate(p, plateX) {
    var plateY = HUD_PLATE_Y;
    var alive = p.hp > 0;
    ctx.fillStyle = '#000';
    ctx.fillRect(plateX, plateY, HUD_PLATE_W, HUD_PLATE_H);
    ctx.strokeStyle = '#16165a';
    ctx.lineWidth = 1;
    ctx.strokeRect(plateX + 0.5, plateY + 0.5, HUD_PLATE_W - 1, HUD_PLATE_H - 1);
    if (!p) return;
    if (alive) {
      ctx.font = 'bold 13px monospace';
      ctx.fillStyle = PLAYER_TEAM_SOLO_CSS;
      ctx.textAlign = 'left';
      ctx.fillText('P' + p.id, plateX + 8, plateY + 14);
    }
    drawHudPortrait(p, plateX + HUD_PORTRAIT_X, plateY + HUD_PORTRAIT_Y, HUD_PORTRAIT_SIZE);

    var sx = plateX + HUD_SLOTS_X, sy = plateY + HUD_SLOTS_Y;
    var step = HUD_SLOT_SIZE + HUD_SLOT_GAP;
    for (var i = 0; i < 4; i++) drawHudSlot(sx + i * step, sy, HUD_SLOT_SIZE);
    var melee = p.equipped && p.equipped.shape ? p.equipped.shape : null;
    var gun = p.ranged && p.ranged.gun ? p.ranged.gun : null;
    var thr = p.throwable && p.throwable.ammo > 0 ? p.throwable : null;
    drawHudSlotIcon(melee, sx, sy, HUD_SLOT_SIZE);
    drawHudSlotIcon(gun ? gun.shape : null, sx + step, sy, HUD_SLOT_SIZE);
    drawHudSlotIcon(thr ? (thr.type === 'molotov' ? 'molotov' : 'grenade') : null, sx + step * 2, sy, HUD_SLOT_SIZE);
    var consumableKind = p.nextConsumableKind();
    if (consumableKind) {
      drawHudSlotIcon(consumableKind === 'health' ? p.carriedHealth.shape : 'slowmo', sx + step * 3, sy, HUD_SLOT_SIZE);
      ctx.font = '8px monospace';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      var consumeKey = p.binding.consume === 'Period' ? '.' : p.binding.consume.replace('Digit', '');
      ctx.fillText(consumeKey, sx + step * 3 + HUD_SLOT_SIZE - 2, sy + HUD_SLOT_SIZE - 2);
      ctx.textAlign = 'left';
    }
    if (gun) drawHudDigits(p.ranged.ammo, sx + step + HUD_SLOT_SIZE / 2, sy + HUD_SLOT_SIZE + 15);
    if (thr) drawHudDigits(thr.ammo, sx + step * 2 + HUD_SLOT_SIZE / 2, sy + HUD_SLOT_SIZE + 15);

    if (!alive) return;
    var barX = plateX + HUD_BAR_X;
    var healthY = plateY + 4;
    var r = Math.max(0, Math.min(1, p.barHP / 100)); // BarHP / 100
    ctx.fillStyle = hudHealthColor(r);
    ctx.fillRect(barX, healthY, Math.round(HUD_BAR_LENGTH * r), HUD_BAR_HEIGHT);
    ctx.fillStyle = '#fff'; // sprint-energy fill paints white (0xFFFFFF)
    var e = Math.max(0, Math.min(1, p.sprintEnergy / 100));
    ctx.fillRect(barX, healthY + HUD_BAR_GAP, Math.round(HUD_BAR_LENGTH * e), HUD_BAR_HEIGHT);
    // SSJ2 Ki gauge: thin third strip under the energy bar while transformed
    if (p.ssj2) {
      var ki = Math.max(0, Math.min(1, p.ssjKi / SSJ2_KI_MAX));
      ctx.fillStyle = p.ssjCharging ? '#fff3b0' : '#ffd23f';
      ctx.fillRect(barX, healthY + HUD_BAR_GAP * 2 - 1, Math.round(HUD_BAR_LENGTH * ki), 3);
      if (p.ssjFlying) {
        ctx.fillStyle = '#9fd8ff';
        ctx.fillRect(barX + HUD_BAR_LENGTH - 8, healthY + HUD_BAR_GAP * 2 - 1, 8, 3);
      }
    }
  }

  function drawHud() {
    // P1 top-left, P2 top-right (user request), mirrored sign alignment
    // P1..P4 side by side like the reference; P3/P4 stay empty black plates
    // The whole plate row is centred horizontally on the (dynamic) viewport.
    var plateRowWidth = (HUD_PLATE_STEP * (HUD_PLATE_COUNT - 1) + HUD_PLATE_W) * HUD_SCALE;
    var plateRowX0 = Math.max(0, (VIEW_WIDTH - plateRowWidth) / 2) / HUD_SCALE;
    ctx.save();
    ctx.scale(HUD_SCALE, HUD_SCALE);
    for (var hp = 2; hp < HUD_PLATE_COUNT; hp++) {
      var ex = plateRowX0 + hp * HUD_PLATE_STEP;
      ctx.fillStyle = '#000';
      ctx.fillRect(ex, HUD_PLATE_Y, HUD_PLATE_W, HUD_PLATE_H);
      ctx.strokeStyle = '#16165a';
      ctx.strokeRect(ex + 0.5, HUD_PLATE_Y + 0.5, HUD_PLATE_W - 1, HUD_PLATE_H - 1);
    }
    drawHudPlate(player1, plateRowX0);
    drawHudPlate(player2, plateRowX0 + HUD_PLATE_STEP);
    ctx.restore();
    ctx.font = '10px monospace';
    if (CheatCodeManager.blockedHint > 0) {
      ctx.fillStyle = 'rgba(255,120,90,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('the ritual needs an open sky: no roof over P' + CheatCodeManager.blockedFor, VIEW_WIDTH / 2, 112);
      ctx.textAlign = 'left';
    }
    ctx.textAlign = 'left';
    if (roundOver && roundFlowApi) {
      if (roundFlowApi.showsResult(roundFlow)) drawRoundResult();
    } else if (roundOver) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, VIEW_HEIGHT / 2 - 46, VIEW_WIDTH, 92);
      ctx.fillStyle = '#fff';
      ctx.font = '28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        roundOver.winnerId === 0 ? 'DOUBLE KILL' : 'PLAYER ' + roundOver.winnerId + ' WINS',
        VIEW_WIDTH / 2,
        VIEW_HEIGHT / 2 - 6
      );
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px monospace';
      ctx.fillText('round restarts in ' + Math.ceil(restartTimer / FPS) + 's', VIEW_WIDTH / 2, VIEW_HEIGHT / 2 + 24);
      ctx.textAlign = 'left';
    }
  }

  // Result banner + continue prompt, once the round-end slow motion is over.
  var ROUND_RESULT_DRAW_TEXT = 'DRAW';
  var ROUND_CONTINUE_PROMPT = 'Press Space to advance to the next round';
  function roundResultText(winnerId) {
    return winnerId === roundFlowApi.DRAW_WINNER_ID ? ROUND_RESULT_DRAW_TEXT : 'PLAYER ' + winnerId + ' WINS';
  }
  function drawRoundResult() {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, VIEW_HEIGHT / 2 - 46, VIEW_WIDTH, 92);
    ctx.fillStyle = '#fff';
    ctx.font = '28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(roundResultText(roundFlow.winnerId), VIEW_WIDTH / 2, VIEW_HEIGHT / 2 - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '12px monospace';
    ctx.fillText(ROUND_CONTINUE_PROMPT, VIEW_WIDTH / 2, VIEW_HEIGHT / 2 + 24);
    ctx.textAlign = 'left';
  }

  // ---------- Game state ----------
  var player1 = new Player(1, playerSpawns[0].x, playerSpawns[0].y, 0, {
    left: 'KeyA',
    right: 'KeyD',
    down: 'KeyS',
    up: 'KeyW',
    punch: 'Digit1',
    fire: 'Digit2',
    throw: 'Digit3',
    consume: 'Digit4'
  });
  player1.y -= player1.h; // spawn.y is the feet level
  var player2 = new Player(2, playerSpawns[1].x, playerSpawns[1].y, 1, {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    down: 'ArrowDown',
    up: 'ArrowUp',
    punch: 'KeyN',
    fire: 'KeyM',
    throw: 'Comma',
    consume: 'Period',
    // SSJ2 ability set (active only while the 'gokussj' cheat shell runs)
    ssjPunch: 'KeyJ',
    ssjBeam: 'KeyK',
    ssjFly: 'KeyL',
    ssjKi: 'Semicolon',
    ssjTele: 'Quote'
  });
  player2.y -= player2.h; // spawn.y is the feet level
  player2.y -= player2.h; // spawn.y is the feet level
  player2.botControlled = true; // the bot never gains the roll-into-cover intent
  // Camera is a viewport transform, so map coordinates and collision geometry
  // remain unchanged. It zooms in on nearby players and zooms out to fit both.
  var CAMERA_MIN_ZOOM = 0.72;
  var CAMERA_MAX_ZOOM = 1.7;
  var CAMERA_CLOSENESS = 1.12;       // slightly closer than the pure fit-both-fighters zoom
  var CAMERA_PADDING_X = 72;
  var CAMERA_PADDING_Y = 72;
  var CAMERA_LOOK_UP_OFFSET = 28;    // world px: extra headroom above the fighters
  var CAMERA_POSITION_SMOOTHING = 0.18;
  var CAMERA_ZOOM_SMOOTHING = 0.12;
  var camera = {
    x: (player1.x + player1.w / 2 + player2.x + player2.w / 2) / 2,
    y: (player1.y + player1.h / 2 + player2.y + player2.h / 2) / 2,
    zoom: 1
  };

  function clampCameraCenter(center, worldSize, viewSize, zoom) {
    var halfView = viewSize / (2 * zoom);
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
      (VIEW_WIDTH - 2 * CAMERA_PADDING_X) / spanX,
      (VIEW_HEIGHT - 2 * CAMERA_PADDING_Y) / spanY
    );
    var targetZoom = Math.max(CAMERA_MIN_ZOOM, Math.min(CAMERA_MAX_ZOOM, fitZoom * CAMERA_CLOSENESS));
    var targetX = clampCameraCenter((left + right) / 2, GAME_WIDTH, VIEW_WIDTH, targetZoom);
    var targetY = clampCameraCenter((top + bottom) / 2 - CAMERA_LOOK_UP_OFFSET, GAME_HEIGHT, VIEW_HEIGHT, targetZoom);

    var zoomBlend = snap ? 1 : CAMERA_ZOOM_SMOOTHING;
    var positionBlend = snap ? 1 : CAMERA_POSITION_SMOOTHING;
    camera.zoom += (targetZoom - camera.zoom) * zoomBlend;
    camera.x += (targetX - camera.x) * positionBlend;
    camera.y += (targetY - camera.y) * positionBlend;
    camera.x = clampCameraCenter(camera.x, GAME_WIDTH, VIEW_WIDTH, camera.zoom);
    camera.y = clampCameraCenter(camera.y, GAME_HEIGHT, VIEW_HEIGHT, camera.zoom);
  }

  // Snap the first rendered frame to the spawn framing instead of easing from 1x.
  updateCamera(true);

  // Settle every crate onto its support BEFORE the first rendered frame so the
  // scene opens with everything already in place (no falling crates on start).
  // Bottom-first order: supports land before the crates stacked on them.
  var _settleOrder = crates.slice().sort(function (a, b) { return b.y - a.y; });
  for (var _cs2 = 0; _cs2 < _settleOrder.length; _cs2++) settleCrate(_settleOrder[_cs2]);
  rebuildHangingProps(); // hanging decks keep their rope height: never dropped by the settle pass
  // Barrels ride the same open-in-place rule (they are spawned inside their
  // surfaces by 0.25 px like the crates are — without the settle pass they
  // sink through and vanish into the pit on the first mover step)
  var _barrelOrder = barrels.slice().sort(function (a, b) { return b.y - a.y; });
  for (var _bs2 = 0; _bs2 < _barrelOrder.length; _bs2++) settleBarrel(_barrelOrder[_bs2]);

  // ---------- World entities: bullets / grenades / explosions / dropped items ----------
  // The rocket's removal path (UpdateRockets tail): the ride ALWAYS ends in
  // the rider's gibs (PlayerStuck.GibPlayer) plus the BAZOOKA_ROCKET blast
  // at the reach point. pendingExplode marked from a steered rocket's hit or
  // the ride timer resolves through this one path.
  function detonateRocket(b) {
    if (b.exploded) {
      b.dead = true;
      return;
    }
    b.exploded = true;
    b.dead = true;
    b.hidden = false;
    if (b.rider) {
      var rider = b.rider;
      b.rider = null;
      rider.rocketRide = null; // their update stops steering cleanly
      rider.damage(999); // GibPlayer: the ride never survives its own rocket
    }
    explodeRocket(b.x, b.y);
  }

  // The stuck cam (extracted AddSlowmotion(new SlowmoData(0, 12, 6, 0.01))):
  // instant freeze, 12 ticks hold, 6 ticks fade back to full speed.
  function startRocketSlowmo() {
    rocketSlowmo = { mode: 'hold', t: 0 };
  }

  // Firearm knockback rules: decides whether this hit launches the victim.
  // Per-victim bookkeeping is two tiny fields (no growing lists).
  function bulletTriggersKnockback(victim, b) {
    switch (b.knockbackRule) {
      case BULLET_KNOCKBACK_RULE.SINGLE_HIT:
        return true;
      case BULLET_KNOCKBACK_RULE.ALL_PELLETS:
        if (!victim.pelletTally || victim.pelletTally.shotId !== b.shotId) {
          victim.pelletTally = { shotId: b.shotId, hits: 0 };
        }
        victim.pelletTally.hits++;
        return victim.pelletTally.hits >= b.pelletCount;
      case BULLET_KNOCKBACK_RULE.BURST_WINDOW:
        if (!victim.burstHitTimes) victim.burstHitTimes = [];
        victim.burstHitTimes.push(bulletImpactClock);
        while (victim.burstHitTimes.length &&
               bulletImpactClock - victim.burstHitTimes[0] > SMG_BURST_WINDOW_STEPS) {
          victim.burstHitTimes.shift();
        }
        if (victim.burstHitTimes.length >= SMG_BURST_HITS_REQUIRED) {
          victim.burstHitTimes.length = 0; // the burst spent its force
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  // One plain bullet landing on a fighter: damage, blood, and (per the gun's
  // rule) the combo-finisher launch away from the shooter.
  // Rotated props are hit on their real rectangle (OBB), not on the corners
  // of their axis-aligned bounds that the tilted sprite no longer covers.
  function bulletInsideProp(b, prop) {
    if (!(b.x > prop.x && b.x < prop.x + prop.w && b.y > prop.y && b.y < prop.y + prop.h)) return false;
    if (!impactApi || !prop.angle) return true;
    return impactApi.pointInRotatedBox(b.x, b.y, prop.x + prop.w / 2, prop.y + prop.h / 2,
      prop.baseW || prop.w, prop.baseH || prop.h, prop.angle);
  }

  // Horizontal push of a shot on a prop: heavy props keep their tuned share of
  // the bullet speed; every other prop takes the gun's Box2D impulse, which
  // applyHitImpulse divides by the prop's mass (dv = J / m).
  function bulletPushOnProp(b, prop) {
    if (prop.heavyConfig && prop.heavyConfig.bulletPush) return b.vx * prop.heavyConfig.bulletPush;
    if (!impactApi || !b.vx) return 0;
    return (b.vx > 0 ? 1 : -1) * (b.impulse || DEFAULT_BULLET_IMPULSE) * impactApi.BULLET_IMPULSE_TO_SPEED;
  }

  // A shot on a barrel: the height of the hit shapes the nudge and the
  // torque exactly like on a crate (top tips it over with the shot, bottom
  // sweeps the base and rocks it back). Without the rules module the legacy
  // random spin stays in charge (torqueApplied false).
  function barrelBulletResponse(barrel, b, nudgeX) {
    if (!impactApi || !rigidApi) return { dvx: nudgeX, spin: 0, torqueApplied: false };
    var response = impactApi.bulletResponse({
      width: barrel.baseW, height: barrel.baseH,
      centerX: barrel.x + barrel.w / 2, centerY: barrel.y + barrel.h / 2,
      contactX: b.x, contactY: b.y,
      dvx: nudgeX,
      grounded: !!(barrel.wasGrounded || barrel.resting)
    });
    return { dvx: response.dvx, spin: response.spin, torqueApplied: true };
  }

  function applyBulletImpact(victim, b) {
    victim.damage(b.crit ? b.damage + b.critDamage : b.damage);
    victim.hitFlash = 6;
    spawnBloodHit(b.x, b.y, b.vx);
    if (!bulletTriggersKnockback(victim, b)) return;
    if (victim.grabbedBy || victim.rocketRide) return;
    if (victim.aiming) victim.abortAiming(true, "vanish");
    victim.launchComboFinisher(b.vx >= 0 ? 1 : -1);
  }

  function updateBullets() {
    bulletImpactClock += gameSpeed;
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      var isRocket = b.rocket;
      // DoExplode (extracted): another rocket can flag a detonation while
      // this one already ran its pass; resolve it at its own position with
      // its own rider.
      if (isRocket && b.pendingExplode && !b.exploded) {
        detonateRocket(b);
        bullets.splice(i, 1);
        continue;
      }
      var totalVel, steps, stepVx, stepVy;
      var move = ammoMoveScale(); // every ammo shares the dodge window
      if (isRocket) {
        if (b.rideSpeed == null) {
          // hand-spawned rockets (tests) arrive without the ride fields:
          // derive them from the initial velocity like ProjectileData does
          b.rideSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
          b.rideAngle = Math.atan2(b.vy, b.vx) * 180 / Math.PI;
          b.avoided = [b.owner];
          b.rider = null;
          b.hidden = false;
          b.exploded = false;
          b.pendingExplode = false;
        }
        // UpdateRockets: the direction carries a random ±4 deg wobble per
        // game-speed tick; the position crawls Speed * BulletGameSpeed in
        // 2px substeps, halved while a rider is attached.
        b.rideAngle += (Math.random() * ROCKET_WOBBLE_DEG - ROCKET_WOBBLE_DEG / 2) *
          gameSpeed / ANIM_TICKS_TO_STEPS;
        var rad = (b.rideAngle * Math.PI) / 180;
        var dirX = Math.cos(rad), dirY = Math.sin(rad);
        b.vx = dirX * b.rideSpeed;
        b.vy = dirY * b.rideSpeed;
        if (!b.hidden) emitRocketExhaust(b);
        var motion = b.rideSpeed * move * (b.rider ? ROCKET_RIDE_SPEED_MULT : 1);
        totalVel = motion;
        steps = Math.max(1, Math.ceil(motion / 2));
        stepVx = (dirX * motion) / steps;
        stepVy = (dirY * motion) / steps;
      } else {
        totalVel = Math.sqrt(b.vx * b.vx + b.vy * b.vy) * move;
        // Extracted: substeps n = round(TotalVel / 4), min 1 (scaled motion
        // keeps the same substep cadence so slow steps still hit flush)
        steps = Math.round(totalVel / BULLET_SUBSTEP_PX);
        if (steps < 1) steps = 1;
        stepVx = (b.vx * move) / steps;
        stepVy = (b.vy * move) / steps;
      }
      var dead = false;
      for (var s = 0; s < steps && !dead; s++) {
        b.x += stepVx;
        b.y += stepVy;
        if (!b.hidden || b.rider) {
          // the smoke trace also follows a rider-carried rocket (AddSmokeTrace)
          if (!b.trail) b.trail = [];
          b.trail.push({ x: b.x, y: b.y });
          if (b.trail.length > 12) b.trail.shift();
        }
        if (b.x < 0 || b.x > GAME_WIDTH || b.y < 0 || b.y > GAME_HEIGHT) {
          dead = true; // OutsideTheWorld: despawn without a blast
          if (isRocket && b.rider) {
            // the removal path runs PlayerStuck.GibPlayer() even when the
            // rocket leaves the world: the ride ends in the rider's gibs
            b.rider.rocketRide = null;
            b.rider.damage(999);
            b.rider = null;
          }
          break;
        }
        if (isRocket) { // the dodge is only a bullet shield (rockets stay lethal)
          var dodgeList = [player1, player2];
          for (var dit = 0; dit < dodgeList.length; dit++) {
            if (dodgeList[dit].matrixDodgeTimer > 0 &&
                rectsOverlap(dodgeList[dit].getBounds(), { x: b.x - 3, y: b.y - 3, w: 6, h: 6 })) {
              b.avoided.push(dodgeList[dit].id); // the dodge lets the rocket pass
            }
          }
        }
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.cloud || plat.ladder || plat.oneWay) continue; // bullets pass through clouds/ladders/one-way
          if (!pointInPlatform(b.x, b.y, plat)) continue;
          // SOLID_GLASS_01 has Strength 0: a rocket punches straight through
          // the pane (Strength <= StrengthLeft -> ForceDestruction, it keeps
          // flying). Rockets pass through without detonating and flames
          // never touch glass (it has no fire flags).
          if (plat.glass) {
            if (!b.flame) {
              var bv = Math.hypot(b.vx, b.vy) || 1;
              var bvDv = (b.impulse || 0.6) / plat.mass * B2D_TO_STEP;
              breakGlassPane(plat, (b.vx / bv) * bvDv, (b.vy / bv) * bvDv);
            }
            continue;
          }
          if (isRocket) detonateRocket(b); // BAZOOKA_ROCKET detonates
          else playSfx(plat.material === 'Metal' ? SFX.BULLET_HIT_METAL : SFX.BULLET_HIT_DEFAULT);
          dead = true;
          break;
        }
        if (dead) break;
        // rockets do not insta-kill fighters: the first reliable contact
        // hooks a ride (ProjectilesUpdater 902-937) while a steered rocket
        // crushes whoever it reaches
        var rt = [player1, player2];
        for (var rit = 0; rit < rt.length; rit++) {
          var rp = rt[rit];
          if (!rectsOverlap(rp.getBounds(), { x: b.x - 3, y: b.y - 3, w: 6, h: 6 })) continue;
          if (isRocket) {
            if (rp === b.rider) continue; // they are ON the rocket
            if (b.avoided && b.avoided.indexOf(rp.id) !== -1) continue;
            // RocketWillHit (extracted): a roller/diver shrugs half the time
            if (rp.rolling) continue; // mid-roll: no bullet type can hit, rockets included
            if (rp.diving && Math.random() < 0.5) continue;
            if (b.rider) {
              // Stuck rocket crush (906-916): the victim gibs and the rocket
              // is removed — the removal path ALWAYS gibs the rider too
              // (PlayerStuck.GibPlayer) and spawns the blast: the ride can
              // never end with the rider surviving it.
              rp.damage(999);
              rp.hitFlash = 6;
              if (rp.rocketRide && rp.rocketRide.rocket !== b) {
                rp.rocketRide.rocket.pendingExplode = true;
              }
              detonateRocket(b);
              dead = true;
              break;
            }
            if (rp.hp > 0) {
              // first contact: ResetPlayersAvoided + attach (904-937). A rider
              // already underway switches rockets (924-925: the old one re-shows
              // free to fly). The arrived rocket Hide()s INSIDE the victim.
              b.avoided = [rp.id];
              rp.stuckToProjectile(b);
              b.rider = rp;
              b.hidden = true;
              b.x = rp.x + rp.w / 2;
              b.y = rp.y + rp.h / 2;
              startRocketSlowmo();
              break;
            }
            // corpse hit: gib + blast go up anyway (918-920), nothing to hook
            detonateRocket(b);
            dead = true;
            break;
          }
          if (rp.id === b.owner) continue; // bullets ignore their shooter
          if (rp.rolling || rp.matrixDodgeTimer > 0) continue; // mid-roll: the bullet passes through
          // A bullet only costs HP and spills blood: the aim is never cancelled
          // or pushed away (knockback only via the gun's knockbackRule)
          applyBulletImpact(rp, b);
          playSfx(SFX.BULLET_HIT_FLESH);
          dead = true;
          break;
        }
        if (dead) break;
        if (heavyApi && cutHangingPropsByBullet(b)) {
          if (isRocket) detonateRocket(b);
          dead = true;
          break;
        }
        for (var rci = 0; rci < crates.length; rci++) {
          var rc = crates[rci];
          if (rc.dead) continue;
          if (bulletInsideProp(b, rc)) {
            if (isRocket) detonateRocket(b);
            else {
              damageCrate(rc, b.damage, bulletPushOnProp(b, rc), 0, { x: b.x, y: b.y, kind: 'bullet', pushAtContact: true });
              playSfx(rc.heavyConfig ? SFX[rc.heavyConfig.bulletHitSound] : SFX.BULLET_HIT_WOOD);
            }
            dead = true; // the crate eats the bullet
            break;
          }
        }
        if (dead) break;
        // barrel stage 1: the shot launches the barrel on a directed impulse
        // (F = v_bullet * k away from the shooter) and swaps the art to the
        // burning 161.svg; rockets hand the stage to their own blast instead
        for (var bpi = 0; bpi < barrels.length && !dead; bpi++) {
          var ba = barrels[bpi];
          if (ba.dead) continue;
          if (bulletInsideProp(b, ba)) {
            if (isRocket) detonateRocket(b);
            else {
              var bv = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
              var launch = bv * (BARREL_BULLET_IMPULSE_MULT + (b.impulse || DEFAULT_BULLET_IMPULSE) * BARREL_IMPULSE_FORCE_MULT);
              // the shot gives a NUDGE, not the direction: the bullet's
              // trajectory is only ~35% of the impulse, the rest is random
              // scatter in BOTH axes so the barrel sometimes shoots out
              // hard, sometimes pops up, and (less often) flies back toward
              // the shooter — mirroring the original's Math.random()*12-6
              var dirX = b.vx / bv;
              var dirY = b.vy / bv;
              var scatterX = (Math.random() - 0.5) * launch * 1.6;
              var scatterY = (Math.random() - 0.5) * launch * 1.2;
              var shotOnBarrel = barrelBulletResponse(ba, b, dirX * launch * 0.35);
              var ignited = igniteBarrel(
                ba,
                shotOnBarrel.dvx + scatterX,                // nudge (height-shaped) + scatter (can reverse)
                dirY * launch * 0.2 + BARREL_HOP_VY + scatterY, // hop + scatter (up/down)
                (Math.random() - 0.5) * (shotOnBarrel.torqueApplied ? BARREL_BULLET_SPIN_SCATTER : 1.8)
              );
              if (ignited && shotOnBarrel.torqueApplied) {
                ba.spin = rigidApi.clamp(ba.spin + shotOnBarrel.spin, BARREL_TIP_MAX_SPIN);
              }
            }
            dead = true; // the barrel eats the shot either way
            break;
          }
        }
        if (dead) break;
        if (!isRocket && !b.flame && detonateGrenadeHitByBullet(b)) { dead = true; break; }
        var targets = [player1, player2];
        // rockets handle their own player interactions (StuckToProjectile);
        // the plain bullet damage pass never touches them
        for (var t = 0; !isRocket && t < targets.length; t++) {
          var p = targets[t];
          if (p.id === b.owner) continue; // bullets ignore their shooter
          if (p.matrixDodgeTimer > 0) continue; // Matrix dodge: shot passes clean
          if (p.rolling) continue; // mid-roll: bullets pass through; once the roll ends they hit again
          if (
            b.x > p.x && b.x < p.x + p.w &&
            b.y > p.y && b.y < p.y + p.h
          ) {
            // Aim persists: a bullet only costs HP and spills blood
            applyBulletImpact(p, b);
            playSfx(SFX.BULLET_HIT_FLESH);
            dead = true;
            break;
          }
        }
      }
      if (dead) bullets.splice(i, 1);
    }
    // Deferred DoExplode resolution within the SAME pass: a payload that got
    // flagged by an earlier rocket (their ride blew up) detonates here too, so
    // every rider in the trade is dead before the round-end check runs — that
    // is what makes a steered mutual kill register as a draw.
    for (var d2 = bullets.length - 1; d2 >= 0; d2--) {
      var db = bullets[d2];
      if (db.rocket && db.pendingExplode && !db.exploded) {
        detonateRocket(db);
        bullets.splice(d2, 1);
      }
    }
  }

  // Barrel stage-2 detonation: the blast sound comes from the shared explodeAt
  // path (AudioManager), like the ring, ground fire, crate pushes and ragdolls.
  function explodeBarrelBoom(cx, cy) {
    explodeAt(cx, cy, BARREL_BLAST_RADIUS, BARREL_BLAST_DAMAGE_MAX, BARREL_BLAST_DAMAGE_MIN, BARREL_BLAST_OPTIONS);
  }

  // options: exceptId (caster, never hurt), noFire (skip the ground fire),
  // uiImmune (Ultra Instinct fighters ignore the blast: no damage/flash/push),
  // fullImpact (every fighter hit, UI included, is launched at full strength).
  // Original Explosions.as: the blast impulse is applied slightly off-centre
  // (towards the explosion: -cos*0.2 m, -sin*0.1 m), which gives props a light spin.
  var BLAST_CONTACT_OFFSET_X = 6; // px (0.2 m)
  var BLAST_CONTACT_OFFSET_Y = 3; // px (0.1 m)
  function blastContact(prop, blastX, blastY) {
    var centerX = prop.x + prop.w / 2;
    var centerY = prop.y + prop.h / 2;
    var dx = centerX - blastX;
    var dy = centerY - blastY;
    var distance = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: centerX - (dx / distance) * BLAST_CONTACT_OFFSET_X,
      y: centerY - (dy / distance) * BLAST_CONTACT_OFFSET_Y,
      kind: 'blast',
      pushAtContact: true
    };
  }

  function explodeAt(x, y, radius, damageMax, damageMin, options) {
    options = options || NO_BLAST_OPTIONS;
    var exceptId = options.exceptId;
    var noFire = options.noFire;
    var uiImmune = options.uiImmune;
    var fullImpact = options.fullImpact;
    var objectReach = options.objectReach;   // optional: crate/barrel reach, tighter than the fighter radius
    var objectDamage = options.objectDamage || damageMax;
    explosions.push({ x: x, y: y, radius: radius, frame: 0 });
    if (!options.silent) playSfx(options.sound || SFX.EXPLOSION);
    if (!noFire) spawnExplosionFire(x, y); // TriggerFireAt: barrel/rocket blasts leave a ground fire (grenades do not)
    breakGlassInRadius(x, y, radius); // AffectedByExplosions
    // AffectedByExplosions: crates take blast damage and fly with it
    for (var ci = 0; ci < crates.length; ci++) {
      var c = crates[ci];
      if (c.dead) continue;
      var cdx = c.x + c.w / 2 - x;
      var cdy = c.y + c.h / 2 - y;
      if (objectReach) {
        // short-reach blast: measured from the crate surface, flat damage
        var crateNearX = Math.max(c.x, Math.min(x, c.x + c.w));
        var crateNearY = Math.max(c.y, Math.min(y, c.y + c.h));
        var surfaceDist = Math.sqrt((crateNearX - x) * (crateNearX - x) + (crateNearY - y) * (crateNearY - y));
        if (surfaceDist > objectReach) continue;
        var reachFalloff = 1 - surfaceDist / objectReach;
        damageCrate(c, objectDamage, (cdx >= 0 ? 1 : -1) * 7 * reachFalloff, -5 * reachFalloff, blastContact(c, x, y));
        continue;
      }
      var cdist = Math.sqrt(cdx * cdx + cdy * cdy);
      if (cdist > radius) continue;
      var cfalloff = 1 - cdist / radius;
      damageCrate(c, damageMax * cfalloff, (cdx >= 0 ? 1 : -1) * 7 * cfalloff, -5 * cfalloff, blastContact(c, x, y));
    }
    if (heavyApi) cutHangingPropsByBlast(x, y, objectReach || radius);
    blastFragments(x, y, objectReach || radius);
    // Barrels ride the blast only when it really touches them: the staging
    // band runs from the barrel SURFACE (a grenade popping further away never
    // reaches its impact). Point-blank chains detonate now; the grazing band
    // catches fire and launches on the radial impulse for the next contact.
    for (var bi = 0; bi < barrels.length; bi++) {
      var br = barrels[bi];
      if (br.dead || br === barrelWaveSource) continue;
      var nx = Math.max(br.x, Math.min(x, br.x + br.w)); // closest body point
      var ny = Math.max(br.y, Math.min(y, br.y + br.h));
      var bdist = Math.sqrt((nx - x) * (nx - x) + (ny - y) * (ny - y));
      if (bdist > (objectReach || BARREL_BLAST_TRIGGER_DIST)) continue;
      if (bdist <= BARREL_BLAST_POINT_BLANK) {
        detonateBarrel(br); // the blast physically hit the barrel: boom now
        continue;
      }
      var bdx = nx - x;
      // the radial impulse is a nudge, not the direction: scatter dominates so
      // the barrel can fly sideways, up, or even back toward the blast
      var blastScatterX = (Math.random() - 0.5) * 8;
      var blastScatterY = (Math.random() - 0.5) * 6;
      igniteBarrel(
        br,
        ((bdx >= 0 ? 1 : -1) * 4 + blastScatterX) * BARREL_RESPONSE.horizontal, // nudge + scatter
        (-2 + BARREL_HOP_VY * 0.8 + blastScatterY) * BARREL_RESPONSE.vertical,
        (Math.random() - 0.5) * 1.8 * BARREL_RESPONSE.torque
      );
    }
    var targets = [player1, player2];
    for (var t = 0; t < targets.length; t++) {
      var p = targets[t];
      if (exceptId && p.id === exceptId) continue; // the caster's own blast never hurts them
      if (uiImmune && isUltraInstinct(p)) continue; // Ultra Instinct shrugs barrel blasts off
      var dx = p.x + p.w / 2 - x;
      var dy = p.y + p.h / 2 - y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      var falloff = 1 - dist / radius;
      var blastDamage = damageMin + (damageMax - damageMin) * falloff;
      p.damage(blastDamage);
      // Viscera only on the death itself: a strong blast (radius >= 90) that
      // leaves hp <= 0 converts the fighter into gore ONCE — the body sprite
      // disappears (drawPlayer hides gibbed bodies) and only the viscera
      // remain. Survivors and weak blasts never spill; the already-gibbed
      // corpse has no body left to burst again.
      if (radius >= GORE_EXPLOSION_MIN_RADIUS && p.hp <= 0 && !p.gibbed) {
        p.gibbed = true;
        spawnGoreFromFighter(p, falloff);
      }
      p.hitFlash = 6;
      if (isUltraInstinct(p) && !fullImpact) continue; // Ultra Instinct: damage yes, push/knockdown never (except the orb blast)
      if (fullImpact) falloff = 1; // the orb blast throws everyone it touches at full strength
      launchFighterLikeBlast(p, dx >= 0 ? 1 : -1, falloff);
    }
  }

  // The bazooka-blast reaction: thrown sideways and up, ragdolling; the touchdown
  // rolls into the knockback tumble. `strength` (0..1) scales the throw, so a
  // crush can reuse it slower and without an explosion.
  function launchFighterLikeBlast(p, directionX, strength) {
    var kb = 6 * VEL_SCALE * strength;
    p.airVelocityX = directionX * kb;
    p.airVelocityY = (-2 - 4 * strength) * VEL_SCALE;
    p.onGround = false;
    p.groundedPlatform = null;
    p.groundedCrate = null;
    p.knockedDown = false;
    p.falling = true; // the explosion ragdolls
    // Blast touchdown (requested: roll ONLY on high-impact events): the
    // explosion impact owns the reaction. The ragdoll flight keeps launch
    // visuals and the fall-on-player check, but the eventual touchdown
    // rolls into the knockback tumble instead of lying (window fuse).
    p.blastRollPending = BLAST_ROLL_PENDING_STEPS;
    if (p.aiming) p.abortAiming(true, "keep");
  }

  // exceptId: the shooter whose own bullet popped the grenade is spared by
  // the blast (quick-shot: the thrower never hurts themselves with it).
  function explodeGrenade(x, y, exceptId) {
    var options = Object.assign({}, GRENADE_BLAST_OPTIONS, { sound: SFX.GRENADE_EXPLOSION });
    if (exceptId != null) options.exceptId = exceptId;
    explodeAt(x, y, GRENADE.radius, GRENADE.damageMax, GRENADE.damageMin, options);
  }

  function explodeRocket(x, y) {
    // BAZOOKA_ROCKET: Damage 100 on detonation (ProjectileData), big blast.
    // No ground fire: a rocket impact never lights the scene.
    explodeAt(x, y, ROCKET_BLAST_RADIUS, ROCKET_BLAST_DAMAGE_MAX, ROCKET_BLAST_DAMAGE_MIN, { noFire: true });
  }

  // A bullet touching a live grenade (in flight or resting) pops it on the
  // spot, the thrower's own included (quick-shot: throw + straight shot).
  function detonateGrenadeHitByBullet(bullet) {
    for (var gi = grenades.length - 1; gi >= 0; gi--) {
      var target = grenades[gi];
      if (target.type === 'molotov') continue;
      if (Math.abs(bullet.x - target.x) <= GRENADE_BULLET_HIT_HALF &&
          Math.abs(bullet.y - target.y) <= GRENADE_BULLET_HIT_HALF_Y) {
        target.fuse = 0;
        detonateGrenadeCluster(target, gi, bullet.owner);
        return true;
      }
    }
    return false;
  }

  // Kick: any live grenade inside the fighter's kick box (ground or air) is
  // sent flying forward, away from the kicker.
  function kickGrenadesInReach(kicker) {
    var reach = KICK_RANGE * PLAYER_SIZE_SCALE;
    var box = {
      x: kicker.lastDirX > 0 ? kicker.x + kicker.w : kicker.x - reach,
      y: kicker.y - 16 * PLAYER_SIZE_SCALE,
      w: reach, h: kicker.h + 16 * PLAYER_SIZE_SCALE + 2
    };
    var kicked = false;
    for (var gi = 0; gi < grenades.length; gi++) {
      var g = grenades[gi];
      if (g.type === 'molotov') continue;
      if (!rectsOverlap(box, { x: g.x - 3, y: g.y - 3, w: 6, h: 6 })) continue;
      // same launch vector as leaving the hand with a level aim
      g.vx = GRENADE.throwSpeed * GRENADE_THROW_SPEED_SCALE * kicker.lastDirX;
      g.vy = GRENADE.upBias * GRENADE_THROW_LIFT_SCALE;
      kicked = true;
      playSfx(SFX.GRENADE_KICK);
      playSfx(SFX.KICK_SWING);
    }
    return kicked;
  }

  // Grenades that converge pop together: when one reaches the end of its fuse,
  // every other grenade (not molotovs) within GRENADE_CLUSTER_RADIUS goes off
  // on this same step, so a fighter in reach takes the SUM of all the blasts.
  function detonateGrenadeCluster(trigger, triggerIndex, shooterId) {
    if (trigger.type === 'molotov') {
      shatterMolotov(trigger);
      grenades.splice(triggerIndex, 1);
      return;
    }
    var toBlast = [trigger];
    for (var gi = 0; gi < grenades.length; gi++) {
      var other = grenades[gi];
      if (other === trigger || other.type === 'molotov') continue;
      var dx = other.x - trigger.x;
      var dy = other.y - trigger.y;
      if (dx * dx + dy * dy <= GRENADE_CLUSTER_RADIUS * GRENADE_CLUSTER_RADIUS) toBlast.push(other);
    }
    for (var bi = 0; bi < toBlast.length; bi++) {
      var index = grenades.indexOf(toBlast[bi]);
      if (index >= 0) grenades.splice(index, 1);
    }
    // The shooter is spared only when they popped their OWN grenade with a bullet
    var sparedId = shooterId != null && trigger.owner === shooterId ? shooterId : null;
    for (var ei = 0; ei < toBlast.length; ei++) explodeGrenade(toBlast[ei].x, toBlast[ei].y, sparedId);
  }

  // Thrown explosives never pass through crates or barrels: the canister is a
  // small box that bounces off the closest face of whatever prop it overlaps
  // (minimum-penetration axis), keeping a share of the speed like the walls.
  var GRENADE_HALF_SIZE = 1.5;
  var GRENADE_PROP_BOUNCE = 0.5;       // side / underside rebound share
  var GRENADE_PROP_TOP_BOUNCE = 0.35;  // landing on a prop top
  var GRENADE_PROP_TOP_FRICTION = 0.7;

  function bounceGrenadeOffProp(g, prop) {
    var half = GRENADE_HALF_SIZE;
    var overlapLeft = g.x + half - prop.x;          // penetration from the left face
    var overlapRight = prop.x + prop.w - (g.x - half);
    var overlapTop = g.y + half - prop.y;           // penetration from the top face
    var overlapBottom = prop.y + prop.h - (g.y - half);
    if (overlapLeft <= 0 || overlapRight <= 0 || overlapTop <= 0 || overlapBottom <= 0) return false;
    var pushX = overlapLeft < overlapRight ? -overlapLeft : overlapRight;
    var pushY = overlapTop < overlapBottom ? -overlapTop : overlapBottom;
    if (Math.abs(pushX) < Math.abs(pushY)) {
      g.x += pushX;
      g.vx = -g.vx * GRENADE_PROP_BOUNCE;
    } else {
      g.y += pushY;
      if (pushY < 0) { // landed on top
        g.vy = -Math.abs(g.vy) * GRENADE_PROP_TOP_BOUNCE;
        if (Math.abs(g.vy) < 0.8) g.vy = 0;
        g.vx *= GRENADE_PROP_TOP_FRICTION;
      } else {
        g.vy = Math.abs(g.vy) * GRENADE_PROP_TOP_BOUNCE;
      }
    }
    return true;
  }

  function bounceGrenadeOffProps(g) {
    for (var ci = 0; ci < crates.length; ci++) {
      if (!crates[ci].dead && bounceGrenadeOffProp(g, crates[ci])) return true;
    }
    for (var bi = 0; bi < barrels.length; bi++) {
      if (!barrels[bi].dead && bounceGrenadeOffProp(g, barrels[bi])) return true;
    }
    return false;
  }

  // The black entrances of the station walls are doorways, not colliders: a
  // thrown grenade / molotov crossing one flies through instead of rebounding.
  var DOORWAY_PROJECTILE_MARGIN_X = 6; // reaches a little before the wall face
  function projectileInDoorway(x, y) {
    for (var di = 0; di < doorPortals.length; di++) {
      var doorway = doorPortals[di];
      if (y >= doorway.y && y <= doorway.y + doorway.h &&
          x >= doorway.x - DOORWAY_PROJECTILE_MARGIN_X && x <= doorway.x + doorway.w + DOORWAY_PROJECTILE_MARGIN_X) return true;
    }
    return false;
  }

  // Map portals for thrown explosives (same PortalData as the fighters): a
  // grenade / molotov travelling toward the door side that enters one entrance
  // reappears at the linked entrance, keeping its vertical offset inside the
  // door and its full velocity. It stays locked until it leaves the doorway.
  function portalThrownExplosive(g) {
    var inside = false;
    for (var di = 0; di < doorPortals.length; di++) {
      var door = doorPortals[di];
      if (g.y < door.y || g.y > door.y + door.h) continue;
      if (g.x < door.x - DOORWAY_PROJECTILE_MARGIN_X || g.x > door.x + door.w) continue;
      inside = true;
      if (g.portalLocked || g.vx <= 0) break; // only while moving in the door direction
      var target = doorPortals[door.target];
      g.x = target.x + target.w / 2;
      g.y = target.y + (g.y - door.y);
      g.portalLocked = true; // keeps vx / vy / spin untouched
      return true;
    }
    if (!inside) g.portalLocked = false;
    return false;
  }

  function updateGrenades() {
    for (var i = grenades.length - 1; i >= 0; i--) {
      var g = grenades[i];
      if (!g) continue; // a cluster blast may have removed lower entries
      var move = ammoMoveScale(); // the canister shares the ammo dodge window
      // Fuse ticks on the same share: mid-window a canister hangs mid-flight
      // and detonates late instead of popping on a hidden healthy schedule
      if (g.type !== 'molotov') g.fuse -= move; // a molotov has no fuse: it breaks on impact only
      if (g.fuse <= 0 && g.type !== 'molotov') {
        detonateGrenadeCluster(g, i);
        continue;
      }
      g.age = (g.age || 0) + move;
      if (g.type === 'molotov') emitMolotovTrailFlame(g);
      // A molotov that reaches a fighter shatters on the spot (the thrower is
      // spared while the bottle leaves their hand)
      if (g.type === 'molotov') {
        var mHit = false;
        var mTargets = [player1, player2];
        for (var mt = 0; mt < mTargets.length; mt++) {
          var mp = mTargets[mt];
          if (mp.hp <= 0 || mp.matrixDodgeTimer > 0) continue;
          if (mp.id === g.owner) continue; // the thrower's own bottle never breaks on them (UserValues[0] != PlayerNr)
          if (rectsOverlap(mp.getBounds(), { x: g.x - 3, y: g.y - 3, w: 6, h: 6 })) { mHit = true; break; }
        }
        if (mHit) {
          shatterMolotov(g);
          grenades.splice(i, 1);
          continue;
        }
      }
      g.vy += PLAYER_GRAVITY * move * (g.type === 'molotov' ? 1 : GRENADE_GRAVITY_SCALE);
      g.spin += g.vx * move;
      var mVx = g.vx * move;
      var mVy = g.vy * move;
      var steps = Math.max(1, Math.round(Math.sqrt(mVx * mVx + mVy * mVy) / BULLET_SUBSTEP_PX));
      var prevY = g.y;
      for (var s = 0; s < steps; s++) {
        prevY = g.y;
        var prevX = g.x;
        g.x += mVx / steps;
        g.y += mVy / steps;
        portalThrownExplosive(g);
        // Solid gray structures: the side walls and the undersides bounce the
        // canister back too (the top-surface bounce below handles floors)
        var GR_HALF = 1.5;
        for (var gwi = 0; gwi < platforms.length; gwi++) {
          var gw = platforms[gwi];
          if (!gw.solidSides || gw.shape !== 'rect' || platformIsOneWay(gw) || gw.ladder || gw.glass || gw.elevator) continue;
          if (projectileInDoorway(g.x, g.y) || projectileInDoorway(prevX, prevY)) continue; // doorway: fly through
          if (g.x + GR_HALF <= gw.x || g.x - GR_HALF >= gw.x + gw.w ||
              g.y + GR_HALF <= gw.y || g.y - GR_HALF >= gw.y + gw.h) continue;
          var wasInX = prevX + GR_HALF > gw.x && prevX - GR_HALF < gw.x + gw.w;
          if (!wasInX) {
            // entered from the left or right face: reflect the horizontal speed
            var fromLeft = prevX <= gw.x;
            g.x = fromLeft ? gw.x - GR_HALF : gw.x + gw.w + GR_HALF;
            g.vx = -g.vx * 0.5;
            mVx = g.vx * move;
            if (g.type === 'molotov') g.shatters = true;
            break;
          }
          if (prevY - GR_HALF >= gw.y + gw.h) {
            // hit the underside: rebound downward
            g.y = gw.y + gw.h + GR_HALF;
            g.vy = Math.abs(g.vy) * 0.35;
            mVy = g.vy * move;
            if (g.type === 'molotov') g.shatters = true;
            break;
          }
        }
        if (bounceGrenadeOffProps(g)) {
          mVx = g.vx * move; mVy = g.vy * move;
          if (g.type === 'molotov') g.shatters = true;
        }
        // the thrown canister shatters the pane without bouncing off it
        for (var ggi = 0; ggi < glassPanes.length; ggi++) {
          var ggpane = glassPanes[ggi];
          if (!ggpane.broken && rectsOverlap({ x: g.x - 3, y: g.y - 3, w: 6, h: 6 }, ggpane)) {
            breakGlassPane(ggpane, g.vx * 0.25, g.vy * 0.25);
            if (g.type === 'molotov') g.shatters = true;
          }
        }
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.ladder || plat.glass) continue;
          var surfaceY = platformBoundaryForSpan(plat, g.x - 3, g.x + 3, false);
          if (surfaceY !== null && prevY <= surfaceY && g.y >= surfaceY) {
            g.y = surfaceY - 2; // rest just above the surface
            g.vy = -g.vy * 0.35; // bounce
            g.vx *= 0.7;
            if (Math.abs(g.vy) < 0.8) g.vy = 0;
            if (g.type === 'molotov') g.shatters = true;
            break;
          }
        }
        if (g.x < 3 || g.x > GAME_WIDTH - 3) {
          g.vx = -g.vx * 0.5;
          g.x = Math.max(3, Math.min(GAME_WIDTH - 3, g.x));
          if (g.type === 'molotov') g.shatters = true;
        }
        if (g.shatters) break; // the bottle burst: stop travelling this step
      }
      if (g.shatters) {
        shatterMolotov(g);
        grenades.splice(i, 1);
      }
    }
  }

  function updateExplosions() {
    for (var i = explosions.length - 1; i >= 0; i--) {
      explosions[i].frame++;
      if (explosions[i].frame >= GRENADE_EXPLOSION_FRAMES) explosions.splice(i, 1);
    }
  }

  // ---------- Gore (strong-blast viscera, deaths only) ----------
  // A blast at least GORE_EXPLOSION_MIN_RADIUS tears the DEAD fighter open
  // (hp <= 0): meat chunks and blood droplets burst out of the torso with the
  // blast impulse (flat falloff, like the crate AffectedByExplosions push),
  // fly with a soft gravity and whatever lands scars the floor until the
  // round restarts. Survivors never spill.
  function goreSpriteId(kind) {
    var pool = kind === 'chunk' ? GORE_CHUNK_SPRITE_IDS : GORE_SPRITES;
    return pool[(Math.random() * pool.length) | 0];
  }

  function spawnGoreFromFighter(p, strength, rangeScale) {
    // strength = blast falloff (0..1); called only when hp <= 0 after damage.
    // rangeScale (default 1) shrinks how far the pieces fly: a blast scatters
    // them wide, a crush only squirts them out close to the body.
    var range = rangeScale === undefined ? 1 : rangeScale;
    playSfx(SFX.GIB);
    var blastStrength = Math.min(1, strength + 0.5);
    var chunkCount = Math.max(Math.round(GORE_CHUNK_COUNT * blastStrength), GORE_MIN_CHUNKS);
    var dropCount = Math.max(Math.round(GORE_DROP_COUNT * blastStrength), GORE_MIN_DROPS);
    var cx = p.x + p.w / 2;
    var cy = p.y + p.h / 2;
    for (var i = 0; i < chunkCount + dropCount; i++) {
      var isChunk = i < chunkCount;
      var ang = Math.random() * Math.PI * 2;
      var speed = GORE_BURST_SPEED * blastStrength * range * (isChunk ? 1 : 0.85) * (0.5 + Math.random() * 0.85);
      gore.push({
        x: cx + (Math.random() - 0.5) * p.w * 0.7,
        y: cy + (Math.random() - 0.5) * p.h * 0.6,
        vx: Math.cos(ang) * speed,
        vy: (-2 - Math.random() * 4) * blastStrength * range + Math.sin(ang) * speed,
        sprite: goreSpriteId(isChunk ? 'chunk' : 'drop'),
        kind: isChunk ? 'chunk' : 'drop',
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.45,
        // Small pieces: a gore chunk must read like a torn scrap, never wider
        // than the fighter torso (~17 px). Shapes are ~4-17 px natural.
        scale: isChunk ? 0.8 + Math.random() * 0.5 : 0.65 + Math.random() * 0.35,
        life: GORE_AIR_LIFE
      });
    }
  }

  // Bullet impact blood: flat red pixels (no sprites) emitted at the exact hit
  // point. They fan out around the bullet direction with a random speed, feel a
  // light gravity and air friction, and fade out. Capped pool, updated from
  // updateStep and drawn as plain fillRect calls.
  var BLOOD_PIXEL_CAP = 260;
  var BLOOD_PIXEL_MIN_COUNT = 16;
  var BLOOD_PIXEL_EXTRA_COUNT = 9;
  var BLOOD_PIXEL_SPREAD_RAD = 0.9;      // half-angle of the cone around the shot direction
  var BLOOD_PIXEL_MIN_SPEED = 1.2;
  var BLOOD_PIXEL_SPEED_RANGE = 3.2;
  var BLOOD_PIXEL_GRAVITY = 0.12;
  var BLOOD_PIXEL_AIR_FRICTION = 0.95;
  var BLOOD_PIXEL_MIN_LIFE = 70;
  var BLOOD_PIXEL_LIFE_RANGE = 40;
  var BLOOD_PIXEL_COLORS = ['#b30000', '#d40000', '#ff1a1a', '#8a0000'];
  var bloodPixels = [];
  // Some droplets that reach a floor stay as tiny dried specks (a light stain,
  // never a big puddle): low odds, small size, hard cap with the oldest dropped.
  var BLOOD_FLOOR_STAIN_CHANCE = 0.6;
  var BLOOD_FLOOR_STAIN_CAP = 260;
  var BLOOD_FLOOR_STAIN_ALPHA = 0.9;
  var BLOOD_FLOOR_STAIN_COLOR = '#a00000';
  var bloodFloorStains = [];

  // Splashes against a wall / structure / crate / barrel stay too (never fade).
  // Stains on movable props ride along with them via an anchor + offset.
  var BLOOD_WALL_STAIN_CHANCE = 0.85;
  var BLOOD_WALL_STAIN_CAP = 200;
  var bloodWallStains = [];

  function addBloodFloorStain(x, y, size) {
    if (bloodFloorStains.length >= BLOOD_FLOOR_STAIN_CAP) bloodFloorStains.shift();
    bloodFloorStains.push({ x: Math.round(x), y: Math.round(y) - 1, size: size });
  }

  function addBloodWallStain(x, y, size, anchor) {
    if (bloodWallStains.length >= BLOOD_WALL_STAIN_CAP) bloodWallStains.shift();
    bloodWallStains.push({
      x: Math.round(x), y: Math.round(y), size: size,
      anchor: anchor || null,
      dx: anchor ? Math.round(x) - anchor.x : 0,
      dy: anchor ? Math.round(y) - anchor.y : 0
    });
  }

  // Solid vertical faces a pixel can splash on: static platforms plus props.
  function bloodWallHit(px, previousX) {
    var list = [platforms, crates, barrels];
    for (var li = 0; li < list.length; li++) {
      var group = list[li];
      for (var i = 0; i < group.length; i++) {
        var r = group[i];
        if (li === 0 && (r.ladder || r.glass || r.shape === 'polygon' || r.shape === 'circle')) continue;
        if (px.y < r.y || px.y > r.y + r.h) continue;
        var inside = px.x > r.x && px.x < r.x + r.w;
        if (!inside) continue;
        var cameFromLeft = previousX <= r.x;
        var cameFromRight = previousX >= r.x + r.w;
        if (!cameFromLeft && !cameFromRight) continue;
        px.x = cameFromLeft ? r.x - 1 : r.x + r.w;
        return li === 0 ? true : r;
      }
    }
    return null;
  }

  function spawnBloodHit(x, y, dirVx) {
    var shotAngle = dirVx >= 0 ? 0 : Math.PI;
    var count = BLOOD_PIXEL_MIN_COUNT + ((Math.random() * BLOOD_PIXEL_EXTRA_COUNT) | 0);
    for (var i = 0; i < count; i++) {
      if (bloodPixels.length >= BLOOD_PIXEL_CAP) bloodPixels.shift();
      var angle = shotAngle + (Math.random() * 2 - 1) * BLOOD_PIXEL_SPREAD_RAD;
      var speed = BLOOD_PIXEL_MIN_SPEED + Math.random() * BLOOD_PIXEL_SPEED_RANGE;
      var life = BLOOD_PIXEL_MIN_LIFE + Math.random() * BLOOD_PIXEL_LIFE_RANGE;
      bloodPixels.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        life: life, maxLife: life,
        size: Math.random() < 0.7 ? 1 : 2,
        color: BLOOD_PIXEL_COLORS[(Math.random() * BLOOD_PIXEL_COLORS.length) | 0]
      });
    }
  }

  function updateBloodPixels() {
    for (var i = bloodPixels.length - 1; i >= 0; i--) {
      var px = bloodPixels[i];
      var previousY = px.y;
      var previousX = px.x;
      px.x += px.vx * gameSpeed;
      px.y += px.vy * gameSpeed;
      px.vy += BLOOD_PIXEL_GRAVITY * gameSpeed;
      px.vx *= BLOOD_PIXEL_AIR_FRICTION;
      px.vy *= BLOOD_PIXEL_AIR_FRICTION;
      px.life--;
      if (px.vy > 0 && landedOnFloor(px, previousY)) {
        if (Math.random() < BLOOD_FLOOR_STAIN_CHANCE) addBloodFloorStain(px.x, px.y, px.size);
        bloodPixels.splice(i, 1);
        continue;
      }
      var wallHit = bloodWallHit(px, previousX);
      if (wallHit) {
        if (Math.random() < BLOOD_WALL_STAIN_CHANCE) {
          addBloodWallStain(px.x, px.y, px.size, wallHit === true ? null : wallHit);
        }
        bloodPixels.splice(i, 1);
        continue;
      }
      if (px.life <= 0) bloodPixels.splice(i, 1);
    }
  }

  // A falling pixel crossing a solid surface from above lands on it (snaps to it).
  function landedOnFloor(px, previousY) {
    for (var pi = 0; pi < platforms.length; pi++) {
      var plat = platforms[pi];
      if (plat.ladder || plat.glass) continue;
      var surfaceY = platformBoundaryForSpan(plat, px.x - 1, px.x + 1, false);
      if (surfaceY !== null && previousY <= surfaceY && px.y >= surfaceY) {
        px.y = surfaceY;
        return true;
      }
    }
    return false;
  }

  function drawBloodFloorStains() {
    ctx.globalAlpha = BLOOD_FLOOR_STAIN_ALPHA;
    ctx.fillStyle = BLOOD_FLOOR_STAIN_COLOR;
    for (var i = 0; i < bloodFloorStains.length; i++) {
      var st = bloodFloorStains[i];
      ctx.fillRect(st.x, st.y - 1, st.size + 2, 2);
    }
    for (i = bloodWallStains.length - 1; i >= 0; i--) {
      var ws = bloodWallStains[i];
      if (ws.anchor) {
        // the prop is gone (broken / respawned elsewhere): its splatter goes with it
        if (crates.indexOf(ws.anchor) < 0 && barrels.indexOf(ws.anchor) < 0) {
          bloodWallStains.splice(i, 1);
          continue;
        }
        ctx.fillRect(Math.round(ws.anchor.x) + ws.dx, Math.round(ws.anchor.y) + ws.dy, 2, ws.size + 1);
      } else {
        ctx.fillRect(ws.x, ws.y, 2, ws.size + 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawBloodPixels() {
    for (var i = 0; i < bloodPixels.length; i++) {
      var px = bloodPixels[i];
      ctx.globalAlpha = 1;
      ctx.fillStyle = px.color;
      ctx.fillRect(Math.round(px.x), Math.round(px.y), px.size, px.size);
    }
    ctx.globalAlpha = 1;
  }

  // Three health states: 0 healthy, 1 hurt (some blood on the body), 2 badly
  // hurt (blood on the head and nose)
  var HEALTH_HURT_BELOW = 66;
  var HEALTH_CRITICAL_BELOW = 33;
  function healthState(p) {
    if (p.hp <= HEALTH_CRITICAL_BELOW) return 2;
    if (p.hp <= HEALTH_HURT_BELOW) return 1;
    return 0;
  }
  Player.prototype.healthState = function () { return healthState(this); };

  // Blood marks painted over the fighter sprite (upright poses only, where the
  // head/torso anchors are reliable)
  function drawWoundMarks(p) {
    var st = healthState(p);
    if (st === 0 || p.hp <= 0) return;
    if (p.rolling || p.diving || p.knockbackRoll || p.grabbedBy || p.rocketRide) return;
    var dir = p.lastDirX >= 0 ? 1 : -1;
    var cx = p.x + p.w / 2;
    var k = p.h / 40;
    ctx.save();
    ctx.fillStyle = 'rgba(150,10,10,0.85)';
    // hurt: a few drops on the torso
    ctx.fillRect(cx - 4 * k * dir, p.y + p.h * 0.45, 2 * k, 2 * k);
    ctx.fillRect(cx + 1 * k * dir, p.y + p.h * 0.55, 1.5 * k, 3 * k);
    if (st === 2) {
      ctx.fillStyle = 'rgba(190,15,15,0.95)';
      // head: forehead cut + trickle
      ctx.fillRect(cx - 3 * k, p.y + p.h * 0.06, 3 * k, 1.5 * k);
      ctx.fillRect(cx - 2 * k, p.y + p.h * 0.06 + 1.5 * k, 1.2 * k, 3 * k);
      // nose, on the facing side
      ctx.fillRect(cx + (dir > 0 ? 2.5 : -4) * k, p.y + p.h * 0.17, 1.8 * k, 2.5 * k);
    }
    ctx.restore();
  }

  function addGoreStain(x, y, sprite, scale) {
    goreStains.push({
      x: x,
      y: y,
      sprite: sprite,
      angle: Math.random() * Math.PI * 2,
      scale: scale,
      alpha: 0.9
    });
    if (goreStains.length > GORE_STAIN_MAX) goreStains.splice(0, goreStains.length - GORE_STAIN_MAX);
  }

  function updateGore() {
    for (var i = gore.length - 1; i >= 0; i--) {
      var g = gore[i];
      var prevY = g.y;
      g.vy += GORE_GRAVITY;
      g.x += g.vx;
      g.y += g.vy;
      g.vx *= 0.98; // air drag
      g.angle += g.spin;
      g.life--;
      if (g.x < 2 || g.x > GAME_WIDTH - 2 || g.y > 640) {
        gore.splice(i, 1);
        continue;
      }
      // Landing: crossing any solid surface from above sticks the piece there
      var landed = false;
      for (var pi = 0; pi < platforms.length && !landed; pi++) {
        var plat = platforms[pi];
        if (plat.ladder || plat.glass) continue;
        var surfaceY = platformBoundaryForSpan(plat, g.x - 2, g.x + 2, false);
        if (surfaceY !== null && prevY <= surfaceY && g.y >= surfaceY) {
          landed = true;
          g.y = surfaceY;
        }
      }
      if (landed) {
        if (g.kind === 'drop' || Math.random() < GORE_STAIN_CHUNK_PROB) {
          addGoreStain(g.x, g.y - 1, g.sprite, g.scale * 1.15);
        }
        gore.splice(i, 1);
        continue;
      }
      if (g.life <= 0) gore.splice(i, 1);
    }
  }

  // ---------- Destructible glass (SOLID_GLASS_01) ----------
  // Extracted behavior (MapPremadeItems.as 1323 / b2ContactListener / deconstruct flow):
  // - The pane is a hinge-anchored dynamic body, 5 hp with impact/bullet/explosion
  //   resistance 10: any punch (KickPower 1.4), kick, explosion or moving body
  //   breaks it. Fire never touches it (no CanBurn / fire flags).
  // - b2ContactListener.Result: on contact between two DYNAMIC bodies where one
  //   is IsGlass -> ForceDestruction. Static-only contact never breaks it.
  // - Bullets (Strength 0) pierce: ForceDestruction + impulse, the projectile
  //   keeps flying. Rockets also pass through without detonating.
  // - Explosions apply the AffectedByExplosions impulse BEFORE the shatter, so
  //   shards inherit the pane velocity. Kick does the same (KickPower 1.4).
  // - onDestruction spawns one GLASS_SHARD_1 every 6 px along the pane length,
  //   each with pane velocity + (rand-0.5, rand-0.5) m/s and random angle/spin,
  //   plus the BUSTGLASS sound. Shards live 240 + 50 ticks, alpha fading over
  //   the last 50 (debris update/fade functions).
  // Velocity conversion: 1 m/s of the Box2D bodies = 30 px at 60 steps/s = 0.5 px/step.
  var GLASS_SHARD_LIFE = 290;
  var GLASS_SHARD_FADE = 50;
  var B2D_TO_STEP = 0.5;
  var GLASS_SHARD_KICK_SPEED = 1.4; // extracted KickPower for SOLID_GLASS_01
  var GLASS_SHARD_EXPLOSION_SPEED = 5; // extracted explosionPowerObjects

  function spawnGlassShards(pane, paneVx, paneVy) {
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
        vx: paneVx + (Math.random() - 0.5) * B2D_TO_STEP,
        vy: paneVy + (Math.random() - 0.5) * B2D_TO_STEP,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * Math.PI * B2D_TO_STEP,
        size: 4, // GLASS_SHARD_1 corners: a 4x4 px triangle
        life: GLASS_SHARD_LIFE
      });
    }
  }

  // paneVx/paneVy: velocity the pane carries at the moment of destruction
  // (kick/explosion/bullet impulse), already converted to px/step. The shards
  // inherit it plus a random +-0.5 m/s jitter (extracted onDestruction).
  function breakGlassPane(pane, paneVx, paneVy) {
    if (!pane.glass || pane.broken) return false;
    pane.broken = true;
    playSfx(SFX.GLASS_BREAK);
    pane.velocity.x = paneVx || 0;
    pane.velocity.y = paneVy || 0;
    var idx = platforms.indexOf(pane);
    if (idx !== -1) platforms.splice(idx, 1);
    spawnGlassShards(pane, pane.velocity.x, pane.velocity.y);
    return true;
  }

  // Melee impulse extracted from Kick(): ApplyImpulse((dir * KickPower, -KickPower)).
  // Deconstruct defers the shatter one frame, so shards inherit the panel velocity:
  // dv = impulse / mass, converted m/s -> px/step.
  function glassKickVelocity(pane, dirX) {
    var dv = (GLASS_SHARD_KICK_SPEED / pane.mass) * B2D_TO_STEP;
    return { x: dirX * dv, y: -dv };
  }

  // Explosion impulse: energy proportional-falloff (1 inside half radius, linear
  // to 0 at the edge, decompiled ExplosionHit), direction away from the blast.
  function glassExplosionVelocity(pane, x, y, radius) {
    var dx = pane.x + pane.w / 2 - x;
    var dy = pane.y + pane.h / 2 - (y - 4); // extracted aim point: y - 4
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius) return null;
    var falloff = dist <= radius / 2 ? 1 : 1 - (dist * 2 - radius) / radius;
    if (falloff <= 0) return null;
    // The blast impulse scales with the body mass (impulse = mass * power * falloff),
    // so the inherited velocity is mass-independent: dv = power * falloff.
    var speed = GLASS_SHARD_EXPLOSION_SPEED * B2D_TO_STEP * falloff;
    var inv = dist > 1e-6 ? 1 / dist : 0;
    return { x: dx * inv * speed, y: dy * inv * speed };
  }

  // A blast wave takes out AT MOST ONE pane: the closest unbroken pane whose
  // center is inside the blast (falloff > 0). Another blast is needed for the
  // next one — one explosion never shatters both.
  function breakGlassInRadius(x, y, radius) {
    var best = null, bestV = null, bestDist = Infinity;
    for (var i = 0; i < glassPanes.length; i++) {
      var plat = glassPanes[i];
      if (plat.broken) continue;
      var v = glassExplosionVelocity(plat, x, y, radius);
      if (!v) continue;
      var dx = plat.x + plat.w / 2 - x;
      var dy = plat.y + plat.h / 2 - (y - 4);
      var d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = plat;
        bestV = v;
      }
    }
    if (best) breakGlassPane(best, bestV.x, bestV.y);
  }

  var flameTick = 0; // step counter for the per-fighter flame contact cadence

  // A flamethrower node touching a solid (walls and floors; clouds never stop
  // it: PassCloud) lands: back out of the solid, then it becomes ground fire
  function flameHitsSolid(x, y) {
    for (var pi = 0; pi < platforms.length; pi++) {
      var plat = platforms[pi];
      if (plat.ladder || plat.glass || plat.cloud) continue;
      if (x >= plat.x && x <= plat.x + plat.w && y >= plat.y && y <= plat.y + plat.h) return true;
    }
    return false;
  }

  function landFlameNode(f) {
    var life = EMBER_GROUND_LIFE_MIN + Math.random() * (EMBER_GROUND_LIFE_MAX - EMBER_GROUND_LIFE_MIN);
    var ember = {
      x: f.x, y: f.y, vx: 0, vy: 0, size: 5 + Math.random() * 3,
      life: life, maxLife: life, inAir: false, slowing: false, hit: {},
      phase: Math.random() * Math.PI * 2,
      sparkTimer: Math.random() * EMBER_SPARK_LEVEL_MAX, crateTick: 0
    };
    groundFire.push(ember);
    mergeGroundFire(ember, groundFire.length - 1); // GetNearbyFireNode: no stacking
  }

  // Fire contagion by body contact: a burning fighter touching a clean one
  // lights them. The newcomer always starts at level 1 (igniteFire from the
  // NONE state), whatever level the carrier is at; the carrier keeps its own.
  function isBurning(fighter) {
    return !!fighter.fireState && fighter.fireState !== FireStates.normal;
  }
  function canCatchFire(fighter) {
    return fighter.hp > 0 && !isBurning(fighter) &&
      !(fighter.matrixDodgeTimer > 0) && !isUltraInstinct(fighter);
  }
  // Only a slow touch spreads the fire: a fighter that is sprinting, in the
  // air (jump, fall, dive) passes through without passing the flame on.
  function isFastOrAirborne(fighter) {
    return fighter.sprinting || fighter.jumping || fighter.diving || fighter.falling || !fighter.onGround;
  }
  function spreadFireBetweenFighters(a, b) {
    var aCarries = isBurning(a) && a.hp > 0;
    var bCarries = isBurning(b) && b.hp > 0;
    if (aCarries === bCarries) return;
    var carrier = aCarries ? a : b;
    var victim = aCarries ? b : a;
    if (!canCatchFire(victim)) return;
    if (isFastOrAirborne(carrier) || isFastOrAirborne(victim)) return;
    if (!rectsOverlap(carrier.getBounds(), victim.getBounds())) return;
    victim.igniteFire();
  }

  function updateFlames() {
    flameTick++;
    for (var i = flames.length - 1; i >= 0; i--) {
      var f = flames[i];
      var move = ammoMoveScale(); // flame puffs share the ammo dodge window
      f.life -= move;
      if (f.life <= 0) { flames.splice(i, 1); continue; }
      // Flamethrower nodes follow the original Superfighters fire nodes: drag
      // 0.93 (x) / 0.95 (y) per 24 fps tick while SlowingDown, then gravity.
      // Sparks and pool flames keep their own light drift.
      if (f.thrower) {
        var flameDragX = 0.93 + 0.07 * (1 - gameSpeed);
        var flameDragY = 0.95 + 0.05 * (1 - gameSpeed);
        f.vx *= Math.pow(flameDragX, move * 24 / FPS);
        if (f.slowing) {
          f.vy *= Math.pow(flameDragY, move * 24 / FPS);
          if (Math.sqrt(f.vx * f.vx + f.vy * f.vy) <= FLAME_GLIDE_STOP) f.slowing = false;
        } else {
          f.vy += FLAME_FALL_GRAVITY * move;
        }
        var fSteps = Math.max(1, Math.round(Math.sqrt(f.vx * f.vx + f.vy * f.vy) * move / 2));
        var landed = false;
        for (var fs = 0; fs < fSteps; fs++) {
          f.x += f.vx * move / fSteps;
          f.y += f.vy * move / fSteps;
          if (flameHitsSolid(f.x, f.y)) {
            for (var back = 0; back < 10 && flameHitsSolid(f.x, f.y); back++) {
              f.x -= f.vx * move / (fSteps * 4);
              f.y -= f.vy * move / (fSteps * 4);
            }
            landed = true;
            break;
          }
        }
        if (landed) { landFlameNode(f); flames.splice(i, 1); continue; }
        if (f.y > 640 || f.x < -20 || f.x > GAME_WIDTH + 20) { flames.splice(i, 1); continue; }
      } else {
        if (f.owner === -1) f.vy -= 0.03 * move; // flames drift upward
        f.x += f.vx * move;
        f.y += f.vy * move;
      }
      var targets = [player1, player2];
      for (var t = 0; t < targets.length; t++) {
        var p = targets[t];
        if (p.hp <= 0) continue;
        if (p.matrixDodgeTimer > 0) continue; // Matrix dodge: flames arc past
        if (f.damage <= 0) continue; // ember spark puffs: visual-only, no bite
        if (f.thrower) {
          // Flamethrower contact (PlayerOverlap): never the owner, no bullet
          // damage or flinch; every ~84 ms of contact adds 20 to the burn
          // meter (5 contacts -> level 2) plus a small extra burn.
          if (f.owner === p.id) continue;
          if (flameTick - (p.flameTouchTick || -99) < FLAME_CONTACT_STEPS) continue;
          if (rectsOverlap(p.getBounds(), { x: f.x - f.size / 2, y: f.y - f.size / 2, w: f.size, h: f.size })) {
            p.flameTouchTick = flameTick;
            p.setHp(p.hp - FLAME_CONTACT_HP);
            p.addBurn(FLAME_CONTACT_BURN);
          }
          continue;
        }
        if (f.hit[p.id]) continue;
        if (rectsOverlap(p.getBounds(), { x: f.x - f.size / 2, y: f.y - f.size / 2, w: f.size, h: f.size })) {
          f.hit[p.id] = true;
          p.damage(f.damage);
          p.fireFlash = 6;
          p.igniteFire(); // the crowd of flames lights the fighter (burn L1 -> escalates)
        }
      }
      // fire burns crates (CanBurn, extracted) — sparks share the array but
      // carry no burn (the pool crater embers run the ObjectFireDamage pulse)
      for (var ci = 0; ci < crates.length; ci++) {
        var c = crates[ci];
        if (c.dead) continue;
        if (f.damage > 0 && rectsOverlap(c, { x: f.x - f.size / 2, y: f.y - f.size / 2, w: f.size, h: f.size })) {
          igniteCrate(c); // the flame lights the crate; it burns down by itself
          break;
        }
      }
      for (var fgi = 0; fgi < propFragments.length && f.damage > 0; fgi++) {
        if (rectsOverlap(propFragments[fgi], { x: f.x - f.size / 2, y: f.y - f.size / 2, w: f.size, h: f.size })) igniteCrate(propFragments[fgi]);
      }
      // fire STAGES barrels (fire + fuel: the smallest puff is an ignition
      // source, not a dent) — the launch follows on the next mover step
      if (f.damage > 0) {
        for (var bfi = 0; bfi < barrels.length; bfi++) {
          var fb = barrels[bfi];
          if (fb.dead || fb.burning) continue;
          if (rectsOverlap(fb, { x: f.x - f.size / 2, y: f.y - f.size / 2, w: f.size, h: f.size })) {
            igniteBarrel(fb, (Math.random() - 0.5) * 2, BARREL_HOP_VY * 0.8, 0.25);
          }
        }
      }
    }
  }

  // Fire look (Superfighters-style): additive radial blobs — white-hot core,
  // yellow, orange, dark red edge fading to nothing — so overlapping flames
  // bloom into one burning mass. Flamethrower nodes stretch into a tongue
  // along their travel and swell/fade with age; pool flames are flickering
  // teardrops licking upward, with a dim smoke wisp when they die.
  function drawFlames() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < flames.length; i++) {
      var f = flames[i];
      if (!isFinite(f.x) || !isFinite(f.y) || !isFinite(f.size)) continue; // corrupt node: skip, never throw
      if (!f.maxLife) f.maxLife = f.life;
      var left = Math.max(0, Math.min(1, f.life / f.maxLife)); // 1 fresh -> 0 dying
      var age = 1 - left;
      var flick = 0.8 + 0.2 * Math.sin(flameTick * 0.7 + f.x * 0.37 + f.y * 0.11);
      var r, alpha, tongue, ang = -Math.PI / 2;
      if (f.thrower) {
        r = f.size * (0.7 + 1.1 * Math.min(1, age * 4)) * flick;   // the puff swells as it travels
        alpha = Math.min(1, left * 3.5) * (0.5 + 0.5 * flick);
        var sp = Math.sqrt(f.vx * f.vx + f.vy * f.vy);
        tongue = Math.min(14, sp * 2.2) * (1 - age * 0.6);
        if (sp > 0.05) ang = Math.atan2(-f.vy, -f.vx); // trail behind the node
        else ang = -Math.PI / 2;
      } else {
        r = f.size * (0.55 + 0.45 * left) * flick;
        alpha = Math.min(1, left * 2.5) * (0.55 + 0.45 * flick);
        tongue = f.damage > 0 ? r * 2.4 * (0.6 + 0.4 * flick) : r * 1.2; // pool tongues rise
      }
      if (alpha <= 0.02) continue;
      var tx = f.x + Math.cos(ang) * tongue;
      var ty = f.y + Math.sin(ang) * tongue;
      // tongue: outer dark-orange teardrop then a brighter inner one
      ctx.fillStyle = 'rgba(200,60,6,' + (0.45 * alpha).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(f.x - Math.sin(ang) * r, f.y + Math.cos(ang) * r);
      ctx.quadraticCurveTo(f.x + Math.cos(ang) * tongue * 0.55 + Math.sin(ang) * r * 0.5, f.y + Math.sin(ang) * tongue * 0.55 - Math.cos(ang) * r * 0.5, tx, ty);
      ctx.quadraticCurveTo(f.x + Math.cos(ang) * tongue * 0.55 - Math.sin(ang) * r * 0.5, f.y + Math.sin(ang) * tongue * 0.55 + Math.cos(ang) * r * 0.5, f.x + Math.sin(ang) * r, f.y - Math.cos(ang) * r);
      ctx.closePath();
      ctx.fill();
      var grad = ctx.createRadialGradient(f.x, f.y, r * 0.1, f.x, f.y, r * 1.5);
      grad.addColorStop(0.0, 'rgba(255,255,230,' + (0.95 * alpha).toFixed(3) + ')');
      grad.addColorStop(0.3, 'rgba(255,214,64,' + (0.85 * alpha).toFixed(3) + ')');
      grad.addColorStop(0.62, 'rgba(255,120,16,' + (0.6 * alpha).toFixed(3) + ')');
      grad.addColorStop(0.88, 'rgba(190,50,4,' + (0.25 * alpha).toFixed(3) + ')');
      grad.addColorStop(1.0, 'rgba(120,30,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Molotov shatter (extracted TriggerFireAt('MOLOTOV')): every fighter within
  // 20 px of the burst has BurnState set to 100, so it starts at fire LEVEL 2
  // (a bottle that reaches the fighter), then the fire pool spreads.
  function shatterMolotov(g) {
    playSfx(SFX.MOLOTOV_SHATTER);
    playSfx(SFX.MOLOTOV_BURST);
    var fighters = [player1, player2];
    for (var mi = 0; mi < fighters.length; mi++) {
      var mp = fighters[mi];
      if (mp.hp <= 0 || mp.matrixDodgeTimer > 0) continue;
      var mdx = mp.x + mp.w / 2 - g.x;
      var mdy = mp.y + mp.h / 2 - g.y;
      var direct = rectsOverlap(mp.getBounds(), { x: g.x - 3, y: g.y - 3, w: 6, h: 6 });
      if (direct || Math.sqrt(mdx * mdx + mdy * mdy) <= MOLOTOV_BURN_RADIUS) {
        mp.burnMeter = FIRE_RANK2_MIN;
        mp.addBurn(0);
      }
    }
    spawnMolotovFire(g.x, g.y, g.owner);
  }

  // The lit rag on the flying bottle (UpdateFunction): a small flame particle
  // above the neck, never doing damage.
  function emitMolotovTrailFlame(g) {
    g.trailTimer = (g.trailTimer || 0) - ammoMoveScale();
    if (g.trailTimer > 0) return;
    g.trailTimer = MOLOTOV_TRAIL_CADENCE;
    for (var i = 0; i < MOLOTOV_TRAIL_FLAMES; i++) {
      flames.push({
        x: g.x + (Math.random() - 0.5) * 4, y: g.y - MOLOTOV_TRAIL_OFFSET_Y - Math.random() * 3,
        vx: (Math.random() - 0.5) * 0.4, vy: -0.05,
        life: 14 + Math.random() * 10, damage: 0, owner: -1, hit: {},
        size: (3 + Math.random() * 2) * MOLOTOV_FLAME_SCALE
      });
    }
  }

  // Molotov blast (TriggerFireAt('MOLOTOV')): 22 fire nodes burst in a FULL
  // circle (angle = PI / 11 * i), launched at 3 + rand * 0.5 px per tick from 3 px
  // off the impact; each glides under drag, falls and lands on the first floor
  // it meets, where nearby landings merge. Unlike the barrel fan the nodes
  // burn exactly 4 s counted from the moment each one lands.
  function spawnMolotovFire(x, y, owner) {
    for (var i = 0; i < MOLOTOV_FIRE_COUNT; i++) {
      var ang = Math.PI / (MOLOTOV_FIRE_COUNT / 2) * i;
      var speed = (MOLOTOV_FIRE_SPEED + Math.random() * MOLOTOV_FIRE_SPEED_JITTER) * VEL_SCALE;
      var life = MOLOTOV_FIRE_LIFE;
      groundFire.push({
        x: x + Math.cos(ang) * EXPLOSION_FIRE_START_OFFSET,
        y: y + Math.sin(ang) * EXPLOSION_FIRE_START_OFFSET,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - Math.random() * EMBER_RISE_BIAS,
        size: (5 + Math.random() * 3) * MOLOTOV_FLAME_SCALE,
        life: life, maxLife: life,
        inAir: true, slowing: true, molotovFire: true, owner: owner,
        hit: {}, phase: Math.random() * Math.PI * 2,
        sparkTimer: Math.random() * EMBER_SPARK_LEVEL_MAX, crateTick: 0
      });
    }
  }

  // ---------- Explosion ground fire (extracted Fires.as / FireNodeData) ----------
  // Every explosion leaves a fire on the ground: TriggerFireAt('BARREL') fans
  // 18 embers over the lower semicircle (angle = PI / (count/2) * i), each one
  // a FireNodeData: it glides with drag while SlowingDown until TotalVel <= 2,
  // then falls until a static lands it; landed, the burn timer counts down and
  // nearby embers merge so the pool does not stack. Contact lights the fighter
  // (the fire state machine starts at level 1, the user leaves level 2 as-is).
  function spawnExplosionFire(x, y) {
    for (var i = 0; i < EXPLOSION_FIRE_COUNT; i++) {
      var ang = Math.PI / (EXPLOSION_FIRE_COUNT / 2) * i; // 0..PI fan, y down
      var speed = EXPLOSION_FIRE_SPEED + Math.random() * EXPLOSION_FIRE_SPEED_JITTER;
      var life = EMBER_GROUND_LIFE_MIN + Math.random() * (EMBER_GROUND_LIFE_MAX - EMBER_GROUND_LIFE_MIN);
      groundFire.push({
        x: x + Math.cos(ang) * EXPLOSION_FIRE_START_OFFSET,
        y: y + Math.sin(ang) * EXPLOSION_FIRE_START_OFFSET,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - Math.random() * EMBER_RISE_BIAS,
        size: 5 + Math.random() * 3, // FireArea-scale glow radius
        life: life, maxLife: life, // 1 - 2 s on the floor (requested max)
        inAir: true,
        slowing: true, // SlowingDown: glide first, gravity resumes when slow
        hit: {}, // one contact hit per fighter (flame-puff bookkeeping)
        phase: Math.random() * Math.PI * 2, // seeded glow flicker clock
        sparkTimer: Math.random() * EMBER_SPARK_LEVEL_MAX, // AddEffectGround pulse
        crateTick: 0 // ObjectFireDamage pulse clock while grounded
      });
    }
  }

  // The burn gauge runs while the ember is ON the floor: the requested 1 - 2 s
  // ground stay (the artifact counts flight too — this pool reads the spec).
  function emberGroundScale(f) {
    var lifeFrac = Math.max(0, f.life / f.maxLife);
    return {
      shrink: lifeFrac < EMBER_DIE_FRACTION ? lifeFrac / EMBER_DIE_FRACTION : 1,
      lifeFrac: lifeFrac
    };
  }

  // GetNearbyFireNode: a landing within the merge radius of a grounded ember
  // feeds the survivor the LONGER timer and ends itself (no double pool).
  function mergeGroundFire(f, index) {
    for (var i = 0; i < groundFire.length; i++) {
      var other = groundFire[i];
      if (i === index || other.inAir) continue;
      var dx = other.x - f.x;
      var dy = other.y - f.y;
      if (dx * dx + dy * dy < EMBER_MERGE_DIST * EMBER_MERGE_DIST) {
        if (!(other.molotovFire && f.molotovFire)) other.life = Math.max(other.life, f.life); // molotov pools never extend each other: exactly 4 s
        groundFire.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  // The molotov fire hisses for as long as one of its nodes burns on the floor
  // (4 s each): one looping voice, started/stopped by the fire itself.
  var MOLOTOV_FIRE_LOOP_KEY = 'molotovGroundFire';
  function syncMolotovFireLoop() {
    if (!sfx) return;
    var burning = false;
    for (var i = 0; i < groundFire.length; i++) {
      if (groundFire[i].molotovFire && !groundFire[i].inAir) { burning = true; break; }
    }
    if (burning) sfx.startLoop(MOLOTOV_FIRE_LOOP_KEY, SFX.MOLOTOV_FIRE_LOOP);
    else if (sfx.isLoopRunning(MOLOTOV_FIRE_LOOP_KEY)) sfx.stopLoop(MOLOTOV_FIRE_LOOP_KEY);
  }

  function updateGroundFire() {
    syncMolotovFireLoop();
    var targets = [player1, player2]; // the same two-fighter contact scan updateFlames uses
    for (var i = groundFire.length - 1; i >= 0; i--) {
      var f = groundFire[i];
      var move = ammoMoveScale(); // embers share the ammo dodge window
      // only grounded embers spend life — the burn ticket starts on landing
      if (!f.inAir) { // the 4 s clock starts only when the node lands
        f.life -= move;
        if (f.life <= 0) { groundFire.splice(i, 1); continue; }
      }
      if (f.inAir) {
        // UpdateFires flight phase: glide under drag, gravity when slowed
        var drag = Math.pow(EMBER_AIR_DRAG, move * 24 / FPS);
        f.vx *= drag;
        if (f.slowing) {
          f.vy *= drag;
          if (Math.sqrt(f.vx * f.vx + f.vy * f.vy) <= EMBER_GLIDE_STOP) f.slowing = false;
        } else {
          f.vy += EMBER_FALL_GRAVITY * move;
        }
        var prevY = f.y;
        f.x += f.vx * move;
        f.y += f.vy * move;
        if (f.x < 3 || f.x > GAME_WIDTH - 3) {
          f.vx = -f.vx * 0.3;
          f.x = Math.max(3, Math.min(GAME_WIDTH - 3, f.x));
        }
        // the grenade rest scan: any platform top swallows the ember
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.ladder || plat.glass) continue;
          var surfaceY = platformBoundaryForSpan(plat, f.x - EMBER_LAND_PROBE, f.x + EMBER_LAND_PROBE, false);
          if (surfaceY !== null && prevY <= surfaceY && f.y >= surfaceY) {
            f.y = surfaceY; // settle ON the surface
            f.vx = 0; f.vy = 0; f.inAir = false;
            if (mergeGroundFire(f, i)) { f = null; break; }
            // the next step owns the burn gauge reset
            f.sparkTimer = Math.random() * EMBER_SPARK_LEVEL_MAX;
            f.crateTick = 0;
            break;
          }
        }
        if (f === null) continue;
        if (f.inAir && f.y > 640) { groundFire.splice(i, 1); continue; } // the pit
      }
      if (f.inAir) continue;

      // Grounded burn: crates inside the pool burn on the 84 ms cadence
      f.crateTick -= move;
      if (f.crateTick <= 0) {
        f.crateTick = EMBER_CRATE_BURN_CADENCE;
        var touchRect = { x: f.x - EMBER_CONTACT_SIZE / 2, y: f.y - EMBER_CONTACT_SIZE / 2, w: EMBER_CONTACT_SIZE, h: EMBER_CONTACT_SIZE };
        for (var ci = 0; ci < crates.length; ci++) {
          var c = crates[ci];
          if (c.dead || !rectsOverlap(c, touchRect)) continue;
          igniteCrate(c);
        }
        for (var pfi = 0; pfi < propFragments.length; pfi++) {
          if (rectsOverlap(propFragments[pfi], touchRect)) igniteCrate(propFragments[pfi]);
        }
        // barrels poolside catch fire outright (fuel registers heat, not dps)
        for (var bi = 0; bi < barrels.length; bi++) {
          var bb = barrels[bi];
          if (bb.dead || bb.burning) continue;
          if (rectsOverlap(bb, touchRect)) {
            igniteBarrel(bb, (Math.random() - 0.5) * 2, BARREL_HOP_VY * 0.8, 0.25);
          }
        }
      }
      // AddEffectGround pulse: a small damage-less spark puff drifts up
      f.sparkTimer -= move;
      if (f.sparkTimer <= 0) {
        f.sparkTimer = EMBER_SPARK_LEVEL_MIN + Math.random() * (EMBER_SPARK_LEVEL_MAX - EMBER_SPARK_LEVEL_MIN);
        flames.push({
          x: f.x + Math.random() * 6 - 3, y: f.y + Math.random() * 2,
          vx: (Math.random() - 0.5) * 1.2, vy: -0.04,
          life: 16 + Math.random() * 10, damage: 0, // sparks stay visual-only
          owner: -1, hit: {}, size: 3 + Math.random() * 2
        });
      }
      // FireArea contact: standing in the pool lights the fighter (burn L1)
      var ground = emberGroundScale(f).shrink; // the touchbox collapses while dying
      var touch = Math.max(EMBER_CONTACT_SIZE * ground, 3);
      for (var t = 0; t < targets.length; t++) {
        var p = targets[t];
        if (p.hp <= 0 || f.hit[p.id]) continue;
        if (p.matrixDodgeTimer > 0) continue; // Matrix dodge: embers arc past
        if (!rectsOverlap(p.getBounds(), { x: f.x - touch / 2, y: f.y - touch / 2, w: touch, h: touch })) continue;
        f.hit[p.id] = true;
        p.damage(EMBER_CONTACT_DAMAGE);
        p.fireFlash = Math.max(p.fireFlash, 4);
        p.igniteFire(); // the pool lights the fighter (burn L1 -> escalates)
      }
    }
  }

  // Pool exposure: the first touch of a pool lights level 1 (node bite above);
  // staying inside keeps a per-fighter exposure clock. Past 2 s it escalates
  // to level 2, and a fighter already at level 1 also burns its level-1
  // escalation clock several times faster while in the pool.
  function isInsideFirePool(p) {
    var body = p.getBounds();
    for (var i = 0; i < groundFire.length; i++) {
      var f = groundFire[i];
      if (f.inAir) continue;
      var touch = Math.max(EMBER_CONTACT_SIZE * emberGroundScale(f).shrink, 3);
      if (rectsOverlap(body, { x: f.x - touch / 2, y: f.y - touch / 2, w: touch, h: touch })) return true;
    }
    return false;
  }

  function updateFirePoolExposure() {
    var fighters = [player1, player2];
    for (var i = 0; i < fighters.length; i++) {
      var p = fighters[i];
      if (p.hp <= 0 || p.matrixDodgeTimer > 0 || !isInsideFirePool(p)) {
        p.firePoolExposure = 0;
        continue;
      }
      var move = p.moveSpeed();
      if (!p.firePoolExposure) p.firePoolAlreadyBurning = p.fireState === FireStates.level1; // arrived on fire
      p.firePoolExposure = (p.firePoolExposure || 0) + move;
      if (p.firePoolAlreadyBurning && p.fireState === FireStates.level1) {
        p.fireTimer += move * FIRE_POOL_L1_ACCEL; // standing in the fire speeds the escalation
        if (p.fireTimer >= FIRE_L1_ESCALATE) p.setFireState(FireStates.level2);
      }
      if (p.firePoolExposure >= FIRE_POOL_ESCALATE_STEPS && p.fireState !== FireStates.level2) {
        p.igniteFire();
        if (p.fireState === FireStates.level1) p.setFireState(FireStates.level2);
      }
    }
  }

  // The fire look: radial-gradient circles — a white-hot yellow core, an
  // intense orange ring and a dark orange edge with alpha fading to 0 — over
  // 'lighter' so overlapping pool embers bloom like the FireArea glow. The
  // last stretch collapses radius and opacity fast (fire_effect_ground fade).
  function drawGroundFire() {
    for (var i = 0; i < groundFire.length; i++) {
      var f = groundFire[i];
      var scale = emberGroundScale(f);
      var flicker = 0.85 + 0.15 * Math.sin((f.maxLife - f.life) * 0.6 + f.phase);
      var r = Math.max(f.size * scale.shrink * flicker, 1.2);
      var alpha = Math.min(1, scale.lifeFrac * 2) * scale.shrink * flicker;
      if (alpha <= 0.02) continue; // burnt out: nothing left to show
      ctx.save();
      ctx.globalCompositeOperation = 'lighter'; // overlapping glows bloom
      var grad = ctx.createRadialGradient(f.x, f.y - r * 0.25, r * 0.1, f.x, f.y - r * 0.1, r * 1.35);
      grad.addColorStop(0.0, 'rgba(255,255,235,' + (0.95 * alpha).toFixed(3) + ')'); // white-hot core
      grad.addColorStop(0.32, 'rgba(255,214,64,' + (0.85 * alpha).toFixed(3) + ')'); // bright yellow
      grad.addColorStop(0.62, 'rgba(255,128,16,' + (0.6 * alpha).toFixed(3) + ')');  // intense orange
      grad.addColorStop(0.85, 'rgba(196,58,4,' + (0.28 * alpha).toFixed(3) + ')');   // dark orange
      grad.addColorStop(1.0, 'rgba(140,40,0,0)'); // alpha fades to nothing at the edge
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y - r * 0.1, r * 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
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
        // IsThrowableFragile x IsThrowableObject (decompiled b2ContactFilter):
        // a thrown weapon passing the pane shatters it and keeps flying
        for (var wgi = 0; wgi < glassPanes.length; wgi++) {
          var wpane = glassPanes[wgi];
          if (!wpane.broken && rectsOverlap({ x: it.x - 4, y: it.y - 4, w: 8, h: 8 }, wpane)) {
            breakGlassPane(wpane, it.vx * 0.25, it.vy * 0.25);
          }
        }
        for (var pi = 0; pi < platforms.length; pi++) {
          var plat = platforms[pi];
          if (plat.ladder || plat.glass) continue;
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
    // Random flow (DEV off): the original WeaponSpawn handler fills free spots
    // progressively; it honours the slow-mo game speed like the original.
    if (usesRandomSpawning()) {
      weaponSpawner.update(gameSpeed);
      return;
    }
    // DEV mode: legacy random respawn of weapons every ~5-8 seconds
    weaponRespawnTimer--;
    if (weaponRespawnTimer <= 0) {
      weaponRespawnTimer = 300 + Math.floor(Math.random() * 180);
      var catalog = [MELEE_WEAPONS.machete, MELEE_WEAPONS.axe, MELEE_WEAPONS.sword, GUNS.pistol, GUNS.rifle, GUNS.uzi, GUNS.shotgun, GUNS.magnum, GUNS.sniper, GUNS.bazooka, GUNS.flamethrower, GRENADE, MOLOTOV, HEALTH_PILLS, HEALTH_MEDKIT, SLOWMO_05, SLOWMO_10];
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

  function startItemSlowmo(seconds) {
    itemSlowmo = { mode: 'in', t: 0, target: SLOWMO_ITEM_TARGET, hold: seconds * FPS };
  }

  // Ammo reads this instead of raw gameSpeed (requested dodge window): the
  // world pace times SLOWMO_AMMO_EXTRA while a slow cam holds, exactly 1 the
  // rest of the time. One call per per-step update keeps every projectile
  // type on the very same share for that step.
  function ammoMoveScale() {
    // Matrix bullet time (J) owns the projectile pace: exactly the world
    // share (the requested 30%). The pickup slow-cam keeps its extra crawl.
    if (matrixSlowFactor < 1) return gameSpeed;
    return gameSpeed < 1 ? gameSpeed * SLOWMO_AMMO_EXTRA : 1;
  }

  // A heart beats for as long as the slowmo pickup is active.
  var SLOWMO_HEARTBEAT_LOOP_KEY = 'slowmoHeartbeat';
  function syncSlowmoHeartbeat() {
    if (!sfx) return;
    if (itemSlowmo) sfx.startLoop(SLOWMO_HEARTBEAT_LOOP_KEY, SFX.SLOWMO_HEARTBEAT_LOOP);
    else if (sfx.isLoopRunning(SLOWMO_HEARTBEAT_LOOP_KEY)) sfx.stopLoop(SLOWMO_HEARTBEAT_LOOP_KEY);
  }

  function updateSlowmo() {
    // Rocket ride cam (extracted SlowmoData(0, 12, 6, 0.01)): the freeze
    // snaps in right away, holds, then fades back to full speed.
    if (rocketSlowmo) {
      rocketSlowmo.t++;
      if (rocketSlowmo.mode === 'hold') {
        if (rocketSlowmo.t >= SLOWMO_ROCKET_STAY) {
          rocketSlowmo.mode = 'out';
          rocketSlowmo.t = 0;
        }
      } else if (rocketSlowmo.t >= SLOWMO_ROCKET_OUT) {
        rocketSlowmo = null;
      }
    }
    // The extracted Slowmo handler collapses every active track to the
    // minimum factor. Track them separately here: the pickup cam, the
    // round-end cam and the rocket-ride cam coexist; the strongest wins.
    var itemFactor = 1;
    if (itemSlowmo) {
      if (itemSlowmo.mode === 'in') {
        itemSlowmo.t++;
        itemFactor = 1 - (1 - itemSlowmo.target) * (itemSlowmo.t / SLOWMO_ITEM_RAMP);
        if (itemSlowmo.t >= SLOWMO_ITEM_RAMP) { itemSlowmo.mode = 'hold'; itemSlowmo.t = 0; itemFactor = itemSlowmo.target; }
      } else if (itemSlowmo.mode === 'hold') {
        itemSlowmo.t++;
        itemFactor = itemSlowmo.target;
        if (itemSlowmo.t >= itemSlowmo.hold) { itemSlowmo.mode = 'out'; itemSlowmo.t = 0; }
      } else {
        itemSlowmo.t++;
        itemFactor = itemSlowmo.target + (1 - itemSlowmo.target) * (itemSlowmo.t / SLOWMO_ITEM_RAMP);
        if (itemSlowmo.t >= SLOWMO_ITEM_RAMP) { itemSlowmo = null; itemFactor = 1; }
      }
    }
    syncSlowmoHeartbeat();
    var deathFactor = 1;
    if (slowmoPhase) {
      if (slowmoPhase.mode === 'in') {
        slowmoPhase.t++;
        deathFactor = 1 - (1 - SLOWMO_SPEED) * (slowmoPhase.t / SLOWMO_RAMP_IN);
        if (slowmoPhase.t >= SLOWMO_RAMP_IN) {
          slowmoPhase.mode = 'hold';
          deathFactor = SLOWMO_SPEED;
        }
      } else if (slowmoPhase.mode === 'hold') {
        deathFactor = SLOWMO_SPEED;
        if (!roundOver) {
          slowmoPhase.mode = 'out';
          slowmoPhase.t = 0;
        }
      } else {
        slowmoPhase.t++;
        deathFactor = SLOWMO_SPEED + (1 - SLOWMO_SPEED) * (slowmoPhase.t / SLOWMO_RAMP_OUT);
        if (slowmoPhase.t >= SLOWMO_RAMP_OUT) {
          slowmoPhase = null;
          deathFactor = 1;
        }
      }
    }
    var rocketFactor = 1;
    if (rocketSlowmo) {
      if (rocketSlowmo.mode === 'hold') {
        rocketFactor = SLOWMO_ROCKET_SPEED;
      } else {
        // extracted fade-out: _slowmotion + elapsed/_timeFadeOut * (1 - _slowmotion)
        rocketFactor = SLOWMO_ROCKET_SPEED +
          (1 - SLOWMO_ROCKET_SPEED) * (rocketSlowmo.t / SLOWMO_ROCKET_OUT);
      }
    }
    // The Matrix bullet time is one more slow track: the strongest cam wins
    // and matrixSlowFactor exports its share (moveSpeed() strips it for the
    // avatar so their real-time physics survive the crawl).
    gameSpeed = Math.min(itemFactor, deathFactor, rocketFactor, matrixSlowFactor);
    if (gameSpeed > 1) gameSpeed = 1;
    else if (gameSpeed < 0) gameSpeed = 0;
  }

  var lastPickedSpawn = -1;
  // `forFighter` (optional) is the fighter being placed: in the random flow
  // (DEV off) the point is also kept away from the OTHER fighter.
  function pickSpawnPoint(forFighter) {
    var idx;
    if (usesRandomSpawning() && forFighter) {
      var rival = forFighter === player1 ? player2 : player1;
      var rivalFeet = { x: rival.x, y: rival.y + rival.h };
      idx = spawnApi.pickPlayerSpawnIndex(playerSpawns, Math.random, lastPickedSpawn, [rivalFeet]);
    } else {
      idx = Math.floor(Math.random() * playerSpawns.length);
      if (idx === lastPickedSpawn) idx = (idx + 1) % playerSpawns.length;
    }
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
    placeAtSpawnPoint(p, pickSpawnPoint(p));
  }

  // A new round is a full reset: without hp = 100 the loser keeps hp <= 0 and
  // the death block drops him straight back into the lying pose. ForceHP
  // (extracted) snaps the display bar along with the real HP.
  function resetFighterForRound(p) {
    p.forceHp(100);
    p.gibbed = false; // the fighter is whole again after the gore conversion
    p.lastDirX = 1;
    p.jumping = false;
    p.jumpPushTimeLeft = 0;
    p.rolling = false;
    p.rollFrame = 0;
    p.rollCooldown = 0;
    p.rollFromDive = false;
    p.knockbackRoll = false; // a new round clears any old tumble
    p.knockbackRollFrame = 0;
    p.knockbackRollAngle = 0;
    p.blastRollPending = 0; // and the blast roll window
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
    p.ranged = { gun: GUNS.pistol, ammo: GUNS.pistol.ammo }; // everyone starts with a common pistol in the inventory
    p.throwable = { ammo: GRENADE.ammo }; // a new round refills the grenade slot
    p.carriedSlowmo = null; // the consumable slot never survives a round restart
    p.carriedHealth = null;
    p.setFireState(FireStates.normal); // a new round always leaves the ash behind
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
    p.cover.reset(); // cover never survives a round restart
    p.inCover = false;
    p.crouching = false;
    p.rocketRide = null;
    p.aimSquare = null;
    p.kickCooldown = 0;
    p.kickFlash = 0;
    p.hitFlash = 0;
    p.healGlowTimer = 0;
    p.fireFlash = 0;
    p.getHitClock = 0; // sprite-only pose clock
    p.grabbedBy = null;
    p.grabbedPlayerNr = 0;
    p.throwPose = 0;
    p.throwPoseType = null;
    p.meleeTrace = null;
    p.grabPhase = 0;
    p.grabT = 0;
    // SSJ2 shell: a new round is a plain world again — the cheat must be
    // re-typed (and an open sky found) for the next transformation
    p.setSsj2(null);
    p.ssjKi = 0;
    // the transformation cutscene never survives a restart
    p.transformationPose = null;
    p.ssjFlying = false;
    p.ssjCharging = false;
    p.ssjBeam = null;
    p.ssjCombo = null;
    p.ssjTeleCooldown = 0;
    p.ssjComboCooldown = 0;
    p.ssjBeamCooldown = 0;
    p.ssjRechargeAudioOn = false;
    p.ssjPhase = SSJ_PHASE_SSJ;
    p.ssjHold = 0;
    p.ssjFuriousOn = false;
    p.ssjFuriousLocked = false;
    p.ssjMelee = null;
    p.ssjUiTele = null;
    p.ssjRays = null;
    p.ssjMeleeCooldown = 0;
    p.ssjOrbCooldown = 0;
    p.ssjRaysCooldown = 0;
    p.ssjUiTeleCooldown = 0;
    p.ssjUiAge = 0;
    ssjOrbs.length = 0;
    ssjRays.length = 0;
    ssjStopFuriousAudio();
    ssjStopUiTheme();
    ssjStopKameChargeAudio(); // no charge audio survives a round restart
    // Matrix shell: same rule — re-typed cheats only, no stances survive
    p.setMatrix(null);
    p.matrixTimer = 0;
    p.matrixBtHeld = false;
    p.matrixBtOn = false;
    p.matrixBtCap = 0;
    p.matrixBtCooldown = 0;
    p.matrixDodgeTimer = 0;
    p.matrixDodgeCooldown = 0;
    p.endMatrixWallRun('exit');
    p.matrixWallFuel = MATRIX_WALL_FUEL_MAX;
    p.matrixWallCooldown = 0;
    p.matrixReloadCooldown = 0;
    p.matrixTeleCooldown = 0;
    p.matrixGlitchTimer = 0;
    placeAtSpawnPoint(p, pickSpawnPoint(p));
  }

  // ---------- Spawn flow (DEV mode vs random/progressive) ----------
  // The pacing/weights live in src/spawn-director.js (WEAPON_* constants).
  // Without that module (test sandboxes) the game falls back to the DEV flow.
  var spawnApi = (typeof SuperfightersSpawn !== 'undefined') ? SuperfightersSpawn : null;
  function usesRandomSpawning() { return !!spawnApi && !devModeEnabled; }

  // Weapon name (spawn-director weights) -> catalog entry
  var WEAPON_SPAWN_CATALOG = {
    pistol: GUNS.pistol, rifle: GUNS.rifle, shotgun: GUNS.shotgun, sniper: GUNS.sniper,
    bazooka: GUNS.bazooka, molotov: MOLOTOV, grenade: GRENADE, flamethrower: GUNS.flamethrower,
    sword: MELEE_WEAPONS.sword, machete: MELEE_WEAPONS.machete, axe: MELEE_WEAPONS.axe,
    slowmo05: SLOWMO_05, slowmo10: SLOWMO_10, pills: HEALTH_PILLS, medkit: HEALTH_MEDKIT,
    magnum: GUNS.magnum, uzi: GUNS.uzi
  };

  // A spot is busy while a weapon it spawned still lies untaken on the map.
  function isWeaponSpotFree(spot) {
    for (var i = 0; i < weaponItems.length; i++) {
      if (weaponItems[i].spot === spot && !weaponItems[i].taken) return false;
    }
    return true;
  }

  var weaponSpawner = spawnApi ? spawnApi.createWeaponSpawner({
    spots: weaponSpawnPoints,
    isSpotFree: isWeaponSpotFree,
    spawnWeapon: function (spot, weaponKey, lifeSteps, blinkSteps) {
      weaponItems.push({
        weapon: WEAPON_SPAWN_CATALOG[weaponKey],
        x: spot.x,
        y: spot.y,
        taken: false,
        pickupDelay: 0,
        spot: spot,
        ttl: lifeSteps,
        blinkStart: blinkSteps
      });
    }
  }) : null;

  // Start the arena for the active mode: DEV = every spot stocked at once,
  // random = empty map and the spawner clock restarted.
  function setupWeaponSpawning() {
    if (usesRandomSpawning()) {
      weaponItems.length = 0;
      weaponSpawner.reset();
    } else {
      populateWeaponSpawns();
    }
  }

  // Settings toggle: applies to the weapons right away (fighters take the new
  // spawn rule on their next respawn / round).
  function setDevMode(enabled) {
    devModeEnabled = !!enabled;
    saveDevModeSetting();
    setupWeaponSpawning();
  }

  function populateWeaponSpawns() {
    // The level's 6 weapon spawn points get a random catalog weapon
    var catalog = [MELEE_WEAPONS.machete, MELEE_WEAPONS.axe, MELEE_WEAPONS.sword, GUNS.pistol, GUNS.rifle, GUNS.uzi, GUNS.shotgun, GUNS.magnum, GUNS.sniper, GUNS.bazooka, GUNS.flamethrower, GRENADE, MOLOTOV, HEALTH_PILLS, HEALTH_MEDKIT, SLOWMO_05, SLOWMO_10];
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
    if (sfx) sfx.stopAll(); // no fire loop / pending pump survives the round
    roundOver = null;
    if (roundFlowApi) roundFlow = roundFlowApi.createRoundFlow();
    rocketSlowmo = null; // no ride survives a round restart
    restartTimer = 0;
    lastPickedSpawn = -1;
    resetFighterForRound(player1);
    resetFighterForRound(player2);
    setupWeaponSpawning();
    bullets.length = 0;
    rocketExhaust.length = 0; // no trail survives a round restart
    grenades.length = 0;
    explosions.length = 0;
    bloodPixels.length = 0;
    bloodFloorStains.length = 0;
    bloodWallStains.length = 0;
    ssjParticles.length = 0; // the golden field clears with the rest of the FX
    ssjRings.length = 0;
    ssjBeams.length = 0;     // no beam survives a round restart
    matrixRain.length = 0;   // the code rain and glitch shards clear too
    matrixGlitch.length = 0;
    matrixBtPhase = null;    // the crawl is a plain 1x again
    matrixSlowFactor = 1;
    gore.length = 0; // leftover viscera never survives a round restart
    goreStains.length = 0;
    groundFire.length = 0; // the fire splash goes out with the round
    barrelDebris.length = 0; // the fragment patches do not cross rounds either
    rebuildBarrels(); // props re-stock at their home spots
    rebuildHangingProps();
    propFragments.length = 0;
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
  }

  // DEV: weapons on every spot + the fixed first spawns. Random: empty map,
  // weapons arrive progressively and both fighters start on random points.
  setupWeaponSpawning();
  if (usesRandomSpawning()) {
    placeAtSpawnPoint(player1, pickSpawnPoint(player1));
    placeAtSpawnPoint(player2, pickSpawnPoint(player2));
  }

  // ---------- Main loop (fixed timestep at 60 FPS) ----------
  var accumulator = 0;
  var lastTime = performance.now();

  function updateElevator() {
    elevator.t += (elevator.omega * gameSpeed) / FPS;
    // The source's 183 px linkage and rotating motor return to the base height
    // after one cycle; cosine keeps the extracted start position and travel.
    elevator.prevY = elevator.y;
    elevator.y = elevator.baseY - (elevator.travel / 2) * (1 - Math.cos(elevator.t));
  }

  function updateStep() {
    // KeyP toggles the freeze: consume the press the same way gameplay keys
    // do so key auto-repeat cannot flip the state twice per physical press.
    if (consumeJustPressed(PAUSE_TOGGLE_CODE)) paused = !paused;
    if (sfx) sfx.setPaused(paused);
    if (paused) {
      // Sim stays frozen; wipe the just-pressed ledger so keys pressed while
      // paused cannot queue actions for the frame the game resumes.
      clearJustPressed();
      return;
    }
    simulationStep++;
    // Move the platform before players so grounding and rider carry use the
    // same fixed simulation step.
    if (sfx) sfx.tick();
    updateElevator();
    botDrive(player2, player1);
    player1.update(player2);
    player2.update(player1);
    updateRiderInertia(player1);
    updateRiderInertia(player2);
    spreadFireBetweenFighters(player1, player2);
    updateBloodPixels();
    updateSsj2World(); // aura particles / rings / beam damage pulses
    updateMatrixWorld(); // digital rain / glitch blocks / bullet-time ramp
    updateBullets();
    updateRocketExhaust();
    updateGrenades();
    updateExplosions();
    updateGlassShards();
    updateGore();
    updateFlames();
    updateFirePoolExposure(); // reads the state BEFORE this step's pool bite lights the fighter
    updateGroundFire();
    updateWeaponItems();
    updateMeleeRecoil(player1);
    updateMeleeRecoil(player2);
    snapshotPropPositions();
    updateCrates();
    updateBurningCrates();
    updatePropFragments();
    updateBarrels();
    updateBarrelDebris();
    updatePropStackRiders();

    // The pit (OutsideTheWorld): out of the map -> respawn at a level spawn
    if (player1.y > 640) respawnAtSpawnPoint(player1);
    if (player2.y > 640) respawnAtSpawnPoint(player2);
    updateCamera();
    // Round end detection (ActivateSlowmotion: the kill leaves one side)
    if (roundFlowApi) {
      updateRoundFlow();
    } else if (!roundOver) {
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

  // End-of-round state machine (round-flow.js): the first death starts the
  // slow motion; after ROUND_END_SLOWMO_STEPS of real time the speed is
  // restored at once and the result is shown; the survivor keeps playing
  // until Space loads the next round.
  function updateRoundFlow() {
    var event = roundFlowApi.stepRoundFlow(roundFlow, {
      player1Dead: player1.hp <= 0,
      player2Dead: player2.hp <= 0,
      continuePressed: roundFlowApi.showsResult(roundFlow) && consumeJustPressed(ROUND_CONTINUE_CODE),
      slowmoSteps: ROUND_END_SLOWMO_STEPS
    });
    var EVENT = roundFlowApi.ROUND_EVENT;
    if (event === EVENT.RESTART) {
      restartRound();
      return;
    }
    if (event === EVENT.START_SLOWMO) startSlowmo();
    if (event === EVENT.END_SLOWMO) slowmoPhase = null; // back to normal speed at once
    if (!roundFlowApi.isRoundOver(roundFlow)) roundOver = null;
    else if (roundOver) roundOver.winnerId = roundFlow.winnerId;
    else roundOver = { winnerId: roundFlow.winnerId };
  }

  // ---------- Rocket-ride renderer (original clip DefineSprite 708) ----------
  // The shipped ROCKET_RIDE_R/L frames show ONLY the ride art: a tiny rocket
  // (frames 521/523/525/526, anim-local left edge at x -4.5) with the victim's
  // head (sprite 707) clinging at the missile tip. Idle replaces to this while
  // the rider is stuck. Head stays upright and mirrors per heading (the
  // shipped art faces left -> it flips when the flight heads right); the
  // rocket itself rotates so its nose leads the ride angle.
  var ROCKET_RIDE_FRAMES = [
    { id: 521, oy: -2.5 },
    { id: 523, oy: -1.5 },
    { id: 525, oy: -2.5 },
    { id: 526, oy: -2.5 }
  ];
  var _rocketAnimStep = 0;
  function drawRocketRide(b) {
    var r = b.rider;
    if (!r || !spriteReady) return;
    _rocketAnimStep++;
    var k = r.h / 21; // rider's body pixel density (SPRITE_BASE_HEIGHT)
    var phi = (b.rideAngle * Math.PI) / 180;
    // Rocket: the art nose points left, so rotate by the ride angle minus a
    // half turn to lead the flight direction
    var frame = ROCKET_RIDE_FRAMES[Math.floor(_rocketAnimStep / 4) % ROCKET_RIDE_FRAMES.length];
    var rimg = spriteImages[frame.id];
    if (rimg && rimg.complete && rimg.naturalWidth) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(phi - Math.PI);
      ctx.drawImage(rimg, -4.5 * k, frame.oy * k, rimg.naturalWidth * k, rimg.naturalHeight * k);
      ctx.restore();
    }
    // Head (707): hooked at the nose, upright, facing the flight direction
    // (the sprite as drawn faces right; mirrored when heading left)
    var himg = spriteImages[707];
    if (himg && himg.complete && himg.naturalWidth) {
      var dir = Math.cos(phi) >= 0 ? 1 : -1;
      var tipX = b.x + Math.cos(phi) * 4.5 * k;
      var tipY = b.y + Math.sin(phi) * 4.5 * k;
      var cx = tipX + dir * 1.5 * k;
      var cy = tipY - 2 * k;
      ctx.save();
      ctx.translate(cx, cy);
      if (dir < 0) ctx.scale(-1, 1); // art faces right as drawn: mirror on left-heading
      ctx.drawImage(
        himg,
        -(himg.naturalWidth / 2) * k, -(himg.naturalHeight / 2) * k,
        himg.naturalWidth * k, himg.naturalHeight * k
      );
      ctx.restore();
    }
  }

  // Emit puffs from the tail (opposite to the travel direction) and age them.
  function emitRocketExhaust(rocket) {
    var angle = Math.atan2(rocket.vy, rocket.vx);
    var tailX = rocket.x - Math.cos(angle) * (MISSILE_BODY_LENGTH / 2);
    var tailY = rocket.y - Math.sin(angle) * (MISSILE_BODY_LENGTH / 2);
    for (var n = 0; n < EXHAUST_PARTICLES_PER_STEP; n++) {
      if (rocketExhaust.length >= EXHAUST_PARTICLE_CAP) rocketExhaust.shift();
      rocketExhaust.push({
        x: tailX,
        y: tailY,
        vx: (Math.random() - 0.5) * EXHAUST_DRIFT_SPEED * 2,
        vy: (Math.random() - 0.5) * EXHAUST_DRIFT_SPEED * 2 - EXHAUST_RISE_SPEED,
        life: EXHAUST_PARTICLE_LIFE,
        maxLife: EXHAUST_PARTICLE_LIFE,
        size: 1.5 + Math.random() * 1.5
      });
    }
  }
  function updateRocketExhaust() {
    for (var i = rocketExhaust.length - 1; i >= 0; i--) {
      var puff = rocketExhaust[i];
      puff.x += puff.vx;
      puff.y += puff.vy;
      puff.size += 0.06; // smoke expands as it thins out
      puff.life--;
      if (puff.life <= 0) rocketExhaust.splice(i, 1);
    }
  }
  function drawRocketExhaust() {
    for (var i = 0; i < rocketExhaust.length; i++) {
      var puff = rocketExhaust[i];
      var age = puff.life / puff.maxLife; // 1 fresh -> 0 gone
      if (age > 1 - EXHAUST_FIRE_SHARE) {
        ctx.fillStyle = 'rgba(255,' + Math.round(150 + 90 * (age - 0.6) / 0.4) + ',60,' + (age).toFixed(2) + ')';
      } else {
        ctx.fillStyle = 'rgba(120,120,120,' + (age * 0.7).toFixed(2) + ')';
      }
      ctx.fillRect(puff.x - puff.size / 2, puff.y - puff.size / 2, puff.size, puff.size);
    }
  }
  function drawMissile(rocket) {
    var angle = Math.atan2(rocket.vy, rocket.vx);
    var half = MISSILE_BODY_LENGTH / 2;
    var thick = MISSILE_BODY_THICKNESS;
    ctx.save();
    ctx.translate(rocket.x, rocket.y);
    ctx.rotate(angle);
    // rear flame, glued to the tail and flickering
    var flicker = 0.7 + Math.random() * 0.3;
    var flameLength = MISSILE_FLAME_LENGTH * flicker;
    ctx.fillStyle = 'rgba(255,120,30,0.9)';
    ctx.beginPath();
    ctx.moveTo(-half, -thick / 2 + 0.5);
    ctx.lineTo(-half - flameLength, 0);
    ctx.lineTo(-half, thick / 2 - 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,235,150,0.95)';
    ctx.beginPath();
    ctx.moveTo(-half, -thick / 4);
    ctx.lineTo(-half - flameLength * 0.55, 0);
    ctx.lineTo(-half, thick / 4);
    ctx.closePath();
    ctx.fill();
    // fins
    ctx.fillStyle = '#6b6f78';
    ctx.fillRect(-half, -thick / 2 - 1.5, 3, 1.5);
    ctx.fillRect(-half, thick / 2, 3, 1.5);
    // body + nose cone
    ctx.fillStyle = '#9aa0a8';
    ctx.fillRect(-half, -thick / 2, MISSILE_BODY_LENGTH - 3, thick);
    ctx.fillStyle = '#d24a3a';
    ctx.beginPath();
    ctx.moveTo(half - 3, -thick / 2);
    ctx.lineTo(half + 2, 0);
    ctx.lineTo(half - 3, thick / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBullets() {
    drawRocketExhaust();
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      if (b.hidden && !b.rider) continue; // rider-carried rockets draw their own ride art
      if (b.rocket && !b.rider) { drawMissile(b); continue; }
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
      // Stuck rocket = the original ride clip: misil + head hooked at the tip
      if (b.rocket && b.rider) drawRocketRide(b);
    }
  }

  function drawGrenades() {
    for (var i = 0; i < grenades.length; i++) {
      var g = grenades[i];
      if (g.type !== 'molotov' && grenadeMarkerImage && grenadeMarkerImage.naturalWidth) {
        var markerW = grenadeMarkerImage.naturalWidth * GRENADE_MARKER_SCALE;
        var markerH = grenadeMarkerImage.naturalHeight * GRENADE_MARKER_SCALE;
        ctx.drawImage(grenadeMarkerImage, g.x - markerW / 2, g.y - markerH / 2, markerW, markerH);
      }
      var thrownImg = thrownSpriteImages[g.type === 'molotov' ? 'molotov' : 'grenade'];
      if (thrownImg && thrownImg.naturalWidth) {
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.spin * THROWN_SPIN_RADIANS_PER_PX);
        ctx.drawImage(thrownImg, -thrownImg.naturalWidth / 2, -thrownImg.naturalHeight / 2);
        ctx.restore();
      } else {
        px(g.x - 3, g.y - 3, 7, 7, '#3f5a3f');
        px(g.x - 3, g.y - 3, 7, 2, '#2a3f2a');
      }
      // Fuse blink accelerates near zero
      var blink = g.fuse > 40 ? (g.fuse >> 3) & 1 : (g.fuse >> 1) & 1;
      if (blink && g.type !== 'molotov') px(g.x - 1, g.y - 5, 3, 2, '#ff5050');
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

  // Frozen gore: chunks and splats that landed, drawn flat under the fighters
  function drawGoreStains() {
    for (var i = 0; i < goreStains.length; i++) {
      var s = goreStains[i];
      var img = spriteImages[s.sprite];
      if (!img || !img.complete || !img.naturalWidth) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.globalAlpha = s.alpha;
      ctx.drawImage(img, -img.naturalWidth * s.scale / 2, -img.naturalHeight * s.scale / 2,
        img.naturalWidth * s.scale, img.naturalHeight * s.scale);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Airborne gore: meat chunks and droplets fly, spin and fade out
  function drawGore() {
    for (var i = 0; i < gore.length; i++) {
      var g = gore[i];
      var img = spriteImages[g.sprite];
      if (!img || !img.complete || !img.naturalWidth) continue;
      var alpha = Math.min(1, g.life / GORE_FADE_LIFE);
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, -img.naturalWidth * g.scale / 2, -img.naturalHeight * g.scale / 2,
        img.naturalWidth * g.scale, img.naturalHeight * g.scale);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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

  // ---------- Level art (shipped DefineSprite_2484_levels frame 4 = Police Station) ----------
  // The whole map picture (sky, clouds, skyline, windmill tower, fence, turf,
  // concrete floors, brick walls, windows, slats, shelves, stairs) comes from
  // the shipped level bitmap at 1:1. Measured by overlaying the Tile colliders:
  // map px -> bitmap px is (+291.5, +202) and map px -> canvas is (-105, +81),
  // so the bitmap's origin sits at canvas (-396.5, -121). Crates, barrels,
  // lamps, the lift and the glass panes are runtime props drawn over it.
  var LEVEL_ART_ORIGIN = { x: -396.5, y: -121 };
  var levelArt = null; // loaded <img>, null until ready (procedural fallback)
  if (typeof Image !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
    (function () {
      var img = new Image();
      img.onload = function () { if (img.naturalWidth) levelArt = img; };
      img.src = 'superfighters/sprites/DefineSprite_2484_levels/4.png';
    })();
  }

  // The shipped hazard-striped lift platform (DefineSprite_1314_lift_small_01)
  var liftArt = null;
  if (typeof Image !== 'undefined' && typeof document !== 'undefined' && document.createElement) {
    (function () {
      var img = new Image();
      img.onload = function () { if (img.naturalWidth) liftArt = img; };
      img.src = 'superfighters/sprites/DefineSprite_1314_lift_small_01/1.png';
    })();
  }

  function drawLevelArt(viewX, viewY, viewW, viewH) {
    ctx.fillStyle = '#000';
    ctx.fillRect(viewX, viewY, viewW, viewH);
    var prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(levelArt, LEVEL_ART_ORIGIN.x, LEVEL_ART_ORIGIN.y);
    ctx.imageSmoothingEnabled = prev;
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

  // One failing effect (a NaN flame, a broken sprite) must never take the
  // rest of the frame with it: fighters, platforms and props keep drawing.
  var drawFailuresLogged = Object.create(null);
  function guardedDraw(label, drawFn) {
    ctx.save();
    try {
      drawFn();
    } catch (err) {
      if (!drawFailuresLogged[label]) {
        drawFailuresLogged[label] = true;
        if (typeof console !== 'undefined') console.error('render: ' + label + ' failed', err);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(VIEW_SCALE, 0, 0, VIEW_SCALE, 0, 0);
    ctx.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    // Visible world rect, used by the backdrop so it always fills the viewport
    var viewW = VIEW_WIDTH / camera.zoom;
    var viewH = VIEW_HEIGHT / camera.zoom;
    ctx.save();
    ctx.translate(VIEW_WIDTH / 2, VIEW_HEIGHT / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);
    if (levelArt) {
      drawLevelArt(camera.x - viewW / 2, camera.y - viewH / 2, viewW, viewH);
      // the bitmap already carries every static tile; only moving/breaking
      // colliders (the lift, the glass panes) are drawn live
      for (var i = 0; i < platforms.length; i++) {
        if (platforms[i].elevator || platforms[i].glass) drawPlatform(platforms[i]);
      }
    } else {
      drawBackdrop(camera.x - viewW / 2, camera.y - viewH / 2, viewW, viewH);
      drawMapDressing(camera.x - viewW / 2, viewW);
      for (var i = 0; i < platforms.length; i++) drawPlatform(platforms[i]);
    }
    drawGlassShards();
    drawGoreStains();
    drawBloodFloorStains();
    for (i = 0; i < hangingLamps.length; i++) drawHangingLamp(hangingLamps[i]);
    drawFloorWeaponItems();
    
    guardedDraw('bullets', drawBullets);
    guardedDraw('grenades', drawGrenades);
    guardedDraw('explosions', drawExplosions);
    guardedDraw('groundFire', drawGroundFire);
    guardedDraw('barrelDebris', drawBarrelDebris);
    guardedDraw('flames', drawFlames);
    drawCrates();
    drawPropFragments();
    drawBarrels();
    drawUiGhost(player1);
    drawUiGhost(player2);
    drawStepped(player1, drawPlayer);
    drawStepped(player2, drawPlayer);
    // Aiming indicators + muzzle flashes render on top of both fighters
    // (World coords: still inside the camera transform)
    drawStepped(player1, drawPlayerOverlay);
    drawStepped(player2, drawPlayerOverlay);
    // SSJ2 world field: kamehameha beams above the fighters, particles last
    drawSsjBeams();
    drawUiProjectiles();
    drawSsjParticles();
    drawBloodPixels();
    drawMatrixWorldFx();
    // The viscera fly in front of the fighters (the blast tears them out)
    drawGore();
    drawHealthBar(player1);
    drawHealthBar(player2);
    // Far-right wall entrances (extracted Police Station) — drawn on top so the
    // player disappears as they enter the black door
    if (!levelArt) {
      drawPortalEntrance(doorPortals[0], true);
      drawPortalEntrance(doorPortals[1], false);
    }
    ctx.restore();
    drawHud();
    drawSettings();
    if (paused) drawPauseOverlay();
  }

  function frame(now) {
    accumulator += Math.min(now - lastTime, 100);
    lastTime = now;
    // Epsilon guards against FP drift producing 0-step / 2-step frames
    while (accumulator >= STEP_MS - 1e-9) {
      updateStep();
      accumulator -= STEP_MS;
    }
    try {
      render();
    } finally {
      window.requestAnimationFrame(frame); // the loop survives any render failure
    }
  }

  // Debug/test hook (inspect players and platforms from the console)
  window.__sf = {
    players: [player1, player2],
    platforms: platforms,
    mapData: mapData,
    mapLoader: mapLoader,
    MapData: MapData,
    TileMapLayer: TileMapLayer,
    MapLoader: MapLoader,
    crates: crates,
    coverSystem: CoverSystem,
    glassPanes: glassPanes,
    glassShards: glassShards,
    doorPortals: doorPortals,
    camera: camera,
    weapons: MELEE_WEAPONS,
    guns: GUNS,
    grenade: GRENADE,
    weaponItems: weaponItems,
    bullets: bullets,
    rocketExhaust: rocketExhaust,
    grenades: grenades,
    explosions: explosions,
    gore: gore,
    goreStains: goreStains,
    explodeAt: explodeAt,
    meleeContact: meleeContact,
    meleePush: { kickX: CRATE_KICK_PUSH_X, punchX: CRATE_PUNCH_PUSH_X },
    get gameSpeed() { return gameSpeed; },
    get roundOver() { return roundOver; },
    get roundPhase() { return roundFlow ? roundFlow.phase : null; },
    get roundResultText() { return roundFlow && roundOver ? roundResultText(roundFlow.winnerId) : null; },
    get paused() { return paused; },
    set paused(v) { paused = v; },
    get botActive() { return botActive; },
    set botActive(v) { botActive = v; },
    restartRound: restartRound,
    spawns: { players: playerSpawns, weapons: weaponSpawnPoints },
    get devMode() { return devModeEnabled; },
    setDevMode: setDevMode,
    weaponSpawner: weaponSpawner,
    explodeGrenade: explodeGrenade,
    kickGrenadesInReach: kickGrenadesInReach,
    explodeRocket: explodeRocket,
    damageCrate: damageCrate,
    createCrate: createCrate,
    igniteCrate: igniteCrate,
    propFragments: propFragments,
    hitCratesInReach: hitCratesInReach,
    createPropFragment: createPropFragment,
    releaseHangingProp: releaseHangingProp,
    barrels: barrels,
    barrelDebris: barrelDebris,
    igniteBarrel: igniteBarrel,
    detonateBarrel: detonateBarrel,
    hitBarrelsInReach: hitBarrelsInReach,
    shoveBarrel: shoveBarrel,
    damageBarrel: hitBarrelsInReach,
    startItemSlowmo: startItemSlowmo,
    spawnMolotovFire: spawnMolotovFire,
    shatterMolotov: shatterMolotov,
    spawnBloodHit: spawnBloodHit,
    bloodPixels: bloodPixels,
    bloodFloorStains: bloodFloorStains,
    bloodWallStains: bloodWallStains,
    healthState: healthState,
    flames: flames,
    groundFire: groundFire,
    spawnExplosionFire: spawnExplosionFire,
    ssjParticles: ssjParticles,
    ssjRings: ssjRings,
    ssjBeams: ssjBeams,
    ssjOrbs: ssjOrbs,
    startPhaseTransform: startPhaseTransform,
    uiGlowAmount: uiGlowAmount,
    modSprites: modSprites,
    modArtFor: modArtFor,
    playerSpriteKey: playerSpriteKey,
    ssjRays: ssjRays,
    matrixRain: matrixRain,
    matrixGlitch: matrixGlitch,
    get matrixSlowFactor() { return matrixSlowFactor; },
    cheat: CheatCodeManager,
    activateSsj2: activateSsj2,
    activateMatrix: activateMatrix,
    ssjOpenAirAbove: ssjOpenAirAbove,
    step: updateStep,
    render: render,
    playerSpriteKey: playerSpriteKey,
    spriteMap: SPRITE_MAP,
    spriteImages: spriteImages,
    modAudio: modAudio
  };

  window.requestAnimationFrame(frame);
})();
