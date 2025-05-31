const express = require("express")
const https = require("https")
const http = require("http")
const socketIo = require("socket.io")
const fs = require("fs")
const path = require("path")
const cors = require("cors")

const app = express()

// Create HTTPS server with self-signed certificate for development
let server
const useHTTPS = process.env.USE_HTTPS === "true"

if (useHTTPS) {
  // Create self-signed certificate for development
  const selfsigned = require("selfsigned")
  const attrs = [{ name: "commonName", value: "localhost" }]
  const pems = selfsigned.generate(attrs, { days: 365 })

  const httpsOptions = {
    key: pems.private,
    cert: pems.cert,
  }

  server = https.createServer(httpsOptions, app)
  console.log("🔒 HTTPS server enabled")
} else {
  server = http.createServer(app)
  console.log("🔓 HTTP server enabled")
}

// Enhanced Socket.io configuration for mobile support
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: false,
    allowedHeaders: ["*"],
  },
  allowEIO3: true,
  transports: ["polling", "websocket"],
  maxHttpBufferSize: 1e8,
  pingTimeout: 120000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  httpCompression: true,
  perMessageDeflate: true,
})

// Enhanced middleware for mobile support
app.use(
  cors({
    origin: "*",
    credentials: false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["*"],
  }),
)

// Handle preflight requests
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  res.header("Access-Control-Allow-Headers", "*")
  res.sendStatus(200)
})

app.use(express.json({ limit: "50mb" }))
app.use(express.static("public"))

// Create recordings directory if it doesn't exist
const recordingsDir = path.join(__dirname, "recordings")
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true })
}

// Helper to get a room's folder
function getRoomFolder(roomId) {
  const folder = path.join(recordingsDir, `room-${roomId}`)
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true })
  }
  return folder
}

// In-memory storage for rooms and recordings
const rooms = new Map()
const userSockets = new Map()

// Room data structure
class Room {
  constructor(id) {
    this.id = id
    this.users = new Map() // Changed to Map for better user management
    this.isRecording = false
    this.recordingChunks = []
    this.recordingStartTime = null
    this.recordingFilePath = null
    this.recordingStream = null
    this.lastActivity = Date.now()
  }

  addUser(userId, socketId) {
    this.users.set(userId, { userId, socketId, joinedAt: Date.now() })
    this.lastActivity = Date.now()
    console.log(`👥 Room ${this.id}: Added user ${userId}. Total users: ${this.users.size}`)
  }

  removeUser(userId) {
    const removed = this.users.delete(userId)
    this.lastActivity = Date.now()
    if (removed) {
      console.log(`👥 Room ${this.id}: Removed user ${userId}. Total users: ${this.users.size}`)
    }
    return removed
  }

  getUserCount() {
    return this.users.size
  }

  getUsers() {
    return Array.from(this.users.values())
  }

  hasUser(userId) {
    return this.users.has(userId)
  }

  updateActivity() {
    this.lastActivity = Date.now()
  }

  getUserBySocketId(socketId) {
    for (const user of this.users.values()) {
      if (user.socketId === socketId) {
        return user
      }
    }
    return null
  }
}

// Socket.io connection handling
io.on("connection", (socket) => {
  console.log(`✅ User connected: ${socket.id} from ${socket.handshake.address}`)

  // Enhanced connection handling
  socket.on("connect_error", (error) => {
    console.error("❌ Socket connection error:", error)
  })

  // Join room - FIXED VERSION
  socket.on("join-room", (data) => {
    const { roomId, userId } = data
    console.log(`🚪 User ${userId} attempting to join room ${roomId}`)

    // Validate input
    if (!roomId || !userId) {
      socket.emit("room-join-error", { error: "Missing roomId or userId" })
      return
    }

    // Check if user is already in a room
    const existingUserInfo = userSockets.get(socket.id)
    if (existingUserInfo) {
      console.log(`⚠️ User ${userId} already in room ${existingUserInfo.roomId}, leaving first`)
      // Leave existing room first
      socket.leave(existingUserInfo.roomId)
      if (rooms.has(existingUserInfo.roomId)) {
        rooms.get(existingUserInfo.roomId).removeUser(existingUserInfo.userId)
      }
    }

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Room(roomId))
      console.log(`🆕 Created new room: ${roomId}`)
    }

    const room = rooms.get(roomId)

    // Add user to room
    room.addUser(userId, socket.id)
    userSockets.set(socket.id, { userId, roomId })

    // Join socket room
    socket.join(roomId)

    // Get other users in the room (excluding the joining user)
    const otherUsers = room.getUsers().filter((user) => user.userId !== userId)

    console.log(`📢 Notifying ${otherUsers.length} existing users about new user ${userId}`)

    // Notify OTHER users in the room about the new user
    socket.to(roomId).emit("user-joined", {
      userId,
      socketId: socket.id,
      timestamp: Date.now(),
    })

    // Send current room state to the JOINING user
    socket.emit("room-joined", {
      success: true,
      roomId,
      userId,
      users: otherUsers, // Send list of other users
      isRecording: room.isRecording,
      totalUsers: room.getUserCount(),
      timestamp: Date.now(),
    })

    // If room is currently recording, notify the new user
    if (room.isRecording) {
      console.log(`🎙️ Room ${roomId} is recording, notifying new user ${userId}`)
      socket.emit("recording-started", {
        roomId,
        timestamp: room.recordingStartTime,
        isExistingRecording: true
      })
    }

    console.log(`✅ User ${userId} joined room ${roomId}. Total users: ${room.getUserCount()}`)
    console.log(
      `📋 Room ${roomId} users:`,
      room.getUsers().map((u) => u.userId),
    )

    // Broadcast updated room info to all users
    io.to(roomId).emit("room-updated", {
      roomId,
      totalUsers: room.getUserCount(),
      users: room.getUsers(),
      isRecording: room.isRecording
    })
  })

  // Leave room - IMPROVED VERSION
  socket.on("leave-room", (data) => {
    const { roomId, userId } = data
    console.log(`🚪 User ${userId} leaving room ${roomId}`)

    if (rooms.has(roomId)) {
      const room = rooms.get(roomId)
      const removed = room.removeUser(userId)

      if (removed) {
        // Notify other users
        socket.to(roomId).emit("user-left", {
          userId,
          timestamp: Date.now(),
          remainingUsers: room.getUserCount(),
        })

        // Broadcast updated room info
        io.to(roomId).emit("room-updated", {
          roomId,
          totalUsers: room.getUserCount(),
          users: room.getUsers(),
        })
      }

      // Clean up empty rooms
      if (room.getUserCount() === 0) {
        if (room.isRecording) {
          console.log(`⏹️ Stopping recording for empty room ${roomId}`)
          const recordingData = stopRoomRecording(roomId)
          if (recordingData.size > 0) {
            console.log(`💾 Final recording saved: ${recordingData.filename} (${recordingData.size} bytes)`)
          }
        }
        rooms.delete(roomId)
        // Delete room folder
        const roomFolder = getRoomFolder(roomId)
        if (fs.existsSync(roomFolder)) {
          fs.rmSync(roomFolder, { recursive: true, force: true })
          console.log(`🗑️ Room folder deleted: ${roomFolder}`)
        }
        console.log(`🗑️ Room ${roomId} deleted (empty)`)
      }
    }

    socket.leave(roomId)
    userSockets.delete(socket.id)
  })

  // Start recording
  socket.on("start-recording", (data) => {
    const { roomId } = data
    console.log(`🎙️ Start recording request for room ${roomId}`)

    if (rooms.has(roomId)) {
      const room = rooms.get(roomId)

      if (!room.isRecording) {
        room.isRecording = true
        room.recordingChunks = []
        room.recordingStartTime = new Date()

        const timestamp = room.recordingStartTime.toISOString().replace(/[:.]/g, "-")
        // Always use the room folder for the file
        const roomFolder = getRoomFolder(roomId)
        room.recordingFilePath = path.join(roomFolder, `room-${roomId}-${timestamp}.webm`)

        // Create write stream for real-time saving
        try {
          room.recordingStream = fs.createWriteStream(room.recordingFilePath)
          console.log(`📁 Recording stream created: ${room.recordingFilePath}`)
        } catch (error) {
          console.error(`❌ Error creating recording stream: ${error}`)
        }

        // Notify all users in the room
        io.to(roomId).emit("recording-started", { roomId, timestamp })

        socket.emit("recording-start-response", { success: true })
        console.log(`✅ Recording started for room ${roomId}`)
      } else {
        socket.emit("recording-start-response", { success: false, error: "Recording already in progress" })
      }
    } else {
      socket.emit("recording-start-response", { success: false, error: "Room not found" })
    }
  })

  // Stop recording
  socket.on("stop-recording", (data) => {
    const { roomId } = data
    console.log(`⏹️ Stop recording request for room ${roomId}`)

    if (rooms.has(roomId)) {
      const room = rooms.get(roomId)

      if (room.isRecording) {
        const recordingData = stopRoomRecording(roomId)

        // Notify all users in the room
        io.to(roomId).emit("recording-stopped", {
          roomId,
          recordingSize: recordingData.size,
          filename: recordingData.filename,
        })

        // Send recording data to all users in the room
        if (recordingData.base64 && recordingData.size > 0) {
          io.to(roomId).emit("recording-stop-response", {
            success: true,
            audioData: recordingData.base64,
            recordingSize: recordingData.size,
            mimeType: "audio/webm",
            filename: recordingData.filename,
          })
        } else {
          io.to(roomId).emit("recording-stop-response", {
            success: false,
            error: "No recording data available"
          })
        }

        console.log(
          `✅ Recording stopped for room ${roomId}. File: ${recordingData.filename} (${recordingData.size} bytes)`,
        )
      } else {
        io.to(roomId).emit("recording-stop-response", { success: false, error: "No recording in progress" })
      }
    } else {
      io.to(roomId).emit("recording-stop-response", { success: false, error: "Room not found" })
    }
  })

  // Receive audio chunk - Enhanced for mobile
  socket.on("audio-chunk", (data) => {
    const { roomId, audioData, chunkIndex } = data

    if (rooms.has(roomId)) {
      const room = rooms.get(roomId)
      room.updateActivity()

      if (room.isRecording && audioData) {
        try {
          // Convert base64 to buffer
          const buffer = Buffer.from(audioData, "base64")

          // Store in memory for later retrieval
          room.recordingChunks.push({
            data: buffer,
            timestamp: Date.now(),
            index: chunkIndex || room.recordingChunks.length,
          })

          // Write to file stream for real-time saving
          if (room.recordingStream && room.recordingStream.writable) {
            room.recordingStream.write(buffer)
          }

          console.log(
            `🎵 Received audio chunk for room ${roomId}: ${buffer.length} bytes (Total chunks: ${room.recordingChunks.length})`,
          )

          // Send confirmation back to client
          socket.emit("audio-chunk-received", {
            success: true,
            chunkIndex: chunkIndex || room.recordingChunks.length - 1,
            totalChunks: room.recordingChunks.length,
          })

          // Broadcast to other users for real-time audio
          socket.to(roomId).emit("audio-data", {
            userId: userSockets.get(socket.id)?.userId,
            audioData,
          })
        } catch (error) {
          console.error("❌ Error processing audio chunk:", error)
          socket.emit("audio-chunk-received", {
            success: false,
            error: error.message,
          })
        }
      } else {
        if (!room.isRecording) {
          console.log(`⚠️ Audio chunk received but recording not active for room ${roomId}`)
          socket.emit("audio-chunk-received", {
            success: false,
            error: "Recording not active",
          })
        }
      }
    }
  })

  // Get current recording
  socket.on("get-recording", (data) => {
    const { roomId } = data
    console.log(`📥 Get recording request for room ${roomId}`)

    if (rooms.has(roomId)) {
      const room = rooms.get(roomId)

      if (room.recordingChunks.length > 0) {
        // Sort chunks by index to ensure proper order
        const sortedChunks = room.recordingChunks.sort((a, b) => (a.index || 0) - (b.index || 0))
        const combinedBuffer = Buffer.concat(sortedChunks.map((chunk) => chunk.data))
        const base64Audio = combinedBuffer.toString("base64")

        // Send to all users in the room
        io.to(roomId).emit("get-recording-response", {
          success: true,
          audioData: base64Audio,
          recordingSize: combinedBuffer.length,
          mimeType: "audio/webm",
          totalChunks: room.recordingChunks.length,
        })
        console.log(`📤 Sent current recording for room ${roomId} (${combinedBuffer.length} bytes)`)
      } else {
        // Send to all users in the room
        io.to(roomId).emit("get-recording-response", {
          success: true,
          audioData: null,
          recordingSize: 0,
          mimeType: "audio/webm",
          totalChunks: 0,
        })
        console.log(`⚠️ No recording data available for room ${roomId}`)
      }
    } else {
      io.to(roomId).emit("get-recording-response", { success: false, error: "Room not found" })
    }
  })

  // WebRTC signaling - IMPROVED LOGGING
  socket.on("webrtc-offer", (data) => {
    const { roomId, targetUserId, offer } = data
    const fromUserId = userSockets.get(socket.id)?.userId
    console.log(`🤝 WebRTC offer from ${fromUserId} to ${targetUserId} in room ${roomId}`)

    // Find target user's socket
    const targetUser = Array.from(rooms.get(roomId)?.users.values() || []).find(
      (user) => user.userId === targetUserId
    )

    if (targetUser) {
      // Send to specific target user
      io.to(targetUser.socketId).emit("webrtc-offer", {
        fromUserId,
        targetUserId,
        offer,
      })
    } else {
      console.log(`⚠️ Target user ${targetUserId} not found in room ${roomId}`)
      socket.emit("webrtc-error", {
        error: "Target user not found",
        targetUserId,
      })
    }
  })

  socket.on("webrtc-answer", (data) => {
    const { roomId, targetUserId, answer } = data
    const fromUserId = userSockets.get(socket.id)?.userId
    console.log(`🤝 WebRTC answer from ${fromUserId} to ${targetUserId} in room ${roomId}`)

    // Find target user's socket
    const targetUser = Array.from(rooms.get(roomId)?.users.values() || []).find(
      (user) => user.userId === targetUserId
    )

    if (targetUser) {
      // Send to specific target user
      io.to(targetUser.socketId).emit("webrtc-answer", {
        fromUserId,
        targetUserId,
        answer,
      })
    } else {
      console.log(`⚠️ Target user ${targetUserId} not found in room ${roomId}`)
      socket.emit("webrtc-error", {
        error: "Target user not found",
        targetUserId,
      })
    }
  })

  socket.on("webrtc-ice-candidate", (data) => {
    const { roomId, targetUserId, candidate } = data
    const fromUserId = userSockets.get(socket.id)?.userId

    // Validate candidate data
    if (!candidate || !candidate.candidate) {
      console.log(`⚠️ Invalid ICE candidate from ${fromUserId} to ${targetUserId}`)
      return
    }

    // Find target user's socket
    const targetUser = Array.from(rooms.get(roomId)?.users.values() || []).find(
      (user) => user.userId === targetUserId
    )

    if (targetUser) {
      // Add timestamp to track candidate freshness
      const candidateWithTimestamp = {
        ...candidate,
        timestamp: Date.now()
      }

      // Send to specific target user
      io.to(targetUser.socketId).emit("webrtc-ice-candidate", {
        fromUserId,
        targetUserId,
        candidate: candidateWithTimestamp
      })

      // Log only unique candidates
      console.log(`🧊 ICE candidate from ${fromUserId} to ${targetUserId} in room ${roomId} (type: ${candidate.candidate.split(' ')[0]})`)
    } else {
      console.log(`⚠️ Target user ${targetUserId} not found in room ${roomId}`)
      socket.emit("webrtc-error", {
        error: "Target user not found",
        targetUserId,
      })
    }
  })

  // Add new event for WebRTC connection state
  socket.on("webrtc-connection-state", (data) => {
    const { roomId, targetUserId, state } = data
    const fromUserId = userSockets.get(socket.id)?.userId
    console.log(`🔄 WebRTC connection state from ${fromUserId} to ${targetUserId}: ${state}`)

    // Find target user's socket
    const targetUser = Array.from(rooms.get(roomId)?.users.values() || []).find(
      (user) => user.userId === targetUserId
    )

    if (targetUser) {
      // Send to specific target user
      io.to(targetUser.socketId).emit("webrtc-connection-state", {
        fromUserId,
        targetUserId,
        state,
        timestamp: Date.now()
      })
    }
  })

  // Add new event for WebRTC connection cleanup
  socket.on("webrtc-cleanup", (data) => {
    const { roomId, targetUserId } = data
    const fromUserId = userSockets.get(socket.id)?.userId
    console.log(`🧹 WebRTC cleanup from ${fromUserId} to ${targetUserId} in room ${roomId}`)

    // Find target user's socket
    const targetUser = Array.from(rooms.get(roomId)?.users.values() || []).find(
      (user) => user.userId === targetUserId
    )

    if (targetUser) {
      // Send to specific target user
      io.to(targetUser.socketId).emit("webrtc-cleanup", {
        fromUserId,
        targetUserId,
        timestamp: Date.now()
      })
    }
  })

  // Handle disconnect - IMPROVED VERSION
  socket.on("disconnect", (reason) => {
    console.log(`❌ User disconnected: ${socket.id}, reason: ${reason}`)

    const userInfo = userSockets.get(socket.id)

    if (userInfo) {
      const { userId, roomId } = userInfo

      if (rooms.has(roomId)) {
        const room = rooms.get(roomId)
        const removed = room.removeUser(userId)

        if (removed) {
          // Notify other users about the disconnect
          socket.to(roomId).emit("user-left", {
            userId,
            reason: "disconnect",
            timestamp: Date.now(),
          })

          // Notify all users in the room about the WebRTC connection cleanup
          io.to(roomId).emit("webrtc-connection-state", {
            fromUserId: userId,
            state: "closed",
            reason: "user_disconnected"
          })

          // Broadcast updated room info
          io.to(roomId).emit("room-updated", {
            roomId,
            totalUsers: room.getUserCount(),
            users: room.getUsers(),
          })
        }

        // Clean up empty rooms
        if (room.getUserCount() === 0) {
          if (room.isRecording) {
            console.log(`⏹️ Stopping recording for empty room ${roomId} after disconnect`)
            const recordingData = stopRoomRecording(roomId)
            if (recordingData.size > 0) {
              console.log(`💾 Final recording saved: ${recordingData.filename} (${recordingData.size} bytes)`)
            }
          }
          rooms.delete(roomId)
          // Delete room folder
          const roomFolder = getRoomFolder(roomId)
          if (fs.existsSync(roomFolder)) {
            fs.rmSync(roomFolder, { recursive: true, force: true })
            console.log(`🗑️ Room folder deleted: ${roomFolder}`)
          }
          console.log(`🗑️ Room ${roomId} deleted (empty after disconnect)`)
        }
      }

      userSockets.delete(socket.id)
    }
  })

  // Debug endpoint to get room info
  socket.on("get-room-info", (data) => {
    const { roomId } = data
    if (rooms.has(roomId)) {
      const room = rooms.get(roomId)
      socket.emit("room-info-response", {
        roomId,
        users: room.getUsers(),
        totalUsers: room.getUserCount(),
        isRecording: room.isRecording,
      })
    } else {
      socket.emit("room-info-response", { error: "Room not found" })
    }
  })
})

// Helper function to stop room recording
function stopRoomRecording(roomId) {
  const room = rooms.get(roomId)

  if (room && room.isRecording) {
    room.isRecording = false

    // Close the write stream
    if (room.recordingStream) {
      room.recordingStream.end()
      room.recordingStream = null
    }

    console.log(`⏹️ Stopping recording for room ${roomId}. Total chunks: ${room.recordingChunks.length}`)

    if (room.recordingChunks.length > 0) {
      // Sort chunks by index and combine
      const sortedChunks = room.recordingChunks.sort((a, b) => (a.index || 0) - (b.index || 0))
      const combinedBuffer = Buffer.concat(sortedChunks.map((chunk) => chunk.data))

      // Save to file in room folder
      const roomFolder = getRoomFolder(roomId)
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      room.recordingFilePath = path.join(roomFolder, `room-${roomId}-${timestamp}.webm`)
      try {
        fs.writeFileSync(room.recordingFilePath, combinedBuffer)
        console.log(`💾 Recording saved: ${room.recordingFilePath} (${combinedBuffer.length} bytes)`)
      } catch (error) {
        console.error(`❌ Error saving recording file: ${error}`)
      }

      // Convert to base64 for client download
      const base64Audio = combinedBuffer.toString("base64")
      const filename = path.basename(room.recordingFilePath)

      // Clear chunks after combining and saving
      room.recordingChunks = [];

      return {
        base64: base64Audio,
        size: combinedBuffer.length,
        filename: filename,
        filePath: room.recordingFilePath, // Return the webm path
      }
    } else {
      console.log(`⚠️ No audio chunks to save for room ${roomId}`)
    }
  }

  return {
    base64: null,
    size: 0,
    filename: null,
    filePath: null,
  }
}

// REST API endpoints
app.get("/api/rooms", (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    userCount: room.getUserCount(),
    users: room.getUsers(),
    isRecording: room.isRecording,
    recordingChunks: room.recordingChunks.length,
    lastActivity: room.lastActivity,
  }))

  res.json({ rooms: roomList })
})

app.get("/api/recordings", (req, res) => {
  try {
    let files = []
    if (fs.existsSync(recordingsDir)) {
      const roomFolders = fs.readdirSync(recordingsDir).filter(f => fs.statSync(path.join(recordingsDir, f)).isDirectory())
      for (const folder of roomFolders) {
        const folderPath = path.join(recordingsDir, folder)
        const recs = fs.readdirSync(folderPath)
          .filter((file) => file.endsWith(".webm") || file.endsWith(".mp4"))
          .map((file) => {
            const filePath = path.join(folderPath, file)
            const stats = fs.statSync(filePath)
            return {
              filename: file,
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime,
              room: folder
            }
          })
        files = files.concat(recs)
      }
    }
    files = files.sort((a, b) => b.created - a.created)
    res.json({ recordings: files })
  } catch (error) {
    console.error("❌ Error listing recordings:", error)
    res.status(500).json({ error: "Failed to list recordings" })
  }
})

app.get("/api/recordings/:filename", async (req, res) => {
  const filename = req.params.filename
  const format = req.query.format || 'webm' // Default to webm if no format specified
  let filePath = null
  let mp4FilePath = null

  if (fs.existsSync(recordingsDir)) {
    const roomFolders = fs.readdirSync(recordingsDir).filter(f => fs.statSync(path.join(recordingsDir, f)).isDirectory())
    for (const folder of roomFolders) {
      const candidate = path.join(recordingsDir, folder, filename)
      if (fs.existsSync(candidate)) {
        filePath = candidate
        break
      }
    }
  }

  if (filePath) {
    if (format === 'mp4') {
      // Convert to MP4 if requested
      mp4FilePath = filePath.replace(/\.webm$/, '.mp4')

      // Check if MP4 already exists
      if (!fs.existsSync(mp4FilePath)) {
        try {
          const { execSync } = require('child_process')
          execSync(`ffmpeg -y -i "${filePath}" -c:a aac -b:a 192k "${mp4FilePath}"`)
          console.log(`🎬 Converted recording to MP4: ${mp4FilePath}`)
        } catch (err) {
          console.error('❌ Error converting to MP4:', err)
          return res.status(500).json({ error: "Failed to convert recording to MP4" })
        }
      }
      res.download(mp4FilePath)
    } else {
      // Send original webm file
      res.download(filePath)
    }
  } else {
    res.status(404).json({ error: "Recording not found" })
  }
})

app.delete("/api/recordings/:filename", (req, res) => {
  const filename = req.params.filename
  const filePath = path.join(recordingsDir, filename)

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      res.json({ success: true, message: "Recording deleted" })
    } else {
      res.status(404).json({ error: "Recording not found" })
    }
  } catch (error) {
    console.error("❌ Error deleting recording:", error)
    res.status(500).json({ error: "Failed to delete recording" })
  }
})

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activeRooms: rooms.size,
    totalConnections: userSockets.size,
    recordingsDirectory: recordingsDir,
    protocol: useHTTPS ? "https" : "http",
    rooms: Array.from(rooms.entries()).map(([id, room]) => ({
      id,
      users: room.getUserCount(),
      recording: room.isRecording,
    })),
  })
})

// Test endpoint
app.get("/test", (req, res) => {
  res.json({
    message: "Server is running!",
    timestamp: new Date().toISOString(),
    port: process.env.PORT || 3001,
    protocol: useHTTPS ? "https" : "http",
    userAgent: req.headers["user-agent"],
    ip: req.ip || req.connection.remoteAddress,
  })
})

const PORT = process.env.PORT || 3001

server.listen(PORT, "0.0.0.0", () => {
  const protocol = useHTTPS ? "https" : "http"
  console.log(`🚀 Voice chat server running on ${protocol}://localhost:${PORT}`)
  console.log(`📁 Recordings will be saved to: ${recordingsDir}`)
  console.log(`🏥 Health check available at: ${protocol}://localhost:${PORT}/health`)
  console.log(`🧪 Test endpoint available at: ${protocol}://localhost:${PORT}/test`)
  console.log(`📊 API endpoints available at: ${protocol}://localhost:${PORT}/api/rooms`)

  if (useHTTPS) {
    console.log(`🔒 HTTPS enabled with self-signed certificate`)
    console.log(`📱 Mobile devices can connect (may need to accept certificate)`)
  } else {
    console.log(`🔓 HTTP mode - for HTTPS, set USE_HTTPS=true`)
  }
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully")
  server.close(() => {
    console.log("Server closed")
    process.exit(0)
  })
})

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully")
  server.close(() => {
    console.log("Server closed")
    process.exit(0)
  })
})
