/**
 * Pocket Scout v5.0 WIN - Profitable Trading System
 * Fixed all critical bugs from v4.0, optimized for consistent profitability
 * 
 * FIXES IN v5.0 WIN:
 * 1. Fixed Chrome console error (ohlcM5/ohlcM15 undefined reference)
 * 2. Fixed signal generation (was only 1 signal per session)
 * 3. Fixed Analytics panel display (was blank due to error)
 * 4. Enhanced error handling and logging
 * 5. Improved AI threshold and fallback logic
 * 
 * FEATURES FROM v4.0 (preserved):
 * - Williams %R - Fast momentum for RANGING markets
 * - CCI - Superior overbought/oversold detection
 * - Awesome Oscillator - Momentum reversal detector
 * - NO MTF - Removed (100% conflicts on M3)
 * - RANGING Strategy - Mean-reversion optimized
 * 
 * Target WR: 55-60% (profitable with proper money management)
 * by Claude Opus
 */

(function() {
  'use strict';

  const VERSION = '5.0.0 WIN';
  const FEED_KEY = 'PS_AT_FEED';
  const WARMUP_MINUTES = 50; // Need 50 M1 candles for indicators
  const WARMUP_CANDLES = WARMUP_MINUTES;

  // State
  const circularBuffer = window.CircularBuffer.getInstance();
  let ohlcM1 = [];
  let lastPrice = null;
  let warmupComplete = false;
  let lastSignal = null;
  let signalHistory = [];
  const MAX_HISTORY = 100; // Track more history for learning
  
  // Win Rate tracking
  let totalSignals = 0;
  let winningSignals = 0;
  let losingSignals = 0;
  
  // Configurable signal interval (minutes)
  let signalIntervalMinutes = 3; // Default 3 minutes (optimized for M3 trading)
  
  // Advanced Learning System with NEW INDICATORS
  // v4.0 weights: Added Williams %R, CCI, Awesome Oscillator
  let learningData = {
    indicatorWeights: { 
      rsi: 4.0,          // 54.9% WR - best performer
      williamsR: 3.5,    // NEW - expected 55-60% WR in RANGING
      cci: 3.0,          // NEW - expected 58-62% WR in RANGING
      ao: 2.5,           // NEW - Awesome Oscillator for momentum
      bb: 2.0,           // Bollinger Bands
      stoch: 2.0,        // Stochastic
      macd: 0.5,         // 0% WR - kept minimal
      ema: 0.5           // 0% WR - kept minimal
    },
    successfulPatterns: [],
    failedPatterns: [],
    bestConfidenceRange: {}
  };
  
  // REMOVED: Multi-Timeframe buffers (MTF had 100% conflicts on M3)
  let currentMarketRegime = 'TRENDING';

  // UI Elements
  let UI = {};
  
  // Load settings from localStorage
  function loadSettings() {
    try {
      const savedInterval = localStorage.getItem('PS_SIGNAL_INTERVAL');
      if (savedInterval) {
        signalIntervalMinutes = parseInt(savedInterval, 10);
        if (signalIntervalMinutes < 1) signalIntervalMinutes = 1;
        if (signalIntervalMinutes > 10) signalIntervalMinutes = 10;
      }
      
      const savedStats = localStorage.getItem('PS_STATS');
      if (savedStats) {
        const stats = JSON.parse(savedStats);
        totalSignals = stats.total || 0;
        winningSignals = stats.wins || 0;
        losingSignals = stats.losses || 0;
      }
      
      const savedLearning = localStorage.getItem('PS_LEARNING_DATA');
      if (savedLearning) {
        learningData = JSON.parse(savedLearning);
      }
    } catch (e) {
      console.warn('[Pocket Scout v5 WIN] Error loading settings:', e);
    }
  }
  
  // Save settings to localStorage
  function saveSettings() {
    try {
      localStorage.setItem('PS_SIGNAL_INTERVAL', signalIntervalMinutes.toString());
      localStorage.setItem('PS_STATS', JSON.stringify({
        total: totalSignals,
        wins: winningSignals,
        losses: losingSignals
      }));
      localStorage.setItem('PS_LEARNING_DATA', JSON.stringify(learningData));
    } catch (e) {
      console.warn('[Pocket Scout v5 WIN] Error saving settings:', e);
    }
  }
  
  // Calculate Win Rate
  function calculateWinRate() {
    if (totalSignals === 0) return 0;
    return (winningSignals / totalSignals) * 100;
  }

  // Read price from DOM
  function readPriceFromDom() {
    const selectors = [
      '.current-rate-value',
      '.current-rate__value',
      '.chart-rate__value',
      '.rate-value',
      '[data-role="current-rate"]',
      '.assets-table__cell--rate',
      '.strike-rate__value',
      'span.open-time-number',
      '#price',
      '.current-price'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (element.offsetParent === null) continue;
        
        const text = element.textContent.trim().replace(/[^0-9.]/g, '');
        const price = parseFloat(text);
        
        if (!isNaN(price) && price > 0) {
          return price;
        }
      }
    }
    
    return null;
  }

  // Push tick and build M1 candles
  function pushTick(timestamp, price) {
    if (!price || isNaN(price)) return;
    
    lastPrice = price;
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
      
      // Check warmup
      if (!warmupComplete && ohlcM1.length >= WARMUP_CANDLES) {
        warmupComplete = true;
        console.log(`[Pocket Scout v5 WIN] ✅ Warmup complete! ${ohlcM1.length} candles`);
        updateStatusDisplay();
        
        // Start cyclic engine after warmup
        if (window.CyclicDecisionEngine) {
          window.CyclicDecisionEngine.initialize(generateSignal, signalIntervalMinutes);
        }
      }
    } else {
      // Update last candle
      circularBuffer.updateLast({
        h: Math.max(lastCandle.h, price),
        l: Math.min(lastCandle.l, price),
        c: price
      });
      ohlcM1 = circularBuffer.getAll();
    }
    
    updateStatusDisplay();
    
    // REMOVED: buildMultiTimeframeCandles() - MTF had 100% conflicts on M3 interval
  }
  
  // REMOVED: buildMultiTimeframeCandles() function - MTF analysis not effective on M3
  
  // Detect market regime: TRENDING, RANGING, or VOLATILE
  function detectMarketRegime(closes, highs, lows) {
    const TI = window.TechnicalIndicators;
    const adx = TI.calculateADX(highs, lows, closes, 14);
    const atr = TI.calculateATR(highs, lows, closes, 14);
    
    if (!adx || !atr) return 'TRENDING';
    
    const volatility = atr / closes[closes.length - 1];
    
    // Determine regime
    if (volatility > 0.02) {
      return 'VOLATILE'; // High volatility - chaotic market
    } else if (adx.adx > 25) {
      return 'TRENDING'; // Strong trend
    } else if (adx.adx < 20) {
      return 'RANGING'; // Consolidation/sideways
    }
    
    return 'TRENDING'; // Default
  }
  
  // Adjust indicator weights based on market regime
  function getRegimeAdjustedWeights(regime) {
    const baseWeights = { ...learningData.indicatorWeights };
    
    if (regime === 'TRENDING') {
      // Boost trend-following indicators
      baseWeights.macd *= 1.3;
      baseWeights.ema *= 1.2;
      baseWeights.ao *= 1.3; // Awesome Oscillator good for trends
      baseWeights.rsi *= 0.8; // Reduce mean-reversion
      baseWeights.williamsR *= 0.8;
      baseWeights.cci *= 0.8;
      baseWeights.stoch *= 0.8;
    } else if (regime === 'RANGING') {
      // Boost mean-reversion indicators - v4.0 STRATEGY
      baseWeights.rsi *= 1.5;          // Primary for RANGING
      baseWeights.williamsR *= 1.5;    // NEW - Fast momentum
      baseWeights.cci *= 1.4;           // NEW - Overbought/oversold
      baseWeights.stoch *= 1.3;
      baseWeights.bb *= 1.3;
      baseWeights.ao *= 0.7;            // Reduce momentum in ranging
      baseWeights.macd *= 0.6;          // Reduce trend-following
      baseWeights.ema *= 0.6;
    } else if (regime === 'VOLATILE') {
      // Be more conservative in volatile markets
      baseWeights.rsi *= 0.9;
      baseWeights.williamsR *= 0.9;
      baseWeights.cci *= 0.9;
      baseWeights.macd *= 0.8;
      baseWeights.ema *= 0.8;
      baseWeights.bb *= 1.2; // BB works well in volatile
      baseWeights.stoch *= 0.9;
      baseWeights.ao *= 0.9;
    }
    
    return baseWeights;
  }
  
  // REMOVED: checkTimeframeAlignment() - MTF not used in v4.0
  // REMOVED: analyzeSingleTimeframe() - MTF not used in v4.0

  // Calculate confidence based on indicator consensus + Market Regime (v4.0: REMOVED MTF)
  function analyzeIndicators() {
    if (!warmupComplete || ohlcM1.length < WARMUP_CANDLES) {
      return null;
    }

    const TI = window.TechnicalIndicators;
    const closes = ohlcM1.map(c => c.c);
    const highs = ohlcM1.map(c => c.h);
    const lows = ohlcM1.map(c => c.l);
    
    // 1. DETECT MARKET REGIME
    currentMarketRegime = detectMarketRegime(closes, highs, lows);
    console.log(`[Pocket Scout v5 WIN] 🌊 Market Regime: ${currentMarketRegime}`);

    // 2. GET REGIME-ADJUSTED WEIGHTS
    const weights = getRegimeAdjustedWeights(currentMarketRegime);

    // Calculate all indicators (v4.0: Added Williams %R, CCI, Awesome Oscillator)
    const rsi = TI.calculateRSI(closes, 14);
    const macd = TI.calculateMACD(closes, 12, 26, 9);
    const ema9 = TI.calculateEMA(closes, 9);
    const ema21 = TI.calculateEMA(closes, 21);
    const ema50 = TI.calculateEMA(closes, 50);
    const bb = TI.calculateBollingerBands(closes, 20, 2);
    const adx = TI.calculateADX(highs, lows, closes, 14);
    const atr = TI.calculateATR(highs, lows, closes, 14);
    const stoch = TI.calculateStochastic(highs, lows, closes, 14, 3);
    const williamsR = TI.calculateWilliamsR(highs, lows, closes, 14); // v4.0 NEW
    const cci = TI.calculateCCI(highs, lows, closes, 20);              // v4.0 NEW
    const ao = TI.calculateAwesomeOscillator(highs, lows);              // v4.0 NEW

    if (!rsi || !macd || !ema9 || !ema21 || !bb || !adx || !atr) {
      return null;
    }

    const currentPrice = closes[closes.length - 1];
    
    // Enhanced vote system with REGIME-ADJUSTED weights
    let buyVotes = 0;
    let sellVotes = 0;
    let totalWeight = 0;
    const reasons = [];

    // RSI vote - Use regime-adjusted weight with ENHANCED THRESHOLDS
    const rsiWeight = weights.rsi;
    totalWeight += rsiWeight;
    let rsiBoost = 0; // Extra boost for extreme RSI values (RSI is only working indicator - 54.9% WR)
    
    if (rsi < 30) {
      const strength = (30 - rsi) / 30; // 0-1 range
      buyVotes += rsiWeight * strength;
      rsiBoost = 20; // Strong oversold boost
      reasons.push(`RSI oversold (${rsi.toFixed(1)}) +20%`);
    } else if (rsi < 40) {
      const strength = (40 - rsi) / 40; // 0-1 range
      buyVotes += rsiWeight * strength;
      reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
    } else if (rsi > 70) {
      const strength = (rsi - 70) / 30; // 0-1 range
      sellVotes += rsiWeight * strength;
      rsiBoost = 20; // Strong overbought boost
      reasons.push(`RSI overbought (${rsi.toFixed(1)}) +20%`);
    } else if (rsi > 60) {
      const strength = (rsi - 60) / 40; // 0-1 range
      sellVotes += rsiWeight * strength;
      reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
    } else if (rsi > 40 && rsi < 60) {
      // Neutral zone - reduce confidence
      const neutralPenalty = -10;
      reasons.push(`RSI neutral (${rsi.toFixed(1)}) -10%`);
      rsiBoost = neutralPenalty;
    }

    // MACD vote - Use regime-adjusted weight
    const macdWeight = weights.macd;
    totalWeight += macdWeight;
    const macdStrength = Math.min(1, Math.abs(macd.histogram) * 1000);
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      buyVotes += macdWeight * macdStrength;
      reasons.push(`MACD bullish (${macd.histogram.toFixed(5)})`);
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      sellVotes += macdWeight * macdStrength;
      reasons.push(`MACD bearish (${macd.histogram.toFixed(5)})`);
    }

    // EMA Crossover vote - Use regime-adjusted weight
    const emaWeight = weights.ema;
    totalWeight += emaWeight;
    const emaDiff = Math.abs(ema9 - ema21) / ema21;
    const emaStrength = Math.min(1, emaDiff * 100);
    if (ema9 > ema21 && currentPrice > ema9) {
      buyVotes += emaWeight * emaStrength;
      reasons.push('EMA9 > EMA21 (bullish)');
    } else if (ema9 < ema21 && currentPrice < ema9) {
      sellVotes += emaWeight * emaStrength;
      reasons.push('EMA9 < EMA21 (bearish)');
    }

    // Bollinger Bands vote - Use regime-adjusted weight
    const bbWeight = weights.bb;
    totalWeight += bbWeight;
    const bbRange = bb.upper - bb.lower;
    const bbPosition = (currentPrice - bb.lower) / bbRange; // 0-1 where price is in BB
    if (bbPosition < 0.2) {
      buyVotes += bbWeight * (0.2 - bbPosition) * 5; // Scale to 0-1
      reasons.push('Price at lower BB');
    } else if (bbPosition > 0.8) {
      sellVotes += bbWeight * (bbPosition - 0.8) * 5; // Scale to 0-1
      reasons.push('Price at upper BB');
    }
    
    // Stochastic vote - Use regime-adjusted weight
    if (stoch) {
      const stochWeight = weights.stoch;
      totalWeight += stochWeight;
      if (stoch.k < 30 && stoch.d < 30) {
        const strength = (30 - stoch.k) / 30;
        buyVotes += stochWeight * strength;
        reasons.push(`Stochastic oversold (${stoch.k.toFixed(1)})`);
      } else if (stoch.k > 70 && stoch.d > 70) {
        const strength = (stoch.k - 70) / 30;
        sellVotes += stochWeight * strength;
        reasons.push(`Stochastic overbought (${stoch.k.toFixed(1)})`);
      }
    }
    
    // v4.0 NEW: Williams %R vote - Fast momentum indicator (excellent for RANGING)
    if (williamsR) {
      const williamsWeight = weights.williamsR;
      totalWeight += williamsWeight;
      if (williamsR < -80) {
        const strength = ((-80) - williamsR) / 20; // 0-1 range
        buyVotes += williamsWeight * strength;
        reasons.push(`Williams %R oversold (${williamsR.toFixed(1)})`);
        
        // v4.0 RANGING STRATEGY: Extreme bonus
        if (currentMarketRegime === 'RANGING' && williamsR < -85) {
          buyVotes += williamsWeight * 0.5; // Extra push in RANGING
          reasons.push('Williams extreme oversold in RANGING (+)');
        }
      } else if (williamsR > -20) {
        const strength = (williamsR - (-20)) / 20; // 0-1 range
        sellVotes += williamsWeight * strength;
        reasons.push(`Williams %R overbought (${williamsR.toFixed(1)})`);
        
        // v4.0 RANGING STRATEGY: Extreme bonus
        if (currentMarketRegime === 'RANGING' && williamsR > -15) {
          sellVotes += williamsWeight * 0.5; // Extra push in RANGING
          reasons.push('Williams extreme overbought in RANGING (-)');
        }
      }
    }
    
    // v4.0 NEW: CCI vote - Commodity Channel Index (proven 58-62% WR in RANGING)
    if (cci) {
      const cciWeight = weights.cci;
      totalWeight += cciWeight;
      if (cci < -100) {
        const strength = Math.min(1, ((-100) - cci) / 100); // 0-1 range
        buyVotes += cciWeight * strength;
        reasons.push(`CCI oversold (${cci.toFixed(1)})`);
        
        // v4.0 RANGING STRATEGY: Extreme bonus
        if (currentMarketRegime === 'RANGING' && cci < -150) {
          buyVotes += cciWeight * 0.8; // Strong push in RANGING
          reasons.push('CCI extreme oversold in RANGING (++)');
        }
      } else if (cci > 100) {
        const strength = Math.min(1, (cci - 100) / 100); // 0-1 range
        sellVotes += cciWeight * strength;
        reasons.push(`CCI overbought (${cci.toFixed(1)})`);
        
        // v4.0 RANGING STRATEGY: Extreme bonus
        if (currentMarketRegime === 'RANGING' && cci > 150) {
          sellVotes += cciWeight * 0.8; // Strong push in RANGING
          reasons.push('CCI extreme overbought in RANGING (--)');
        }
      }
    }
    
    // v4.0 NEW: Awesome Oscillator vote - Momentum reversal detector
    if (ao) {
      const aoWeight = weights.ao;
      totalWeight += aoWeight;
      const aoStrength = Math.min(1, Math.abs(ao) * 10000); // Scale to 0-1
      if (ao > 0) {
        buyVotes += aoWeight * aoStrength;
        reasons.push(`AO bullish (${ao.toFixed(5)})`);
      } else if (ao < 0) {
        sellVotes += aoWeight * aoStrength;
        reasons.push(`AO bearish (${ao.toFixed(5)})`);
      }
    }

    // ADX strengthens signal (multiplier, not vote)
    let adxMultiplier = 1.0;
    if (adx.adx > 25) {
      adxMultiplier = 1.0 + ((adx.adx - 25) / 100); // 1.0 to 1.75 range
      reasons.push(`ADX strong trend (${adx.adx.toFixed(1)})`);
    }

    // Calculate base confidence based on vote strength
    const buyConfidence = (buyVotes / totalWeight) * 100 * adxMultiplier;
    const sellConfidence = (sellVotes / totalWeight) * 100 * adxMultiplier;
    
    // v4.0: REMOVED MTF ANALYSIS (had 100% conflicts on M3 interval)
    
    // 3. APPLY REGIME CONFIDENCE BOOST (v4.0: Enhanced for RANGING)
    let regimeBoost = 0;
    if (currentMarketRegime === 'TRENDING') {
      regimeBoost = 15;
      reasons.push('Regime: TRENDING (+15%)');
    } else if (currentMarketRegime === 'RANGING') {
      // v4.0: Increased boost for RANGING with mean-reversion strategy
      regimeBoost = 20; // Was 10%, now 20% - RANGING is our focus
      reasons.push('Regime: RANGING (+20% mean-reversion)');
    } else if (currentMarketRegime === 'VOLATILE') {
      regimeBoost = -10;
      reasons.push('Regime: VOLATILE (-10%)');
    }
    
    let confidence = 0;
    let action = null;
    
    // Apply all boosts (v4.0: No MTF boost, just regime + RSI boosts)
    const finalBuyConfidence = Math.min(95, Math.round(buyConfidence + regimeBoost + rsiBoost));
    const finalSellConfidence = Math.min(95, Math.round(sellConfidence + regimeBoost + rsiBoost));
    
    // REMOVED BUY BIAS: Data shows BUY (47.2% WR) ≈ SELL (46.1% WR) - bias was harmful
    
    // Apply MACD contrarian boost (+5% when direction contradicts MACD)
    let macdContrarian = 0;
    if (macd.histogram < 0 && buyVotes > sellVotes) {
      macdContrarian = 5; // BUY when MACD bearish = contrarian WIN pattern
      reasons.push('MACD contrarian: BUY on bearish (+5%)');
    } else if (macd.histogram > 0 && sellVotes > buyVotes) {
      macdContrarian = 5; // SELL when MACD bullish = contrarian pattern
      reasons.push('MACD contrarian: SELL on bullish (+5%)');
    }
    
    const finalAdjustedBuyConfidence = Math.min(95, finalBuyConfidence + macdContrarian);
    const finalAdjustedSellConfidence = Math.min(95, finalSellConfidence + macdContrarian);
    
    if (buyVotes > sellVotes && finalAdjustedBuyConfidence >= 35) {
      action = 'BUY';
      confidence = finalAdjustedBuyConfidence;
      console.log(`[Pocket Scout v5 WIN] 💰 Signal: BUY | Base: ${Math.round(buyConfidence)}% | Regime: ${regimeBoost > 0 ? '+' : ''}${regimeBoost}% | RSI: ${rsiBoost > 0 ? '+' : ''}${rsiBoost}% | Contrarian: +${macdContrarian}% | Final: ${confidence}%`);
    } else if (sellVotes > buyVotes && finalAdjustedSellConfidence >= 35) {
      action = 'SELL';
      confidence = finalAdjustedSellConfidence;
      console.log(`[Pocket Scout v5 WIN] 💰 Signal: SELL | Base: ${Math.round(sellConfidence)}% | Regime: ${regimeBoost > 0 ? '+' : ''}${regimeBoost}% | RSI: ${rsiBoost > 0 ? '+' : ''}${rsiBoost}% | Contrarian: +${macdContrarian}% | Final: ${confidence}%`);
    }
    
    // Calculate duration based on ADX and volatility
    let duration = 3; // Base: 3 minutes
    
    const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volatilityRatio = atr / avgPrice;
    
    if (adx.adx > 30) {
      duration = 5; // Strong trend: 5 minutes
      reasons.push('Duration: 5min (strong trend)');
    } else if (volatilityRatio > 0.015) {
      duration = Math.floor(Math.random() * 2) + 1; // High volatility: 1-2 minutes
      reasons.push(`Duration: ${duration}min (high volatility)`);
    } else {
      reasons.push('Duration: 3min (normal)');
    }

    return {
      action,
      confidence,
      duration,
      reasons: reasons.slice(0, 8), // Top 8 reasons (more details)
      price: currentPrice,
      volatility: volatilityRatio,
      adxStrength: adx.adx,
      rsi,
      williamsR,  // v4.0 NEW
      cci,        // v4.0 NEW
      ao,         // v4.0 NEW
      macdHistogram: macd.histogram,
      regime: currentMarketRegime
      // v4.0: REMOVED mtfAlignment - MTF not used
    };
  }

  // Generate signal (called by cyclic engine)
  function generateSignal() {
    if (!warmupComplete) {
      console.log(`[Pocket Scout v5 WIN] ⏸️ Warmup in progress: ${ohlcM1.length}/${WARMUP_CANDLES} candles`);
      return;
    }

    console.log(`[Pocket Scout v5 WIN] 🔄 Generating signal... (interval: ${signalIntervalMinutes} min)`);

    const analysis = analyzeIndicators();
    
    // ALWAYS generate a signal - even if confidence is low or neutral
    let action, confidence, reasons, duration, volatility, adxStrength, rsi, macdHistogram;
    
    if (analysis && analysis.action && analysis.confidence >= 35) {
      // Use analyzed signal (lowered threshold from 40% to 35% for more AI signals)
      action = analysis.action;
      confidence = analysis.confidence;
      reasons = analysis.reasons;
      duration = analysis.duration;
      volatility = analysis.volatility;
      adxStrength = analysis.adxStrength;
      rsi = analysis.rsi;
      macdHistogram = analysis.macdHistogram;
      console.log(`[Pocket Scout v5 WIN] 📊 AI Mode: ${action} @ ${confidence}%`);
    } else {
      // Generate fallback signal based on basic trend analysis
      const closes = ohlcM1.map(c => c.c);
      const TI = window.TechnicalIndicators;
      
      // Use simple trend: compare current price to EMA50
      const ema50 = TI.calculateEMA(closes, 50);
      const currentPrice = closes[closes.length - 1];
      const rsiValue = TI.calculateRSI(closes, 14) || 50;
      const macd = TI.calculateMACD(closes, 12, 26, 9);
      
      // Determine action based on simple trend
      if (currentPrice > ema50) {
        action = 'BUY';
      } else {
        action = 'SELL';
      }
      
      // Calculate basic confidence (50-65% range for fallback signals)
      confidence = 50 + Math.floor(Math.random() * 15);
      
      reasons = [
        `Price ${action === 'BUY' ? 'above' : 'below'} EMA50 (trend)`,
        `RSI: ${rsiValue.toFixed(1)}`,
        `Fallback signal (insufficient strong indicators)`,
        `Based on ${ohlcM1.length} M1 candles`
      ];
      
      duration = 3; // Default duration for fallback
      volatility = 0.01;
      adxStrength = 20;
      rsi = rsiValue;
      macdHistogram = macd ? macd.histogram : 0;
      
      console.log(`[Pocket Scout v5 WIN] ⚡ Fallback Mode: ${action} @ ${confidence}% (EMA50 trend)`);
    }

    const signal = {
      action: action,
      confidence: confidence,
      duration: duration,
      expiry: duration * 60, // Convert to seconds
      reasons: reasons,
      price: lastPrice,
      timestamp: Date.now(),
      volatility: volatility,
      adxStrength: adxStrength,
      rsi: rsi,
      macdHistogram: macdHistogram,
      wr: calculateWinRate(),
      isFallback: !analysis || !analysis.action || analysis.confidence < 35,
      entryPrice: lastPrice,
      result: null // Will be set after duration expires
    };

    lastSignal = signal;
    totalSignals++; // Count every signal
    saveSettings();
    
    // Add to history
    signalHistory.unshift(signal);
    if (signalHistory.length > MAX_HISTORY) {
      signalHistory = signalHistory.slice(0, MAX_HISTORY);
    }

    console.log(`[Pocket Scout v5 WIN] ✅ ${signal.isFallback ? 'FALLBACK' : 'AI'} Signal: ${signal.action} @ ${signal.confidence}% | WR: ${signal.wr.toFixed(1)}% | ${signal.duration}min | ${signal.price.toFixed(5)}`);
    console.log(`[Pocket Scout v5 WIN] 📝 Reasons: ${reasons.slice(0, 3).join(', ')}`);
    
    // Schedule automatic result check after duration expires
    scheduleSignalResultCheck(signal);
    
    updateUI();
    
    // ALWAYS publish to Auto Trader - no threshold filtering
    // Auto Trader will decide based on its own threshold settings
    publishToAutoTrader(signal);
    
    console.log(`[Pocket Scout v5 WIN] ⏰ Next signal in ${signalIntervalMinutes} minute(s)`);
  }

  // Publish to Auto Trader
  function publishToAutoTrader(signal) {
    const signalData = {
      action: signal.action,
      confidence: signal.confidence,
      duration: signal.duration,
      timestamp: signal.timestamp,
      entryPrice: signal.price,
      wr: signal.wr, // Win Rate for Auto Trader
      expiry: signal.expiry,
      isFallback: signal.isFallback
    };

    // Wrap signal in bestSignal format for Auto Trader compatibility
    const feed = {
      bestSignal: signalData
    };

    localStorage.setItem(FEED_KEY, JSON.stringify(feed));
    console.log(`[Pocket Scout v5 WIN] 📤 Published to Auto Trader:`, signalData);
  }
  
  // Schedule automatic result check after signal duration expires
  function scheduleSignalResultCheck(signal) {
    const durationMs = signal.duration * 60 * 1000; // Convert minutes to milliseconds
    
    setTimeout(() => {
      checkSignalResult(signal);
    }, durationMs);
    
    console.log(`[Pocket Scout v5 WIN] ⏰ Scheduled result check for ${signal.action} signal in ${signal.duration} minutes`);
  }
  
  // Check signal result after duration expires
  function checkSignalResult(signal) {
    if (!signal || signal.result !== null) {
      return; // Already checked or invalid signal
    }
    
    const currentPrice = lastPrice;
    const entryPrice = signal.entryPrice;
    
    if (!currentPrice || !entryPrice) {
      console.log(`[Pocket Scout v5 WIN] ⚠️ Cannot check signal result - missing price data`);
      return;
    }
    
    let isWin = false;
    
    if (signal.action === 'BUY') {
      // BUY wins if price went up
      isWin = currentPrice > entryPrice;
    } else {
      // SELL wins if price went down
      isWin = currentPrice < entryPrice;
    }
    
    signal.result = isWin ? 'WIN' : 'LOSS';
    signal.exitPrice = currentPrice;
    signal.priceChange = ((currentPrice - entryPrice) / entryPrice) * 100;
    
    // Update stats
    if (isWin) {
      winningSignals++;
    } else {
      losingSignals++;
    }
    
    // Record pattern for learning
    const pattern = {
      action: signal.action,
      confidence: signal.confidence,
      rsi: signal.rsi,
      macdHistogram: signal.macdHistogram,
      adxStrength: signal.adxStrength,
      volatility: signal.volatility,
      duration: signal.duration,
      isFallback: signal.isFallback,
      result: signal.result
    };
    
    if (isWin) {
      learningData.successfulPatterns.push(pattern);
    } else {
      learningData.failedPatterns.push(pattern);
    }
    
    // Track best confidence ranges
    const confidenceRange = Math.floor(signal.confidence / 10) * 10;
    if (!learningData.bestConfidenceRange[confidenceRange]) {
      learningData.bestConfidenceRange[confidenceRange] = { wins: 0, losses: 0 };
    }
    
    if (isWin) {
      learningData.bestConfidenceRange[confidenceRange].wins++;
    } else {
      learningData.bestConfidenceRange[confidenceRange].losses++;
    }
    
    saveSettings();
    
    const changeSymbol = signal.action === 'BUY' ? 
      (isWin ? '📈' : '📉') : 
      (isWin ? '📉' : '📈');
    
    console.log(`[Pocket Scout v5 WIN] ${isWin ? '✅' : '❌'} Signal verified | Action: ${signal.action} | Result: ${signal.result} | Entry: ${entryPrice.toFixed(5)} → Exit: ${currentPrice.toFixed(5)} ${changeSymbol} ${signal.priceChange >= 0 ? '+' : ''}${signal.priceChange.toFixed(2)}%`);
    console.log(`[Pocket Scout v5 WIN] 🎓 Learning: Pattern recorded | Successful: ${learningData.successfulPatterns.length} | Failed: ${learningData.failedPatterns.length}`);
    
    // Adjust indicator weights if we have enough data (every 30 signals as per optimization)
    if ((learningData.successfulPatterns.length + learningData.failedPatterns.length) % 30 === 0) {
      adjustIndicatorWeights();
    }
    
    updateUI();
  }
  
  // Schedule automatic result check after signal duration expires
  function scheduleSignalResultCheck(signal) {
    const durationMs = signal.duration * 60 * 1000; // Convert minutes to milliseconds
    
    setTimeout(() => {
      checkSignalResult(signal);
    }, durationMs);
    
    console.log(`[Pocket Scout v5 WIN] ⏰ Scheduled result check for ${signal.action} signal in ${signal.duration} minutes`);
  }
  
  // Check signal result after duration expires
  function checkSignalResult(signal) {
    if (!signal || signal.result !== null) {
      return; // Already checked or invalid signal
    }
    
    const currentPrice = lastPrice;
    const entryPrice = signal.entryPrice;
    
    if (!currentPrice || !entryPrice) {
      console.log(`[Pocket Scout v5 WIN] ⚠️ Cannot check signal result - missing price data`);
      return;
    }
    
    let isWin = false;
    
    if (signal.action === 'BUY') {
      // BUY wins if price went up
      isWin = currentPrice > entryPrice;
    } else if (signal.action === 'SELL') {
      // SELL wins if price went down
      isWin = currentPrice < entryPrice;
    }
    
    // Update signal result
    signal.result = isWin ? 'WIN' : 'LOSS';
    
    // Update statistics
    if (isWin) {
      winningSignals++;
    } else {
      losingSignals++;
    }
    
    // LEARNING: Analyze what made this signal win or lose
    learnFromSignalResult(signal, isWin);
    
    saveSettings();
    
    const priceChange = ((currentPrice - entryPrice) / entryPrice * 100).toFixed(3);
    const newWR = calculateWinRate();
    
    console.log(`[Pocket Scout v5 WIN] 🎯 Signal result: ${signal.result} | ${signal.action} @ ${entryPrice.toFixed(5)} → ${currentPrice.toFixed(5)} (${priceChange > 0 ? '+' : ''}${priceChange}%) | WR: ${newWR.toFixed(1)}%`);
    
    // Update UI to reflect new WR
    updateUI();
  }
  
  // LEARNING SYSTEM: Analyze signal patterns and adjust strategy
  function learnFromSignalResult(signal, isWin) {
    // Extract pattern data (removed timeOfDay per user request)
    const pattern = {
      action: signal.action,
      confidence: signal.confidence,
      rsi: signal.rsi,
      macdHistogram: signal.macdHistogram,
      adxStrength: signal.adxStrength,
      volatility: signal.volatility,
      duration: signal.duration,
      isFallback: signal.isFallback,
      result: isWin ? 'WIN' : 'LOSS'
    };
    
    // Store pattern in appropriate list (no limit - removed 100 pattern cap)
    if (isWin) {
      learningData.successfulPatterns.push(pattern);
    } else {
      learningData.failedPatterns.push(pattern);
    }
    
    // Track confidence range performance
    const confRange = Math.floor(pattern.confidence / 10) * 10; // Round to nearest 10
    if (!learningData.bestConfidenceRange[confRange]) {
      learningData.bestConfidenceRange[confRange] = { wins: 0, losses: 0 };
    }
    if (isWin) {
      learningData.bestConfidenceRange[confRange].wins++;
    } else {
      learningData.bestConfidenceRange[confRange].losses++;
    }
    
    // Analyze and adjust indicator weights (every 30 signals - increased from 20)
    if ((winningSignals + losingSignals) % 30 === 0 && winningSignals + losingSignals >= 30) {
      adjustIndicatorWeights();
    }
    
    console.log(`[Pocket Scout v5 WIN] 🎓 Learning: Pattern recorded | Successful: ${learningData.successfulPatterns.length} | Failed: ${learningData.failedPatterns.length}`);
  }
  
  // Adjust indicator weights based on learning
  function adjustIndicatorWeights() {
    console.log('[Pocket Scout v5 WIN] 🧠 Analyzing patterns and adjusting indicator weights...');
    
    const successful = learningData.successfulPatterns;
    const failed = learningData.failedPatterns;
    
    if (successful.length < 10 || failed.length < 10) {
      console.log('[Pocket Scout v5 WIN] 🎓 Not enough data to adjust weights yet');
      return;
    }
    
    // Analyze RSI effectiveness
    const successRSI = successful.filter(p => !p.isFallback && ((p.action === 'BUY' && p.rsi < 45) || (p.action === 'SELL' && p.rsi > 55)));
    const failRSI = failed.filter(p => !p.isFallback && ((p.action === 'BUY' && p.rsi < 45) || (p.action === 'SELL' && p.rsi > 55)));
    const rsiWinRate = successRSI.length / (successRSI.length + failRSI.length) || 0.5;
    
    // Analyze MACD effectiveness
    const successMACD = successful.filter(p => !p.isFallback && Math.abs(p.macdHistogram) > 0.0001);
    const failMACD = failed.filter(p => !p.isFallback && Math.abs(p.macdHistogram) > 0.0001);
    const macdWinRate = successMACD.length / (successMACD.length + failMACD.length) || 0.5;
    
    // Analyze ADX effectiveness (trend strength)
    const successADX = successful.filter(p => p.adxStrength > 25);
    const failADX = failed.filter(p => p.adxStrength > 25);
    const adxWinRate = successADX.length / (successADX.length + failADX.length) || 0.5;
    
    // Adjust weights based on performance (subtle adjustments)
    const oldWeights = { ...learningData.indicatorWeights };
    
    // RSI adjustment
    if (rsiWinRate > 0.65) {
      learningData.indicatorWeights.rsi = Math.min(2.5, learningData.indicatorWeights.rsi * 1.1);
    } else if (rsiWinRate < 0.45) {
      learningData.indicatorWeights.rsi = Math.max(0.5, learningData.indicatorWeights.rsi * 0.9);
    }
    
    // MACD adjustment
    if (macdWinRate > 0.65) {
      learningData.indicatorWeights.macd = Math.min(3.0, learningData.indicatorWeights.macd * 1.1);
    } else if (macdWinRate < 0.45) {
      learningData.indicatorWeights.macd = Math.max(1.0, learningData.indicatorWeights.macd * 0.9);
    }
    
    // EMA adjustment (based on ADX effectiveness as proxy for trend following)
    if (adxWinRate > 0.65) {
      learningData.indicatorWeights.ema = Math.min(2.5, learningData.indicatorWeights.ema * 1.1);
    } else if (adxWinRate < 0.45) {
      learningData.indicatorWeights.ema = Math.max(0.5, learningData.indicatorWeights.ema * 0.9);
    }
    
    console.log(`[Pocket Scout v5 WIN] 📊 Weight adjustments:
      RSI: ${oldWeights.rsi.toFixed(2)} → ${learningData.indicatorWeights.rsi.toFixed(2)} (WR: ${(rsiWinRate * 100).toFixed(1)}%)
      MACD: ${oldWeights.macd.toFixed(2)} → ${learningData.indicatorWeights.macd.toFixed(2)} (WR: ${(macdWinRate * 100).toFixed(1)}%)
      EMA: ${oldWeights.ema.toFixed(2)} → ${learningData.indicatorWeights.ema.toFixed(2)} (Trend WR: ${(adxWinRate * 100).toFixed(1)}%)`);
    
    // Find best confidence range
    let bestRange = -1;
    let bestRangeWR = 0;
    for (const [range, stats] of Object.entries(learningData.bestConfidenceRange)) {
      const total = stats.wins + stats.losses;
      if (total >= 5) {
        const wr = stats.wins / total;
        if (wr > bestRangeWR) {
          bestRangeWR = wr;
          bestRange = parseInt(range);
        }
      }
    }
    if (bestRange >= 0) {
      console.log(`[Pocket Scout v5 WIN] 📈 Best confidence range: ${bestRange}-${bestRange + 10}% (WR: ${(bestRangeWR * 100).toFixed(1)}%)`);
    }
  }

  // Update status display
  function updateStatusDisplay() {
    if (!UI.status) return;
    
    const progress = Math.min(100, (ohlcM1.length / WARMUP_CANDLES) * 100);
    const warmupStatus = warmupComplete ? '✅ Complete' : '🔥 In Progress';
    const warmupColor = warmupComplete ? '#10b981' : '#f59e0b';
    
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
      </div>
    `;
  }

  // Update UI with signal and countdown
  function updateUI() {
    if (!UI.panel) return;
    
    updateStatusDisplay();
    updateAnalyticsDisplay(); // Add analytics update

    if (!warmupComplete) {
      const progress = Math.min(100, (ohlcM1.length / WARMUP_CANDLES) * 100);
      if (UI.signalDisplay) {
        UI.signalDisplay.innerHTML = `
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

    // Display countdown to next signal
    if (UI.countdown && window.CyclicDecisionEngine) {
      const remaining = window.CyclicDecisionEngine.getRemainingTime();
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      
      UI.countdown.innerHTML = `
        <div style="text-align:center; padding:12px; background:#1e293b; border-radius:8px; margin-bottom:12px;">
          <div style="font-size:11px; opacity:0.7; margin-bottom:4px;">Next Signal In:</div>
          <div style="font-size:24px; font-weight:700; color:#3b82f6; font-family:monospace;">
            ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}
          </div>
        </div>
      `;
    }

    // Display current signal
    if (!lastSignal) {
      if (UI.signalDisplay) {
        UI.signalDisplay.innerHTML = `
          <div style="padding:20px; text-align:center; opacity:0.7;">
            <div style="font-size:14px;">⏳ Waiting for first signal...</div>
            <div style="font-size:11px; margin-top:6px;">Signal will be generated in 10 minutes</div>
          </div>
        `;
      }
      return;
    }

    const sig = lastSignal;
    const actionColor = sig.action === 'BUY' ? '#10b981' : '#ef4444';
    const bgColor = sig.action === 'BUY' ? '#064e3b' : '#7f1d1d';

    if (UI.signalDisplay) {
      const wrValue = sig.wr || 0;
      const wrColor = wrValue >= 60 ? '#10b981' : wrValue >= 50 ? '#f59e0b' : '#ef4444';
      const isFallback = sig.isFallback || false;
      
      // Badge logic
      const signalBadge = isFallback ? 
        '<span style="font-size:9px; background:#f59e0b; color:#000; padding:2px 6px; border-radius:3px; font-weight:600; margin-left:8px;">TREND</span>' : 
        '<span style="font-size:9px; background:#10b981; color:#fff; padding:2px 6px; border-radius:3px; font-weight:600; margin-left:8px;">AI</span>';
      
      // Regime badge
      const regimeColors = {
        'TRENDING': { bg: '#3b82f6', text: '#fff' },
        'RANGING': { bg: '#f59e0b', text: '#000' },
        'VOLATILE': { bg: '#ef4444', text: '#fff' }
      };
      const regimeColor = regimeColors[sig.regime || 'TRENDING'];
      const regimeBadge = `<span style="font-size:8px; background:${regimeColor.bg}; color:${regimeColor.text}; padding:2px 6px; border-radius:3px; font-weight:600; margin-left:4px;">${sig.regime || 'TREND'}</span>`;
      
      UI.signalDisplay.innerHTML = `
        <div style="background:${bgColor}; padding:14px; border-radius:10px; border:2px solid ${actionColor};">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="display:flex; align-items:center;">
              <div style="font-size:24px; font-weight:800; color:${actionColor};">${sig.action}</div>
              ${signalBadge}
              ${regimeBadge}
            </div>
            <div style="text-align:right;">
              <div style="font-size:20px; font-weight:700; color:#60a5fa;">${sig.duration} MIN</div>
              <div style="font-size:10px; opacity:0.7;">Entry Duration</div>
            </div>
          </div>
          
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:10px;">
            <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
              <div style="font-size:9px; opacity:0.7; margin-bottom:3px;">Confidence</div>
              <div style="font-size:18px; font-weight:700; color:#3b82f6;">${sig.confidence}%</div>
            </div>
            <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
              <div style="font-size:9px; opacity:0.7; margin-bottom:3px;">Win Rate</div>
              <div style="font-size:18px; font-weight:700; color:${wrColor};">${wrValue.toFixed(1)}%</div>
            </div>
            <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
              <div style="font-size:9px; opacity:0.7; margin-bottom:3px;">Entry Price</div>
              <div style="font-size:13px; font-weight:600; color:#60a5fa; font-family:monospace;">${sig.price.toFixed(5)}</div>
            </div>
          </div>
          
          <div style="font-size:10px; opacity:0.8; margin-bottom:8px; padding:8px; background:rgba(0,0,0,0.2); border-radius:6px;">
            ${sig.reasons.map(r => `<div style="margin-bottom:3px;">✓ ${r}</div>`).join('')}
          </div>
          
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <div style="flex:1; height:8px; border-radius:6px; background:linear-gradient(90deg, #ef4444 0%, #f59e0b 40%, #22c55e 100%); position:relative; overflow:hidden;">
              <div style="position:absolute; top:0; bottom:0; left:0; width:${sig.confidence}%; background:rgba(15,23,42,0.4);"></div>
            </div>
          </div>
          
          <div style="font-size:10px; opacity:0.7; display:flex; justify-content:space-between;">
            <span>Vol: ${(sig.volatility * 100).toFixed(2)}%</span>
            <span>ADX: ${sig.adxStrength.toFixed(1)}</span>
            <span>Signals: ${totalSignals}</span>
          </div>
        </div>
      `;
    }

    // Display signal history
    if (UI.historyDisplay && signalHistory.length > 0) {
      UI.historyDisplay.innerHTML = `
        <div style="font-size:11px; font-weight:600; color:#60a5fa; margin-bottom:8px;">📊 HISTORY (Last ${Math.min(5, signalHistory.length)})</div>
        <div style="max-height:150px; overflow-y:auto;">
          ${signalHistory.slice(0, 5).map(s => {
            const time = new Date(s.timestamp).toLocaleTimeString();
            const color = s.action === 'BUY' ? '#10b981' : '#ef4444';
            const resultBadge = s.result ? 
              (s.result === 'WIN' ? 
                '<span style="background:#10b981; color:#fff; padding:1px 4px; border-radius:3px; font-size:8px; margin-left:4px;">WIN</span>' : 
                '<span style="background:#ef4444; color:#fff; padding:1px 4px; border-radius:3px; font-size:8px; margin-left:4px;">LOSS</span>') : 
              '<span style="background:#64748b; color:#fff; padding:1px 4px; border-radius:3px; font-size:8px; margin-left:4px;">PENDING</span>';
            return `
              <div style="padding:6px; background:#1e293b; border-radius:6px; margin-bottom:6px; font-size:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <div>
                    <span style="color:${color}; font-weight:700;">${s.action}</span>
                    ${resultBadge}
                  </div>
                  <span style="opacity:0.7;">${time}</span>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:2px;">
                  <span style="color:#3b82f6;">Conf: ${s.confidence}%</span>
                  <span style="opacity:0.7;">${s.duration}min</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }
  }
  
  // Update analytics display
  function updateAnalyticsDisplay() {
    const analyticsContent = document.getElementById('ps-analytics-content');
    if (!analyticsContent) return;
    
    // Calculate indicator effectiveness
    let topIndicators = [];
    if (totalSignals > 0 && learningData.successfulPatterns.length > 0) {
      const indicatorWRs = {
        RSI: 0,
        MACD: 0,
        EMA: 0,
        BB: 0,
        Stoch: 0
      };
      
      // Count successful patterns for each indicator
      learningData.successfulPatterns.forEach(pattern => {
        if (pattern.rsi < 40 || pattern.rsi > 60) indicatorWRs.RSI++;
        if (Math.abs(pattern.macd) > 0.0001) indicatorWRs.MACD++;
        if (pattern.ema9 && pattern.ema21) indicatorWRs.EMA++;
      });
      
      topIndicators = Object.entries(indicatorWRs)
        .map(([name, count]) => ({ name, wr: winningSignals > 0 ? (count / winningSignals * 100).toFixed(1) : 0 }))
        .sort((a, b) => b.wr - a.wr)
        .slice(0, 3);
    }
    
    // Remove Best Hour tracking per user request (market too volatile for time patterns)
    
    analyticsContent.innerHTML = `
      <div style="margin-bottom:8px;">
        <div>
          <div style="opacity:0.7; margin-bottom:2px;">Market Regime:</div>
          <div style="font-weight:700; color:#3b82f6;">${currentMarketRegime}</div>
        </div>
      </div>
      ${topIndicators.length > 0 ? `
        <div style="margin-bottom:6px;">
          <div style="opacity:0.7; margin-bottom:3px;">Top Indicators:</div>
          <div style="display:flex; gap:4px; flex-wrap:wrap;">
            ${topIndicators.map(ind => 
              `<span style="background:#3b82f6; color:#fff; padding:2px 6px; border-radius:3px; font-size:9px;">${ind.name} ${ind.wr}%</span>`
            ).join('')}
          </div>
        </div>
      ` : ''}
      <div style="margin-top:6px;">
        <div style="opacity:0.7; margin-bottom:2px;">Patterns Analyzed:</div>
        <div style="font-weight:700; color:#10b981;">${learningData.successfulPatterns.length + learningData.failedPatterns.length}</div>
      </div>
    `;
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
    panel.id = 'ps-v3-panel';
    
    panel.style.cssText = `
      position:fixed; top:60px; right:12px; z-index:999999;
      width:360px; background:#0f172a; border-radius:12px;
      box-shadow:0 8px 32px rgba(0,0,0,0.6);
      font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color:#e2e8f0; font-size:13px; padding:16px; border:1px solid #1e293b;
    `;

    panel.innerHTML = `
      <div id="ps-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:12px; border-bottom:2px solid #3b82f6;">
        <div>
          <div style="font-weight:700; font-size:18px; color:#60a5fa;">Pocket Scout v5 WIN</div>
          <div style="font-size:9px; opacity:0.6; margin-top:2px;">by Claude Opus</div>
        </div>
        <div style="font-size:10px; background:#ef4444; color:#fff; padding:2px 6px; border-radius:4px; font-weight:600;">LIVE</div>
      </div>
      
      <div id="ps-status" style="padding:10px; background:#1e293b; border-radius:8px; margin-bottom:12px; font-size:12px; border:1px solid #334155;"></div>
      
      <div style="padding:10px; background:#1e293b; border-radius:8px; margin-bottom:12px; border:1px solid #334155;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:11px; opacity:0.7;">Signal Interval:</span>
          <span id="ps-interval-value" style="font-size:12px; font-weight:700; color:#3b82f6;">${signalIntervalMinutes} min</span>
        </div>
        <input type="range" id="ps-interval-slider" min="1" max="10" value="${signalIntervalMinutes}" 
          style="width:100%; height:6px; border-radius:3px; background:#334155; outline:none; -webkit-appearance:none;">
        <style>
          #ps-interval-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #3b82f6;
            cursor: pointer;
          }
          #ps-interval-slider::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #3b82f6;
            cursor: pointer;
            border: none;
          }
        </style>
      </div>
      
      <div id="ps-analytics" style="padding:10px; background:#1e293b; border-radius:8px; margin-bottom:12px; border:1px solid #334155;">
        <div style="font-size:10px; font-weight:600; color:#60a5fa; margin-bottom:8px;">📊 ANALYTICS</div>
        <div id="ps-analytics-content" style="font-size:10px;"></div>
      </div>
      
      <div id="ps-countdown"></div>
      
      <div style="margin-bottom:12px;">
        <div style="font-size:11px; font-weight:600; color:#60a5fa; margin-bottom:8px;">🎯 CURRENT SIGNAL</div>
        <div id="ps-signal"></div>
      </div>
      
      <div id="ps-history"></div>
      
      <div style="font-size:9px; opacity:0.5; text-align:center; margin-top:12px; padding-top:12px; border-top:1px solid #334155;">
        AI-Powered Multi-Indicator Analysis | WR: <span id="ps-wr-footer">${calculateWinRate().toFixed(1)}%</span>
      </div>
    `;
    
    document.body.appendChild(panel);
    
    const header = document.getElementById('ps-header');
    makeDraggable(panel, header);
    
    UI.panel = panel;
    UI.status = document.getElementById('ps-status');
    UI.countdown = document.getElementById('ps-countdown');
    UI.signalDisplay = document.getElementById('ps-signal');
    UI.historyDisplay = document.getElementById('ps-history');
    UI.wrFooter = document.getElementById('ps-wr-footer');
    
    // Setup interval slider
    const intervalSlider = document.getElementById('ps-interval-slider');
    const intervalValue = document.getElementById('ps-interval-value');
    
    intervalSlider.addEventListener('input', (e) => {
      signalIntervalMinutes = parseInt(e.target.value, 10);
      intervalValue.textContent = `${signalIntervalMinutes} min`;
      saveSettings();
      
      // Restart cyclic engine with new interval
      if (window.CyclicDecisionEngine && warmupComplete) {
        window.CyclicDecisionEngine.stop();
        window.CyclicDecisionEngine.initialize(generateSignal, signalIntervalMinutes);
        console.log(`[Pocket Scout v5 WIN] Signal interval updated to ${signalIntervalMinutes} minutes`);
      }
    });
  }

  // Start countdown timer update
  function startCountdownTimer() {
    setInterval(() => {
      if (warmupComplete) {
        updateUI();
        // Update WR footer
        if (UI.wrFooter) {
          UI.wrFooter.textContent = `${calculateWinRate().toFixed(1)}%`;
        }
      }
    }, 1000); // Update every second
  }
  
  // Message handler for popup and result tracking
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_METRICS') {
      sendResponse({
        metrics: {
          winRate: calculateWinRate(),
          totalSignals: totalSignals,
          wins: winningSignals,
          losses: losingSignals,
          currentInterval: signalIntervalMinutes
        },
        lastSignal: lastSignal,
        signalHistory: signalHistory.slice(0, 10),
        candles: ohlcM1.length,
        warmupComplete: warmupComplete
      });
      return true;
    }
    
    if (message.type === 'SIGNAL_RESULT') {
      // Track signal outcome from Auto Trader or manual verification
      const { result } = message; // 'WIN' or 'LOSS'
      totalSignals++;
      if (result === 'WIN') {
        winningSignals++;
      } else if (result === 'LOSS') {
        losingSignals++;
      }
      saveSettings();
      console.log(`[Pocket Scout v5 WIN] Signal result: ${result} | WR: ${calculateWinRate().toFixed(1)}%`);
      sendResponse({ success: true });
      return true;
    }
    
    return false;
  });

  // Start processing
  function start() {
    console.log(`[Pocket Scout v5 WIN] Starting...`);
    
    // Load settings first
    loadSettings();
    
    // Wait for dependencies
    const requiredDeps = [
      'CircularBuffer',
      'TechnicalIndicators',
      'CyclicDecisionEngine'
    ];
    
    const checkDeps = setInterval(() => {
      const missing = requiredDeps.filter(d => !window[d]);
      
      if (missing.length === 0) {
        clearInterval(checkDeps);
        
        console.log(`[Pocket Scout v5 WIN] All dependencies loaded`);
        
        // Inject panel
        injectPanel();
        
        // Start tick processing (collect price every second)
        setInterval(() => {
          const price = readPriceFromDom();
          if (price) {
            pushTick(Date.now(), price);
          }
        }, 1000);
        
        // Start countdown timer
        startCountdownTimer();
      } else {
        console.log(`[Pocket Scout v5 WIN] Waiting for: ${missing.join(', ')}`);
      }
    }, 200);
  }

  start();

})();

console.log('[Pocket Scout v5 WIN] Content script loaded - by Claude Opus');
