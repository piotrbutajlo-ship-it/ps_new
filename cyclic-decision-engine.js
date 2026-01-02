/**
 * Pocket Scout v3.0 - Cyclic Decision Engine
 * Configurable signal generation interval (1-10 minutes)
 */

window.CyclicDecisionEngine = (function() {
  'use strict';

  let currentIntervalMs = 300 * 1000; // Default 5 minutes (300 seconds)
  let intervalId = null;
  let signalGenerationCallback = null;
  let lastCycleStartTime = 0;

  function initialize(callback, intervalMinutes = 5) {
    if (intervalId) {
      clearInterval(intervalId);
    }

    if (typeof callback !== 'function') {
      console.error('[CyclicDecisionEngine] Callback must be a function');
      return;
    }

    // Set interval (1-10 minutes)
    const minutes = Math.max(1, Math.min(10, intervalMinutes));
    currentIntervalMs = minutes * 60 * 1000;

    signalGenerationCallback = callback;
    lastCycleStartTime = Date.now();

    // Immediately trigger first signal
    console.log(`[CyclicDecisionEngine] Initializing - first signal in ${minutes} minute(s)`);
    signalGenerationCallback();

    // Set up recurring interval
    intervalId = setInterval(() => {
      const now = Date.now();
      const timeSinceLastCycle = now - lastCycleStartTime;

      if (timeSinceLastCycle >= currentIntervalMs) {
        console.log(`[CyclicDecisionEngine] Cycle triggered (${((now - lastCycleStartTime) / 1000).toFixed(1)}s)`);
        signalGenerationCallback();
        lastCycleStartTime = now;
      }
    }, 1000); // Check every second

    console.log(`[CyclicDecisionEngine] Started - interval: ${currentIntervalMs / 1000}s (${minutes} min)`);
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
    return Math.max(0, currentIntervalMs - elapsed);
  }
  
  function getCurrentInterval() {
    return currentIntervalMs;
  }

  return {
    initialize,
    stop,
    getLastCycleStartTime,
    getRemainingTime,
    getCurrentInterval
  };
})();

console.log('[Pocket Scout v3.0] Cyclic Decision Engine loaded - configurable intervals');

