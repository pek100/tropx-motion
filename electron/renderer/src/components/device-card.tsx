"use client"

import { Link, Link2Off as LinkOff, Loader2, RefreshCw, X, Trash2 } from "lucide-react"
import { useEffect, useState, memo } from "react"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { LegAboveRightKnee } from "./leg-above-right-knee"
import { LegBelowRightKnee } from "./leg-below-right-knee"
import { LegAboveLeftKnee } from "./leg-above-left-knee"
import { LegBelowLeftKnee } from "./leg-below-left-knee"
import { DeviceId } from "@/hooks/useDevices"
import { useUIProfile } from "@/lib/ui-profiles"

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
  deviceId: number
  batteryPercentage: number | null
  signalStrength: 1 | 2 | 3 | 4
  connectionStatus: "connected" | "disconnected" | "unavailable" | "connecting" | "synchronizing" | "reconnecting"
  isStreaming?: boolean
  isLocating?: boolean
  isLocatingTarget?: boolean
  isReconnecting?: boolean
  isDisconnecting?: boolean
  reconnectAttempts?: number
  disabled?: boolean
  onToggleConnection?: () => void
  onRemove?: () => void
  errorMessage?: string | null
  syncOffsetMs?: number
  syncProgressPercent?: number | null
  // Drag & drop
  draggable?: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  onDragEnd?: (e: React.DragEvent) => void
  // Touch drag
  onTouchStart?: (e: React.TouchEvent) => void
  onTouchMove?: (e: React.TouchEvent) => void
  onTouchEnd?: (e: React.TouchEvent) => void
}

export function DeviceCard({
  name,
  deviceId,
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
  onRemove,
  errorMessage,
  syncOffsetMs,
  syncProgressPercent,
  draggable = false,
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
}: DeviceCardProps) {
  const { profile } = useUIProfile()

  const isLeft = deviceId === DeviceId.LEFT_SHIN || deviceId === DeviceId.LEFT_THIGH
  const bgColor =
    connectionStatus === "unavailable" ? "gradient-gray-card" :
    connectionStatus === "synchronizing" ? "gradient-purple-card" :
    isLeft ? "gradient-blue-card" : "gradient-red-card"

  const getDeviceSvg = () => {
    switch (deviceId) {
      case DeviceId.LEFT_SHIN:
        return <LegBelowLeftKnee />
      case DeviceId.LEFT_THIGH:
        return <LegAboveLeftKnee />
      case DeviceId.RIGHT_SHIN:
        return <LegBelowRightKnee />
      case DeviceId.RIGHT_THIGH:
        return <LegAboveRightKnee />
      default:
        return null
    }
  }

  const formatSyncOffset = (offsetMs: number): string => {
    const sign = offsetMs >= 0 ? '+' : ''
    return `${sign}${offsetMs.toFixed(1)}ms`
  }

  const SignalIcon = () => {
    const barColor = isLeft ? "#0080C0" : "#BF0000"
    const iconSize = profile.sizing.iconSizeLg

    if (connectionStatus === "synchronizing") {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full">
          {syncProgressPercent !== undefined && syncProgressPercent !== null ? (
            <span className={`${profile.sizing.fontSize} font-bold text-purple-600 leading-tight`}>
              {syncProgressPercent}%
            </span>
          ) : (
            <MsCounter />
          )}
        </div>
      )
    }

    if (connectionStatus === "unavailable") {
      return (
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="14" width="3" height="8" rx="1" fill="#D1D5DB" />
          <rect x="7" y="10" width="3" height="12" rx="1" fill="#D1D5DB" />
          <rect x="12" y="6" width="3" height="16" rx="1" fill="#D1D5DB" />
          <rect x="17" y="2" width="3" height="20" rx="1" fill="#D1D5DB" />
        </svg>
      )
    }

    const signalSvg = (
      <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="14" width="3" height="8" rx="1" fill={signalStrength >= 1 ? barColor : "#D1D5DB"} />
        <rect x="7" y="10" width="3" height="12" rx="1" fill={signalStrength >= 2 ? barColor : "#D1D5DB"} />
        <rect x="12" y="6" width="3" height="16" rx="1" fill={signalStrength >= 3 ? barColor : "#D1D5DB"} />
        <rect x="17" y="2" width="3" height="20" rx="1" fill={signalStrength >= 4 ? barColor : "#D1D5DB"} />
      </svg>
    )

    if (connectionStatus === "connected" && syncOffsetMs !== undefined) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">{signalSvg}</div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Clock offset: {formatSyncOffset(syncOffsetMs)}</p>
          </TooltipContent>
        </Tooltip>
      )
    }

    return signalSvg
  }

  const ConnectionIcon = () => {
    const iconColor = isLeft ? "#0080FF" : "#FF3535"
    const iconClass = !profile.features.textLabels ? "w-6 h-6" : "w-5 h-5"

    if (isDisconnecting) {
      return <div className="animate-spin"><Loader2 className={iconClass} style={{ color: iconColor }} /></div>
    } else if (isReconnecting || connectionStatus === "reconnecting") {
      return <div className="animate-spin"><RefreshCw className={iconClass} style={{ color: "#ef4444" }} /></div>
    } else if (connectionStatus === "connected") {
      return <LinkOff className={iconClass} style={{ color: iconColor }} />
    } else if (connectionStatus === "disconnected") {
      return <Link className={iconClass} style={{ color: iconColor }} />
    } else if (connectionStatus === "synchronizing") {
      return <div className="animate-spin"><RefreshCw className={iconClass} style={{ color: "#9333ea" }} /></div>
    } else if (connectionStatus === "connecting") {
      return <div className="animate-spin"><Loader2 className={iconClass} style={{ color: iconColor }} /></div>
    } else if (connectionStatus === "unavailable") {
      return <LinkOff className={iconClass} style={{ color: "#9CA3AF" }} />
    } else {
      return <LinkOff className={`${iconClass} opacity-30`} style={{ color: iconColor }} />
    }
  }

  const getStatusText = () => {
    if (isDisconnecting) return "Disconnecting..."
    if (isReconnecting) {
      if (connectionStatus === "connecting") {
        return `Reconnecting... (${reconnectAttempts}/5)`
      }
      return `Connection Lost - Retrying... (${reconnectAttempts}/5)`
    } else if (connectionStatus === "connected" && isStreaming) {
      return "Streaming"
    } else if (connectionStatus === "connected") {
      return "Connected"
    } else if (connectionStatus === "connecting") {
      return "Connecting..."
    } else if (connectionStatus === "synchronizing") {
      return "Synchronizing Clock"
    } else if (connectionStatus === "unavailable") {
      return "Unavailable"
    } else {
      return "Available"
    }
  }

  const getStatusColor = () => {
    if (isReconnecting || connectionStatus === "reconnecting") return "#ef4444"
    if (connectionStatus === "disconnected") return "#9CA3AF"
    if (connectionStatus === "unavailable") return "#9CA3AF"
    if (connectionStatus === "synchronizing") return "#9333ea"
    return isLeft ? "#0080C0" : "#BF0000"
  }

  // Derive compact mode from profile
  const isCompact = !profile.features.textLabels

  return (
    <TooltipProvider>
      <div
        className={`device-card flex items-center w-full ${isCompact ? 'gap-0' : 'gap-3'} cursor-${draggable ? 'grab active:cursor-grabbing' : 'default'} transition-all duration-200 ease-out ${
          isDragging ? 'opacity-30 scale-95' : 'opacity-100 scale-100'
        }`}
        draggable={draggable && !disabled}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onTouchStart={draggable && !disabled ? onTouchStart : undefined}
        onTouchMove={draggable && !disabled ? onTouchMove : undefined}
        onTouchEnd={draggable && !disabled ? onTouchEnd : undefined}
        aria-grabbed={isDragging}
        data-dragging={isDragging ? 'true' : 'false'}
        data-dragover={isDragOver ? 'true' : 'false'}
      >
        <div
          className={`${bgColor} rounded-full ${isCompact ? 'px-2 py-2' : 'px-4 py-2.5'} flex items-center ${isCompact ? 'gap-2' : 'gap-3'} flex-1 min-w-0 transition-all duration-200 ${
            isLocating && !isLocatingTarget ? 'grayscale' : ''
          } ${isLocatingTarget ? 'animate-vibrate' : ''} ${
            isDragOver ? 'ring-2 ring-offset-2 ring-purple-500 scale-[1.02]' : ''
          }`}
        >
          <div className={`bg-white rounded-full ${profile.sizing.touchTarget} flex items-center justify-center flex-shrink-0`}>
            <SignalIcon />
          </div>

          <div className="flex flex-col flex-1 min-w-0">
            <span className={`font-medium text-tropx-dark ${isCompact ? 'text-base truncate' : 'text-sm'}`}>{name}</span>
            <span className={`${isCompact ? 'text-sm' : 'text-xs'} font-medium`} style={{ color: getStatusColor() }}>
              {getStatusText()}
            </span>
          </div>

          <div className={`flex items-center ${isCompact ? 'gap-1' : 'gap-2'} ml-auto flex-shrink-0`}>
            {connectionStatus === "connected" && batteryPercentage !== null && (
              <span
                className={`font-bold flex-shrink-0 ${isCompact ? 'text-base' : 'text-lg'}`}
                style={{ color: isLeft ? "#0080C0" : "#BF0000" }}
              >
                {batteryPercentage}%
              </span>
            )}

            {isReconnecting ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onRemove}
                    className={`cursor-pointer bg-white rounded-full ${isCompact ? 'w-11 h-11' : 'px-3 py-2'} flex items-center justify-center gap-2`}
                  >
                    {isCompact ? (
                      <X className="w-6 h-6" style={{ color: "#6b7280" }} />
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" style={{ color: "#6b7280" }} />
                        <X className="w-5 h-5" style={{ color: "#6b7280" }} />
                        <span className="text-sm font-medium" style={{ color: "#6b7280" }}>Cancel</span>
                      </>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>Cancel reconnection</p></TooltipContent>
              </Tooltip>
            ) : connectionStatus === "connecting" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleConnection}
                    className={`cursor-pointer bg-white rounded-full ${isCompact ? 'px-2 py-2' : 'px-3 py-2'} flex items-center justify-center gap-1`}
                  >
                    {isCompact ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" style={{ color: isLeft ? "#0080C0" : "#BF0000" }} />
                        <X className="w-5 h-5" style={{ color: isLeft ? "#0080C0" : "#BF0000" }} />
                      </>
                    ) : (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" style={{ color: isLeft ? "#0080C0" : "#BF0000" }} />
                        <X className="w-5 h-5" style={{ color: isLeft ? "#0080C0" : "#BF0000" }} />
                        <span className="text-sm font-medium" style={{ color: isLeft ? "#0080C0" : "#BF0000" }}>Cancel</span>
                      </>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>Cancel connection</p></TooltipContent>
              </Tooltip>
            ) : isDisconnecting ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    disabled
                    className={`cursor-not-allowed bg-white rounded-full ${isCompact ? 'w-11 h-11' : 'px-3 py-2'} flex items-center justify-center gap-2 opacity-50`}
                  >
                    <ConnectionIcon />
                    {!isCompact && (
                      <span className="text-sm font-medium" style={{ color: isLeft ? "#0080C0" : "#BF0000" }}>Disconnecting</span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent><p>Disconnecting device...</p></TooltipContent>
              </Tooltip>
            ) : connectionStatus === "unavailable" ? (
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={onToggleConnection}
                      disabled={disabled}
                      className={`cursor-pointer bg-white rounded-full ${isCompact ? 'w-10 h-10' : 'px-3 py-2'} flex items-center justify-center gap-1 hover:bg-gray-50 disabled:opacity-50`}
                    >
                      <RefreshCw className={isCompact ? "w-5 h-5" : "w-4 h-4"} style={{ color: "#6b7280" }} />
                      {!isCompact && <span className="text-sm font-medium" style={{ color: "#6b7280" }}>Retry</span>}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent><p>{errorMessage || "Retry connection"}</p></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={onRemove}
                      className={`cursor-pointer bg-white rounded-full ${isCompact ? 'w-10 h-10' : 'px-3 py-2'} flex items-center justify-center gap-1 hover:bg-red-50`}
                    >
                      <Trash2 className={isCompact ? "w-5 h-5" : "w-4 h-4"} style={{ color: "#ef4444" }} />
                      {!isCompact && <span className="text-sm font-medium" style={{ color: "#ef4444" }}>Clear</span>}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent><p>Remove device from list</p></TooltipContent>
                </Tooltip>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleConnection}
                    disabled={disabled}
                    className={`disabled:cursor-not-allowed cursor-pointer bg-white rounded-full ${isCompact ? 'w-11 h-11' : 'px-3 py-2'} flex items-center justify-center gap-2 disabled:opacity-50`}
                  >
                    <ConnectionIcon />
                    {!isCompact && connectionStatus === "disconnected" && (
                      <span className="text-sm font-medium" style={{ color: isLeft ? "#0080C0" : "#BF0000" }}>Connect</span>
                    )}
                    {!isCompact && connectionStatus === "synchronizing" && (
                      <span className="text-sm font-medium" style={{ color: "#9333ea" }}>Syncing</span>
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

        <div
          className={`cursor-pointer group ${isCompact ? 'mx-2' : 'mx-3'} ${
            isLocating && !isLocatingTarget ? 'grayscale' : ''
          } ${isLocatingTarget ? 'animate-vibrate' : ''} ${isCompact ? 'scale-130' : 'scale-100'}`}
        >
          {getDeviceSvg()}
        </div>
      </div>
    </TooltipProvider>
  )
}
