/**
 * Pocket Scout v3.0 - Popup Script
 */

function updateMetrics() {
  const metricsDiv = document.getElementById('metrics');
  
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      metricsDiv.innerHTML = '<div style="opacity:0.7;">No active tab found</div>';
      return;
    }
    
    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_METRICS' }, (response) => {
      if (chrome.runtime.lastError) {
        metricsDiv.innerHTML = `<div style="opacity:0.7;">Please open PocketOption.com first</div>`;
        return;
      }
      
      if (response && response.metrics) {
        const m = response.metrics;
        const lastSignal = response.lastSignal;
        const wrColor = m.winRate >= 60 ? '#10b981' : m.winRate >= 50 ? '#f59e0b' : '#ef4444';
        
        metricsDiv.innerHTML = `
          <div class="metric">
            <div class="metric-label">Win Rate</div>
            <div class="metric-value" style="color:${wrColor};">${m.winRate.toFixed(1)}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Total Signals</div>
            <div class="metric-value">${m.totalSignals}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Wins / Losses</div>
            <div class="metric-value">${m.wins} / ${m.losses}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Signal Interval</div>
            <div class="metric-value">${m.currentInterval} min</div>
          </div>
          <div class="metric">
            <div class="metric-label">Candles Collected</div>
            <div class="metric-value">${response.candles}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Warmup Status</div>
            <div class="metric-value">${response.warmupComplete ? '✅ Complete' : '🔥 In Progress'}</div>
          </div>
          ${lastSignal ? `
          <div class="metric">
            <div class="metric-label">Last Signal</div>
            <div class="metric-value" style="color:${lastSignal.action === 'BUY' ? '#10b981' : '#ef4444'};">
              ${lastSignal.action} @ ${lastSignal.confidence}%
            </div>
          </div>
          ` : ''}
        `;
      } else {
        metricsDiv.innerHTML = '<div style="opacity:0.7;">No data available - waiting for signals...</div>';
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Initial update
  updateMetrics();
  
  // Auto-refresh every 2 seconds
  setInterval(updateMetrics, 2000);
});
