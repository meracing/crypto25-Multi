# Phase 2 Backend Implementation - Technical Plan

## Overview
This document outlines the detailed technical plan for implementing the multi-step selling backend functionality. This is a **significant refactor** of the core trading engine.

---

## Current Architecture Analysis

### Current Asset Structure (V1.0)
```javascript
{
  market: "BTC-EUR",
  currentState: "buy" | "sell",  // Simple two-state system
  lastPrices: [],
  buyPrice: 0,                    // Single buy price
  maxPrice: 0,
  waitIndex: 0,
  stepIndex: 0,
  sellMoment: null,
  cryptoAmount: 0,                // Total amount owned
  latestPrice: null,
  lastCheckTime: null,
  wsInitialized: false,
  tradeIndex: 0
}
```

**Key Characteristics:**
- One position per asset at a time
- Buy → entire amount → Sell → repeat
- Simple state machine: BUY or SELL
- Single `buyPrice` and `cryptoAmount`

---

## New Architecture Requirements (V2.0 Multi-Step)

### Target Asset Structure
```javascript
{
  market: "BTC-EUR",
  currentState: "buy" | "sell",  // Keep for backward compatibility
  lastPrices: [],
  latestPrice: null,
  lastCheckTime: null,
  wsInitialized: false,
  tradeIndex: 0,

  // NEW: Multi-batch tracking system
  batches: [
    {
      batchId: "batch_1697123456789",
      buyPrice: 104500,
      buyAmount: 50,              // EUR amount invested
      cryptoAmount: 0.000478,     // Crypto purchased
      remainingCrypto: 0.000478,  // Crypto not yet sold
      remainingPercent: 100,      // Percentage not yet sold
      maxPrice: 104500,           // Track highest price for this batch
      waitIndex: 0,               // Independent wait counter
      status: "active" | "completed",

      // Multi-step sell configuration
      sellSteps: [
        {
          stepId: 1,
          percentage: 33,          // Sell 33% of THIS batch
          priceThreshold: 1.2,     // At 1.2% profit
          targetPrice: 105754,     // Calculated: buyPrice * 1.012
          completed: false,
          soldAt: null,            // Price at which this step sold
          soldTime: null,          // Timestamp of sale
          amountSold: 0,           // EUR received
          cryptoSold: 0            // Crypto amount sold
        },
        {
          stepId: 2,
          percentage: 33,
          priceThreshold: 2.0,
          targetPrice: 106590,     // buyPrice * 1.020
          completed: false,
          soldAt: null,
          soldTime: null,
          amountSold: 0,
          cryptoSold: 0
        },
        {
          stepId: 3,
          percentage: 34,
          priceThreshold: 4.0,
          targetPrice: 108680,     // buyPrice * 1.040
          completed: false,
          soldAt: null,
          soldTime: null,
          amountSold: 0,
          cryptoSold: 0
        }
      ],

      // Stop-loss specific to this batch
      stopLoss: {
        enabled: true,
        percentage: 15,            // -15% from buyPrice
        triggerPrice: 88825        // buyPrice * 0.85
      }
    }
    // Can have multiple batches simultaneously (up to 4)
  ],

  // Legacy fields for backward compatibility with interval-based selling
  buyPrice: 104500,              // Keep as reference to latest batch
  maxPrice: 104500,              // Keep as reference to latest batch
  cryptoAmount: 0.000478         // Keep as total across all batches
}
```

---

## Implementation Strategy

### Phase 2A: Foundation (Backward Compatible)
**Goal**: Refactor without breaking existing functionality

#### Step 1: Add Batch Structure
- Add `batches` array to asset objects
- Keep existing fields for backward compatibility
- Add helper functions to maintain both structures

#### Step 2: Modify Buy Logic
```javascript
// OLD (current):
async function buy(asset, reason, cp) {
  asset.buyPrice = cp;
  asset.cryptoAmount = (buyAmount / cp);
  // ...
}

// NEW (multi-batch):
async function buy(asset, reason, cp, config) {
  // Create new batch
  const batch = {
    batchId: `batch_${Date.now()}`,
    buyPrice: cp,
    buyAmount: config.buyAmount,
    cryptoAmount: (config.buyAmount / cp) * (1 - FEE_RATE),
    remainingCrypto: (config.buyAmount / cp) * (1 - FEE_RATE),
    remainingPercent: 100,
    maxPrice: cp,
    waitIndex: 0,
    status: "active",
    sellSteps: config.multiStepEnabled ? createSellSteps(config.sellSteps, cp) : null,
    stopLoss: createStopLoss(cp, config.stopLossPercent || 15)
  };

  asset.batches.push(batch);

  // Update legacy fields for backward compatibility
  asset.buyPrice = cp;
  asset.cryptoAmount = calculateTotalCrypto(asset.batches);
  asset.maxPrice = cp;
}

function createSellSteps(stepConfig, buyPrice) {
  return stepConfig.map((step, index) => ({
    stepId: index + 1,
    percentage: step.percentage,
    priceThreshold: step.priceThreshold,
    targetPrice: buyPrice * (1 + step.priceThreshold / 100),
    completed: false,
    soldAt: null,
    soldTime: null,
    amountSold: 0,
    cryptoSold: 0
  }));
}
```

#### Step 3: Modify Sell Logic
```javascript
// OLD (current): Sells everything at once
async function sell(asset, reason, cp, bp) {
  // Sell entire cryptoAmount
  // ...
}

// NEW (multi-step): Sells batches incrementally
async function processSellLogic(asset, currentPrice) {
  if (!asset.batches || asset.batches.length === 0) {
    return; // No active batches
  }

  // Process each active batch independently
  for (const batch of asset.batches) {
    if (batch.status !== "active") continue;

    // Update batch maxPrice
    if (currentPrice > batch.maxPrice) {
      batch.maxPrice = currentPrice;
    }

    // Check if multi-step or traditional selling
    if (batch.sellSteps) {
      await processMultiStepSell(asset, batch, currentPrice);
    } else {
      await processTraditionalSell(asset, batch, currentPrice);
    }

    // Check stop-loss
    await checkStopLoss(asset, batch, currentPrice);
  }

  // Clean up completed batches
  asset.batches = asset.batches.filter(b => b.status === "active");

  // Update legacy fields
  asset.cryptoAmount = calculateTotalCrypto(asset.batches);
}

async function processMultiStepSell(asset, batch, currentPrice) {
  // Find next uncompleted step
  const nextStep = batch.sellSteps.find(s => !s.completed);
  if (!nextStep) {
    batch.status = "completed";
    return;
  }

  // Check if price reached target and is now dropping (sell trigger)
  const profitPercent = ((currentPrice - batch.buyPrice) / batch.buyPrice) * 100;

  if (profitPercent >= nextStep.priceThreshold) {
    // Price reached target, check if it's dropping
    const isDropping = checkPriceDropPattern(asset.lastPrices, currentPrice);

    if (isDropping) {
      // Execute this step's sell
      const cryptoToSell = (batch.remainingCrypto * nextStep.percentage) / batch.remainingPercent;

      // Validate minimum trade amount (€5)
      const estimatedValue = cryptoToSell * currentPrice;
      if (estimatedValue * (1 - FEE_RATE) < 5) {
        console.log(`[${asset.market}] Step ${nextStep.stepId} skipped: amount €${estimatedValue.toFixed(2)} below minimum`);
        nextStep.completed = true; // Skip this step
        return;
      }

      // Execute sell via Bitvavo API
      const eurReceived = await executeSell(asset, cryptoToSell, currentPrice);

      // Update step
      nextStep.completed = true;
      nextStep.soldAt = currentPrice;
      nextStep.soldTime = new Date().toISOString();
      nextStep.amountSold = eurReceived;
      nextStep.cryptoSold = cryptoToSell;

      // Update batch
      batch.remainingCrypto -= cryptoToSell;
      batch.remainingPercent -= nextStep.percentage;

      // Log the sale
      console.log(`[${asset.market}] Batch ${batch.batchId} - Step ${nextStep.stepId}: Sold ${nextStep.percentage}% at €${currentPrice} (+${profitPercent.toFixed(2)}%)`);

      // Emit event to frontend
      io.emit('multi-step-sell', {
        market: asset.market,
        batchId: batch.batchId,
        step: nextStep.stepId,
        percentage: nextStep.percentage,
        price: currentPrice,
        profit: profitPercent,
        eurReceived: eurReceived
      });

      // Check if batch is complete
      if (batch.remainingPercent <= 0 || batch.remainingCrypto < 0.00000001) {
        batch.status = "completed";
        console.log(`[${asset.market}] Batch ${batch.batchId} completed all steps`);
      }
    }
  }
}

async function checkStopLoss(asset, batch, currentPrice) {
  if (!batch.stopLoss.enabled) return;

  const lossPercent = ((currentPrice - batch.buyPrice) / batch.buyPrice) * 100;

  if (lossPercent <= -batch.stopLoss.percentage) {
    console.log(`[${asset.market}] STOP LOSS triggered for batch ${batch.batchId}: ${lossPercent.toFixed(2)}%`);

    // Sell remaining crypto in this batch
    if (batch.remainingCrypto > 0) {
      const eurReceived = await executeSell(asset, batch.remainingCrypto, currentPrice);

      // Mark all steps as completed
      batch.sellSteps?.forEach(step => {
        if (!step.completed) {
          step.completed = true;
          step.soldAt = currentPrice;
          step.soldTime = new Date().toISOString();
        }
      });

      batch.remainingCrypto = 0;
      batch.status = "completed";

      io.emit('stop-loss', {
        market: asset.market,
        batchId: batch.batchId,
        lossPercent: lossPercent,
        eurReceived: eurReceived
      });
    }
  }
}

async function executeSell(asset, cryptoAmount, currentPrice) {
  if (tradingMode === 'real') {
    // Real Bitvavo API call
    const order = await client.placeOrder(asset.market, 'sell', 'market', 0, {
      amount: cryptoAmount.toString()
    });
    const eurReceived = parseFloat(order.filledAmountQuote || 0);
    wallet += eurReceived;
    currentWallet = wallet;
    io.emit('wallet', wallet);
    return eurReceived;
  } else {
    // Test mode simulation
    const grossValue = cryptoAmount * currentPrice;
    const fee = grossValue * FEE_RATE;
    const netValue = grossValue - fee;
    wallet += netValue;
    currentWallet = wallet;
    io.emit('wallet', wallet);
    return netValue;
  }
}

function checkPriceDropPattern(lastPrices, currentPrice) {
  // Check if price is dropping (same logic as current implementation)
  const dataLength = lastPrices.length - 1;
  if (dataLength < 2) return false;

  const last = lastPrices[dataLength];
  const last1 = lastPrices[dataLength - 1];

  // Price dropping -0.3% from last
  if (currentPrice < (last * 0.997)) return true;
  // Price dropping -0.4% from 2nd last
  if (currentPrice < (last1 * 0.996)) return true;

  return false;
}
```

---

## Phase 2B: Integration Points

### 1. Configuration Reception
Update `startTradingWithConfig()`:
```javascript
async function startTradingWithConfig(config) {
  const {
    markets,
    interval,
    buyAmount,
    tradingMode,
    multiStepEnabled,    // NEW
    sellSteps,           // NEW
    preservedWallet,
    preservedPositions
  } = config;

  // Store config for use during buy operations
  tradingConfig = {
    buyAmount,
    tradingMode,
    multiStepEnabled,
    sellSteps: sellSteps || null
  };

  // Rest of initialization...
}
```

### 2. Asset Processing Loop
Update `processAssetPrice()`:
```javascript
async function processAssetPrice(asset, cp) {
  if (asset.currentState === states.BUY) {
    // Check buy conditions (unchanged)
    if (buyConditionMet) {
      await buy(asset, reason, cp, tradingConfig);
      asset.currentState = states.SELL;
    }
  } else if (asset.currentState === states.SELL) {
    // NEW: Process batches instead of single position
    await processSellLogic(asset, cp);

    // If all batches completed, return to BUY state
    if (asset.batches.length === 0) {
      asset.currentState = states.BUY;
      asset.buyPrice = 0;
      asset.maxPrice = 0;
      asset.cryptoAmount = 0;
    }
  }
}
```

### 3. Data Persistence
Update position preservation:
```javascript
socket.on('request-current-state', () => {
  const activePositions = currentAssets
    .filter(asset => asset.batches && asset.batches.length > 0)
    .map(asset => ({
      market: asset.market,
      batches: asset.batches,
      // Legacy fields for compatibility
      buyPrice: asset.buyPrice,
      cryptoAmount: asset.cryptoAmount,
      maxPrice: asset.maxPrice,
      waitIndex: asset.waitIndex,
      stepIndex: asset.stepIndex,
      tradeIndex: asset.tradeIndex
    }));

  socket.emit('current-state', {
    wallet: currentWallet,
    tradingMode: currentTradingMode,
    activePositions
  });
});
```

### 4. Manual Trading Handlers
Update manual buy/sell:
```javascript
manualBuyHandler = async (market) => {
  const asset = assets.find(a => a.market === market);
  if (!asset || asset.currentState !== states.BUY) return;

  await buy(asset, 'Manual Buy', asset.latestPrice, tradingConfig);
  asset.currentState = states.SELL;
};

manualSellHandler = async (market) => {
  const asset = assets.find(a => a.market === market);
  if (!asset || asset.currentState !== states.SELL) return;

  // Sell all remaining crypto across all batches
  for (const batch of asset.batches) {
    if (batch.remainingCrypto > 0) {
      await executeSell(asset, batch.remainingCrypto, asset.latestPrice);
      batch.status = "completed";
    }
  }

  asset.batches = [];
  asset.currentState = states.BUY;
};
```

---

## Phase 2C: Frontend Dashboard Updates

### New Socket Events
```javascript
// Backend emits:
io.emit('multi-step-sell', { market, batchId, step, percentage, price, profit, eurReceived });
io.emit('stop-loss', { market, batchId, lossPercent, eurReceived });
io.emit('batch-created', { market, batchId, buyPrice, buyAmount });
io.emit('batch-completed', { market, batchId });

// Frontend listens and updates UI accordingly
```

### Dashboard Display Updates (index.html)
```html
<!-- Show batch information per asset -->
<div class="batch-container">
  <div class="batch-item">
    <span>Batch 1: €50 @ €104,500</span>
    <div class="step-progress">
      <span class="step completed">Step 1: 33% ✓</span>
      <span class="step active">Step 2: 33% ⏳</span>
      <span class="step pending">Step 3: 34%</span>
    </div>
  </div>
</div>
```

---

## Testing Strategy

### Phase 2A Tests
1. **Single Batch, Single Step** (Simplest case)
   - Buy with 1-step config (100% at 2%)
   - Verify sell executes at correct threshold

2. **Single Batch, Multi-Step**
   - Buy with 3-step config (33%/33%/34%)
   - Verify steps execute in order
   - Verify amounts are correct

3. **Stop-Loss**
   - Buy and wait for -15% drop
   - Verify batch sold entirely

4. **Minimum Trade Validation**
   - Buy €15 with 10% steps
   - Verify small steps are skipped with warning

### Phase 2B Tests
5. **Multiple Batches** (Complex)
   - Buy → sell 33% → buy again → manage 2 batches
   - Verify independent tracking

6. **Backward Compatibility**
   - Use interval-based selling (no multi-step)
   - Verify old behavior still works

### Phase 2C Tests
7. **Dashboard Display**
   - Verify batch information displays correctly
   - Verify real-time updates

8. **Data Persistence**
   - Buy, sell partial, switch assets, return
   - Verify batch state preserved

---

## Risk Assessment

### High Risk Areas
1. **Concurrent Batch Management**: Multiple batches may interfere with each other
2. **Bitvavo API Limits**: Rapid partial sells may hit rate limits
3. **Floating Point Precision**: Crypto amounts are very small decimals
4. **State Synchronization**: Frontend/backend may get out of sync

### Mitigation Strategies
1. Use unique batch IDs and strict separation
2. Add rate limiting and retry logic
3. Use `toFixed(8)` for crypto amounts
4. Emit comprehensive state updates after each change

---

## Implementation Timeline

### Estimated Effort
- **Phase 2A (Foundation)**: 6-8 hours
- **Phase 2B (Integration)**: 4-6 hours
- **Phase 2C (Dashboard)**: 3-4 hours
- **Testing & Debugging**: 4-6 hours
- **Total**: ~20-24 hours of development

### Recommended Approach
1. **Implement Phase 2A first** with extensive logging
2. **Test thoroughly** with test mode before real mode
3. **Add Phase 2B incrementally** (one integration point at a time)
4. **Update dashboard last** (Phase 2C)

---

## Success Criteria

### Must Have
- ✅ Multi-step selling executes correctly
- ✅ Bitvavo €5 minimum enforced
- ✅ Stop-loss works per batch
- ✅ No breaking changes to existing functionality
- ✅ Data persists across sessions

### Nice to Have
- Multiple concurrent batches (up to 4)
- Dashboard shows batch details
- Historical batch analytics

---

## Next Steps

1. **Review this plan** and approve/modify as needed
2. **Start with Phase 2A** (safest, most foundational)
3. **Test incrementally** after each major change
4. **Commit frequently** to avoid losing work

---

**Ready to begin implementation?** Please review this plan and let me know if you want to proceed, or if any adjustments are needed.
