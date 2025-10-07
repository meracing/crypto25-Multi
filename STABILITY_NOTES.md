# WebSocket Stability & Reconnection Testing Guide

## 🔌 WebSocket Reconnection Improvements Made

### What Was Fixed:
1. **Robust reconnection logic** with up to 10 retry attempts
2. **Exponential backoff** (waits 3s, 6s, 9s... up to 30s between retries)
3. **Per-asset subscription retry** with 5 attempts each
4. **Proper state checking** before attempting subscriptions
5. **Delays between subscriptions** (500ms) to avoid overwhelming connection
6. **Error handling** for connection failures

### Reconnection Flow:
```
WebSocket Disconnects
    ↓
Error handler triggered (5 second delay)
    ↓
reconnectWebSocket() starts
    ↓
Attempt 1: Wait 3s → Try reconnect → Subscribe all assets
    ↓
If fails → Attempt 2: Wait 6s → Try reconnect → Subscribe all assets
    ↓
... up to 10 attempts (max 30s wait)
    ↓
If all fail: Shows error, trading stops
```

### Key Code Sections:
- **Error Handler**: Lines 521-529 in index.js
- **Reconnection Logic**: Lines 630-700 in index.js
- **Subscription Retry**: Lines 658-687 in index.js

## 📊 Monitoring During Long-Term Test

### Console Messages to Watch For:

**Good Signs (Normal Operation):**
```
✅ WebSocket is ready
✅ [ASSET] subscribed successfully
[ASSET] Collecting prices X/30
[ASSET] WebSocket initialized
All assets initialized, starting check loop...
```

**Reconnection Triggered:**
```
WebSocket error: [error details]
Attempting WebSocket reconnection after error...
🔄 Reconnecting WebSocket (attempt X/10)...
Waiting Xms before reconnection attempt...
Initializing new WebSocket connection...
✅ WebSocket reconnected successfully - all markets subscribed
```

**Warning Signs:**
```
❌ Failed to subscribe to [ASSET]
⛔ Max reconnection attempts reached
WebSocket connection failed after multiple attempts
```

## 🧪 Long-Term Test Checklist

### Before Starting Test:
- [ ] Verify API keys are correct in .env
- [ ] Check Bitvavo account has sufficient EUR balance (if real mode)
- [ ] Start in **test mode** for stability testing
- [ ] Select 2-3 assets (easier to monitor)
- [ ] Open browser console (F12) to see logs
- [ ] Note start time and wallet amount

### During Test (Check Every Few Hours):
- [ ] WebSocket still connected? (prices updating?)
- [ ] Any error messages in console?
- [ ] Trades still being executed?
- [ ] Wallet balance makes sense?
- [ ] Charts still rendering correctly?

### Things to Log:
Create a test log file with timestamps:
```
[Time] Event
-----------------------------------------
08:00  Started test - 3 assets, test mode
09:30  Still running, 2 trades executed
11:15  WebSocket disconnect detected
11:15  Reconnection successful after 6s
14:00  Still running, 5 trades total
...
```

## 🐛 Known Issues & Limitations

### WebSocket Can Disconnect Due To:
1. **Bitvavo API maintenance** (check status.bitvavo.com)
2. **Network issues** (WiFi drops, ISP problems)
3. **Idle timeout** (if no data for extended period)
4. **Bitvavo rate limits** (unlikely with current setup)

### Current Limitations:
- **No REST fallback** for multi-asset (WebSocket required)
- **Max 10 reconnection attempts** (then stops)
- **Manual restart needed** if all reconnects fail

### Recommended Test Duration:
- **Minimum**: 24 hours
- **Ideal**: 48-72 hours
- **Goal**: Catch at least 2-3 reconnection events

## 📈 Expected Behavior

### Bitvavo WebSocket Typically:
- Stays connected for **hours** without issues
- May disconnect during **maintenance windows** (usually announced)
- Reconnects **automatically** within seconds
- Handles **temporary network blips** gracefully

### What Success Looks Like:
✅ Bot runs for 24+ hours continuously
✅ Survives 2+ reconnection events
✅ Trades continue after reconnections
✅ No data loss or corruption
✅ Charts remain accurate
✅ Wallet balance stays consistent

## 🚨 Emergency Actions

### If WebSocket Fails to Reconnect:
1. Check browser console for errors
2. Check Bitvavo status: https://status.bitvavo.com
3. Check your internet connection
4. Restart bot: Ctrl+C → `node --experimental-modules index.js`

### If Strange Behavior Occurs:
1. **Stop trading immediately** (close browser/stop node)
2. Check Bitvavo account (real mode)
3. Review console logs for errors
4. Use "Start New" reset to clear state
5. Report issue with console logs

## 📝 Test Results Template

```
=== LONG-TERM STABILITY TEST ===

Start Time: [Date/Time]
End Time: [Date/Time]
Duration: [Hours]
Mode: Test/Real
Assets: [List]

Disconnections: [Number]
Successful Reconnects: [Number]
Failed Reconnects: [Number]

Trades Executed: [Number]
Buy Orders: [Number]
Sell Orders: [Number]

Issues Encountered:
- [List any problems]

Final Status: ✅ Success / ❌ Failed

Notes:
- [Any observations]
```

## 💡 Tips for Successful Testing

1. **Use screen/tmux** if testing on remote server:
   ```bash
   screen -S crypto-bot
   node --experimental-modules index.js
   # Ctrl+A, D to detach
   # screen -r crypto-bot to reattach
   ```

2. **Monitor with tail** (separate terminal):
   ```bash
   # Watch for reconnection events
   tail -f /proc/$(pgrep -f "node.*index.js")/fd/1 | grep -i "reconnect\|error\|websocket"
   ```

3. **Set browser to prevent sleep**:
   - Chrome: Install "Keep Awake" extension
   - Or: Keep browser window active/visible

4. **Document everything** - timestamps, errors, behaviors

## 🎯 Success Criteria

Before going to **REAL MODE**, the bot should:
- ✅ Run for 48+ hours without manual intervention
- ✅ Handle 3+ reconnection events successfully
- ✅ Execute trades correctly after reconnections
- ✅ Maintain accurate state (wallet, positions, charts)
- ✅ Show no memory leaks or performance degradation

---

**Good luck with your long-term test!** 🚀

If you encounter any issues, share the console logs and I can help debug.
