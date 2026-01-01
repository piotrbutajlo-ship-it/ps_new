/**
 * Pocket Scout Dynamic Time - Technical Indicators
 * Enhanced version with additional indicators for OTC trading
 */

window.TechnicalIndicators = (function() {
  'use strict';

  // Shared thresholds across modules (volatility, patterns, squeeze)
  const THRESHOLDS = window.PocketScoutThresholds = window.PocketScoutThresholds || {
    VOL_RISK_LOW: 0.002,
    VOL_RISK_ELEVATED: 0.012,
    VOL_RISK_EXTREME: 0.02,
    VOL_RISK_CAP: 0.025,
    BB_SQUEEZE_THRESHOLD: 0.02,
    PATTERN_SCORE_PER_MATCH: 0.25,
    PATTERN_WEIGHT: 0.6,
    BODY_WEIGHT: 0.4
  };
  const MIN_CANDLE_RANGE = 0.00001;

  function calculateSMA(data, period) {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((sum, val) => sum + val, 0) / period;
  }

  function calculateEMA(data, period) {
    if (data.length < period) return null;
    
    const multiplier = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((sum, val) => sum + val, 0) / period;
    
    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }
    
    return ema;
  }

  function calculateRSI(closes, period = 14) {
    if (closes.length < period + 1) return null;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (closes.length < slowPeriod + signalPeriod) return null;
    
    const fastEMA = calculateEMA(closes, fastPeriod);
    const slowEMA = calculateEMA(closes, slowPeriod);
    
    if (!fastEMA || !slowEMA) return null;
    
    const macdLine = fastEMA - slowEMA;
    
    const macdHistory = [];
    for (let i = slowPeriod; i < closes.length; i++) {
      const f = calculateEMA(closes.slice(0, i + 1), fastPeriod);
      const s = calculateEMA(closes.slice(0, i + 1), slowPeriod);
      if (f && s) macdHistory.push(f - s);
    }
    
    if (macdHistory.length < signalPeriod) return null;
    
    const signalLine = calculateEMA(macdHistory, signalPeriod);
    if (!signalLine) return null;
    
    const histogram = macdLine - signalLine;
    
    return { macd: macdLine, signal: signalLine, histogram };
  }

  function calculateBollingerBands(closes, period = 20, stdDev = 2) {
    if (closes.length < period) return null;
    
    const slice = closes.slice(-period);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    
    const squaredDiffs = slice.map(val => Math.pow(val - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(variance);
    
    const currentPrice = closes[closes.length - 1];
    const bandwidth = 2 * std * stdDev;
    const percentB = bandwidth > 0.0001 ? (currentPrice - (sma - std * stdDev)) / bandwidth : 0.5;
    
    return {
      upper: sma + (std * stdDev),
      middle: sma,
      lower: sma - (std * stdDev),
      percentB
    };
  }

  function calculateATR(highs, lows, closes, period = 14) {
    if (highs.length < period + 1) return null;
    
    const trs = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
    
    if (trs.length < period) return null;
    
    const atrSlice = trs.slice(-period);
    return atrSlice.reduce((a, b) => a + b, 0) / period;
  }

  function calculateStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
    if (highs.length < kPeriod + dPeriod) return null;
    
    const kValues = [];
    for (let i = kPeriod - 1; i < highs.length; i++) {
      const periodHighs = highs.slice(i - kPeriod + 1, i + 1);
      const periodLows = lows.slice(i - kPeriod + 1, i + 1);
      const highestHigh = Math.max(...periodHighs);
      const lowestLow = Math.min(...periodLows);
      const currentClose = closes[i];
      
      if (highestHigh === lowestLow) {
        kValues.push(50);
      } else {
        const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
        kValues.push(k);
      }
    }
    
    if (kValues.length < dPeriod) return null;
    
    // Calculate %K (fast stochastic)
    const k = kValues[kValues.length - 1];
    
    // Calculate %D (slow stochastic = SMA of %K)
    const dSlice = kValues.slice(-dPeriod);
    const d = dSlice.reduce((a, b) => a + b, 0) / dPeriod;
    
    return { k, d, kValues };
  }

  function calculateADX(highs, lows, closes, period = 14) {
    if (highs.length < period * 2) return null;
    
    // Calculate True Range
    const trs = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }
    
    // Calculate Directional Movement
    const plusDMs = [];
    const minusDMs = [];
    
    for (let i = 1; i < highs.length; i++) {
      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];
      
      if (upMove > downMove && upMove > 0) {
        plusDMs.push(upMove);
        minusDMs.push(0);
      } else if (downMove > upMove && downMove > 0) {
        plusDMs.push(0);
        minusDMs.push(downMove);
      } else {
        plusDMs.push(0);
        minusDMs.push(0);
      }
    }
    
    if (trs.length < period || plusDMs.length < period || minusDMs.length < period) return null;
    
    // Smooth the values (Wilder's smoothing)
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let plusDM = plusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let minusDM = minusDMs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < trs.length; i++) {
      atr = (atr * (period - 1) + trs[i]) / period;
      plusDM = (plusDM * (period - 1) + plusDMs[i]) / period;
      minusDM = (minusDM * (period - 1) + minusDMs[i]) / period;
    }
    
    // Calculate DI+ and DI-
    const plusDI = atr > 0 ? (plusDM / atr) * 100 : 0;
    const minusDI = atr > 0 ? (minusDM / atr) * 100 : 0;
    
    // Calculate DX
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    
    // ADX is smoothed DX (simplified - using current DX as approximation)
    // In full implementation, ADX would be smoothed over multiple periods
    const adx = dx;
    
    return { adx, plusDI, minusDI, dx };
  }

  function calculateCCI(highs, lows, closes, period = 20) {
    if (highs.length < period) return null;
    
    // Calculate Typical Price
    const typicalPrices = [];
    for (let i = 0; i < highs.length; i++) {
      typicalPrices.push((highs[i] + lows[i] + closes[i]) / 3);
    }
    
    if (typicalPrices.length < period) return null;
    
    // Calculate SMA of Typical Price
    const smaSlice = typicalPrices.slice(-period);
    const sma = smaSlice.reduce((a, b) => a + b, 0) / period;
    
    // Calculate Mean Deviation
    const meanDeviation = smaSlice.reduce((sum, tp) => sum + Math.abs(tp - sma), 0) / period;
    
    if (meanDeviation === 0) return 0;
    
    // Calculate CCI
    const currentTP = typicalPrices[typicalPrices.length - 1];
    const cci = (currentTP - sma) / (0.015 * meanDeviation);
    
    return cci;
  }

  function calculateWilliamsR(highs, lows, closes, period = 14) {
    if (highs.length < period) return null;
    
    const slice = highs.slice(-period);
    const highestHigh = Math.max(...slice);
    const lowestLow = Math.min(...lows.slice(-period));
    const currentClose = closes[closes.length - 1];
    
    if (highestHigh === lowestLow) return -50;
    
    const williamsR = ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100;
    
    return williamsR;
  }

  function calculateAwesomeOscillator(highs, lows) {
    // Awesome Oscillator = SMA(Median Price, 5) - SMA(Median Price, 34)
    // Median Price = (High + Low) / 2
    if (highs.length < 34 || lows.length < 34) return null;
    
    // Calculate median prices
    const medianPrices = [];
    for (let i = 0; i < highs.length; i++) {
      medianPrices.push((highs[i] + lows[i]) / 2);
    }
    
    const sma5 = calculateSMA(medianPrices, 5);
    const sma34 = calculateSMA(medianPrices, 34);
    
    if (!sma5 || !sma34) return null;
    
    return sma5 - sma34;
  }

  /**
   * Lightweight candlestick pattern detector (last 2-3 candles)
   * Returns detected pattern names, directional bias, and a confidence score (0-1)
   */
  function detectCandlestickPatterns(candles) {
    if (!candles || candles.length < 2) {
      return { patterns: [], bias: null, score: 0 };
    }

    const recent = candles.slice(-3);
    const last = recent[recent.length - 1];
    const prev = recent[recent.length - 2];

    const patterns = [];
    let biasScore = 0;
    let bias = null;

    function body(candle) {
      return Math.abs(candle.c - candle.o);
    }

    function range(candle) {
      return Math.max(MIN_CANDLE_RANGE, candle.h - candle.l);
    }

    const lastBody = body(last);
    const lastRange = range(last);
    const prevBody = body(prev);

    // Doji (indecision)
    if (lastBody / lastRange < 0.1) {
      patterns.push('DOJI');
    }

    // Hammer / Shooting Star
    const upperWick = last.h - Math.max(last.o, last.c);
    const lowerWick = Math.min(last.o, last.c) - last.l;
    if (lastBody / lastRange < 0.3 && lowerWick > upperWick * 2 && lowerWick > lastBody * 1.5) {
      patterns.push('HAMMER');
      biasScore += 1;
    } else if (lastBody / lastRange < 0.3 && upperWick > lowerWick * 2 && upperWick > lastBody * 1.5) {
      patterns.push('SHOOTING_STAR');
      biasScore -= 1;
    }

    // Engulfing (requires previous candle)
    if (prev) {
      const bullishEngulf = last.c > last.o && prev.c < prev.o && last.c >= prev.o && last.o <= prev.c;
      const bearishEngulf = last.c < last.o && prev.c > prev.o && last.o >= prev.c && last.c <= prev.o;
      if (bullishEngulf) {
        patterns.push('BULLISH_ENGULFING');
        biasScore += 2;
      } else if (bearishEngulf) {
        patterns.push('BEARISH_ENGULFING');
        biasScore -= 2;
      }
    }

    // Morning/Evening Star (needs 3 candles)
    if (recent.length >= 3) {
      const c1 = recent[recent.length - 3];
      const c2 = recent[recent.length - 2];
      const c3 = last;
      const c2Body = body(c2);
      const c2Range = range(c2);
      const gapDown = c2.c < c1.c && c2.o < c1.c;
      const gapUp = c2.c > c1.c && c2.o > c1.c;

      if (gapDown && c2Body / c2Range < 0.3 && c3.c > c1.o) {
        patterns.push('MORNING_STAR');
        biasScore += 2;
      } else if (gapUp && c2Body / c2Range < 0.3 && c3.c < c1.o) {
        patterns.push('EVENING_STAR');
        biasScore -= 2;
      }
    }

    bias = biasScore > 0 ? 'BULLISH' : biasScore < 0 ? 'BEARISH' : null;

    // Confidence score based on number of patterns and body-to-range quality
    const baseScore = Math.min(1, patterns.length * THRESHOLDS.PATTERN_SCORE_PER_MATCH);
    const bodyQuality = Math.max(0, 1 - (lastBody / lastRange));
    const score = Math.min(1, (baseScore * THRESHOLDS.PATTERN_WEIGHT) + (bodyQuality * THRESHOLDS.BODY_WEIGHT));

    return { patterns, bias, score };
  }

  return {
    calculateSMA,
    calculateEMA,
    calculateRSI,
    calculateMACD,
    calculateBollingerBands,
    calculateATR,
    calculateStochastic,
    calculateADX,
    calculateCCI,
    calculateWilliamsR,
    calculateAwesomeOscillator,
    detectCandlestickPatterns
  };
})();

console.log('[Pocket Scout Dynamic Time] Technical Indicators loaded - Enhanced for OTC trading');
