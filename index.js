// ============================================================
// CRYPTO TRADING BOT - Main Server
// ============================================================
// Multi-asset cryptocurrency trading bot with WebSocket support
//
// FEATURES:
// - Trade up to 5 crypto assets simultaneously
// - Real-time price data via Bitvavo WebSocket API
// - Test mode (simulated) and Real mode (actual trades)
// - Automatic buy/sell based on price patterns
// - Web-based dashboard with live charts
// - Position tracking and profit/loss calculation
// - Complete reset functionality without server restart
//
// ARCHITECTURE:
// - Backend: Node.js + Socket.IO for real-time communication
// - Frontend: Vanilla JS with Chart.js for visualization
// - API: Bitvavo REST + WebSocket for market data
//
// CONFIGURATION:
// - Set BITVAVO_KEY and BITVAVO_SECRET in .env file
// - Configure via web interface at http://localhost:3007
// ============================================================

import http from 'http';
import { Server } from 'socket.io';
import serveStatic from 'serve-static';
import finalhandler from 'finalhandler';
import open from 'open';
import Bitvavo from 'bitvavo';
import fs from 'fs';
import dotenv from 'dotenv';

// Load .env if present; otherwise fall back to bitvavo.env (no file writes)
const envPath = fs.existsSync('.env') ? '.env' : (fs.existsSync('bitvavo.env') ? 'bitvavo.env' : null);
if (envPath) {
    dotenv.config({ path: envPath });
    console.log(`Loaded environment from ${envPath}`);
} else {
    console.warn('No .env or bitvavo.env found — ensure BITVAVO_KEY/SECRET are set in the environment.');
}

// ============================================================
// GLOBAL ERROR HANDLERS - Prevent crashes from WebSocket errors
// ============================================================
// Catch unhandled promise rejections and exceptions
// Bitvavo library sometimes throws WebSocket errors when reconnecting
// These handlers prevent app crashes and allow reconnection to proceed
// ============================================================
process.on('unhandledRejection', (reason, promise) => {
    const timestamp = new Date().toISOString();
    console.error(`\n❌ [${timestamp}] Unhandled Promise Rejection:`, reason);

    // Check if it's a WebSocket reconnection error (non-fatal)
    if (reason && (
        reason.message?.includes('WebSocket is not open') ||
        reason.message?.includes('readyState') ||
        reason.message?.includes('CONNECTING')
    )) {
        console.error('⚠️  WebSocket reconnection error (Bitvavo library) - this is expected during reconnection');
        console.error('⚠️  Bot will recover automatically - no action needed');
        // Don't crash, let reconnection logic handle it
    } else {
        console.error('⚠️  Unexpected error - please check logs');
    }
});

process.on('uncaughtException', (error) => {
    const timestamp = new Date().toISOString();
    console.error(`\n❌ [${timestamp}] Uncaught Exception:`, error);

    // Check if it's a WebSocket reconnection error (non-fatal)
    if (error.message?.includes('WebSocket is not open') ||
        error.message?.includes('readyState') ||
        error.message?.includes('CONNECTING')) {
        console.error('⚠️  WebSocket connection error during Bitvavo auto-reconnect');
        console.error('⚠️  Bot will recover automatically - continuing...');
        // Don't exit, let it recover
    } else {
        console.error('⚠️  Fatal error - bot exiting');
        process.exit(1);
    }
});

import trainingData from './data.json' assert { type: 'json' };

// ----------------------
// Configuration / constants
// ----------------------
const PORT = parseInt(process.env.PORT ?? '3007', 10);
const SERVE_DIR = 'public';
const START_DELAY_MS = 3000;

// Trading / logic constants (tune via env if needed)
const FEE_RATE = parseFloat(process.env.FEE_RATE ?? '0.0025'); // 0.25%
const PRICE_WINDOW_MINUTES = parseInt(process.env.PRICE_WINDOW_MINUTES ?? '5', 10);
const DEFAULT_INTERVAL_MS = parseInt(process.env.DEFAULT_INTERVAL_MS ?? '10000', 10);
const MAX_WAIT_INDEX = parseInt(process.env.MAX_WAIT_INDEX ?? '100', 10);

// Require credentials in env to avoid accidental commits of secrets
if (!process.env.BITVAVO_KEY || !process.env.BITVAVO_SECRET) {
    console.error('Missing BITVAVO_KEY or BITVAVO_SECRET in environment. Exiting.');
    process.exit(1);
}

const client = Bitvavo().options({
    APIKEY: process.env.BITVAVO_KEY,
    APISECRET: process.env.BITVAVO_SECRET,
    RESTURL: process.env.BITVAVO_APIURL ?? 'https://api.bitvavo.com/v2',
    WSURL: 'wss://ws.bitvavo.com/v2/',
    ACCESSWINDOW: 10000,
    DEBUGGING: process.env.DEBUG === 'true'
});

// ----------------------
// Helper utilities
// ----------------------
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getIndexByMinutes(minutes, interval) {
    return Math.max(1, Math.floor((1000 * 60 * minutes) / interval));
}

async function withRetry(fn, opts = {}) {
    const maxAttempts = opts.retries ?? 3;
    let attempt = 0;
    let delay = opts.initialDelay ?? 500;
    while (attempt < maxAttempts) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            if (attempt >= maxAttempts) throw err;
            await sleep(delay);
            delay *= 2;
        }
    }
}

// Iterative random generators to avoid recursion overflow
function generateRandomObject(prevNum, maxAttempts = 1000) {
    prevNum = prevNum || 1;
    for (let i = 0; i < maxAttempts; i++) {
        const num = Math.floor(Math.random() * 10000) + 1;
        const percentage = Math.abs(num - prevNum) / prevNum;
        if (percentage >= 0.002 && percentage <= 0.004) {
            return { number: num, percentage };
        }
    }
    throw new Error('generateRandomObject: max attempts exceeded');
}

function generateRandomArray(targetLen = 12000, maxAttempts = targetLen * 10) {
    const arr = [];
    let prevNum = Math.floor(Math.random() * 10000) + 1;
    let attempts = 0;
    while (arr.length < targetLen && attempts < maxAttempts) {
        attempts++;
        const num = Math.floor(Math.random() * 10000) + 1;
        const percentage = Math.abs(num - prevNum) / (prevNum || 1);
        if (percentage >= 0.002 && percentage <= 0.004) {
            arr.push({ number: num, percentage });
            prevNum = num;
        }
    }
    if (arr.length !== targetLen) {
        throw new Error('generateRandomArray: could not build array in allowed attempts');
    }
    return arr;
}

// ----------------------
// HTTP + Socket setup
// ----------------------
const serve = serveStatic(SERVE_DIR, { index: ['config.html'] });
const server = http.createServer((req, res) => {
    serve(req, res, finalhandler(req, res));
});
const io = new Server(server);

// Generate unique session ID on server start to detect restarts
const SERVER_SESSION_ID = Date.now().toString();
console.log(`Server session ID: ${SERVER_SESSION_ID}`);

let selectedMarket = null;
let currentWallet = null;
let currentTradingMode = null;
let manualBuyHandler = null;
let manualSellHandler = null;
let currentLastPrices = [];
let currentAssets = []; // Track active positions
let stopCheckLoop = false; // Global flag to stop check loops when switching assets
let checkLoopStarted = false; // Guard to prevent multiple checkstart emissions

io.on('connection', (socket) => {
    // Send server session ID to client - they can detect restarts
    socket.emit('server-session', SERVER_SESSION_ID);

    // Send market info when client connects
    if (selectedMarket) {
        socket.emit('market-selected', selectedMarket);
    }
    if (currentWallet !== null) {
        socket.emit('wallet', currentWallet);
    }
    if (currentTradingMode) {
        socket.emit('trading-mode', currentTradingMode);
    }

    // Handle request for available markets (from config page)
    socket.on('request-markets', async () => {
        try {
            const marketsData = await getMarkets();
            const markets = marketsData
                .filter(m => typeof m.market === 'string' && m.market.includes('EUR'))
                .map(m => m.market.trim())
                .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
            socket.emit('markets-list', markets);
        } catch (err) {
            console.error('Error fetching markets:', err);
            socket.emit('markets-list', []);
        }
    });

    // Handle trading configuration from web page
    socket.on('trading-config', (config) => {
        console.log('Received trading configuration:', config);
        startTradingWithConfig(config);
    });

    // Handle request for current positions (for "Try different Assets")
    socket.on('request-current-state', () => {
        const activePositions = currentAssets
            .filter(asset => asset.currentState === 'sell') // Only bought assets
            .map(asset => ({
                market: asset.market,
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

    // Manual trading handlers - now expect market parameter
    socket.on('manual-buy', (market) => {
        if (typeof manualBuyHandler === 'function') {
            manualBuyHandler(market);
        }
    });

    socket.on('manual-sell', (market) => {
        if (typeof manualSellHandler === 'function') {
            manualSellHandler(market);
        }
    });

    // ============================================================
    // RESET HANDLER - Complete bot reset
    // ============================================================
    // This allows users to start fresh without restarting Node
    //
    // TEST MODE: Clears all positions (no real money involved)
    // REAL MODE: Only clears bot's tracking - does NOT sell positions!
    //            User must manually sell in Bitvavo if desired
    //
    // After reset:
    // - All trading state cleared
    // - Wallet resets to €500 (test mode)
    // - Trading mode selection unlocked
    // - WebSocket connections stopped
    // - All assets become available for trading again
    // ============================================================
    socket.on('reset-trading-bot', async () => {
        console.log('\n🔄 ========== RESET REQUESTED ==========');
        console.log(`📊 Current state: ${currentAssets.length} assets, Mode: ${currentTradingMode}, Wallet: €${currentWallet}`);

        try {
            // Step 1: Handle active positions based on trading mode
            if (currentAssets && currentAssets.length > 0) {
                const activePositions = currentAssets.filter(a => a.currentState === 'sell' && a.cryptoAmount > 0);

                if (activePositions.length > 0) {
                    console.log(`\n📊 Found ${activePositions.length} active position(s):`);

                    if (currentTradingMode === 'real') {
                        // REAL MODE: Do NOT sell automatically - too risky!
                        console.log('⚠️  REAL MODE: Positions will NOT be sold automatically');
                        console.log('⚠️  These positions remain in your Bitvavo account:');
                        activePositions.forEach(asset => {
                            console.log(`   - ${asset.market}: ${asset.cryptoAmount} (bought at €${asset.buyPrice})`);
                        });
                        console.log('⚠️  You must manually sell these in Bitvavo if desired');
                    } else {
                        // TEST MODE: Clear positions (simulated, no real impact)
                        console.log('✅ TEST MODE: Clearing simulated positions');
                        activePositions.forEach(asset => {
                            console.log(`   - ${asset.market}: ${asset.cryptoAmount} (simulated)`);
                        });
                    }
                }
            }

            // Step 2: Stop all active processes
            console.log('\n⏹️  Stopping all processes...');
            stopCheckLoop = true; // Stop check loop
            stopPriceInterval = true; // Stop price collection (if using REST fallback)

            // Close WebSocket if active
            try {
                if (client.websocket && client.websocket.ws) {
                    client.websocket.close();
                    console.log('  ✅ WebSocket closed');
                }
            } catch (e) {
                console.log('  ℹ️  No active WebSocket to close');
            }

            // Wait for loops to stop
            await sleep(2000);

            // Step 3: Reset all global state variables
            console.log('\n🔄 Resetting all state variables...');
            selectedMarket = null;
            currentWallet = null;
            currentTradingMode = null;
            manualBuyHandler = null;
            manualSellHandler = null;
            currentLastPrices = [];
            currentAssets = [];
            stopCheckLoop = false;
            checkLoopStarted = false;

            console.log('  ✅ All state cleared');

            // Step 4: Notify client to clear localStorage and reload
            console.log('\n✅ Reset complete! Client can now start fresh.');
            io.emit('reset-complete');

            console.log('========== RESET COMPLETE ==========\n');
        } catch (err) {
            console.error('❌ Error during reset:', err);
            socket.emit('error', { message: 'Reset failed. Please restart the server.' });
        }
    });
});

async function getMarkets() {
    return withRetry(() => client.markets(), { retries: 3, initialDelay: 500 })
        .catch(err => {
            console.error('getMarkets failed:', err);
            return [];
        });
}

server.listen(PORT, () => {
    console.log(`listening on *:${PORT}`);
});

// ============================================================
// MAIN TRADING LOGIC
// ============================================================
// This function is the heart of the trading bot. It:
// 1. Initializes trading with user-configured parameters
// 2. Sets up WebSocket connections to Bitvavo for real-time price data
// 3. Manages multiple assets simultaneously
// 4. Implements buy/sell logic based on price patterns
// 5. Handles both test mode (simulated) and real mode (actual trades)
// ============================================================
async function startTradingWithConfig(config) {
    const { markets: selectedMarkets, interval: intervalSeconds, buyAmount, tradingMode, preservedWallet, preservedPositions } = config;

    console.log(`Starting trading with ${selectedMarkets.length} asset(s):`, selectedMarkets.join(', '));
    console.log(`Mode: ${tradingMode}, Interval: ${intervalSeconds}s, Buy amount: €${buyAmount}`);

    if (preservedPositions && preservedPositions.length > 0) {
        console.log(`Resuming with ${preservedPositions.length} active position(s)`);
    }

    async function getCurrentPrice(market) {
        try {
            const result = await withRetry(() => client.tickerPrice({ market }), { retries: 3, initialDelay: 300 });
            if (!result || result instanceof Error || result.price === undefined) return null;
            const price = parseFloat(result.price);
            return Number.isFinite(price) ? price : null;
        } catch (err) {
            console.error('getCurrentPrice failed:', err);
            return null;
        }
    }

    const states = { BUY: 'buy', SELL: 'sell' };

    // Runtime variables - now supporting multiple assets
    const selectedAssets = selectedMarkets;
    selectedMarket = selectedAssets; // Now an array
    currentTradingMode = tradingMode;

    // Create asset objects for each selected market
    const assets = selectedAssets.map(market => {
        // Check if this market has a preserved position
        const preserved = preservedPositions?.find(p => p.market === market);

        if (preserved) {
            // Restore the position
            console.log(`Restoring position for ${market}: ${preserved.cryptoAmount} @ €${preserved.buyPrice}`);
            return {
                market,
                currentState: states.SELL, // Already bought
                lastPrices: [],
                buyPrice: preserved.buyPrice,
                maxPrice: preserved.maxPrice,
                waitIndex: preserved.waitIndex,
                stepIndex: preserved.stepIndex,
                sellMoment: null,
                cryptoAmount: preserved.cryptoAmount,
                latestPrice: null,
                lastCheckTime: null,
                wsInitialized: false,
                tradeIndex: preserved.tradeIndex
            };
        } else {
            // New asset in BUY mode
            return {
                market,
                currentState: states.BUY,
                lastPrices: [],
                buyPrice: 0,
                maxPrice: 0,
                waitIndex: 0,
                stepIndex: 0,
                sellMoment: null,
                cryptoAmount: 0,
                latestPrice: null,
                lastCheckTime: null,
                wsInitialized: false,
                tradeIndex: 0
            };
        }
    });

    // Store assets globally for position tracking
    currentAssets = assets;

    // Emit selected markets to all connected clients
    io.emit('market-selected', selectedAssets);
    io.emit('trading-mode', tradingMode);

    let interval = Math.max(1000, intervalSeconds * 1000) || DEFAULT_INTERVAL_MS;
    let wallet;

    // Initialize wallet based on trading mode
    if (preservedWallet !== undefined && preservedWallet !== null) {
        // Use preserved wallet value
        wallet = preservedWallet;
        console.log(`Resuming with preserved wallet: €${wallet.toFixed(2)}`);
    } else if (tradingMode === 'real') {
        try {
            const balanceData = await withRetry(() => client.balance({}), { retries: 3, initialDelay: 500 });
            if (Array.isArray(balanceData)) {
                // Find EUR balance
                const eurBalance = balanceData.find(b => b.symbol === 'EUR');
                if (eurBalance) {
                    wallet = parseFloat(eurBalance.available);
                    console.log(`Real wallet balance: €${wallet.toFixed(2)}`);
                } else {
                    // No EUR balance found
                    wallet = 0;
                    console.log('⚠️  No EUR balance found in your account.');
                    console.log('Current balances:', balanceData.map(b => `${b.symbol}: ${b.available}`).join(', '));
                    console.log('Please deposit EUR to your Bitvavo account to start trading.');
                    process.exit(1);
                }

                // Check for existing crypto positions in real mode (if resuming without preserved positions)
                if (!preservedPositions || preservedPositions.length === 0) {
                    for (const asset of assets) {
                        const cryptoSymbol = asset.market.replace('-EUR', '');
                        const cryptoBalance = balanceData.find(b => b.symbol === cryptoSymbol);

                        if (cryptoBalance && parseFloat(cryptoBalance.available) > 0) {
                            console.log(`⚠️  WARNING: Found existing ${cryptoSymbol} balance: ${cryptoBalance.available}`);
                            console.log(`This position will NOT be managed by the bot unless you sell it first.`);
                            console.log(`The bot will start fresh with BUY mode for ${asset.market}`);
                        }
                    }
                }
            } else {
                console.error('Could not fetch wallet balance.');
                console.error('Response received:', JSON.stringify(balanceData, null, 2));
                process.exit(1);
            }
        } catch (err) {
            console.error('Error fetching wallet balance:', err.message || err);
            console.error('Full error:', JSON.stringify(err, null, 2));
            console.log('\n⚠️  Please check:');
            console.log('1. API key has "View" and "Trade" permissions enabled on Bitvavo');
            console.log('2. No IP whitelist restrictions on your API key');
            console.log('3. Account is fully verified for trading');
            console.log('4. API keys are from production (not test/sandbox)');
            process.exit(1);
        }
    } else {
        wallet = parseFloat(process.env.START_WALLET ?? '500');
        console.log(`Test mode wallet: €${wallet.toFixed(2)}`);
    }

    // Store and emit wallet value
    currentWallet = wallet;
    io.emit('wallet', wallet);

    // Emit initial buy/max prices for preserved positions (with delay to ensure client is ready)
    console.log(`Checking ${assets.length} assets for preserved positions...`);
    setTimeout(() => {
        assets.forEach(asset => {
            console.log(`  ${asset.market}: state=${asset.currentState}, buyPrice=${asset.buyPrice}`);
            if (asset.currentState === states.SELL && asset.buyPrice > 0) {
                io.emit('buy-price', { market: asset.market, price: asset.buyPrice });
                io.emit('max-price', { market: asset.market, price: asset.maxPrice });
                console.log(`  ✅ Emitting preserved state for ${asset.market}: buy=${asset.buyPrice}, max=${asset.maxPrice}`);
            }
        });
    }, 1000); // Wait 1 second for client to initialize

    // Set terminal title to show all markets
    process.stdout.write(`\x1b]2;${selectedAssets.join(', ')}\x1b\x5c`);

    // Stop any previous check loop before starting new one
    if (currentAssets.length > 0) {
        console.log('🛑 Stopping previous check loop...');
        stopCheckLoop = true;
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for old loop to exit
        console.log('✅ Previous check loop stopped');
    }
    stopCheckLoop = false;
    checkLoopStarted = false;

    let stopPriceInterval = false;

    setTimeout(() => startWebSocket(), START_DELAY_MS);

    // ============================================================
    // WEBSOCKET CONNECTION MANAGEMENT
    // ============================================================
    // WebSocket provides real-time price updates from Bitvavo
    // This is more efficient than polling REST API every few seconds
    // The connection includes automatic reconnection logic with retries
    //
    // IMPORTANT: Bitvavo's library has auto-reconnect (100ms) that's too fast!
    // We handle reconnection manually with proper delays
    // ============================================================
    async function startWebSocket() {
        try {
            console.log('Initializing WebSocket connection...');

            // Get emitter and set up error handler
            const emitter = client.getEmitter();

            // Handle WebSocket errors
            emitter.on('error', (error) => {
                const timestamp = new Date().toISOString();
                console.error(`\n⚠️  [${timestamp}] WebSocket error detected:`, error);
                console.error('Error type:', error.name || 'Unknown');
                console.error('Error message:', error.message || 'No message');

                // Try to reconnect after error with longer delay
                console.log('⏰ Scheduling reconnection attempt in 10 seconds...');
                setTimeout(() => {
                    console.log('🔄 Starting WebSocket reconnection process...');
                    reconnectWebSocket().catch(err => {
                        console.error('❌ Reconnection process failed:', err);
                        console.error('⚠️  Trading has stopped. Please restart the bot.');
                        io.emit('error', { message: 'WebSocket connection lost. Please refresh the page.' });
                    });
                }, 10000); // Increased from 5s to 10s
            });

            // Also handle close events
            emitter.on('close', () => {
                const timestamp = new Date().toISOString();
                console.warn(`\n⚠️  [${timestamp}] WebSocket closed unexpectedly`);
                console.log('⏰ Scheduling reconnection attempt in 10 seconds...');
                setTimeout(() => {
                    console.log('🔄 Starting WebSocket reconnection process...');
                    reconnectWebSocket().catch(err => {
                        console.error('❌ Reconnection process failed:', err);
                        io.emit('error', { message: 'WebSocket connection lost. Please refresh the page.' });
                    });
                }, 10000);
            });

            // Initialize WebSocket connection
            // Calling time() will establish the WebSocket connection
            await client.websocket.time();

            // Wait a bit to ensure connection is fully established
            await sleep(1000);

            // Subscribe to all selected markets
            for (let i = 0; i < assets.length; i++) {
                const asset = assets[i];
                console.log(`Subscribing to ${asset.market} (${i + 1}/${assets.length})...`);

                try {
                    // Set up the callback handler FIRST (before subscription)
                    client.websocket.subscriptionTicker(asset.market, (ticker) => {
                        // Find the asset this ticker update is for
                        const currentAsset = assets.find(a => a.market === asset.market);
                        if (!currentAsset) return;

                        // WebSocket ticker structure: use price if available, otherwise midpoint of bid/ask
                        let cp;
                        if (ticker.price) {
                            cp = parseFloat(ticker.price);
                        } else if (ticker.bestBid && ticker.bestAsk) {
                            const bid = parseFloat(ticker.bestBid);
                            const ask = parseFloat(ticker.bestAsk);
                            cp = (bid + ask) / 2;
                        } else if (ticker.bestBid) {
                            cp = parseFloat(ticker.bestBid);
                        } else if (ticker.bestAsk) {
                            cp = parseFloat(ticker.bestAsk);
                        } else {
                            return;
                        }

                        if (!Number.isFinite(cp)) return;

                        // Emit current price with asset identifier
                        io.emit('current-price', { market: currentAsset.market, price: cp });

                        // Collect initial prices before starting check loop
                        if (!currentAsset.wsInitialized) {
                            currentAsset.lastPrices.push(cp);
                            const maxLength = getIndexByMinutes(PRICE_WINDOW_MINUTES, interval);
                            console.log(`[${currentAsset.market}] Collecting prices ${currentAsset.lastPrices.length}/${maxLength}`);

                            // Emit last 5 prices for this asset
                            const last5 = currentAsset.lastPrices.slice(-5);
                            io.emit('last-prices', { market: currentAsset.market, prices: last5 });

                            if (currentAsset.lastPrices.length >= maxLength) {
                                currentAsset.wsInitialized = true;
                                currentAsset.latestPrice = cp;
                                currentAsset.lastCheckTime = Date.now();
                                console.log(`[${currentAsset.market}] WebSocket initialized`);

                                // Start check loop when all assets are initialized
                                const allInitialized = assets.every(a => a.wsInitialized);
                                if (allInitialized && !stopCheckLoop && !checkLoopStarted) {
                                    checkLoopStarted = true; // Prevent multiple emissions
                                    console.log('All assets initialized, starting check loop...');
                                    io.emit('checkstart', assets.map(a => ({ market: a.market, prices: a.lastPrices })));
                                    runCheckLoopWebSocket().catch(err => console.error('runCheckLoop failed:', err));
                                }
                            }
                        } else {
                            // Store latest price for processing at intervals
                            currentAsset.latestPrice = cp;
                            currentAsset.lastPriceUpdate = Date.now(); // Track when we last received data
                        }
                    });

                    console.log(`✅ ${asset.market} subscribed successfully`);

                    // Add delay between subscriptions
                    if (i < assets.length - 1) {
                        await sleep(500);
                    }
                } catch (err) {
                    console.error(`❌ Failed to subscribe to ${asset.market}:`, err.message);
                    throw err; // Rethrow to trigger fallback
                }
            }

            console.log(`WebSocket subscriptions active for ${assets.length} asset(s)`);
        } catch (err) {
            console.error('WebSocket initialization failed:', err);
            console.log('Falling back to REST polling...');
            startNew(); // Fallback to old method
        }
    }

    // ============================================================
    // WEBSOCKET HELPER FUNCTIONS (Currently Unused)
    // ============================================================
    // These were part of complex reconnection logic but simplified approach works better
    // Kept for reference in case of future connection issues
    // Current approach: Just call time() and wait 1 second - it works reliably
    // ============================================================

    async function reconnectWebSocket() {
        const maxReconnectAttempts = 10;
        let reconnectAttempt = 0;

        while (reconnectAttempt < maxReconnectAttempts) {
            reconnectAttempt++;
            try {
                console.log(`🔄 Reconnecting WebSocket (attempt ${reconnectAttempt}/${maxReconnectAttempts})...`);

                // Close existing connection if any
                try {
                    if (client.websocket && client.websocket.ws) {
                        client.websocket.close();
                    }
                } catch (e) {
                    console.log('Closed previous WebSocket connection');
                }

                // Wait before reconnecting (exponential backoff)
                const waitTime = Math.min(3000 * reconnectAttempt, 30000); // Max 30 seconds
                console.log(`Waiting ${waitTime}ms before reconnection attempt...`);
                await sleep(waitTime);

                // Re-initialize WebSocket
                console.log('Initializing new WebSocket connection...');
                await client.websocket.time();

                // Wait longer for WebSocket to be fully established (Bitvavo needs time)
                console.log('Waiting 5 seconds for WebSocket to fully stabilize...');
                await sleep(5000); // Increased from 1s to 5s to avoid Bitvavo's 100ms reconnect race

                // Re-subscribe to all markets (subscriptions are already registered in startWebSocket)
                // Just need to trigger them again after reconnection
                let allSubscribed = true;
                for (let i = 0; i < assets.length; i++) {
                    const asset = assets[i];
                    console.log(`Re-subscribing to ${asset.market} (${i + 1}/${assets.length})...`);

                    try {
                        // Wrap in try-catch to handle Bitvavo's auto-reconnect race condition
                        try {
                            client.websocket.subscriptionTicker(asset.market, () => {
                                // Callback already registered, this just ensures subscription
                            });
                        } catch (subErr) {
                            if (subErr.message?.includes('WebSocket is not open')) {
                                console.warn(`  ${asset.market}: WebSocket still connecting, will retry...`);
                                await sleep(2000); // Wait a bit more
                                client.websocket.subscriptionTicker(asset.market, () => {});
                            } else {
                                throw subErr;
                            }
                        }

                        console.log(`  ✅ ${asset.market} re-subscribed`);

                        // Add delay between subscriptions to avoid overwhelming
                        if (i < assets.length - 1) {
                            await sleep(1000); // Increased from 500ms to 1s
                        }
                    } catch (err) {
                        console.error(`❌ Failed to subscribe to ${asset.market}:`, err.message);
                        allSubscribed = false;
                        break;
                    }
                }

                if (allSubscribed) {
                    const timestamp = new Date().toISOString();
                    console.log(`\n✅ [${timestamp}] WebSocket reconnected successfully!`);
                    console.log(`✅ All ${assets.length} markets re-subscribed and streaming`);
                    console.log('✅ Trading resumed - monitoring for price updates\n');
                    return; // Success - exit function
                } else {
                    throw new Error('Not all markets were subscribed successfully');
                }
            } catch (err) {
                console.error(`❌ WebSocket reconnection attempt ${reconnectAttempt} failed:`, err.message);

                if (reconnectAttempt >= maxReconnectAttempts) {
                    console.error('⛔ Max reconnection attempts reached. Please restart the application.');
                    // Optionally: send alert to frontend
                    io.emit('websocket-error', { message: 'WebSocket connection failed after multiple attempts. Please restart.' });
                    return;
                }

                console.log(`Will retry reconnection in a moment...`);
            }
        }
    }

    // New loop for WebSocket - checks trading logic at configured interval
    async function runCheckLoopWebSocket() {
        console.log(`▶️ Check loop started - evaluating trading logic every ${interval / 1000} seconds`);

        while (!stopCheckLoop) {
            const now = Date.now();

            // Process each asset independently
            for (const asset of assets) {
                const elapsedMs = now - (asset.lastCheckTime || now);
                const intervalMs = interval;

                // Check if this asset's subscription has gone stale (no updates for 30 seconds)
                const timeSinceUpdate = now - (asset.lastPriceUpdate || asset.lastCheckTime || now);
                if (timeSinceUpdate > 30000 && asset.latestPrice !== null) {
                    console.warn(`⚠️  [${asset.market}] WebSocket subscription may be stale (no updates for ${Math.round(timeSinceUpdate / 1000)}s)`);
                    console.warn(`⚠️  Last price: ${asset.latestPrice}, continuing with stale data...`);
                }

                if (elapsedMs >= intervalMs && asset.latestPrice !== null) {
                    // Time to check: use the latest price from WebSocket
                    console.log(`[${asset.market}] Processing price at ${new Date().toISOString()}: ${asset.latestPrice}`);
                    await processAssetPrice(asset, asset.latestPrice).catch(err => console.error(`[${asset.market}] processPrice error:`, err));
                    asset.lastCheckTime = now;
                }
            }

            // Wait a bit before checking again (avoid tight loop)
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log('⏹️ Check loop stopped');
    }

    // ============================================================
    // CORE TRADING DECISION LOGIC
    // ============================================================
    // This function analyzes price data and decides when to buy/sell
    //
    // BUY LOGIC: Triggered when price shows rising pattern
    // - Checks last 12 price points against historical data
    // - Uses multiple factor thresholds (1.002x to 1.008x)
    // - Requires current price > last 2 prices (momentum)
    //
    // SELL LOGIC: Triggered by one of these conditions:
    // - Price drops after reaching +0.6% profit
    // - Peak was +1.2%, now dropped -0.6% from peak
    // - Stop loss: -15% loss
    // - Wait limit: Held for too long without profit
    //
    // This function runs every [interval] seconds for each asset
    // ============================================================
    async function processAssetPrice(asset, cp) {
        let reason = null; // Why we're buying/selling (for logging)
        const threeMinutesIdx = getIndexByMinutes(3, interval);
        const dataLength = asset.lastPrices.length - 1;
        let newState = null; // Will be set to 'buy' or 'sell' if state changes
        let sellAmountReceived = 0; // EUR received from sell (declare at top for scope)

        if (asset.sellMoment) {
            if (asset.stepIndex > (asset.sellMoment + (threeMinutesIdx - 1))) {
                asset.sellMoment = null;
            }
            reason = 'Waiting short cooldown after sell';
        } else {
            if (asset.currentState === states.BUY) {
                // In BUY state, max price should be cleared
                io.emit('max-price', { market: asset.market, price: '-' });
                console.log(`[${asset.market}][BUY MODE] Checking buy conditions - Current price: ${cp}, Prices in array: ${dataLength + 1}`);

                if (dataLength >= 12) {
                    const lp = asset.lastPrices;
                    const safeGet = (i) => (lp[i] !== undefined ? lp[i] : null);
                    const last = safeGet(dataLength);
                    const last1 = safeGet(dataLength - 1);

                    const checks = [
                        { aIdx: dataLength - 2, bIdx: dataLength - 3, factor: 1.002 },
                        { aIdx: dataLength - 3, bIdx: dataLength - 4, factor: 1.003 },
                        { aIdx: dataLength - 4, bIdx: dataLength - 5, factor: 1.003 },
                        { aIdx: dataLength - 5, bIdx: dataLength - 6, factor: 1.004 },
                        { aIdx: dataLength - 6, bIdx: dataLength - 7, factor: 1.004 },
                        { aIdx: dataLength - 7, bIdx: dataLength - 8, factor: 1.005 },
                        { aIdx: dataLength - 8, bIdx: dataLength - 9, factor: 1.005 },
                        { aIdx: dataLength - 9, bIdx: dataLength - 10, factor: 1.007 },
                        { aIdx: dataLength - 10, bIdx: dataLength - 11, factor: 1.007 },
                        { aIdx: dataLength - 11, bIdx: dataLength - 12, factor: 1.008 },
                    ];

                    for (const c of checks) {
                        const a = safeGet(c.aIdx);
                        const b = safeGet(c.bIdx);
                        if (a !== null && b !== null && last !== null && last1 !== null) {
                            if ((cp * c.factor) <= a && (cp * c.factor) <= b && cp > last && cp > last1) {
                                reason = `Rising pattern (×${c.factor})`;
                                console.log(`[${asset.market}] ✅ BUY TRIGGER: cp=${cp}, factor=${c.factor}, a=${a}, b=${b}, last=${last}, last1=${last1}`);
                                break;
                            }
                        }
                    }
                    if (reason === null) {
                        console.log(`[${asset.market}]    No buy pattern matched. Last=${last}, Last1=${last1}`);
                    }
                } else {
                    console.log(`[${asset.market}]    Waiting for data: have ${dataLength + 1} prices, need 13`);
                }

                if (reason !== null) {
                    asset.buyPrice = cp;
                    io.emit('buy-price', { market: asset.market, price: asset.buyPrice });
                    await buy(asset, reason, cp);
                    newState = states.SELL;
                    // Reset maxPrice to 0, will be set on next price update
                    asset.maxPrice = 0;
                }
            } else if (asset.currentState === states.SELL) {
                // MaxPrice should be at least the buy price, or higher if price increased
                if (asset.maxPrice === 0) {
                    asset.maxPrice = Math.max(asset.buyPrice, cp);
                } else {
                    asset.maxPrice = cp > asset.maxPrice ? cp : asset.maxPrice;
                }
                // Don't emit max-price yet - wait until after we check if we're selling
                // (will emit at end of function if no sell happens)

                const walletValue = (buyAmount / (asset.buyPrice || 1)) * cp;
                console.log(`[${asset.market}][SELL MODE] Checking sell conditions - Current: ${cp}, Buy: ${asset.buyPrice}, Max: ${asset.maxPrice}, Profit: ${((cp - asset.buyPrice) / asset.buyPrice * 100).toFixed(2)}%`);

                if (dataLength >= 12) {
                    const lp = asset.lastPrices;
                    const safeGet = (i) => (lp[i] !== undefined ? lp[i] : null);
                    const last = safeGet(dataLength);
                    const last1 = safeGet(dataLength - 1);
                    const last2 = safeGet(dataLength - 2);

                    if (cp >= (asset.buyPrice * 1.006)) {
                        if (last !== null && cp < (last * 1.0003)) {
                            reason = `Price drop -0.3% (€${walletValue.toFixed(2)})`;
                        } else if (last1 !== null && cp < (last1 * 1.0004)) {
                            reason = `Price drop -0.4% vs 2nd last (€${walletValue.toFixed(2)})`;
                        } else if (last2 !== null && cp < (last2 * 1.0005)) {
                            reason = `Price drop -0.5% vs 3rd last (€${walletValue.toFixed(2)})`;
                        } else if (asset.maxPrice >= cp * 1.0006) {
                            reason = `Drop from peak -0.6% (€${walletValue.toFixed(2)})`;
                        }
                    } else if (asset.maxPrice >= (asset.buyPrice * 1.012) && (asset.maxPrice >= (cp * 1.006)) && last !== null && last > cp) {
                        reason = `Peak was +1.2%, now -0.6% (€${walletValue.toFixed(2)})`;
                    } else if (asset.buyPrice >= cp * 1.15) {
                        reason = `STOP LOSS -15% (€${walletValue.toFixed(2)})`;
                    } else if (asset.waitIndex >= MAX_WAIT_INDEX) {
                        reason = `Wait limit reached (€${walletValue.toFixed(2)})`;
                        asset.waitIndex = 0;
                    } else {
                        if (cp >= (asset.buyPrice * 1.0051) && cp <= (asset.buyPrice * 1.009)) {
                            asset.waitIndex++;
                        } else {
                            asset.waitIndex = 0;
                        }
                    }
                }

                if (reason !== null) {
                    asset.sellMoment = asset.stepIndex;
                    const sellAmount = await sell(asset, reason, cp, asset.buyPrice);

                    asset.maxPrice = 0;
                    asset.buyPrice = 0;
                    newState = states.BUY;
                    // Update state IMMEDIATELY before emitting to prevent race conditions
                    asset.currentState = newState;
                    // Now emit the cleared prices (after state change)
                    io.emit('buy-price', { market: asset.market, price: '-' });
                    io.emit('max-price', { market: asset.market, price: '-' });
                    sellAmountReceived = sellAmount; // Store the actual amount received
                }
            }

            if (!reason) {
                reason = `No action required. Maxprice ${asset.maxPrice} Buyprice ${asset.buyPrice}`;
            }
        }

        // Determine amount and action for table display
        let displayAmount = asset.cryptoAmount;
        let displayAction = null; // Only set when actual trade occurs
        let eventIndex = null;
        let eventTime = null;

        // If we just bought (newState is SELL), show buy amount in EUR
        if (newState === states.SELL) {
            displayAmount = buyAmount;
            displayAction = 'buy';
            eventIndex = asset.tradeIndex++;
            eventTime = new Date().toISOString();
            // Update state IMMEDIATELY after buy
            asset.currentState = newState;
        }
        // If we just sold (newState is BUY), show EUR received from sale (after fees)
        else if (newState === states.BUY) {
            displayAmount = sellAmountReceived; // Use the actual amount received from sell function
            displayAction = 'sell';
            eventIndex = asset.tradeIndex++;
            eventTime = new Date().toISOString();
            // State already updated above (line 696)
        }

        io.emit('check', { market: asset.market, amount: displayAmount, price: cp, reason, action: displayAction, wallet, eventIndex, eventTime });

        // Emit max-price only if we're still in SELL state (didn't just sell)
        if (asset.currentState === states.SELL) {
            io.emit('max-price', { market: asset.market, price: asset.maxPrice });
        }

        asset.lastPrices.push(cp);
        const maxLen = getIndexByMinutes(PRICE_WINDOW_MINUTES, interval);
        while (asset.lastPrices.length > maxLen) asset.lastPrices.shift();

        // Emit last 5 prices for this asset
        const last5 = asset.lastPrices.slice(-5);
        io.emit('last-prices', { market: asset.market, prices: last5 });

        asset.stepIndex++;
    }

    // ============================================================
    // BUY FUNCTION - Execute purchase of crypto
    // ============================================================
    // Real mode: Places actual market order on Bitvavo
    // Test mode: Simulates purchase with fee calculation
    //
    // Bitvavo fee structure (both modes):
    // - Fee is 0.25% (0.0025) of the buy amount
    // - Fee is DEDUCTED from the buy amount (not added on top)
    // - Example: Buy €100 → Fee €0.25 → Receive €99.75 worth of crypto
    // ============================================================
    async function buy(asset, reason, cp) {
        if (tradingMode === 'real') {
            try {
                console.log(`[${asset.market}] 🔄 Attempting REAL BUY: €${buyAmount} at price ${cp}`);
                console.log(`[${asset.market}] Order params:`, { market: asset.market, side: 'buy', type: 'market', amountQuote: buyAmount.toString() });

                const order = await withRetry(() =>
                    client.placeOrder(asset.market, 'buy', 'market', 0, {
                        amountQuote: buyAmount.toString()
                    }),
                    { retries: 3, initialDelay: 500 }
                );

                console.log(`[${asset.market}] ✅ Order response:`, JSON.stringify(order, null, 2));
                asset.cryptoAmount = parseFloat(order.filledAmount || 0);

                const balanceData = await withRetry(() => client.balance({ symbol: 'EUR' }), { retries: 3, initialDelay: 500 });
                wallet = parseFloat(balanceData[0].available);
                currentWallet = wallet;
                io.emit('wallet', wallet);
                console.log(`[${asset.market}] Real BUY executed: ${asset.cryptoAmount} @ €${cp}, New balance: €${wallet.toFixed(2)}`);
            } catch (err) {
                console.error(`[${asset.market}] ❌ Real buy failed:`, err);
                console.error(`[${asset.market}] Error details:`, JSON.stringify(err, null, 2));
                if (err.error) console.error(`[${asset.market}] API error message:`, err.error);
                if (err.errorCode) console.error(`[${asset.market}] API error code:`, err.errorCode);
                return;
            }
        } else {
            // Test mode: Match Bitvavo's real behavior
            // Fee is deducted from the buy amount (not added on top)
            const fee = buyAmount * FEE_RATE;
            const amountAfterFee = buyAmount - fee;
            asset.cryptoAmount = amountAfterFee / cp;
            // Wallet is reduced by ONLY the buyAmount (fee already deducted from it)
            wallet = wallet - buyAmount;
            currentWallet = wallet;
            io.emit('wallet', wallet);
            console.log(`[${asset.market}] Test BUY: €${buyAmount} (fee: €${fee.toFixed(4)}), received ${asset.cryptoAmount.toFixed(8)} crypto`);
        }
        log(asset.market, states.BUY, reason, cp);
    }

    // ============================================================
    // SELL FUNCTION - Execute sale of crypto
    // ============================================================
    // Real mode: Places actual market sell order on Bitvavo
    // Test mode: Simulates sale with fee calculation
    //
    // Bitvavo fee structure (both modes):
    // - Fee is 0.25% (0.0025) of the gross sale amount
    // - Fee is DEDUCTED from what you receive
    // - Example: Sell crypto worth €100 → Fee €0.25 → Receive €99.75
    // ============================================================
    async function sell(asset, reason, cp, bp) {
        let sellAmount = 0; // Amount in EUR received from sale (after fees)
        if (tradingMode === 'real') {
            try {
                const order = await withRetry(() =>
                    client.placeOrder(asset.market, 'sell', 'market', 0, {
                        amount: asset.cryptoAmount.toString()
                    }),
                    { retries: 3, initialDelay: 500 }
                );
                sellAmount = parseFloat(order.filledAmountQuote || 0);
                const balanceData = await withRetry(() => client.balance({ symbol: 'EUR' }), { retries: 3, initialDelay: 500 });
                wallet = parseFloat(balanceData[0].available);
                currentWallet = wallet;
                io.emit('wallet', wallet);
                asset.cryptoAmount = 0;
                console.log(`[${asset.market}] Real SELL executed: Received €${sellAmount.toFixed(2)}, New balance: €${wallet.toFixed(2)}`);
            } catch (err) {
                console.error(`[${asset.market}] Real sell failed:`, err);
                return 0;
            }
        } else {
            // Test mode: Match Bitvavo's real behavior
            // When selling, you receive EUR but fee is deducted from it
            const grossProfit = asset.cryptoAmount * cp;
            const fee = grossProfit * FEE_RATE;
            sellAmount = grossProfit - fee;
            wallet = wallet + sellAmount;
            currentWallet = wallet;
            io.emit('wallet', wallet);
            console.log(`[${asset.market}] Test SELL: ${asset.cryptoAmount.toFixed(8)} crypto = €${grossProfit.toFixed(4)} (fee: €${fee.toFixed(4)}), received €${sellAmount.toFixed(4)}`);
            asset.cryptoAmount = 0;
        }
        log(asset.market, states.SELL, reason, cp, bp);
        return sellAmount;
    }

    function log(market, state, message, cp, bp) {
        const time = new Date().toISOString();
        if (state === states.BUY) {
            console.info(`[${time}][${market}] BUY  ${cp} - ${message}`);
        } else {
            console.info(`[${time}][${market}] SELL ${cp} (bought at ${bp}) - ${message}`);
        }
    }

    // Manual trading handlers - now accept market parameter
    manualBuyHandler = async (market) => {
        const asset = assets.find(a => a.market === market);
        if (!asset) {
            console.log(`Manual BUY ignored - asset ${market} not found`);
            return;
        }

        if (asset.currentState === states.BUY && asset.latestPrice !== null) {
            console.log(`[${market}] Manual BUY triggered`);
            asset.buyPrice = asset.latestPrice;
            io.emit('buy-price', { market, price: asset.buyPrice });
            await buy(asset, 'Manual Buy', asset.latestPrice);
            asset.currentState = states.SELL;
            // Reset maxPrice to 0, will track from next price update
            asset.maxPrice = 0;
            io.emit('max-price', { market, price: 0 });
            // Emit check event for table with buy amount
            const eventIndex = asset.tradeIndex++;
            const eventTime = new Date().toISOString();
            io.emit('check', { market, amount: buyAmount, price: asset.latestPrice, reason: 'Manual Buy', action: 'buy', wallet, eventIndex, eventTime });
        } else {
            console.log(`[${market}] Manual BUY ignored - already in SELL state or no price available`);
        }
    };

    manualSellHandler = async (market) => {
        const asset = assets.find(a => a.market === market);
        if (!asset) {
            console.log(`Manual SELL ignored - asset ${market} not found`);
            return;
        }

        if (asset.currentState === states.SELL && asset.latestPrice !== null && asset.buyPrice > 0) {
            console.log(`[${market}] Manual SELL triggered`);
            // Calculate profit before selling
            const profit = asset.cryptoAmount * asset.latestPrice;
            await sell(asset, 'Manual Sell', asset.latestPrice, asset.buyPrice);
            asset.maxPrice = 0;
            asset.buyPrice = 0;
            io.emit('buy-price', { market, price: '-' });
            io.emit('max-price', { market, price: '-' });
            asset.currentState = states.BUY;
            // Emit check event for table with profit amount
            const eventIndex = asset.tradeIndex++;
            const eventTime = new Date().toISOString();
            io.emit('check', { market, amount: profit, price: asset.latestPrice, reason: 'Manual Sell', action: 'sell', wallet, eventIndex, eventTime });
        } else {
            console.log(`[${market}] Manual SELL ignored - not in SELL state, no price available, or no buy price set`);
        }
    };

    // ============================================================
    // REST POLLING FALLBACK (Currently Disabled for Multi-Asset)
    // ============================================================
    // This was the old method using REST API polling before WebSocket
    // Currently not updated for multi-asset support
    // If WebSocket fails, the bot will show an error instead
    // ============================================================
    function startNew() {
        console.error('❌ REST polling fallback is not available for multi-asset mode');
        console.error('❌ WebSocket connection is required. Please check:');
        console.error('   1. Your internet connection');
        console.error('   2. Bitvavo API status');
        console.error('   3. Try restarting the bot');

        io.emit('error', {
            message: 'WebSocket connection failed. Please refresh the page and try again.'
        });
    }

    // Graceful shutdown
    async function shutdown() {
        console.log('Shutting down gracefully...');
        stopPriceInterval = true;
        stopCheckLoop = true;
        try {
            // Close WebSocket if active
            if (wsInitialized && client.websocket) {
                client.websocket.close();
                console.log('WebSocket closed.');
            }
            io.emit('shutdown');
            await new Promise(res => server.close(res));
            io.close();
            console.log('Server and sockets closed.');
        } catch (err) {
            console.error('Error during shutdown:', err);
        }
        process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

// Open browser to configuration page on startup
(async () => {
    await open(`http://localhost:${PORT}`);
    console.log('\n🚀 Crypto Trading Bot Started!');
    console.log(`📊 Open http://localhost:${PORT} in your browser to configure trading\n`);
})();