"use client"

import { Link, Link2Off as LinkOff, Loader2, RefreshCw } from "lucide-react"
import { useEffect, useState, memo } from "react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { LegAboveRightKnee } from "./leg-above-right-knee"
import { LegBelowRightKnee } from "./leg-below-right-knee"
import { LegAboveLeftKnee } from "./leg-above-left-knee"
import { LegBelowLeftKnee } from "./leg-below-left-knee"

const MsCounter = memo(() => {
  const [msCounter, setMsCounter] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setMsCounter((prev) => (prev + 50) % 1000)
    }, 50)
    return () => clearInterval(interval)
  }, [])

  return <span className="text-xs font-bold text-purple-600">{msCounter}ms</span>
})

MsCounter.displayName = "MsCounter"

interface DeviceCardProps {
  name: string
  batteryPercentage: number
  signalStrength: 1 | 2 | 3 | 4 // 1-4 bars
  connectionStatus: "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing"
  isStreaming?: boolean
  isLocating?: boolean
  isLocatingTarget?: boolean
  disabled?: boolean
  onToggleConnection?: () => void
}

export function DeviceCard({
  name,
  batteryPercentage,
  signalStrength,
  connectionStatus,
  isStreaming = false,
  isLocating = false,
  isLocatingTarget = false,
  disabled = false,
  onToggleConnection,
}: DeviceCardProps) {
  const isLn = name.includes("ln")
  const bgColor =
    connectionStatus === "synchronizing" ? "gradient-purple-card" : isLn ? "gradient-blue-card" : "gradient-red-card"

  const getDeviceSvg = () => {
    if (name.includes("rn_top")) {
      return <LegAboveRightKnee />
    } else if (name.includes("rn_bottom")) {
      return <LegBelowRightKnee />
    } else if (name.includes("ln_top")) {
      return <LegAboveLeftKnee />
    } else if (name.includes("ln_bottom")) {
      return <LegBelowLeftKnee />
    }
    return null
  }

  const SignalIcon = () => {
    const barColor = isLn ? "#0080C0" : "#BF0000"

    if (connectionStatus === "synchronizing") {
      return (
        <div className="flex items-center justify-center w-full h-full">
          <MsCounter />
        </div>
      )
    }

    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="14" width="3" height="8" rx="1" fill={signalStrength >= 1 ? barColor : "#D1D5DB"} />
        <rect x="7" y="10" width="3" height="12" rx="1" fill={signalStrength >= 2 ? barColor : "#D1D5DB"} />
        <rect x="12" y="6" width="3" height="16" rx="1" fill={signalStrength >= 3 ? barColor : "#D1D5DB"} />
        <rect x="17" y="2" width="3" height="20" rx="1" fill={signalStrength >= 4 ? barColor : "#D1D5DB"} />
      </svg>
    )
  }

  const ConnectionIcon = () => {
    const iconColor = isLn ? "#0080FF" : "#FF3535"

    if (connectionStatus === "connected") {
      return <LinkOff className="w-5 h-5" style={{ color: iconColor }} />
    } else if (connectionStatus === "disconnected") {
      return <Link className="w-5 h-5" style={{ color: iconColor }} />
    } else if (connectionStatus === "synchronizing") {
      return <RefreshCw className="w-5 h-5 animate-smooth-spin transform-gpu" style={{ color: "#9333ea" }} />
    } else if (connectionStatus === "connecting") {
      return <Loader2 className="w-5 h-5 animate-spin" style={{ color: iconColor }} />
    } else {
      return <LinkOff className="w-5 h-5 opacity-30" style={{ color: iconColor }} />
    }
  }

  const getStatusText = () => {
    if (connectionStatus === "connected" && isStreaming) {
      return "Streaming"
    } else if (connectionStatus === "connected") {
      return "Connected"
    } else if (connectionStatus === "connecting") {
      return "Connecting"
    } else if (connectionStatus === "synchronizing") {
      return "Synchronizing Clock"
    } else {
      return "Available"
    }
  }

  const getStatusColor = () => {
    if (connectionStatus === "disconnected") {
      return "#9CA3AF" // gray
    }
    if (connectionStatus === "synchronizing") {
      return "#9333ea" // purple
    }
    return isLn ? "#0080C0" : "#BF0000"
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-3">
        <div
          className={`${bgColor} rounded-full px-4 py-2.5 flex items-center gap-3 w-[340px] transition-all ${
            isLocating && !isLocatingTarget ? "grayscale" : ""
          } ${isLocatingTarget ? "animate-vibrate" : ""}`}
        >
          <div className="bg-white rounded-full w-10 h-10 flex items-center justify-center flex-shrink-0">
            <SignalIcon />
          </div>

          <div className="flex flex-col">
            <span className="font-medium text-tropx-dark text-sm">{name}</span>
            <span className="text-xs font-medium" style={{ color: getStatusColor() }}>
              {getStatusText()}
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {connectionStatus === "connected" && (
              <span className="font-bold text-lg" style={{ color: isLn ? "#0080C0" : "#BF0000" }}>
                {batteryPercentage}%
              </span>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleConnection}
                  disabled={connectionStatus === "disabled" || disabled}
                  className="hover:scale-110 active:scale-95 transition-transform disabled:cursor-not-allowed cursor-pointer bg-white rounded-full px-3 py-2 flex items-center gap-2 disabled:opacity-50"
                >
                  <ConnectionIcon />
                  {connectionStatus === "disconnected" && (
                    <span className="text-sm font-medium" style={{ color: isLn ? "#0080C0" : "#BF0000" }}>
                      Connect
                    </span>
                  )}
                  {connectionStatus === "connecting" && (
                    <span className="text-sm font-medium" style={{ color: isLn ? "#0080C0" : "#BF0000" }}>
                      Connecting
                    </span>
                  )}
                  {connectionStatus === "synchronizing" && (
                    <span className="text-sm font-medium" style={{ color: "#9333ea" }}>
                      Syncing
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{connectionStatus === "connected" ? "Disconnect device" : "Connect device"}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div
          className={`flex-shrink-0 transition-transform hover:scale-110 cursor-pointer group ${
            isLocating && !isLocatingTarget ? "grayscale" : ""
          } ${isLocatingTarget ? "animate-vibrate" : ""}`}
        >
          {getDeviceSvg()}
        </div>
      </div>
    </TooltipProvider>
  )
}
