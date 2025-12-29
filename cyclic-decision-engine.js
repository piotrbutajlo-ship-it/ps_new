/**
 * Pocket Scout v3.0 - Cyclic Decision Engine
 * Generates signals every 10 minutes (600 seconds)
 */

window.CyclicDecisionEngine = (function() {
  'use strict';

  const CYCLE_INTERVAL_MS = 600 * 1000; // 10 minutes (600 seconds)
  let intervalId = null;
  let signalGenerationCallback = null;
  let lastCycleStartTime = 0;

  function initialize(callback) {
    if (intervalId) {
      clearInterval(intervalId);
    }

    if (typeof callback !== 'function') {
      console.error('[CyclicDecisionEngine] Callback must be a function');
      return;
    }

    signalGenerationCallback = callback;
    lastCycleStartTime = Date.now();

    // Immediately trigger first signal
    console.log('[CyclicDecisionEngine] Initializing - first signal in 10:00 minutes');
    signalGenerationCallback();

    // Set up recurring interval
    intervalId = setInterval(() => {
      const now = Date.now();
      const timeSinceLastCycle = now - lastCycleStartTime;

      if (timeSinceLastCycle >= CYCLE_INTERVAL_MS) {
        console.log(`[CyclicDecisionEngine] Cycle triggered (${((now - lastCycleStartTime) / 1000).toFixed(1)}s)`);
        signalGenerationCallback();
        lastCycleStartTime = now;
      }
    }, 1000); // Check every second

    console.log(`[CyclicDecisionEngine] Started - interval: ${CYCLE_INTERVAL_MS / 1000}s`);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log('[CyclicDecisionEngine] Stopped');
    }
  }

  function getLastCycleStartTime() {
    return lastCycleStartTime;
  }

  function getRemainingTime() {
    const now = Date.now();
    const elapsed = now - lastCycleStartTime;
    return Math.max(0, CYCLE_INTERVAL_MS - elapsed);
  }

  return {
    initialize,
    stop,
    getLastCycleStartTime,
    getRemainingTime,
    CYCLE_INTERVAL_MS
  };
})();

console.log('[Pocket Scout v3.0] Cyclic Decision Engine loaded - 10 minute intervals');

