import { DeviceCard } from "@/components/device-card"
import { ChartSvg } from "@/components/chart-svg"
import KneeAreaChart from "@/components/knee-area-chart"
import { useState, useRef, useEffect, useMemo } from "react"
import { useToast } from "@/hooks/use-toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useWebSocket } from "@/hooks/use-websocket"

export default function Page() {
  const { toast } = useToast()
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const locateDelayTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Use WebSocket hook for REAL data
  const {
    devices: wsDevices,
    leftKneeData,
    rightKneeData,
    isConnected,
    isScanning,
    isSyncing,
    syncProgress,
    vibratingDeviceIds,
    scanDevices,
    burstScanDevices,
    connectDevice: wsConnectDevice,
    disconnectDevice: wsDisconnectDevice,
    removeDevice: wsRemoveDevice,
    connectAllDevices,
    syncAllDevices,
    startLocateMode,
    stopLocateMode,
    startBurstScan,
    stopBurstScan,
    startRecording,
    stopRecording,
  } = useWebSocket()

  // Local device state for UI management (with connection state transitions)
  const [devices, setDevices] = useState<Array<{
    id: string;
    name: string;
    signalStrength: 1 | 2 | 3 | 4;
    batteryPercentage: number | null;
    connectionStatus: "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing" | "reconnecting";
    isReconnecting?: boolean;
    reconnectAttempts?: number;
  }>>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [hasStartedStreaming, setHasStartedStreaming] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [isLocating, setIsLocating] = useState(false)
  const [isValidatingState, setIsValidatingState] = useState(false)
  const [isValidatingLocate, setIsValidatingLocate] = useState(false)
  const [streamStartTime, setStreamStartTime] = useState<number | null>(null)
  const [streamElapsedTime, setStreamElapsedTime] = useState(0)
  const [clearChartTrigger, setClearChartTrigger] = useState(0)
  const [isTimerHovered, setIsTimerHovered] = useState(false)
  // Drag & Drop state for device reordering
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  // Persist custom device order (array of device IDs)
  const [deviceOrder, setDeviceOrder] = useState<string[]>([])

  // Auto-start connection logic: run burst scanning + connect attempts for first 10s
  const autoStartRef = useRef(false)
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const connectAllTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (!isConnected || autoStartRef.current) return
    autoStartRef.current = true

    console.log('🔄 Auto-start: Setting isRefreshing=true for 10 seconds')

    // Start UI scanning state for 10 seconds
    setIsRefreshing(true)

    // Start backend burst scanning (10 seconds)
    startBurstScan()

    // UI will automatically stop after 10 seconds
    const scanTimeout = setTimeout(() => {
      console.log('✅ Auto-start: 10 seconds elapsed, setting isRefreshing=false')
      setIsRefreshing(false)
      scanTimeoutRef.current = null
    }, 10000)
    scanTimeoutRef.current = scanTimeout

    // Try connecting to any devices after 1 second
    const connectTimeout = setTimeout(() => {
      connectAllDevices()
    }, 1000)
    connectAllTimeoutRef.current = connectTimeout

    // Cleanup only runs when component unmounts (not on re-renders)
    return () => {
      console.log('🧹 Auto-start cleanup: Clearing timers')
      clearTimeout(scanTimeout)
      clearTimeout(connectTimeout)
      scanTimeoutRef.current = null
      connectAllTimeoutRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  // Update devices from WebSocket scan results
  useEffect(() => {
    setDevices(prev => {
      if (wsDevices.length === 0) {
        return prev;
      }

      const merged = new Map<string, typeof prev[0]>();

      // First, process all WebSocket devices
      wsDevices.forEach(d => {
        const existing = prev.find(p => p.id === d.id);

        // Calculate signal strength from RSSI
        let signalStrength: 1 | 2 | 3 | 4 = 1;
        if (d.rssi >= -50) signalStrength = 4;
        else if (d.rssi >= -65) signalStrength = 3;
        else if (d.rssi >= -75) signalStrength = 2;
        else signalStrength = 1;

        if (existing) {
          // WebSocket confirms connection - override local state
          if (d.state === 'connected' || d.state === 'streaming') {
            if (existing.connectionStatus !== 'connected') {
              console.log(`✅ Device ${d.name} confirmed connected (from WebSocket)`);
            }
            const battery = d.batteryLevel !== null && d.batteryLevel !== undefined ? d.batteryLevel : existing.batteryPercentage;
            console.log(`🔋 Device ${d.name} battery: ${battery}% (from WS: ${d.batteryLevel}, existing: ${existing.batteryPercentage})`);
            merged.set(d.id, {
              ...existing,
              signalStrength,
              batteryPercentage: battery,
              connectionStatus: 'connected' as const,
              isReconnecting: d.isReconnecting ?? false,
              reconnectAttempts: d.reconnectAttempts ?? 0,
            });
            return;
          }

          // WebSocket says disconnected - but keep local transition states
          if (d.state === 'discovered' || d.state === 'disconnected') {
            // If we're in a connecting transition, keep it
            if (existing.connectionStatus === 'connecting' || existing.connectionStatus === 'synchronizing') {
              merged.set(d.id, {
                ...existing,
                signalStrength,
                isReconnecting: d.isReconnecting ?? false,
                reconnectAttempts: d.reconnectAttempts ?? 0,
              });
              return;
            }
            // Otherwise update to disconnected
            merged.set(d.id, {
              ...existing,
              signalStrength,
              batteryPercentage: d.batteryLevel !== null && d.batteryLevel !== undefined ? d.batteryLevel : existing.batteryPercentage,
              connectionStatus: 'disconnected' as const,
              isReconnecting: d.isReconnecting ?? false,
              reconnectAttempts: d.reconnectAttempts ?? 0,
            });
            return;
          }

          // Error state from backend - reset to disconnected if was connecting
          if (d.state === 'error') {
            merged.set(d.id, {
              ...existing,
              signalStrength,
              connectionStatus: existing.connectionStatus === 'connecting' ? 'disconnected' as const : 'disabled' as const,
              isReconnecting: d.isReconnecting ?? false,
              reconnectAttempts: d.reconnectAttempts ?? 0,
            });
            return;
          }

          // Default: keep existing with updated data
          merged.set(d.id, {
            ...existing,
            signalStrength,
            batteryPercentage: d.batteryLevel !== null && d.batteryLevel !== undefined ? d.batteryLevel : existing.batteryPercentage,
            isReconnecting: d.isReconnecting ?? false,
            reconnectAttempts: d.reconnectAttempts ?? 0,
          });
        } else {
          // New device - map WebSocket state to UI state
          let connectionStatus: "connected" | "disconnected" | "disabled" | "connecting" | "synchronizing" = 'disconnected';
          if (d.state === 'connected' || d.state === 'streaming') {
            connectionStatus = 'connected';
          } else if (d.state === 'error') {
            connectionStatus = 'disabled';
          } else if (d.state === 'discovered') {
            connectionStatus = 'disconnected';
          }

          merged.set(d.id, {
            id: d.id,
            name: d.name,
            signalStrength,
            batteryPercentage: d.batteryLevel ?? null,
            connectionStatus,
            isReconnecting: d.isReconnecting ?? false,
            reconnectAttempts: d.reconnectAttempts ?? 0,
          });
        }
      });

      // Second, keep any connected/connecting devices not in the scan
      prev.forEach(device => {
        if (!merged.has(device.id) &&
            (device.connectionStatus === 'connected' ||
             device.connectionStatus === 'connecting' ||
             device.connectionStatus === 'synchronizing')) {
          console.log(`📌 Keeping ${device.name} (${device.connectionStatus}) - not in scan`);
          merged.set(device.id, device);
        }
      });

      return Array.from(merged.values());
    });
  }, [wsDevices])

  // Initialize device order when new devices are discovered (use ref to track)
  const lastDeviceIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(devices.map(d => d.id));
    const newDeviceIds = Array.from(currentIds).filter(id => !lastDeviceIdsRef.current.has(id));

    if (newDeviceIds.length > 0) {
      setDeviceOrder(prev => {
        // If no order exists, initialize with all current device IDs
        if (prev.length === 0) {
          return Array.from(currentIds);
        }
        // Otherwise, just append new device IDs
        return [...prev, ...newDeviceIds];
      });
    }

    // Update the ref
    lastDeviceIdsRef.current = currentIds;
  }, [devices]);

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

  // No mock data - WebSocket hook provides real leftKneeData and rightKneeData

  // Sort devices according to custom order for rendering
  const sortedDevices = useMemo(() => {
    if (deviceOrder.length === 0) {
      return devices;
    }

    return [...devices].sort((a, b) => {
      const indexA = deviceOrder.indexOf(a.id);
      const indexB = deviceOrder.indexOf(b.id);

      // If both are in order, sort by their position
      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      // If only A is in order, it comes first
      if (indexA !== -1) return -1;
      // If only B is in order, it comes first
      if (indexB !== -1) return 1;
      // Neither in order, maintain current order
      return 0;
    });
  }, [devices, deviceOrder]);

  const allDevicesConnected = sortedDevices.every((device) => device.connectionStatus === "connected")

  const connectedDevicesCount = sortedDevices.filter((device) => device.connectionStatus === "connected").length

  const validateStreaming = () => {
    const connectedDevices = sortedDevices.filter((device) => device.connectionStatus === "connected")

    const leftDevices = connectedDevices.filter((device) => device.name.includes("_ln_"))
    const rightDevices = connectedDevices.filter((device) => device.name.includes("_rn_"))

    return leftDevices.length >= 2 || rightDevices.length >= 2
  }

  const handleToggleConnection = (index: number) => {
    if (isLocating || sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return

    const device = sortedDevices[index]
    if (!device) return

    // Don't allow re-connecting if already connected or connecting
    if (device.connectionStatus === "connected" || device.connectionStatus === "connecting") {
      if (device.connectionStatus === "connected") {
        // Only allow disconnect
        wsDisconnectDevice(device.id)
        setDevices((prevDevices) =>
          prevDevices.map((d, i) => (i === index ? { ...d, connectionStatus: "disconnected" as const } : d))
        )
      }
      return
    }

    // Only proceed if disconnected
    if (device.connectionStatus === "disconnected") {
      // Start WebSocket connect in background
      wsConnectDevice(device.id, device.name)

      // Set to connecting - WebSocket events will update to connected
      setDevices((prevDevices) =>
        prevDevices.map((d, i) => (i === index ? { ...d, connectionStatus: "connecting" as const } : d))
      )
    }
  }

  const handleConnectAll = () => {
    if (isLocating || sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return

    // Call WebSocket connect all in background
    connectAllDevices()

    // Set disconnected devices to connecting - WebSocket events will update to connected
    setDevices((prevDevices) =>
      prevDevices.map((device) =>
        device.connectionStatus === "disconnected"
          ? { ...device, connectionStatus: "connecting" as const }
          : device
      )
    )
  }

  const handleDisconnectAll = () => {
    if (isLocating || sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return

    // Disconnect all immediately
    setDevices((prevDevices) =>
      prevDevices.map((device) => ({
        ...device,
        connectionStatus: "disconnected" as const,
      })),
    )

    // Call WebSocket disconnect for all connected sortedDevices
    sortedDevices.forEach(device => {
      if (device.connectionStatus === "connected") {
        wsDisconnectDevice(device.id)
      }
    })
  }

  const handleRefresh = async () => {
    // NEVER scan during streaming/recording or locate mode
    if (isStreaming) {
      toast({
        title: "Cannot Scan",
        description: "Stop angle streaming before scanning for devices.",
        variant: "destructive",
        duration: 3000,
      })
      return
    }

    if (isLocating) {
      toast({
        title: "Cannot Scan",
        description: "Stop locating mode before scanning for devices.",
        variant: "destructive",
        duration: 3000,
      })
      return
    }

    if (isSyncing || isScanning) return

    if (isRefreshing) {
      // Stop scanning - clear UI state and stop backend burst scan
      setIsRefreshing(false)
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current)
        scanTimeoutRef.current = null
      }
      // Stop backend burst scanning
      await stopBurstScan()
      return
    }

    // Start scanning - set UI state for 10 seconds
    setIsRefreshing(true)

    // Start backend burst scanning (10 seconds)
    await startBurstScan()

    // UI will automatically stop after 10 seconds
    scanTimeoutRef.current = setTimeout(() => {
      setIsRefreshing(false)
      scanTimeoutRef.current = null
    }, 10000)
  }

  const handleSync = async () => {
    if (isLocating) return
    await syncAllDevices()
  }

  // React to isSyncing state from WebSocket events
  useEffect(() => {
    if (isSyncing) {
      // Backend sent SYNC_STARTED - show sync animation on connected devices
      setDevices((prevDevices) =>
        prevDevices.map((device) =>
          device.connectionStatus === "connected"
            ? { ...device, connectionStatus: "synchronizing" as const }
            : device
        )
      )
    } else {
      // Backend sent SYNC_COMPLETE - restore to connected
      setDevices((prevDevices) =>
        prevDevices.map((device) =>
          device.connectionStatus === "synchronizing"
            ? { ...device, connectionStatus: "connected" as const }
            : device
        )
      )
    }
  }, [isSyncing])

  const handleLocate = async () => {
    if (sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return

    // If already locating, stop it
    if (isLocating) {
      if (locateDelayTimeoutRef.current) {
        clearTimeout(locateDelayTimeoutRef.current)
        locateDelayTimeoutRef.current = null
      }
      setIsLocating(false)
      await stopLocateMode()
      return
    }

    // Otherwise, start locating
    const connectedIndices = sortedDevices
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

    // Stop any ongoing scans to free BLE resources for locate mode
    if (scanTimeoutRef.current) {
      console.log('🛑 Stopping scan for locate mode')
      clearTimeout(scanTimeoutRef.current)
      scanTimeoutRef.current = null
      setIsRefreshing(false)
    }

    setIsValidatingLocate(true)
    setIsLocating(true)

    // Start accelerometer-based locate mode on backend
    const result = await startLocateMode()
    setIsValidatingLocate(false)

    if (!result.success) {
      console.error('Failed to start locate mode:', result.error)
      setIsLocating(false)
      toast({
        title: "Locate Mode Failed",
        description: result.error || "Failed to start locate mode",
        variant: "destructive",
        duration: 4000,
      })
    }

    // Backend will now handle accelerometer detection and send vibrating device IDs
    // vibratingDeviceIds will be updated in real-time via WebSocket events
  }

  const handleToggleStreaming = async () => {
    if (isLocating || isSyncing) return

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
      setIsValidatingState(true)
      setHasStartedStreaming(true)
      setStreamStartTime(Date.now())
      setStreamElapsedTime(0)
      setClearChartTrigger((prev) => prev + 1)
      const sessionId = `session_${Date.now()}`

      const result = await startRecording(sessionId, "test_exercise", 1)
      setIsValidatingState(false)

      if (result.success) {
        setIsStreaming(true)
      } else {
        setHasStartedStreaming(false)
        setStreamStartTime(null)

        // Show error toast with device details if available
        const errorMsg = (result as any).error || result.message || "Failed to start streaming"
        toast({
          title: "Cannot Start Streaming",
          description: errorMsg,
          variant: "destructive",
          duration: 6000,
        })
      }
    } else {
      await stopRecording()
      setIsStreaming(false)
    }
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

  // Drag & Drop handlers for device reordering
  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    if (isLocating || isSyncing) return
    setDraggingIndex(index)
    setDragOverIndex(null)
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(index))
      // Create a custom drag image
      const dragImage = e.currentTarget.cloneNode(true) as HTMLElement
      dragImage.style.position = 'absolute'
      dragImage.style.top = '-9999px'
      document.body.appendChild(dragImage)
      e.dataTransfer.setDragImage(dragImage, 0, 0)
      setTimeout(() => document.body.removeChild(dragImage), 0)
    } catch {}
  }
  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    if (isLocating || isSyncing) return
    e.preventDefault()
    if (dragOverIndex !== index && draggingIndex !== index) {
      setDragOverIndex(index)
      // Perform real-time reordering by updating device order
      setDeviceOrder(prev => {
        const from = draggingIndex
        if (from === null || from === index) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(index, 0, moved)
        return next
      })
      // Update dragging index to new position
      setDraggingIndex(index)
    }
    try { e.dataTransfer.dropEffect = 'move' } catch {}
  }
  const handleDrop = (index: number) => (e: React.DragEvent) => {
    if (isLocating || isSyncing) return
    e.preventDefault()
    setDraggingIndex(null)
    setDragOverIndex(null)
  }
  const handleDragEnd = () => {
    setDraggingIndex(null)
    setDragOverIndex(null)
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

  // leftKneeData and rightKneeData come from useWebSocket hook

  return (
    <TooltipProvider delayDuration={1500}>
      <div className="min-h-screen bg-[#fff6f3] flex flex-col relative">
        {/* Single big draggable div covering entire viewport */}
        <div
          className="fixed inset-0 w-full h-full"
          style={{
            WebkitAppRegion: 'drag',
            zIndex: 1
          } as any}
        />

        {/* All content with higher z-index and no-drag */}
        <div
          className="relative min-h-screen flex flex-col pointer-events-none"
          style={{
            zIndex: 2
          } as any}
        >
          {/* Floating Window Controls - Top Right */}
          <div
            className="fixed top-4 right-4 flex items-center gap-1 pointer-events-auto"
            style={{
              zIndex: 50,
              WebkitAppRegion: 'no-drag'
            } as any}
          >
            <button
              onClick={() => window.electronAPI?.window.minimize()}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm hover:bg-white transition-all shadow-sm"
              title="Minimize"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <button
              onClick={() => window.electronAPI?.window.maximize()}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm hover:bg-white transition-all shadow-sm"
              title="Maximize"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              </svg>
            </button>
            <button
              onClick={() => window.electronAPI?.window.close()}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm hover:bg-red-500 hover:text-white transition-all shadow-sm"
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <header
            className="p-8 pb-0 pointer-events-auto"
          >
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

          <div
            className="flex-1 flex items-center justify-center px-8 relative pointer-events-none"
          >
            <div className="flex gap-6 w-[90%] pointer-events-none">
              {/* Left Pane */}
              <div
                className={`flex-shrink-0 w-[500px] bg-white p-6 flex flex-col transition-all pointer-events-auto ${
                  isFlashing ? "flash-pane" : ""
                }`}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: "36px",
                  height: "500px",
                  WebkitAppRegion: 'no-drag'
                } as any}
              >
                <div className="flex justify-between mb-4">
                  <div className="flex gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleLocate}
                          disabled={devices.some((d) => d.connectionStatus === "synchronizing") || isStreaming || isValidatingState || isValidatingLocate}
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
                          {isValidatingLocate ? (
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                              <path
                                d="M12 2v4M12 18v4M2 12h4M18 12h4"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          )}
                          {isValidatingLocate ? "Connecting..." : isLocating ? "Stop Locating" : "Locate"}
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
                          disabled={isLocating || isStreaming || isValidatingState || isValidatingLocate}
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
                        disabled={isLocating || isSyncing || isStreaming || isValidatingState || isValidatingLocate}
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
                <div className="overflow-y-auto overflow-x-hidden flex flex-col items-center gap-4 p-3 min-h-0 relative">
                  {isRefreshing && (
                    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
                      <div className="visor-scan" />
                    </div>
                  )}

                  {isLocating && vibratingDeviceIds.length === 0 && (
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

                  {sortedDevices.map((device, index) => (
                    <DeviceCard
                      key={device.id || device.name}
                      name={device.name}
                      signalStrength={device.signalStrength}
                      batteryPercentage={device.batteryPercentage}
                      connectionStatus={device.connectionStatus}
                      isStreaming={isStreaming}
                      isLocating={isLocating}
                      isLocatingTarget={isLocating && vibratingDeviceIds.includes(device.id)}
                      isReconnecting={device.isReconnecting}
                      reconnectAttempts={device.reconnectAttempts}
                      disabled={isLocating || isSyncing}
                      onToggleConnection={() => handleToggleConnection(index)}
                      onRemove={async () => {
                        // Call backend to remove device (via WebSocket)
                        // This will cancel reconnect and remove from registry
                        try {
                          const result = await wsRemoveDevice(device.id);
                          if (result.success) {
                            console.log(`✅ Device ${device.id} removed successfully`);
                            // Optimistically remove from local state
                            setDevices(prev => prev.filter(d => d.id !== device.id));
                          } else {
                            console.error(`❌ Failed to remove device: ${result.error}`);
                            toast({
                              title: "Remove Failed",
                              description: result.error || "Could not remove device",
                              variant: "destructive"
                            });
                          }
                        } catch (error) {
                          console.error('Failed to remove device:', error);
                          toast({
                            title: "Error",
                            description: "An unexpected error occurred",
                            variant: "destructive"
                          });
                        }
                      }}
                      syncOffsetMs={syncProgress[device.id]?.offsetMs}
                      syncDeviceTimestampMs={syncProgress[device.id]?.deviceTimestampMs}
                      draggable={!isLocating && !isSyncing}
                      isDragging={draggingIndex === index}
                      isDragOver={dragOverIndex === index && draggingIndex !== index}
                      onDragStart={handleDragStart(index)}
                      onDragOver={handleDragOver(index)}
                      onDrop={handleDrop(index)}
                      onDragEnd={handleDragEnd}
                    />
                  ))}
                </div>

                {/* Connect All and Disconnect All Buttons */}
                <div className="flex gap-3 mt-6">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleDisconnectAll}
                        disabled={isLocating || isSyncing}
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
                        disabled={isLocating || isSyncing}
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
                className="flex-1 bg-white p-6 gradient-diagonal flex flex-col items-center justify-center pointer-events-auto"
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: "36px",
                  height: "500px",
                  WebkitAppRegion: 'no-drag'
                } as any}
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
                        disabled={isLocating || isSyncing || isValidatingState || isValidatingLocate}
                        className="px-6 py-3 text-base rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md border border-white/50 hover:border-white/60 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"
                        style={getFillStyle()}
                      >
                        {isValidatingState ? (
                          <>
                            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Connecting...
                          </>
                        ) : isStreaming ? (
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
      </div>
    </TooltipProvider>
  )
}
