/**
 * Pocket Scout v3.0 - Main Content Script
 * 10-Minute Cyclic Signals with Multi-Indicator Analysis
 * by Claude Opus
 */

(function() {
  'use strict';

  const VERSION = '3.0.0';
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
  const MAX_HISTORY = 50; // Track more history for WR calculation
  
  // Win Rate tracking
  let totalSignals = 0;
  let winningSignals = 0;
  let losingSignals = 0;
  
  // Configurable signal interval (minutes)
  let signalIntervalMinutes = 10; // Default 10 minutes

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
    } catch (e) {
      console.warn('[Pocket Scout v3.0] Error loading settings:', e);
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
    } catch (e) {
      console.warn('[Pocket Scout v3.0] Error saving settings:', e);
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
        console.log(`[Pocket Scout v3.0] ✅ Warmup complete! ${ohlcM1.length} candles`);
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
  }

  // Calculate confidence based on indicator consensus
  function analyzeIndicators() {
    if (!warmupComplete || ohlcM1.length < WARMUP_CANDLES) {
      return null;
    }

    const TI = window.TechnicalIndicators;
    const closes = ohlcM1.map(c => c.c);
    const highs = ohlcM1.map(c => c.h);
    const lows = ohlcM1.map(c => c.l);

    // Calculate all indicators
    const rsi = TI.calculateRSI(closes, 14);
    const macd = TI.calculateMACD(closes, 12, 26, 9);
    const ema9 = TI.calculateEMA(closes, 9);
    const ema21 = TI.calculateEMA(closes, 21);
    const ema50 = TI.calculateEMA(closes, 50);
    const bb = TI.calculateBollingerBands(closes, 20, 2);
    const adx = TI.calculateADX(highs, lows, closes, 14);
    const atr = TI.calculateATR(highs, lows, closes, 14);
    const stoch = TI.calculateStochastic(highs, lows, closes, 14, 3);

    if (!rsi || !macd || !ema9 || !ema21 || !bb || !adx || !atr) {
      return null;
    }

    const currentPrice = closes[closes.length - 1];
    
    // Enhanced vote system with more flexible thresholds
    let buyVotes = 0;
    let sellVotes = 0;
    let totalWeight = 0;
    const reasons = [];

    // RSI vote (weight: 1.5) - More flexible thresholds
    const rsiWeight = 1.5;
    totalWeight += rsiWeight;
    if (rsi < 40) {
      const strength = (40 - rsi) / 40; // 0-1 range
      buyVotes += rsiWeight * strength;
      reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
    } else if (rsi > 60) {
      const strength = (rsi - 60) / 40; // 0-1 range
      sellVotes += rsiWeight * strength;
      reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
    }

    // MACD vote (weight: 2.0) - Strong indicator
    const macdWeight = 2.0;
    totalWeight += macdWeight;
    const macdStrength = Math.min(1, Math.abs(macd.histogram) * 1000);
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      buyVotes += macdWeight * macdStrength;
      reasons.push(`MACD bullish (${macd.histogram.toFixed(5)})`);
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      sellVotes += macdWeight * macdStrength;
      reasons.push(`MACD bearish (${macd.histogram.toFixed(5)})`);
    }

    // EMA Crossover vote (weight: 1.5)
    const emaWeight = 1.5;
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

    // Bollinger Bands vote (weight: 1.0)
    const bbWeight = 1.0;
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
    
    // Stochastic vote (weight: 1.0) - Additional momentum confirmation
    if (stoch) {
      const stochWeight = 1.0;
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

    // ADX strengthens signal (multiplier, not vote)
    let adxMultiplier = 1.0;
    if (adx.adx > 25) {
      adxMultiplier = 1.0 + ((adx.adx - 25) / 100); // 1.0 to 1.75 range
      reasons.push(`ADX strong trend (${adx.adx.toFixed(1)})`);
    }

    // Calculate confidence based on vote strength
    const buyConfidence = (buyVotes / totalWeight) * 100 * adxMultiplier;
    const sellConfidence = (sellVotes / totalWeight) * 100 * adxMultiplier;
    
    let confidence = 0;
    let action = null;
    
    if (buyVotes > sellVotes && buyConfidence >= 50) {
      action = 'BUY';
      confidence = Math.min(95, Math.round(buyConfidence));
    } else if (sellVotes > buyVotes && sellConfidence >= 50) {
      action = 'SELL';
      confidence = Math.min(95, Math.round(sellConfidence));
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
      reasons: reasons.slice(0, 6), // Top 6 reasons
      price: currentPrice,
      volatility: volatilityRatio,
      adxStrength: adx.adx,
      rsi,
      macdHistogram: macd.histogram
    };
  }

  // Generate signal (called by cyclic engine)
  function generateSignal() {
    if (!warmupComplete) {
      console.log(`[Pocket Scout v3.0] ⏸️ Warmup in progress: ${ohlcM1.length}/${WARMUP_CANDLES} candles`);
      return;
    }

    console.log(`[Pocket Scout v3.0] 🔄 Generating signal...`);

    const analysis = analyzeIndicators();
    
    if (!analysis || !analysis.action) {
      console.log(`[Pocket Scout v3.0] ⚠️ No clear signal (neutral or insufficient data)`);
      updateUI();
      return;
    }

    // Lower threshold to 60% to generate more signals
    if (analysis.confidence < 60) {
      console.log(`[Pocket Scout v3.0] ⚠️ Signal confidence too low: ${analysis.confidence}%`);
      updateUI();
      return;
    }

    const signal = {
      action: analysis.action,
      confidence: analysis.confidence,
      duration: analysis.duration,
      expiry: analysis.duration * 60, // Convert to seconds
      reasons: analysis.reasons,
      price: analysis.price || lastPrice,
      timestamp: Date.now(),
      volatility: analysis.volatility,
      adxStrength: analysis.adxStrength,
      rsi: analysis.rsi,
      macdHistogram: analysis.macdHistogram,
      wr: calculateWinRate()
    };

    lastSignal = signal;
    
    // Add to history
    signalHistory.unshift(signal);
    if (signalHistory.length > MAX_HISTORY) {
      signalHistory = signalHistory.slice(0, MAX_HISTORY);
    }

    console.log(`[Pocket Scout v3.0] ✅ Signal generated: ${signal.action} | Conf: ${signal.confidence}% | WR: ${signal.wr.toFixed(1)}% | Duration: ${signal.duration}min | Price: ${signal.price.toFixed(5)}`);
    
    updateUI();
    
    // Publish to Auto Trader if confidence >= 70%
    if (signal.confidence >= 70) {
      publishToAutoTrader(signal);
    } else {
      console.log(`[Pocket Scout v3.0] 📊 Signal displayed only (confidence ${signal.confidence}% < 70%)`);
    }
  }

  // Publish to Auto Trader
  function publishToAutoTrader(signal) {
    const feed = {
      action: signal.action,
      confidence: signal.confidence,
      duration: signal.duration,
      timestamp: signal.timestamp,
      entryPrice: signal.price,
      wr: signal.wr, // Win Rate for Auto Trader
      expiry: signal.expiry
    };

    localStorage.setItem(FEED_KEY, JSON.stringify(feed));
    console.log(`[Pocket Scout v3.0] 📤 Published to Auto Trader:`, feed);
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
      
      UI.signalDisplay.innerHTML = `
        <div style="background:${bgColor}; padding:14px; border-radius:10px; border:2px solid ${actionColor};">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-size:24px; font-weight:800; color:${actionColor};">${sig.action}</div>
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
            return `
              <div style="padding:6px; background:#1e293b; border-radius:6px; margin-bottom:6px; font-size:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="color:${color}; font-weight:700;">${s.action}</span>
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
          <div style="font-weight:700; font-size:18px; color:#60a5fa;">Pocket Scout v3.0</div>
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
        console.log(`[Pocket Scout v3.0] Signal interval updated to ${signalIntervalMinutes} minutes`);
      }
    });
  }
    UI.signalDisplay = document.getElementById('ps-signal');
    UI.historyDisplay = document.getElementById('ps-history');
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
      console.log(`[Pocket Scout v3.0] Signal result: ${result} | WR: ${calculateWinRate().toFixed(1)}%`);
      sendResponse({ success: true });
      return true;
    }
    
    return false;
  });

  // Start processing
  function start() {
    console.log(`[Pocket Scout v3.0] Starting...`);
    
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
        
        console.log(`[Pocket Scout v3.0] All dependencies loaded`);
        
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
        console.log(`[Pocket Scout v3.0] Waiting for: ${missing.join(', ')}`);
      }
    }, 200);
  }

  start();

})();

console.log('[Pocket Scout v3.0] Content script loaded - by Claude Opus');
