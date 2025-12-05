"use client"

import { Link, Link2Off as LinkOff, Loader2, RefreshCw, X } from "lucide-react"
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
  connectionStatus: "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing" | "reconnecting"
  isStreaming?: boolean
  isLocating?: boolean
  isLocatingTarget?: boolean
  isReconnecting?: boolean
  isDisconnecting?: boolean
  reconnectAttempts?: number
  disabled?: boolean
  onToggleConnection?: () => void
  onCancelReconnect?: () => void
}

export function DeviceCard({
  name,
  batteryPercentage,
  signalStrength,
  connectionStatus,
  isStreaming = false,
  isLocating = false,
  isLocatingTarget = false,
  isReconnecting = false,
  isDisconnecting = false,
  reconnectAttempts = 0,
  disabled = false,
  onToggleConnection,
  onCancelReconnect,
}: DeviceCardProps) {
  const isLn = name.includes("ln")

  // Background color based on state
  const getBgColor = () => {
    if (connectionStatus === "synchronizing") return "gradient-purple-card"
    if (connectionStatus === "reconnecting" || isReconnecting) return "gradient-orange-card"
    return isLn ? "gradient-blue-card" : "gradient-red-card"
  }

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
    const iconClass = "w-5 h-5"

    // Disconnecting in progress
    if (isDisconnecting) {
      return (
        <div className="animate-spin">
          <Loader2 className={iconClass} style={{ color: iconColor }} />
        </div>
      )
    }

    // Reconnecting state - RED spinner
    if (isReconnecting || connectionStatus === "reconnecting") {
      return (
        <div className="animate-spin">
          <RefreshCw className={iconClass} style={{ color: "#ef4444" }} />
        </div>
      )
    }

    // Connected
    if (connectionStatus === "connected") {
      return <LinkOff className={iconClass} style={{ color: iconColor }} />
    }

    // Disconnected
    if (connectionStatus === "disconnected") {
      return <Link className={iconClass} style={{ color: iconColor }} />
    }

    // Synchronizing - purple spinner
    if (connectionStatus === "synchronizing") {
      return (
        <div className="animate-spin">
          <RefreshCw className={iconClass} style={{ color: "#9333ea" }} />
        </div>
      )
    }

    // Connecting - spinner
    if (connectionStatus === "connecting") {
      return (
        <div className="animate-spin">
          <Loader2 className={iconClass} style={{ color: iconColor }} />
        </div>
      )
    }

    // Disabled
    return <LinkOff className={`${iconClass} opacity-30`} style={{ color: iconColor }} />
  }

  const getStatusText = () => {
    if (isDisconnecting) {
      return "Disconnecting..."
    }
    if (isReconnecting || connectionStatus === "reconnecting") {
      if (connectionStatus === "connecting") {
        return `Reconnecting... (${reconnectAttempts}/5)`
      }
      return `Connection Lost (${reconnectAttempts}/5)`
    }
    if (connectionStatus === "connected" && isStreaming) {
      return "Streaming"
    }
    if (connectionStatus === "connected") {
      return "Connected"
    }
    if (connectionStatus === "connecting") {
      return "Connecting..."
    }
    if (connectionStatus === "synchronizing") {
      return "Synchronizing Clock"
    }
    return "Available"
  }

  const getStatusColor = () => {
    if (connectionStatus === "disconnected") {
      return "#9CA3AF" // gray
    }
    if (connectionStatus === "synchronizing") {
      return "#9333ea" // purple
    }
    if (isReconnecting || connectionStatus === "reconnecting") {
      return "#ef4444" // red for reconnecting
    }
    if (connectionStatus === "connecting") {
      return isLn ? "#0080C0" : "#BF0000"
    }
    return isLn ? "#0080C0" : "#BF0000"
  }

  // Determine button content and action
  const renderButton = () => {
    const baseButtonClass = "hover:scale-110 active:scale-95 transition-transform cursor-pointer bg-white rounded-full px-3 py-2 flex items-center gap-2"
    const textColor = isLn ? "#0080C0" : "#BF0000"

    // Reconnecting - show cancel button
    if (isReconnecting || connectionStatus === "reconnecting") {
      return (
        <button
          onClick={onCancelReconnect || onToggleConnection}
          className={`${baseButtonClass} border-2 border-red-400`}
        >
          <div className="animate-spin">
            <RefreshCw className="w-5 h-5" style={{ color: "#ef4444" }} />
          </div>
          <X className="w-4 h-4" style={{ color: "#ef4444" }} />
          <span className="text-sm font-medium" style={{ color: "#ef4444" }}>
            Cancel
          </span>
        </button>
      )
    }

    // Connecting - show cancel button
    if (connectionStatus === "connecting") {
      return (
        <button
          onClick={onToggleConnection}
          className={baseButtonClass}
        >
          <div className="animate-spin">
            <Loader2 className="w-5 h-5" style={{ color: textColor }} />
          </div>
          <X className="w-4 h-4" style={{ color: textColor }} />
          <span className="text-sm font-medium" style={{ color: textColor }}>
            Cancel
          </span>
        </button>
      )
    }

    // Disconnecting - disabled button
    if (isDisconnecting) {
      return (
        <button
          disabled
          className={`${baseButtonClass} opacity-50 cursor-not-allowed`}
        >
          <ConnectionIcon />
          <span className="text-sm font-medium" style={{ color: textColor }}>
            Disconnecting
          </span>
        </button>
      )
    }

    // Synchronizing
    if (connectionStatus === "synchronizing") {
      return (
        <button
          disabled
          className={`${baseButtonClass} opacity-70 cursor-not-allowed`}
        >
          <ConnectionIcon />
          <span className="text-sm font-medium" style={{ color: "#9333ea" }}>
            Syncing
          </span>
        </button>
      )
    }

    // Default - connect/disconnect button
    return (
      <button
        onClick={onToggleConnection}
        disabled={connectionStatus === "disabled" || disabled}
        className={`${baseButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <ConnectionIcon />
        {connectionStatus === "disconnected" && (
          <span className="text-sm font-medium" style={{ color: textColor }}>
            Connect
          </span>
        )}
      </button>
    )
  }

  return (
    <TooltipProvider>
      <div className="flex items-center gap-3">
        <div
          className={`${getBgColor()} rounded-full px-4 py-2.5 flex items-center gap-3 w-[340px] transition-all ${
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
                {renderButton()}
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {isReconnecting || connectionStatus === "reconnecting"
                    ? "Cancel reconnection"
                    : connectionStatus === "connecting"
                    ? "Cancel connection"
                    : connectionStatus === "connected"
                    ? "Disconnect device"
                    : "Connect device"}
                </p>
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
