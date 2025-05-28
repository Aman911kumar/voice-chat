# 📱 Mobile Setup Guide for Voice Chat App

## 🔒 HTTPS Configuration for Mobile Devices

### Quick Start

1. **Run the HTTPS setup script:**
   \`\`\`bash
   # Linux/Mac
   ./start-https.sh
   
   # Windows
   start-https.bat
   \`\`\`

2. **Find your local IP address:**
   - The script will display your local IP automatically
   - Or manually find it:
     - **Windows:** `ipconfig` (look for IPv4 Address)
     - **Mac/Linux:** `ifconfig` or `hostname -I`

3. **Update environment for mobile:**
   \`\`\`bash
   echo "NEXT_PUBLIC_SERVER_URL=https://YOUR_LOCAL_IP:3001" > .env.local
   echo "USE_HTTPS=true" >> .env.local
   \`\`\`

### 📱 Mobile Device Setup

#### Step 1: Connect to Same WiFi
- Ensure your mobile device is on the same WiFi network as your development machine

#### Step 2: Access the Server
- Open your mobile browser
- Navigate to: `https://YOUR_LOCAL_IP:3001/test`
- **Important:** You'll see a security warning about the self-signed certificate

#### Step 3: Accept Security Certificate
- **Chrome/Safari:** Click "Advanced" → "Proceed to [IP] (unsafe)"
- **Firefox:** Click "Advanced" → "Accept the Risk and Continue"
- This is safe for local development

#### Step 4: Test the Connection
- You should see a JSON response with server information
- If successful, navigate to your Next.js app

#### Step 5: Allow Microphone Permissions
- When prompted, allow microphone access
- This is required for voice chat functionality

### 🛠️ Manual Configuration

If the automatic scripts don't work, configure manually:

#### Server Configuration
\`\`\`javascript
// server/server.js - HTTPS is enabled by default
const useHTTPS = process.env.USE_HTTPS === "true" || true
\`\`\`

#### Client Configuration
\`\`\`bash
# .env.local
NEXT_PUBLIC_SERVER_URL=https://YOUR_LOCAL_IP:3001
USE_HTTPS=true
PORT=3001
\`\`\`

#### Start Servers Manually
\`\`\`bash
# Terminal 1 - Start HTTPS server
cd server
USE_HTTPS=true npm run dev

# Terminal 2 - Start Next.js client
npm run dev
\`\`\`

### 🔍 Troubleshooting

#### Certificate Issues
- **Problem:** Browser blocks self-signed certificate
- **Solution:** Click "Advanced" and proceed anyway (safe for local development)

#### Connection Refused
- **Problem:** Mobile can't connect to server
- **Solution:** 
  - Check firewall settings
  - Ensure both devices are on same WiFi
  - Verify IP address is correct

#### Microphone Not Working
- **Problem:** No audio detected on mobile
- **Solution:**
  - Check browser permissions
  - Try refreshing the page
  - Ensure HTTPS is being used (required for microphone access)

#### Mixed Content Errors
- **Problem:** Client tries to connect to HTTP server
- **Solution:** Ensure `NEXT_PUBLIC_SERVER_URL` uses `https://`

### 📊 Network Information

The server will display available network interfaces on startup:

\`\`\`
📱 Mobile devices can connect using these URLs:
   📱 WiFi: https://192.168.1.100:3001
   📱 Ethernet: https://10.0.0.50:3001
\`\`\`

Use the appropriate URL for your network setup.

### 🔐 Security Notes

- Self-signed certificates are used for development only
- In production, use proper SSL certificates
- The certificate includes localhost and common IP patterns
- Mobile browsers will show security warnings - this is expected

### 🎯 Testing Checklist

- [ ] Server starts with HTTPS enabled
- [ ] Mobile device connects to same WiFi
- [ ] Browser accepts self-signed certificate
- [ ] `/test` endpoint returns JSON response
- [ ] Microphone permissions granted
- [ ] Voice chat room loads successfully
- [ ] Audio recording works on mobile
- [ ] WebRTC connections establish between devices

### 📞 Support

If you encounter issues:

1. Check the server logs for error messages
2. Verify network connectivity with `ping YOUR_LOCAL_IP`
3. Test with different mobile browsers
4. Ensure firewall isn't blocking port 3001
5. Try restarting both server and client

### 🚀 Production Deployment

For production use:
- Use a proper SSL certificate from a CA
- Configure proper CORS policies
- Set up proper firewall rules
- Use environment-specific configuration
