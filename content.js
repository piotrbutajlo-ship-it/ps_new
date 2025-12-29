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
  const MAX_HISTORY = 10;

  // UI Elements
  let UI = {};

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
          window.CyclicDecisionEngine.initialize(generateSignal);
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
    const bb = TI.calculateBollingerBands(closes, 20, 2);
    const adx = TI.calculateADX(highs, lows, closes, 14);
    const atr = TI.calculateATR(highs, lows, closes, 14);

    if (!rsi || !macd || !ema9 || !ema21 || !bb || !adx || !atr) {
      return null;
    }

    const currentPrice = closes[closes.length - 1];
    
    // Vote system: each indicator votes BUY (+1), SELL (-1), or NEUTRAL (0)
    let votes = 0;
    let maxVotes = 0;
    const reasons = [];

    // RSI vote
    maxVotes++;
    if (rsi < 30) {
      votes++;
      reasons.push(`RSI oversold (${rsi.toFixed(1)})`);
    } else if (rsi > 70) {
      votes--;
      reasons.push(`RSI overbought (${rsi.toFixed(1)})`);
    }

    // MACD vote (histogram direction and value)
    maxVotes++;
    if (macd.histogram > 0) {
      // Check if histogram is growing (compare with previous value)
      votes++;
      reasons.push(`MACD bullish (${macd.histogram.toFixed(5)})`);
    } else if (macd.histogram < 0) {
      votes--;
      reasons.push(`MACD bearish (${macd.histogram.toFixed(5)})`);
    }

    // EMA Crossover vote
    maxVotes++;
    if (ema9 > ema21) {
      votes++;
      reasons.push('EMA9 > EMA21 (bullish)');
    } else if (ema9 < ema21) {
      votes--;
      reasons.push('EMA9 < EMA21 (bearish)');
    }

    // Bollinger Bands vote
    maxVotes++;
    if (currentPrice <= bb.lower) {
      votes++;
      reasons.push('Price at lower BB');
    } else if (currentPrice >= bb.upper) {
      votes--;
      reasons.push('Price at upper BB');
    }

    // ADX strengthens signal (if trend is strong)
    let adxBoost = 0;
    if (adx.adx > 25) {
      adxBoost = 0.1;
      reasons.push(`ADX strong trend (${adx.adx.toFixed(1)})`);
    }

    // Calculate confidence
    const baseConfidence = (Math.abs(votes) / maxVotes) * 100;
    const confidence = Math.min(95, Math.round(baseConfidence + (adxBoost * 100)));
    
    // Determine direction
    const action = votes > 0 ? 'BUY' : votes < 0 ? 'SELL' : null;
    
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
      reasons: reasons.slice(0, 5), // Limit to top 5 reasons
      price: currentPrice,
      volatility: volatilityRatio,
      adxStrength: adx.adx
    };
  }

  // Generate signal (called by cyclic engine every 10 minutes)
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

    // Only display/publish signals with confidence >= 70%
    if (analysis.confidence < 70) {
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
      adxStrength: analysis.adxStrength
    };

    lastSignal = signal;
    
    // Add to history
    signalHistory.unshift(signal);
    if (signalHistory.length > MAX_HISTORY) {
      signalHistory = signalHistory.slice(0, MAX_HISTORY);
    }

    console.log(`[Pocket Scout v3.0] ✅ Signal generated: ${signal.action} | Conf: ${signal.confidence}% | Duration: ${signal.duration}min | Price: ${signal.price.toFixed(5)}`);
    
    updateUI();
    
    // Publish to Auto Trader if confidence >= 75%
    if (signal.confidence >= 75) {
      publishToAutoTrader(signal);
    } else {
      console.log(`[Pocket Scout v3.0] 📊 Signal displayed only (confidence ${signal.confidence}% < 75%)`);
    }
  }

  // Publish to Auto Trader
  function publishToAutoTrader(signal) {
    const feed = {
      action: signal.action,
      confidence: signal.confidence,
      duration: signal.duration,
      timestamp: signal.timestamp,
      entryPrice: signal.price
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
      UI.signalDisplay.innerHTML = `
        <div style="background:${bgColor}; padding:14px; border-radius:10px; border:2px solid ${actionColor};">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <div style="font-size:24px; font-weight:800; color:${actionColor};">${sig.action}</div>
            <div style="text-align:right;">
              <div style="font-size:20px; font-weight:700; color:#60a5fa;">${sig.duration} MIN</div>
              <div style="font-size:10px; opacity:0.7;">Entry Duration</div>
            </div>
          </div>
          
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
            <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px;">
              <div style="font-size:9px; opacity:0.7; margin-bottom:3px;">Confidence</div>
              <div style="font-size:18px; font-weight:700; color:#3b82f6;">${sig.confidence}%</div>
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
            <span>Volatility: ${(sig.volatility * 100).toFixed(2)}%</span>
            <span>ADX: ${sig.adxStrength.toFixed(1)}</span>
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
      
      <div id="ps-countdown"></div>
      
      <div style="margin-bottom:12px;">
        <div style="font-size:11px; font-weight:600; color:#60a5fa; margin-bottom:8px;">🎯 CURRENT SIGNAL</div>
        <div id="ps-signal"></div>
      </div>
      
      <div id="ps-history"></div>
      
      <div style="font-size:9px; opacity:0.5; text-align:center; margin-top:12px; padding-top:12px; border-top:1px solid #334155;">
        10-Minute Cyclic Signals | Multi-Indicator Analysis
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
  }

  // Start countdown timer update
  function startCountdownTimer() {
    setInterval(() => {
      if (warmupComplete) {
        updateUI();
      }
    }, 1000); // Update every second
  }

  // Start processing
  function start() {
    console.log(`[Pocket Scout v3.0] Starting...`);
    
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
