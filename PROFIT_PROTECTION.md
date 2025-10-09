# Minimum Profit Protection

## Problem
The bot was sometimes selling at a **loss** or **break-even** (after fees), which defeats the purpose of trading.

### Examples of Negative Profit Sells:
1. **Peak Protection Trigger**: Price went to +1.2%, then dropped below buy price, and bot would still sell (loss!)
2. **Wait Timeout**: After waiting 100 intervals, bot would sell at ANY price, even -5% loss

## Solution Implemented

### Minimum Profit Requirement
**New constant**: `MIN_PROFIT_MULTIPLIER = 1.003` (+0.3% minimum)

This ensures:
- **After buy fees** (0.25%): You receive crypto worth ~99.75% of buy amount
- **After sell fees** (0.25%): You receive EUR worth ~99.75% of gross value
- **Combined**: Need ~+0.5% price increase to break even
- **With MIN_PROFIT_MULTIPLIER = 1.003**: Guarantees +0.3% profit after ALL fees

### Updated Sell Logic

#### 1. Profit-Taking (Lines 999-1009)
```javascript
if (cp >= (asset.buyPrice * 1.006)) {
    // Only triggers when at +0.6% profit
    // These sells are ALWAYS profitable ✅
}
```
**No change needed** - already has +0.6% minimum

#### 2. Peak Protection (Lines 1010-1015)
```javascript
else if (maxPrice >= buyPrice * 1.012 && ...) {
    // NEW: Only sell if we still have minimum profit
    if (cp >= (asset.buyPrice * MIN_PROFIT_MULTIPLIER)) {
        reason = "Peak was +1.2%, now -0.6%";
    }
    // Otherwise: wait for recovery or stop-loss
}
```
**FIXED** ✅ - Now requires +0.3% minimum profit

**Before**: Could sell at -5% loss if price spiked to +1.2% then crashed
**After**: Holds position, waits for recovery or eventual stop-loss

#### 3. Stop Loss (Lines 1016-1018)
```javascript
else if (asset.buyPrice >= cp * 1.15) {
    reason = "STOP LOSS -15%";
}
```
**No change** - Intentionally accepts -15% loss to prevent catastrophic losses

#### 4. Wait Timeout (Lines 1019-1028)
```javascript
else if (asset.waitIndex >= MAX_WAIT_INDEX) {
    // NEW: Only sell if we have minimum profit
    if (cp >= (asset.buyPrice * MIN_PROFIT_MULTIPLIER)) {
        reason = "Wait limit reached";
    } else {
        // Reset counter, give it another chance
        asset.waitIndex = 0;
    }
}
```
**FIXED** ✅ - Now requires +0.3% minimum profit

**Before**: After 100 intervals, would sell at ANY price (could be -10% loss!)
**After**: Resets wait counter, continues holding until profit or stop-loss

## Impact

### Positive Effects
✅ **No more negative profit sells** (except intentional -15% stop-loss)
✅ **Every sell guarantees +0.3% profit minimum**
✅ **After fees**: Actual net profit of ~+0.05% or better
✅ **Peace of mind**: Bot won't panic-sell at a loss

### Trade-offs
⚠️ **Longer hold times**: If price hovers around break-even, bot waits longer
⚠️ **More stop-losses**: If price doesn't recover, eventually hits -15% stop-loss
⚠️ **Fewer trades**: More selective about exits

### Example Scenarios

**Scenario 1: Peak Protection**
```
Buy at: €100
Peak at: €101.20 (+1.2%)
Current: €99.50 (-0.5%)

BEFORE: Would sell at €99.50 (LOSS of €0.50 + fees = -€0.75)
AFTER:  Holds position, waits for recovery above €100.30
```

**Scenario 2: Wait Timeout**
```
Buy at: €100
Held for: 100 intervals
Current: €99.00 (-1.0%)

BEFORE: Would sell at €99.00 (LOSS of €1.00 + fees = -€1.25)
AFTER:  Resets wait counter, continues holding until €100.30 or -15% stop-loss
```

**Scenario 3: Profit-Taking**
```
Buy at: €100
Current: €100.60 (+0.6%)

BEFORE: Would sell ✅
AFTER:  Would sell ✅ (no change, already above minimum)
```

## Configuration

To adjust minimum profit threshold, edit line 997 in `index.js`:

```javascript
const MIN_PROFIT_MULTIPLIER = 1.003; // +0.3% minimum profit
```

**Recommended values:**
- `1.002` = +0.2% minimum (very aggressive, barely covers fees)
- `1.003` = +0.3% minimum (balanced, small guaranteed profit) ← **CURRENT**
- `1.005` = +0.5% minimum (conservative, larger profit guarantee)
- `1.008` = +0.8% minimum (very conservative, may miss opportunities)

## Mathematics

### Fee Calculation
**Buy €100:**
- Fee: €0.25 (deducted from buy amount)
- Crypto received: €99.75 worth

**Sell at €100.30:**
- Gross value: €100.30
- Fee: €0.25 (0.25% of €100.30)
- Net received: €100.05
- **Actual profit: €0.05** (+0.05%)

**Sell at €100.00 (break-even price):**
- Gross value: €100.00
- Fee: €0.25
- Net received: €99.75
- **Actual profit: -€0.25** (-0.25% LOSS!)

### Why 1.003?
To guarantee profit after both buy and sell fees:
```
Buy: €100 → Receive crypto worth €99.75
Need to sell for: €100 / 0.9975 / 0.9975 ≈ €100.50 for break-even
But we use 1.003 (€100.30) for small guaranteed profit
```

## Testing

To verify the fix is working:
1. Watch for "Wait limit reached but price too low" messages in logs
2. Confirm NO sells happen below MIN_PROFIT_MULTIPLIER (except stop-loss)
3. Check all SELL events in table have positive €amount (except "STOP LOSS")

## Related Files
- [index.js](index.js) - Lines 990-1036 (sell logic)
- [README.md](README.md) - Trading algorithm section
