"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Mic, Users, Radio } from "lucide-react"

export default function Home() {
  const [roomId, setRoomId] = useState("")
  const router = useRouter()

  const joinRoom = () => {
    if (roomId.trim()) {
      router.push(`/room/${roomId.trim()}`)
    }
  }

  const createRoom = () => {
    const newRoomId = Math.random().toString(36).substr(2, 9)
    router.push(`/room/${newRoomId}`)
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 bg-blue-500 rounded-full mx-auto mb-4 flex items-center justify-center">
            <Radio className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl">Voice Chat App</CardTitle>
          <p className="text-gray-600">Join or create a voice chat room</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="roomId" className="text-sm font-medium">
              Room ID
            </label>
            <Input
              id="roomId"
              placeholder="Enter room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && joinRoom()}
            />
          </div>

          <Button onClick={joinRoom} className="w-full" disabled={!roomId.trim()}>
            <Users className="w-4 h-4 mr-2" />
            Join Room
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-500">Or</span>
            </div>
          </div>

          <Button onClick={createRoom} variant="outline" className="w-full">
            <Mic className="w-4 h-4 mr-2" />
            Create New Room
          </Button>

          <div className="text-xs text-gray-500 text-center space-y-1">
            <p>• Multiple users can join the same room</p>
            <p>• Voice chat with real-time communication</p>
            <p>• Server-side recording capability</p>
            <p>• Mute/unmute functionality</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
