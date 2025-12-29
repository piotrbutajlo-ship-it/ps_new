/**
 * Pocket Scout Time - Popup Script
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
        metricsDiv.innerHTML = `<div style="opacity:0.7;">Error: ${chrome.runtime.lastError.message}</div>`;
        return;
      }
      
      if (response && response.metrics) {
        const m = response.metrics;
        const regime = response.regime;
        const risk = response.risk;
        const patterns = response.patterns;
        const riskText = risk && risk.ratio ? `${(risk.ratio * 100).toFixed(2)}% (${risk.level})` : 'n/a';
        const patternText = patterns && patterns.patterns && patterns.patterns.length ? patterns.patterns.join(', ') : 'None';
        const regimeText = regime && regime.trend ? regime.trend.direction : 'NEUTRAL';
        metricsDiv.innerHTML = `
          <div class="metric">
            <div class="metric-label">Win Rate</div>
            <div class="metric-value">${m.winRate.toFixed(1)}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Wins / Losses</div>
            <div class="metric-value">${m.sessionWins} / ${m.sessionLosses}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Current Streak</div>
            <div class="metric-value">${m.currentStreak}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Epsilon (Exploration)</div>
            <div class="metric-value">${(m.epsilon * 100).toFixed(1)}%</div>
          </div>
          <div class="metric">
            <div class="metric-label">Total Experiences</div>
            <div class="metric-value">${m.totalExperiences || 0}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Volatility</div>
            <div class="metric-value">${riskText}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Regime</div>
            <div class="metric-value">${regimeText}</div>
          </div>
          <div class="metric">
            <div class="metric-label">Patterns</div>
            <div class="metric-value" style="font-size:11px;">${patternText}</div>
          </div>
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
