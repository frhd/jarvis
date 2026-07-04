#!/bin/bash
# Jarvis Launcher Script for launchd
# This script sets up the proper Node.js environment via NVM

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

cd /Users/jarvis/src/jarvis

# Ensure we're using the right Node version
nvm use default 2>/dev/null || true

# Set production environment
export NODE_ENV=production

# Run Jarvis
exec node dist/index.js
