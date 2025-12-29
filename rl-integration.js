/**
 * Pocket Scout Dynamic Time - Enhanced RL Integration
 * RL Agent with Experience Replay and DQN Training
 */

window.RLIntegration = (function() {
  'use strict';

  const CONFIG = {
    EPSILON: 0.30,
    EPSILON_MIN: 0.01,
    EPSILON_DECAY: 0.9995,
    EPSILON_DECAY_FAST: 0.997,
    STATE_DIMENSION: 16, // Enhanced: 12 -> 16 dimensions
    ACTION_DIMENSION: 18, // Updated dynamically below based on indicator groups
    REWARD_WIN: 10,
    REWARD_LOSS: -5,
    GAMMA: 0.95
  };

  function resolveActionDim() {
    if (window.IndicatorGroups && window.IndicatorGroups.getGroupCount) {
      return window.IndicatorGroups.getGroupCount();
    }
    return CONFIG.ACTION_DIMENSION;
  }

  function getMatrixRowLength(matrix) {
    if (!Array.isArray(matrix) || matrix.length === 0) return null;
    const firstRow = matrix[0];
    return Array.isArray(firstRow) ? firstRow.length : null;
  }

  function loadBanditWeights() {
    try {
      const raw = localStorage.getItem(BANDIT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          banditWeights = parsed;
        }
      }
    } catch (e) {
      console.warn('[RL Integration] ⚠️ Failed to load bandit weights', e);
    }
  }

  function saveBanditWeights() {
    try {
      localStorage.setItem(BANDIT_KEY, JSON.stringify(banditWeights));
    } catch (e) {
      console.warn('[RL Integration] ⚠️ Failed to save bandit weights', e);
    }
  }

  function getBanditWeight(groupId) {
    if (!groupId) return 1;
    return banditWeights[groupId] || 1;
  }

  function shouldExploreFallback() {
    // Trigger exploration fallback when epsilon is still high or model is undertrained
    return epsilon > 0.12 || totalExperiences < 80;
  }

  function updateBanditWeight(groupId, result, confidence = 70) {
    if (!groupId) return;
    const base = banditWeights[groupId] || 1;
    const adj = result === 'WIN' ? 0.05 + (confidence - 60) / 500 : -0.05 - (confidence - 60) / 400;
    const next = Math.min(2.0, Math.max(0.5, base + adj));
    banditWeights[groupId] = next;
    saveBanditWeights();
    console.log(`[RL Integration] 🎯 Bandit weight updated for ${groupId}: ${base.toFixed(3)} -> ${next.toFixed(3)} (result=${result}, conf=${confidence})`);
  }

  function warmupBanditFromHistory(ohlcData) {
    if (!ohlcData || ohlcData.length < 30 || !window.IndicatorGroups) return;
    const groups = window.IndicatorGroups.getAllGroups();
    const closes = ohlcData.map(c => c.c);
    const highs = ohlcData.map(c => c.h);
    const lows = ohlcData.map(c => c.l);
    const opens = ohlcData.map(c => c.o);
    const candles = ohlcData;
    if (closes.length < 2) return;
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];
    const dir = lastClose > prevClose ? 'UP' : lastClose < prevClose ? 'DOWN' : 'FLAT';

    groups.forEach((g) => {
      if (!g || !g.analyze) return;
      const analysis = g.analyze({ closes, highs, lows, opens, candles });
      if (!analysis || !analysis.action) return;
      const win = (analysis.action === 'BUY' && dir === 'UP') || (analysis.action === 'SELL' && dir === 'DOWN');
      updateBanditWeight(g.id, win ? 'WIN' : 'LOSS', analysis.confidence || 70);
    });
  }

  let isInitialized = false;
  let epsilon = CONFIG.EPSILON;
  let sessionWins = 0;
  let sessionLosses = 0;
  let currentStreak = 0;
  let maxStreak = 0;
  let cumulativeReward = 0;
  let totalExperiences = 0;
  let banditWeights = {};
  const BANDIT_KEY = 'ps_bandit_weights_v1';
  let dqnAgent = null;
  let experienceReplay = null;
  let lastState = null;
  let lastAction = null;
  let lastQAdvantage = 0;
  let lastRiskSnapshot = null;
  let lastPatternSnapshot = null;

  function encodeState(ohlcData, regimeData) {
    const state = new Array(CONFIG.STATE_DIMENSION).fill(0.5);
    
    if (!ohlcData || ohlcData.length < 50) {
      return state;
    }
    
    const closes = ohlcData.map(c => c.c);
    const highs = ohlcData.map(c => c.h);
    const lows = ohlcData.map(c => c.l);
    
    const TI = window.TechnicalIndicators;
    const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    
    // [0] Market Regime Volatility Level
    if (regimeData && regimeData.volatility) {
      const volatilityLevel = regimeData.volatility.level;
      state[0] = volatilityLevel === 'LOW' ? 0.25 : 
                 volatilityLevel === 'MEDIUM' ? 0.5 : 0.75;
    }
    
    // [1] Volatility (ATR) - normalized and stored as risk snapshot
    const atr = TI.calculateATR(highs, lows, closes, 14);
    if (atr && avgPrice > 0) {
      state[1] = Math.min(1, (atr / avgPrice) * 50);
      lastRiskSnapshot = {
        ratio: atr / avgPrice,
        level: state[1] > 0.9 ? 'EXTREME' : state[1] > 0.6 ? 'HIGH' : state[1] < 0.2 ? 'LOW' : 'BALANCED',
        timestamp: Date.now()
      };
    }
    
    // [2] Trend Strength (EMA separation)
    const ema12 = TI.calculateEMA(closes, 12);
    const ema26 = TI.calculateEMA(closes, 26);
    if (ema12 && ema26) {
      const diff = Math.abs(ema12 - ema26) / avgPrice;
      state[2] = Math.min(1, diff * 100);
    }
    
    // [3] Trend Direction
    if (regimeData && regimeData.trend) {
      state[3] = regimeData.trend.direction === 'BULLISH' ? 1 :
                 regimeData.trend.direction === 'BEARISH' ? 0 : 0.5;
    }
    
    // [4] RSI
    const rsi = TI.calculateRSI(closes, 14);
    if (rsi !== null) {
      state[4] = rsi / 100;
    }
    
    // [5] MACD Histogram
    const macd = TI.calculateMACD(closes, 12, 26, 9);
    if (macd && macd.histogram !== undefined) {
      state[5] = 0.5 + Math.max(-0.5, Math.min(0.5, macd.histogram * 1000));
    }
    
    // [6] ADX Trend Strength (NEW)
    const adx = TI.calculateADX(highs, lows, closes, 14);
    if (adx && adx.adx !== null) {
      state[6] = Math.min(1, adx.adx / 100); // Normalize 0-100 to 0-1
    }
    
    // [7] Stochastic %K (NEW)
    const stoch = TI.calculateStochastic(highs, lows, closes, 14, 3);
    if (stoch && stoch.k !== undefined) {
      state[7] = stoch.k / 100; // Normalize 0-100 to 0-1
    }
    
    // [8] Time of Day
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    state[8] = (hour * 60 + minute) / (24 * 60);
    
    // [9] Regime Stability
    const stability = window.MarketRegimeDetector.getRegimeStability();
    state[9] = stability / 100;
    
    // [10] Win Rate History
    const total = sessionWins + sessionLosses;
    state[10] = total > 0 ? sessionWins / total : 0.5;
    
    // [11] Recent Performance (Streak)
    state[11] = 0.5 + (currentStreak / 20);
    
    // [12] Market Conditions Score
    state[12] = 0.5;
    if (regimeData) {
      const stability = window.MarketRegimeDetector.getRegimeStability();
      state[12] += (stability - 50) / 200;
      if (regimeData.trend && regimeData.trend.strength === 'STRONG') {
        state[12] += 0.15;
      }
      if (regimeData.volatility && regimeData.volatility.level === 'HIGH') {
        state[12] -= 0.1;
      }
      state[12] = Math.max(0, Math.min(1, state[12]));
    }
    
    // [13] Price Position vs EMAs (NEW)
    const ema21 = TI.calculateEMA(closes, 21);
    const price = closes[closes.length - 1];
    if (ema21 && price) {
      state[13] = price > ema21 ? 1 : 0; // Binary: above or below EMA21
    }
    
    // [14] Bollinger Bands %B (NEW)
    const bb = TI.calculateBollingerBands(closes, 20, 2);
    if (bb && bb.percentB !== undefined) {
      state[14] = bb.percentB; // Already normalized 0-1
    }
    
    // [15] CCI (NEW)
    const cci = TI.calculateCCI(highs, lows, closes, 20);
    if (cci !== null) {
      // Normalize CCI (-200 to +200 range) to 0-1
      state[15] = Math.max(0, Math.min(1, (cci + 200) / 400));
    }

    // Candlestick awareness (pattern confidence + directional bias)
    const patternSnapshot = TI.detectCandlestickPatterns(ohlcData.slice(-3));
    lastPatternSnapshot = { ...patternSnapshot, timestamp: Date.now() };
    if (patternSnapshot && patternSnapshot.score) {
      const patternBias = patternSnapshot.bias === 'BULLISH' ? 0.05 : patternSnapshot.bias === 'BEARISH' ? -0.05 : 0;
      state[12] = Math.max(0, Math.min(1, state[12] + patternBias));
      state[15] = Math.max(0, Math.min(1, (state[15] * 0.7) + (patternSnapshot.score * 0.3)));
    }
    
    return state;
  }

  function selectAction(state) {
    const groups = window.IndicatorGroups.getAllGroups();
    
    // Epsilon-greedy exploration
    if (Math.random() < epsilon) {
      const randomAction = Math.floor(Math.random() * groups.length);
      lastQAdvantage = 0;
      return randomAction;
    }
    
    // Exploitation: use DQN
    if (dqnAgent) {
      const bestAction = dqnAgent.selectBestAction(state);
      return bestAction.action;
    }
    
    // Fallback: random
    return Math.floor(Math.random() * groups.length);
  }

  function calculateReward(result, signalConfidence = null, marketConditions = null) {
    let reward = 0;
    
    if (result === 'WIN') {
      reward = CONFIG.REWARD_WIN;
      currentStreak = Math.max(0, currentStreak) + 1;
      sessionWins++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else if (result === 'LOSS') {
      reward = CONFIG.REWARD_LOSS;
      currentStreak = Math.min(0, currentStreak) - 1;
      sessionLosses++;
    }
    
    // Confidence-based adjustments (reward shaping)
    if (signalConfidence !== null) {
      if (result === 'WIN') {
        // Higher confidence wins get more reward
        reward += (signalConfidence - 60) / 10; // +0 to +3.5 for 60-95% confidence
        if (signalConfidence >= 85) reward += 5; // Bonus for high confidence
      } else if (result === 'LOSS') {
        // High confidence losses are penalized more
        if (signalConfidence >= 85) reward -= 10;
        else if (signalConfidence >= 75) reward -= 5;
        // Extra penalty for confident losses to drive learning faster
        if (signalConfidence >= 80) reward -= 3;
      }
    }
    
    // Market conditions bonus/penalty
    if (marketConditions) {
      const stability = marketConditions.stability || 50;
      if (result === 'WIN' && stability > 70) {
        reward += 2; // Bonus for stable market wins
      } else if (result === 'LOSS' && stability < 30) {
        reward += 1; // Less penalty in unstable markets
      }
    }

    // Volatility-aware reward shaping
    if (lastRiskSnapshot) {
      if (result === 'WIN' && lastRiskSnapshot.level === 'HIGH') {
        reward += 1.5; // adaptive bonus for surviving high volatility
      } else if (result === 'LOSS' && lastRiskSnapshot.level === 'EXTREME') {
        reward += 0.5; // soften penalty when market is chaotic
      }
    }
    
    cumulativeReward += reward;
    totalExperiences++;
    
    // Decay epsilon
    if (epsilon > CONFIG.EPSILON_MIN) {
      const decay = totalExperiences > 100 ? CONFIG.EPSILON_DECAY_FAST : CONFIG.EPSILON_DECAY;
      epsilon *= decay;
    }
    
    return reward;
  }

  /**
   * Store experience and train DQN
   */
  function learnFromExperience(state, action, reward, nextState, done) {
    if (!experienceReplay) {
      console.warn(`[RL Integration] ⚠️ Experience Replay not initialized`);
      return false;
    }
    
    if (!dqnAgent) {
      console.warn(`[RL Integration] ⚠️ DQN Agent not initialized`);
      return false;
    }

    // Store experience
    experienceReplay.add(state, action, reward, nextState, done);
    const bufferSize = experienceReplay.size();

    // Train if we have enough experiences
    if (experienceReplay.canTrain()) {
      const batch = experienceReplay.sample();
      if (batch.length > 0) {
        const loss = dqnAgent.train(batch);
        const metrics = getMetrics();
        
        if (totalExperiences % 10 === 0) {
          console.log(`[RL Integration] 📚 Training step ${totalExperiences} | Buffer: ${bufferSize} | Batch: ${batch.length} | Loss: ${loss.toFixed(4)} | Win Rate: ${metrics.winRate.toFixed(1)}%`);
        } else {
          console.log(`[RL Integration] 📚 Training step ${totalExperiences} | Buffer: ${bufferSize} | Batch: ${batch.length} | Loss: ${loss.toFixed(4)}`);
        }
        return true;
      } else {
        console.warn(`[RL Integration] ⚠️ Empty batch sampled from ${bufferSize} experiences`);
        return false;
      }
    } else {
      console.log(`[RL Integration] 📦 Experience stored (${bufferSize}/${experienceReplay.MIN_EXPERIENCES} needed for training)`);
      return true; // Experience stored, but not enough for training yet
    }
  }

  function getRecommendedAction(ohlcData, regimeData) {
    const state = encodeState(ohlcData, regimeData);
    const actionIndex = selectAction(state);
    const groups = window.IndicatorGroups.getAllGroups();
    const selectedGroup = groups[actionIndex];
    
    // Store state and action for learning
    // IMPORTANT: These are used later in onSignalVerified() for learning
    lastState = [...state]; // Create a copy to prevent mutation
    lastAction = actionIndex;
    
    console.log(`[RL Integration] 💾 Stored state and action for learning: Action=${actionIndex} (${selectedGroup.name})`);
    
    // Get Q-values for confidence estimation
    let confidence = 75;
    if (dqnAgent) {
      const qValues = dqnAgent.getQValues(state);
      const maxQ = Math.max(...qValues);
      const minQ = Math.min(...qValues);
      if (maxQ !== minQ) {
        // Better confidence calculation based on Q-value distribution
        const qValue = qValues[actionIndex];
        // Advantage vs second-best to drive high-confidence gating
        const sorted = [...qValues].sort((a, b) => b - a);
        const secondQ = sorted.length > 1 ? sorted[1] : minQ;
        const advRaw = qValue - secondQ;
        const span = maxQ - minQ || 1;
        lastQAdvantage = Math.max(0, advRaw / span);
        const normalizedQ = (qValue - minQ) / span;
        confidence = 60 + Math.min(35, normalizedQ * 35); // 60-95% range
      } else {
        lastQAdvantage = 0;
      }
    } else {
      lastQAdvantage = 0;
    }

    // Bandit weight adjustment
    const banditWeight = getBanditWeight(selectedGroup.id);
    confidence = Math.max(40, Math.min(95, Math.round(confidence * banditWeight)));
    
    // Dynamic expiry calculation based on volatility
    let expiry = 300; // Default 5 minutes
    const TI = window.TechnicalIndicators;
    if (ohlcData && ohlcData.length >= 50) {
      const closes = ohlcData.map(c => c.c);
      const highs = ohlcData.map(c => c.h);
      const lows = ohlcData.map(c => c.l);
      const atr = TI.calculateATR(highs, lows, closes, 14);
      const avgPrice = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      
      if (atr && avgPrice > 0) {
        const volatilityRatio = (atr / avgPrice) * 100;
        
        // Adjust expiry based on volatility
        // Low volatility: longer expiry (6-7 min)
        // High volatility: shorter expiry (3-4 min)
        if (volatilityRatio < 0.3) {
          expiry = 360 + Math.floor(Math.random() * 60); // 6-7 min
        } else if (volatilityRatio < 0.7) {
          expiry = 300; // 5 min (default)
        } else {
          expiry = 180 + Math.floor(Math.random() * 60); // 3-4 min
        }
      }
    }
    
    return {
      groupId: selectedGroup.id,
      groupName: selectedGroup.name,
      actionIndex: actionIndex,
      confidence: Math.round(confidence),
      expiry: expiry,
      state: state,
      patterns: lastPatternSnapshot,
      risk: lastRiskSnapshot,
      qAdvantage: lastQAdvantage
    };
  }

  /**
   * Called after signal verification to learn from the outcome
   */
  function onSignalVerified(result, signalConfidence, ohlcData, regimeData) {
    if (!lastState || lastAction === null) {
      console.warn(`[RL Integration] ⚠️ Cannot learn: missing lastState or lastAction. State: ${lastState ? 'OK' : 'NULL'}, Action: ${lastAction !== null ? lastAction : 'NULL'}`);
      return;
    }

    console.log(`[RL Integration] 🧠 Learning from signal: Action=${lastAction}, Result=${result}, Confidence=${signalConfidence}%`);

    // Calculate reward
    const stability = regimeData ? window.MarketRegimeDetector.getRegimeStability() : 50;
    const reward = calculateReward(result, signalConfidence, { stability });

    // Get next state (current market state)
    const nextState = ohlcData ? encodeState(ohlcData, regimeData) : null;
    const done = true; // Signal verification marks end of episode

    // Learn from experience
    const experienceAdded = learnFromExperience(lastState, lastAction, reward, nextState, done);
    
    if (experienceAdded) {
      console.log(`[RL Integration] ✅ Experience stored and training triggered. Reward: ${reward.toFixed(2)}, Total experiences: ${totalExperiences}`);
    } else {
      console.warn(`[RL Integration] ⚠️ Experience not stored - check Experience Replay and DQN Agent`);
    }

    // Bandit update for the indicator group used
    if (window.IndicatorGroups && typeof lastAction === 'number') {
      const groups = window.IndicatorGroups.getAllGroups();
      const group = groups[lastAction];
      if (group && group.id) {
        updateBanditWeight(group.id, result, signalConfidence || 70);
      }
    }

    // Reset for next signal
    lastState = null;
    lastAction = null;
  }

  function getTopActions(state, n = 3) {
    if (!dqnAgent) return [];
    
    const topActions = dqnAgent.getTopNActions(state, n);
    const groups = window.IndicatorGroups.getAllGroups();
    
    return topActions.map(a => ({
      action: a.action,
      groupId: groups[a.action]?.id || `Group_${a.action}`,
      qValue: a.qValue
    }));
  }

  function getMetrics() {
    const total = sessionWins + sessionLosses;
    return {
      sessionWins,
      sessionLosses,
      winRate: total > 0 ? (sessionWins / total) * 100 : 0,
      cumulativeReward,
      epsilon,
      totalExperiences,
      currentStreak,
      maxStreak,
      risk: lastRiskSnapshot,
      patterns: lastPatternSnapshot
    };
  }

  function getLastQAdvantage() {
    return lastQAdvantage || 0;
  }

  async function initialize() {
    if (isInitialized) return;

    CONFIG.ACTION_DIMENSION = resolveActionDim();
    loadBanditWeights();
    
    // Initialize Experience Replay
    if (window.ExperienceReplay) {
      experienceReplay = window.ExperienceReplay.getInstance();
    }
    
    // Initialize DQN Agent
    const { DQNAgent } = window.DQNNetwork;
    dqnAgent = new DQNAgent();
    
    // Load saved state
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LOAD_RL_STATE' });
      if (response && response.data) {
        const savedState = response.data;
        if (savedState.weights && dqnAgent) {
          const w1 = savedState.weights.W1;
          const w2 = savedState.weights.W2;
          const w3 = savedState.weights.W3;
          const outputWidth = getMatrixRowLength(w3);
          const config = window.DQNNetwork && window.DQNNetwork.CONFIG ? window.DQNNetwork.CONFIG : null;
          const hidden1Size = getMatrixRowLength(w1);
          const hidden2Size = getMatrixRowLength(w2);
          const expectedHidden1 = config ? config.HIDDEN_DIM : hidden1Size;
          const expectedHidden2 = config ? config.HIDDEN_DIM_2 : hidden2Size;
          const shapeOk = w1 && w2 && w3 &&
                          w1.length === CONFIG.STATE_DIMENSION &&
                          hidden1Size === expectedHidden1 &&
                          w2.length === expectedHidden1 &&
                          hidden2Size === expectedHidden2 &&
                          outputWidth === resolveActionDim();
          if (shapeOk) {
            dqnAgent.setWeights(savedState.weights);
          } else {
            console.warn('[RL Integration] Saved weights shape mismatch, skipping restore to avoid dimension errors');
          }
        }
        epsilon = savedState.epsilon || CONFIG.EPSILON;
        sessionWins = savedState.sessionWins || 0;
        sessionLosses = savedState.sessionLosses || 0;
        currentStreak = savedState.currentStreak || 0;
        maxStreak = savedState.maxStreak || 0;
        cumulativeReward = savedState.cumulativeReward || 0;
        totalExperiences = savedState.totalExperiences || 0;
      }
    } catch (e) {
      console.warn('[RL Integration] Failed to load saved state:', e);
    }
    
    isInitialized = true;
    console.log('[RL Integration] Initialized with Experience Replay and Training');
  }

  async function saveState() {
    if (!dqnAgent) return;
    
    try {
      const state = {
        weights: dqnAgent.getWeights(),
        epsilon,
        sessionWins,
        sessionLosses,
        currentStreak,
        maxStreak,
        cumulativeReward,
        totalExperiences
      };
      
      await chrome.runtime.sendMessage({ type: 'SAVE_RL_STATE', data: state });
    } catch (e) {
      console.warn('[RL Integration] Failed to save state:', e);
    }
  }

  function resetSession() {
    sessionWins = 0;
    sessionLosses = 0;
    currentStreak = 0;
    cumulativeReward = 0;
    console.log('[RL Integration] Session reset');
  }

  // Helper functions to get/set learning state (for protection against overwriting)
  function getLastState() {
    return lastState ? [...lastState] : null;
  }

  function getLastAction() {
    return lastAction;
  }

  function setLearningState(state, action) {
    lastState = state ? [...state] : null;
    lastAction = action;
    console.log(`[RL Integration] 🔄 Learning state restored: Action=${action}`);
  }

  return {
    initialize,
    encodeState,
    selectAction,
    calculateReward,
    getRecommendedAction,
    getTopActions,
    getMetrics,
    getLastQAdvantage,
    saveState,
    resetSession,
    onSignalVerified,
    learnFromExperience,
    getLastState,
    getLastAction,
    setLearningState,
    getBanditWeight,
    shouldExploreFallback,
    warmupBanditFromHistory
  };
})();

console.log('[Pocket Scout Dynamic Time] Enhanced RL Integration loaded with training');
