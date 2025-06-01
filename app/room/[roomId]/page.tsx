"use client"

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
  AlertTriangle,
  Smartphone,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react"
import { io, type Socket } from "socket.io-client"

interface User {
  userId: string
  socketId: string
}

interface PeerConnectionState {
  status: "disconnected" | "connecting" | "connected" | "failed"
  lastAttempt: number
}

export default function VoiceRoom() {
  const params = useParams()
  const roomId = params.roomId as string
  const [users, setUsers] = useState<User[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessingRecording, setIsProcessingRecording] = useState(false)
  const [isStartingRecording, setIsStartingRecording] = useState(false)
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
  const [userId] = useState(() => {
    // Fix hydration issue by using a stable ID
    if (typeof window !== "undefined") {
      let id = localStorage.getItem("voice-chat-user-id")
      if (!id) {
        id = Math.random().toString(36).substr(2, 9)
        localStorage.setItem("voice-chat-user-id", id)
      }
      return id
    }
    return "temp-id"
  })

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

  // Add negotiation state refs
  const makingOffer = useRef(false)
  const ignoreOffer = useRef(false)
  const politeMap = useRef<Map<string, boolean>>(new Map())

  // Add recording state ref to track local recording state
  const isRecordingLocally = useRef(false);
  const recordingStateRef = useRef<{ isRecording: boolean; roomId: string | null }>({ isRecording: false, roomId: null });

  // Add new state for recording data
  const [recordingData, setRecordingData] = useState<{
    audioData: string | null;
    size: number;
    mimeType: string;
  } | null>(null);

  // Add new state for tracking recording requests
  const [isRequestingRecording, setIsRequestingRecording] = useState(false);
  const recordingRequestTimeout = useRef<NodeJS.Timeout | null>(null);
  const hasRequestedRecording = useRef(false);

  // Add new function to handle recording data requests
  const requestRecordingData = useCallback(() => {
    if (isRequestingRecording || !socketRef.current || !isConnected || hasRequestedRecording.current) return;

    console.log("📥 Requesting recording data");
    setIsRequestingRecording(true);
    hasRequestedRecording.current = true;
    socketRef.current.emit("get-recording", { roomId });

    // Set a timeout to prevent infinite requests
    recordingRequestTimeout.current = setTimeout(() => {
      setIsRequestingRecording(false);
    }, 5000);
  }, [isRequestingRecording, isConnected, roomId]);

  // Helper to determine polite/impolite based on userId
  const isPolite = (targetUserId: string) => {
    // For deterministic polite assignment, use lexicographical order
    return userId < targetUserId
  }

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

  // Initialize Socket.io connection with mobile-optimized settings
  useEffect(() => {
    const serverUrl = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"
    console.log("🔌 Connecting to server:", serverUrl, "Mobile:", isMobile)

    socketRef.current = io(serverUrl, {
      transports: ["polling", "websocket"], // Try polling first, then upgrade to websocket
      timeout: 60000,
      forceNew: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      upgrade: true,
      rememberUpgrade: true,
      path: "/socket.io/",
      withCredentials: true,
      query: {
        userId,
        roomId,
        isMobile: isMobile.toString()
      }
    })

    const socket = socketRef.current

    // Connection events
    socket.on("connect", () => {
      console.log("✅ Connected to server with ID:", socket.id)
      setIsConnected(true)
      setConnectionStatus("Connected")
      setConnectionError(null)

      // Join the room with retry
      const joinRoom = () => {
        console.log("🚪 Attempting to join room:", roomId)
        socket.emit("join-room", { roomId, userId }, (response: any) => {
          if (response && response.error) {
            console.error("❌ Failed to join room:", response.error)
            setConnectionError(`Failed to join room: ${response.error}`)
            // Retry after 2 seconds
            setTimeout(joinRoom, 2000)
          }
        })
      }

      joinRoom()
    })

    socket.on("disconnect", (reason) => {
      console.log("❌ Disconnected from server:", reason)
      setIsConnected(false)
      setConnectionStatus("Disconnected")
      setConnectionError(`Disconnected: ${reason}`)

      // Reset all peer connections
      setPeerStates(new Map())

      // If the disconnect was not initiated by the client, try to reconnect
      if (reason !== "io client disconnect") {
        setTimeout(() => {
          if (socketRef.current) {
            console.log("🔄 Attempting to reconnect...")
            socketRef.current.connect()
          }
        }, 2000)
      }
    })

    socket.on("connect_error", (error) => {
      console.error("❌ Connection error:", error)
      setConnectionStatus("Connection Error")
      setConnectionError(error.message || "Failed to connect to server")

      // Try to reconnect with a different transport
      if (socketRef.current) {
        const currentTransport = socketRef.current.io.engine.transport.name
        console.log("🔄 Current transport:", currentTransport)

        if (currentTransport === "polling") {
          console.log("🔄 Switching to WebSocket transport...")
          socketRef.current.io.opts.transports = ["websocket"]
        } else {
          console.log("🔄 Switching to polling transport...")
          socketRef.current.io.opts.transports = ["polling"]
        }

        socketRef.current.connect()
      }
    })

    socket.on("reconnect", (attemptNumber) => {
      console.log("🔄 Reconnected after", attemptNumber, "attempts")
      setIsConnected(true)
      setConnectionStatus("Reconnected")
      setConnectionError(null)

      // Rejoin the room after reconnection
      socket.emit("join-room", { roomId, userId })
    })

    socket.on("reconnect_error", (error) => {
      console.error("❌ Reconnection error:", error)
      setConnectionError("Reconnection failed")
    })

    socket.on("reconnect_failed", () => {
      console.error("❌ Reconnection failed after all attempts")
      setConnectionError("Failed to reconnect after multiple attempts")
    })

    // Room events
    socket.on("room-joined", (data) => {
      console.log("🚪 Successfully joined room:", data)
      setUsers(data.users || [])
      setIsRecording(data.isRecording || false)

      // Initialize peer states for existing users
      data.users?.forEach((user: User) => {
        updatePeerState(user.userId, "disconnected")
      })
    })

    socket.on("user-joined", (data) => {
      console.log("👤 User joined room:", data)
      setUsers((prev) => {
        const exists = prev.find((user) => user.userId === data.userId)
        if (!exists) {
          updatePeerState(data.userId, "disconnected")
          // Automatically initiate connection if we have a local stream
          if (localStream) {
            setTimeout(() => {
              initiateWebRTCConnection(data.userId)
            }, 1000) // 1 second delay to ensure everything is ready
          }
          return [...prev, { userId: data.userId, socketId: data.socketId || "" }]
        }
        return prev
      })

      // If we're recording and a new user joins, ensure they're included in the recording
      if (isRecordingLocally.current && recordingStateRef.current.isRecording) {
        console.log("🎙️ New user joined during recording, ensuring they're included");
        // The server will handle sending the recording state to the new user
      }
    })

    socket.on("user-left", (data) => {
      console.log("👋 User left room:", data)
      setUsers((prev) => prev.filter((user) => user.userId !== data.userId))

      // Clean up peer connection
      if (peerConnections.current.has(data.userId)) {
        peerConnections.current.get(data.userId)?.close()
        peerConnections.current.delete(data.userId)
      }

      // Clean up remote audio
      if (remoteAudios.current.has(data.userId)) {
        const audio = remoteAudios.current.get(data.userId)
        if (audio && document.body.contains(audio)) {
          document.body.removeChild(audio)
        }
        remoteAudios.current.delete(data.userId)
      }

      // Remove peer state
      setPeerStates((prev) => {
        const newMap = new Map(prev)
        newMap.delete(data.userId)
        return newMap
      })
    })

    // Recording events
    socket.on("recording-started", (data) => {
      console.log("🎙️ Recording started notification:", data);
      setIsRecording(true);
      recordingStateRef.current = { isRecording: true, roomId };
      startRecordingTimer();

      // If this is an existing recording and we're not already recording locally
      if (data.isExistingRecording && !isRecordingLocally.current && localStream) {
        console.log("🎙️ Joining existing recording");
        startLocalMediaRecorder(); // Only start local, do NOT emit to server
      }
    });

    socket.on("recording-stopped", (data) => {
      console.log("⏹️ Recording stopped notification:", data);
      setIsRecording(false);
      isRecordingLocally.current = false;
      recordingStateRef.current = { isRecording: false, roomId: null };
      stopRecordingTimer();

      // Reset the recording request flag when a new recording is stopped
      hasRequestedRecording.current = false;

      // Only request recording data if we haven't already
      if (!lastRecordingUrl && !isRequestingRecording) {
        requestRecordingData();
      }
    });

    socket.on("recording-start-response", (data) => {
      console.log("🎙️ Recording start response:", data);
      if (data.success) {
        setIsRecording(true);
        setIsStartingRecording(false);
        recordingStateRef.current = { isRecording: true, roomId };
        startRecordingTimer();
        setAudioChunksSent(0);
        setAudioChunksConfirmed(0);
        chunkIndex.current = 0;
      } else {
        setIsStartingRecording(false);
        recordingStateRef.current = { isRecording: false, roomId: null };
      }
    });

    socket.on("recording-stop-response", (data) => {
      console.log("⏹️ Recording stop response:", data);
      if (data.success) {
        setIsRecording(false);
        setIsProcessingRecording(false);
        isRecordingLocally.current = false;
        recordingStateRef.current = { isRecording: false, roomId: null };

        if (data.audioData && data.recordingSize > 0) {
          console.log("✅ Received audio data in stop response");
          const playableUrl = createPlayableAudioUrl(data.audioData, data.mimeType || "audio/webm");
          if (playableUrl) {
            setLastRecordingUrl(playableUrl);
            console.log("✅ Recording URL created from stop response");
          }
        }
      } else {
        setIsProcessingRecording(false);
        recordingStateRef.current = { isRecording: false, roomId: null };
      }
    });

    socket.on("get-recording-response", (data) => {
      console.log("📥 Get recording response:", data);
      setIsRequestingRecording(false);

      if (data.success && data.audioData && data.recordingSize > 0) {
        console.log("✅ Received audio data in get-recording response");
        const playableUrl = createPlayableAudioUrl(data.audioData, data.mimeType || "audio/webm");
        if (playableUrl) {
          setLastRecordingUrl(playableUrl);
          console.log("✅ Recording URL created from get-recording response");
        }
      } else {
        console.log("⚠️ No recording data available in get-recording response");
      }
    });

    // Audio chunk confirmation with better error handling
    socket.on("audio-chunk-received", (data) => {
      if (data.success) {
        setAudioChunksConfirmed((prev) => prev + 1);
        console.log(`✅ Audio chunk confirmed: ${data.chunkIndex}, Total: ${data.totalChunks}`);
      } else {
        console.error("❌ Audio chunk failed:", data.error);
        // If recording is not active, stop local recording
        if (data.error === "Recording not active" && isRecordingLocally.current) {
          console.log("🛑 Stopping local recording due to server state mismatch");
          stopRecording();
        }
      }
    });

    // WebRTC signaling events
    socket.on("webrtc-offer", async (data) => {
      console.log("🤝 Received WebRTC offer from:", data.fromUserId)
      updatePeerState(data.fromUserId, "connecting")
      await handleWebRTCOffer(data.fromUserId, data.offer)
    })

    socket.on("webrtc-answer", async (data) => {
      console.log("🤝 Received WebRTC answer from:", data.fromUserId)
      await handleWebRTCAnswer(data.fromUserId, data.answer)
    })

    socket.on("webrtc-ice-candidate", async (data) => {
      console.log("🧊 Received ICE candidate from:", data.fromUserId)
      await handleICECandidate(data.fromUserId, data.candidate)
    })

    // Audio data events
    socket.on("audio-data", (data) => {
      console.log("🎵 Received audio data from:", data.userId)
    })

    // Add room-updated event handler
    socket.on("room-updated", (data) => {
      console.log("🔄 Room updated:", data);
      if (data.isRecording === false && !lastRecordingUrl && !isRequestingRecording) {
        requestRecordingData();
      }
      // Update recording state if it changed
      if (data.isRecording !== isRecording) {
        setIsRecording(data.isRecording);
      }
    });

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
      peerConnections.current.forEach((pc) => pc.close())

      if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
        mediaRecorder.current.stop()
      }

      // Clean up URLs
      if (lastRecordingUrl) {
        URL.revokeObjectURL(lastRecordingUrl)
      }

      // Clean up audio context
      if (audioContext.current) {
        audioContext.current.close()
      }

      // Clean up remote audios
      remoteAudios.current.forEach((audio) => {
        if (document.body.contains(audio)) {
          document.body.removeChild(audio)
        }
      })

      socket.off("recording-stopped");
      socket.off("recording-stop-response");
      socket.off("get-recording-response");
      socket.off("room-updated");
      if (recordingRequestTimeout.current) {
        clearTimeout(recordingRequestTimeout.current);
      }
    }
  }, [roomId, userId, isMobile, updatePeerState])

  // Enhanced microphone level monitoring
  const startMicrophoneMonitoring = useCallback((stream: MediaStream) => {
    try {
      // Clean up existing audio context if any
      if (audioContext.current) {
        audioContext.current.close();
      }

      audioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyser.current = audioContext.current.createAnalyser();
      const source = audioContext.current.createMediaStreamSource(stream);
      source.connect(analyser.current);

      // Enhanced analyzer settings for better level detection
      analyser.current.fftSize = 2048; // Increased for better accuracy
      analyser.current.smoothingTimeConstant = 0.3; // Reduced for more responsive changes
      const bufferLength = analyser.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      // Add gain node for better level control
      const gainNode = audioContext.current.createGain();
      gainNode.gain.value = 1.0; // Reduced from 1.5 to 1.0 for more accurate levels
      source.connect(gainNode);
      gainNode.connect(analyser.current);

      const updateLevel = () => {
        if (!audioContext.current || audioContext.current.state === "closed") {
          console.log("Audio context closed, restarting monitoring...");
          startMicrophoneMonitoring(stream);
          return;
        }

        if (audioContext.current.state === "suspended") {
          audioContext.current.resume().catch(console.error);
        }

        if (analyser.current) {
          analyser.current.getByteFrequencyData(dataArray);

          // Enhanced level calculation with better scaling
          let sum = 0;
          let count = 0;

          // Focus on speech frequencies (roughly 300Hz to 3000Hz)
          const minFreq = 300;
          const maxFreq = 3000;
          const sampleRate = audioContext.current.sampleRate;

          for (let i = 0; i < dataArray.length; i++) {
            const frequency = i * sampleRate / (2 * dataArray.length);
            if (frequency >= minFreq && frequency <= maxFreq) {
              // Use linear scaling instead of square for more natural levels
              sum += dataArray[i] / 255;
              count++;
            }
          }

          // Calculate average and apply more natural scaling
          const average = sum / count;
          const scaledLevel = Math.min(100, Math.round(average * 150)); // Reduced from 200 to 150

          // Apply smoother transitions
          setMicrophoneLevel(prevLevel => {
            const diff = scaledLevel - prevLevel;
            return Math.round(prevLevel + (diff * 0.2)); // Reduced from 0.3 to 0.2 for smoother transitions
          });
        }
      };

      // Clear existing timer
      if (micLevelTimer.current) {
        clearInterval(micLevelTimer.current);
      }

      micLevelTimer.current = setInterval(updateLevel, 50);
    } catch (error) {
      console.error("❌ Error setting up microphone monitoring:", error);
      setTimeout(() => {
        if (stream) {
          startMicrophoneMonitoring(stream);
    }
      }, 1000);
    }
  }, []);

  const stopMicrophoneMonitoring = useCallback(() => {
    if (micLevelTimer.current) {
      clearInterval(micLevelTimer.current);
      micLevelTimer.current = null;
    }
    setMicrophoneLevel(0);
  }, []);

  // Enhanced cleanup function
  const cleanup = useCallback(() => {
    console.log("🧹 Cleaning up resources...");

    // Stop all peer connections
    peerConnections.current.forEach((pc) => {
      try {
        pc.close();
      } catch (error) {
        console.log("Error closing peer connection:", error);
      }
    });
    peerConnections.current.clear();

    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.log("Error stopping track:", error);
        }
      });
    }

    // Clean up audio context
    if (audioContext.current) {
      try {
        if (audioContext.current.state !== "closed") {
          audioContext.current.close();
        }
      } catch (error) {
        console.log("Error closing audio context:", error);
      }
      audioContext.current = null;
      analyser.current = null;
    }

    // Clear timers
    if (micLevelTimer.current) {
      clearInterval(micLevelTimer.current);
      micLevelTimer.current = null;
    }
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }

    // Remove audio elements
    remoteAudios.current.forEach((audio) => {
      try {
        if (document.body.contains(audio)) {
          document.body.removeChild(audio);
        }
      } catch (error) {
        console.log("Error removing audio element:", error);
      }
    });
    remoteAudios.current.clear();

    // Reset states
    setLocalStream(null);
    setMicrophoneLevel(0);
    setIsMuted(false);
    setIsRecording(false);
    setRecordingDuration(0);
    setConnectionError(null);

    console.log("✅ Cleanup completed");
  }, [localStream]);

  // Enhanced visibility change handler
  const handleVisibilityChange = useCallback(async () => {
    if (document.hidden) {
      // Page is hidden, but keep audio context running
      if (audioContext.current && audioContext.current.state === "running") {
        // Don't suspend, just reduce processing
        if (micLevelTimer.current) {
          clearInterval(micLevelTimer.current);
          micLevelTimer.current = setInterval(() => {
            if (analyser.current) {
              const dataArray = new Uint8Array(analyser.current.frequencyBinCount);
              analyser.current.getByteFrequencyData(dataArray);

              // Use the same enhanced level calculation
              let sum = 0;
              let count = 0;
              const minFreq = 300;
              const maxFreq = 3000;
              const sampleRate = audioContext.current?.sampleRate || 44100;

              for (let i = 0; i < dataArray.length; i++) {
                const frequency = i * sampleRate / (2 * dataArray.length);
                if (frequency >= minFreq && frequency <= maxFreq) {
                  // Use linear scaling instead of square for more natural levels
                  sum += dataArray[i] / 255;
                  count++;
                }
              }

              // Calculate average and apply more natural scaling
              const average = sum / count;
              const scaledLevel = Math.min(100, Math.round(average * 150)); // Reduced from 200 to 150

              // Apply smoother transitions
              setMicrophoneLevel(prevLevel => {
                const diff = scaledLevel - prevLevel;
                return Math.round(prevLevel + (diff * 0.2)); // Reduced from 0.3 to 0.2 for smoother transitions
              });
            }
          }, 100); // Slightly slower updates in background
        }
      }
    } else {
      // Page is visible again, resume normal processing
      if (audioContext.current) {
        try {
          if (audioContext.current.state === "suspended") {
            await audioContext.current.resume();
          }
          // Resume normal update frequency
          if (micLevelTimer.current) {
            clearInterval(micLevelTimer.current);
            micLevelTimer.current = setInterval(() => {
              if (analyser.current) {
                const dataArray = new Uint8Array(analyser.current.frequencyBinCount);
                analyser.current.getByteFrequencyData(dataArray);

                // Use the same enhanced level calculation
                let sum = 0;
                let count = 0;
                const minFreq = 300;
                const maxFreq = 3000;
                const sampleRate = audioContext.current?.sampleRate || 44100;

                for (let i = 0; i < dataArray.length; i++) {
                  const frequency = i * sampleRate / (2 * dataArray.length);
                  if (frequency >= minFreq && frequency <= maxFreq) {
                    // Use linear scaling instead of square for more natural levels
                    sum += dataArray[i] / 255;
                    count++;
                  }
                }

                // Calculate average and apply more natural scaling
                const average = sum / count;
                const scaledLevel = Math.min(100, Math.round(average * 150)); // Reduced from 200 to 150

                // Apply smoother transitions
                setMicrophoneLevel(prevLevel => {
                  const diff = scaledLevel - prevLevel;
                  return Math.round(prevLevel + (diff * 0.2)); // Reduced from 0.3 to 0.2 for smoother transitions
                });
              }
            }, 50); // Faster updates when visible
          }
        } catch (error) {
          console.error("Error resuming audio context:", error);
          if (localStream) {
            startMicrophoneMonitoring(localStream);
          }
        }
      }
    }
  }, [localStream, startMicrophoneMonitoring]);

  // Recording timer functions
  const startRecordingTimer = () => {
    const startTime = Date.now()
    setRecordingDuration(0)
    recordingTimer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      setRecordingDuration(elapsed)
    }, 1000) // Update every second
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

  // Enhanced WebRTC functions
  const createPeerConnection = (targetUserId: string) => {
    // Close existing connection if any
    if (peerConnections.current.has(targetUserId)) {
      peerConnections.current.get(targetUserId)?.close()
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        // Add TURN servers for better connectivity
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
      iceTransportPolicy: "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceCandidatePoolSize: 10,
    })

    // Add ICE candidate throttling
    let lastIceCandidateTime = 0
    const ICE_CANDIDATE_THROTTLE = 100 // ms
    let iceGatheringTimeout: NodeJS.Timeout | null = null

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        const now = Date.now()
        if (now - lastIceCandidateTime > ICE_CANDIDATE_THROTTLE) {
          lastIceCandidateTime = now
        console.log("🧊 Sending ICE candidate to:", targetUserId)
        socketRef.current.emit("webrtc-ice-candidate", {
          roomId,
          targetUserId,
          candidate: event.candidate,
        })
        }
      }
    }

    pc.onicegatheringstatechange = () => {
      console.log(`🧊 ICE gathering state for ${targetUserId}:`, pc.iceGatheringState)

      if (pc.iceGatheringState === "gathering") {
        // Set a timeout for ICE gathering
        if (iceGatheringTimeout) {
          clearTimeout(iceGatheringTimeout)
        }
        iceGatheringTimeout = setTimeout(() => {
          if (pc.iceGatheringState === "gathering") {
            console.log("⚠️ ICE gathering timeout, forcing connection...")
            pc.restartIce()
          }
        }, 5000) // 5 second timeout
      } else if (pc.iceGatheringState === "complete") {
        if (iceGatheringTimeout) {
          clearTimeout(iceGatheringTimeout)
        }
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
      }

      // Set audio constraints for better quality
      if (audio.srcObject !== remoteStream) {
      audio.srcObject = remoteStream

        // Ensure audio is playing
        const playAudio = async () => {
          try {
            await audio.play()
            console.log("✅ Remote audio playing for:", targetUserId)
          } catch (error) {
        console.error("❌ Error playing remote audio:", error)
            // Try to recover by restarting the stream
            setTimeout(() => {
              audio.play().catch(console.error)
            }, 1000)
          }
        }
        playAudio()

        // Add event listeners for better audio handling
        audio.onloadedmetadata = () => {
          console.log("📻 Audio metadata loaded for:", targetUserId)
          playAudio()
        }

        audio.oncanplay = () => {
          console.log("🎵 Audio can play for:", targetUserId)
          playAudio()
        }

        audio.onerror = (error) => {
          console.error("❌ Audio error for:", targetUserId, error)
          // Try to recover
          setTimeout(() => {
            if (audio.srcObject) {
              playAudio()
            }
          }, 1000)
        }
      }

      updatePeerState(targetUserId, "connected")
    }

    pc.onconnectionstatechange = () => {
      console.log(`🔗 WebRTC connection state with ${targetUserId}:`, pc.connectionState)
      switch (pc.connectionState) {
        case "connected":
          updatePeerState(targetUserId, "connected")
          // Ensure audio is playing when connected
          const audio = remoteAudios.current.get(targetUserId)
          if (audio && audio.srcObject) {
            audio.play().catch(console.error)
          }
          break
        case "connecting":
          updatePeerState(targetUserId, "connecting")
          break
        case "failed":
        case "disconnected":
          updatePeerState(targetUserId, "failed")
          // Instead of recreating the connection, coordinate a reset
          if (socketRef.current) {
            socketRef.current.emit("webrtc-reset", { roomId, targetUserId })
          }
          break
      }
    }

    // Listen for coordinated reset
    if (socketRef.current) {
      socketRef.current.off("webrtc-reset"); // Remove previous listener to avoid duplicates
      socketRef.current.on("webrtc-reset", (data) => {
        if (data.targetUserId === userId || data.fromUserId === targetUserId) {
          // Close and remove the old connection
          if (peerConnections.current.has(targetUserId)) {
            peerConnections.current.get(targetUserId)?.close();
            peerConnections.current.delete(targetUserId);
          }
          // Recreate the connection
          setTimeout(() => {
            initiateWebRTCConnection(targetUserId);
          }, 500);
        }
      });
    }

    pc.oniceconnectionstatechange = () => {
      console.log(`🧊 ICE connection state with ${targetUserId}:`, pc.iceConnectionState)

      // Handle ICE connection failures
      if (pc.iceConnectionState === "failed") {
        console.log("🔄 ICE connection failed, attempting to recover...")
        pc.restartIce()
      } else if (pc.iceConnectionState === "disconnected") {
        console.log("🔄 ICE connection disconnected, attempting to recover...")
        setTimeout(() => {
          if (pc.iceConnectionState === "disconnected") {
            pc.restartIce()
          }
        }, 3000)
      }
    }

    // Set polite/impolite for this peer
    politeMap.current.set(targetUserId, isPolite(targetUserId))

    // Add local stream tracks only if they don't exist (ONLY ONCE, ONLY AUDIO)
    if (localStream && pc.getSenders().length === 0) {
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length > 0) {
        pc.addTrack(audioTracks[0], localStream);
        console.log('Added audio track to peer connection:', audioTracks[0]);
      } else {
        console.warn('No audio tracks found to add to peer connection');
      }
    }

    peerConnections.current.set(targetUserId, pc)
    return pc
  }

  // Enhanced handleWebRTCOffer for perfect negotiation
  const handleWebRTCOffer = async (fromUserId: string, offer: RTCSessionDescriptionInit) => {
    try {
      console.log("🤝 Received WebRTC offer from:", fromUserId)
      updatePeerState(fromUserId, "connecting")

      let pc = peerConnections.current.get(fromUserId)
      if (!pc) {
        pc = createPeerConnection(fromUserId)
      }

      // Polite/impolite logic
      const polite = politeMap.current.get(fromUserId) ?? isPolite(fromUserId)
      const offerCollision = offer.type === "offer" && (makingOffer.current || pc.signalingState !== "stable")
      ignoreOffer.current = !polite && offerCollision
      if (ignoreOffer.current) {
        console.log("⚠️ Ignoring offer due to collision and impolite role.")
        return
      }
      if (offerCollision) {
        await pc.setLocalDescription({ type: "rollback" })
      }

      // Modify the offer to ensure audio is properly configured
      if (offer.sdp) {
        offer.sdp = offer.sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; maxaveragebitrate=510000')
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      console.log("✅ Set remote description for offer from:", fromUserId)

      // Log local tracks before answer
      console.log('Local tracks before answer:', pc.getSenders().map(s => s.track && s.track.kind));
      const answer = await pc.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false
      })
      if (answer.sdp) {
        answer.sdp = answer.sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; maxaveragebitrate=510000')
      }
      await pc.setLocalDescription(answer)
      console.log("✅ Created and set local answer for:", fromUserId)

      if (socketRef.current) {
        socketRef.current.emit("webrtc-answer", {
          roomId,
          targetUserId: fromUserId,
          answer,
        })
        console.log("📤 Sent WebRTC answer to:", fromUserId)
      }
    } catch (error) {
      console.error("❌ Error handling WebRTC offer:", error)
      updatePeerState(fromUserId, "failed")
      setTimeout(() => {
        if (peerConnections.current.has(fromUserId)) {
          const pc = peerConnections.current.get(fromUserId)
          if (pc && pc.connectionState !== "connected") {
            console.log("🔄 Attempting to recover connection with:", fromUserId)
            pc.restartIce()
          }
        }
      }, 3000)
    }
  }

  const handleWebRTCAnswer = async (fromUserId: string, answer: RTCSessionDescriptionInit) => {
    try {
      console.log("🤝 Received WebRTC answer from:", fromUserId)
    const pc = peerConnections.current.get(fromUserId)

    if (pc) {
        if (pc.signalingState !== "stable") {
          // Modify the answer to ensure audio is properly configured
          if (answer.sdp) {
            answer.sdp = answer.sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; maxaveragebitrate=510000')
          }

          await pc.setRemoteDescription(new RTCSessionDescription(answer))
          console.log("✅ Set remote description for answer from:", fromUserId)
        } else {
          console.log("⚠️ Peer connection already stable, ignoring answer")
        }
      } else {
        console.error("❌ No peer connection found for:", fromUserId)
        updatePeerState(fromUserId, "failed")
      }
      } catch (error) {
        console.error("❌ Error handling WebRTC answer:", error)
        updatePeerState(fromUserId, "failed")
    }
  }

  const handleICECandidate = async (fromUserId: string, candidate: RTCIceCandidateInit) => {
    try {
      console.log("🧊 Received ICE candidate from:", fromUserId)
      const pc = peerConnections.current.get(fromUserId)

      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
        console.log("✅ Added ICE candidate for:", fromUserId)
      } else {
        console.log("⚠️ No remote description yet, queuing ICE candidate")
        // Queue the candidate if remote description isn't set yet
        if (!pc) {
          console.error("❌ No peer connection found for:", fromUserId)
          return
        }
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            pc.addIceCandidate(new RTCIceCandidate(candidate))
              .then(() => console.log("✅ Added queued ICE candidate for:", fromUserId))
              .catch(console.error)
          }
        }
      }
    } catch (error) {
      console.error("❌ Error handling ICE candidate:", error)
    }
  }

  // Audio utility functions
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

      // Clean up existing resources first
      cleanup()

      // More compatible audio constraints with fallback options
      const constraints = {
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          sampleRate: isMobile ? 22050 : 44100,
          channelCount: 1,
          latency: { ideal: 0 },
        },
      }

      // Try to get user media with progressive fallback
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (error) {
        console.log("⚠️ Failed with enhanced constraints, trying basic audio...")
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        } catch (fallbackError) {
          console.error("❌ Failed to get audio access:", fallbackError)
          throw new Error("Could not access microphone. Please check permissions and try again.")
        }
      }

      // Verify stream has audio tracks
      if (!stream.getAudioTracks().length) {
        throw new Error("No audio tracks found in stream")
      }

      setLocalStream(stream)

      // Create new audio context with error handling
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        audioContext.current = new AudioContextClass()

        // Wait for audio context to be ready
        if (audioContext.current.state === "suspended") {
          await audioContext.current.resume()
        }

        analyser.current = audioContext.current.createAnalyser()
        analyser.current.fftSize = 1024 // Increased for better accuracy
        analyser.current.smoothingTimeConstant = 0.3 // Reduced for more responsive level changes

        // Connect stream to analyser
        const source = audioContext.current.createMediaStreamSource(stream)
        source.connect(analyser.current)

        // Start monitoring microphone level with improved calculation
        if (micLevelTimer.current) {
          clearInterval(micLevelTimer.current)
        }

        micLevelTimer.current = setInterval(() => {
          if (analyser.current && audioContext.current?.state === "running") {
            const dataArray = new Uint8Array(analyser.current.frequencyBinCount)
            analyser.current.getByteFrequencyData(dataArray)

            // Calculate RMS (Root Mean Square) for better level representation
            let sum = 0
            for (let i = 0; i < dataArray.length; i++) {
              sum += (dataArray[i] / 255) ** 2
            }
            const rms = Math.sqrt(sum / dataArray.length)

            // Convert to percentage and apply some scaling for better visualization
            const level = Math.min(100, Math.round(rms * 200))
            setMicrophoneLevel(level)
          }
        }, 50) // Increased update frequency for smoother display

        console.log("✅ Voice chat started successfully")
      } catch (error) {
        console.error("❌ Error setting up audio context:", error)
        // Clean up stream if audio context setup fails
        stream.getTracks().forEach(track => track.stop())
        setLocalStream(null)
        throw error
      }
    } catch (error) {
      console.error("❌ Error starting voice chat:", error)
      setConnectionError(error instanceof Error ? error.message : "Failed to access microphone. Please check permissions.")
      // Ensure cleanup on error
      cleanup()
    }
  }

  // Enhanced WebRTC connection handling
  const initiateWebRTCConnection = async (targetUserId: string) => {
    try {
      if (!localStream) {
        console.error("❌ Cannot initiate WebRTC: No local stream")
        return
      }

      console.log("🤝 Initiating WebRTC connection to:", targetUserId)
      updatePeerState(targetUserId, "connecting")

      // Create new peer connection
      const pc = createPeerConnection(targetUserId)

      // Set a timeout for the connection attempt
      const connectionTimeout = setTimeout(() => {
        if (pc.connectionState !== "connected") {
          console.log("⚠️ Connection attempt timed out, retrying...")
          pc.close()
          peerConnections.current.delete(targetUserId)
          setTimeout(() => {
            if (localStream) {
              initiateWebRTCConnection(targetUserId)
            }
          }, 2000)
        }
      }, 10000) // 10 second timeout

      // Create and set local description with specific options
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
        iceRestart: true
      })

      // Modify the offer to ensure audio is properly configured
      if (offer.sdp) {
        offer.sdp = offer.sdp.replace('useinbandfec=1', 'useinbandfec=1; stereo=1; maxaveragebitrate=510000')
      }

      await pc.setLocalDescription(offer)
      console.log("✅ Created and set local offer for:", targetUserId)

      // Send offer
      if (socketRef.current) {
        socketRef.current.emit("webrtc-offer", {
                roomId,
          targetUserId,
          offer,
        })
        console.log("📤 Sent WebRTC offer to:", targetUserId)
      }

      // Clear timeout if connection is established
      pc.onconnectionstatechange = () => {
        console.log(`🔗 Connection state changed for ${targetUserId}:`, pc.connectionState)
        if (pc.connectionState === "connected") {
          clearTimeout(connectionTimeout)
          updatePeerState(targetUserId, "connected")
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          updatePeerState(targetUserId, "failed")
          // Try to recover
          setTimeout(() => {
            if (pc.connectionState !== "connected") {
              console.log("🔄 Attempting to recover connection with:", targetUserId)
              pc.restartIce()
            }
          }, 3000)
        }
      }

      // Add connection monitoring
      const checkConnection = setInterval(() => {
        if (pc.connectionState === "connected") {
          clearInterval(checkConnection)
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          clearInterval(checkConnection)
          console.log("🔄 Connection check failed, attempting recovery...")
          pc.restartIce()
        }
      }, 5000)

      // Clean up interval when connection is closed
      pc.addEventListener('close', () => {
        clearInterval(checkConnection)
      })

    } catch (error) {
      console.error("❌ Error creating WebRTC offer:", error)
      updatePeerState(targetUserId, "failed")
      // Retry connection after a delay
      setTimeout(() => {
        if (localStream) {
          initiateWebRTCConnection(targetUserId)
        }
      }, 5000) // 5 second delay before retry
    }
  }

  // Add connection state monitoring
  useEffect(() => {
    const checkConnections = () => {
      peerConnections.current.forEach((pc, userId) => {
        if (pc.connectionState === "connecting") {
          console.log(`⚠️ Connection still connecting for ${userId}, checking state...`)
          if (Date.now() - (peerStates.get(userId)?.lastAttempt || 0) > 15000) {
            console.log(`🔄 Connection attempt timeout for ${userId}, retrying...`)
            pc.close()
            peerConnections.current.delete(userId)
            if (localStream) {
              initiateWebRTCConnection(userId)
            }
          }
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          console.log(`🔄 Connection ${pc.connectionState} for ${userId}, attempting recovery...`)
          pc.restartIce()
        }
      })
    }

    const connectionCheckInterval = setInterval(checkConnections, 5000)
    return () => clearInterval(connectionCheckInterval)
  }, [localStream, peerStates])

  // Update the UI to show microphone level more clearly
  const renderMicrophoneLevel = (level: number) => {
    return (
      <div className="flex items-center gap-2">
        <span>Mic level:</span>
        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-100"
            style={{ width: `${level}%` }}
          />
        </div>
        <span className="text-xs">{level}%</span>
      </div>
    )
  }

  // Add error boundary for audio context
  useEffect(() => {
    const handleAudioContextError = (event: ErrorEvent) => {
      if (event.message.includes("AudioContext")) {
        console.error("AudioContext error:", event)
        cleanup()
      }
    }

    window.addEventListener("error", handleAudioContextError)
    return () => {
      window.removeEventListener("error", handleAudioContextError)
    }
  }, [cleanup])

  // Add audio context resume on user interaction
  useEffect(() => {
    const handleUserInteraction = async () => {
      if (audioContext.current && audioContext.current.state === "suspended") {
        try {
          await audioContext.current.resume()
          console.log("✅ Audio context resumed")
    } catch (error) {
          console.error("❌ Error resuming audio context:", error)
        }
      }
    }

    // Add event listeners for user interaction
    document.addEventListener("click", handleUserInteraction)
    document.addEventListener("touchstart", handleUserInteraction)
    document.addEventListener("keydown", handleUserInteraction)

    return () => {
      document.removeEventListener("click", handleUserInteraction)
      document.removeEventListener("touchstart", handleUserInteraction)
      document.removeEventListener("keydown", handleUserInteraction)
    }
  }, [])

  // Place this after all function definitions and before the return statement:
  useEffect(() => {
    if (localStream && users.length > 0) {
      const existingUsers = users.filter(user => user.userId !== userId)
      if (existingUsers.length > 0) {
        console.log(`🔄 Initializing connections with ${existingUsers.length} existing users...`)
        if (existingUsers[0]) {
          initiateWebRTCConnection(existingUsers[0].userId)
        }
        existingUsers.slice(1).forEach((user, index) => {
          setTimeout(() => {
    if (localStream) {
              initiateWebRTCConnection(user.userId)
            }
          }, (index + 1) * 1000)
        })
      }
    }
  }, [localStream, users, userId])

  // Restore stopRecording function
  const stopRecording = () => {
    isRecordingLocally.current = false;
    recordingStateRef.current = { isRecording: false, roomId: null };
    setIsProcessingRecording(true);
    stopRecordingTimer();

    if (socketRef.current && isConnected) {
      console.log("⏹️ Stopping recording for room:", roomId);

      // Stop the media recorder first
      if (mediaRecorder.current && mediaRecorder.current.state !== 'inactive') {
        mediaRecorder.current.stop();
      }

      // Then emit stop-recording event
      socketRef.current.emit("stop-recording", { roomId });

      // Reset the recording request flag
      hasRequestedRecording.current = false;
    } else {
      alert("❌ Not connected to server");
    }
  };

  // Restore missing function definitions for linter
  const toggleMute = () => {
    if (localStream) {
      const audioTracks = localStream.getAudioTracks()
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled
      })
      setIsMuted(!isMuted)
    }
  }

  // Add a function to start only the local MediaRecorder (without emitting to the server)
  const startLocalMediaRecorder = () => {
    if (!localStream) return;
    if (mediaRecorder.current) {
      try { mediaRecorder.current.stop(); } catch { }
    }
    chunkIndex.current = 0;
    let mimeType = '';
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/webm')) {
      mimeType = 'audio/webm';
    } else {
      mimeType = '';
    }
    isRecordingLocally.current = true;
    recordingStateRef.current = { isRecording: true, roomId };
    mediaRecorder.current = new MediaRecorder(localStream, { mimeType });
    mediaRecorder.current.ondataavailable = (event) => {
      if (!isRecordingLocally.current || !recordingStateRef.current.isRecording) return;
      if (event.data && event.data.size > 0) {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          if (result && typeof result !== 'string' && recordingStateRef.current.isRecording) {
            const base64data = btoa(String.fromCharCode(...new Uint8Array(result)));
            if (socketRef.current) {
              socketRef.current.emit('audio-chunk', {
                roomId,
                audioData: base64data,
                chunkIndex: chunkIndex.current++,
              });
            }
          }
        };
        reader.readAsArrayBuffer(event.data);
      }
    };
    mediaRecorder.current.start(500); // 0.5s chunks for smoother audio
  };

  // Update the recording-started event handler
  useEffect(() => {
    if (!socketRef.current) return;
    const socket = socketRef.current;
    const handler = (data: any) => {
      console.log("🎙️ Recording started notification:", data);
      setIsRecording(true);
      recordingStateRef.current = { isRecording: true, roomId };
      startRecordingTimer();
      // If this is an existing recording and we're not already recording locally
      if (data.isExistingRecording && !isRecordingLocally.current && localStream) {
        console.log("🎙️ Joining existing recording");
        startLocalMediaRecorder(); // Only start local, do NOT emit to server
      }
    };
    socket.on("recording-started", handler);
    return () => { socket.off("recording-started", handler); };
  }, [localStream, roomId]);

  // Update startRecording to only emit to server if not already recording
  const startRecording = () => {
    if (socketRef.current && isConnected && localStream) {
      setIsStartingRecording(true);
      console.log("🎙️ Starting recording for room:", roomId);
      // Only emit if not already recording
      if (!isRecordingLocally.current) {
        socketRef.current.emit("start-recording", { roomId });
      }
      startLocalMediaRecorder(); // Always start local MediaRecorder
    } else {
      alert("❌ Not connected to server or no local stream");
    }
  };

  // Initialize audio element
  useEffect(() => {
    if (lastRecordingUrl) {
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.onended = () => setIsPlaying(false);
        audioRef.current.onpause = () => setIsPlaying(false);
        audioRef.current.onplay = () => setIsPlaying(true);
      }
      audioRef.current.src = lastRecordingUrl;
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
    };
  }, [lastRecordingUrl]);

  const playLastRecording = () => {
    if (!audioRef.current || !lastRecordingUrl) return;

      if (isPlaying) {
      audioRef.current.pause();
      } else {
      audioRef.current.play().catch(error => {
        console.error("Error playing audio:", error);
        setIsPlaying(false);
      });
    }
  }

  const leaveRoom = () => {
    console.log("🚪 Leaving room:", roomId)

    if (socketRef.current) {
      socketRef.current.emit("leave-room", { roomId, userId })
    }

    // Clean up resources
    cleanup()

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

  // Add background processing capability
  useEffect(() => {
    let backgroundWorker: Worker | null = null;
    let isBackgroundActive = false;

    const startBackgroundProcessing = () => {
      if (typeof Worker !== 'undefined') {
        const workerCode = `
          let lastLevel = 0;
          let isActive = true;

          self.onmessage = function(e) {
            if (e.data === 'stop') {
              isActive = false;
              self.close();
            } else if (e.data === 'check') {
              self.postMessage({ type: 'heartbeat', level: lastLevel });
            }
          };

          // Keep the worker alive
          setInterval(() => {
            if (isActive) {
              self.postMessage({ type: 'heartbeat', level: lastLevel });
            }
          }, 1000);
        `;

        const blob = new Blob([workerCode], { type: 'application/javascript' });
        backgroundWorker = new Worker(URL.createObjectURL(blob));

        backgroundWorker.onmessage = (e) => {
          if (e.data.type === 'heartbeat' && localStream) {
            // Ensure audio context is running
            if (audioContext.current?.state === 'suspended') {
              audioContext.current.resume().catch(console.error);
            }
          }
        };

        isBackgroundActive = true;
      }
    };

    const stopBackgroundProcessing = () => {
      if (backgroundWorker) {
        backgroundWorker.postMessage('stop');
        backgroundWorker = null;
      }
      isBackgroundActive = false;
    };

    // Start background processing when component mounts
    startBackgroundProcessing();

    // Add beforeunload handler
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isBackgroundActive) {
        stopBackgroundProcessing();
        cleanup();
      }
    };

    // Add pagehide handler for mobile browsers
    const handlePageHide = () => {
      if (isBackgroundActive) {
        stopBackgroundProcessing();
        cleanup();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    // Periodic check to ensure audio context is running
    const checkInterval = setInterval(() => {
      if (audioContext.current && audioContext.current.state === "suspended") {
        audioContext.current.resume().catch(console.error);
      }
    }, 5000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      clearInterval(checkInterval);
      stopBackgroundProcessing();
    };
  }, [localStream, cleanup, handleVisibilityChange]);

  // Cleanup recording state on unmount
  useEffect(() => {
    return () => {
      if (isRecordingLocally.current) {
        stopRecording();
      }
      recordingStateRef.current = { isRecording: false, roomId: null };
    };
  }, []);

  // Update recording data handling
  useEffect(() => {
    if (recordingData?.audioData) {
      const playableUrl = createPlayableAudioUrl(
        recordingData.audioData,
        recordingData.mimeType
      );
      if (playableUrl) {
        setLastRecordingUrl(playableUrl);
        console.log("✅ Recording URL created successfully");
      }
    }
  }, [recordingData]);

  // Update the play button rendering
  const renderPlayButton = () => {
    if (!lastRecordingUrl) {
      if (isRequestingRecording) {
  return (
          <Button
            variant="outline"
            disabled
            className="flex items-center gap-2"
          >
            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            Loading...
          </Button>
        );
      }
      return null;
    }

    return (
      <Button
        onClick={playLastRecording}
        variant="outline"
        className="flex items-center gap-2 transition-all duration-400 ease-in-out transform hover:scale-105 hover:shadow-md active:scale-95"
      >
        {isPlaying ? (
          <Pause className="w-4 h-4 transition-all duration-400 ease-in-out" />
        ) : (
          <Play className="w-4 h-4 transition-all duration-400 ease-in-out" />
        )}
        {isPlaying ? "Pause" : "Play"}
      </Button>
    );
  };

  // Add cleanup for recording request timeout
  useEffect(() => {
    return () => {
      if (recordingRequestTimeout.current) {
        clearTimeout(recordingRequestTimeout.current);
      }
    };
  }, []);

  // Add state for latest mixed filename
  const [latestMixedFilename, setLatestMixedFilename] = useState<string | null>(null);

  // Update recording-stop-response to store the filename
  useEffect(() => {
    if (!socketRef.current) return;
    const socket = socketRef.current;
    const handler = (data: any) => {
      if (data.success && data.filename) {
        setLatestMixedFilename(data.filename);
      }
    };
    socket.on("recording-stop-response", handler);
    return () => { socket.off("recording-stop-response", handler); };
  }, []);

  // Add download handlers for webm and mp3
  const downloadMixedRecording = (format: 'webm' | 'mp3') => {
    if (!latestMixedFilename) return;
    const url = `${process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"}/api/recordings/${latestMixedFilename}?format=${format}`;
    window.open(url, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 transition-all duration-400 ease-in-out">
      <div className="max-w-4xl mx-auto transition-all duration-400 ease-in-out">
        <Card className="mb-6 transition-all duration-400 ease-in-out">
          <CardHeader>
            <CardTitle className="flex items-center justify-between transition-all duration-400 ease-in-out">
              <span className="flex items-center gap-2 transition-all duration-400 ease-in-out">
                Voice Chat Room: {roomId}
                {isMobile && <Smartphone className="w-4 h-4 transition-all duration-400 ease-in-out" />}
              </span>
              <div className="flex items-center gap-2 transition-all duration-400 ease-in-out">
                <Badge variant={isConnected ? "default" : "destructive"} className="transition-all duration-400 ease-in-out transform hover:scale-105">
                  {connectionStatus}
                </Badge>
                {isRecording && (
                  <Badge variant="destructive" className="animate-pulse transition-all duration-400 ease-in-out">
                    <Circle className="w-3 h-3 mr-1 fill-current transition-all duration-400 ease-in-out" />
                    {formatDuration(recordingDuration)}
                  </Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connectionError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 transition-all duration-400 ease-in-out hover:bg-red-100">
                <AlertTriangle className="w-4 h-4 text-red-500 transition-all duration-400 ease-in-out" />
                <span className="text-red-700 text-sm transition-all duration-400 ease-in-out">{connectionError}</span>
                {isMobile && (
                  <span className="text-red-600 text-xs ml-2 transition-all duration-400 ease-in-out">
                    (Mobile: Try HTTPS or check network connection)
                  </span>
                )}
              </div>
            )}

            <div className="flex gap-4 mb-4 flex-wrap transition-all duration-400 ease-in-out">
              {!localStream ? (
                <Button
                  onClick={startVoiceChat}
                  className="flex items-center gap-2 transition-all duration-400 ease-in-out transform hover:scale-105 hover:shadow-md active:scale-95"
                  disabled={!isConnected}
                >
                  <Mic className="w-4 h-4 transition-all duration-400 ease-in-out" />
                  Join Voice Chat
                </Button>
              ) : (
                <Button
                  onClick={toggleMute}
                  variant={isMuted ? "destructive" : "default"}
                  className="flex items-center gap-2 transition-all duration-400 ease-in-out transform hover:scale-105 hover:shadow-md active:scale-95"
                >
                  {isMuted ? <MicOff className="w-4 h-4 transition-all duration-400 ease-in-out" /> : <Mic className="w-4 h-4 transition-all duration-400 ease-in-out" />}
                  {isMuted ? "Unmute" : "Mute"}
                </Button>
              )}

              {localStream && isConnected && (
                <>
                  {!isRecording ? (
                    <Button
                      onClick={startRecording}
                      variant="outline"
                      className="flex items-center gap-2 transition-all duration-400 ease-in-out transform hover:scale-105 hover:shadow-md active:scale-95"
                      disabled={isStartingRecording}
                    >
                      {isStartingRecording ? (
                        <>
                          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin transition-all duration-400 ease-in-out" />
                          Starting...
                        </>
                      ) : (
                        <>
                          <Circle className="w-4 h-4 transition-all duration-400 ease-in-out" />
                      Start Recording
                        </>
                      )}
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={stopRecording}
                        variant="destructive"
                        className="flex items-center gap-2 transition-all duration-400 ease-in-out transform hover:scale-105 hover:shadow-md active:scale-95"
                        disabled={isProcessingRecording}
                      >
                        {isProcessingRecording ? (
                          <>
                            <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin transition-all duration-400 ease-in-out" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Square className="w-4 h-4 transition-all duration-400 ease-in-out" />
                            Stop Recording
                          </>
                        )}
                      </Button>
                    </>
                  )}
                </>
              )}

              {renderPlayButton()}

              <div className="flex gap-4 flex-wrap items-center mb-4">
                {/* Mute button */}
                {/* Start Recording button */}
                {/* Play button */}
                <Button
                  onClick={() => downloadMixedRecording('mp3')}
                  variant="outline"
                  className="flex items-center gap-2 transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-lg active:scale-95 active:bg-green-100 focus:ring-2 focus:ring-green-400"
                  style={{ minWidth: 180 }}
                  disabled={!latestMixedFilename}
                >
                  <span role="img" aria-label="mp3">🎶</span> Download MP3
                </Button>
                {/* Leave Room button */}
                <Button
                  onClick={leaveRoom}
                  variant="destructive"
                  className="flex items-center gap-2 transition-all duration-300 ease-in-out transform hover:scale-105 hover:shadow-lg active:scale-95"
                  style={{ minWidth: 140 }}
                >
                  <Square className="w-4 h-4" />
                Leave Room
              </Button>
              </div>
            </div>

            <div className="flex items-center gap-4 mb-4 text-sm flex-wrap transition-all duration-400 ease-in-out">
              <div className="flex items-center gap-2 transition-all duration-400 ease-in-out">
                <Users className="w-4 h-4 transition-all duration-400 ease-in-out" />
                <span>Users in room: {users.length + 1}</span>
              </div>
              {isRecording && (
                <div className="flex items-center gap-2 text-blue-600 transition-all duration-400 ease-in-out">
                  <span>• Chunks sent: {audioChunksSent}</span>
                  <span>• Confirmed: {audioChunksConfirmed}</span>
                </div>
              )}
              {localStream && renderMicrophoneLevel(microphoneLevel)}
              {!isConnected && <span className="text-red-500 transition-all duration-400 ease-in-out">(Connecting to server...)</span>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 transition-all duration-400 ease-in-out">
              <Card className="transition-all duration-400 ease-in-out hover:shadow-xl hover:scale-[1.02]">
                <CardContent className="p-4 text-center transition-all duration-400 ease-in-out">
                  <div className="w-16 h-16 bg-blue-500 rounded-full mx-auto mb-2 flex items-center justify-center text-white font-bold transition-all duration-400 ease-in-out hover:scale-110">
                    You
                  </div>
                  <p className="text-sm text-gray-600 transition-all duration-400 ease-in-out">
                    {!localStream ? "Not connected" : isMuted ? "Muted" : "Speaking"}
                  </p>
                  <p className="text-xs text-gray-500 mt-1 transition-all duration-400 ease-in-out">ID: {userId}</p>
                  {isMobile && <p className="text-xs text-blue-500 transition-all duration-400 ease-in-out">📱 Mobile</p>}
                  {localStream && (
                    <div className="mt-2 transition-all duration-400 ease-in-out">
                      <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden transition-all duration-400 ease-in-out">
                        <div
                          className="h-full bg-blue-500 transition-all duration-400 ease-in-out"
                          style={{ width: `${microphoneLevel}%` }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {users.map((user) => {
                const peerStatus = getPeerStatus(user.userId)
                return (
                  <Card key={user.userId} className="transition-all duration-400 ease-in-out hover:shadow-xl hover:scale-[1.02]">
                    <CardContent className="p-4 text-center transition-all duration-400 ease-in-out">
                      <div className="w-16 h-16 bg-green-500 rounded-full mx-auto mb-2 flex items-center justify-center text-white font-bold relative transition-all duration-400 ease-in-out hover:scale-110">
                        {user.userId.slice(0, 2).toUpperCase()}
                        <div className="absolute -top-1 -right-1 transition-all duration-400 ease-in-out">{getStatusIcon(peerStatus)}</div>
                      </div>
                      <p className="text-sm text-gray-600 capitalize transition-all duration-400 ease-in-out">{peerStatus}</p>
                      <p className="text-xs text-gray-500 mb-2 transition-all duration-400 ease-in-out">ID: {user.userId}</p>

                      {peerStatus === "connected" ? (
                        <div className="flex items-center justify-center gap-1 text-green-600 text-xs transition-all duration-400 ease-in-out">
                          <Volume2 className="w-3 h-3 transition-all duration-400 ease-in-out" />
                          <span>Audio Connected</span>
                        </div>
                      ) : peerStatus === "connecting" ? (
                        <div className="flex items-center justify-center gap-1 text-yellow-600 text-xs transition-all duration-400 ease-in-out">
                          <Wifi className="w-3 h-3 animate-pulse transition-all duration-400 ease-in-out" />
                          <span>Connecting...</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1 text-gray-600 text-xs transition-all duration-400 ease-in-out">
                          <VolumeX className="w-3 h-3 transition-all duration-400 ease-in-out" />
                          <span>Disconnected</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg transition-all duration-400 ease-in-out hover:shadow-md">
              <p className="text-sm text-blue-800 transition-all duration-400 ease-in-out">
                <strong>🎙️ Recording:</strong> Server captures all audio for download.
                <strong> 🔊 Voice Chat:</strong> Click "Connect Audio" to hear other users in real-time via WebRTC.
              </p>
              <p className="text-xs text-blue-600 mt-2 transition-all duration-400 ease-in-out">
                Server URL: {process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:3001"} • Chunks sent:{" "}
                {audioChunksSent} • Confirmed: {audioChunksConfirmed} • Connection: {isConnected ? "✅" : "❌"} •
                Device: {isMobile ? "📱 Mobile" : "💻 Desktop"}
              </p>
              {isMobile && (
                <p className="text-xs text-orange-600 mt-1 transition-all duration-400 ease-in-out">
                  📱 Mobile detected: Using optimized settings. For best results, use HTTPS and ensure microphone
                  permissions are granted.
                </p>
              )}

              <div className="mt-3 p-2 bg-white rounded border transition-all duration-400 ease-in-out hover:shadow-md">
                <p className="text-xs font-medium text-gray-700 mb-1 transition-all duration-400 ease-in-out">WebRTC Connection Status:</p>
                <div className="flex gap-2 text-xs transition-all duration-400 ease-in-out">
                  <span className="flex items-center gap-1 transition-all duration-400 ease-in-out hover:scale-105">
                    <Volume2 className="w-3 h-3 text-green-500 transition-all duration-400 ease-in-out" />
                    Connected
                  </span>
                  <span className="flex items-center gap-1 transition-all duration-400 ease-in-out hover:scale-105">
                    <Wifi className="w-3 h-3 text-yellow-500 transition-all duration-400 ease-in-out" />
                    Connecting
                  </span>
                  <span className="flex items-center gap-1 transition-all duration-400 ease-in-out hover:scale-105">
                    <VolumeX className="w-3 h-3 text-gray-400 transition-all duration-400 ease-in-out" />
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
