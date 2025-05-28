#!/bin/bash

echo "🚀 Setting up Voice Chat App..."

# Clean up any existing installations
echo "🧹 Cleaning up existing installations..."
rm -rf node_modules package-lock.json
rm -rf server/node_modules server/package-lock.json

# Install client dependencies
echo "📦 Installing client dependencies..."
npm install --legacy-peer-deps

# Install server dependencies
echo "🖥️ Installing server dependencies..."
cd server
npm install
cd ..

# Create environment file
echo "⚙️ Setting up environment variables..."
echo "NEXT_PUBLIC_SERVER_URL=http://localhost:3001" > .env.local

# Create recordings directory
echo "📁 Creating recordings directory..."
mkdir -p server/recordings

echo "✅ Setup complete!"
echo ""
echo "🎯 To start the application:"
echo "1. Start the server: cd server && npm run dev"
echo "2. Start the client: npm run dev"
echo "3. Open http://localhost:3000 in your browser"
