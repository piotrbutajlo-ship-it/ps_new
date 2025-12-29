/**
 * Pocket Scout Dynamic Time - Signal Timing Controller
 * Manages dynamic decision windows (1-5 minutes) for optimal signal timing
 */

window.SignalTimingController = (function() {
  'use strict';

  const MIN_DELAY_MS = 60 * 1000;  // 1 minute minimum
  const MAX_DELAY_MS = 300 * 1000; // 5 minutes maximum
  const EVALUATION_INTERVAL_MS = 20 * 1000; // Evaluate every 20 seconds

  let windowStartTime = null;
  let evaluationIntervalId = null;
  let pendingSignal = null;
  let initialConfidence = null;
  let initialRegime = null;
  let timingCallback = null;

  /**
   * Evaluate timing quality based on market conditions
   * Returns score 0-1 where higher is better
   */
  function evaluateTimingQuality(ohlcData, regimeData, pendingSignalData) {
    if (!ohlcData || ohlcData.length < 50) return 0;

    const closes = ohlcData.map(c => c.c);
    const highs = ohlcData.map(c => c.h);
    const lows = ohlcData.map(c => c.l);
    const TI = window.TechnicalIndicators;

    let score = 0;
    let factors = 0;

    // 1. Confidence improvement or stabilization
    if (pendingSignalData && initialConfidence !== null) {
      const currentRecommendation = window.RLIntegration?.getRecommendedAction(ohlcData, regimeData);
      if (currentRecommendation) {
        const confidenceChange = currentRecommendation.confidence - initialConfidence;
        // More lenient: accept if confidence hasn't dropped significantly (within 10 points)
        // Give partial credit even for small drops
        if (confidenceChange >= 0) {
          // Improved confidence - full credit
          score += 0.35;
        } else if (confidenceChange >= -10) {
          // Small drop (within 10 points) - still good
          score += 0.25;
        } else if (confidenceChange >= -15) {
          // Moderate drop - partial credit
          score += 0.15;
        }
        // If drop > 15 points, no credit but don't penalize
        factors++;
      }
    }

    // 2. Favorable candle close (directional confirmation)
    if (closes.length >= 2 && pendingSignalData) {
      const lastCandle = ohlcData[ohlcData.length - 1];
      const prevCandle = ohlcData[ohlcData.length - 2];
      const candleDirection = lastCandle.c > prevCandle.c ? 'UP' : 'DOWN';
      
      if (pendingSignalData.action === 'BUY' && candleDirection === 'UP') {
        score += 0.25; // Increased weight
        factors++;
      } else if (pendingSignalData.action === 'SELL' && candleDirection === 'DOWN') {
        score += 0.25; // Increased weight
        factors++;
      } else {
        // Neutral direction - give small credit to avoid being too strict
        score += 0.05;
        factors++;
      }
    }

    // 3. Reduced short-term volatility (ATR contraction)
    const atr = TI.calculateATR(highs, lows, closes, 14);
    const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (atr && avgPrice > 0) {
      const currentVolatility = (atr / avgPrice) * 100;
      
      // Compare with initial volatility if available
      if (initialRegime && initialRegime.volatility) {
        const initialVolLevel = initialRegime.volatility.level;
        const initialVolValue = initialVolLevel === 'LOW' ? 0.3 : 
                               initialVolLevel === 'MEDIUM' ? 0.5 : 0.7;
        
        // Prefer lower or stable volatility
        if (currentVolatility < initialVolValue * 100 || 
            Math.abs(currentVolatility - initialVolValue * 100) < 0.1) {
          score += 0.2;
          factors++;
        }
      } else {
        // Prefer low to medium volatility
        if (currentVolatility < 0.5) {
          score += 0.2;
          factors++;
        }
      }
    }

    // 4. Better indicator alignment (RSI/MACD/EMA timing)
    const rsi = TI.calculateRSI(closes, 14);
    const macd = TI.calculateMACD(closes, 12, 26, 9);
    const ema12 = TI.calculateEMA(closes, 12);
    const ema26 = TI.calculateEMA(closes, 26);

    if (pendingSignalData) {
      let alignmentScore = 0;
      let alignmentFactors = 0;

      // RSI alignment - more lenient
      if (rsi !== null) {
        if (pendingSignalData.action === 'BUY' && rsi < 70 && rsi > 30) {
          alignmentScore += 0.20; // Increased
          alignmentFactors++;
        } else if (pendingSignalData.action === 'SELL' && rsi > 30 && rsi < 70) {
          alignmentScore += 0.20; // Increased
          alignmentFactors++;
        } else if ((pendingSignalData.action === 'BUY' && rsi < 75 && rsi > 25) ||
                   (pendingSignalData.action === 'SELL' && rsi > 25 && rsi < 75)) {
          // Near-optimal RSI - give partial credit
          alignmentScore += 0.10;
          alignmentFactors++;
        }
      }

      // MACD alignment - more lenient
      if (macd && macd.histogram !== undefined) {
        if (pendingSignalData.action === 'BUY' && macd.histogram > -0.0001) {
          alignmentScore += 0.20; // Increased
          alignmentFactors++;
        } else if (pendingSignalData.action === 'SELL' && macd.histogram < 0.0001) {
          alignmentScore += 0.20; // Increased
          alignmentFactors++;
        } else if ((pendingSignalData.action === 'BUY' && macd.histogram > -0.0005) ||
                   (pendingSignalData.action === 'SELL' && macd.histogram < 0.0005)) {
          // Near-optimal MACD - give partial credit
          alignmentScore += 0.10;
          alignmentFactors++;
        }
      }

      // EMA alignment - more lenient
      if (ema12 && ema26) {
        if (pendingSignalData.action === 'BUY' && ema12 > ema26) {
          alignmentScore += 0.20; // Increased
          alignmentFactors++;
        } else if (pendingSignalData.action === 'SELL' && ema12 < ema26) {
          alignmentScore += 0.20; // Increased
          alignmentFactors++;
        } else {
          // Neutral EMA - give small credit
          alignmentScore += 0.05;
          alignmentFactors++;
        }
      }

      if (alignmentFactors > 0) {
        // Increased weight for indicator alignment
        score += alignmentScore / alignmentFactors * 0.35;
        factors++;
      }
    }

    // 5. Optional: micro pullback in trend direction
    if (closes.length >= 3 && pendingSignalData) {
      const recent = closes.slice(-3);
      const pullback = (recent[0] - recent[1]) / recent[1];
      const trend = (recent[2] - recent[0]) / recent[0];
      
      // Small pullback followed by continuation in signal direction
      if (pendingSignalData.action === 'BUY' && pullback < 0 && pullback > -0.001 && trend > 0) {
        score += 0.1;
        factors++;
      } else if (pendingSignalData.action === 'SELL' && pullback > 0 && pullback < 0.001 && trend < 0) {
        score += 0.1;
        factors++;
      }
    }

    // Normalize score - but be more generous with partial scores
    if (factors === 0) return 0;
    
    // If we have multiple factors, the score should reflect that
    // Give bonus for having multiple factors evaluated (even if not all perfect)
    const baseScore = score / factors;
    const factorBonus = Math.min(0.15, factors * 0.02); // Up to 15% bonus for multiple factors
    
    return Math.min(1, baseScore + factorBonus);
  }

  /**
   * Start a new timing window after signal verification
   */
  function startTimingWindow(signalData, ohlcData, regimeData) {
    if (!signalData || !ohlcData) {
      console.warn('[SignalTimingController] Cannot start timing window: missing data');
      return;
    }

    // Store initial state
    pendingSignal = {
      action: signalData.action,
      groupId: signalData.groupId,
      groupName: signalData.groupName,
      initialPrice: signalData.price
    };
    
    initialConfidence = signalData.confidence;
    initialRegime = regimeData ? JSON.parse(JSON.stringify(regimeData)) : null;
    windowStartTime = Date.now();

    console.log(`[SignalTimingController] ⏱️ Timing window started (1-5 min)`);
    
    // Start evaluation interval
    if (evaluationIntervalId) {
      clearInterval(evaluationIntervalId);
    }
    
    evaluationIntervalId = setInterval(() => {
      if (!windowStartTime || !pendingSignal) return;
      
      const elapsed = Date.now() - windowStartTime;
      
      // Check if minimum delay has passed
      if (elapsed < MIN_DELAY_MS) {
        return;
      }
      
      // Check if maximum delay exceeded
      if (elapsed >= MAX_DELAY_MS) {
        // Don't stop window here - let content.js handle it after publishing
        // Just notify that window expired
        if (timingCallback) {
          timingCallback('EXPIRED', pendingSignal);
        }
        return;
      }
    }, EVALUATION_INTERVAL_MS);
  }

  /**
   * Check if we should publish the signal now
   */
  function shouldPublishNow(ohlcData, regimeData) {
    // Analysis-first mode: always wait until window expiry (handled by content.js)
    return false;
  }

  /**
   * Check if timing window has expired
   */
  function hasExpired() {
    if (!windowStartTime) return false;
    return (Date.now() - windowStartTime) >= MAX_DELAY_MS;
  }

  /**
   * Get elapsed time in the current window
   */
  function getElapsedTime() {
    if (!windowStartTime) return 0;
    return Date.now() - windowStartTime;
  }

  /**
   * Get remaining time in the current window
   */
  function getRemainingTime() {
    if (!windowStartTime) return MAX_DELAY_MS;
    const elapsed = Date.now() - windowStartTime;
    return Math.max(0, MAX_DELAY_MS - elapsed);
  }

  /**
   * Stop the timing window
   */
  function stopTimingWindow() {
    if (evaluationIntervalId) {
      clearInterval(evaluationIntervalId);
      evaluationIntervalId = null;
    }
    
    windowStartTime = null;
    pendingSignal = null;
    initialConfidence = null;
    initialRegime = null;
    
    console.log('[SignalTimingController] Timing window stopped');
  }

  /**
   * Check if timing window is active
   */
  function isActive() {
    return windowStartTime !== null && pendingSignal !== null;
  }

  /**
   * Get current pending signal
   */
  function getPendingSignal() {
    return pendingSignal;
  }

  /**
   * Set callback for timing events
   */
  function setTimingCallback(callback) {
    timingCallback = callback;
  }

  return {
    startTimingWindow,
    shouldPublishNow,
    hasExpired,
    getElapsedTime,
    getRemainingTime,
    stopTimingWindow,
    isActive,
    getPendingSignal,
    setTimingCallback,
    MIN_DELAY_MS,
    MAX_DELAY_MS
  };
})();

console.log('[Pocket Scout Dynamic Time] Signal Timing Controller loaded');

