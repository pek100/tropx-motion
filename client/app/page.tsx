"use client"

import { DeviceCard } from "@/components/device-card"
import { ChartSvg } from "@/components/chart-svg"
import KneeAreaChart from "@/components/knee-area-chart"
import { useState, useRef, useEffect } from "react"
import { useToast } from "@/hooks/use-toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export default function Page() {
  const { toast } = useToast()
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const locateDelayTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const [devices, setDevices] = useState([
    {
      name: "tropx_rn_top",
      signalStrength: 4 as 1 | 2 | 3 | 4,
      batteryPercentage: 99,
      connectionStatus: "connected" as "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing",
    },
    {
      name: "tropx_rn_bottom",
      signalStrength: 4 as 1 | 2 | 3 | 4,
      batteryPercentage: 98,
      connectionStatus: "connected" as "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing",
    },
    {
      name: "tropx_ln_top",
      signalStrength: 3 as 1 | 2 | 3 | 4,
      batteryPercentage: 85,
      connectionStatus: "disconnected" as "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing",
    },
    {
      name: "tropx_ln_bottom",
      signalStrength: 2 as 1 | 2 | 3 | 4,
      batteryPercentage: 72,
      connectionStatus: "disconnected" as "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing",
    },
  ])

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [hasStartedStreaming, setHasStartedStreaming] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [locatingTargetIndex, setLocatingTargetIndex] = useState<number | null>(null)

  const [streamStartTime, setStreamStartTime] = useState<number | null>(null)
  const [streamElapsedTime, setStreamElapsedTime] = useState(0)
  const [clearChartTrigger, setClearChartTrigger] = useState(0)
  const [isTimerHovered, setIsTimerHovered] = useState(false)

  const prevLeftAngle = useRef(0)
  const prevRightAngle = useRef(0)
  const prevLeftVelocity = useRef(0)
  const prevRightVelocity = useRef(0)
  const prevTimestamp = useRef(Date.now())

  useEffect(() => {
    if (!isStreaming || streamStartTime === null) {
      return
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - streamStartTime) / 1000)
      setStreamElapsedTime(elapsed)
    }, 1000)

    return () => clearInterval(interval)
  }, [isStreaming, streamStartTime])

  useEffect(() => {
    if (!isStreaming) return

    const interval = setInterval(() => {
      const time = Date.now()
      const dt = (time - prevTimestamp.current) / 1000 // Time delta in seconds

      // Simulate realistic knee angle movements (0-180 degrees)
      const leftAngle = 45 + Math.sin(time / 1000) * 30 + Math.random() * 10
      const rightAngle = 50 + Math.cos(time / 1200) * 35 + Math.random() * 10

      const leftVelocity = (leftAngle - prevLeftAngle.current) / dt
      const rightVelocity = (rightAngle - prevRightAngle.current) / dt

      const leftAcceleration = (leftVelocity - prevLeftVelocity.current) / dt
      const rightAcceleration = (rightVelocity - prevRightVelocity.current) / dt

      const leftQuality = Math.max(0, 100 - Math.abs(leftAcceleration) * 2)
      const rightQuality = Math.max(0, 100 - Math.abs(rightAcceleration) * 2)

      setLeftKneeData({
        current: leftAngle,
        sensorTimestamp: time,
        velocity: leftVelocity,
        acceleration: leftAcceleration,
        quality: leftQuality,
      })

      setRightKneeData({
        current: rightAngle,
        sensorTimestamp: time,
        velocity: rightVelocity,
        acceleration: rightAcceleration,
        quality: rightQuality,
      })

      prevLeftAngle.current = leftAngle
      prevRightAngle.current = rightAngle
      prevLeftVelocity.current = leftVelocity
      prevRightVelocity.current = rightVelocity
      prevTimestamp.current = time
    }, 100) // Update every 100ms for smooth animation

    return () => clearInterval(interval)
  }, [isStreaming])

  const allDevicesConnected = devices.every((device) => device.connectionStatus === "connected")

  const connectedDevicesCount = devices.filter((device) => device.connectionStatus === "connected").length

  const validateStreaming = () => {
    const connectedDevices = devices.filter((device) => device.connectionStatus === "connected")

    const leftDevices = connectedDevices.filter((device) => device.name.includes("_ln_"))
    const rightDevices = connectedDevices.filter((device) => device.name.includes("_rn_"))

    return leftDevices.length >= 2 || rightDevices.length >= 2
  }

  const handleToggleConnection = (index: number) => {
    if (isLocating || devices.some((d) => d.connectionStatus === "synchronizing")) return

    setDevices((prevDevices) =>
      prevDevices.map((device, i) => {
        if (i === index) {
          if (device.connectionStatus === "connected") {
            return { ...device, connectionStatus: "disconnected" as const }
          } else if (device.connectionStatus === "disconnected") {
            setTimeout(() => {
              setDevices((prev) =>
                prev.map((d, idx) => (idx === index ? { ...d, connectionStatus: "synchronizing" as const } : d)),
              )
              setTimeout(() => {
                setDevices((prev) =>
                  prev.map((d, idx) => (idx === index ? { ...d, connectionStatus: "connected" as const } : d)),
                )
              }, 1500)
            }, 1000)
            return { ...device, connectionStatus: "connecting" as const }
          }
        }
        return device
      }),
    )
  }

  const handleConnectAll = () => {
    if (isLocating || devices.some((d) => d.connectionStatus === "synchronizing")) return

    setDevices((prevDevices) =>
      prevDevices.map((device) => ({
        ...device,
        connectionStatus: "connecting" as const,
      })),
    )

    setTimeout(() => {
      setDevices((prevDevices) =>
        prevDevices.map((device) => ({
          ...device,
          connectionStatus: "synchronizing" as const,
        })),
      )

      setTimeout(() => {
        setDevices((prevDevices) =>
          prevDevices.map((device) => ({
            ...device,
            connectionStatus: "connected" as const,
          })),
        )
      }, 1500)
    }, 1000)
  }

  const handleDisconnectAll = () => {
    if (isLocating || devices.some((d) => d.connectionStatus === "synchronizing")) return

    setDevices((prevDevices) =>
      prevDevices.map((device) => ({
        ...device,
        connectionStatus: "disconnected" as "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing",
      })),
    )
  }

  const handleRefresh = () => {
    if (isLocating || devices.some((d) => d.connectionStatus === "synchronizing")) return

    if (isRefreshing) {
      // Manual stop - clear the timeout
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current)
        refreshTimeoutRef.current = null
      }
      setIsRefreshing(false)
    } else {
      // Start refresh with 5 second auto-exit
      setIsRefreshing(true)
      refreshTimeoutRef.current = setTimeout(() => {
        setIsRefreshing(false)
        refreshTimeoutRef.current = null
      }, 5000)
    }
  }

  const handleSync = () => {
    if (isLocating) return

    setDevices((prevDevices) =>
      prevDevices.map((device) => {
        if (device.connectionStatus === "connected") {
          return { ...device, connectionStatus: "synchronizing" as const }
        }
        return device
      }),
    )

    setTimeout(() => {
      setDevices((prevDevices) =>
        prevDevices.map((device) => {
          if (device.connectionStatus === "synchronizing") {
            return { ...device, connectionStatus: "connected" as const }
          }
          return device
        }),
      )
    }, 2000)
  }

  const handleLocate = () => {
    if (devices.some((d) => d.connectionStatus === "synchronizing")) return

    // If already locating, stop it
    if (isLocating) {
      if (locateDelayTimeoutRef.current) {
        clearTimeout(locateDelayTimeoutRef.current)
        locateDelayTimeoutRef.current = null
      }
      setIsLocating(false)
      setLocatingTargetIndex(null)
      return
    }

    // Otherwise, start locating
    const connectedIndices = devices
      .map((device, index) => (device.connectionStatus === "connected" ? index : -1))
      .filter((index) => index !== -1)

    if (connectedIndices.length === 0) {
      toast({
        title: "No Connected Devices",
        description: "Please connect at least one device to use the locate feature.",
        variant: "destructive",
        duration: 4000,
      })
      return
    }

    setIsLocating(true)
    setLocatingTargetIndex(null) // No device shaking yet

    locateDelayTimeoutRef.current = setTimeout(() => {
      const randomIndex = connectedIndices[Math.floor(Math.random() * connectedIndices.length)]
      setLocatingTargetIndex(randomIndex)
      locateDelayTimeoutRef.current = null
    }, 1500)
  }

  const handleToggleStreaming = () => {
    if (isLocating || devices.some((d) => d.connectionStatus === "synchronizing")) return

    if (!isStreaming && !validateStreaming()) {
      toast({
        title: "Cannot Start Streaming",
        description:
          "Please connect at least 2 devices of the same joint type (left or right knee) to start streaming.",
        variant: "destructive",
        duration: 4000,
      })

      setIsFlashing(true)
      setTimeout(() => setIsFlashing(false), 1000)

      return
    }

    if (!isStreaming) {
      setHasStartedStreaming(true)
      setStreamStartTime(Date.now())
      setStreamElapsedTime(0)
      setClearChartTrigger((prev) => prev + 1)
    }
    setIsStreaming(!isStreaming)
  }

  const handleClearChart = () => {
    if (isStreaming) {
      // If streaming, just clear the data and continue streaming
      setClearChartTrigger((prev) => prev + 1)
      setStreamStartTime(Date.now())
      setStreamElapsedTime(0)
    } else {
      // If not streaming, revert to SVG chart view
      setHasStartedStreaming(false)
      setStreamStartTime(null)
      setStreamElapsedTime(0)
    }
  }

  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  const getFillStyle = () => {
    if (connectedDevicesCount === 0) {
      return {
        backgroundColor: "rgba(255, 255, 255, 0.3)",
      }
    }

    if (connectedDevicesCount === 1) {
      return {
        backgroundColor: "rgba(255, 77, 53, 0.15)",
      }
    }

    if (connectedDevicesCount === 2) {
      return {
        backgroundColor: "rgba(255, 77, 53, 0.3)",
      }
    }

    if (connectedDevicesCount === 3) {
      return {
        backgroundColor: "rgba(255, 77, 53, 0.6)",
      }
    }

    if (connectedDevicesCount === 4) {
      return {
        backgroundColor: "rgba(255, 77, 53, 1)",
        color: "white",
      }
    }

    return {}
  }

  const [leftKneeData, setLeftKneeData] = useState({
    current: 0,
    sensorTimestamp: Date.now(),
    velocity: 0,
    acceleration: 0,
    quality: 100,
  })
  const [rightKneeData, setRightKneeData] = useState({
    current: 0,
    sensorTimestamp: Date.now(),
    velocity: 0,
    acceleration: 0,
    quality: 100,
  })

  return (
    <TooltipProvider delayDuration={1500}>
      <div className="min-h-screen bg-[#fff6f3] flex flex-col">
        <header className="p-8 pb-0">
          <div className="flex items-start gap-3 mb-2">
            {/* Logo SVG */}
            <svg
              width="40"
              height="40"
              viewBox="0 0 1024 1024"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="flex-shrink-0 mt-1"
            >
              <path
                d="M536.573 188.5C480.508 217.268 427.514 275.625 441.339 293.707C458.235 315.077 528.125 283.844 583.423 229.597C645.632 167.952 620.288 146.582 536.573 188.5Z"
                fill="var(--tropx-vibrant)"
              />
              <path
                d="M753.405 396.365C627.93 499.319 494.412 599.86 487.977 595.838C484.76 594.229 480.738 549.187 478.325 497.71C471.89 367.409 452.587 326.388 397.892 326.388C348.828 326.388 279.656 410.038 191.985 575.73C116.378 718.9 98.6828 808.18 138.899 840.353C150.964 850.005 167.051 857.244 175.898 857.244C199.224 857.244 260.352 823.462 326.307 773.594L385.023 729.356L406.74 771.181C452.587 862.874 525.78 873.331 658.494 807.376C699.515 786.463 771.904 739.812 818.555 702.813C899.792 640.076 986.66 563.665 986.66 555.622C986.66 553.209 960.117 570.099 927.14 591.816C817.751 665.814 673.777 728.552 615.061 728.552C583.692 728.552 534.628 701.205 515.324 673.053L496.02 644.098L537.845 607.903C675.385 490.471 853.141 327.193 848.315 322.367C847.511 320.758 804.078 353.736 753.405 396.365ZM389.849 566.882C396.284 603.077 398.697 637.663 396.284 644.098C393.871 650.532 375.371 664.206 355.263 673.858C321.481 690.748 316.655 690.748 296.547 679.488C265.983 662.597 262.765 616.75 289.308 576.534C316.655 535.513 359.285 493.688 370.545 497.71C375.371 499.319 384.219 529.883 389.849 566.882Z"
                fill="var(--tropx-vibrant)"
              />
            </svg>

            <div>
              <h1 className="text-3xl font-semibold leading-tight">
                <span style={{ color: "var(--tropx-dark)" }} className="italic">
                  TropX
                </span>
              </h1>

              {/* Subtitle */}
              <p className="text-sm" style={{ color: "var(--tropx-shadow)" }}>
                Research Suite
              </p>
            </div>
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center px-8 relative">
          <div className="flex gap-6 w-[90%]">
            {/* Left Pane */}
            <div
              className={`flex-shrink-0 w-[500px] bg-white p-6 flex flex-col transition-all ${
                isFlashing ? "flash-pane" : ""
              }`}
              style={{
                border: "1px solid #e5e5e5",
                borderRadius: "36px",
                height: "500px",
              }}
            >
              <div className="flex justify-between mb-4">
                <div className="flex gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleLocate}
                        disabled={devices.some((d) => d.connectionStatus === "synchronizing")}
                        className="px-4 py-2 text-sm rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"
                        style={{
                          backgroundColor: isLocating ? "rgba(75, 175, 39, 0.15)" : "rgba(255, 255, 255, 0.5)",
                          color: isLocating ? "#4baf27" : "var(--tropx-shadow)",
                          transition: "all 0.3s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!isLocating && !devices.some((d) => d.connectionStatus === "synchronizing")) {
                            e.currentTarget.style.backgroundColor = "rgba(75, 175, 39, 0.15)"
                            e.currentTarget.style.color = "#4baf27"
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isLocating && !devices.some((d) => d.connectionStatus === "synchronizing")) {
                            e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.5)"
                            e.currentTarget.style.color = "var(--tropx-shadow)"
                          }
                        }}
                        aria-label="Locate"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                          <path
                            d="M12 2v4M12 18v4M2 12h4M18 12h4"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                        {isLocating ? "Stop Locating" : "Locate"}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Shake a device to locate it</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleSync}
                        disabled={isLocating}
                        className="px-4 py-2 text-sm rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md text-tropx-shadow hover:text-purple-600 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"
                        style={{
                          backgroundColor: "rgba(255, 255, 255, 0.5)",
                          transition: "all 0.3s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!isLocating) {
                            e.currentTarget.style.backgroundColor = "rgba(168, 85, 247, 0.15)"
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isLocating) {
                            e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.5)"
                          }
                        }}
                        aria-label="Sync"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path
                            d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.8273 3 17.35 4.30367 19 6.34267"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                          <path
                            d="M19 3V6.5H15.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Sync
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Synchronize clocks between devices</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleRefresh}
                      disabled={isLocating || devices.some((d) => d.connectionStatus === "synchronizing")}
                      className="p-2 rounded-full transition-all cursor-pointer backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"
                      style={{
                        backgroundColor: isRefreshing ? "rgba(255, 77, 53, 0.15)" : "rgba(255, 255, 255, 0.5)",
                        transition: "all 0.3s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (
                          !isLocating &&
                          !devices.some((d) => d.connectionStatus === "synchronizing") &&
                          !isRefreshing
                        ) {
                          e.currentTarget.style.backgroundColor = "rgba(255, 77, 53, 0.15)"
                          const svg = e.currentTarget.querySelector("svg")
                          if (svg) svg.style.color = "var(--tropx-vibrant)"
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (
                          !isLocating &&
                          !devices.some((d) => d.connectionStatus === "synchronizing") &&
                          !isRefreshing
                        ) {
                          e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.5)"
                          const svg = e.currentTarget.querySelector("svg")
                          if (svg) svg.style.color = "var(--tropx-shadow)"
                        }
                      }}
                      aria-label="Refresh"
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                        className={`transition-transform ${isRefreshing ? "animate-spin" : ""}`}
                        style={{
                          color: isRefreshing ? "var(--tropx-vibrant)" : "var(--tropx-shadow)",
                          transition: "color 0.3s ease",
                        }}
                      >
                        <path
                          d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.8273 3 17.35 4.30367 19 6.34267"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <path
                          d="M19 3V6.5H15.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Rescan bluetooth devices</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Scrollable Container for Device Cards */}
              <div className="overflow-y-auto overflow-x-hidden flex flex-col items-center gap-4 py-3 px-8 min-h-0 relative">
                {isRefreshing && (
                  <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
                    <div className="visor-scan" />
                  </div>
                )}

                {isLocating && locatingTargetIndex === null && (
                  <>
                    <div className="absolute inset-0 locate-overlay-light z-20 pointer-events-none rounded-xl" />
                    <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                      <div
                        className="py-3 px-6 rounded-full backdrop-blur-md border border-white/30"
                        style={{
                          backgroundColor: "rgba(75, 175, 39, 0.15)",
                          color: "#4baf27",
                          border: "1px solid #4baf27",
                        }}
                      >
                        <p className="text-sm whitespace-nowrap">Shake a device to locate</p>
                      </div>
                    </div>
                  </>
                )}

                {devices.map((device, index) => (
                  <DeviceCard
                    key={device.name}
                    name={device.name}
                    signalStrength={device.signalStrength}
                    batteryPercentage={device.batteryPercentage}
                    connectionStatus={device.connectionStatus}
                    isStreaming={isStreaming}
                    isLocating={isLocating}
                    isLocatingTarget={isLocating && locatingTargetIndex === index}
                    disabled={isLocating || devices.some((d) => d.connectionStatus === "synchronizing")}
                    onToggleConnection={() => handleToggleConnection(index)}
                  />
                ))}
              </div>

              {/* Connect All and Disconnect All Buttons */}
              <div className="flex gap-3 mt-6">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleDisconnectAll}
                      disabled={isLocating || devices.some((d) => d.connectionStatus === "synchronizing")}
                      className="flex-1 py-2 px-4 text-sm rounded-full border-2 border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"
                    >
                      Disconnect All
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Disconnect all connected devices</p>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleConnectAll}
                      disabled={isLocating || devices.some((d) => d.connectionStatus === "synchronizing")}
                      className={`flex-1 py-2 px-4 text-sm rounded-full font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99] ${
                        allDevicesConnected
                          ? "border-2 bg-transparent hover:bg-white/50"
                          : "text-white hover:opacity-90"
                      }`}
                      style={
                        allDevicesConnected
                          ? { borderColor: "var(--tropx-vibrant)", color: "var(--tropx-vibrant)" }
                          : { backgroundColor: "var(--tropx-vibrant)" }
                      }
                    >
                      Connect All
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Connect all available devices</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Right Pane */}
            <div
              className="flex-1 bg-white p-6 gradient-diagonal flex flex-col items-center justify-center"
              style={{
                border: "1px solid #e5e5e5",
                borderRadius: "36px",
                height: "500px",
              }}
            >
              {isStreaming || hasStartedStreaming ? (
                <KneeAreaChart leftKnee={leftKneeData} rightKnee={rightKneeData} clearTrigger={clearChartTrigger} />
              ) : (
                <ChartSvg />
              )}

              <div className="mt-8 flex items-center gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleToggleStreaming}
                      disabled={isLocating || devices.some((d) => d.connectionStatus === "synchronizing")}
                      className="px-6 py-3 text-base rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md border border-white/50 hover:border-white/60 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"
                      style={getFillStyle()}
                    >
                      {isStreaming ? (
                        <>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <rect x="3" y="3" width="4" height="10" rx="1" fill="currentColor" />
                            <rect x="9" y="3" width="4" height="10" rx="1" fill="currentColor" />
                          </svg>
                          Stop Streaming
                        </>
                      ) : (
                        <>
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path d="M4 2L13 8L4 14V2Z" fill="currentColor" />
                          </svg>
                          Start Streaming
                        </>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Stream joint angle data from connected devices</p>
                  </TooltipContent>
                </Tooltip>

                {hasStartedStreaming && streamStartTime !== null && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleClearChart}
                        onMouseEnter={() => setIsTimerHovered(true)}
                        onMouseLeave={() => setIsTimerHovered(false)}
                        className="px-4 py-3 rounded-full font-medium flex items-center gap-2 backdrop-blur-md border transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.99]"
                        style={{
                          backgroundColor: isTimerHovered ? "rgba(239, 68, 68, 0.15)" : "rgba(255, 255, 255, 0.5)",
                          color: isTimerHovered ? "#dc2626" : "var(--tropx-shadow)",
                          borderColor: isTimerHovered ? "#ef4444" : "rgba(255, 255, 255, 0.5)",
                          transition: "all 0.3s ease",
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                          <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        <span className="text-base">
                          {isTimerHovered ? "Clear" : formatElapsedTime(streamElapsedTime)}
                        </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {isStreaming ? "Clear chart data and restart timer" : "Clear chart and return to default view"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
