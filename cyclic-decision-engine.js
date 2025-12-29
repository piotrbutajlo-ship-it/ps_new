/**
 * Pocket Scout Time - Cyclic Decision Engine
 * Forces signal generation every 330 seconds (5:30 min)
 */

window.CyclicDecisionEngine = (function() {
  'use strict';

  const CYCLE_INTERVAL_MS = 330 * 1000; // 5 minutes 30 seconds
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
    console.log('[CyclicDecisionEngine] Initializing - first signal in 5:30');
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

  return {
    initialize,
    stop,
    getLastCycleStartTime,
    CYCLE_INTERVAL_MS
  };
})();

console.log('[Pocket Scout Time] Cyclic Decision Engine loaded');

