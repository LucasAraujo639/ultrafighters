/**
 * Superfighters clone — end-of-round flow (pure state machine, no game state).
 *
 * PLAYING ──(a fighter dies)──▶ SLOWMO ──(3 s of real time)──▶ AWAITING_CONTINUE ──(Space)──▶ restart
 *
 *  - SLOWMO: the death slow-motion runs for a fixed number of real-time
 *    steps. The result is still open: if the survivor also dies inside this
 *    window the deaths count as simultaneous and the round is a draw.
 *  - AWAITING_CONTINUE: the world is back at normal speed, the result is
 *    final and shown, the survivor keeps playing freely, and the round only
 *    restarts when the continue key is pressed.
 *
 * The game calls stepRoundFlow once per fixed simulation step and reacts to
 * the event it returns. Units: steps (the game runs 60 fixed steps per
 * real-time second, whatever the slow-motion factor).
 */
(function (root) {
  'use strict';

  var ROUND_PHASE = Object.freeze({
    PLAYING: 'playing',
    SLOWMO: 'slowmo',
    AWAITING_CONTINUE: 'awaitingContinue'
  });

  var ROUND_EVENT = Object.freeze({
    NONE: 'none',
    START_SLOWMO: 'startSlowmo',   // first death: start the slow motion
    END_SLOWMO: 'endSlowmo',       // slow motion over: restore speed, show the result
    RESTART: 'restart'             // continue pressed: load the next round
  });

  var DRAW_WINNER_ID = 0;
  var ROUND_END_SLOWMO_SECONDS = 3;

  function createRoundFlow() {
    return { phase: ROUND_PHASE.PLAYING, winnerId: null, slowmoStepsLeft: 0 };
  }

  /** Result for the current deaths: null (nobody dead), 0 (draw), or the surviving fighter's id. */
  function roundOutcome(player1Dead, player2Dead) {
    if (player1Dead && player2Dead) return DRAW_WINNER_ID;
    if (player1Dead) return 2;
    if (player2Dead) return 1;
    return null;
  }

  /**
   * Advances the flow by one simulation step. `input`: { player1Dead,
   * player2Dead, continuePressed, slowmoSteps }. Mutates `flow` and returns
   * the ROUND_EVENT the game must act on.
   */
  function stepRoundFlow(flow, input) {
    var outcome = roundOutcome(input.player1Dead, input.player2Dead);
    if (flow.phase === ROUND_PHASE.PLAYING) {
      if (outcome === null) return ROUND_EVENT.NONE;
      flow.phase = ROUND_PHASE.SLOWMO;
      flow.winnerId = outcome;
      flow.slowmoStepsLeft = input.slowmoSteps;
      return ROUND_EVENT.START_SLOWMO;
    }
    if (flow.phase === ROUND_PHASE.SLOWMO) {
      // a second death inside the slow-motion window is simultaneous: a draw
      if (outcome === DRAW_WINNER_ID) flow.winnerId = DRAW_WINNER_ID;
      flow.slowmoStepsLeft--;
      if (flow.slowmoStepsLeft > 0) return ROUND_EVENT.NONE;
      flow.phase = ROUND_PHASE.AWAITING_CONTINUE;
      return ROUND_EVENT.END_SLOWMO;
    }
    // AWAITING_CONTINUE: the result is final; only the continue key moves on
    return input.continuePressed ? ROUND_EVENT.RESTART : ROUND_EVENT.NONE;
  }

  /** Whether the round is over (the result exists), in any post-death phase. */
  function isRoundOver(flow) {
    return flow.phase !== ROUND_PHASE.PLAYING;
  }

  /** Whether the result banner and the continue prompt are on screen. */
  function showsResult(flow) {
    return flow.phase === ROUND_PHASE.AWAITING_CONTINUE;
  }

  var api = {
    ROUND_PHASE: ROUND_PHASE,
    ROUND_EVENT: ROUND_EVENT,
    DRAW_WINNER_ID: DRAW_WINNER_ID,
    ROUND_END_SLOWMO_SECONDS: ROUND_END_SLOWMO_SECONDS,
    createRoundFlow: createRoundFlow,
    roundOutcome: roundOutcome,
    stepRoundFlow: stepRoundFlow,
    isRoundOver: isRoundOver,
    showsResult: showsResult
  };
  root.SuperfightersRoundFlow = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
