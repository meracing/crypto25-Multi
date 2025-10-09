# WebSocket Re-Subscription Fix

## Problem
Individual WebSocket subscriptions (channels) were silently dying after several hours of operation, while other channels continued working. For example:
- 3 out of 4 assets would stop receiving updates after ~12 hours
- FORM-EUR would continue working while SOL-EUR, BNB-EUR, LINK-EUR stopped
- Main WebSocket connection remained alive (no error/close events)
- Assets stuck with stale data for hours (42474 seconds = 11.8 hours)

## Root Cause
The Bitvavo WebSocket library uses a **single WebSocket connection** with multiple subscription "channels" (one per market). Individual channels can timeout or be dropped by the server while the main connection stays alive. The library doesn't detect or recover from this automatically.

## Solution Implemented

### 1. Stale Subscription Detection
- Track `lastPriceUpdate` timestamp for each asset
- Every second, check if any asset hasn't received updates for 60+ seconds
- Log warnings when staleness is detected

### 2. Automatic Re-Subscription
When an asset goes stale (no updates for >60 seconds):
1. Call `client.websocket.subscriptionTicker()` again for that market
2. Re-establish the callback handler
3. Reset the `lastPriceUpdate` timestamp
4. Continue trading seamlessly

### 3. Monitoring
The bot now logs:
```
⚠️  [SOL-EUR] WebSocket subscription STALE (no updates for 75s)
🔧 [SOL-EUR] Attempting automatic re-subscription...
🔄 [SOL-EUR] Re-subscribing to fix stale subscription...
✅ [SOL-EUR] Re-subscribed successfully
✅ [SOL-EUR] Re-subscription successful, data should resume
```

## Expected Behavior

### Before Fix
- Assets silently stopped updating after hours
- Trading continued with stale prices (very dangerous!)
- Only fix: restart entire bot

### After Fix
- Stale subscriptions detected within 60 seconds
- Automatic re-subscription attempts
- Trading continues with fresh data
- No manual intervention required

## Technical Details

**Detection Logic:**
```javascript
const timeSinceUpdate = now - (asset.lastPriceUpdate || asset.lastCheckTime || now);
if (timeSinceUpdate > 60000) {
    // Re-subscribe
}
```

**Re-Subscription Function:**
```javascript
async function resubscribeToMarket(asset) {
    client.websocket.subscriptionTicker(asset.market, (ticker) => {
        // New callback handler
        currentAsset.latestPrice = cp;
        currentAsset.lastPriceUpdate = Date.now();
    });
}
```

## Testing Recommendations

1. **Run bot for 24+ hours** with 3-4 assets
2. **Monitor logs** for re-subscription events
3. **Verify all charts** continue updating in browser
4. **Check no stale warnings** persist after re-subscription

## Known Limitations

- If re-subscription fails, bot continues with stale data
- No limit on re-subscription attempts (could theoretically loop)
- Bitvavo library doesn't provide subscription health API

## Future Improvements

- Add max re-subscription attempts before alerting user
- Implement full WebSocket reconnection if all channels go stale
- Consider using separate WebSocket connections per asset
- Add Telegram/email alerts when re-subscription happens

## Related Files
- `index.js` - Main implementation
- `WEBSOCKET_FIX.md` - Previous WebSocket connection fixes
- `STABILITY_NOTES.md` - General stability improvements
