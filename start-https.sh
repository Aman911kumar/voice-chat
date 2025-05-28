#!/bin/bash

echo "🔒 Starting Voice Chat App with HTTPS support for Mobile..."

# Set environment variables for HTTPS
export USE_HTTPS=true
export PORT=3001

# Install server dependencies if needed
if [ ! -d "server/node_modules" ]; then
    echo "📦 Installing server dependencies..."
    cd server
    npm install
    cd ..
fi

# Install client dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing client dependencies..."
    npm install --legacy-peer-deps
fi

# Create environment file with HTTPS
echo "⚙️ Setting up environment variables for HTTPS..."
echo "NEXT_PUBLIC_SERVER_URL=https://localhost:3001" > .env.local
echo "USE_HTTPS=true" >> .env.local
echo "PORT=3001" >> .env.local

# Create recordings directory
echo "📁 Creating recordings directory..."
mkdir -p server/recordings

# Get local IP address for mobile connection
LOCAL_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || ifconfig | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -Eo '([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1)

echo "🚀 Starting HTTPS server on port 3001..."
cd server
USE_HTTPS=true npm run dev &
SERVER_PID=$!
cd ..

# Wait for server to start
sleep 3

echo "🌐 Starting Next.js client on port 3000..."
npm run dev &
CLIENT_PID=$!

echo "✅ Both servers started with HTTPS support!"
echo ""
echo "🔒 HTTPS Server: https://localhost:3001"
echo "🌐 Client: http://localhost:3000"
echo ""
echo "📱 For Mobile Devices:"
echo "   📶 Connect to the same WiFi network"
echo "   🌐 Server URL: https://$LOCAL_IP:3001"
echo "   📱 Update NEXT_PUBLIC_SERVER_URL to: https://$LOCAL_IP:3001"
echo "   ⚠️  Accept security warning for self-signed certificate"
echo "   🎤 Allow microphone permissions when prompted"
echo ""
echo "🛠️  Mobile Setup Commands:"
echo "   echo 'NEXT_PUBLIC_SERVER_URL=https://$LOCAL_IP:3001' > .env.local"
echo "   echo 'USE_HTTPS=true' >> .env.local"
echo ""
echo "Press Ctrl+C to stop both servers"

# Function to cleanup on exit
cleanup() {
    echo "🛑 Stopping servers..."
    kill $SERVER_PID 2>/dev/null
    kill $CLIENT_PID 2>/dev/null
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup SIGINT SIGTERM

# Wait for user to stop
wait $SERVER_PID $CLIENT_PID
