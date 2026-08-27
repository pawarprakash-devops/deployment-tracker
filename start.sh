#!/bin/bash

# Quick Start Script for Deployment Tracker
# Location: /home/pawarpr/Desktop/WSL-Backup/deployment-tracker

cd /home/pawarpr/Desktop/WSL-Backup/deployment-tracker

echo "🚀 Starting Deployment Tracker..."
echo "📍 Location: $(pwd)"
echo "🔗 Database: Neon Postgres (deployment-tracker)"
echo ""
echo "Opening in browser in 3 seconds..."
echo ""

# Start the dev server
npm run dev &

# Wait for server to start
sleep 3

# Open in browser (try different browsers)
if command -v xdg-open > /dev/null; then
    xdg-open http://localhost:3000
elif command -v open > /dev/null; then
    open http://localhost:3000
elif command -v start > /dev/null; then
    start http://localhost:3000
else
    echo "✅ Server running at: http://localhost:3000"
    echo "   (Open this URL in your browser)"
fi

echo ""
echo "Press Ctrl+C to stop the server"

# Wait for user to stop
wait
