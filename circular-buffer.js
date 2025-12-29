/**
 * Pocket Scout Time - Circular Buffer for M1 Candles
 * Simplified version - 2000 candles capacity
 */

window.CircularBuffer = (function() {
  'use strict';

  const MAX_CANDLES = 2000;

  class CandleBuffer {
    constructor(maxSize = MAX_CANDLES) {
      this.maxSize = maxSize;
      this.buffer = new Array(maxSize);
      this.head = 0;
      this.tail = 0;
      this.size = 0;
      this.isFull = false;
    }

    push(candle) {
      this.buffer[this.head] = candle;
      
      if (this.isFull) {
        this.tail = (this.tail + 1) % this.maxSize;
      } else {
        this.size++;
        if (this.size === this.maxSize) {
          this.isFull = true;
        }
      }
      
      this.head = (this.head + 1) % this.maxSize;
    }

    updateLast(updates) {
      if (this.size === 0) return;
      
      const lastIndex = this.head === 0 ? this.maxSize - 1 : this.head - 1;
      const lastCandle = this.buffer[lastIndex];
      
      if (lastCandle) {
        if (updates.h !== undefined) lastCandle.h = Math.max(lastCandle.h, updates.h);
        if (updates.l !== undefined) lastCandle.l = Math.min(lastCandle.l, updates.l);
        if (updates.c !== undefined) lastCandle.c = updates.c;
      }
    }

    toArray() {
      if (this.size === 0) return [];
      
      const result = [];
      for (let i = 0; i < this.size; i++) {
        const index = (this.tail + i) % this.maxSize;
        result.push(this.buffer[index]);
      }
      
      return result;
    }

    getLastCandle() {
      if (this.size === 0) return null;
      const lastIndex = this.head === 0 ? this.maxSize - 1 : this.head - 1;
      return this.buffer[lastIndex];
    }
  }

  let instance = null;

  function getInstance() {
    if (!instance) {
      const buffer = new CandleBuffer(MAX_CANDLES);
      
      instance = {
        add: (candle) => buffer.push(candle),
        getAll: () => buffer.toArray(),
        getLatest: () => buffer.getLastCandle(),
        size: () => buffer.size,
        capacity: MAX_CANDLES,
        updateLast: (updates) => buffer.updateLast(updates)
      };
    }
    return instance;
  }

  return { getInstance, MAX_CANDLES };
})();

console.log('[Pocket Scout Time] Circular Buffer loaded - 2000 candles capacity');

