/**
 * Pocket Scout Dynamic Time - Main Content Script
 * Dynamic timing windows (1-5 min) for optimal signal entry
 */

(function() {
  'use strict';

  const VERSION = '2.1.0';
  const FEED_KEY = 'PS_AT_FEED';
  const WARMUP_MINUTES = 50; // Optimal warmup: 50 minutes
  const WARMUP_CANDLES = WARMUP_MINUTES; // 1 candle per minute

  // State
  const circularBuffer = window.CircularBuffer.getInstance();
  let ohlcM1 = [];
  let lastPrice = null;
  let warmupComplete = false;
  let lastSignal = null;
  let lastRegime = null;
  let pendingSignalData = null; // Signal waiting for optimal timing
  let signalLocked = false; // Lock to prevent overlapping signals
  let timingMonitorInterval = null;
  let signalUnlockTimeout = null; // Timeout to auto-unlock signal generation
  let signalVerificationTimeouts = new Map(); // Track verification timeouts for each signal
  let lastFeedCheck = null; // Track last feed check time
  let cachedSeries = null; // cached OHLC arrays for latency reduction
  let cachedVersion = null; // track last candle time for cache invalidation
  let gateRejectStreak = 0; // track consecutive gate rejections to enable soft exploration
  const GLOBAL_THRESHOLDS = window.PocketScoutThresholds || {};
  const VOL_RISK_LOW = GLOBAL_THRESHOLDS.VOL_RISK_LOW || 0.002;
  const VOL_RISK_ELEVATED = GLOBAL_THRESHOLDS.VOL_RISK_ELEVATED || 0.012;
  const VOL_RISK_EXTREME = GLOBAL_THRESHOLDS.VOL_RISK_EXTREME || 0.02;

  // UI Elements
  let UI = {};

  // Cache helper to avoid repeated array construction
  function refreshSeries() {
    cachedSeries = {
      closes: ohlcM1.map(c => c.c),
      highs: ohlcM1.map(c => c.h),
      lows: ohlcM1.map(c => c.l),
      opens: ohlcM1.map(c => c.o),
      candles: ohlcM1
    };
    cachedVersion = ohlcM1.length ? ohlcM1[ohlcM1.length - 1].t : null;
  }

  function getSeries() {
    const latestVersion = ohlcM1.length ? ohlcM1[ohlcM1.length - 1].t : null;
    if (!cachedSeries || cachedVersion !== latestVersion) {
      refreshSeries();
    }
    return cachedSeries;
  }

  function getRiskSummary() {
    if (!ohlcM1 || ohlcM1.length < 20 || !window.TechnicalIndicators) return null;
    const { closes, highs, lows } = getSeries();
    const TI = window.TechnicalIndicators;
    const atr = TI.calculateATR(highs, lows, closes, 14);
    const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (!atr || !avgPrice) return null;
    const ratio = atr / avgPrice;
    let level = 'BALANCED';
    if (ratio < VOL_RISK_LOW) level = 'LOW';
    else if (ratio > VOL_RISK_EXTREME) level = 'EXTREME';
    else if (ratio > VOL_RISK_ELEVATED) level = 'HIGH';
    return { ratio, level };
  }

  function getPatternSummary() {
    if (!ohlcM1 || ohlcM1.length < 2 || !window.TechnicalIndicators) return null;
    return window.TechnicalIndicators.detectCandlestickPatterns(ohlcM1.slice(-3));
  }

  // Read price from DOM - ROBUST VERSION
  function readPriceFromDom() {
    // Primary reliable selectors for Pocket Option
    const selectors = [
      '.current-rate-value',             // New platform version
      '.current-rate__value',            // Standard
      '.chart-rate__value',              // Chart specific
      '.rate-value',                     // Generic
      '[data-role="current-rate"]',      // Data attribute
      '.assets-table__cell--rate',       // Asset table
      '.strike-rate__value',             // Strike price
      'span.open-time-number',           // Legacy
      '#price',                          // Fallback ID
      '.current-price'                   // Fallback class
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        // Check visibility
        if (element.offsetParent === null) continue;
        
        const text = element.textContent.trim().replace(/[^0-9.]/g, '');
        const price = parseFloat(text);
        
        // Basic validation for currency pairs (must be positive, likely between 0.5 and 200 for forex/crypto)
        if (!isNaN(price) && price > 0) {
          return price;
        }
      }
    }
    
    // Fallback: Try to find any text node that looks like a price in the chart container
    const chartContainer = document.querySelector('.chart-container') || document.body;
    if (chartContainer) {
      // Regex for price pattern like 1.23456 or 150.25
      const priceRegex = /\b\d+\.\d{2,6}\b/;
      const matches = chartContainer.innerText.match(priceRegex);
      if (matches && matches.length > 0) {
        return parseFloat(matches[0]);
      }
    }
    
    return null;
  }

  // Push tick and build M1 candles
  function pushTick(timestamp, price) {
    if (!price || isNaN(price)) return;
    
    lastPrice = price;
    
    // Update UI status with price and candle info
    updateStatusDisplay();
    
    const candleTime = Math.floor(timestamp / 60000) * 60000;
    const lastCandle = circularBuffer.getLatest();
    
    if (!lastCandle || lastCandle.t < candleTime) {
      // New candle
      const newCandle = {
        t: candleTime,
        o: price,
        h: price,
        l: price,
        c: price
      };
      circularBuffer.add(newCandle);
      ohlcM1 = circularBuffer.getAll();
      refreshSeries();
      
      // Check warmup
      if (!warmupComplete && ohlcM1.length >= WARMUP_CANDLES) {
        warmupComplete = true;
        console.log(`[Pocket Scout Dynamic Time] ✅ Warmup complete! ${ohlcM1.length} candles`);
        if (window.RLIntegration && window.RLIntegration.warmupBanditFromHistory) {
          window.RLIntegration.warmupBanditFromHistory(ohlcM1);
        }
        updateStatusDisplay();
        updateUI([]);
      } else {
        updateStatusDisplay();
      }
    } else {
      // Update last candle
      circularBuffer.updateLast({
        h: Math.max(lastCandle.h, price),
        l: Math.min(lastCandle.l, price),
        c: price
      });
      ohlcM1 = circularBuffer.getAll();
      refreshSeries();
      updateStatusDisplay();
    }

    // If we're warmed up and idle, start a timing window automatically
    if (warmupComplete && !signalLocked && !pendingSignalData) {
      const timingActive = window.SignalTimingController && window.SignalTimingController.isActive && window.SignalTimingController.isActive();
      if (!timingActive) {
        prepareSignalForTiming();
      }
    }
  }

  // Prepare signal and start timing window (called after signal verification)
  function prepareSignalForTiming() {
    if (!warmupComplete) {
      console.log(`[Pocket Scout Dynamic Time] ⏸️ Warmup in progress: ${ohlcM1.length}/${WARMUP_CANDLES} candles`);
      return;
    }

    if (ohlcM1.length < 50) {
      console.log(`[Pocket Scout Dynamic Time] ⏸️ Insufficient candles: ${ohlcM1.length}/50`);
      return;
    }

    if (signalLocked) {
      console.log(`[Pocket Scout Dynamic Time] ⏸️ Signal generation locked (waiting for outcome)`);
      return;
    }

    console.log(`[Pocket Scout Dynamic Time] 🔄 Preparing signal for timing window`);

    // Update regime
    if (window.MarketRegimeDetector) {
      const regimeResult = window.MarketRegimeDetector.updateRegime(ohlcM1);
      lastRegime = regimeResult.regime || window.MarketRegimeDetector.getCurrentRegime();
    }

    // Start an analysis window without locking direction; final decision happens at expiry
    const series = getSeries();
    const { closes } = series;
    const fallbackPrice = lastPrice || (closes.length ? closes[closes.length - 1] : null);

    pendingSignalData = {
      action: 'TBD',
      groupId: 'ANALYSIS_WINDOW',
      groupName: 'Analyzing market',
      price: fallbackPrice,
      expiry: 300,
      minutes: 5,
      timestamp: Date.now(),
      reasons: [],
      risk: getRiskSummary(),
      patterns: getPatternSummary()
    };

    signalLocked = true;
    
    if (window.SignalTimingController) {
      window.SignalTimingController.startTimingWindow(pendingSignalData, ohlcM1, lastRegime);
      console.log(`[Pocket Scout Dynamic Time] ⏱️ Timing window started (analysis-first, direction decided at publish)`);
      updateUI([]); // Show timing status
    }
  }

  // Enhanced signal validation
  function validateSignal(signal, ohlcData, regimeData) {
    if (!signal || !ohlcData || ohlcData.length < 50) {
      return { valid: false, reason: 'Insufficient data' };
    }

    const { closes, highs, lows } = getSeries();
    const TI = window.TechnicalIndicators;

    // 1. Check volatility filter
    const atr = TI.calculateATR(highs, lows, closes, 14);
    const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (atr && avgPrice > 0) {
      const volatilityRatio = (atr / avgPrice) * 100;
      if (volatilityRatio > 3.0) { // Extreme volatility
        return { valid: false, reason: `Extreme volatility: ${volatilityRatio.toFixed(2)}%` };
      }
    }

    // 2. Check trend strength (if ADX available)
    const adx = TI.calculateADX(highs, lows, closes, 14);
    if (adx && adx.adx < 15) {
      // Very weak trend - might be choppy market
      // Allow but note it
      console.log(`[Pocket Scout Dynamic Time] ⚠️ Weak trend (ADX: ${adx.adx.toFixed(1)})`);
    }

    // 3. Check price movement consistency
    if (closes.length >= 5) {
      const recent = closes.slice(-5);
      const priceChange = Math.abs((recent[recent.length - 1] - recent[0]) / recent[0]);
      if (priceChange > 0.02) { // More than 2% move in 5 candles
        return { valid: false, reason: `Excessive price movement: ${(priceChange * 100).toFixed(2)}%` };
      }
    }

    // 4. Check regime stability
    if (regimeData) {
      const stability = window.MarketRegimeDetector.getRegimeStability();
      if (stability < 20) {
        return { valid: false, reason: `Unstable regime: ${stability.toFixed(1)}%` };
      }
    }

    return { valid: true, reason: 'Signal validated' };
  }

  // Monitor timing window and publish when optimal
  function monitorTimingWindow() {
    if (!window.SignalTimingController || !pendingSignalData) return;
    
    // Update regime for current evaluation
    if (window.MarketRegimeDetector) {
      const regimeResult = window.MarketRegimeDetector.updateRegime(ohlcM1);
      lastRegime = regimeResult.regime || window.MarketRegimeDetector.getCurrentRegime();
    }

    // Check freshness: cancel if price flips against bias after selection
    const series = getSeries();
    const { closes } = series;
    if (pendingSignalData && pendingSignalData.action && pendingSignalData.action !== 'TBD' && closes.length >= 2) {
      const TI = window.TechnicalIndicators;
      const bb = TI.calculateBollingerBands(closes, 20, 2);
      const ema21 = TI.calculateEMA(closes, 21);
      const lastClose = closes[closes.length - 1];
      const biasAgainst = (action) => {
        if (!bb || !ema21) return false;
        if (action === 'BUY') {
          return lastClose < bb.middle && lastClose < ema21;
        }
        if (action === 'SELL') {
          return lastClose > bb.middle && lastClose > ema21;
        }
        return false;
      };
      if (biasAgainst(pendingSignalData.action)) {
        console.log('[Pocket Scout Dynamic Time] 🔁 Bias flipped against signal during window, cancelling');
        cancelPendingSignal();
        return;
      }
    }

    // Check if window expired first (even if not active, we need to publish)
    if (window.SignalTimingController.hasExpired()) {
      // At expiry, pick the best current direction (analysis-first approach)
      publishPendingSignal();
      return;
    }
    
    // If window is not active, don't continue monitoring
    if (!window.SignalTimingController.isActive()) {
      return;
    }

    // Update UI with timing status
    updateTimingStatus();
  }

  // Get price at expiry time using candles
  function getPriceAtExpiry(signal) {
    if (!signal || !signal.timestamp) return null;
    
    const entryTime = signal.timestamp;
    const expirySeconds = signal.expiry || (signal.minutes || 5) * 60;
    const expiryTime = entryTime + (expirySeconds * 1000); // Convert seconds to ms
    const expiryCandleTime = Math.floor(expiryTime / 60000) * 60000; // Round to minute (start of candle)
    const expiryCandleEndTime = expiryCandleTime + 60000; // End of candle (1 minute later)
    
    // Find the candle that contains the expiry time
    // A candle covers time from t to t+60000 (1 minute)
    if (!ohlcM1 || ohlcM1.length === 0) return null;
    
    // Find candle that contains expiry time
    // Candle time t means candle covers [t, t+60000)
    let expiryCandle = null;
    for (let i = ohlcM1.length - 1; i >= 0; i--) {
      const candle = ohlcM1[i];
      // Check if expiry time falls within this candle's time range
      if (expiryTime >= candle.t && expiryTime < candle.t + 60000) {
        expiryCandle = candle;
        break;
      }
      // If we've gone past the expiry candle, stop searching
      if (candle.t < expiryCandleTime) {
        break;
      }
    }
    
    // If we found the exact expiry candle, use its close price
    if (expiryCandle) {
      return expiryCandle.c; // Close price of expiry candle
    }
    
    // Fallback: find the candle that was active at expiry time
    // Look for candle with time <= expiryTime < time+60000
    for (let i = ohlcM1.length - 1; i >= 0; i--) {
      const candle = ohlcM1[i];
      if (candle.t <= expiryTime && expiryTime < candle.t + 60000) {
        return candle.c;
      }
      // Stop if we've gone too far back
      if (candle.t < expiryCandleTime - 60000) {
        break;
      }
    }
    
    // Last resort: use the most recent candle's close price
    // This happens if expiry time is in the future or we don't have that candle yet
    if (ohlcM1.length > 0) {
      const lastCandle = ohlcM1[ohlcM1.length - 1];
      // Only use if we're past expiry time
      if (Date.now() >= expiryTime) {
        return lastCandle.c;
      }
    }
    
    return null;
  }

  // Automatically verify signal outcome based on price movement at expiry
  function autoVerifySignal(signal) {
    if (!signal) {
      console.warn(`[Pocket Scout Dynamic Time] ⚠️ Cannot auto-verify: missing signal`);
      return null;
    }

    const entryPrice = signal.price;
    const entryTime = signal.timestamp;
    const expirySeconds = signal.expiry || 300; // Default 5 minutes
    const expiryTime = entryTime + (expirySeconds * 1000);
    const now = Date.now();
    
    // Get price at expiry time (using candles for accuracy)
    let expiryPrice = getPriceAtExpiry(signal);
    
    // If we can't get expiry price from candles, use current price
    // But only if we're past expiry time (with small margin)
    if (!expiryPrice) {
      if (now >= expiryTime - 10000) { // Within 10 seconds of expiry or past
        expiryPrice = lastPrice;
      } else {
        console.warn(`[Pocket Scout Dynamic Time] ⚠️ Cannot auto-verify: no price data at expiry time`);
        return null;
      }
    }
    
    const priceChange = expiryPrice - entryPrice;
    const priceChangePercent = (priceChange / entryPrice) * 100;
    
    // For binary options: WIN if price moved in predicted direction
    // We use a very small threshold to account for spread/noise
    // But we need clear directional movement
    const MIN_MOVEMENT_PERCENT = 0.001; // 0.001% minimum movement (very small threshold)
    
    let outcome = null;
    const direction = priceChange > 0 ? '↑' : priceChange < 0 ? '↓' : '→';
    
    if (signal.action === 'BUY') {
      // BUY wins if expiry price is higher than entry price
      if (priceChange > 0) {
        // Price increased - WIN
        outcome = 'WIN';
      } else if (priceChange < 0) {
        // Price decreased - LOSS
        outcome = 'LOSS';
      } else {
        // Price exactly the same - very rare, consider it a LOSS (no movement)
        outcome = 'LOSS';
      }
    } else if (signal.action === 'SELL') {
      // SELL wins if expiry price is lower than entry price
      if (priceChange < 0) {
        // Price decreased - WIN
        outcome = 'WIN';
      } else if (priceChange > 0) {
        // Price increased - LOSS
        outcome = 'LOSS';
      } else {
        // Price exactly the same - very rare, consider it a LOSS (no movement)
        outcome = 'LOSS';
      }
    }

    if (outcome) {
      const timeSinceExpiry = (now - expiryTime) / 1000;
      console.log(`[Pocket Scout Dynamic Time] 🔍 Auto-verification: ${signal.action} | Entry: ${entryPrice.toFixed(5)} | Expiry: ${expiryPrice.toFixed(5)} | Change: ${direction}${Math.abs(priceChangePercent).toFixed(4)}% | Time: ${timeSinceExpiry.toFixed(1)}s | Outcome: ${outcome}`);
      verifySignal(outcome);
      return outcome;
    }

    return null;
  }

  // Check localStorage for Auto Trader results
  function checkAutoTraderResults() {
    try {
      const feedData = localStorage.getItem('PS_AT_FEED');
      if (!feedData) return;

      const parsed = JSON.parse(feedData);
      if (!parsed.signals || !Array.isArray(parsed.signals)) return;

      // Look for signals with results
      for (const feedSignal of parsed.signals) {
        if (feedSignal.result && lastSignal && 
            feedSignal.timestamp === lastSignal.timestamp) {
          // Found result for current signal
          console.log(`[Pocket Scout Dynamic Time] 📥 Auto Trader result received: ${feedSignal.result}`);
          verifySignal(feedSignal.result);
          return;
        }
      }
    } catch (e) {
      // Silently fail - localStorage might not be accessible
    }
  }

  // Publish the pending signal
  function publishPendingSignal() {
    if (!pendingSignalData) return;

    const series = getSeries();
    const { closes, highs, lows, opens, candles } = series;

    // Determine best action at publish time
    let finalSignal = null;
    let regimeAtPublish = lastRegime;

    if (window.MarketRegimeDetector) {
      const regimeResult = window.MarketRegimeDetector.updateRegime(ohlcM1);
      regimeAtPublish = regimeResult.regime || window.MarketRegimeDetector.getCurrentRegime();
    }

    if (window.RLIntegration && window.RLIntegration.getRecommendedAction) {
      const recommendation = window.RLIntegration.getRecommendedAction(ohlcM1, regimeAtPublish);
      const groups = window.IndicatorGroups.getAllGroups();
      const selectedGroup = groups[recommendation.actionIndex];

      if (selectedGroup && selectedGroup.analyze) {
        const analysis = selectedGroup.analyze({ closes, highs, lows, opens, candles });
        if (analysis && analysis.action) {
          finalSignal = {
            action: analysis.action,
            confidence: recommendation.confidence,
            groupId: recommendation.groupId,
            groupName: recommendation.groupName,
            reasons: analysis.reasons || [],
            qAdvantage: recommendation.qAdvantage || 0
          };
        }
      }
    }

    // Fallback: scan all groups to find best current action
    if (!finalSignal) {
      const groups = window.IndicatorGroups.getAllGroups();
      for (const group of groups) {
        if (!group.analyze) continue;
        const analysis = group.analyze({ closes, highs, lows, opens, candles });
        if (analysis && analysis.action) {
           finalSignal = {
             action: analysis.action,
             confidence: analysis.confidence || 70,
             groupId: group.id,
             groupName: group.name,
             reasons: analysis.reasons || [],
             qAdvantage: 0
           };
          break;
        }
      }
    }

    if (!finalSignal) {
      console.warn('[Pocket Scout Dynamic Time] ⚠️ No valid action at publish time; canceling window');
      signalLocked = false;
      pendingSignalData = null;
      return;
    }

    // Bandit weight adjustment to prioritize historically winning groups
    let banditWeight = 1;
    if (window.RLIntegration && window.RLIntegration.getBanditWeight) {
      banditWeight = window.RLIntegration.getBanditWeight(finalSignal.groupId);
      finalSignal.confidence = Math.max(40, Math.min(95, Math.round(finalSignal.confidence * banditWeight)));
    }

    // Soft-gated scoring: never block publishing; gate score adjusts confidence
    const TI = window.TechnicalIndicators;
    const adx = TI.calculateADX(highs, lows, closes, 14);
    const macd = TI.calculateMACD(closes, 12, 26, 9);
    const rsi = TI.calculateRSI(closes, 14);
    const stoch = TI.calculateStochastic(highs, lows, closes, 14, 3);
    const bb = TI.calculateBollingerBands(closes, 20, 2);
    const atr = TI.calculateATR(highs, lows, closes, 14);
    const ema12 = TI.calculateEMA(closes, 12);
    const ema26 = TI.calculateEMA(closes, 26);
    const ema21 = TI.calculateEMA(closes, 21);

    function passesHardGates(action, softMode = false) {
      const volLevel = (regimeAtPublish && regimeAtPublish.volatility && regimeAtPublish.volatility.level) || 'MEDIUM';
      const price = closes[closes.length - 1];
      const configByVol = {
        LOW: { atrMin: 0.001, atrMax: 0.028, macdTol: 0.0006, rsiBuyMax: 75, rsiSellMin: 25, stochBuyMax: 90, stochSellMin: 10, emaTol: 0.00008 },
        MEDIUM: { atrMin: 0.0015, atrMax: 0.03, macdTol: 0.0005, rsiBuyMax: 72, rsiSellMin: 28, stochBuyMax: 88, stochSellMin: 12, emaTol: 0.0001 },
        HIGH: { atrMin: 0.0015, atrMax: 0.03, macdTol: 0.0004, rsiBuyMax: 70, rsiSellMin: 30, stochBuyMax: 85, stochSellMin: 15, emaTol: 0.00012 }
      };
      const cfg = configByVol[volLevel] || configByVol.MEDIUM;
      const softCfg = {
        atrMin: cfg.atrMin * 0.6,
        atrMax: cfg.atrMax * 1.15,
        macdTol: cfg.macdTol * 1.8,
        rsiBuyMax: cfg.rsiBuyMax + 4,
        rsiSellMin: Math.max(20, cfg.rsiSellMin - 4),
        stochBuyMax: Math.min(95, cfg.stochBuyMax + 5),
        stochSellMin: Math.max(5, cfg.stochSellMin - 5),
        emaTol: cfg.emaTol * 1.8
      };
      const useCfg = softMode ? softCfg : cfg;
      const emaDiff = ema12 && ema26 ? ema12 - ema26 : null;

      // Trend alignment (allow neutral when EMAs converge)
      if (emaDiff !== null) {
        const isUp = emaDiff >= -useCfg.emaTol;
        const isDown = emaDiff <= useCfg.emaTol * -1;
        const isNeutral = Math.abs(emaDiff) < useCfg.emaTol;
        if (action === 'BUY' && !isUp && !isNeutral) return false;
        if (action === 'SELL' && !isDown && !isNeutral) return false;
        if (adx && adx.adx !== null && adx.adx > (softMode ? 35 : 30) && !isNeutral) {
          const adxUp = adx.plusDI > adx.minusDI;
          if (action === 'BUY' && !adxUp) return false;
          if (action === 'SELL' && adxUp) return false;
        }
      }

      // Momentum alignment
      if (macd && macd.histogram !== undefined) {
        if (action === 'BUY' && macd.histogram < -useCfg.macdTol) return false;
        if (action === 'SELL' && macd.histogram > useCfg.macdTol) return false;
      }
      if (rsi !== null) {
        if (action === 'BUY' && rsi > useCfg.rsiBuyMax) return false;
        if (action === 'SELL' && rsi < useCfg.rsiSellMin) return false;
      }
      if (stoch && stoch.k !== undefined) {
        if (action === 'BUY' && stoch.k > useCfg.stochBuyMax) return false;
        if (action === 'SELL' && stoch.k < useCfg.stochSellMin) return false;
      }

      // Volatility guard
      if (atr && closes.length >= 20) {
        const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const ratio = avgPrice > 0 ? atr / avgPrice : 0;
        if (ratio > useCfg.atrMax || ratio < useCfg.atrMin) return false;
      }

      // Pattern/context alignment: ensure price not against mid-BB/EMA21
      const lastClose = closes[closes.length - 1];
      if (bb) {
        const priceTol = price ? price * (softMode ? 0.001 : 0.0005) : (softMode ? 0.001 : 0.0005);
        const closeToEMA = ema21 ? Math.abs(bb.middle - ema21) <= priceTol : false;
        if (closeToEMA) {
          if (action === 'BUY' && lastClose < Math.min(bb.middle, ema21 || bb.middle)) return false;
          if (action === 'SELL' && lastClose > Math.max(bb.middle, ema21 || bb.middle)) return false;
        } else {
          if (!softMode) {
            if (action === 'BUY' && lastClose < bb.middle) return false;
            if (action === 'SELL' && lastClose > bb.middle) return false;
          }
        }
      }
      if (ema21) {
        const priceTol = price ? price * (softMode ? 0.001 : 0.0005) : (softMode ? 0.001 : 0.0005);
        const closeToBB = bb ? Math.abs(ema21 - bb.middle) <= priceTol : false;
        if (!closeToBB && !softMode) {
          if (action === 'BUY' && lastClose < ema21) return false;
          if (action === 'SELL' && lastClose > ema21) return false;
        }
      }

      // Regime-aware: avoid counter-trend in strong ADX
      if (adx && adx.adx !== null && adx.adx > 25) {
        const isUp = adx.plusDI > adx.minusDI;
        if (action === 'BUY' && !isUp) return false;
        if (action === 'SELL' && isUp) return false;
      }

      return true;
    }

    const gatePassed = passesHardGates(finalSignal.action, false);
    const gateSoftPass = passesHardGates(finalSignal.action, true);
    const gateScore = gatePassed ? 1 : gateSoftPass ? 0.65 : 0.45;
    gateRejectStreak = gatePassed ? 0 : gateRejectStreak + 1;

    // Adaptive confidence: earned, not smoothed
    const qAdv = window.RLIntegration && window.RLIntegration.getLastQAdvantage ? window.RLIntegration.getLastQAdvantage() : (window.RLIntegration && window.RLIntegration.lastQAdvantage) || (finalSignal.qAdvantage || 0);
    let adjustedConfidence = finalSignal.confidence;
    adjustedConfidence = Math.max(40, Math.min(95, Math.round(adjustedConfidence * (0.6 + 0.4 * gateScore))));
    if (!gatePassed) {
      adjustedConfidence = Math.min(adjustedConfidence, 74); // keep sub-75 when alignment is soft
    }
    // Elevate only when all alignment + advantage + learned weight agree
    if (canElevate) {
      const edgeBoost = Math.min(20, Math.round(qAdv * 25) + Math.round((banditWeight - 1) * 15));
      adjustedConfidence = Math.max(adjustedConfidence, Math.min(95, 72 + edgeBoost));
    } else {
      adjustedConfidence = Math.min(adjustedConfidence, 74);
    }

    finalSignal.confidence = adjustedConfidence;

    // Update signal with current price and timestamp
    // IMPORTANT: Store RL state and action for learning (before they get overwritten)
    const rlState = window.RLIntegration && window.RLIntegration.getLastState ? 
                    window.RLIntegration.getLastState() : null;
    const rlAction = window.RLIntegration && window.RLIntegration.getLastAction !== undefined ? 
                     window.RLIntegration.getLastAction() : null;
    
    const signal = {
      ...pendingSignalData,
      action: finalSignal.action,
      groupId: finalSignal.groupId,
      groupName: finalSignal.groupName,
      confidence: finalSignal.confidence,
      reasons: finalSignal.reasons,
      price: lastPrice || pendingSignalData.price,
      timestamp: Date.now(),
      // Store RL state and action for learning (protected from overwriting)
      _rlState: rlState ? [...rlState] : null,
      _rlAction: rlAction
    };

    lastSignal = signal;
    gateRejectStreak = 0;
    const expiryDisplay = signal.expiry ? `${signal.expiry}s` : `${signal.minutes || 5}min`;
    console.log(`[Pocket Scout Dynamic Time] ✅ Signal published: ${signal.action} | ${signal.groupName} | Conf: ${signal.confidence}% | Entry: ${signal.price.toFixed(5)} | Expiry: ${expiryDisplay}`);
    console.log(`[Pocket Scout Dynamic Time] ⏱️ Auto-verification scheduled for ${expiryDisplay} after entry`);
    
    updateUI([signal]);
    publishToAutoTrader([signal]);
    
    // Clean up timing window
    if (window.SignalTimingController) {
      window.SignalTimingController.stopTimingWindow();
    }
    
    pendingSignalData = null;
    // Keep signalLocked = true until outcome is verified
    
    // Schedule automatic verification after expiry time
    // Use expiry in seconds (from signal.expiry) or fallback to minutes
    const expirySeconds = signal.expiry || (signal.minutes || 5) * 60;
    const expiryMs = expirySeconds * 1000;
    const verificationDelay = expiryMs + 15000; // Expiry + 15 seconds for price to settle and candle to close
    
    // Clear any existing verification timeout for this signal
    const signalId = signal.timestamp;
    if (signalVerificationTimeouts.has(signalId)) {
      clearTimeout(signalVerificationTimeouts.get(signalId));
    }
    
    // Schedule automatic verification
    const verificationTimeout = setTimeout(() => {
      if (lastSignal && lastSignal.timestamp === signalId) {
        // First try to get result from Auto Trader
        checkAutoTraderResults();
        
        // If still not verified, use price-based auto-verification
        if (signalLocked && lastSignal && lastSignal.timestamp === signalId) {
          console.log(`[Pocket Scout Dynamic Time] ⏰ Signal expiry reached (${expirySeconds}s), auto-verifying...`);
          
          // Wait a bit more for candle to close, then verify
          setTimeout(() => {
            if (signalLocked && lastSignal && lastSignal.timestamp === signalId) {
              const verified = autoVerifySignal(lastSignal);
              
              // If auto-verification didn't work, try again after another delay
              if (!verified) {
                console.log(`[Pocket Scout Dynamic Time] ⚠️ Auto-verification failed, retrying in 10s...`);
                setTimeout(() => {
                  if (signalLocked && lastSignal && lastSignal.timestamp === signalId) {
                    const retryVerified = autoVerifySignal(lastSignal);
                    
                    // If still not verified, unlock anyway
                    if (!retryVerified) {
                      console.log(`[Pocket Scout Dynamic Time] 🔓 Auto-unlocking (verification failed after retry)`);
                      signalLocked = false;
                      lastSignal = null;
                      
                      // Prepare new signal after unlock
                      setTimeout(() => {
                        if (!signalLocked && !pendingSignalData) {
                          prepareSignalForTiming();
                        }
                      }, 2000);
                    }
                  }
                }, 10000); // Additional 10 seconds wait
              }
            }
          }, 5000); // Wait 5 seconds for candle to close
        }
      }
      signalVerificationTimeouts.delete(signalId);
    }, verificationDelay);
    
    signalVerificationTimeouts.set(signalId, verificationTimeout);
    
    // Also set up periodic checks for Auto Trader results
    if (!lastFeedCheck) {
      lastFeedCheck = setInterval(() => {
        if (signalLocked && lastSignal) {
          checkAutoTraderResults();
        }
      }, 5000); // Check every 5 seconds
    }
  }

  // Cancel pending signal
  function cancelPendingSignal() {
    if (window.SignalTimingController) {
      window.SignalTimingController.stopTimingWindow();
    }
    
    pendingSignalData = null;
    signalLocked = false;
    updateUI([]);
    console.log(`[Pocket Scout Dynamic Time] ❌ Pending signal canceled`);
  }

  // Publish to Auto Trader
  function publishToAutoTrader(signals) {
    if (!signals || signals.length === 0) return;

    const feed = signals.map(sig => ({
      model: sig.groupId,
      action: sig.action,
      displayConf: sig.confidence,
      confidence: sig.confidence,
      minutes: sig.minutes,
      optimalExpiry: sig.expiry,
      expirySeconds: sig.expiry,
      timestamp: sig.timestamp,
      entryPrice: sig.price
    }));

    const payload = { signals: feed };
    localStorage.setItem(FEED_KEY, JSON.stringify(payload));
    
    console.log(`[Pocket Scout Dynamic Time] 📤 Published to Auto Trader:`, feed);
  }

  // Update status display (price + candles info)
  function updateStatusDisplay() {
    if (!UI.status) return;
    
    const progress = Math.min(100, (ohlcM1.length / WARMUP_CANDLES) * 100);
    const warmupStatus = warmupComplete ? '✅ Complete' : '🔥 In Progress';
    const warmupColor = warmupComplete ? '#10b981' : '#f59e0b';
    const risk = getRiskSummary();
    const pattern = getPatternSummary();
    const regimeDirection = lastRegime && lastRegime.trend ? lastRegime.trend.direction : 'NEUTRAL';
    const riskText = risk ? `${(risk.ratio * 100).toFixed(2)}% (${risk.level})` : 'n/a';
    const patternText = pattern && pattern.patterns && pattern.patterns.length ? pattern.patterns.join(', ') : 'None';
    
    UI.status.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="opacity:0.7;">Current Price:</span>
        <span style="font-weight:700; color:#fff; font-family:monospace; font-size:13px;">${lastPrice ? lastPrice.toFixed(5) : 'N/A'}</span>
      </div>
      <div style="padding-top:8px; border-top:1px solid #334155; margin-top:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="opacity:0.7; font-size:11px;">Warmup:</span>
          <span style="font-weight:600; color:${warmupColor}; font-size:11px;">${warmupStatus}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="opacity:0.7; font-size:11px;">M1 Candles:</span>
          <span style="font-weight:700; color:#60a5fa; font-size:12px; font-family:monospace;">${ohlcM1.length}/${WARMUP_CANDLES}</span>
        </div>
        ${!warmupComplete ? `
          <div style="background:#1e293b; border-radius:6px; height:8px; overflow:hidden; margin-top:6px;">
            <div style="background:#3b82f6; height:100%; width:${progress}%; transition:width 0.3s;"></div>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; font-size:11px;">
          <span style="opacity:0.7;">Volatility</span>
          <span style="font-weight:600; color:#facc15;">${riskText}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; font-size:11px;">
          <span style="opacity:0.7;">Regime</span>
          <span style="font-weight:600; color:#a5b4fc;">${regimeDirection}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; font-size:11px;">
          <span style="opacity:0.7;">Pattern</span>
          <span style="font-weight:600; color:#34d399;">${patternText}</span>
        </div>
      </div>
    `;
  }

  // Update UI
  function updateUI(signals) {
    if (!UI.panel) return;
    
    // Always update status display
    updateStatusDisplay();

    // Update warmup status
    if (!warmupComplete) {
      const progress = Math.min(100, (ohlcM1.length / WARMUP_CANDLES) * 100);
      if (UI.signals) {
        UI.signals.innerHTML = `
          <div style="padding:20px; text-align:center;">
            <div style="font-size:16px; margin-bottom:10px;">🔥 Warmup in Progress</div>
            <div style="font-size:14px; color:#60a5fa; margin-bottom:10px;">${ohlcM1.length}/${WARMUP_CANDLES} candles</div>
            <div style="background:#1e293b; border-radius:8px; height:20px; overflow:hidden;">
              <div style="background:#3b82f6; height:100%; width:${progress}%; transition:width 0.3s;"></div>
            </div>
            <div style="font-size:11px; opacity:0.7; margin-top:8px;">Collecting market data...</div>
          </div>
        `;
      }
      return;
    }

    // Update signal display
    if (signals.length === 0) {
      if (UI.signals) {
        // Check if timing window is active
        if (window.SignalTimingController && window.SignalTimingController.isActive()) {
          const elapsed = window.SignalTimingController.getElapsedTime();
          const remaining = window.SignalTimingController.getRemainingTime();
          const elapsedSec = Math.floor(elapsed / 1000);
          const remainingSec = Math.floor(remaining / 1000);
          const pending = window.SignalTimingController.getPendingSignal();
          
          // If the window has run out of time (or nearly), reset to avoid UI hang and immediately restart analysis
          if (remainingSec <= 1 || elapsedSec >= 299) {
            window.SignalTimingController.stopTimingWindow();
            pendingSignalData = null;
            signalLocked = false;
            UI.signals.innerHTML = `
              <div style="padding:20px; text-align:center; opacity:0.7;">
                <div style="font-size:14px;">🤖 AI Learning</div>
                <div style="font-size:11px; margin-top:6px;">Timing window reset; re-analyzing...</div>
              </div>
            `;
            setTimeout(() => {
              if (!signalLocked && !pendingSignalData) {
                prepareSignalForTiming();
              }
            }, 500);
            return;
          }
          
          if (pending) {
            const actionColor = pending.action === 'BUY' ? '#10b981' : '#ef4444';
            UI.signals.innerHTML = `
              <div style="padding:20px; text-align:center;">
                <div style="font-size:14px; color:#f59e0b; margin-bottom:8px;">🤖 AI Window Active</div>
                <div style="font-size:12px; color:${actionColor}; font-weight:600; margin-bottom:8px;">${pending.action} - ${pending.groupName}</div>
                <div style="font-size:11px; opacity:0.7; margin-bottom:12px;">Analyzing live entry; signals stay live without countdown.</div>
              </div>
            `;
            return;
          }
        }
        
        UI.signals.innerHTML = `
          <div style="padding:20px; text-align:center; opacity:0.7;">
            <div style="font-size:14px;">🤖 AI Learning</div>
            <div style="font-size:11px; margin-top:6px;">Waiting for next timing window...</div>
          </div>
        `;
      }
      return;
    }

    const sig = signals[0];
    const actionColor = sig.action === 'BUY' ? '#10b981' : '#ef4444';
    const bgColor = sig.action === 'BUY' ? '#064e3b' : '#7f1d1d';

    if (UI.signals) {
      UI.signals.innerHTML = `
        <div style="background:${bgColor}; padding:14px; border-radius:10px; border:2px solid ${actionColor};">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-size:24px; font-weight:800; color:${actionColor};">${sig.action}</div>
            <div style="text-align:right;">
              <div style="font-size:20px; font-weight:700; color:#60a5fa;">${sig.minutes} MIN</div>
              <div style="font-size:10px; opacity:0.7;">Expiry</div>
            </div>
          </div>
          
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
            <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
              <div style="font-size:9px; opacity:0.7; margin-bottom:3px;">Confidence</div>
              <div style="font-size:18px; font-weight:700; color:#3b82f6;">${sig.confidence}%</div>
            </div>
            <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
              <div style="font-size:9px; opacity:0.7; margin-bottom:3px;">Group</div>
              <div style="font-size:12px; font-weight:600; color:#60a5fa;">${sig.groupName}</div>
            </div>
          </div>
          
          <div style="font-size:10px; opacity:0.8; margin-bottom:8px; padding:8px; background:rgba(0,0,0,0.2); border-radius:6px;">
            ${sig.reasons.slice(0, 3).map(r => `<div style="margin-bottom:3px;">✓ ${r}</div>`).join('')}
          </div>
          
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <div style="flex:1; height:8px; border-radius:6px; background:linear-gradient(90deg, #ef4444 0%, #f59e0b 40%, #22c55e 100%); position:relative; overflow:hidden;">
              <div style="position:absolute; top:0; bottom:0; left:0; width:${sig.confidence}%; background:rgba(15,23,42,0.4);"></div>
            </div>
            <div style="font-size:10px; opacity:0.8;">Vol: ${sig.risk && sig.risk.ratio ? (sig.risk.ratio * 100).toFixed(2) + '%' : 'n/a'}</div>
          </div>
          
          <div style="font-size:10px; opacity:0.7; margin-bottom:8px;">
            Pattern: ${(sig.patterns && sig.patterns.patterns && sig.patterns.patterns.length ? sig.patterns.patterns.join(', ') : 'None')}
          </div>
          
          <div style="margin-top:10px; padding:6px 8px; background:rgba(0,0,0,0.25); border-radius:6px; font-size:10px; font-family:monospace;">
            Entry: ${sig.price.toFixed(5)}
          </div>
        </div>
      `;
    }
  }

  // Make panel draggable
  function makeDraggable(panel, header) {
    let isDragging = false;
    let currentX, currentY, initialX, initialY;
    
    const savedPos = localStorage.getItem('PS_PANEL_POS');
    if (savedPos) {
      try {
        const pos = JSON.parse(savedPos);
        panel.style.left = pos.x + 'px';
        panel.style.top = pos.y + 'px';
        panel.style.right = 'auto';
      } catch(e) {}
    }
    
    header.style.cursor = 'move';
    header.style.userSelect = 'none';
    
    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    
    function dragStart(e) {
      initialX = e.clientX - (parseInt(panel.style.left) || panel.offsetLeft);
      initialY = e.clientY - (parseInt(panel.style.top) || panel.offsetTop);
      
      if (e.target === header || header.contains(e.target)) {
        isDragging = true;
        panel.style.right = 'auto';
      }
    }
    
    function drag(e) {
      if (!isDragging) return;
      
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      
      currentX = Math.max(0, Math.min(currentX, maxX));
      currentY = Math.max(0, Math.min(currentY, maxY));
      
      panel.style.left = currentX + 'px';
      panel.style.top = currentY + 'px';
    }
    
    function dragEnd() {
      if (isDragging) {
        isDragging = false;
        
        try {
          localStorage.setItem('PS_PANEL_POS', JSON.stringify({
            x: parseInt(panel.style.left),
            y: parseInt(panel.style.top)
          }));
        } catch(e) {}
      }
    }
  }

  // Inject panel
  function injectPanel() {
    const panel = document.createElement('div');
    panel.id = 'ps-time-panel';
    
    panel.style.cssText = `
      position:fixed; top:60px; right:12px; z-index:999999;
      width:360px; background:#0f172a; border-radius:12px;
      box-shadow:0 8px 32px rgba(0,0,0,0.6);
      font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color:#e2e8f0; font-size:13px; padding:16px; border:1px solid #1e293b;
    `;

    panel.innerHTML = `
      <div id="ps-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:12px; border-bottom:2px solid #3b82f6;">
        <div style="display:flex; align-items:center; gap:8px;">
          <div style="font-weight:700; font-size:18px; color:#60a5fa;">Pocket Scout Dynamic Time</div>
          <div style="font-size:10px; background:#ef4444; color:#fff; padding:2px 6px; border-radius:4px; font-weight:600;">v${VERSION}</div>
        </div>
      </div>
      
      <div id="ps-status" style="padding:10px; background:#1e293b; border-radius:8px; margin-bottom:12px; font-size:12px; border:1px solid #334155;"></div>
      
      <div style="margin-bottom:12px;">
        <div style="font-size:11px; font-weight:600; color:#60a5fa; margin-bottom:8px;">🎯 SIGNAL</div>
        <div id="ps-signals"></div>
      </div>
      
      <div style="font-size:9px; opacity:0.5; text-align:center; margin-top:12px; padding-top:12px; border-top:1px solid #334155;">
        AI Mode: RL Agent | Dynamic Timing: 1-5 min
      </div>
    `;
    
    document.body.appendChild(panel);
    
    const header = document.getElementById('ps-header');
    makeDraggable(panel, header);
    
    UI.panel = panel;
    UI.status = document.getElementById('ps-status');
    UI.signals = document.getElementById('ps-signals');
  }

  // Verify signal outcome (called by Auto Trader or manually)
  function verifySignal(outcome) {
    if (!lastSignal) {
      console.warn(`[Pocket Scout Dynamic Time] ⚠️ Cannot verify: no active signal`);
      return;
    }
    
    if (!window.RLIntegration) {
      console.warn(`[Pocket Scout Dynamic Time] ⚠️ Cannot verify: RL Integration not available`);
      return;
    }
    
    const result = outcome === 'WIN' ? 'WIN' : outcome === 'LOSS' ? 'LOSS' : null;
    if (!result) {
      console.warn(`[Pocket Scout Dynamic Time] ⚠️ Invalid outcome: ${outcome}`);
      return;
    }
    
    const signalToVerify = lastSignal;
    console.log(`[Pocket Scout Dynamic Time] ✅ Verifying signal: ${signalToVerify.action} | ${signalToVerify.groupName} | Conf: ${signalToVerify.confidence}% | Outcome: ${result}`);
    
    // Learn from experience (DQN training)
    // Use stored RL state and action from signal (protected from overwriting during timing window)
    if (window.RLIntegration.onSignalVerified) {
      // If signal has stored RL state/action, use those; otherwise use current (fallback)
      const learningState = signalToVerify._rlState || null;
      const learningAction = signalToVerify._rlAction !== null && signalToVerify._rlAction !== undefined ? 
                            signalToVerify._rlAction : null;
      
      if (learningState && learningAction !== null) {
        // Temporarily restore state/action for learning
        if (window.RLIntegration.setLearningState) {
          window.RLIntegration.setLearningState(learningState, learningAction);
        }
      }
      
      window.RLIntegration.onSignalVerified(
        result, 
        signalToVerify.confidence, 
        ohlcM1, 
        lastRegime
      );
    }
    
    const reward = window.RLIntegration.calculateReward(result, signalToVerify.confidence);
    
    // Get metrics before saving
    const metricsBefore = window.RLIntegration.getMetrics ? window.RLIntegration.getMetrics() : null;
    
    console.log(`[Pocket Scout Dynamic Time] 📊 Signal verified: ${result} | Reward: ${reward.toFixed(2)} | Learning from experience`);
    
    if (metricsBefore) {
      console.log(`[Pocket Scout Dynamic Time] 📈 Metrics: Win Rate: ${metricsBefore.winRate.toFixed(1)}% | Wins: ${metricsBefore.sessionWins} | Losses: ${metricsBefore.sessionLosses} | Streak: ${metricsBefore.currentStreak}`);
    }
    
    // Save RL state periodically (every 10 experiences)
    if (window.RLIntegration.saveState && window.RLIntegration.getMetrics) {
      const metrics = window.RLIntegration.getMetrics();
      if (metrics.totalExperiences % 10 === 0) {
        window.RLIntegration.saveState();
        console.log(`[Pocket Scout Dynamic Time] 💾 RL state saved (${metrics.totalExperiences} experiences)`);
      }
    }
    
    // Clear auto-unlock timeout if it exists
    if (signalUnlockTimeout) {
      clearTimeout(signalUnlockTimeout);
      signalUnlockTimeout = null;
    }
    
    // Clear verification timeouts
    if (signalToVerify.timestamp) {
      const signalId = signalToVerify.timestamp;
      if (signalVerificationTimeouts.has(signalId)) {
        clearTimeout(signalVerificationTimeouts.get(signalId));
        signalVerificationTimeouts.delete(signalId);
      }
    }
    
    // Unlock signal generation and start new timing window
    signalLocked = false;
    lastSignal = null;
    
    // Start new timing window after verification
    console.log(`[Pocket Scout Dynamic Time] 🔄 Starting new timing window after verification`);
    setTimeout(() => {
      prepareSignalForTiming();
    }, 2000); // Small delay to ensure state is clean
  }

  // Message handler for popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_METRICS') {
      if (window.RLIntegration && window.RLIntegration.getMetrics) {
        const metrics = window.RLIntegration.getMetrics();
        sendResponse({ 
          metrics,
          regime: lastRegime,
          risk: getRiskSummary(),
          patterns: getPatternSummary(),
          lastSignal
        });
      } else {
        sendResponse({ metrics: null });
      }
      return true;
    }
    
    if (message.type === 'VERIFY_SIGNAL') {
      verifySignal(message.outcome);
      sendResponse({ success: true });
      return true;
    }
    
    return false;
  });

  // Update timing status in UI
  function updateTimingStatus() {
    if (!window.SignalTimingController || !window.SignalTimingController.isActive()) {
      return;
    }
    
    // Trigger UI update
    updateUI([]);
  }

  // Start processing
  async function start() {
    console.log(`[Pocket Scout Dynamic Time v${VERSION}] Starting...`);
    
    // Wait for dependencies
    const requiredDeps = [
      'CircularBuffer',
      'TechnicalIndicators',
      'MarketRegimeDetector',
      'IndicatorGroups',
      'DQNNetwork',
      'ExperienceReplay',
      'RLIntegration',
      'SignalTimingController'
    ];
    
    const checkDeps = setInterval(() => {
      const missing = requiredDeps.filter(d => !window[d]);
      
      if (missing.length === 0) {
        clearInterval(checkDeps);
        
        // Initialize RL Integration
        if (window.RLIntegration) {
          window.RLIntegration.initialize().then(() => {
            console.log('[Pocket Scout Dynamic Time] RL Integration initialized');
          }).catch(err => {
            console.error('[Pocket Scout Dynamic Time] RL Integration failed:', err);
          });
        }
        
        // Inject panel
        injectPanel();
        
        // Set up timing controller callback
        if (window.SignalTimingController) {
          window.SignalTimingController.setTimingCallback((event, signal) => {
            if (event === 'EXPIRED') {
              monitorTimingWindow(); // Will handle expiration logic
            }
          });
        }
        
        console.log(`[Pocket Scout Dynamic Time] All dependencies loaded`);
        
        // Start tick processing
        setInterval(() => {
          const price = readPriceFromDom();
          if (price) {
            pushTick(Date.now(), price);
          }
        }, 1000);
        
        // Start timing window monitoring
        // More frequent checks when timing window is active (every 5s), less frequent otherwise (every 30s)
        timingMonitorInterval = setInterval(() => {
          if (!warmupComplete) return;
          
          if (pendingSignalData) {
            // Monitor active timing window more frequently
            monitorTimingWindow();
          } else if (!signalLocked) {
            // No active signal, prepare new one (less frequent check)
            prepareSignalForTiming();
          }
        }, 5000); // Check every 5 seconds for responsiveness
        
        // Initial signal preparation after warmup (with delay)
        setTimeout(() => {
          if (warmupComplete && !signalLocked && !pendingSignalData) {
            prepareSignalForTiming();
          }
        }, 5000);
      } else {
        console.log(`[Pocket Scout Dynamic Time] Waiting for: ${missing.join(', ')}`);
      }
    }, 200);
  }

  start();

})();

console.log('[Pocket Scout Dynamic Time] Content script loaded');
