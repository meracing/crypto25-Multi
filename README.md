# Crypto Trading Bot - Multi-Asset WebSocket Edition

A sophisticated automated cryptocurrency trading bot for the Bitvavo exchange with real-time WebSocket data streaming, multi-asset support, and an intuitive web-based dashboard.

![License](https://img.shields.io/badge/license-ISC-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)
![Bitvavo](https://img.shields.io/badge/exchange-Bitvavo-orange.svg)

## Features

### Trading Capabilities
- **Multi-Asset Trading**: Trade up to 5 different cryptocurrency pairs simultaneously
- **Real-Time Data**: WebSocket integration with Bitvavo for live price updates
- **Dual Trading Modes**:
  - **Test Mode**: Simulated trading with virtual €500 wallet (no real money)
  - **Real Mode**: Live trading with actual Bitvavo account
- **Smart Trading Algorithm**: Pattern-based buy/sell decisions using historical price analysis
- **Automatic Risk Management**: Built-in stop-loss (-15%) and profit-taking logic
- **Position Preservation**: Resume trading with existing positions after restart

### User Interface
- **Web Dashboard**: Clean, modern interface accessible via browser
- **Live Charts**: Real-time price visualization with Chart.js
- **Trade History**: Complete log of all buy/sell transactions
- **Wallet Tracking**: Real-time balance updates
- **Manual Override**: Buy/sell buttons for manual control
- **Reset Functionality**: Clean slate without server restart

### Technical Features
- **WebSocket Auto-Reconnect**: Robust connection management with fallback
- **Error Handling**: Comprehensive error catching and recovery
- **Fee Calculation**: Accurate Bitvavo fee simulation (0.25%)
- **Price Pattern Detection**: Multi-factor analysis for entry/exit signals
- **Concurrent Asset Management**: Independent logic for each trading pair

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [How It Works](#how-it-works)
- [Trading Algorithm](#trading-algorithm)
- [API Reference](#api-reference)
- [Safety & Disclaimers](#safety--disclaimers)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

## Installation

### Prerequisites

- **Node.js** v14.0.0 or higher
- **Bitvavo Account** with API access
- **API Key & Secret** from Bitvavo (with View and Trade permissions)

### Setup Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/meracing/crypto25-Multi.git
   cd crypto25-Multi
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create environment file**

   Create a `.env` file in the project root:
   ```env
   BITVAVO_KEY=your_api_key_here
   BITVAVO_SECRET=your_api_secret_here
   PORT=3007
   ```

   **How to get Bitvavo API credentials:**
   1. Log in to [Bitvavo](https://bitvavo.com/)
   2. Go to Settings → API Keys
   3. Create new API key with "View" and "Trade" permissions
   4. Copy the key and secret to your `.env` file
   5. **Important**: Do NOT enable IP whitelist (or add your IP)

4. **Verify installation**
   ```bash
   npm start
   ```
   The browser should automatically open to `http://localhost:3007`

## Configuration

### Environment Variables

All configurable options in `.env`:

```env
# Required
BITVAVO_KEY=your_api_key_here
BITVAVO_SECRET=your_api_secret_here

# Optional
PORT=3007                          # Server port (default: 3007)
FEE_RATE=0.0025                    # Trading fee percentage (default: 0.25%)
PRICE_WINDOW_MINUTES=5             # Historical price window (default: 5 min)
DEFAULT_INTERVAL_MS=10000          # Price check interval (default: 10s)
MAX_WAIT_INDEX=100                 # Wait limit before force-sell (default: 100)
START_WALLET=500                   # Test mode starting balance (default: €500)
DEBUG=true                         # Enable debug logging (optional)
```

### Web Interface Configuration

When you start the bot, you'll configure trading via the web interface:

1. **Select Trading Mode**
   - Test Mode: Practice with simulated money
   - Real Mode: Live trading with your Bitvavo account

2. **Choose Crypto Assets**
   - Select 1-5 EUR-paired cryptocurrencies (e.g., BTC-EUR, ETH-EUR)
   - Mix major coins (BTC, ETH) with altcoins for diversification

3. **Set Trading Parameters**
   - **Buy Amount**: EUR to invest per buy signal (e.g., €25-€100)
   - **Interval**: How often to check prices (recommended: 10-30 seconds)

4. **Click "Start Trading"**

## Usage

### Starting the Bot

```bash
npm start
```

The bot will:
1. Start the Node.js server
2. Open your browser to the configuration page
3. Display available cryptocurrency markets
4. Wait for your trading configuration

### Trading Flow

1. **Configuration Phase**
   - Select test/real mode
   - Choose cryptocurrency pairs
   - Set buy amount and check interval
   - Click "Start Trading"

2. **Active Trading Phase**
   - Dashboard shows real-time prices for each asset
   - Buy/sell events appear in trade history table
   - Wallet balance updates automatically
   - Charts visualize price movements

3. **Manual Control** (Optional)
   - Use BUY/SELL buttons to override automation
   - Useful for taking profits or cutting losses early

4. **Reset** (Optional)
   - Click "Reset" button to clear all positions
   - Test mode: Positions cleared immediately
   - Real mode: Warning displayed (manual sell required)

### Example Session

**Test Mode Example:**
```
Starting balance: €500
Selected assets: BTC-EUR, ETH-EUR
Buy amount: €50
Interval: 10 seconds

→ BTC rises → Auto-buy €50 of BTC
→ BTC drops → Auto-sell (profit: €2.30)
→ ETH rises → Auto-buy €50 of ETH
→ BTC rises again → Auto-buy €50 of BTC
→ Both positions open simultaneously
→ ETH drops → Auto-sell (loss: -€1.20)
→ BTC continues rising → Auto-sell (profit: €5.80)

Final balance: €506.90 (+1.38% profit)
```

## How It Works

### Architecture Overview

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Web Browser   │ ◄─────► │   Node.js Server │ ◄─────► │ Bitvavo Exchange│
│   (Dashboard)   │ Socket  │   (Trading Bot)  │ WebSocket│  (Market Data)  │
└─────────────────┘   IO    └──────────────────┘   & API  └─────────────────┘
```

### Data Flow

1. **Price Updates**
   - Bitvavo WebSocket → Bot receives real-time ticker
   - Bot processes → Price stored in asset's history
   - Bot emits → Browser displays via Socket.IO

2. **Trading Decisions**
   - Bot analyzes price patterns every [interval] seconds
   - Algorithm evaluates buy/sell conditions
   - If triggered → Execute order (test or real)
   - Update wallet balance and positions

3. **WebSocket Management**
   - Auto-reconnect on disconnect (10s delay)
   - Error handling for connection issues
   - Fallback warning if WebSocket fails

### Multi-Asset Support

Each cryptocurrency asset is managed independently:

- **Separate State**: Each asset has own buy/sell state
- **Independent Timers**: Price checks synchronized but independent
- **Isolated Logic**: One asset's actions don't affect others
- **Concurrent Positions**: Hold multiple assets simultaneously

## Trading Algorithm

### Buy Signal Criteria

The bot buys when it detects an upward price pattern:

```javascript
// Checks last 12 price points against different thresholds
// Example: If current price * 1.002 ≤ price_2_steps_ago
//       AND current price > last_price
//       → Rising pattern detected → BUY
```

**Requirements:**
- Current price must be higher than last 2 prices (momentum)
- Historical comparison against graduated thresholds (1.002x to 1.008x)
- Minimum 13 data points in price history

### Sell Signal Criteria

The bot sells when ANY of these conditions are met:

1. **Profit Taking** (price ≥ +0.6% from buy)
   - Price drops -0.03% from last check, OR
   - Price drops -0.04% from 2 checks ago, OR
   - Price drops -0.05% from 3 checks ago, OR
   - Price drops -0.06% from peak

2. **Peak Protection**
   - Max price reached +1.2% profit
   - Now dropped -0.6% from that peak
   - Price currently falling

3. **Stop Loss**
   - Price drops -15% from buy price
   - Prevents catastrophic losses

4. **Wait Timeout**
   - Position held for 100+ intervals
   - Price stuck between +0.51% and +0.9%
   - Forces exit to free up capital

### Fee Calculation

Matches Bitvavo's real fee structure (0.25%):

**Buy Example:**
```
Buy amount: €100
Fee: €0.25 (deducted from buy amount)
Crypto received: €99.75 worth
Wallet deduction: €100
```

**Sell Example:**
```
Crypto value: €105
Fee: €0.2625 (deducted from sale)
EUR received: €104.7375
Actual profit: €4.7375 (not €5)
```

## API Reference

### WebSocket Events (Socket.IO)

**Client → Server:**
- `request-markets`: Get list of available crypto markets
- `trading-config`: Submit trading configuration
- `request-current-state`: Get active positions
- `manual-buy`: Trigger manual buy for specific market
- `manual-sell`: Trigger manual sell for specific market
- `reset-trading-bot`: Reset all positions and state

**Server → Client:**
- `server-session`: Server session ID (detect restarts)
- `markets-list`: Available markets array
- `market-selected`: Currently trading markets
- `trading-mode`: Current mode (test/real)
- `wallet`: Current EUR balance
- `current-price`: Real-time price update per asset
- `buy-price`: Buy price when position opened
- `max-price`: Maximum price reached since buy
- `check`: Trading decision event (buy/sell/hold)
- `last-prices`: Last 5 prices for asset
- `checkstart`: Trading loop started
- `reset-complete`: Reset finished successfully

### REST API Endpoints

The bot uses Bitvavo's official Node.js library:

- `client.markets()`: Fetch available markets
- `client.balance()`: Get account balance
- `client.tickerPrice()`: Get current price (REST fallback)
- `client.placeOrder()`: Execute buy/sell order
- `client.websocket.subscriptionTicker()`: Subscribe to price stream

## Safety & Disclaimers

### Important Warnings

**⚠️ TRADING RISKS:**
- Cryptocurrency trading involves substantial risk of loss
- Past performance does not guarantee future results
- Only trade with money you can afford to lose
- This bot is for educational purposes
- No warranty or guarantee of profits

**⚠️ SECURITY:**
- Never commit `.env` file to version control
- Keep API keys private and secure
- Use API keys with minimum required permissions
- Consider IP whitelist for production use
- Test thoroughly in Test Mode before going live

**⚠️ REAL MODE:**
- Start with small buy amounts (€10-€25)
- Monitor the bot closely during first hours
- Understand the algorithm before using real money
- Have a plan to manually intervene if needed
- Be aware of Bitvavo's trading fees and withdrawal limits

### Best Practices

1. **Start with Test Mode**
   - Run for 24-48 hours to understand behavior
   - Test different asset combinations
   - Experiment with buy amounts and intervals

2. **Gradual Real Mode Adoption**
   - Begin with €10-€25 buy amounts
   - Trade 1-2 stable assets (BTC-EUR, ETH-EUR)
   - Increase exposure only after success

3. **Risk Management**
   - Don't invest more than 5-10% of portfolio
   - Diversify across multiple assets
   - Set aside emergency fund outside bot
   - Monitor regularly (daily at minimum)

4. **System Reliability**
   - Stable internet connection required
   - Consider running on VPS/server for 24/7 uptime
   - Keep Node.js and dependencies updated
   - Monitor logs for errors

## Troubleshooting

### Common Issues

**Problem:** Bot won't start - "Missing BITVAVO_KEY"
```
Solution: Create .env file with your API credentials
Check: File must be named exactly ".env" (not "env.txt")
```

**Problem:** API error - "Invalid credentials"
```
Solution: Verify API key/secret are correct
Check: Key has "View" and "Trade" permissions on Bitvavo
Check: No IP whitelist restrictions (or add your IP)
```

**Problem:** WebSocket connection fails
```
Solution: Check internet connection
Check: Bitvavo API status (https://status.bitvavo.com/)
Try: Restart bot and wait 30 seconds
```

**Problem:** No buy signals in Test Mode
```
Solution: Market may be moving sideways/down
Explanation: Bot only buys on rising patterns
Try: Different asset or wait for market movement
Check: Interval setting (too fast = less signals)
```

**Problem:** Real mode balance is €0
```
Solution: Deposit EUR to your Bitvavo account
Check: EUR balance visible in Bitvavo app
Check: Funds are "available" (not reserved)
```

**Problem:** Position stuck in SELL state
```
Solution: Use manual SELL button if needed
Check: Price hasn't dropped below -15% (stop-loss)
Wait: May be waiting for better exit price
```

### Debug Mode

Enable detailed logging:
```env
DEBUG=true
```

Then check console output for:
- WebSocket connection status
- Price updates and pattern checks
- Buy/sell decision reasoning
- API request/response details

### Getting Help

If you encounter issues:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review console logs for error messages
3. Verify `.env` configuration
4. Test with simpler setup (1 asset, test mode)
5. Open an issue on GitHub with:
   - Full error message
   - Your configuration (without API keys!)
   - Steps to reproduce

## Project Structure

```
crypto25-Multi/
├── index.js              # Main server and trading logic
├── package.json          # Dependencies and scripts
├── .env                  # API credentials (not committed)
├── data.json             # Historical training data
├── public/
│   ├── config.html       # Configuration page
│   └── index.html        # Trading dashboard
├── WEBSOCKET_FIX.md      # WebSocket debugging notes
├── STABILITY_NOTES.md    # Stability improvements log
└── README.md             # This file
```

## Technical Stack

- **Backend**: Node.js with ES6 modules
- **Real-time Communication**: Socket.IO
- **WebSocket Library**: Bitvavo official SDK
- **Web Server**: HTTP + serve-static + finalhandler
- **Frontend**: Vanilla JavaScript + Chart.js
- **Exchange API**: Bitvavo REST & WebSocket

## Dependencies

```json
{
  "bitvavo": "^1.5.0",        // Official Bitvavo API client
  "socket.io": "^4.8.1",      // Real-time bidirectional communication
  "dotenv": "^17.2.3",        // Environment variable management
  "open": "^9.1.0",           // Auto-open browser
  "serve-static": "^1.16.2",  // Serve frontend files
  "finalhandler": "^1.3.1"    // HTTP request finalization
}
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**Areas for Contribution:**
- Additional exchanges (Coinbase, Kraken, Binance)
- More sophisticated trading algorithms
- Machine learning price prediction
- Mobile app interface
- Backtesting framework
- Performance analytics dashboard

## License

ISC License - see LICENSE file for details

## Acknowledgments

- **Bitvavo** for excellent API documentation and Node.js library
- **Chart.js** for beautiful real-time charts
- **Socket.IO** for reliable WebSocket management
- The crypto trading community for algorithm insights

## Changelog

### v1.0.0 (Current)
- Multi-asset simultaneous trading (up to 5 pairs)
- WebSocket real-time price streaming
- Test and Real trading modes
- Position preservation across restarts
- Web-based configuration interface
- Manual buy/sell override
- Complete reset functionality
- Robust error handling and auto-reconnect

---

**Happy Trading! 🚀📈**

*Remember: Always start with Test Mode and never invest more than you can afford to lose.*
