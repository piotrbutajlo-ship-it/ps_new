/**
 * Pocket Scout Time - Market Regime Detector
 * Simplified version - Basic regime detection
 */

window.MarketRegimeDetector = (function() {
  'use strict';

  let currentRegime = null;
  let regimeHistory = [];
  let stabilityScore = 50;

  function detectRegime(ohlcData) {
    if (!ohlcData || ohlcData.length < 50) {
      return {
        volatility: { level: 'MEDIUM' },
        trend: { direction: 'NEUTRAL', strength: 'MODERATE' },
        momentum: { regime: 'NEUTRAL', rsi: 50 }
      };
    }

    const closes = ohlcData.map(c => c.c);
    const highs = ohlcData.map(c => c.h);
    const lows = ohlcData.map(c => c.l);

    const TI = window.TechnicalIndicators;
    
    // Volatility
    const atr = TI.calculateATR(highs, lows, closes, 14);
    const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const volatilityRatio = atr && avgPrice > 0 ? (atr / avgPrice) * 100 : 0.5;
    
    let volatilityLevel = 'MEDIUM';
    if (volatilityRatio < 0.3) volatilityLevel = 'LOW';
    else if (volatilityRatio > 0.7) volatilityLevel = 'HIGH';

    // Trend
    const ema12 = TI.calculateEMA(closes, 12);
    const ema26 = TI.calculateEMA(closes, 26);
    
    let trendDirection = 'NEUTRAL';
    let trendStrength = 'MODERATE';
    
    if (ema12 && ema26) {
      const diff = Math.abs(ema12 - ema26) / avgPrice;
      if (ema12 > ema26) trendDirection = 'BULLISH';
      else if (ema12 < ema26) trendDirection = 'BEARISH';
      
      if (diff > 0.002) trendStrength = 'STRONG';
      else if (diff < 0.0005) trendStrength = 'WEAK';
    }

    // Momentum
    const rsi = TI.calculateRSI(closes, 14);
    let momentumRegime = 'NEUTRAL';
    if (rsi !== null) {
      if (rsi > 60) momentumRegime = 'BULLISH';
      else if (rsi < 40) momentumRegime = 'BEARISH';
    }

    const regime = {
      volatility: { level: volatilityLevel, ratio: volatilityRatio },
      trend: { direction: trendDirection, strength: trendStrength },
      momentum: { regime: momentumRegime, rsi: rsi || 50 }
    };

    currentRegime = regime;
    regimeHistory.push({ timestamp: Date.now(), regime });
    if (regimeHistory.length > 100) regimeHistory.shift();

    // Calculate stability
    if (regimeHistory.length >= 10) {
      const recent = regimeHistory.slice(-10);
      const sameVol = recent.filter(r => r.regime.volatility.level === volatilityLevel).length;
      const sameTrend = recent.filter(r => r.regime.trend.direction === trendDirection).length;
      stabilityScore = ((sameVol + sameTrend) / 20) * 100;
    }

    regime.uncertainty = { score: Math.max(0, 100 - stabilityScore) };

    return regime;
  }

  function getCurrentRegime() {
    return currentRegime;
  }

  function getRegimeStability() {
    return stabilityScore;
  }

  function updateRegime(ohlcData) {
    const regime = detectRegime(ohlcData);
    return { regime };
  }

  return {
    detectRegime,
    getCurrentRegime,
    getRegimeStability,
    updateRegime
  };
})();

console.log('[Pocket Scout Time] Market Regime Detector loaded');

