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
  batteryPercentage: number | null
  signalStrength: 1 | 2 | 3 | 4 // 1-4 bars
  connectionStatus: "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing" | "reconnecting"
  isStreaming?: boolean
  isLocating?: boolean
  isLocatingTarget?: boolean
  isReconnecting?: boolean
  reconnectAttempts?: number
  disabled?: boolean
  onToggleConnection?: () => void
  onRemove?: () => void
  syncOffsetMs?: number
  syncDeviceTimestampMs?: number
  isSmallScreen?: boolean
  // Drag & drop (optional)
  draggable?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: (e: React.DragEvent) => void
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
  reconnectAttempts = 0,
  disabled = false,
  onToggleConnection,
  onRemove,
  syncOffsetMs,
  syncDeviceTimestampMs,
  isSmallScreen = false,
  draggable = false,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
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
    const iconSize = isSmallScreen ? 24 : 20

    if (connectionStatus === "synchronizing") {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full">
          {syncDeviceTimestampMs !== undefined && syncDeviceTimestampMs !== null ? (
            <>
              <span className={isSmallScreen ? "text-sm font-bold text-purple-600 leading-tight" : "text-xs font-bold text-purple-600 leading-tight"}>
                {String(Math.floor(syncDeviceTimestampMs)).slice(-4)}
              </span>
              <span className={isSmallScreen ? "text-[10px] font-medium text-purple-500 leading-tight" : "text-[8px] font-medium text-purple-500 leading-tight"}>
                ms
              </span>
            </>
          ) : (
            <MsCounter />
          )}
        </div>
      )
    }

    // Show signal strength for all devices (not just connected)
    return (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="14" width="3" height="8" rx="1" fill={signalStrength >= 1 ? barColor : "#D1D5DB"} />
        <rect x="7" y="10" width="3" height="12" rx="1" fill={signalStrength >= 2 ? barColor : "#D1D5DB"} />
        <rect x="12" y="6" width="3" height="16" rx="1" fill={signalStrength >= 3 ? barColor : "#D1D5DB"} />
        <rect x="17" y="2" width="3" height="20" rx="1" fill={signalStrength >= 4 ? barColor : "#D1D5DB"} />
      </svg>
    )
  }

  const ConnectionIcon = () => {
    const iconColor = isLn ? "#0080FF" : "#FF3535"
    const iconClass = isSmallScreen ? "w-6 h-6" : "w-5 h-5"

    if (isReconnecting || connectionStatus === "reconnecting") {
      // Reconnecting: Show spinning refresh icon
      return <RefreshCw className={`${iconClass} animate-spin transform-gpu`} style={{ color: "#ef4444" }} />
    } else if (connectionStatus === "connected") {
      // Connected: Show LinkOff icon - click to disconnect
      return <LinkOff className={iconClass} style={{ color: iconColor }} />
    } else if (connectionStatus === "disconnected") {
      // Disconnected/Available: Show Link icon - click to connect
      return <Link className={iconClass} style={{ color: iconColor }} />
    } else if (connectionStatus === "synchronizing") {
      return <RefreshCw className={`${iconClass} animate-smooth-spin transform-gpu`} style={{ color: "#9333ea" }} />
    } else if (connectionStatus === "connecting") {
      return <Loader2 className={`${iconClass} animate-spin`} style={{ color: iconColor }} />
    } else {
      // Disabled
      return <LinkOff className={`${iconClass} opacity-30`} style={{ color: iconColor }} />
    }
  }

  const getStatusText = () => {
    if (isReconnecting || connectionStatus === "reconnecting") {
      return `Unavailable - Searching... (${reconnectAttempts}/5)`
    } else if (connectionStatus === "connected" && isStreaming) {
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
    if (isReconnecting || connectionStatus === "reconnecting") {
      return "#ef4444" // red for reconnecting
    }
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
      <div
        className={`flex items-center ${isSmallScreen ? 'gap-2 w-full' : 'gap-3'} cursor-${draggable ? 'grab active:cursor-grabbing' : 'default'} transition-all duration-200 ease-out ${
          isDragging ? 'opacity-30 scale-95' : 'opacity-100 scale-100'
        }`}
        draggable={draggable && !disabled}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        aria-grabbed={isDragging}
        data-dragging={isDragging ? 'true' : 'false'}
        data-dragover={isDragOver ? 'true' : 'false'}
      >
        <div
          className={`${bgColor} rounded-full ${isSmallScreen ? 'px-6 py-5' : 'px-4 py-2.5'} flex items-center ${isSmallScreen ? 'gap-4' : 'gap-3'} ${isSmallScreen ? 'flex-1 min-w-0' : 'w-[340px]'} transition-all duration-200 ${
            isLocating && !isLocatingTarget ? 'grayscale' : ''
          } ${isLocatingTarget ? 'animate-vibrate' : ''} ${
            isDragOver ? 'ring-2 ring-offset-2 ring-purple-500 scale-[1.02]' : ''
          }`}
        >
          <div className={`bg-white rounded-full ${isSmallScreen ? 'w-16 h-16' : 'w-10 h-10'} flex items-center justify-center flex-shrink-0`}>
            <SignalIcon />
          </div>

          <div className="flex flex-col flex-1 min-w-0">
            <span className={`font-medium text-tropx-dark ${isSmallScreen ? 'text-lg truncate' : 'text-sm'}`}>{name}</span>
            <span className={`${isSmallScreen ? 'text-base' : 'text-xs'} font-medium`} style={{ color: getStatusColor() }}>
              {getStatusText()}
            </span>
          </div>

          <div className={`flex items-center ${isSmallScreen ? 'gap-2' : 'gap-2'} ml-auto flex-shrink-0`}>
            {/* Battery: On small screens, always reserve space (use opacity to hide) for consistent sizing */}
            {isSmallScreen ? (
              <span
                className={`font-bold text-2xl ${connectionStatus === "connected" && batteryPercentage !== null ? 'opacity-100' : 'opacity-0'}`}
                style={{ color: isLn ? "#0080C0" : "#BF0000", minWidth: '4rem' }}
                aria-hidden={connectionStatus !== "connected" || batteryPercentage === null}
              >
                {connectionStatus === "connected" && batteryPercentage !== null ? `${batteryPercentage}%` : '99%'}
              </span>
            ) : (
              /* Normal screens: only show when connected */
              connectionStatus === "connected" && batteryPercentage !== null && (
                <span className="font-bold text-lg" style={{ color: isLn ? "#0080C0" : "#BF0000" }}>
                  {batteryPercentage}%
                </span>
              )
            )}

            {/* Show REMOVE button when reconnecting */}
            {(isReconnecting || connectionStatus === "reconnecting") ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onRemove}
                    className={`hover:scale-110 active:scale-95 transition-transform cursor-pointer bg-white rounded-full ${isSmallScreen ? 'w-14 h-14' : 'px-3 py-2'} flex items-center justify-center gap-2`}
                  >
                    {isSmallScreen ? (
                      <X className="w-7 h-7" style={{ color: "#6b7280" }} />
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" style={{ color: "#6b7280" }} />
                        <X className="w-5 h-5" style={{ color: "#6b7280" }} />
                        <span className="text-sm font-medium" style={{ color: "#6b7280" }}>
                          Remove
                        </span>
                      </>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Stop reconnecting and remove device</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleConnection}
                    disabled={connectionStatus === "disabled" || disabled}
                    className={`hover:scale-110 active:scale-95 transition-transform disabled:cursor-not-allowed cursor-pointer bg-white rounded-full ${isSmallScreen ? 'w-14 h-14' : 'px-3 py-2'} flex items-center justify-center gap-2 disabled:opacity-50`}
                  >
                    <ConnectionIcon />
                    {/* Show text ONLY on normal screens */}
                    {!isSmallScreen && connectionStatus === "disconnected" && (
                      <span className="text-sm font-medium" style={{ color: isLn ? "#0080C0" : "#BF0000" }}>
                        Connect
                      </span>
                    )}
                    {!isSmallScreen && connectionStatus === "connecting" && (
                      <span className="text-sm font-medium" style={{ color: isLn ? "#0080C0" : "#BF0000" }}>
                        Connecting
                      </span>
                    )}
                    {!isSmallScreen && connectionStatus === "synchronizing" && (
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
            )}
          </div>
        </div>

        {/* ALWAYS show device SVG - make it bigger on small screens */}
        <div
          className={`flex-shrink-0 transition-transform hover:scale-110 cursor-pointer group ${
            isLocating && !isLocatingTarget ? 'grayscale' : ''
          } ${isLocatingTarget ? 'animate-vibrate' : ''} ${isSmallScreen ? 'scale-150' : 'scale-100'}`}
        >
          {getDeviceSvg()}
        </div>
      </div>
    </TooltipProvider>
  )
}
