#!/bin/bash
# tests/manual/run-integration-test.sh
# Manual integration test script for Two-Tier LLM Architecture

echo "=== Two-Tier LLM Integration Test ==="

# 1. Build
echo "Building..."
npm run build

if [ $? -ne 0 ]; then
    echo "Build failed!"
    exit 1
fi

# 2. Start app in background
echo "Starting app..."
npm run dev &
APP_PID=$!
sleep 5

# 3. Check logs for startup
echo "Checking startup logs..."
if [ -f logs/app.log ]; then
    grep -i "claude\|intent\|router" logs/app.log | tail -20
else
    echo "No log file found at logs/app.log"
fi

# 4. Wait for manual testing
echo ""
echo "App is running (PID: $APP_PID). Test these scenarios via Telegram:"
echo "  1. Send: 'Hello!' (should be fast, ~1s)"
echo "  2. Send: 'What's the weather in NYC?' (Claude + search)"
echo "  3. Send: 'Explain recursion' (Claude, complex)"
echo ""
echo "Press Enter when done testing..."
read

# 5. Check response logs
echo "Response logs:"
if [ -f logs/app.log ]; then
    grep -i "response\|intent\|claude\|ollama" logs/app.log | tail -50
else
    echo "No log file found"
fi

# 6. Cleanup
echo "Stopping app..."
kill $APP_PID 2>/dev/null

echo "Done!"
