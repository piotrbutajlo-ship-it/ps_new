# Pocket Scout v3.0 - Quick Start Guide

## Installation (Chrome)

1. **Download/Clone Repository**
   ```bash
   git clone <repository-url>
   cd ps_new
   ```

2. **Load Extension in Chrome**
   - Open Chrome browser
   - Navigate to: `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked" button
   - Select the `ps_new` folder
   - Extension should appear in your extensions list

3. **Navigate to PocketOption**
   - Go to: `https://pocketoption.com/`
   - Log in to your account
   - The Pocket Scout panel will automatically appear in the top-right corner

## First Use

### Warmup Phase (50 minutes)
When you first load the page, you'll see:
- "Warmup in Progress" message
- Progress bar showing candle collection (0/50 → 50/50)
- Current price updating every second

**Why warmup?** The extension needs 50 minutes of price data (50 M1 candles) to calculate technical indicators accurately.

### After Warmup
Once warmup completes:
- Countdown timer appears (shows time to next signal)
- First signal generates immediately
- New signals every 10 minutes thereafter

## Understanding the Panel

### Top Section
- **Pocket Scout v3.0**: Extension name
- **by Claude Opus**: Creator signature
- **LIVE**: Status indicator (red badge)

### Status Box
- **Current Price**: Real-time price from PocketOption
- **Warmup**: Complete ✅ or In Progress 🔥
- **M1 Candles**: Number collected / needed

### Countdown Timer
- Shows time until next signal: `MM:SS`
- Counts down from 10:00 to 00:00
- Resets after each signal

### Current Signal Box
- **Action**: BUY or SELL (large, colored)
- **Duration**: Entry time in minutes (1-5 MIN)
- **Confidence**: Signal strength (70-95%)
- **Entry Price**: Price when signal was generated
- **Reasons**: Why the signal was generated (indicators)
- **Volatility & ADX**: Market condition metrics

### History Section
- Last 5 signals with timestamps
- Shows confidence and duration for each

## Signal Quality

### Confidence Levels
- **70-74%**: Displayed in panel only (not sent to Auto Trader)
- **75%+**: High confidence - sent to Auto Trader
- **80%+**: Very high confidence
- **90%+**: Extremely strong signal

### When to Trade
✅ **Good to trade:**
- Confidence ≥ 75%
- All/most indicators agree (check reasons)
- Normal to moderate volatility

⚠️ **Consider skipping:**
- Confidence 70-74% (borderline)
- Only 2-3 indicators agree
- Extreme volatility (>2%)

## Duration Guide

| Duration | Condition | When It Appears |
|----------|-----------|-----------------|
| 5 MIN | Strong trend | ADX > 30 |
| 3 MIN | Normal market | Default |
| 1-2 MIN | High volatility | ATR/price > 1.5% |

**Recommendation**: Use the suggested duration as your binary option expiry time.

## Auto Trader Integration

If you're using the Auto Trader:
- Signals with confidence ≥ 75% are automatically published
- Check `localStorage` key: `PS_AT_FEED`
- Format:
  ```json
  {
    "action": "BUY",
    "confidence": 78,
    "duration": 3,
    "timestamp": 1234567890,
    "entryPrice": 1.08456
  }
  ```

## Troubleshooting

### Panel Not Appearing
1. Refresh the page (F5)
2. Check extension is enabled in `chrome://extensions/`
3. Make sure you're on `pocketoption.com`

### Warmup Stuck
- Ensure PocketOption is displaying price data
- Check console for errors (F12 → Console tab)
- Refresh page to restart

### No Signals After Warmup
- Wait 1-2 minutes after warmup completes
- First signal generates immediately, then every 10 minutes
- Check console for any errors

### Price Shows "N/A"
- PocketOption page may not have loaded correctly
- Refresh the page
- Select a trading asset if none is selected

## Tips for Best Results

1. **Let it warm up**: Don't trade until 50 candles collected
2. **Watch confidence**: Higher is generally better
3. **Check reasons**: Make sure indicators make sense
4. **Monitor volatility**: Be cautious during extreme volatility
5. **Use duration**: Suggested entry time is optimized for conditions
6. **Track history**: Review past signals to learn patterns

## Technical Details

### Indicators Used
1. RSI (14) - Momentum oscillator
2. MACD (12,26,9) - Trend and momentum
3. EMA (9/21) - Moving average crossover
4. Bollinger Bands (20,2) - Volatility bands
5. ADX (14) - Trend strength

### Signal Generation
- **Frequency**: Every 10 minutes (600 seconds)
- **Method**: Indicator voting system
- **Threshold**: ≥70% confidence to display

### Data Collection
- **Frequency**: Every 1 second
- **Candle Type**: M1 (1-minute candles)
- **Storage**: Circular buffer (50 candles max)

## Support

If you encounter issues:
1. Check browser console for errors (F12)
2. Verify all files are present in extension folder
3. Try disabling/re-enabling the extension
4. Reload the extension in Chrome

---

**Version**: 3.0.0  
**Last Updated**: December 2024  
**Created by**: Claude Opus
