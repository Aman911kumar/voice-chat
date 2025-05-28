@echo off
echo 🚀 Setting up Voice Chat App...

REM Clean up any existing installations
echo 🧹 Cleaning up existing installations...
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del package-lock.json
if exist server\node_modules rmdir /s /q server\node_modules
if exist server\package-lock.json del server\package-lock.json

REM Install client dependencies
echo 📦 Installing client dependencies...
npm install --legacy-peer-deps

REM Install server dependencies
echo 🖥️ Installing server dependencies...
cd server
npm install
cd ..

REM Create environment file
echo ⚙️ Setting up environment variables...
echo NEXT_PUBLIC_SERVER_URL=http://localhost:3001 > .env.local

REM Create recordings directory
echo 📁 Creating recordings directory...
if not exist server\recordings mkdir server\recordings

echo ✅ Setup complete!
echo.
echo 🎯 To start the application:
echo 1. Start the server: cd server ^&^& npm run dev
echo 2. Start the client: npm run dev
echo 3. Open http://localhost:3000 in your browser
pause
