(function (global) {
  'use strict';

  var TIME_SCALE = 1;
  var VEL_SCALE = TIME_SCALE;
  var ACCEL_SCALE = TIME_SCALE * TIME_SCALE;

  var PLAYER_GRAVITY = 0.6 * ACCEL_SCALE;
  var PLAYER_JUMP_POWER = -5 * VEL_SCALE;
  var PLAYER_JUMP_PUSH_POWER = -0.7 * ACCEL_SCALE;
  var PLAYER_JUMP_PUSH_TIME = 4;
  var PLAYER_RUN_SPEED = 1.7 * VEL_SCALE;
  var AIR_CONTROL_FACTOR = 0.8;
  var AIR_FALL_MIN = 0.1 * VEL_SCALE;
  var FALL_TRIGGER_SPEED = 8.5 * VEL_SCALE;
  var FALL_ON_PLAYER_DAMAGE = 6;

  var CLOUD_DROP_WINDOW = 15;
  var CLOUD_DROP_CLEAR = 10;

  var SPRINT_RUN_SPEED = 2 * PLAYER_RUN_SPEED;
  var SPRINT_ACTIVATION_WINDOW = 9;
  var RESPRINT_WINDOW = 5;
  var SPRINT_DRAIN = 1.2 * VEL_SCALE;
  var REGEN_RUNNING = 1 * VEL_SCALE;
  var REGEN_IDLE = 2 * VEL_SCALE;
  var ENERGY_COST_JUMP = 5;
  var ENERGY_COST_SPRINT_JUMP = 12;

  var WALL_SLIDE_MAX = 3 * VEL_SCALE;
  var WALLJUMP_VERTICAL = -5 * VEL_SCALE;
  var WALLJUMP_HORIZONTAL = PLAYER_RUN_SPEED;
  var CLIMB_SPEED = 1.5 * VEL_SCALE;

  var DIVE_SPEED = 1.4 * VEL_SCALE;
  var DIVE_SPEED_SHORT = 0.7 * VEL_SCALE;
  var DIVE_HOP = -2 * VEL_SCALE;
  var SPRINT_DIVE_COST = 12;
  var TACKLE_ALIGN_X = 8;
  var TACKLE_ALIGN_Y = 10;
  var DIVE_COLLISION_BOUNCE = 3.5 * VEL_SCALE;
  var SHORT_DIVE_WINDOW = 8;
  var DIVE_IMPACT_DAMAGE = 3;

  var ROLL_ENERGY_COST = 5;

  var PLAYER_WIDTH = 28;
  var PLAYER_HEIGHT = 44;
  var PLAYER_SIZE_SCALE = 0.6;

  var GROUND_SUPPORT_TOLERANCE = 1;
  var EDGE_DISTANCE = 4;

  var GAME_WIDTH = 800;
  var GAME_HEIGHT = 600;

  function platformIsOneWay(plat) {
    return !!(plat && (plat.cloud || plat.oneWay));
  }

  function horizontalOverlap(left, right, plat) {
    return left < plat.x + plat.w && right > plat.x;
  }

  function rectsOverlap(a, b) {
    if (!a || !b) return false;
    if (a.x >= b.x + b.w || a.x + a.w <= b.x ||
        a.y >= b.y + b.h || a.y + a.h <= b.y) return false;
    if (b.shape === 'circle') {
      var cx = Math.max(a.x, Math.min(b.cx, a.x + a.w));
      var cy = Math.max(a.y, Math.min(b.cy, a.y + a.h));
      var dx = b.cx - cx, dy = b.cy - cy;
      return dx * dx + dy * dy < b.radius * b.radius;
    }
    return true;
  }

  function platformBoundaryForSpan(plat, left, right, lowerBoundary) {
    if (!plat || !horizontalOverlap(left, right, plat)) return null;
    if (plat.shape !== 'polygon' && plat.shape !== 'circle') {
      return lowerBoundary ? plat.y + plat.h : plat.y;
    }
    if (plat.shape === 'circle') {
      var contactX = Math.max(left, Math.min(plat.cx, right));
      var dx = contactX - plat.cx;
      var offsetY = Math.sqrt(Math.max(0, plat.radius * plat.radius - dx * dx));
      return lowerBoundary ? plat.cy + offsetY : plat.cy - offsetY;
    }
    return lowerBoundary ? plat.y + plat.h : plat.y;
  }

  function Player(opts) {
    opts = opts || {};
    this.id = opts.id || 1;
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.baseW = PLAYER_WIDTH;
    this.baseH = PLAYER_HEIGHT;
    this.w = PLAYER_WIDTH * PLAYER_SIZE_SCALE;
    this.h = PLAYER_HEIGHT * PLAYER_SIZE_SCALE;
    this.charIndex = opts.charIndex || 0;

    this.binding = opts.binding || {
      left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS'
    };

    this.airVelocityX = 0;
    this.airVelocityY = 0;
    this.onGround = (opts.onGround != null) ? opts.onGround : true;
    this.groundedPlatform = opts.groundedPlatform || null;
    this.jumping = false;
    this.jumpPushTimeLeft = 0;
    this.falling = false;
    this.knockedDown = false;
    this.knockedDownFrame = 0;
    this.rolling = false;
    this.diving = false;
    this.climbing = false;
    this.wallJumping = false;
    this.grabbedBy = null;
    this.grabbedPlayerNr = 0;
    this.stunTimer = 0;
    this.staggering = false;
    this.staggerTimer = 0;
    this.punching = false;
    this.aiming = false;
    this.startAimASAP = false;
    this.sprinting = false;
    this.running = false;
    this.sprintEnergy = 100;
    this.lastDirX = (opts.lastDirX != null) ? opts.lastDirX : 1;
    this.airbornTimer = 0;
    this.jumpKickPerformed = false;
    this.jumpKickQueued = false;
    this.hp = 100;

    this.sprintArmed = 0;
    this.reSprintWindow = 0;
    this.shortDiveAvailable = false;
    this.shortDiveTimer = 0;
    this.walkFrame = 0;

    this.cloudDropArmed = 0;
    this.jumpDownPosYDisable = 0;
    this.performJumpDown = false;

    this._wasOnLadder = false;

    this.rollFrame = 0;
    this.throwPose = 0;
    this.kickCooldown = 0;
    this.kickFlash = 0;
    this.hitFlash = 0;
    this.weaponCooldown = 0;
    this.muzzleFlash = 0;
    this.punchFrame = 0;
    this.punchComboNr = 1;
    this.punchQueued = false;
    this.punchHitPerformed = false;
    this.portalCooldown = 0;
    this._portalLocked = false;

    this.keys = Object.create(null);
    this.keysJustPressed = Object.create(null);
    this.keysJustReleased = Object.create(null);

    this.platforms = opts.platforms || [];
  }

  Player.prototype.getBounds = function () {
    return { x: this.x, y: this.y, w: this.w, h: this.h };
  };

  Player.prototype.keyDown = function (code) {
    if (!this.keys[code]) this.keysJustPressed[code] = true;
    this.keys[code] = true;
  };

  Player.prototype.keyUp = function (code) {
    if (this.keys[code]) this.keysJustReleased[code] = true;
    this.keys[code] = false;
  };

  Player.prototype.pressLeft = function () { return !!this.keys[this.binding.left]; };
  Player.prototype.pressRight = function () { return !!this.keys[this.binding.right]; };
  Player.prototype.pressUp = function () { return !!this.keys[this.binding.up]; };
  Player.prototype.pressDownKey = function () { return !!this.keys[this.binding.down]; };

  Player.prototype.consumeJustPressed = function (code) {
    if (this.keysJustPressed[code]) { delete this.keysJustPressed[code]; return true; }
    return false;
  };
  Player.prototype.consumeJustReleased = function (code) {
    if (this.keysJustReleased[code]) { delete this.keysJustReleased[code]; return true; }
    return false;
  };

  Player.prototype.justUp = function () { return this.consumeJustPressed(this.binding.up); };
  Player.prototype.consumeDown = function () { return this.consumeJustPressed(this.binding.down); };

  Player.prototype.drainEnergy = function (cost) {
    this.sprintEnergy -= cost;
    if (this.sprintEnergy < 0) this.sprintEnergy = 0;
  };

  Player.prototype.onLadder = function () {
    var platforms = this.platforms || [];
    var cx = this.x + this.w / 2;
    var cy = this.y + this.h / 2;
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (!plat.ladder) continue;
      if (cx >= plat.x && cx <= plat.x + plat.w && cy >= plat.y && cy <= plat.y + plat.h) return true;
    }
    return false;
  };

  Player.prototype.wallContact = function (dir) {
    var platforms = this.platforms || [];
    var ex = this.x + (dir > 0 ? this.w + EDGE_DISTANCE : -EDGE_DISTANCE);
    for (var i = 0; i < platforms.length; i++) {
      var plat = platforms[i];
      if (platformIsOneWay(plat) || plat.ladder || !plat.solidSides) continue;
      if (rectsOverlap({ x: ex - 0.5, y: this.y, w: 1, h: this.h }, plat)) return true;
    }
    return (dir > 0 && this.x + this.w >= GAME_WIDTH - 1) ||
           (dir < 0 && this.x <= 1);
  };

  Player.prototype.beginJump = function () {
    var platforms = this.platforms || [];
    var probe = this.getBounds();
    probe.y -= 8;
    for (var i = 0; i < platforms.length; i++) {
      if (platformIsOneWay(platforms[i]) || platforms[i].ladder) continue;
      if (rectsOverlap(probe, platforms[i])) return;
    }
    this.airVelocityY += PLAYER_JUMP_POWER;
    this.groundedPlatform = null;
    this.jumping = true;
    this.onGround = false;
    this.jumpPushTimeLeft = PLAYER_JUMP_PUSH_TIME;
    this.wallJumping = false;
    this.drainEnergy(this.sprinting ? ENERGY_COST_SPRINT_JUMP : ENERGY_COST_JUMP);
    if (this.sprintEnergy <= 0) this.sprinting = false;
  };

  Player.prototype.tryWalljump = function () {
    if (this.onGround || this.wallJumping) return false;
    var dir = this.pressLeft() ? -1 : this.pressRight() ? 1 : this.lastDirX;
    if (!this.wallContact(dir)) return false;
    this.lastDirX = -dir;
    this.sprinting = false;
    this.wallJumping = true;
    this.airVelocityY = WALLJUMP_VERTICAL;
    this.airVelocityX = -dir * WALLJUMP_HORIZONTAL;
    this.wallPose = 10;
    return true;
  };

  Player.prototype.startDive = function (short) {
    var speed = short ? DIVE_SPEED_SHORT : DIVE_SPEED;
    this.diving = true;
    this.jumping = true;
    this.onGround = false;
    this.groundedPlatform = null;
    this.airVelocityX += this.lastDirX * speed;
    this.airVelocityY += DIVE_HOP;
  };

  Player.prototype.checkDiveImpact = function (other) {
    if (!this.diving || this.grabbedPlayerNr || !other) return;
    var myCx = this.x + this.w / 2;
    var theirCx = other.x + other.w / 2;
    var myCy = this.y + this.h / 2;
    var theirCy = other.y + other.h / 2;
    if (Math.abs(myCx - theirCx) > TACKLE_ALIGN_X) return;
    if (Math.abs(myCy - theirCy) > TACKLE_ALIGN_Y) return;
    if (!rectsOverlap(this.getBounds(), other.getBounds())) return;
    if (other.diving) {
      other.airVelocityX = DIVE_COLLISION_BOUNCE * other.lastDirX;
      other.lastDirX = -other.lastDirX;
      other.falling = true;
      other.diving = false;
      this.airVelocityX = DIVE_COLLISION_BOUNCE * this.lastDirX;
      this.lastDirX = -this.lastDirX;
      this.falling = true;
      this.diving = false;
      return;
    }
    other.hp -= DIVE_IMPACT_DAMAGE;
    other.hitFlash = 6;
    if (this.hp > 0) {
      this.grabbedPlayerNr = other.id;
      other.grabbedBy = this;
    }
  };

  Player.prototype.checkFallOnPlayer = function (other) {
    if (!other || other.hp <= 0 || !other.onGround || other.grabbedBy) return;
    var myCx = this.x + this.w / 2;
    var theirCx = other.x + other.w / 2;
    if (Math.abs(myCx - theirCx) > TACKLE_ALIGN_X) return;
    if (Math.abs(this.y + this.h - (other.y + other.h)) > TACKLE_ALIGN_Y) return;
    other.hp -= FALL_ON_PLAYER_DAMAGE;
    other.hitFlash = 6;
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

  Player.prototype.update = function (other, ctx) {
    ctx = ctx || {};
    var platforms = (ctx.platforms != null) ? ctx.platforms : (this.platforms || []);
    this.platforms = platforms;
    var gameSpeed = (ctx.gameSpeed != null) ? ctx.gameSpeed : 1;
    if (ctx.other != null) other = ctx.other;

    if (this.grabbedBy) {
      var gr = this.grabbedBy;
      this.x = gr.x + gr.w + 6 * gr.lastDirX;
      this.y = gr.y - 2;
      if (this.throwPose > 0) this.throwPose--;
      return;
    }

    if (this.kickCooldown > 0) this.kickCooldown--;
    if (this.kickFlash > 0) this.kickFlash--;
    if (this.hitFlash > 0) this.hitFlash--;
    if (this.stunTimer > 0) this.stunTimer--;
    if (this.portalCooldown > 0) this.portalCooldown--;
    if (this.staggering) {
      this.staggerTimer--;
      if (this.staggerTimer <= 0) this.staggering = false;
    }

    var locked = this.falling || this.knockedDown || this.rolling || this.diving || this.hp <= 0;
    var controllable = this.stunTimer <= 0 && !locked;

    var downPressed = (controllable || this.rolling) && this.consumeDown();
    var dir = 0;
    if (controllable) {
      if (this.pressLeft()) dir -= 1;
      if (this.pressRight()) dir += 1;
    }

    if (this.shortDiveTimer > 0) this.shortDiveTimer--;
    if (controllable && !this.aiming && downPressed && this.onGround && !this.rolling && !this.diving && !this.onLadder()) {
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

    var wasRunning = this.running;
    this.running = dir !== 0;
    if (this.sprintArmed > 0) this.sprintArmed--;
    if (this.reSprintWindow > 0) this.reSprintWindow--;
    if (this.running && !wasRunning) {
      if (this.reSprintWindow > 0) {
        this.reSprintWindow = 0;
        this.sprintArmed = 0;
        this.sprinting = true;
      } else if (this.sprintArmed > 0) {
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
    if (this.sprinting && (dir === 0 || this.sprintEnergy <= 0)) this.sprinting = false;

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

    if (this.running && this.onGround) this.walkFrame += 1;
    else this.walkFrame = 0;

    if (dir !== 0) {
      if (dir < 0) this._portalLocked = false;
      this.lastDirX = dir;
      if (this.onGround) {
        this.airVelocityX = dir * (this.sprinting ? SPRINT_RUN_SPEED : PLAYER_RUN_SPEED);
      } else {
        this.airVelocityX += dir * AIR_CONTROL_FACTOR * (this.sprinting ? SPRINT_RUN_SPEED : PLAYER_RUN_SPEED);
        if (!this.diving) {
          var maxAirX = 2 * PLAYER_RUN_SPEED;
          if (this.airVelocityX > maxAirX) this.airVelocityX = maxAirX;
          if (this.airVelocityX < -maxAirX) this.airVelocityX = -maxAirX;
        }
      }
    } else if (this.onGround) {
      this.airVelocityX = 0;
    }

    if (controllable && !this.aiming && this.justUp()) {
      if (this.onGround) this.beginJump();
      else if (!this.tryWalljump()) { /* wall jump first */ }
    }
    if (this.jumpPushTimeLeft > 0 && this.pressUp() && !this.climbing) {
      this.airVelocityY += PLAYER_JUMP_PUSH_POWER;
      this.jumpPushTimeLeft--;
    } else {
      this.jumpPushTimeLeft = 0;
    }

    if (this.jumping && !this.onGround) this.airbornTimer++;
    else {
      this.airbornTimer = 0;
      this.jumpKickPerformed = false;
      this.jumpKickQueued = false;
    }

    if (!this.onGround && this.airVelocityY === 0) this.airVelocityY = AIR_FALL_MIN;

    if (!this.onGround && this.airVelocityY > WALL_SLIDE_MAX && this.wallContact(this.lastDirX)) {
      this.airVelocityY = WALL_SLIDE_MAX;
    }

    if (this.cloudDropArmed > 0) this.cloudDropArmed--;
    if (downPressed && !this.aiming && this.onGround && this.groundedPlatform && this.groundedPlatform.cloud) {
      if (this.cloudDropArmed > 0) {
        this.cloudDropArmed = 0;
        this.jumpDownPosYDisable = this.y + CLOUD_DROP_CLEAR;
        this.performJumpDown = true;
        this.airVelocityX = 0;
        this.airVelocityY = 0;
        this.onGround = false;
        this.groundedPlatform = null;
        this.jumping = true;
        this.rolling = false;
        this.rollFrame = 0;
      } else {
        this.cloudDropArmed = CLOUD_DROP_WINDOW;
      }
    }
    if (this.performJumpDown && this.y > this.jumpDownPosYDisable) {
      this.performJumpDown = false;
    }

    var onLadderCenter = this.onLadder();
    if (onLadderCenter && !this._wasOnLadder) this.airVelocityX = 0;
    this._wasOnLadder = onLadderCenter;
    this.climbing = ((this.pressUp() && onLadderCenter) || (this.pressDownKey() && onLadderCenter)) && !this.knockedDown && this.hp > 0;
    if (this.climbing) {
      if (this.pressUp()) this.airVelocityY = -CLIMB_SPEED;
      else if (this.pressDownKey()) this.airVelocityY = CLIMB_SPEED;
      else this.airVelocityY = 0;
    }

    if (this.rolling) {
      this.rollFrame++;
      if (this.rollFrame > 16) { this.rolling = false; this.rollFrame = 0; }
    }

    var totalAirVelocity = Math.sqrt(this.airVelocityX * this.airVelocityX + this.airVelocityY * this.airVelocityY);
    var steps = Math.ceil(totalAirVelocity);
    if (steps <= 1) steps = 1;

    var h = this.airVelocityX * gameSpeed;
    var c = this.airVelocityY * gameSpeed;
    var groundedThisFrame = false;
    var landVy = 0;
    var groundedPlatformThisFrame = null;

    for (var s = 0; s < steps; s++) {
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
        if (c >= 0 && surfaceY !== null && this.y + this.h <= surfaceY + GROUND_SUPPORT_TOLERANCE) continue;
        var wasInsideX = prevX < plat.x + plat.w && prevX + this.w > plat.x;
        if (wasInsideX) continue;
        if (plat.elevator) continue;
        if (h > 0) this.x = plat.x - this.w;
        else if (h < 0) this.x = plat.x + plat.w;
        this.airVelocityX = 0;
        h = 0;
        bounds = this.getBounds();
      }

      var subY0 = this.y;
      this.y += c / steps;
      bounds = this.getBounds();
      for (pi = 0; pi < platforms.length; pi++) {
        plat = platforms[pi];
        if (plat.ladder) continue;
        if (this.climbing) continue;
        if (plat.cloud && this.performJumpDown) continue;

        surfaceY = platformBoundaryForSpan(plat, this.x, this.x + this.w, false);
        var previousFeet = subY0 + this.h;
        var currentFeet = this.y + this.h;
        if (c > 0 && surfaceY !== null && previousFeet <= surfaceY + 1e-7 && currentFeet >= surfaceY - 1e-7) {
          if (plat.elevator && this.performJumpDown) continue;
          this.y = surfaceY - this.h;
          groundedThisFrame = true;
          groundedPlatformThisFrame = plat;
          landVy = c;
          this.airVelocityY = 0;
          c = 0;
          bounds = this.getBounds();
          break;
        }
        if (plat.elevator && !this.performJumpDown && surfaceY !== null &&
            previousFeet <= surfaceY + 2 && currentFeet >= surfaceY - 2 &&
            this.onGround && this.groundedPlatform === plat) {
          this.y = surfaceY - this.h;
          groundedThisFrame = true;
          groundedPlatformThisFrame = plat;
          if (landVy > 0) landVy = 0;
          this.airVelocityY = 0;
          c = 0;
          bounds = this.getBounds();
          break;
        }

        if (platformIsOneWay(plat) || !plat.solidSides || c >= 0) continue;

        var undersideY = platformBoundaryForSpan(plat, this.x, this.x + this.w, true);
        if (undersideY !== null && subY0 >= undersideY - 1e-7 && this.y <= undersideY + 1e-7) {
          if (plat.elevator) continue;
          this.y = undersideY;
          this.airVelocityY = 0;
          c = 0;
          bounds = this.getBounds();
          break;
        }
      }

      if (this.diving) this.checkDiveImpact(other);

      if (!groundedThisFrame && !this.climbing) {
        this.airVelocityY += (PLAYER_GRAVITY * gameSpeed) / steps;
        c = this.airVelocityY * gameSpeed;
      } else if (groundedThisFrame && groundedPlatformThisFrame && groundedPlatformThisFrame.elevator && !this.performJumpDown) {
        this.airVelocityY = 0;
        c = 0;
        this.y = platformBoundaryForSpan(groundedPlatformThisFrame, this.x, this.x + this.w, false) - this.h;
      }
    }

    if (groundedThisFrame) {
      this.onGround = true;
      this.groundedPlatform = groundedPlatformThisFrame;
      if (this.diving) {
        this.diving = false;
        this.jumping = false;
        if (this.grabbedPlayerNr) { this.grabbedPlayerNr = 0; if (other) other.grabbedBy = null; }
        this.rolling = true;
        this.rollFrame = 0;
        this.drainEnergy(ROLL_ENERGY_COST);
      } else if (this.falling) {
        this.falling = false;
        this.jumping = false;
        this.airVelocityX = 0;
        var impact = Math.abs(landVy) - 3;
        impact *= 1.5;
        if (impact < 3) impact = 0;
        this.hp -= impact;
        this.knockedDown = true;
        this.knockedDownFrame = 0;
        if (landVy >= FALL_TRIGGER_SPEED) this.checkFallOnPlayer(other);
      } else if (this.hp > 0 && landVy >= FALL_TRIGGER_SPEED) {
        this.jumping = false;
        this.airVelocityX = 0;
        var hardImpact = Math.abs(landVy) - 3;
        hardImpact *= 1.5;
        if (hardImpact < 3) hardImpact = 0;
        this.hp -= hardImpact;
        this.knockedDown = true;
        this.knockedDownFrame = 0;
        this.checkFallOnPlayer(other);
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
        var feetY = this.y + this.h;
        var support = null;
        for (pi = 0; pi < platforms.length; pi++) {
          plat = platforms[pi];
          if (plat.ladder) continue;
          if (plat.cloud && this.performJumpDown) continue;
          if (platformIsOneWay(plat) && this.performJumpDown) continue;
          var sY = platformBoundaryForSpan(plat, this.x, this.x + this.w, false);
          if (sY === null) continue;
          if (feetY >= sY - GROUND_SUPPORT_TOLERANCE && feetY <= sY + GROUND_SUPPORT_TOLERANCE) {
            support = plat;
            break;
          }
        }
        if (support) {
          this.y = (platformBoundaryForSpan(support, this.x, this.x + this.w, false)) - this.h;
          this.onGround = true;
          this.groundedPlatform = support;
        } else {
          this.onGround = false;
          this.groundedPlatform = null;
        }
      }
    } else {
      this.onGround = false;
      this.groundedPlatform = null;
    }

    if (this.knockedDown) {
      this.knockedDownFrame++;
      if (this.knockedDownFrame > 30) {
        this.knockedDown = false;
        this.knockedDownFrame = 0;
      }
    }

    this.keysJustPressed = Object.create(null);
    this.keysJustReleased = Object.create(null);
  };

  var api = {
    Player: Player,
    constants: {
      PLAYER_WIDTH: PLAYER_WIDTH, PLAYER_HEIGHT: PLAYER_HEIGHT, PLAYER_SIZE_SCALE: PLAYER_SIZE_SCALE,
      PLAYER_GRAVITY: PLAYER_GRAVITY, PLAYER_RUN_SPEED: PLAYER_RUN_SPEED,
      PLAYER_JUMP_POWER: PLAYER_JUMP_POWER, GAME_WIDTH: GAME_WIDTH, GAME_HEIGHT: GAME_HEIGHT
    },
    helpers: {
      rectsOverlap: rectsOverlap,
      platformIsOneWay: platformIsOneWay,
      platformBoundaryForSpan: platformBoundaryForSpan
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SFPlayerPhysics = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
