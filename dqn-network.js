/**
 * Pocket Scout Dynamic Time - Enhanced DQN Network
 * Deep Q-Network with training capability for RL Agent
 */

window.DQNNetwork = (function() {
  'use strict';

  const CONFIG = {
    STATE_DIM: 16, // Enhanced: 12 -> 16 dimensions
    HIDDEN_DIM: 64,
    HIDDEN_DIM_2: 32,
    ACTION_DIM: 18, // Updated dynamically below based on indicator groups
    LEARNING_RATE: 0.001,
    TAU: 0.005,
    GAMMA: 0.95
  };

  function resolveActionDim() {
    if (window.IndicatorGroups && window.IndicatorGroups.getGroupCount) {
      return window.IndicatorGroups.getGroupCount();
    }
    return CONFIG.ACTION_DIM;
  }

  // Volatility adaptivity constants: allow modest boost during noisy markets without exploding gradients
  const MAX_VOLATILITY_BOOST = 1.5;
  const BASE_VOLATILITY_WEIGHT = 0.5;

  function getSafeArrayIndex(arr, index) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return Math.max(0, Math.min(index, arr.length - 1));
  }

  class NeuralNetwork {
    constructor(inputDim, hiddenDim, hiddenDim2, outputDim) {
      this.inputDim = inputDim;
      this.hiddenDim = hiddenDim;
      this.hiddenDim2 = hiddenDim2;
      this.outputDim = outputDim;
      
      this.W1 = this._initWeights(inputDim, hiddenDim);
      this.b1 = new Array(hiddenDim).fill(0);
      this.W2 = this._initWeights(hiddenDim, hiddenDim2);
      this.b2 = new Array(hiddenDim2).fill(0);
      this.W3 = this._initWeights(hiddenDim2, outputDim);
      this.b3 = new Array(outputDim).fill(0);
    }
    
    _initWeights(rows, cols) {
      const limit = Math.sqrt(6 / (rows + cols));
      const weights = [];
      for (let i = 0; i < rows; i++) {
        weights[i] = [];
        for (let j = 0; j < cols; j++) {
          weights[i][j] = (Math.random() * 2 - 1) * limit;
        }
      }
      return weights;
    }
    
    _relu(x) {
      return Math.max(0, x);
    }
    
    predict(state) {
      const h1 = new Array(this.hiddenDim);
      for (let j = 0; j < this.hiddenDim; j++) {
        let sum = this.b1[j];
        for (let i = 0; i < this.inputDim; i++) {
          sum += state[i] * this.W1[i][j];
        }
        h1[j] = this._relu(sum);
      }
      
      const h2 = new Array(this.hiddenDim2);
      for (let j = 0; j < this.hiddenDim2; j++) {
        let sum = this.b2[j];
        for (let i = 0; i < this.hiddenDim; i++) {
          sum += h1[i] * this.W2[i][j];
        }
        h2[j] = this._relu(sum);
      }
      
      const output = new Array(this.outputDim);
      for (let j = 0; j < this.outputDim; j++) {
        let sum = this.b3[j];
        for (let i = 0; i < this.hiddenDim2; i++) {
          sum += h2[i] * this.W3[i][j];
        }
        output[j] = sum;
      }
      
      return output;
    }
    
    getWeights() {
      return {
        W1: JSON.parse(JSON.stringify(this.W1)),
        b1: [...this.b1],
        W2: JSON.parse(JSON.stringify(this.W2)),
        b2: [...this.b2],
        W3: JSON.parse(JSON.stringify(this.W3)),
        b3: [...this.b3]
      };
    }
    
    setWeights(weights) {
      if (!weights) return;
      this.W1 = weights.W1 ? JSON.parse(JSON.stringify(weights.W1)) : this.W1;
      this.b1 = weights.b1 ? [...weights.b1] : this.b1;
      this.W2 = weights.W2 ? JSON.parse(JSON.stringify(weights.W2)) : this.W2;
      this.b2 = weights.b2 ? [...weights.b2] : this.b2;
      this.W3 = weights.W3 ? JSON.parse(JSON.stringify(weights.W3)) : this.W3;
      this.b3 = weights.b3 ? [...weights.b3] : this.b3;
    }
    
    copyFrom(source) {
      this.setWeights(source.getWeights());
    }
  }

  class DQNAgent {
    constructor() {
      CONFIG.ACTION_DIM = resolveActionDim();

      this.onlineNetwork = new NeuralNetwork(
        CONFIG.STATE_DIM,
        CONFIG.HIDDEN_DIM,
        CONFIG.HIDDEN_DIM_2,
        CONFIG.ACTION_DIM
      );
      
      this.targetNetwork = new NeuralNetwork(
        CONFIG.STATE_DIM,
        CONFIG.HIDDEN_DIM,
        CONFIG.HIDDEN_DIM_2,
        CONFIG.ACTION_DIM
      );
      
      this.targetNetwork.copyFrom(this.onlineNetwork);
      this.trainSteps = 0;
    }
    
    getQValues(state) {
      return this.onlineNetwork.predict(state);
    }
    
    selectBestAction(state) {
      const qValues = this.getQValues(state);
      let bestAction = 0;
      let maxQ = qValues[0];
      
      for (let i = 1; i < qValues.length; i++) {
        if (qValues[i] > maxQ) {
          maxQ = qValues[i];
          bestAction = i;
        }
      }
      
      return { action: bestAction, qValue: maxQ, allQValues: qValues };
    }
    
    getTopNActions(state, n = 3) {
      const qValues = this.getQValues(state);
      const indexed = qValues.map((q, i) => ({ action: i, qValue: q }));
      indexed.sort((a, b) => b.qValue - a.qValue);
      return indexed.slice(0, n);
    }
    
    softUpdate() {
      const onlineWeights = this.onlineNetwork.getWeights();
      const targetWeights = this.targetNetwork.getWeights();
      
      for (const key of ['W1', 'W2', 'W3', 'b1', 'b2', 'b3']) {
        if (Array.isArray(onlineWeights[key][0])) {
          for (let i = 0; i < onlineWeights[key].length; i++) {
            for (let j = 0; j < onlineWeights[key][i].length; j++) {
              targetWeights[key][i][j] = CONFIG.TAU * onlineWeights[key][i][j] + 
                                         (1 - CONFIG.TAU) * targetWeights[key][i][j];
            }
          }
        } else {
          for (let i = 0; i < onlineWeights[key].length; i++) {
            targetWeights[key][i] = CONFIG.TAU * onlineWeights[key][i] + 
                                   (1 - CONFIG.TAU) * targetWeights[key][i];
          }
        }
      }
      
      this.targetNetwork.setWeights(targetWeights);
    }
    
    getWeights() {
      return this.onlineNetwork.getWeights();
    }
    
    setWeights(weights) {
      this.onlineNetwork.setWeights(weights);
      this.targetNetwork.setWeights(weights);
    }

    /**
     * Train the network on a batch of experiences
     * Simplified gradient descent for browser environment
     */
    train(batch) {
      if (!batch || batch.length === 0) return 0;

      let totalLoss = 0;
      const learningRate = CONFIG.LEARNING_RATE;

      // Process each experience in the batch
      for (const exp of batch) {
        const { state, action, reward, nextState, done } = exp;

        // Get current Q-value for the action taken
        const currentQValues = this.onlineNetwork.predict(state);
        const currentQ = currentQValues[action];

        // Calculate target Q-value
        let targetQ = reward;
        if (!done && nextState) {
          // Double DQN: action selection from online net, evaluation from target net
          const onlineNext = this.onlineNetwork.predict(nextState);
          let bestNextAction = 0;
          let bestOnlineQ = onlineNext[0];
          for (let i = 1; i < onlineNext.length; i++) {
            if (onlineNext[i] > bestOnlineQ) {
              bestOnlineQ = onlineNext[i];
              bestNextAction = i;
            }
          }
          const targetNext = this.targetNetwork.predict(nextState);
          const safeIndex = getSafeArrayIndex(targetNext, bestNextAction);
          const nextQ = safeIndex !== null && targetNext.length > 0 ? targetNext[safeIndex] : 0;
          targetQ = reward + CONFIG.GAMMA * nextQ;
        }

        // Calculate TD error
        const tdError = targetQ - currentQ;
        totalLoss += Math.abs(tdError);

        // Simplified gradient update (approximation)
        // In full implementation, this would use backpropagation
        // For browser, we use a simplified update
        // Adaptive learning rate for volatility-heavy states (state[1] is ATR-normalized)
        const volatilityFactor = state && state[1] ? Math.min(MAX_VOLATILITY_BOOST, BASE_VOLATILITY_WEIGHT + state[1]) : 1;
        this._updateWeights(state, action, tdError, learningRate * volatilityFactor);
      }

      // Soft update target network
      this.softUpdate();
      this.trainSteps++;

      return totalLoss / batch.length;
    }

    /**
     * Simplified weight update (approximation of gradient descent)
     */
    _updateWeights(state, action, tdError, learningRate) {
      // Simplified update: adjust weights based on TD error
      // This is an approximation - full backprop would be more accurate
      const weights = this.onlineNetwork.getWeights();
      const adjustment = tdError * learningRate * 0.1; // Scaled down for stability

      // Update output layer weights for the specific action
      if (weights.W3 && weights.W3.length > 0) {
        const stateLen = state.length;
        for (let i = 0; i < weights.W3.length && i < stateLen; i++) {
          if (weights.W3[i] && weights.W3[i][action] !== undefined) {
            weights.W3[i][action] += adjustment * state[i] * 0.01;
          }
        }
      }

      if (weights.b3 && weights.b3[action] !== undefined) {
        weights.b3[action] += adjustment;
      }

      this.onlineNetwork.setWeights(weights);
    }
  }

  return {
    DQNAgent,
    CONFIG
  };
})();

console.log('[Pocket Scout Dynamic Time] Enhanced DQN Network loaded with training');
