@echo off
echo 🔒 Starting Voice Chat App with HTTPS support for Mobile...

REM Set environment variables for HTTPS
set USE_HTTPS=true
set PORT=3001

REM Install server dependencies if needed
if not exist server\node_modules (
    echo 📦 Installing server dependencies...
    cd server
    npm install
    cd ..
)

REM Install client dependencies if needed
if not exist node_modules (
    echo 📦 Installing client dependencies...
    npm install --legacy-peer-deps
)

REM Create environment file with HTTPS
echo ⚙️ Setting up environment variables for HTTPS...
echo NEXT_PUBLIC_SERVER_URL=https://localhost:3001 > .env.local
echo USE_HTTPS=true >> .env.local
echo PORT=3001 >> .env.local

REM Create recordings directory
echo 📁 Creating recordings directory...
if not exist server\recordings mkdir server\recordings

REM Get local IP address for mobile connection
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    set LOCAL_IP=%%a
    goto :found_ip
)
:found_ip
set LOCAL_IP=%LOCAL_IP: =%

echo 🚀 Starting HTTPS server on port 3001...
cd server
start "HTTPS Server" cmd /k "set USE_HTTPS=true && npm run dev"
cd ..

REM Wait for server to start
timeout /t 3 /nobreak > nul

echo 🌐 Starting Next.js client on port 3000...
start "Next.js Client" cmd /k "npm run dev"

echo ✅ Both servers started with HTTPS support!
echo.
echo 🔒 HTTPS Server: https://localhost:3001
echo 🌐 Client: http://localhost:3000
echo.
echo 📱 For Mobile Devices:
echo    📶 Connect to the same WiFi network
echo    🌐 Server URL: https://%LOCAL_IP%:3001
echo    📱 Update NEXT_PUBLIC_SERVER_URL to: https://%LOCAL_IP%:3001
echo    ⚠️  Accept security warning for self-signed certificate
echo    🎤 Allow microphone permissions when prompted
echo.
echo 🛠️  Mobile Setup Commands:
echo    echo NEXT_PUBLIC_SERVER_URL=https://%LOCAL_IP%:3001 ^> .env.local
echo    echo USE_HTTPS=true ^>^> .env.local
echo.
echo Press any key to continue...
pause > nul
