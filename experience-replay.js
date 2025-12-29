/**
 * Pocket Scout Dynamic Time - Experience Replay Buffer
 * Stores and samples experiences for DQN training
 */

window.ExperienceReplay = (function() {
  'use strict';

  const BUFFER_SIZE = 1000;
  const BATCH_SIZE = 32;
  const MIN_EXPERIENCES = 50; // Minimum experiences before training

  class ExperienceReplayBuffer {
    constructor(maxSize = BUFFER_SIZE) {
      this.buffer = [];
      this.maxSize = maxSize;
    }

    add(state, action, reward, nextState, done) {
      const experience = {
        state: [...state],
        action,
        reward,
        nextState: nextState ? [...nextState] : null,
        done
      };

      this.buffer.push(experience);
      
      if (this.buffer.length > this.maxSize) {
        this.buffer.shift();
      }
    }

    sample(batchSize = BATCH_SIZE) {
      if (this.buffer.length < batchSize) {
        return [];
      }

      const batch = [];
      const indices = new Set();
      
      while (indices.size < batchSize) {
        const idx = Math.floor(Math.random() * this.buffer.length);
        indices.add(idx);
      }
      
      for (const idx of indices) {
        batch.push(this.buffer[idx]);
      }
      
      return batch;
    }

    size() {
      return this.buffer.length;
    }

    clear() {
      this.buffer = [];
    }

    canTrain() {
      return this.buffer.length >= MIN_EXPERIENCES;
    }
  }

  let instance = null;

  function getInstance() {
    if (!instance) {
      instance = new ExperienceReplayBuffer(BUFFER_SIZE);
    }
    return instance;
  }

  return {
    getInstance,
    BUFFER_SIZE,
    BATCH_SIZE,
    MIN_EXPERIENCES
  };
})();

console.log('[Pocket Scout Dynamic Time] Experience Replay Buffer loaded');

