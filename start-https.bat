@echo off
echo 🔒 Starting Voice Chat App with HTTPS support...

REM Install server dependencies if needed
if not exist server\node_modules (
    echo 📦 Installing server dependencies...
    cd server
    npm install
    cd ..
)

REM Start server with HTTPS
echo 🚀 Starting HTTPS server on port 3001...
cd server
start "HTTPS Server" cmd /k "set USE_HTTPS=true && npm run dev"
cd ..

REM Wait for server to start
timeout /t 3 /nobreak > nul

REM Start client
echo 🌐 Starting Next.js client on port 3000...
start "Next.js Client" cmd /k "npm run dev"

echo ✅ Both servers started!
echo 🔒 HTTPS Server: https://localhost:3001
echo 🌐 Client: http://localhost:3000
echo 📱 For mobile: Update NEXT_PUBLIC_SERVER_URL to https://YOUR_IP:3001
echo.
echo Press any key to continue...
pause > nul
