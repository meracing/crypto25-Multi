#!/bin/bash

# Crypto Trading Bot - WebSocket Monitor
# This script monitors the bot's logs for reconnection events
# Run in a separate terminal while bot is running

echo "================================================"
echo "  Crypto Bot WebSocket Monitor"
echo "================================================"
echo "Monitoring for reconnection events..."
echo "Press Ctrl+C to stop"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counter for events
DISCONNECTS=0
RECONNECTS=0

# Find the node process
PID=$(pgrep -f "node.*index.js" | head -1)

if [ -z "$PID" ]; then
    echo "❌ Bot is not running! Start it first with:"
    echo "   node --experimental-modules index.js"
    exit 1
fi

echo "✅ Found bot process (PID: $PID)"
echo "📊 Monitoring logs..."
echo "================================================"
echo ""

# Monitor the process output
tail -f /proc/$PID/fd/1 2>/dev/null | while read line; do
    # Detect WebSocket errors
    if echo "$line" | grep -qi "websocket error\|connection.*lost\|disconnect"; then
        DISCONNECTS=$((DISCONNECTS + 1))
        echo -e "${RED}[$(date '+%H:%M:%S')] ⚠️  DISCONNECT #$DISCONNECTS${NC}"
        echo -e "${RED}    $line${NC}"
    fi

    # Detect reconnection attempts
    if echo "$line" | grep -qi "reconnecting.*websocket\|attempting.*reconnect"; then
        echo -e "${YELLOW}[$(date '+%H:%M:%S')] 🔄 Reconnection attempt${NC}"
        echo -e "${YELLOW}    $line${NC}"
    fi

    # Detect successful reconnection
    if echo "$line" | grep -qi "reconnected successfully\|all.*markets.*subscribed"; then
        RECONNECTS=$((RECONNECTS + 1))
        echo -e "${GREEN}[$(date '+%H:%M:%S')] ✅ RECONNECT SUCCESS #$RECONNECTS${NC}"
        echo -e "${GREEN}    $line${NC}"
        echo ""
    fi

    # Detect trading events (buy/sell)
    if echo "$line" | grep -qi "manual buy\|manual sell\|real buy\|real sell"; then
        echo -e "${BLUE}[$(date '+%H:%M:%S')] 💰 TRADE${NC}"
        echo -e "${BLUE}    $line${NC}"
    fi

    # Detect critical errors
    if echo "$line" | grep -qi "max.*attempts reached\|failed.*reconnect\|trading.*stopped"; then
        echo -e "${RED}[$(date '+%H:%M:%S')] ❌ CRITICAL ERROR${NC}"
        echo -e "${RED}    $line${NC}"
        echo -e "${RED}================================================${NC}"
        echo -e "${RED}⚠️  BOT NEEDS RESTART!${NC}"
        echo -e "${RED}================================================${NC}"
    fi
done
