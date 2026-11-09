/**
 * Superfighters clone — sound effects (AudioManager).
 *
 * Pure audio layer: no physics, health or rendering knowledge. The game
 * raises named events (`SFX.JUMP`, `SFX.SHOTGUN_FIRE`...) and this module owns
 * the files, the volumes and the playback budget.
 *
 * Catalogue source: the original `Code/Handler/Sounds.as` registry (same names,
 * same file groups, same per-sound volumes), served from `superfighters/sounds/`.
 *
 * Performance / leak policy:
 *  - Every file is turned into a FIXED pool of <audio> voices at preload time.
 *    Playing a sound only rewinds and restarts a voice of its pool (round-robin):
 *    no element, listener or timer is created while the match runs.
 *  - Retrigger throttle per sound (`minGapMs`) keeps blasts and bursts from
 *    stacking dozens of simultaneous voices.
 *  - Delayed sounds (shotgun pump...) run on a step counter driven by the game
 *    loop, so pause freezes them and nothing is left in a real-time timer.
 *  - Loops (molotov fire) own one dedicated voice each, started/stopped by key.
 */
(function (root) {
  'use strict';

  var SOUND_DIRECTORY = 'superfighters/sounds/';
  var DEFAULT_VOICES_PER_FILE = 2;
  var DEFAULT_MASTER_VOLUME = 0.8; // the original SoundEffectVolume
  var DEFAULT_MIN_GAP_MS = 25;
  var MAX_PENDING_DELAYED_SOUNDS = 16;

  // Sound events. Values double as the catalogue keys.
  var SFX = {
    // Firearms: aim (draw) and fire
    PISTOL_AIM: 'PISTOL_AIM', PISTOL_FIRE: 'PISTOL_FIRE',
    RIFLE_AIM: 'RIFLE_AIM', RIFLE_FIRE: 'RIFLE_FIRE',
    UZI_AIM: 'UZI_AIM', UZI_FIRE: 'UZI_FIRE',
    MAGNUM_AIM: 'MAGNUM_AIM', MAGNUM_FIRE: 'MAGNUM_FIRE',
    SHOTGUN_AIM: 'SHOTGUN_AIM', SHOTGUN_FIRE: 'SHOTGUN_FIRE',
    SHOTGUN_PUMP_FIRST: 'SHOTGUN_PUMP_FIRST', SHOTGUN_PUMP_SECOND: 'SHOTGUN_PUMP_SECOND',
    SNIPER_AIM: 'SNIPER_AIM', SNIPER_FIRE: 'SNIPER_FIRE',
    BAZOOKA_AIM: 'BAZOOKA_AIM', BAZOOKA_FIRE: 'BAZOOKA_FIRE',
    FLAMETHROWER_AIM: 'FLAMETHROWER_AIM', FLAMETHROWER_FIRE: 'FLAMETHROWER_FIRE',
    NO_AMMO_LIGHT: 'NO_AMMO_LIGHT', NO_AMMO_HEAVY: 'NO_AMMO_HEAVY',
    BULLET_HIT_FLESH: 'BULLET_HIT_FLESH', BULLET_HIT_METAL: 'BULLET_HIT_METAL',
    BULLET_HIT_WOOD: 'BULLET_HIT_WOOD', BULLET_HIT_DEFAULT: 'BULLET_HIT_DEFAULT',
    // Grenades and molotovs
    GRENADE_PIN: 'GRENADE_PIN', GRENADE_THROW: 'GRENADE_THROW',
    GRENADE_KICK: 'GRENADE_KICK',
    GRENADE_EXPLOSION: 'GRENADE_EXPLOSION',
    MOLOTOV_IGNITE: 'MOLOTOV_IGNITE', MOLOTOV_THROW: 'MOLOTOV_THROW',
    MOLOTOV_SHATTER: 'MOLOTOV_SHATTER', MOLOTOV_BURST: 'MOLOTOV_BURST',
    MOLOTOV_FIRE_LOOP: 'MOLOTOV_FIRE_LOOP',
    // Explosions
    EXPLOSION: 'EXPLOSION',
    // Melee
    PUNCH_SWING: 'PUNCH_SWING', PUNCH_HIT_FIRST: 'PUNCH_HIT_FIRST', PUNCH_HIT_SECOND: 'PUNCH_HIT_SECOND', PUNCH_FINISHER: 'PUNCH_FINISHER',
    KICK_SWING: 'KICK_SWING', KICK_HIT: 'KICK_HIT',
    BLADE_HIT: 'BLADE_HIT',
    BODY_FALL: 'BODY_FALL', GIB: 'GIB',
    // Movement and props
    JUMP: 'JUMP', LAND: 'LAND', FOOTSTEP: 'FOOTSTEP', ROLL: 'ROLL', DIVE_CATCH: 'DIVE_CATCH',
    CRATE_PUSH: 'CRATE_PUSH', CRATE_HIT: 'CRATE_HIT', CRATE_BREAK: 'CRATE_BREAK',
    GLASS_BREAK: 'GLASS_BREAK',
    // Stage and pickups
    HEALTH_PICKUP: 'HEALTH_PICKUP',
    PICKUP_BLADE: 'PICKUP_BLADE', PICKUP_PISTOL: 'PICKUP_PISTOL', PICKUP_MAGNUM: 'PICKUP_MAGNUM',
    PICKUP_UZI: 'PICKUP_UZI', PICKUP_RIFLE: 'PICKUP_RIFLE', PICKUP_SHOTGUN: 'PICKUP_SHOTGUN',
    PICKUP_SNIPER: 'PICKUP_SNIPER', PICKUP_BAZOOKA: 'PICKUP_BAZOOKA',
    PICKUP_FLAMETHROWER: 'PICKUP_FLAMETHROWER', PICKUP_GRENADE: 'PICKUP_GRENADE',
    PICKUP_MOLOTOV: 'PICKUP_MOLOTOV',
    SLOWMO_HEARTBEAT_LOOP: 'SLOWMO_HEARTBEAT_LOOP'
  };

  // name -> { files: [random variants], volume, voices, minGapMs, rateJitter }
  function file(number, name) { return number + '_' + name + '.mp3'; }
  var SOUND_CATALOG = {};
  SOUND_CATALOG[SFX.PISTOL_AIM] = { files: [file(2511, 'aim_small')], volume: 1 };
  SOUND_CATALOG[SFX.PISTOL_FIRE] = { files: [file(2530, 'gun00'), file(2531, 'gun01'), file(2532, 'gun02'), file(2533, 'gun03')], volume: 1 };
  SOUND_CATALOG[SFX.RIFLE_AIM] = { files: [file(2544, 'rifle_draw')], volume: 1 };
  SOUND_CATALOG[SFX.RIFLE_FIRE] = { files: [file(2545, 'rifle00'), file(2546, 'rifle01')], volume: 1, voices: 5 };
  SOUND_CATALOG[SFX.UZI_AIM] = { files: [file(2511, 'aim_small')], volume: 1 };
  SOUND_CATALOG[SFX.UZI_FIRE] = { files: [file(2557, 'uzi00'), file(2558, 'uzi01')], volume: 1, voices: 5, minGapMs: 0 };
  SOUND_CATALOG[SFX.MAGNUM_AIM] = { files: [file(2511, 'aim_small')], volume: 1 };
  SOUND_CATALOG[SFX.MAGNUM_FIRE] = { files: [file(2536, 'magnum')], volume: 1 };
  SOUND_CATALOG[SFX.SHOTGUN_AIM] = { files: [file(2568, 'shotgun_aim')], volume: 1 };
  SOUND_CATALOG[SFX.SHOTGUN_FIRE] = { files: [file(2552, 'shotgun00'), file(2553, 'shotgun01'), file(2554, 'shotgun02')], volume: 1 };
  SOUND_CATALOG[SFX.SHOTGUN_PUMP_FIRST] = { files: [file(2550, 'shotgun_pump_p1')], volume: 1 };
  SOUND_CATALOG[SFX.SHOTGUN_PUMP_SECOND] = { files: [file(2551, 'shotgun_pump_p2')], volume: 1 };
  SOUND_CATALOG[SFX.SNIPER_AIM] = { files: [file(2544, 'rifle_draw')], volume: 1 };
  SOUND_CATALOG[SFX.SNIPER_FIRE] = { files: [file(2555, 'sniper00'), file(2556, 'sniper01')], volume: 1 };
  SOUND_CATALOG[SFX.BAZOOKA_AIM] = { files: [file(2560, 'bazooka_aim')], volume: 1 };
  SOUND_CATALOG[SFX.BAZOOKA_FIRE] = { files: [file(2512, 'bazooka')], volume: 1 };
  SOUND_CATALOG[SFX.FLAMETHROWER_AIM] = { files: [file(2560, 'bazooka_aim')], volume: 1 };
  SOUND_CATALOG[SFX.FLAMETHROWER_FIRE] = { files: [file(2525, 'fireplosion')], volume: 0.5, voices: 2 };
  SOUND_CATALOG[SFX.NO_AMMO_LIGHT] = { files: [file(2538, 'outofammo_light')], volume: 1 };
  SOUND_CATALOG[SFX.NO_AMMO_HEAVY] = { files: [file(2537, 'outofammo_heavy')], volume: 1 };
  SOUND_CATALOG[SFX.BULLET_HIT_FLESH] = { files: [file(2503, 'bullet_hit_1'), file(2504, 'bullet_hit_2'), file(2505, 'bullet_hit_3')], volume: 0.55, minGapMs: 40 };
  SOUND_CATALOG[SFX.BULLET_HIT_METAL] = { files: [file(2561, 'bullet_hitmetal_01'), file(2562, 'bullet_hitmetal_02'), file(2563, 'bullet_hitmetal_03'), file(2564, 'bullet_hitmetal_04'), file(2565, 'bullet_hitmetal_05')], volume: 0.65, minGapMs: 40 };
  SOUND_CATALOG[SFX.BULLET_HIT_WOOD] = { files: [file(2559, 'wood_impact00')], volume: 1, minGapMs: 40 };
  SOUND_CATALOG[SFX.BULLET_HIT_DEFAULT] = { files: [file(2543, 'ric00')], volume: 1, minGapMs: 40 };

  SOUND_CATALOG[SFX.GRENADE_PIN] = { files: [file(2566, 'grenade_safe')], volume: 1 };
  SOUND_CATALOG[SFX.GRENADE_THROW] = { files: [file(2569, 'svisch4'), file(2570, 'svisch6')], volume: 0.9 };
  SOUND_CATALOG[SFX.GRENADE_KICK] = { files: [file(2562, 'bullet_hitmetal_02'), file(2564, 'bullet_hitmetal_04')], volume: 0.75, minGapMs: 80 };
  SOUND_CATALOG[SFX.GRENADE_EXPLOSION] = { files: [file(2521, 'explosion00'), file(2522, 'explosion01'), file(2523, 'explosion02'), file(2524, 'explosion03')], volume: 1, voices: 2 };
  SOUND_CATALOG[SFX.MOLOTOV_IGNITE] = { files: [file(2560, 'bazooka_aim')], volume: 0.8 };
  SOUND_CATALOG[SFX.MOLOTOV_THROW] = { files: [file(2569, 'svisch4'), file(2570, 'svisch6')], volume: 0.9 };
  SOUND_CATALOG[SFX.MOLOTOV_SHATTER] = { files: [file(2529, 'glass_2')], volume: 1 };
  SOUND_CATALOG[SFX.MOLOTOV_BURST] = { files: [file(2525, 'fireplosion')], volume: 0.8 };
  SOUND_CATALOG[SFX.MOLOTOV_FIRE_LOOP] = { files: [file(2571, 'voltage_02')], volume: 0.18, voices: 1 };
  SOUND_CATALOG[SFX.EXPLOSION] = { files: [file(2521, 'explosion00'), file(2522, 'explosion01'), file(2523, 'explosion02'), file(2524, 'explosion03')], volume: 1, voices: 2, minGapMs: 80 };

  SOUND_CATALOG[SFX.PUNCH_SWING] = { files: [file(2569, 'svisch4'), file(2570, 'svisch6')], volume: 0.5, minGapMs: 60 };
  SOUND_CATALOG[SFX.PUNCH_HIT_FIRST] = { files: [file(2539, 'punch00')], volume: 1, minGapMs: 40 };
  SOUND_CATALOG[SFX.PUNCH_HIT_SECOND] = { files: [file(2541, 'punch02')], volume: 1, minGapMs: 40 };
  SOUND_CATALOG[SFX.PUNCH_FINISHER] = { files: [file(2542, 'punch03')], volume: 1, minGapMs: 40 };
  SOUND_CATALOG[SFX.KICK_SWING] = { files: [file(2569, 'svisch4'), file(2570, 'svisch6')], volume: 0.6, minGapMs: 60 };
  SOUND_CATALOG[SFX.KICK_HIT] = { files: [file(2539, 'punch00'), file(2540, 'punch01'), file(2541, 'punch02'), file(2542, 'punch03')], volume: 1, minGapMs: 40 };
  SOUND_CATALOG[SFX.BLADE_HIT] = { files: [file(2517, 'cut00'), file(2518, 'cut01'), file(2519, 'cut02')], volume: 1, minGapMs: 40 };
  SOUND_CATALOG[SFX.BODY_FALL] = { files: [file(2539, 'punch00'), file(2540, 'punch01'), file(2541, 'punch02'), file(2542, 'punch03')], volume: 0.8, minGapMs: 120 };
  SOUND_CATALOG[SFX.GIB] = { files: [file(2527, 'gib_00')], volume: 1, minGapMs: 120 };

  SOUND_CATALOG[SFX.JUMP] = { files: [file(2535, 'jump_00')], volume: 0.5, minGapMs: 60 };
  SOUND_CATALOG[SFX.LAND] = { files: [file(2548, 'shellbounce00'), file(2549, 'shellbounce01')], volume: 0.5, minGapMs: 60 };
  SOUND_CATALOG[SFX.FOOTSTEP] = { files: [file(2548, 'shellbounce00'), file(2549, 'shellbounce01')], volume: 0.12, minGapMs: 80 };
  SOUND_CATALOG[SFX.ROLL] = { files: [file(2547, 'roll')], volume: 0.75, minGapMs: 100 };
  SOUND_CATALOG[SFX.DIVE_CATCH] = { files: [file(2520, 'dive_catch')], volume: 0.7, minGapMs: 100 };
  SOUND_CATALOG[SFX.CRATE_PUSH] = { files: [file(2559, 'wood_impact00')], volume: 0.22, minGapMs: 260 };
  SOUND_CATALOG[SFX.CRATE_HIT] = { files: [file(2559, 'wood_impact00')], volume: 0.7, minGapMs: 80 };
  SOUND_CATALOG[SFX.CRATE_BREAK] = { files: [file(2514, 'bustwood_1'), file(2515, 'bustwood_2')], volume: 1, minGapMs: 80 };
  SOUND_CATALOG[SFX.GLASS_BREAK] = { files: [file(2528, 'glass_1')], volume: 1, minGapMs: 60 };

  SOUND_CATALOG[SFX.HEALTH_PICKUP] = { files: [file(2526, 'getHealth_00')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_BLADE] = { files: [file(2567, 'katana_01')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_PISTOL] = { files: [file(2511, 'aim_small')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_MAGNUM] = { files: [file(2510, 'aim_big')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_UZI] = { files: [file(2538, 'outofammo_light')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_RIFLE] = { files: [file(2544, 'rifle_draw')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_SHOTGUN] = { files: [file(2568, 'shotgun_aim')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_SNIPER] = { files: [file(2537, 'outofammo_heavy')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_BAZOOKA] = { files: [file(2560, 'bazooka_aim')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_FLAMETHROWER] = { files: [file(2550, 'shotgun_pump_p1')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_GRENADE] = { files: [file(2566, 'grenade_safe')], volume: 1 };
  SOUND_CATALOG[SFX.PICKUP_MOLOTOV] = { files: [file(2551, 'shotgun_pump_p2')], volume: 1 };
  SOUND_CATALOG[SFX.SLOWMO_HEARTBEAT_LOOP] = { files: [file(2534, 'heartbeat')], volume: 1, voices: 1 };

  function clampUnit(value) {
    return value < 0 ? 0 : (value > 1 ? 1 : value);
  }

  function voiceFactoryFor(AudioConstructor) {
    if (typeof AudioConstructor !== 'function') return null;
    return function (src) {
      var voice = new AudioConstructor(src);
      voice.preload = 'auto';
      return voice;
    };
  }

  /**
   * options.audioConstructor: the page's `Audio` (default: the global one).
   * options.createVoice(src) -> element-like { play, pause, currentTime, volume, loop }
   * (injectable for tests); options.now() -> ms (injectable clock).
   */
  function createAudioManager(options) {
    options = options || {};
    var catalog = options.catalog || SOUND_CATALOG;
    var directory = options.directory !== undefined ? options.directory : SOUND_DIRECTORY;
    var createVoice = options.createVoice !== undefined
      ? options.createVoice
      : voiceFactoryFor(options.audioConstructor || root.Audio);
    var now = options.now || function () { return Date.now(); };
    var masterVolume = options.masterVolume !== undefined ? clampUnit(options.masterVolume) : DEFAULT_MASTER_VOLUME;
    var muted = false;
    var paused = false;

    var voicePools = Object.create(null);   // file -> { voices: [], next: 0 }
    var lastPlayedAt = Object.create(null); // sound name -> ms
    var loops = Object.create(null);        // loop key -> { voice, baseVolume }
    var delayedSounds = [];                 // fixed-size queue: { name, stepsLeft, options }

    function poolFor(fileName, voiceCount) {
      var pool = voicePools[fileName];
      if (pool) return pool;
      pool = { voices: [], next: 0 };
      for (var i = 0; i < voiceCount; i++) {
        try { pool.voices.push(createVoice(directory + fileName)); } catch (e) { /* no audio support: stays silent */ }
      }
      voicePools[fileName] = pool;
      return pool;
    }

    function safePlay(voice) {
      try {
        var playback = voice.play();
        if (playback && typeof playback.catch === 'function') playback.catch(function () { /* autoplay blocked */ });
      } catch (e) { /* audio never breaks gameplay */ }
    }

    function effectiveVolume(entry, playOptions) {
      var scale = playOptions && playOptions.volume !== undefined ? playOptions.volume : 1;
      return clampUnit(entry.volume * scale * masterVolume);
    }

    // Preload every file of the catalogue into its voice pool (call once at boot).
    function preload() {
      if (!createVoice) return 0;
      var loaded = 0;
      var names = Object.keys(catalog);
      for (var n = 0; n < names.length; n++) {
        var entry = catalog[names[n]];
        var voiceCount = entry.voices || DEFAULT_VOICES_PER_FILE;
        for (var f = 0; f < entry.files.length; f++) {
          var isNewPool = !voicePools[entry.files[f]];
          var pool = poolFor(entry.files[f], voiceCount);
          if (isNewPool) loaded += pool.voices.length;
        }
      }
      return loaded;
    }

    function play(name, playOptions) {
      if (!createVoice || muted || paused) return false;
      var entry = catalog[name];
      if (!entry) return false;
      var clock = now();
      var gap = entry.minGapMs !== undefined ? entry.minGapMs : DEFAULT_MIN_GAP_MS;
      if (gap > 0 && lastPlayedAt[name] !== undefined && clock - lastPlayedAt[name] < gap) return false;
      lastPlayedAt[name] = clock;
      var fileName = entry.files[entry.files.length > 1 ? Math.floor(Math.random() * entry.files.length) : 0];
      var pool = poolFor(fileName, entry.voices || DEFAULT_VOICES_PER_FILE);
      if (!pool.voices.length) return false;
      var voice = pool.voices[pool.next];
      pool.next = (pool.next + 1) % pool.voices.length; // reuse the oldest voice: bounded memory
      try {
        voice.pause();
        voice.currentTime = 0;
        voice.volume = effectiveVolume(entry, playOptions);
      } catch (e) { /* ignore */ }
      safePlay(voice);
      return true;
    }

    // Plays `name` after `steps` simulation steps (see tick()). The queue is
    // capped: when it is full the oldest pending sound is dropped.
    function playAfterSteps(name, steps, playOptions) {
      if (delayedSounds.length >= MAX_PENDING_DELAYED_SOUNDS) delayedSounds.shift();
      delayedSounds.push({ name: name, stepsLeft: steps, options: playOptions });
    }

    // Advance the delayed sounds by one simulation step (skipped while paused).
    function tick() {
      if (paused) return;
      for (var i = delayedSounds.length - 1; i >= 0; i--) {
        var item = delayedSounds[i];
        item.stepsLeft--;
        if (item.stepsLeft <= 0) {
          delayedSounds.splice(i, 1);
          play(item.name, item.options);
        }
      }
    }

    function startLoop(key, name, playOptions) {
      if (!createVoice || muted) return false;
      var running = loops[key];
      if (running) return true;
      var entry = catalog[name];
      if (!entry) return false;
      var voice;
      try { voice = createVoice(directory + entry.files[0]); } catch (e) { return false; }
      voice.loop = true;
      voice.volume = effectiveVolume(entry, playOptions);
      loops[key] = { voice: voice, entry: entry, playOptions: playOptions };
      if (!paused) safePlay(voice);
      return true;
    }

    function stopLoop(key) {
      var running = loops[key];
      if (!running) return;
      try { running.voice.pause(); running.voice.currentTime = 0; } catch (e) { /* ignore */ }
      delete loops[key];
    }

    function isLoopRunning(key) {
      return !!loops[key];
    }

    function setPaused(value) {
      value = !!value;
      if (paused === value) return;
      paused = value;
      var keys = Object.keys(loops);
      for (var i = 0; i < keys.length; i++) {
        var voice = loops[keys[i]].voice;
        if (paused) { try { voice.pause(); } catch (e) { /* ignore */ } }
        else safePlay(voice);
      }
    }

    function applyVolumeToLoops() {
      var keys = Object.keys(loops);
      for (var i = 0; i < keys.length; i++) {
        var loop = loops[keys[i]];
        try { loop.voice.volume = muted ? 0 : effectiveVolume(loop.entry, loop.playOptions); } catch (e) { /* ignore */ }
      }
    }

    function setMasterVolume(value) {
      masterVolume = clampUnit(value);
      applyVolumeToLoops();
    }

    function setMuted(value) {
      muted = !!value;
      applyVolumeToLoops();
    }

    // Stop every loop and drop pending delayed sounds (round restart / pause menu).
    function stopAll() {
      var keys = Object.keys(loops);
      for (var i = 0; i < keys.length; i++) stopLoop(keys[i]);
      delayedSounds.length = 0;
      var files = Object.keys(voicePools);
      for (var f = 0; f < files.length; f++) {
        var voices = voicePools[files[f]].voices;
        for (var v = 0; v < voices.length; v++) {
          try { voices[v].pause(); voices[v].currentTime = 0; } catch (e) { /* ignore */ }
        }
      }
    }

    return {
      preload: preload,
      play: play,
      playAfterSteps: playAfterSteps,
      tick: tick,
      startLoop: startLoop,
      stopLoop: stopLoop,
      isLoopRunning: isLoopRunning,
      setPaused: setPaused,
      setMasterVolume: setMasterVolume,
      setMuted: setMuted,
      stopAll: stopAll,
      get pendingDelayedCount() { return delayedSounds.length; },
      get masterVolume() { return masterVolume; }
    };
  }

  var api = { SFX: SFX, SOUND_CATALOG: SOUND_CATALOG, createAudioManager: createAudioManager };
  root.SuperfightersAudio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
