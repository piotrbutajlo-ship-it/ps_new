/**
 * Pocket Scout Dynamic Time - Enhanced Indicator Groups
 * Optimized for OTC currency pair trading with volatility filtering
 */

window.IndicatorGroups = (function() {
  'use strict';

  const TI = window.TechnicalIndicators;

  /**
   * Helper: Check ATR volatility filter
   * Returns true if volatility is acceptable for OTC trading
   */
  function checkATRFilter(highs, lows, closes, maxVolatilityRatio = 0.02) {
    const atr = TI.calculateATR(highs, lows, closes, 14);
    if (!atr) return true; // If ATR unavailable, allow signal
    
    const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    if (avgPrice === 0) return true;
    
    const volatilityRatio = atr / avgPrice;
    return volatilityRatio <= maxVolatilityRatio; // Filter out extreme volatility
  }

  /**
   * Helper: Calculate dynamic confidence based on signal strength
   */
  function calculateConfidence(baseConfidence, signalStrength, atrFilter = true, adxStrength = null) {
    let confidence = baseConfidence;
    
    // Adjust for signal strength (0-1)
    confidence += signalStrength * 5;
    
    // Penalize if ATR filter failed
    if (!atrFilter) confidence -= 10;
    
    // Boost if strong trend (ADX > 25)
    if (adxStrength && adxStrength > 25) confidence += 3;
    
    return Math.max(60, Math.min(95, Math.round(confidence)));
  }

  const GLOBAL_THRESHOLDS = window.PocketScoutThresholds || {};
  const VOLATILITY_LOW_THRESHOLD = GLOBAL_THRESHOLDS.VOL_RISK_LOW || 0.002;
  const VOLATILITY_ELEVATED_THRESHOLD = GLOBAL_THRESHOLDS.VOL_RISK_ELEVATED || 0.012;
  const VOLATILITY_EXTREME_THRESHOLD = GLOBAL_THRESHOLDS.VOL_RISK_EXTREME || 0.02;
  const BB_SQUEEZE_THRESHOLD = GLOBAL_THRESHOLDS.BB_SQUEEZE_THRESHOLD || 0.02; // Narrow bands signal compression; tuned for fast OTC pairs
  const VOLATILITY_MAX_PASS = GLOBAL_THRESHOLDS.VOL_RISK_CAP || 0.025;

  function getRiskSnapshot(highs, lows, closes) {
    const atr = TI.calculateATR(highs, lows, closes, 14);
    const avgPrice = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
    if (!atr || !avgPrice) {
      return { level: 'UNKNOWN', ratio: 0, passes: true };
    }

    const ratio = atr / avgPrice;
    let level = 'BALANCED';
    if (ratio < VOLATILITY_LOW_THRESHOLD) level = 'LOW';
    else if (ratio > VOLATILITY_EXTREME_THRESHOLD) level = 'EXTREME';
    else if (ratio > VOLATILITY_ELEVATED_THRESHOLD) level = 'HIGH';

    return {
      level,
      ratio,
      passes: ratio >= VOLATILITY_LOW_THRESHOLD && ratio <= VOLATILITY_MAX_PASS
    };
  }

  function formatPatterns(patternInfo) {
    if (!patternInfo || !patternInfo.patterns || patternInfo.patterns.length === 0) return 'No pattern';
    return patternInfo.patterns.join(', ');
  }

  const GROUPS = [
    // ===== ENHANCED EXISTING GROUPS =====
    {
      id: 'RSI_BB',
      name: 'RSI + Bollinger Bands',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const rsi = TI.calculateRSI(closes, 14);
        const bb = TI.calculateBollingerBands(closes, 20, 2);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!rsi || !bb) return null;
        
        let action = null;
        let signalStrength = 0;
        
        if (rsi < 30 && bb.percentB < 0.15) {
          action = 'BUY';
          signalStrength = (30 - rsi) / 30 + (0.15 - bb.percentB) / 0.15;
        } else if (rsi > 70 && bb.percentB > 0.85) {
          action = 'SELL';
          signalStrength = (rsi - 70) / 30 + (bb.percentB - 0.85) / 0.15;
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(75, signalStrength / 2, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            `RSI: ${rsi.toFixed(1)}`, 
            `BB %B: ${(bb.percentB * 100).toFixed(1)}%`,
            atrFilter ? 'Volatility OK' : 'High volatility'
          ] 
        };
      }
    },
    {
      id: 'MACD_EMA',
      name: 'MACD + EMA Crossover',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const ema12 = TI.calculateEMA(closes, 12);
        const ema26 = TI.calculateEMA(closes, 26);
        const price = closes[closes.length - 1];
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!macd || !ema12 || !ema26) return null;
        
        let action = null;
        let signalStrength = 0;
        
        if (macd.histogram > 0 && ema12 > ema26 && price > ema12) {
          action = 'BUY';
          signalStrength = Math.min(1, Math.abs(macd.histogram) * 1000) + (price > ema12 ? 0.3 : 0);
        } else if (macd.histogram < 0 && ema12 < ema26 && price < ema12) {
          action = 'SELL';
          signalStrength = Math.min(1, Math.abs(macd.histogram) * 1000) + (price < ema12 ? 0.3 : 0);
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(73, signalStrength / 2, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            'MACD bullish', 
            'EMA12 > EMA26',
            `Price above EMA12: ${(price > ema12).toString()}`
          ] 
        };
      }
    },
    {
      id: 'RSI_OVERSOLD',
      name: 'RSI Oversold/Overbought + MACD',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const rsi = TI.calculateRSI(closes, 14);
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!rsi || !macd) return null;
        
        let action = null;
        let signalStrength = 0;
        
        // Enhanced: Require MACD confirmation
        if (rsi < 30 && macd.histogram > -0.0001) {
          action = 'BUY';
          signalStrength = (30 - rsi) / 30;
        } else if (rsi > 70 && macd.histogram < 0.0001) {
          action = 'SELL';
          signalStrength = (rsi - 70) / 30;
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(72, signalStrength / 2, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            `RSI: ${rsi.toFixed(1)}`, 
            'MACD confirmation'
          ] 
        };
      }
    },
    {
      id: 'BB_BOUNCE',
      name: 'Bollinger Bands Bounce + RSI',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const bb = TI.calculateBollingerBands(closes, 20, 2);
        const rsi = TI.calculateRSI(closes, 14);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!bb || !rsi) return null;
        
        const price = closes[closes.length - 1];
        let action = null;
        let signalStrength = 0;
        
        // Enhanced: Require RSI confirmation
        if (price <= bb.lower * 1.001 && rsi < 40) {
          action = 'BUY';
          signalStrength = (40 - rsi) / 40;
        } else if (price >= bb.upper * 0.999 && rsi > 60) {
          action = 'SELL';
          signalStrength = (rsi - 60) / 40;
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(74, signalStrength / 2, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            'Price at BB extreme', 
            `RSI: ${rsi.toFixed(1)}`
          ] 
        };
      }
    },
    {
      id: 'EMA_TREND',
      name: 'EMA Trend + Price Position',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const ema9 = TI.calculateEMA(closes, 9);
        const ema21 = TI.calculateEMA(closes, 21);
        const ema50 = TI.calculateEMA(closes, 50);
        const price = closes[closes.length - 1];
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!ema9 || !ema21) return null;
        
        let action = null;
        let signalStrength = 0;
        
        // Enhanced: Check price position and multiple EMAs
        if (ema9 > ema21 && price > ema9) {
          if (ema50 && price > ema50) signalStrength = 0.8;
          else signalStrength = 0.5;
          action = 'BUY';
        } else if (ema9 < ema21 && price < ema9) {
          if (ema50 && price < ema50) signalStrength = 0.8;
          else signalStrength = 0.5;
          action = 'SELL';
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(71, signalStrength, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            'EMA9 > EMA21', 
            `Price above/below EMAs`,
            ema50 ? 'EMA50 aligned' : 'EMA50 N/A'
          ] 
        };
      }
    },
    {
      id: 'MACD_CROSS',
      name: 'MACD Signal Cross + Trend',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const ema21 = TI.calculateEMA(closes, 21);
        const price = closes[closes.length - 1];
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!macd || !ema21) return null;
        
        let action = null;
        let signalStrength = 0;
        
        // Enhanced: Require price above/below EMA for confirmation
        if (macd.histogram > 0 && macd.macd > macd.signal && price > ema21) {
          action = 'BUY';
          signalStrength = Math.min(1, Math.abs(macd.histogram) * 1000);
        } else if (macd.histogram < 0 && macd.macd < macd.signal && price < ema21) {
          action = 'SELL';
          signalStrength = Math.min(1, Math.abs(macd.histogram) * 1000);
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(73, signalStrength / 2, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            'MACD cross bullish', 
            `Price ${price > ema21 ? 'above' : 'below'} EMA21`
          ] 
        };
      }
    },
    {
      id: 'RSI_MACD',
      name: 'RSI + MACD',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const rsi = TI.calculateRSI(closes, 14);
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!rsi || !macd) return null;
        
        let action = null;
        let signalStrength = 0;
        
        if (rsi < 40 && macd.histogram > 0) {
          action = 'BUY';
          signalStrength = (40 - rsi) / 40 + Math.min(0.5, Math.abs(macd.histogram) * 500);
        } else if (rsi > 60 && macd.histogram < 0) {
          action = 'SELL';
          signalStrength = (rsi - 60) / 40 + Math.min(0.5, Math.abs(macd.histogram) * 500);
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(76, signalStrength / 2, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            `RSI: ${rsi.toFixed(1)}`, 
            'MACD bullish'
          ] 
        };
      }
    },
    {
      id: 'BB_MACD',
      name: 'Bollinger + MACD',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const bb = TI.calculateBollingerBands(closes, 20, 2);
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!bb || !macd) return null;
        
        let action = null;
        let signalStrength = 0;
        
        if (bb.percentB < 0.2 && macd.histogram > 0) {
          action = 'BUY';
          signalStrength = (0.2 - bb.percentB) / 0.2 + Math.min(0.5, Math.abs(macd.histogram) * 500);
        } else if (bb.percentB > 0.8 && macd.histogram < 0) {
          action = 'SELL';
          signalStrength = (bb.percentB - 0.8) / 0.2 + Math.min(0.5, Math.abs(macd.histogram) * 500);
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(75, signalStrength / 2, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            'BB lower', 
            'MACD bullish'
          ] 
        };
      }
    },
    {
      id: 'TRIPLE_EMA',
      name: 'Triple EMA + Price',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const ema8 = TI.calculateEMA(closes, 8);
        const ema13 = TI.calculateEMA(closes, 13);
        const ema21 = TI.calculateEMA(closes, 21);
        const price = closes[closes.length - 1];
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!ema8 || !ema13 || !ema21) return null;
        
        let action = null;
        let signalStrength = 0;
        
        // Enhanced: Check price position
        if (ema8 > ema13 && ema13 > ema21 && price > ema8) {
          action = 'BUY';
          signalStrength = 0.8;
        } else if (ema8 < ema13 && ema13 < ema21 && price < ema8) {
          action = 'SELL';
          signalStrength = 0.8;
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(72, signalStrength, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            'EMA8 > EMA13 > EMA21', 
            `Price ${price > ema8 ? 'above' : 'below'} EMAs`
          ] 
        };
      }
    },
    {
      id: 'RSI_BB_MACD',
      name: 'RSI + BB + MACD',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const rsi = TI.calculateRSI(closes, 14);
        const bb = TI.calculateBollingerBands(closes, 20, 2);
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!rsi || !bb || !macd) return null;
        
        let buySignals = 0;
        let sellSignals = 0;
        let signalStrength = 0;
        
        if (rsi < 35) { buySignals++; signalStrength += 0.3; }
        if (rsi > 65) { sellSignals++; signalStrength += 0.3; }
        if (bb.percentB < 0.25) { buySignals++; signalStrength += 0.3; }
        if (bb.percentB > 0.75) { sellSignals++; signalStrength += 0.3; }
        if (macd.histogram > 0) { buySignals++; signalStrength += 0.4; }
        if (macd.histogram < 0) { sellSignals++; signalStrength += 0.4; }
        
        let action = null;
        if (buySignals >= 2) {
          action = 'BUY';
        } else if (sellSignals >= 2) {
          action = 'SELL';
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(78, signalStrength / 3, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            `${buySignals || sellSignals}/3 signals`,
            `RSI: ${rsi.toFixed(1)}`,
            `BB: ${(bb.percentB * 100).toFixed(1)}%`
          ] 
        };
      }
    },

    // ===== NEW STRATEGIC GROUPS =====
    {
      id: 'ATR_TREND',
      name: 'ATR Volatility + EMA Trend',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const atr = TI.calculateATR(highs, lows, closes, 14);
        const ema12 = TI.calculateEMA(closes, 12);
        const ema26 = TI.calculateEMA(closes, 26);
        const price = closes[closes.length - 1];
        
        if (!atr || !ema12 || !ema26) return null;
        
        // Only trade when volatility is moderate (not too high, not too low)
        const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const volatilityRatio = atr / avgPrice;
        
        // Prefer moderate volatility (0.005 to 0.015 for OTC)
        if (volatilityRatio < 0.003 || volatilityRatio > 0.02) return null;
        
        let action = null;
        let signalStrength = 0;
        
        if (ema12 > ema26 && price > ema12) {
          action = 'BUY';
          signalStrength = 0.7;
        } else if (ema12 < ema26 && price < ema12) {
          action = 'SELL';
          signalStrength = 0.7;
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(74, signalStrength, true);
        return { 
          action, 
          confidence, 
          reasons: [
            `ATR volatility: ${(volatilityRatio * 100).toFixed(3)}%`,
            'EMA trend aligned',
            'Moderate volatility filter'
          ] 
        };
      }
    },
    {
      id: 'ADX_MACD',
      name: 'ADX Trend Strength + MACD',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const adx = TI.calculateADX(highs, lows, closes, 14);
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!adx || !macd) return null;
        
        // Only trade strong trends (ADX > 25)
        if (adx.adx < 25) return null;
        
        let action = null;
        let signalStrength = 0;
        
        // Check trend direction from ADX
        const isUptrend = adx.plusDI > adx.minusDI;
        
        if (isUptrend && macd.histogram > 0 && macd.macd > macd.signal) {
          action = 'BUY';
          signalStrength = Math.min(1, (adx.adx - 25) / 30) + Math.min(0.5, Math.abs(macd.histogram) * 500);
        } else if (!isUptrend && macd.histogram < 0 && macd.macd < macd.signal) {
          action = 'SELL';
          signalStrength = Math.min(1, (adx.adx - 25) / 30) + Math.min(0.5, Math.abs(macd.histogram) * 500);
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(77, signalStrength / 2, atrFilter, adx.adx);
        return { 
          action, 
          confidence, 
          reasons: [
            `ADX: ${adx.adx.toFixed(1)} (strong trend)`,
            'MACD momentum aligned',
            `Trend: ${isUptrend ? 'UP' : 'DOWN'}`
          ] 
        };
      }
    },
    {
      id: 'STOCH_RSI',
      name: 'Stochastic + RSI Dual Momentum',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const stoch = TI.calculateStochastic(highs, lows, closes, 14, 3);
        const rsi = TI.calculateRSI(closes, 14);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!stoch || !rsi) return null;
        
        let action = null;
        let signalStrength = 0;
        
        // Both indicators must agree
        if (stoch.k < 30 && stoch.d < 30 && rsi < 40) {
          action = 'BUY';
          signalStrength = ((30 - stoch.k) / 30 + (40 - rsi) / 40) / 2;
        } else if (stoch.k > 70 && stoch.d > 70 && rsi > 60) {
          action = 'SELL';
          signalStrength = ((stoch.k - 70) / 30 + (rsi - 60) / 40) / 2;
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(76, signalStrength, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            `Stoch K: ${stoch.k.toFixed(1)}, D: ${stoch.d.toFixed(1)}`,
            `RSI: ${rsi.toFixed(1)}`,
            'Dual momentum confirmation'
          ] 
        };
      }
    },
    {
      id: 'ATR_BB',
      name: 'ATR Volatility + Bollinger Bands',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const atr = TI.calculateATR(highs, lows, closes, 14);
        const bb = TI.calculateBollingerBands(closes, 20, 2);
        const rsi = TI.calculateRSI(closes, 14);
        
        if (!atr || !bb || !rsi) return null;
        
        // Check if volatility is expanding (good for breakouts)
        const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const volatilityRatio = atr / avgPrice;
        
        // Prefer moderate to high volatility for BB strategies
        if (volatilityRatio < 0.003) return null;
        
        let action = null;
        let signalStrength = 0;
        
        if (bb.percentB < 0.2 && rsi < 45) {
          action = 'BUY';
          signalStrength = (0.2 - bb.percentB) / 0.2 + (45 - rsi) / 45;
        } else if (bb.percentB > 0.8 && rsi > 55) {
          action = 'SELL';
          signalStrength = (bb.percentB - 0.8) / 0.2 + (rsi - 55) / 45;
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(75, signalStrength / 2, volatilityRatio <= 0.02);
        return { 
          action, 
          confidence, 
          reasons: [
            `ATR vol: ${(volatilityRatio * 100).toFixed(3)}%`,
            `BB %B: ${(bb.percentB * 100).toFixed(1)}%`,
            `RSI: ${rsi.toFixed(1)}`
          ] 
        };
      }
    },
    {
      id: 'ADX_EMA',
      name: 'ADX Strong Trend + EMA',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const adx = TI.calculateADX(highs, lows, closes, 14);
        const ema12 = TI.calculateEMA(closes, 12);
        const ema26 = TI.calculateEMA(closes, 26);
        const price = closes[closes.length - 1];
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!adx || !ema12 || !ema26) return null;
        
        // Only strong trends
        if (adx.adx < 25) return null;
        
        const isUptrend = adx.plusDI > adx.minusDI;
        
        let action = null;
        let signalStrength = 0;
        
        if (isUptrend && ema12 > ema26 && price > ema12) {
          action = 'BUY';
          signalStrength = Math.min(1, (adx.adx - 25) / 30) + 0.3;
        } else if (!isUptrend && ema12 < ema26 && price < ema12) {
          action = 'SELL';
          signalStrength = Math.min(1, (adx.adx - 25) / 30) + 0.3;
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(76, signalStrength / 2, atrFilter, adx.adx);
        return { 
          action, 
          confidence, 
          reasons: [
            `ADX: ${adx.adx.toFixed(1)} (strong)`,
            'EMA alignment',
            `Trend: ${isUptrend ? 'UP' : 'DOWN'}`
          ] 
        };
      }
    },
    {
      id: 'CCI_MACD',
      name: 'CCI Cyclical + MACD',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const cci = TI.calculateCCI(highs, lows, closes, 20);
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!cci || !macd) return null;
        
        let action = null;
        let signalStrength = 0;
        
        // CCI oversold/overbought + MACD confirmation
        if (cci < -100 && macd.histogram > 0) {
          action = 'BUY';
          signalStrength = Math.min(1, Math.abs(cci + 100) / 100) + Math.min(0.5, Math.abs(macd.histogram) * 500);
        } else if (cci > 100 && macd.histogram < 0) {
          action = 'SELL';
          signalStrength = Math.min(1, Math.abs(cci - 100) / 100) + Math.min(0.5, Math.abs(macd.histogram) * 500);
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(75, signalStrength / 2, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            `CCI: ${cci.toFixed(1)}`,
            'MACD momentum',
            'Cyclical trend'
          ] 
        };
      }
    },
    {
      id: 'WILLIAMS_BB',
      name: 'Williams %R + Bollinger Bands',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const williamsR = TI.calculateWilliamsR(highs, lows, closes, 14);
        const bb = TI.calculateBollingerBands(closes, 20, 2);
        const atrFilter = checkATRFilter(highs, lows, closes);
        
        if (!williamsR || !bb) return null;
        
        let action = null;
        let signalStrength = 0;
        
        // Williams %R oversold/overbought + BB confirmation
        if (williamsR < -80 && bb.percentB < 0.25) {
          action = 'BUY';
          signalStrength = (Math.abs(williamsR + 80) / 20) + (0.25 - bb.percentB) / 0.25;
        } else if (williamsR > -20 && bb.percentB > 0.75) {
          action = 'SELL';
          signalStrength = ((williamsR + 20) / 20) + (bb.percentB - 0.75) / 0.25;
        }
        
        if (!action) return null;
        
        const confidence = calculateConfidence(74, signalStrength / 2, atrFilter);
        return { 
          action, 
          confidence, 
          reasons: [
            `Williams %R: ${williamsR.toFixed(1)}`,
            `BB %B: ${(bb.percentB * 100).toFixed(1)}%`,
            'Momentum + volatility'
          ] 
        };
      }
    },
    {
      id: 'ATR_MACD_EMA',
      name: 'ATR + MACD + EMA Triple',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const atr = TI.calculateATR(highs, lows, closes, 14);
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const ema21 = TI.calculateEMA(closes, 21);
        const price = closes[closes.length - 1];
        
        if (!atr || !macd || !ema21) return null;
        
        // Volatility filter
        const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const volatilityRatio = atr / avgPrice;
        if (volatilityRatio > 0.02) return null;
        
        let action = null;
        let signalStrength = 0;
        let buyConfirmations = 0;
        let sellConfirmations = 0;
        
        // Triple confirmation for BUY
        if (macd.histogram > 0 && macd.macd > macd.signal) buyConfirmations++;
        if (price > ema21) buyConfirmations++;
        if (volatilityRatio >= 0.003 && volatilityRatio <= 0.015) buyConfirmations++;
        
        // Triple confirmation for SELL
        if (macd.histogram < 0 && macd.macd < macd.signal) sellConfirmations++;
        if (price < ema21) sellConfirmations++;
        if (volatilityRatio >= 0.003 && volatilityRatio <= 0.015) sellConfirmations++;
        
        if (buyConfirmations >= 2) {
          action = 'BUY';
          signalStrength = buyConfirmations / 3;
        } else if (sellConfirmations >= 2) {
          action = 'SELL';
          signalStrength = sellConfirmations / 3;
        }
        
        if (!action) return null;
        
        const confirmations = action === 'BUY' ? buyConfirmations : sellConfirmations;
        const confidence = calculateConfidence(79, signalStrength, true);
        return { 
          action, 
          confidence, 
          reasons: [
            `${confirmations}/3 confirmations`,
            `ATR vol: ${(volatilityRatio * 100).toFixed(3)}%`,
            'MACD + EMA + Volatility'
          ] 
        };
      }
    },
    {
      id: 'PATTERN_ENGULFING_RSI',
      name: 'Candlestick Engulfing + RSI Filter',
      analyze: function(data) {
        const { closes, highs, lows, candles } = data;
        if (!candles || candles.length < 2) return null;

        const patternInfo = TI.detectCandlestickPatterns(candles);
        const rsi = TI.calculateRSI(closes, 14);
        const adx = TI.calculateADX(highs, lows, closes, 14);
        const risk = getRiskSnapshot(highs, lows, closes);

        if (!patternInfo || !patternInfo.patterns.length || !rsi) return null;

        let action = null;
        let signalStrength = patternInfo.score;

        if ((patternInfo.patterns.includes('BULLISH_ENGULFING') || patternInfo.patterns.includes('MORNING_STAR') || patternInfo.bias === 'BULLISH') && rsi < 60) {
          action = 'BUY';
          signalStrength += (60 - rsi) / 60;
        } else if ((patternInfo.patterns.includes('BEARISH_ENGULFING') || patternInfo.patterns.includes('EVENING_STAR') || patternInfo.bias === 'BEARISH') && rsi > 40) {
          action = 'SELL';
          signalStrength += (rsi - 40) / 60;
        }

        if (!action) return null;

        const confidence = calculateConfidence(78, signalStrength, risk.passes, adx ? adx.adx : null);
        return {
          action,
          confidence,
          reasons: [
            `Patterns: ${formatPatterns(patternInfo)}`,
            `RSI: ${rsi.toFixed(1)}`,
            `Volatility risk: ${risk.level}`
          ]
        };
      }
    },
    {
      id: 'VOL_SQUEEZE_BREAKOUT',
      name: 'Volatility Squeeze + Momentum Bias',
      analyze: function(data) {
        const { closes, highs, lows } = data;
        const bb = TI.calculateBollingerBands(closes, 20, 2);
        const atr = TI.calculateATR(highs, lows, closes, 14);
        const macd = TI.calculateMACD(closes, 12, 26, 9);
        const risk = getRiskSnapshot(highs, lows, closes);
        
        if (!bb || !atr || !macd) return null;

        const bandwidth = (bb.upper - bb.lower) / (bb.middle || 1);
        // Look for compressed bands with rising ATR = ready to break
        const squeeze = bandwidth < BB_SQUEEZE_THRESHOLD;
        if (!squeeze) return null;

        let action = null;
        let signalStrength = Math.min(1, (BB_SQUEEZE_THRESHOLD - bandwidth) * 40);

        if (macd.histogram > 0 && macd.macd > macd.signal) {
          action = 'BUY';
          signalStrength += Math.min(0.5, Math.abs(macd.histogram) * 500);
        } else if (macd.histogram < 0 && macd.macd < macd.signal) {
          action = 'SELL';
          signalStrength += Math.min(0.5, Math.abs(macd.histogram) * 500);
        }

        if (!action) return null;

        const confidence = calculateConfidence(77, signalStrength / 2, risk.passes);
        return {
          action,
          confidence,
          reasons: [
            'Bollinger squeeze detected',
            `ATR/price: ${(risk.ratio * 100).toFixed(2)}%`,
            `MACD momentum ${action === 'BUY' ? 'up' : 'down'}`
          ]
        };
      }
    }
  ];

  function getAllGroups() {
    return GROUPS;
  }

  function getGroup(index) {
    return GROUPS[index] || null;
  }

  function getGroupCount() {
    return GROUPS.length;
  }

  return {
    getAllGroups,
    getGroup,
    getGroupCount
  };
})();

console.log(`[Pocket Scout Dynamic Time] Enhanced Indicator Groups loaded - ${GROUPS.length} groups optimized for OTC trading`);
