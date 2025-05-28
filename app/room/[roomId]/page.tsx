"use client"

import type React from "react"

import { useEffect, useState, useRef, useCallback } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Mic,
  MicOff,
  Users,
  Square,
  Circle,
  Play,
  Pause,
  AlertCircle,
  Smartphone,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  RefreshCw,
} from "lucide-react"
import { io, type Socket } from "socket.io-client"

interface User {
  userId: string
  socketId: string
  joinedAt?: number
}

interface PeerConnectionState {
  status: "disconnected" | "connecting" | "connected" | "failed"
  lastAttempt: number
}

interface UserAvatarProps {
  userId: string
  isCurrentUser?: boolean
  isSpeaking?: boolean
  micLevel?: number
  children: React.ReactNode
}

// Water ripple effect component for user avatars
const UserAvatar: React.FC<UserAvatarProps> = ({
  userId,
  isCurrentUser = false,
  isSpeaking = false,
  micLevel = 0,
  children,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationFrameRef = useRef<number | null>(null)
  const ripplesRef = useRef<Array<{ id: number; progress: number; intensity: number; timestamp: number }>>([])
  const rippleIdRef = useRef(0)

  // Create ripple effect
  const createRipple = useCallback((intensity: number) => {
    const newRipple = {
      id: rippleIdRef.current++,
      progress: 0,
      intensity: Math.min(intensity, 1),
      timestamp: Date.now(),
    }
    ripplesRef.current.push(newRipple)
  }, [])

  // Animate ripples
  useEffect(() => {
    const animate = () => {
      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext("2d")
      if (!ctx) return

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const centerX = canvas.width / 2
      const centerY = canvas.height / 2
      const maxRadius = Math.min(canvas.width, canvas.height) / 2

      // Update and draw ripples
      ripplesRef.current = ripplesRef.current.filter((ripple) => {
        ripple.progress += 0.02 // Animation speed

        if (ripple.progress >= 1) {
          return false // Remove completed ripples
        }

        // Draw ripple
        const radius = ripple.progress * maxRadius
        const opacity = (1 - ripple.progress) * ripple.intensity * 0.8

        if (opacity > 0) {
          // Outer ripple
          ctx.beginPath()
          ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
          ctx.strokeStyle = `rgba(59, 130, 246, ${opacity})`
          ctx.lineWidth = 2
          ctx.stroke()

          // Inner ripple
          ctx.beginPath()
          ctx.arc(centerX, centerY, radius * 0.7, 0, 2 * Math.PI)
          ctx.strokeStyle = `rgba(147, 197, 253, ${opacity * 0.6})`
          ctx.lineWidth = 1
          ctx.stroke()

          // Center glow
          if (ripple.progress < 0.3) {
            const glowRadius = ripple.progress * maxRadius * 0.3
            const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius)
            gradient.addColorStop(0, `rgba(59, 130, 246, ${opacity * 0.3})`)
            gradient.addColorStop(1, `rgba(59, 130, 246, 0)`)
            ctx.fillStyle = gradient
            ctx.beginPath()
            ctx.arc(centerX, centerY, glowRadius, 0, 2 * Math.PI)
            ctx.fill()
          }
        }

        return true
      })

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  // Create ripples when speaking
  useEffect(() => {
    if (isSpeaking && micLevel > 15) {
      const intensity = Math.min(micLevel / 50, 1)
      createRipple(intensity)
    }
  }, [isSpeaking, micLevel, createRipple])

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) {
      const size = 80 // Avatar size + padding
      canvas.width = size
      canvas.height = size
    }
  }, [])

  return (
    <div className="relative inline-block">
      {/* Canvas for water ripples */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          width: "80px",
          height: "80px",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
        }}
      />

      {/* User avatar */}
      <div
        className={`relative z-20 w-16 h-16 rounded-full mx-auto flex items-center justify-center text-white font-bold transition-all duration-300 ${
          isCurrentUser
            ? isSpeaking
              ? "bg-blue-600 shadow-lg shadow-blue-500/50 scale-110"
              : "bg-blue-500"
            : "bg-green-500"
        }`}
      >
        {children}

        {/* Pulsing ring when speaking */}
        {isSpeaking && (
          <div className="absolute inset-0 rounded-full border-2 border-blue-400 animate-ping opacity-75"></div>
        )}
      </div>
    </div>
  )
}

export default function VoiceRoom() {
  const params = useParams()
  const roomId = params.roomId as string
  const [users, setUsers] = useState<User[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [lastRecordingUrl, setLastRecordingUrl] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<string>("Connecting...")
  const [recordingDuration, setRecordingDuration] = useState<number>(0)
  const [audioChunksSent, setAudioChunksSent] = useState<number>(0)
  const [audioChunksConfirmed, setAudioChunksConfirmed] = useState<number>(0)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [microphoneLevel, setMicrophoneLevel] = useState<number>(0)
  const [isMobile, setIsMobile] = useState(false)
  const [peerStates, setPeerStates] = useState<Map<string, PeerConnectionState>>(new Map())
  const [totalUsers, setTotalUsers] = useState<number>(0)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [userSpeakingStates, setUserSpeakingStates] = useState<Map<string, { isSpeaking: boolean; level: number }>>(
    new Map(),
  )
  const [userId] = useState(() => {
    // Generate a stable ID that works for both SSR and client
    return `user_${Math.random().toString(36).substr(2, 9)}_${Date.now().toString(36)}`
  })

  // Add this effect to handle client-side ID persistence
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedId = localStorage.getItem("voice-chat-user-id")
      if (!storedId) {
        localStorage.setItem("voice-chat-user-id", userId)
      }
    }
  }, [userId])

  const socketRef = useRef<Socket | null>(null)
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map())
  const mediaRecorder = useRef<MediaRecorder | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recordingTimer = useRef<NodeJS.Timeout | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const micLevelTimer = useRef<NodeJS.Timeout | null>(null)
  const chunkIndex = useRef<number>(0)
  const remoteAudios = useRef<Map<string, HTMLAudioElement>>(new Map())
  // const remoteAnalysers = useRef<Map<string, { analyser: AnalyserNode; dataArray: Uint8Array }>>()
  const remoteAnalysers = useRef<Map<string, { analyser: AnalyserNode; dataArray: Uint8Array }>>(new Map())


  // Detect mobile device
  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera
      const mobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase())
      setIsMobile(mobile)
    }

    checkMobile()
  }, [])

  // Update peer connection state
  const updatePeerState = useCallback((userId: string, status: PeerConnectionState["status"]) => {
    setPeerStates((prev) => {
      const newMap = new Map(prev)
      newMap.set(userId, { status, lastAttempt: Date.now() })
      return newMap
    })
  }, [])

  // Monitor remote audio levels
  const setupRemoteAudioMonitoring = useCallback((userId: string, stream: MediaStream) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const analyser = audioContext.createAnalyser()
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)

      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      const bufferLength = analyser.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      if (!remoteAnalysers.current) {
        remoteAnalysers.current = new Map()
      }
      remoteAnalysers.current.set(userId, { analyser, dataArray })

      const monitorLevel = () => {
        if (analyser && audioContext.state === "running") {
          analyser.getByteTimeDomainData(dataArray)

          // Calculate RMS
          let sum = 0
          for (let i = 0; i < bufferLength; i++) {
            const sample = (dataArray[i] - 128) / 128
            sum += sample * sample
          }
          const rms = Math.sqrt(sum / bufferLength)
          const level = Math.round(rms * 100 * 3)
          const normalizedLevel = Math.min(level, 100)

          const isUserSpeaking = normalizedLevel > 15

          setUserSpeakingStates((prev) => {
            const newMap = new Map(prev)
            newMap.set(userId, { isSpeaking: isUserSpeaking, level: normalizedLevel })
            return newMap
          })

          // console.log(`🎵 Remote user ${userId} level: ${normalizedLevel}% | Speaking: ${isUserSpeaking}`)
        }

        setTimeout(monitorLevel, 100)
      }

      if (audioContext.state === "suspended") {
        audioContext.resume().then(() => monitorLevel())
      } else {
        monitorLevel()
      }
    } catch (error) {
      console.error(`❌ Error setting up remote audio monitoring for ${userId}:`, error)
    }
  }, [])

  // Move createPeerConnection function definition before initiateWebRTCConnection
  const createPeerConnection = useCallback(
    (targetUserId: string) => {
      console.log(`🔧 Creating peer connection for: ${targetUserId}`)

      // Close existing connection if any
      if (peerConnections.current.has(targetUserId)) {
        console.log(`🔄 Closing existing connection for: ${targetUserId}`)
        const existingPc = peerConnections.current.get(targetUserId)
        if (existingPc && existingPc.connectionState !== "closed") {
          existingPc.close()
        }
        peerConnections.current.delete(targetUserId)
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun3.l.google.com:19302" },
          { urls: "stun:stun4.l.google.com:19302" },
        ],
        iceCandidatePoolSize: 10,
      })

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          console.log("🧊 Sending ICE candidate to:", targetUserId)
          socketRef.current.emit("webrtc-ice-candidate", {
            roomId,
            targetUserId,
            candidate: event.candidate,
          })
        } else if (!event.candidate) {
          console.log("🧊 ICE gathering complete for:", targetUserId)
        }
      }

      pc.ontrack = (event) => {
        console.log("🎵 Received remote stream from:", targetUserId)
        const [remoteStream] = event.streams

        // Create or update audio element for remote stream
        let audio = remoteAudios.current.get(targetUserId)
        if (!audio) {
          audio = new Audio()
          audio.autoplay = true
          audio.volume = 1.0
          audio.style.display = "none"
          document.body.appendChild(audio)
          remoteAudios.current.set(targetUserId, audio)
          console.log("🔊 Created audio element for:", targetUserId)
        }

        audio.srcObject = remoteStream
        audio
          .play()
          .then(() => {
            console.log("▶️ Playing remote audio from:", targetUserId)
            // Set up audio level monitoring for this user
            setupRemoteAudioMonitoring(targetUserId, remoteStream)
          })
          .catch((error) => {
            console.error("❌ Error playing remote audio:", error)
          })

        updatePeerState(targetUserId, "connected")
      }

      pc.onconnectionstatechange = () => {
        console.log(`🔗 WebRTC connection state with ${targetUserId}:`, pc.connectionState)

        switch (pc.connectionState) {
          case "connected":
            updatePeerState(targetUserId, "connected")
            console.log(`✅ WebRTC connected to: ${targetUserId}`)
            break
          case "connecting":
            updatePeerState(targetUserId, "connecting")
            break
          case "failed":
            console.log(`❌ WebRTC failed for: ${targetUserId}`)
            updatePeerState(targetUserId, "failed")
            // Clean up failed connection
            setTimeout(() => {
              if (peerConnections.current.has(targetUserId)) {
                peerConnections.current.get(targetUserId)?.close()
                peerConnections.current.delete(targetUserId)
              }
            }, 1000)
            break
          case "disconnected":
            console.log(`🔌 WebRTC disconnected from: ${targetUserId}`)
            updatePeerState(targetUserId, "disconnected")
            break
          case "closed":
            console.log(`🚪 WebRTC closed for: ${targetUserId}`)
            peerConnections.current.delete(targetUserId)
            updatePeerState(targetUserId, "disconnected")
            break
        }
      }

      pc.oniceconnectionstatechange = () => {
        console.log(`🧊 ICE connection state with ${targetUserId}:`, pc.iceConnectionState)
        if (pc.iceConnectionState === "failed") {
          console.log(`🔄 ICE failed for ${targetUserId}, will retry`)
          updatePeerState(targetUserId, "failed")
        }
      }

      // Add local stream tracks
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          console.log(`➕ Adding ${track.kind} track to peer connection for:`, targetUserId)
          pc.addTrack(track, localStream)
        })
      } else {
        console.warn(`⚠️ No local stream available when creating connection to: ${targetUserId}`)
      }

      peerConnections.current.set(targetUserId, pc)
      console.log(`💾 Stored peer connection for: ${targetUserId}`)
      return pc
    },
    [localStream, roomId, updatePeerState, setupRemoteAudioMonitoring],
  )

  // Move initiateWebRTCConnection function definition before the useEffect that uses it
  const initiateWebRTCConnection = useCallback(
    async (targetUserId: string) => {
      try {
        console.log("🤝 Initiating WebRTC connection to:", targetUserId)
        updatePeerState(targetUserId, "connecting")

        const pc = createPeerConnection(targetUserId)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        if (socketRef.current) {
          socketRef.current.emit("webrtc-offer", {
            roomId,
            targetUserId,
            offer,
          })
        }
      } catch (error) {
        console.error("❌ Error creating WebRTC offer:", error)
        updatePeerState(targetUserId, "failed")
      }
    },
    [roomId, updatePeerState, createPeerConnection],
  )

  const handleWebRTCOffer = useCallback(
    async (fromUserId: string, offer: RTCSessionDescriptionInit) => {
      try {
        console.log("📥 Handling WebRTC offer from:", fromUserId)
        const pc = createPeerConnection(fromUserId)
        await pc.setRemoteDescription(offer)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        if (socketRef.current) {
          console.log("📤 Sending WebRTC answer to:", fromUserId)
          socketRef.current.emit("webrtc-answer", {
            roomId,
            targetUserId: fromUserId,
            answer,
          })
        }
      } catch (error) {
        console.error("❌ Error handling WebRTC offer:", error)
        updatePeerState(fromUserId, "failed")
      }
    },
    [createPeerConnection, roomId, updatePeerState],
  )

  const handleWebRTCAnswer = useCallback(
    async (fromUserId: string, answer: RTCSessionDescriptionInit) => {
      const pc = peerConnections.current.get(fromUserId)
      if (pc) {
        try {
          console.log("📥 Handling WebRTC answer from:", fromUserId)
          console.log("🔍 Current signaling state:", pc.signalingState)

          // Only set remote description if we're in the right state
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(answer)
            console.log("✅ WebRTC answer processed for:", fromUserId)
          } else {
            console.warn(`⚠️ Cannot set remote description, wrong state: ${pc.signalingState} for ${fromUserId}`)
            // Reset the connection if in wrong state
            updatePeerState(fromUserId, "failed")
          }
        } catch (error) {
          console.error("❌ Error handling WebRTC answer:", error)
          updatePeerState(fromUserId, "failed")
        }
      } else {
        console.warn("⚠️ No peer connection found for:", fromUserId)
      }
    },
    [updatePeerState],
  )

  const handleICECandidate = useCallback(async (fromUserId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnections.current.get(fromUserId)
    if (pc) {
      try {
        await pc.addIceCandidate(candidate)
        console.log("✅ ICE candidate added for:", fromUserId)
      } catch (error) {
        console.error("❌ Error handling ICE candidate:", error)
      }
    } else {
      console.warn("⚠️ No peer connection found for ICE candidate from:", fromUserId)
    }
  }, [])

  const cleanupPeerConnection = useCallback((userId: string) => {
    console.log(`🧹 Cleaning up peer connection for: ${userId}`)

    // Close peer connection
    if (peerConnections.current.has(userId)) {
      const pc = peerConnections.current.get(userId)
      if (pc && pc.connectionState !== "closed") {
        pc.close()
      }
      peerConnections.current.delete(userId)
    }

    // Clean up remote audio
    if (remoteAudios.current.has(userId)) {
      const audio = remoteAudios.current.get(userId)
      if (audio && document.body.contains(audio)) {
        document.body.removeChild(audio)
      }
      remoteAudios.current.delete(userId)
    }

    // Clean up remote audio monitoring
    if (remoteAnalysers.current?.has(userId)) {
      remoteAnalysers.current.delete(userId)
    }

    // Remove user speaking state
    setUserSpeakingStates((prev) => {
      const newMap = new Map(prev)
      newMap.delete(userId)
      return newMap
    })

    // Remove peer state
    setPeerStates((prev) => {
      const newMap = new Map(prev)
      newMap.delete(userId)
      return newMap
    })
  }, [])

  // Initialize Socket.io connection with mobile-optimized settings
  useEffect(() => {
    // const serverUrl = "https://68f8-2405-201-a42a-3010-edab-e53c-f945-204b.ngrok-free.app"
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"
    console.log("🔌 Connecting to server:", serverUrl, "Mobile:", isMobile)

    socketRef.current = io(serverUrl, {
      transports: ["polling", "websocket"],
      timeout: 30000,
      forceNew: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
    })

    const socket = socketRef.current

    // Connection events
    socket.on("connect", () => {
      console.log("✅ Connected to server with ID:", socket.id)
      setIsConnected(true)
      setConnectionStatus("Connected")
      setConnectionError(null)

      // Join the room
      socket.emit("join-room", { roomId, userId })
    })

    socket.on("disconnect", (reason) => {
      console.log("❌ Disconnected from server:", reason)
      setIsConnected(false)
      setConnectionStatus("Disconnected")
      setConnectionError(`Disconnected: ${reason}`)

      // Reset all peer connections
      setPeerStates(new Map())
    })

    socket.on("connect_error", (error) => {
      console.error("❌ Connection error:", error)
      setConnectionStatus("Connection Error")
      setConnectionError(error.message || "Failed to connect to server")
    })

    socket.on("reconnect", (attemptNumber) => {
      console.log("🔄 Reconnected after", attemptNumber, "attempts")
      setIsConnected(true)
      setConnectionStatus("Reconnected")
      setConnectionError(null)

      // Rejoin room after reconnection
      socket.emit("join-room", { roomId, userId })
    })

    socket.on("reconnect_error", (error) => {
      console.error("❌ Reconnection error:", error)
      setConnectionError("Reconnection failed")
    })

    // Room events - ENHANCED
    socket.on("room-joined", (data) => {
      console.log("🚪 Successfully joined room:", data)
      setUsers(data.users || [])
      setTotalUsers(data.totalUsers || 1)
      setIsRecording(data.isRecording || false)

      // Initialize peer states for existing users
      data.users?.forEach((user: User) => {
        updatePeerState(user.userId, "disconnected")
      })

      console.log(`📋 Room state: ${data.users?.length || 0} other users, total: ${data.totalUsers}`)
    })

    socket.on("user-joined", (data) => {
      console.log("👤 User joined room:", data)
      setUsers((prev) => {
        const exists = prev.find((user) => user.userId === data.userId)
        if (!exists) {
          updatePeerState(data.userId, "disconnected")
          console.log(`➕ Adding user ${data.userId} to UI`)
          return [...prev, { userId: data.userId, socketId: data.socketId || "", joinedAt: data.timestamp }]
        }
        console.log(`⚠️ User ${data.userId} already exists in UI`)
        return prev
      })
    })

    socket.on("user-left", (data) => {
      console.log("👋 User left room:", data)
      setUsers((prev) => {
        const filtered = prev.filter((user) => user.userId !== data.userId)
        console.log(`➖ Removed user ${data.userId} from UI`)
        return filtered
      })

      // Use the cleanup function
      cleanupPeerConnection(data.userId)
    })

    // Room updated event
    socket.on("room-updated", (data) => {
      console.log("🔄 Room updated:", data)
      setTotalUsers(data.totalUsers)

      // Update users list if needed
      const currentUserIds = users.map((u) => u.userId).sort()
      const newUserIds = data.users
        .filter((u: User) => u.userId !== userId)
        .map((u: User) => u.userId)
        .sort()

      if (JSON.stringify(currentUserIds) !== JSON.stringify(newUserIds)) {
        console.log("📝 Updating users list from room-updated event")
        setUsers(data.users.filter((u: User) => u.userId !== userId))
      }
    })

    // Recording events
    socket.on("recording-start-response", (data) => {
      console.log("🎙️ Recording start response:", data)
      if (data.success) {
        setIsRecording(true)
        startRecordingTimer()
        setAudioChunksSent(0)
        setAudioChunksConfirmed(0)
        chunkIndex.current = 0
        alert(`✅ Started recording session: ${data.sessionId}\n${data.message}`)
      } else {
        alert(`Failed to start recording: ${data.error}`)
      }
    })

    socket.on("recording-stop-response", (data) => {
      console.log("⏹️ Recording stop response:", data)
      if (data.success) {
        setIsRecording(false)
        stopRecordingTimer()

        if (data.userRecordings && data.userRecordings.length > 0) {
          // Find current user's recording
          const myRecording = data.userRecordings.find((r: { userId: string }) => r.userId === userId)

          if (myRecording && myRecording.base64) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
            downloadAudioFile(myRecording.base64, myRecording.filename, "audio/webm")

            // Create playable URL
            const playableUrl = createPlayableAudioUrl(myRecording.base64, "audio/webm")
            if (playableUrl) {
              setLastRecordingUrl(playableUrl)
            }
          }

          // Show summary of all recordings
          const recordingSummary = data.userRecordings
            .map((r: { userId: any; filename: any; size: any; chunks: any }) => `• ${r.userId}: ${r.filename} (${r.size} bytes, ${r.chunks} chunks)`)
            .join("\n")

          alert(
            `✅ Recording session completed!\n\nSession: ${data.session.sessionId}\nTotal files: ${data.session.totalFiles}\nTotal size: ${data.session.totalSize} bytes\n\nUser recordings:\n${recordingSummary}`,
          )
        } else {
          alert("⚠️ Recording session completed but no audio data was captured")
        }
      } else {
        alert(`❌ Failed to stop recording: ${data.error}`)
      }
    })

    socket.on("recording-started", (data) => {
      console.log("🎙️ Recording started notification:", data)
      setIsRecording(true)
      startRecordingTimer()
      // Show notification that recording started for all users
      console.log(`📢 Recording session ${data.sessionId} started for all users in room`)
    })

    socket.on("recording-stopped", (data) => {
      console.log("⏹️ Recording stopped notification:", data)
      setIsRecording(false)
      stopRecordingTimer()

      // Show notification about the completed session
      console.log(`📢 Recording session completed: ${data.totalFiles} files created, ${data.totalSize} total bytes`)
    })

    socket.on("audio-chunk-received", (data) => {
      if (data.success) {
        setAudioChunksConfirmed((prev) => prev + 1)
        console.log(`✅ Audio chunk confirmed for user ${data.userId}: ${data.chunkIndex}, Total: ${data.totalChunks}`)
      } else {
        console.error("❌ Audio chunk failed:", data.error)
      }
    })

    socket.on("get-recording-response", (data) => {
      console.log("📥 Get recording response:", data)
      if (data.success && data.audioData && data.size > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
        const filename = `voice-chat-${roomId}-user-${data.userId}-${timestamp}.webm`
        downloadAudioFile(data.audioData, filename, data.mimeType)

        // Create playable URL
        const playableUrl = createPlayableAudioUrl(data.audioData, data.mimeType)
        if (playableUrl) {
          setLastRecordingUrl(playableUrl)
        }

        alert(`✅ Downloaded recording for user ${data.userId}: ${filename} (${data.chunks} chunks)`)
      } else {
        alert(`⚠️ No recording data available for user ${data.userId || "current user"}`)
      }
    })

    // Add new event handler for recording status
    socket.on("recording-status-response", (data) => {
      console.log("📊 Recording status:", data)
      if (data.success) {
        console.log(`Recording active: ${data.isRecording}`)
        console.log(`Active recordings: ${data.activeRecordings.join(", ")}`)
        console.log(`User stats:`, data.userRecordingStats)
      }
    })

    // WebRTC signaling events - ENHANCED
    socket.on("webrtc-offer", async (data) => {
      console.log("🤝 Received WebRTC offer from:", data.fromUserId, "to:", data.targetUserId)
      if (data.targetUserId === userId || !data.targetUserId) {
        updatePeerState(data.fromUserId, "connecting")
        await handleWebRTCOffer(data.fromUserId, data.offer)
      }
    })

    socket.on("webrtc-answer", async (data) => {
      console.log("🤝 Received WebRTC answer from:", data.fromUserId, "to:", data.targetUserId)
      if (data.targetUserId === userId || !data.targetUserId) {
        await handleWebRTCAnswer(data.fromUserId, data.answer)
      }
    })

    socket.on("webrtc-ice-candidate", async (data) => {
      console.log("🧊 Received ICE candidate from:", data.fromUserId, "to:", data.targetUserId)
      if (data.targetUserId === userId || !data.targetUserId) {
        await handleICECandidate(data.fromUserId, data.candidate)
      }
    })

    // Audio data events
    socket.on("audio-data", (data) => {
      console.log("🎵 Received audio data from:", data.userId)
    })

    // Error handling
    socket.on("room-join-error", (data) => {
      console.error("❌ Room join error:", data)
      setConnectionError(`Failed to join room: ${data.error}`)
    })

    // Debug events
    socket.on("room-info-response", (data) => {
      console.log("🔍 Room info:", data)
    })

    // Handle page unload
    const handleBeforeUnload = () => {
      if (socket) {
        socket.emit("leave-room", { roomId, userId })
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)

    // Cleanup on unmount
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      stopRecordingTimer()
      stopMicrophoneMonitoring()

      if (socket) {
        socket.emit("leave-room", { roomId, userId })
        socket.disconnect()
      }

      // Clean up media
      localStream?.getTracks().forEach((track) => track.stop())

      // Properly close peer connections
      peerConnections.current.forEach((pc, userId) => {
        if (pc.connectionState !== "closed") {
          console.log(`🚪 Closing peer connection for: ${userId}`)
          pc.close()
        }
      })
      peerConnections.current.clear()

      if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
        mediaRecorder.current.stop()
      }

      // Clean up URLs
      if (lastRecordingUrl) {
        URL.revokeObjectURL(lastRecordingUrl)
      }

      // Clean up remote audios
      remoteAudios.current.forEach((audio, userId) => {
        if (document.body.contains(audio)) {
          console.log(`🔊 Removing audio element for: ${userId}`)
          document.body.removeChild(audio)
        }
      })
      remoteAudios.current.clear()
    }
  }, [
    roomId,
    userId,
    isMobile,
    updatePeerState,
    handleWebRTCOffer,
    handleWebRTCAnswer,
    handleICECandidate,
    cleanupPeerConnection,
  ])

  // Enhanced effect for auto-connecting to new users
  useEffect(() => {
    if (localStream && users.length > 0 && isConnected) {
      console.log(`🔄 Checking WebRTC connections for ${users.length} users`)
      console.log(`📊 Current peer states:`, Array.from(peerStates.entries()))

      users.forEach((user, index) => {
        const peerStatus = peerStates.get(user.userId)?.status
        console.log(`👤 User ${user.userId} status: ${peerStatus || "undefined"}`)

        if (!peerStatus || peerStatus === "disconnected" || peerStatus === "failed") {
          console.log(`🤝 Auto-initiating connection to user: ${user.userId}`)
          // Add a small delay to prevent overwhelming the connection
          setTimeout(
            () => {
              // Double-check the user still exists and we're still connected
              if (isConnected && localStream && users.find((u) => u.userId === user.userId)) {
                console.log(`🚀 Actually initiating connection to: ${user.userId}`)
                initiateWebRTCConnection(user.userId)
              } else {
                console.log(`⚠️ Skipping connection to ${user.userId} - conditions changed`)
              }
            },
            (index + 1) * 1000 + Math.random() * 1000, // Staggered delays
          )
        }
      })
    } else {
      console.log(
        `⚠️ Auto-connection skipped: localStream=${!!localStream}, users=${users.length}, connected=${isConnected}`,
      )
    }
  }, [localStream, users, isConnected, initiateWebRTCConnection, peerStates])

  // Debug function to refresh room info
  const refreshRoomInfo = () => {
    if (socketRef.current) {
      console.log("🔄 Requesting room info...")
      socketRef.current.emit("get-room-info", { roomId })
    }
  }

  // Microphone level monitoring with water effect
  const startMicrophoneMonitoring = useCallback((stream: MediaStream) => {
    try {
      audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      analyser.current = audioContext.current.createAnalyser()
      const source = audioContext.current.createMediaStreamSource(stream)
      source.connect(analyser.current)

      analyser.current.fftSize = 256
      analyser.current.smoothingTimeConstant = 0.8
      const bufferLength = analyser.current.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)

      const updateLevel = () => {
        if (analyser.current && audioContext.current?.state === "running") {
          analyser.current.getByteTimeDomainData(dataArray)

          // Calculate RMS (Root Mean Square) for better audio level detection
          let sum = 0
          for (let i = 0; i < bufferLength; i++) {
            const sample = (dataArray[i] - 128) / 128 // Normalize to -1 to 1
            sum += sample * sample
          }
          const rms = Math.sqrt(sum / bufferLength)
          const level = Math.round(rms * 100 * 3) // Amplify for better visibility
          const normalizedLevel = Math.min(level, 100) // Cap at 100%

          setMicrophoneLevel(normalizedLevel)

          // Create water ripples based on voice activity
          const threshold = 15 // Minimum level to trigger ripples
          const isCurrentlySpeaking = normalizedLevel > threshold

          setIsSpeaking(isCurrentlySpeaking)

          console.log(`🎤 Mic level: ${normalizedLevel}% | Speaking: ${isCurrentlySpeaking}`)
        }
      }

      // Resume audio context if suspended
      if (audioContext.current.state === "suspended") {
        audioContext.current.resume()
      }

      micLevelTimer.current = setInterval(updateLevel, 100)
      console.log("✅ Microphone monitoring started")
    } catch (error) {
      console.error("❌ Error setting up microphone monitoring:", error)
    }
  }, [])

  const stopMicrophoneMonitoring = useCallback(() => {
    if (micLevelTimer.current) {
      clearInterval(micLevelTimer.current)
      micLevelTimer.current = null
    }

    // Fix: Check if AudioContext exists and is not already closed
    if (audioContext.current && audioContext.current.state !== "closed") {
      audioContext.current.close().catch((error) => {
        console.log("AudioContext already closed or closing:", error)
      })
    }

    setMicrophoneLevel(0)
    setIsSpeaking(false)
  }, [])

  // Recording timer functions
  const startRecordingTimer = () => {
    setRecordingDuration(0)
    recordingTimer.current = setInterval(() => {
      setRecordingDuration((prev) => prev + 1)
    }, 1000)
  }

  const stopRecordingTimer = () => {
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current)
      recordingTimer.current = null
    }
    setRecordingDuration(0)
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const retryAllConnections = useCallback(() => {
    console.log("🔄 Manually retrying all WebRTC connections")
    users.forEach((user) => {
      console.log(`🔄 Retrying connection to: ${user.userId}`)
      updatePeerState(user.userId, "connecting")
      setTimeout(
        () => {
          initiateWebRTCConnection(user.userId)
        },
        Math.random() * 1000 + 500,
      )
    })
  }, [users, initiateWebRTCConnection, updatePeerState])

  // Audio functions
  const downloadAudioFile = (audioData: string, filename: string, mimeType = "audio/webm") => {
    try {
      const byteCharacters = atob(audioData)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: mimeType })

      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("❌ Error downloading audio file:", error)
    }
  }

  const createPlayableAudioUrl = (audioData: string, mimeType = "audio/webm") => {
    try {
      const byteCharacters = atob(audioData)
      const byteNumbers = new Array(byteCharacters.length)
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const blob = new Blob([byteArray], { type: mimeType })
      return URL.createObjectURL(blob)
    } catch (error) {
      console.error("❌ Error creating audio URL:", error)
      return null
    }
  }

  const startVoiceChat = async () => {
    try {
      console.log("🎤 Starting voice chat... Mobile:", isMobile)

      // Enhanced constraints for mobile
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: isMobile ? 22050 : 44100,
          channelCount: 1,
          ...(isMobile && {
            latency: 0.1,
            volume: 1.0,
          }),
        },
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      console.log("✅ Got media stream:", stream.getTracks().length, "tracks")
      setLocalStream(stream)

      // Start microphone monitoring
      startMicrophoneMonitoring(stream)

      // Set up media recorder for server-side recording
      if (!mediaRecorder.current) {
        let mimeType = ""
        const supportedTypes = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/mp4",
          "audio/ogg;codecs=opus",
          "audio/wav",
        ]

        for (const type of supportedTypes) {
          if (MediaRecorder.isTypeSupported(type)) {
            mimeType = type
            break
          }
        }

        console.log("🎵 Using MIME type for recording:", mimeType || "default")
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        mediaRecorder.current = recorder

        recorder.ondataavailable = async (event) => {
          if (event.data.size > 0 && isRecording && socketRef.current && isConnected) {
            try {
              const arrayBuffer = await event.data.arrayBuffer()
              const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
              const currentChunkIndex = chunkIndex.current++

              socketRef.current.emit("audio-chunk", {
                roomId,
                audioData: base64,
                chunkIndex: currentChunkIndex,
              })
              setAudioChunksSent((prev) => prev + 1)
              console.log(`📤 Sent audio chunk ${currentChunkIndex}: ${event.data.size} bytes`)
            } catch (error) {
              console.error("❌ Error processing audio chunk:", error)
            }
          }
        }

        recorder.onerror = (event) => {
          console.error("❌ MediaRecorder error:", event)
        }

        const interval = isMobile ? 500 : 1000
        recorder.start(interval)
        console.log(`✅ MediaRecorder started with ${interval}ms intervals`)
      }
    } catch (error) {
      console.error("❌ Error accessing microphone:", error)
      const errorMessage = isMobile
        ? "Could not access microphone. Please check permissions in your browser settings and ensure you're using HTTPS."
        : "Could not access microphone. Please check permissions and try again."
      alert(errorMessage)
    }
  }

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = isMuted
      })
      setIsMuted(!isMuted)
      console.log("🎤 Microphone", isMuted ? "unmuted" : "muted")
    }
  }

  const startRecording = () => {
    if (socketRef.current && isConnected) {
      console.log("🎙️ Starting recording for room:", roomId)
      socketRef.current.emit("start-recording", { roomId })
    } else {
      alert("❌ Not connected to server")
    }
  }

  const stopRecording = () => {
    if (socketRef.current && isConnected) {
      console.log("⏹️ Stopping recording for room:", roomId)
      socketRef.current.emit("stop-recording", { roomId })
    } else {
      alert("❌ Not connected to server")
    }
  }

  const downloadCurrentRecording = () => {
    if (socketRef.current && isConnected) {
      console.log("📥 Requesting current recording for room:", roomId)
      socketRef.current.emit("get-recording", { roomId })
    } else {
      alert("❌ Not connected to server")
    }
  }

  const playLastRecording = () => {
    if (lastRecordingUrl && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
        setIsPlaying(false)
      } else {
        audioRef.current.src = lastRecordingUrl
        audioRef.current.play()
        setIsPlaying(true)
      }
    }
  }

  const leaveRoom = () => {
    console.log("🚪 Leaving room:", roomId)

    if (socketRef.current) {
      socketRef.current.emit("leave-room", { roomId, userId })
    }

    // Clean up
    localStream?.getTracks().forEach((track) => track.stop())
    peerConnections.current.forEach((pc) => pc.close())

    if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
      mediaRecorder.current.stop()
    }

    stopRecordingTimer()
    stopMicrophoneMonitoring()
    window.location.href = "/"
  }

  // Get peer connection status for a user
  const getPeerStatus = (userId: string) => {
    return peerStates.get(userId)?.status || "disconnected"
  }

  // Get status icon for peer connection
  const getStatusIcon = (status: PeerConnectionState["status"]) => {
    switch (status) {
      case "connected":
        return <Volume2 className="w-3 h-3 text-green-500" />
      case "connecting":
        return <Wifi className="w-3 h-3 text-yellow-500 animate-pulse" />
      case "failed":
        return <WifiOff className="w-3 h-3 text-red-500" />
      default:
        return <VolumeX className="w-3 h-3 text-gray-400" />
    }
  }

  const testConnection = useCallback(
    (targetUserId: string) => {
      console.log(`🧪 Testing connection to: ${targetUserId}`)
      console.log(`📊 Local stream:`, !!localStream)
      console.log(`📊 Socket connected:`, isConnected)
      console.log(`📊 Current peer state:`, peerStates.get(targetUserId))

      if (localStream && isConnected) {
        updatePeerState(targetUserId, "connecting")
        initiateWebRTCConnection(targetUserId)
      } else {
        console.log(`❌ Cannot test connection - missing requirements`)
      }
    },
    [localStream, isConnected, peerStates, updatePeerState, initiateWebRTCConnection],
  )

  // Add these new functions before the return statement

  const downloadMyRecording = () => {
    if (socketRef.current && isConnected) {
      console.log("📥 Requesting my recording for room:", roomId)
      socketRef.current.emit("get-recording", { roomId, userId })
    } else {
      alert("❌ Not connected to server")
    }
  }

  const downloadUserRecording = (targetUserId: string) => {
    if (socketRef.current && isConnected) {
      console.log(`📥 Requesting recording for user ${targetUserId} in room:`, roomId)
      socketRef.current.emit("get-recording", { roomId, userId: targetUserId })
    } else {
      alert("❌ Not connected to server")
    }
  }

  const getRecordingStatus = () => {
    if (socketRef.current && isConnected) {
      console.log("📊 Requesting recording status for room:", roomId)
      socketRef.current.emit("get-recording-status", { roomId })
    } else {
      alert("❌ Not connected to server")
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-4xl mx-auto">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                Voice Chat Room: {roomId}
                {isMobile && <Smartphone className="w-4 h-4" />}
                {isSpeaking && (
                  <div className="flex items-center gap-1 text-blue-600">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    <span className="text-sm">Speaking</span>
                  </div>
                )}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant={isConnected ? "default" : "destructive"}>{connectionStatus}</Badge>
                {isRecording && (
                  <Badge variant="destructive" className="animate-pulse">
                    <Circle className="w-3 h-3 mr-1 fill-current" />
                    Recording {formatDuration(recordingDuration)}
                  </Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connectionError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500" />
                <span className="text-red-700 text-sm">{connectionError}</span>
                {isMobile && (
                  <span className="text-red-600 text-xs ml-2">(Mobile: Try HTTPS or check network connection)</span>
                )}
              </div>
            )}

            <div className="flex gap-4 mb-4 flex-wrap">
              {!localStream ? (
                <Button onClick={startVoiceChat} className="flex items-center gap-2" disabled={!isConnected}>
                  <Mic className="w-4 h-4" />
                  Join Voice Chat
                </Button>
              ) : (
                <Button
                  onClick={toggleMute}
                  variant={isMuted ? "destructive" : "default"}
                  className="flex items-center gap-2"
                >
                  {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  {isMuted ? "Unmute" : "Mute"}
                </Button>
              )}

              {localStream && isConnected && (
                <>
                  {!isRecording ? (
                    <Button onClick={startRecording} variant="outline" className="flex items-center gap-2">
                      <Circle className="w-4 h-4" />
                      Start Recording (All Users)
                    </Button>
                  ) : (
                    <>
                      <Button onClick={stopRecording} variant="destructive" className="flex items-center gap-2">
                        <Square className="w-4 h-4" />
                        Stop Recording
                      </Button>
                      <Button onClick={downloadMyRecording} variant="secondary" className="flex items-center gap-2">
                        <Square className="w-4 h-4" />
                        Download My Recording
                      </Button>
                      <Button
                        onClick={getRecordingStatus}
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2"
                      >
                        📊 Status
                      </Button>
                    </>
                  )}
                </>
              )}

              {lastRecordingUrl && (
                <Button onClick={playLastRecording} variant="outline" className="flex items-center gap-2">
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isPlaying ? "Pause" : "Play Last Recording"}
                </Button>
              )}

              <Button onClick={refreshRoomInfo} variant="outline" size="sm" className="flex items-center gap-2">
                <RefreshCw className="w-3 h-3" />
                Debug
              </Button>

              <Button onClick={retryAllConnections} variant="outline" size="sm" className="flex items-center gap-2">
                <RefreshCw className="w-3 h-3" />
                Retry Connections
              </Button>

              <Button onClick={leaveRoom} variant="outline">
                Leave Room
              </Button>
            </div>

            <div className="flex items-center gap-4 mb-4 text-sm flex-wrap">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                <span>Users in room: {totalUsers || users.length + 1}</span>
              </div>
              {isRecording && (
                <div className="flex items-center gap-2 text-blue-600">
                  <span>• Chunks sent: {audioChunksSent}</span>
                  <span>• Confirmed: {audioChunksConfirmed}</span>
                </div>
              )}
              {localStream && (
                <div className="flex items-center gap-2">
                  <span>Voice Activity:</span>
                  <div className="flex items-center gap-1">
                    {isSpeaking ? (
                      <div className="flex items-center gap-1 text-green-600">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span>Speaking ({microphoneLevel}%)</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-gray-500">
                        <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                        <span>Silent</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {!isConnected && <span className="text-red-500">(Connecting to server...)</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <UserAvatar userId={userId} isCurrentUser={true} isSpeaking={isSpeaking} micLevel={microphoneLevel}>
                    You
                  </UserAvatar>
                  <p className="text-sm text-gray-600 mt-2">
                    {!localStream ? "Not connected" : isMuted ? "Muted" : isSpeaking ? "Speaking" : "Listening"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">ID: {userId}</p>
                  {isMobile && <p className="text-xs text-blue-500">📱 Mobile</p>}
                  {isSpeaking && <div className="mt-2 text-xs text-blue-600 font-medium">🌊 Water ripples active</div>}
                </CardContent>
              </Card>

              {users.map((user) => {
                const peerStatus = getPeerStatus(user.userId)
                const userSpeakingState = userSpeakingStates.get(user.userId)
                const isUserSpeaking = userSpeakingState?.isSpeaking || false
                const userMicLevel = userSpeakingState?.level || 0

                return (
                  <Card key={user.userId}>
                    <CardContent className="p-4 text-center">
                      <UserAvatar
                        userId={user.userId}
                        isCurrentUser={false}
                        isSpeaking={isUserSpeaking}
                        micLevel={userMicLevel}
                      >
                        {user.userId.slice(0, 2).toUpperCase()}
                      </UserAvatar>

                      {/* Status icon positioned over avatar */}
                      <div className="relative -mt-4 mb-2 flex justify-end pr-2">{getStatusIcon(peerStatus)}</div>

                      <p className="text-sm text-gray-600 capitalize">{isUserSpeaking ? "Speaking" : peerStatus}</p>
                      <p className="text-xs text-gray-500 mb-2">ID: {user.userId}</p>

                      {peerStatus === "connected" ? (
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center justify-center gap-1 text-green-600 text-xs">
                            <Volume2 className="w-3 h-3" />
                            <span>Audio Connected</span>
                            {isUserSpeaking && <span className="text-blue-600">🌊</span>}
                          </div>
                          {isRecording && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs mt-1"
                              onClick={() => downloadUserRecording(user.userId)}
                            >
                              📥 Download Recording
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs"
                            onClick={() => testConnection(user.userId)}
                            disabled={!localStream}
                          >
                            <Volume2 className="w-3 h-3 mr-1" />
                            Connect Audio
                          </Button>
                          <div className="text-xs text-gray-500">
                            Stream: {localStream ? "✅" : "❌"} | Socket: {isConnected ? "✅" : "❌"}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {/* Hidden audio element for playback */}
            <audio
              ref={audioRef}
              onEnded={() => setIsPlaying(false)}
              onPause={() => setIsPlaying(false)}
              style={{ display: "none" }}
            />

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>🎙️ Recording:</strong> Server captures all audio for download.
                <strong> 🔊 Voice Chat:</strong> Click "Connect Audio" to hear other users in real-time via WebRTC.
                <strong> 🌊 Water Effect:</strong> Ripples appear on user avatars when speaking!
              </p>
              <p className="text-xs text-blue-600 mt-2">
                Server URL: {process.env.NEXT_PUBLIC_SERVER_URL || "https://192.168.29.138:3001"} • Chunks sent:{" "}
                {audioChunksSent} • Confirmed: {audioChunksConfirmed} • Connection: {isConnected ? "✅" : "❌"} •
                Device: {isMobile ? "📱 Mobile" : "💻 Desktop"} • Total Users: {totalUsers}
              </p>
              {isMobile && (
                <p className="text-xs text-orange-600 mt-1">
                  📱 Mobile detected: Using optimized settings. For best results, use HTTPS and ensure microphone
                  permissions are granted.
                </p>
              )}

              <div className="mt-3 p-2 bg-white rounded border">
                <p className="text-xs font-medium text-gray-700 mb-1">WebRTC Connection Status:</p>
                <div className="flex gap-2 text-xs">
                  <span className="flex items-center gap-1">
                    <Volume2 className="w-3 h-3 text-green-500" />
                    Connected
                  </span>
                  <span className="flex items-center gap-1">
                    <Wifi className="w-3 h-3 text-yellow-500" />
                    Connecting
                  </span>
                  <span className="flex items-center gap-1">
                    <VolumeX className="w-3 h-3 text-gray-400" />
                    Disconnected
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
