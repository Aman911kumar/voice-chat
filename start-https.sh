#!/bin/bash

echo "🔒 Starting Voice Chat App with HTTPS support..."

# Install server dependencies if needed
if [ ! -d "server/node_modules" ]; then
    echo "📦 Installing server dependencies..."
    cd server
    npm install
    cd ..
fi

# Start server with HTTPS
echo "🚀 Starting HTTPS server on port 3001..."
cd server
USE_HTTPS=true npm run dev &
SERVER_PID=$!
cd ..

# Wait for server to start
sleep 3

# Start client
echo "🌐 Starting Next.js client on port 3000..."
npm run dev &
CLIENT_PID=$!

echo "✅ Both servers started!"
echo "🔒 HTTPS Server: https://localhost:3001"
echo "🌐 Client: http://localhost:3000"
echo "📱 For mobile: Update NEXT_PUBLIC_SERVER_URL to https://YOUR_IP:3001"
echo ""
echo "Press Ctrl+C to stop both servers"

# Wait for user to stop
wait $SERVER_PID $CLIENT_PID
