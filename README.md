# Pocket Scout v3.0 - Chrome Extension

**10-Minute Cyclic Signals with Multi-Indicator Analysis**  
*by Claude Opus*

## Features

- ✅ **Cyclic Signal Generation**: Generates trading signals every 10 minutes automatically
- 📊 **Multi-Indicator Analysis**: Uses 5 proven technical indicators (RSI, MACD, EMA, Bollinger Bands, ADX)
- 🎯 **Confidence-Based Filtering**: Only shows signals with ≥70% confidence
- 🤖 **Auto Trader Integration**: Publishes signals with ≥75% confidence to Auto Trader
- ⏱️ **Dynamic Duration**: Entry time (1-5 minutes) adapts to market conditions
- 📈 **Signal History**: Tracks last 10 signals for reference
- 🔄 **Real-Time Countdown**: Shows time until next signal generation

## Installation

### Chrome Browser

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked"
5. Select the folder containing this extension
6. Navigate to `https://pocketoption.com/`
7. The Pocket Scout panel will appear in the top-right corner

## How It Works

### Data Collection
- Collects price every 1 second from PocketOption
- Builds 1-minute (M1) candles automatically
- Requires 50 M1 candles (~50 minutes warmup) before generating signals

### Signal Generation (Every 10 Minutes)

The extension analyzes 5 technical indicators using a **voting system**:

1. **RSI (14)**: 
   - RSI < 30 = BUY vote
   - RSI > 70 = SELL vote

2. **MACD (12, 26, 9)**:
   - Histogram > 0 = BUY vote
   - Histogram < 0 = SELL vote

3. **EMA Crossover (9/21)**:
   - EMA9 > EMA21 = BUY vote
   - EMA9 < EMA21 = SELL vote

4. **Bollinger Bands (20, 2)**:
   - Price at lower band = BUY vote
   - Price at upper band = SELL vote

5. **ADX (14)**:
   - ADX > 25 = Strengthens signal confidence by 10%

### Confidence Calculation

```
Confidence = (|Total Votes| / Max Possible Votes) × 100 + ADX Boost
```

- **Display Threshold**: ≥70% confidence
- **Auto Trader Threshold**: ≥75% confidence

### Entry Duration

Duration adapts to market conditions:

- **5 minutes**: Strong trend (ADX > 30)
- **3 minutes**: Normal conditions (default)
- **1-2 minutes**: High volatility (ATR/price > 1.5%)

## Panel Interface

### Status Section
- **Current Price**: Real-time price from PocketOption
- **Warmup Status**: Progress collecting initial candles
- **M1 Candles**: Number of 1-minute candles collected

### Countdown Timer
- Shows time remaining until next signal (10-minute cycle)
- Updates every second

### Current Signal
- **Action**: BUY or SELL
- **Confidence**: Signal strength (70-95%)
- **Duration**: Entry time (1-5 minutes)
- **Entry Price**: Price when signal was generated
- **Reasons**: Top 5 indicator confirmations
- **Volatility & ADX**: Current market metrics

### History
- Last 5 signals with timestamps
- Confidence and duration for each

## Auto Trader Integration

Signals with confidence ≥75% are automatically published to `localStorage` under key `PS_AT_FEED`:

```javascript
{
  action: 'BUY' | 'SELL',
  confidence: 75-95,
  duration: 1-5,
  timestamp: Date.now(),
  entryPrice: number
}
```

## Technical Details

### Files Structure
```
├── manifest.json              # Extension configuration
├── content.js                 # Main logic and UI
├── circular-buffer.js         # Candle storage
├── technical-indicators.js    # Indicator calculations
├── cyclic-decision-engine.js  # 10-minute timer
├── background.js              # Service worker
└── popup.html/popup.js        # Extension popup
```

### Dependencies
- No external libraries required
- Pure JavaScript implementation
- All indicators calculated locally

### Browser Compatibility
- Chrome/Chromium browsers (Manifest V3)
- Tested on Chrome 120+

## Development

### Testing Indicator Logic
```bash
node test-indicator-logic.js
```

### Preview UI
Open `preview.html` in a browser to see panel mockups.

## License

This is a private project. All rights reserved.

## Credits

**Pocket Scout v3.0** - Created by Claude Opus  
Technical indicator implementations based on standard TA-Lib formulas.

---

*For questions or support, please contact the repository owner.*
