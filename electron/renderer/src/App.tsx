import { DeviceCard } from "@/components/device-card"
import { ChartSvg } from "@/components/chart-svg"
import KneeAreaChart from "@/components/knee-area-chart"
import { PlatformIndicator } from "@/components/platform-indicator"
import { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from "react"
import { useToast } from "@/hooks/use-toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useDevices, type UIDevice, DeviceId } from "@/hooks/useDevices"
import { persistence } from "@/lib/persistence"

// ─────────────────────────────────────────────────────────────────────────────
// Pending Operations - Optimistic UI State
// ─────────────────────────────────────────────────────────────────────────────

enum PendingOp {
  STOP_LOCATE = 'stop_locate',
  STOP_STREAMING = 'stop_streaming',
}

interface PendingState {
  operations: Set<PendingOp>;
  disconnecting: Set<string>; // device IDs being disconnected
}

const PENDING_TIMEOUT_MS = 10000; // 10s fallback timeout

// Lazy load RPi-specific components only when needed
const DynamicIsland = lazy(() => import("@/components/DynamicIsland").then(m => ({ default: m.DynamicIsland })))
const ClientLauncher = lazy(() => import("@/components/DynamicIsland/ClientLauncher").then(m => ({ default: m.ClientLauncher })))
const ClientSnappedIsland = lazy(() => import("@/components/DynamicIsland/ClientLauncher").then(m => ({ default: m.ClientSnappedIsland })))
const ClientIframe = lazy(() => import("@/components/DynamicIsland/ClientLauncher").then(m => ({ default: m.ClientIframe })))
type ClientDisplayMode = 'closed' | 'modal' | 'minimized' | 'snapped-left' | 'snapped-right';

export default function Page() {
  const { toast } = useToast()
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const locateDelayTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Unified device state hook - single source of truth
  const {
    // Device state
    uiDevices,
    allDevices,
    isConnected,
    isScanning,
    isSyncing,
    isStreaming,  // Backend source of truth
    isLocating,   // Backend source of truth
    syncProgress,
    vibratingDeviceIds,
    // Motion data
    leftKneeData,
    rightKneeData,
    // Actions
    connectDevice,
    disconnectDevice,
    removeDevice,
    connectAllDevices,
    syncAllDevices,
    startLocateMode,
    stopLocateMode,
    startBurstScan,
    stopBurstScan,
    startStreaming,
    stopStreaming,
  } = useDevices()

  // UI state (not device state - just UI concerns)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasStartedStreaming, setHasStartedStreaming] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
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

  // Pending operations for optimistic UI updates
  const [pending, setPendingState] = useState<PendingState>({
    operations: new Set(),
    disconnecting: new Set(),
  })
  const pendingTimeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Small screen detection (< 350px width or height)
  const [isSmallScreen, setIsSmallScreen] = useState(false)
  const [smallScreenOverride, setSmallScreenOverride] = useState<boolean | null>(null) // null = auto, true/false = manual
  const [isRaspberryPi, setIsRaspberryPi] = useState(false)

  // Client Launcher state (singleton) - Only used on Raspberry Pi
  const [clientLaunched, setClientLaunched] = useState(false)
  const [clientDisplay, setClientDisplay] = useState<ClientDisplayMode>('closed')

  // Auto-start: run burst scanning for first 10s (user clicks Connect to connect devices)
  const autoStartRef = useRef(false)
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Load persisted state on mount
  useEffect(() => {
    const savedState = persistence.loadState()

    console.log('📦 Loading persisted state:', savedState)

    // Restore UI preferences
    if (savedState.deviceOrder.length > 0) {
      setDeviceOrder(savedState.deviceOrder)
      console.log('✅ Restored device order:', savedState.deviceOrder)
    }

    if (savedState.smallScreenOverride !== null) {
      setSmallScreenOverride(savedState.smallScreenOverride)
      console.log('✅ Restored screen preference:', savedState.smallScreenOverride)
    }

    if (savedState.clientDisplay !== 'closed') {
      setClientDisplay(savedState.clientDisplay)
      setClientLaunched(savedState.clientDisplay !== 'closed')
      console.log('✅ Restored client display:', savedState.clientDisplay)
    }
  }, [])

  // Save state changes to persistence
  useEffect(() => {
    persistence.saveDeviceOrder(deviceOrder)
  }, [deviceOrder])

  useEffect(() => {
    persistence.saveScreenPreference(smallScreenOverride)
  }, [smallScreenOverride])

  useEffect(() => {
    persistence.saveClientDisplay(clientDisplay)
  }, [clientDisplay])

  // Save state before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      persistence.saveStateImmediate({
        deviceOrder,
        smallScreenOverride,
        clientDisplay,
      })

      console.log('💾 Saved state before unload')
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [deviceOrder, smallScreenOverride, clientDisplay])

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

    // NOTE: Removed auto-connect after 1 second
    // Devices now stay in DISCOVERED state until user explicitly clicks Connect
    // This prevents devices from showing "connecting" state immediately after being discovered

    // Cleanup only runs when component unmounts (not on re-renders)
    return () => {
      console.log('🧹 Auto-start cleanup: Clearing timers')
      clearTimeout(scanTimeout)
      scanTimeoutRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  // Detect small screens (< 350px width or height) OR force on Raspberry Pi
  useEffect(() => {
    const checkScreenSize = async () => {
      // Check if running on Raspberry Pi
      let isRPi = false
      try {
        const platformInfo = await window.electronAPI?.system?.getPlatformInfo()
        isRPi = platformInfo?.info?.isRaspberryPi || false
        setIsRaspberryPi(isRPi)

        // Force small screen mode on Raspberry Pi regardless of actual screen size
        if (isRPi && smallScreenOverride === null) {
          console.log('🍓 Raspberry Pi detected - forcing small screen layout')
          setIsSmallScreen(true)
          return
        }
      } catch (err) {
        console.warn('Could not detect platform:', err)
        setIsRaspberryPi(false)
      }

      // If manual override is set, use that instead
      if (smallScreenOverride !== null) {
        setIsSmallScreen(smallScreenOverride)
        return
      }

      // Otherwise, auto-detect based on window size
      // RPi: 500px threshold for 480x320 displays
      // PC/Mac: 350px threshold (original)
      const threshold = isRPi ? 500 : 350
      const isSmall = window.innerWidth <= threshold || window.innerHeight <= threshold
      setIsSmallScreen(isSmall)
    }

    // Check on mount
    checkScreenSize()

    // Listen for resize events
    window.addEventListener('resize', checkScreenSize)

    return () => {
      window.removeEventListener('resize', checkScreenSize)
    }
  }, [smallScreenOverride])

  // Keyboard shortcut: Ctrl+Shift+R to toggle small screen mode (dev feature)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+R (or Cmd+Shift+R on Mac)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault()

        setSmallScreenOverride(prev => {
          const newValue = prev === null ? !isSmallScreen : (prev ? false : true)

          // Show feedback toast
          const mode = newValue ? 'Small Screen' : 'Normal'
          const threshold = isRaspberryPi ? 500 : 350
          const isManual = newValue !== (window.innerWidth <= threshold || window.innerHeight <= threshold)

          toast({
            title: `${mode} Mode ${isManual ? '(Manual Override)' : '(Auto)'}`,
            description: `Switched to ${mode.toLowerCase()} layout. Press Ctrl+Shift+R to toggle.`,
            duration: 2000,
          })

          return newValue
        })
      }

      // Ctrl+Shift+A to reset to auto-detect
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        setSmallScreenOverride(null)

        toast({
          title: "Auto-Detect Mode",
          description: "Screen size detection reset to automatic.",
          duration: 2000,
        })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSmallScreen, toast])

  // Initialize device order when new devices are discovered
  const lastDeviceIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentIds = new Set(uiDevices.map(d => d.id));
    const newDeviceIds = Array.from(currentIds).filter(id => !lastDeviceIdsRef.current.has(id));

    if (newDeviceIds.length > 0) {
      setDeviceOrder(prev => {
        if (prev.length === 0) {
          return Array.from(currentIds);
        }
        return [...prev, ...newDeviceIds];
      });
    }

    lastDeviceIdsRef.current = currentIds;
  }, [uiDevices]);

  // Initialize UI state from backend on mount/reconnect (for page refresh during recording)
  useEffect(() => {
    if (isStreaming && !hasStartedStreaming) {
      console.log('🔄 Restoring hasStartedStreaming from backend isStreaming state')
      setHasStartedStreaming(true)
      setStreamStartTime(Date.now())
    }
  }, [isStreaming, hasStartedStreaming])

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
  // uiDevices comes from useDevices hook - single source of truth
  const sortedDevices = useMemo(() => {
    if (deviceOrder.length === 0) {
      return uiDevices;
    }

    return [...uiDevices].sort((a, b) => {
      const indexA = deviceOrder.indexOf(a.id);
      const indexB = deviceOrder.indexOf(b.id);

      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return 0;
    });
  }, [uiDevices, deviceOrder]);

  const allDevicesConnected = sortedDevices.every((device) => device.connectionStatus === "connected")

  const connectedDevicesCount = sortedDevices.filter((device) => device.connectionStatus === "connected").length

  const validateStreaming = () => {
    const connectedDevices = sortedDevices.filter((device) => device.connectionStatus === "connected")
    const connectedIds = new Set(connectedDevices.map((d) => d.deviceId))

    // Check for left knee pair (LEFT_SHIN + LEFT_THIGH)
    const hasLeftKnee = connectedIds.has(DeviceId.LEFT_SHIN) && connectedIds.has(DeviceId.LEFT_THIGH)
    // Check for right knee pair (RIGHT_SHIN + RIGHT_THIGH)
    const hasRightKnee = connectedIds.has(DeviceId.RIGHT_SHIN) && connectedIds.has(DeviceId.RIGHT_THIGH)

    return hasLeftKnee || hasRightKnee
  }

  // Simplified handler - server owns state, UI just calls actions
  const handleToggleConnection = async (index: number) => {
    if (isLocating || sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return

    const device = sortedDevices[index]
    if (!device) return

    // Handle disconnect/cancel for connected or connecting states
    if (device.connectionStatus === "connected" || device.connectionStatus === "connecting") {
      console.log(`🔴 ${device.connectionStatus === "connecting" ? "Canceling" : "Disconnecting"} device: ${device.name}`)

      // Stop streaming if active
      if (isStreaming) {
        console.log(`⚠️ Stopping streaming because user disconnected device`)
        setPendingOp(PendingOp.STOP_STREAMING)
        await stopStreaming()
      }

      // Optimistic: show "Disconnecting..." immediately
      setPendingDisconnect(device.id)
      await disconnectDevice(device.id)
      return
    }

    if (device.connectionStatus === "disconnected" || device.connectionStatus === "reconnecting") {
      console.log(`🟢 Connecting device: ${device.name} (${device.bleName})`)
      // Call server action - state update will come via STATE_UPDATE
      // Use bleName for connection (original BLE name needed by backend)
      await connectDevice(device.id, device.bleName)
    }
  }

  // Simplified - server owns state
  const handleConnectAll = async () => {
    if (isLocating || sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return
    console.log(`🟢 Connecting all devices`)
    await connectAllDevices()
  }

  // Simplified - server owns state
  const handleDisconnectAll = async () => {
    if (isLocating || sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return
    console.log(`🔴 Disconnecting all devices`)

    const connectedDevices = sortedDevices.filter(d => d.connectionStatus === "connected")
    if (connectedDevices.length === 0) return

    // Stop streaming if active
    if (isStreaming) {
      console.log(`⚠️ Stopping streaming because user disconnected all devices`)
      setPendingOp(PendingOp.STOP_STREAMING)
      await stopStreaming()
    }

    // Optimistic: show "Disconnecting..." for all devices immediately
    connectedDevices.forEach(device => setPendingDisconnect(device.id))
    await Promise.all(connectedDevices.map(device => disconnectDevice(device.id)))
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

  // Fix #3: Add timeout protection to sync
  const SYNC_TIMEOUT_MS = 15000

  const handleSync = async () => {
    if (isLocating) return

    try {
      const syncPromise = syncAllDevices()
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Sync timeout')), SYNC_TIMEOUT_MS)
      })

      await Promise.race([syncPromise, timeoutPromise])
    } catch (error) {
      if (error instanceof Error && error.message === 'Sync timeout') {
        toast({
          title: "Sync Timeout",
          description: "Sync took too long. Please try again.",
          variant: "destructive",
          duration: 4000,
        })
      } else {
        console.error('Sync error:', error)
        toast({
          title: "Sync Failed",
          description: error instanceof Error ? error.message : "An error occurred during sync",
          variant: "destructive",
          duration: 4000,
        })
      }
    }
  }

  // Sync state now comes from useDevices hook via STATE_UPDATE - no local management needed


  // Locate mode - backend owns isLocating state via GlobalState.LOCATING
  const handleLocate = async () => {
    if (sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return

    // If already locating, stop it with optimistic UI update
    if (isLocating) {
      if (locateDelayTimeoutRef.current) {
        clearTimeout(locateDelayTimeoutRef.current)
        locateDelayTimeoutRef.current = null
      }
      setPendingOp(PendingOp.STOP_LOCATE) // Optimistic: show "Stopping..." immediately
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

    // Start accelerometer-based locate mode on backend (isLocating will update via STATE_UPDATE)
    const result = await startLocateMode()
    setIsValidatingLocate(false)

    if (!result.success) {
      console.error('Failed to start locate mode:', result.error)
      toast({
        title: "Locate Mode Failed",
        description: result.error || "Failed to start locate mode",
        variant: "destructive",
        duration: 4000,
      })
    }
    // Backend will now handle accelerometer detection and send vibrating device IDs
    // vibratingDeviceIds and isLocating will be updated in real-time via STATE_UPDATE
  }

  // Streaming - backend owns isStreaming state via GlobalState.STREAMING
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
      // Start streaming
      setIsValidatingState(true)
      setHasStartedStreaming(true)
      setStreamStartTime(Date.now())
      setStreamElapsedTime(0)
      setClearChartTrigger((prev) => prev + 1)
      const sessionId = `session_${Date.now()}`

      const result = await startStreaming(sessionId, "test_exercise", 1)
      setIsValidatingState(false)

      // Backend will update isStreaming via STATE_UPDATE on success
      if (!result.success) {
        setHasStartedStreaming(false)
        setStreamStartTime(null)
        const errorMsg = (result as any).error || "Failed to start streaming"
        toast({
          title: "Cannot Start Streaming",
          description: errorMsg,
          variant: "destructive",
          duration: 6000,
        })
      }
    } else {
      // Stop streaming with optimistic UI update
      setPendingOp(PendingOp.STOP_STREAMING)
      await stopStreaming()
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

  // Client Launcher handlers
  const handleLaunchClient = () => {
    setClientLaunched(true)
    setClientDisplay('modal')
  }

  const handleCloseClient = () => {
    setClientLaunched(false)
    setClientDisplay('closed')
  }

  const handleMinimizeClient = () => {
    setClientDisplay('minimized')
  }

  const handleSnapClientLeft = () => {
    setClientDisplay('snapped-left')
  }

  const handleSnapClientRight = () => {
    setClientDisplay('snapped-right')
  }

  const handleClientBackToModal = () => {
    setClientDisplay('modal')
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

  // ─── Pending State Helpers (Optimistic UI) ─────────────────────────────────
  const clearPendingTimeout = useCallback((key: string) => {
    const timeout = pendingTimeoutRefs.current.get(key)
    if (timeout) {
      clearTimeout(timeout)
      pendingTimeoutRefs.current.delete(key)
    }
  }, [])

  const setPendingOp = useCallback((op: PendingOp) => {
    clearPendingTimeout(op)
    setPendingState(prev => ({
      ...prev,
      operations: new Set(prev.operations).add(op),
    }))
    // Fallback timeout to clear pending state
    const timeout = setTimeout(() => {
      setPendingState(prev => {
        const next = new Set(prev.operations)
        next.delete(op)
        return { ...prev, operations: next }
      })
      pendingTimeoutRefs.current.delete(op)
    }, PENDING_TIMEOUT_MS)
    pendingTimeoutRefs.current.set(op, timeout)
  }, [clearPendingTimeout])

  const clearPendingOp = useCallback((op: PendingOp) => {
    clearPendingTimeout(op)
    setPendingState(prev => {
      const next = new Set(prev.operations)
      next.delete(op)
      return { ...prev, operations: next }
    })
  }, [clearPendingTimeout])

  const setPendingDisconnect = useCallback((deviceId: string) => {
    const key = `disconnect_${deviceId}`
    clearPendingTimeout(key)
    setPendingState(prev => ({
      ...prev,
      disconnecting: new Set(prev.disconnecting).add(deviceId),
    }))
    // Fallback timeout
    const timeout = setTimeout(() => {
      setPendingState(prev => {
        const next = new Set(prev.disconnecting)
        next.delete(deviceId)
        return { ...prev, disconnecting: next }
      })
      pendingTimeoutRefs.current.delete(key)
    }, PENDING_TIMEOUT_MS)
    pendingTimeoutRefs.current.set(key, timeout)
  }, [clearPendingTimeout])

  const clearPendingDisconnect = useCallback((deviceId: string) => {
    const key = `disconnect_${deviceId}`
    clearPendingTimeout(key)
    setPendingState(prev => {
      const next = new Set(prev.disconnecting)
      next.delete(deviceId)
      return { ...prev, disconnecting: next }
    })
  }, [clearPendingTimeout])

  // Auto-clear pending states when backend confirms state change
  useEffect(() => {
    if (!isLocating) clearPendingOp(PendingOp.STOP_LOCATE)
  }, [isLocating, clearPendingOp])

  useEffect(() => {
    if (!isStreaming) clearPendingOp(PendingOp.STOP_STREAMING)
  }, [isStreaming, clearPendingOp])

  // Clear pending disconnect when device state changes to disconnected
  useEffect(() => {
    pending.disconnecting.forEach(deviceId => {
      const device = uiDevices.find(d => d.id === deviceId)
      if (device && device.connectionStatus === 'disconnected') {
        clearPendingDisconnect(deviceId)
      }
    })
  }, [uiDevices, pending.disconnecting, clearPendingDisconnect])

  // Derived pending flags for UI
  const isStoppingLocate = pending.operations.has(PendingOp.STOP_LOCATE)
  const isStoppingStreaming = pending.operations.has(PendingOp.STOP_STREAMING)

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

  // leftKneeData and rightKneeData come from useDevices hook

  return (
    <TooltipProvider delayDuration={1500}>
      <div className={`${isSmallScreen ? "h-screen bg-[#fff6f3] flex flex-col relative overflow-hidden" : "min-h-screen bg-[#fff6f3] flex flex-col relative"} ${isRaspberryPi ? "raspberry-pi" : ""}`}>
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
          className={isSmallScreen ? "relative h-screen flex flex-col pointer-events-none" : "relative min-h-screen flex flex-col pointer-events-none"}
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

          {/* Platform Indicator - Bottom Left */}
          <PlatformIndicator />

          {/* Header - Hidden on small screens */}
          {!isSmallScreen && (
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
          )}

          <div
            className={isSmallScreen ? "flex-1 flex relative pointer-events-none" : "flex-1 flex items-center justify-center px-8 relative pointer-events-none"}
          >
            <div className={isSmallScreen ? "flex gap-0 w-full h-full pointer-events-none" : "flex gap-6 w-[90%] pointer-events-none"}>
              {/* Left Pane */}
              <div
                className={`flex-shrink-0 bg-white flex flex-col transition-all pointer-events-auto ${
                  isFlashing ? "flash-pane" : ""
                } ${
                  isSmallScreen ? "w-1/2 h-full p-4" : "w-[500px] p-6"
                }`}
                style={{
                  border: isSmallScreen ? "none" : "1px solid #e5e5e5",
                  borderRadius: isSmallScreen ? "0" : "36px",
                  height: isSmallScreen ? "100%" : "500px",
                  WebkitAppRegion: 'no-drag',
                  position: 'relative',
                  padding: clientDisplay === 'snapped-left' ? '0' : undefined,
                } as any}
              >
                {isRaspberryPi && clientDisplay === 'snapped-left' ? (
                  <Suspense fallback={null}>
                    <>
                      <ClientIframe className="client-iframe" />
                      <ClientSnappedIsland
                        isLeft={true}
                        onClose={handleCloseClient}
                        onBackToModal={handleClientBackToModal}
                      />
                    </>
                  </Suspense>
                ) : (
                  <>

                <div className={isSmallScreen ? "flex justify-between mb-3" : "flex justify-between mb-4"}>
                  <div className="flex gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleLocate}
                          disabled={sortedDevices.some((d) => d.connectionStatus === "synchronizing") || isStreaming || isValidatingState || isValidatingLocate || isStoppingLocate}
                          className={isSmallScreen ? "px-5 py-3 text-base rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]" : "px-4 py-2 text-sm rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"}
                          style={{
                            backgroundColor: (isLocating || isStoppingLocate) ? "rgba(75, 175, 39, 0.15)" : "rgba(255, 255, 255, 0.5)",
                            color: (isLocating || isStoppingLocate) ? "#4baf27" : "var(--tropx-shadow)",
                            transition: "all 0.3s ease",
                          }}
                          onMouseEnter={(e) => {
                            if (!isLocating && !sortedDevices.some((d) => d.connectionStatus === "synchronizing")) {
                              e.currentTarget.style.backgroundColor = "rgba(75, 175, 39, 0.15)"
                              e.currentTarget.style.color = "#4baf27"
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isLocating && !sortedDevices.some((d) => d.connectionStatus === "synchronizing")) {
                              e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.5)"
                              e.currentTarget.style.color = "var(--tropx-shadow)"
                            }
                          }}
                          aria-label="Locate"
                        >
                          {(isValidatingLocate || isStoppingLocate) ? (
                            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                          ) : (
                            <svg width={isSmallScreen ? "20" : "16"} height={isSmallScreen ? "20" : "16"} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                              <path
                                d="M12 2v4M12 18v4M2 12h4M18 12h4"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          )}
                          {isSmallScreen ? "" : (isValidatingLocate ? "Connecting..." : isStoppingLocate ? "Stopping..." : isLocating ? "Stop Locating" : "Locate")}
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
                          className={isSmallScreen ? "px-5 py-3 text-base rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md text-tropx-shadow hover:text-purple-600 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]" : "px-4 py-2 text-sm rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md text-tropx-shadow hover:text-purple-600 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"}
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
                          <svg width={isSmallScreen ? "20" : "16"} height={isSmallScreen ? "20" : "16"} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path
                              d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          {!isSmallScreen && "Sync"}
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
                        className={isSmallScreen ? "px-5 py-3 text-base rounded-full transition-all cursor-pointer backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99] flex items-center gap-2" : "px-4 py-2 text-sm rounded-full transition-all cursor-pointer backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99] flex items-center gap-2"}
                        style={{
                          backgroundColor: isRefreshing ? "rgba(255, 77, 53, 0.15)" : "rgba(255, 255, 255, 0.5)",
                          transition: "all 0.3s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (
                            !isLocating &&
                            !sortedDevices.some((d) => d.connectionStatus === "synchronizing") &&
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
                            !sortedDevices.some((d) => d.connectionStatus === "synchronizing") &&
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
                          width={isSmallScreen ? "20" : "16"}
                          height={isSmallScreen ? "20" : "16"}
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
                        <span>Scan</span>
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
                      deviceId={device.deviceId}
                      signalStrength={device.signalStrength}
                      batteryPercentage={device.batteryPercentage}
                      connectionStatus={device.connectionStatus}
                      isStreaming={isStreaming}
                      isLocating={isLocating}
                      isLocatingTarget={isLocating && vibratingDeviceIds.includes(device.id)}
                      isReconnecting={device.isReconnecting}
                      isDisconnecting={pending.disconnecting.has(device.id)}
                      reconnectAttempts={device.reconnectAttempts}
                      disabled={isLocating || isSyncing}
                      isSmallScreen={isSmallScreen}
                      onToggleConnection={() => handleToggleConnection(index)}
                      onRemove={async () => {
                        // Call server action - state update will come via STATE_UPDATE
                        try {
                          const result = await removeDevice(device.id);
                          if (result.success) {
                            console.log(`✅ Device ${device.id} removed successfully`);
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
                      syncProgressPercent={syncProgress[device.id]?.progress}
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
                <div className={isSmallScreen ? "flex gap-2 mt-4" : "flex gap-3 mt-6"}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleDisconnectAll}
                        disabled={isLocating || isSyncing}
                        className={isSmallScreen ? "flex-1 py-3 px-5 text-base rounded-full border-2 border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]" : "flex-1 py-2 px-4 text-sm rounded-full border-2 border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"}
                      >
                        {isSmallScreen ? "Disconnect" : "Disconnect All"}
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
                        className={`flex-1 ${isSmallScreen ? "py-3 px-5 text-base" : "py-2 px-4 text-sm"} rounded-full font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99] ${
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
                        {isSmallScreen ? "Connect" : "Connect All"}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Connect all available devices</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                {/* Dynamic Island - Launch Client - Only on Raspberry Pi */}
                {isRaspberryPi && !clientLaunched && (
                  <Suspense fallback={null}>
                    <DynamicIsland
                      expanded={false}
                      onToggle={handleLaunchClient}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', cursor: 'pointer' }}>
                        <span style={{ fontSize: '18px' }}>🚀</span>
                        <span style={{ fontWeight: 500 }}>Launch Client</span>
                      </div>
                    </DynamicIsland>
                  </Suspense>
                )}
                  </>
                )}
              </div>

              {/* Right Pane */}
              <div
                className={`bg-white gradient-diagonal flex flex-col items-center justify-center pointer-events-auto ${
                  isSmallScreen ? "w-1/2 h-full flex-1 p-4" : "flex-1 p-6"
                }`}
                style={{
                  border: isSmallScreen ? "none" : "1px solid #e5e5e5",
                  borderRadius: isSmallScreen ? "0" : "36px",
                  height: isSmallScreen ? "100%" : "500px",
                  WebkitAppRegion: 'no-drag'
                } as any}
              >
                {isStreaming || hasStartedStreaming ? (
                  <KneeAreaChart leftKnee={leftKneeData} rightKnee={rightKneeData} clearTrigger={clearChartTrigger} />
                ) : (
                  <ChartSvg />
                )}

                <div className={isSmallScreen ? "mt-4 flex items-center gap-2" : "mt-8 flex items-center gap-3"}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleToggleStreaming}
                        disabled={isLocating || isSyncing || isValidatingState || isValidatingLocate || isStoppingStreaming}
                        className={isSmallScreen ? "px-7 py-4 text-lg rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md border border-white/50 hover:border-white/60 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]" : "px-6 py-3 text-base rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md border border-white/50 hover:border-white/60 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]"}
                        style={getFillStyle()}
                      >
                        {isValidatingState ? (
                          <>
                            <svg className={isSmallScreen ? "animate-spin h-6 w-6" : "animate-spin h-5 w-5"} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {!isSmallScreen && "Connecting..."}
                          </>
                        ) : isStoppingStreaming ? (
                          <>
                            <svg className={isSmallScreen ? "animate-spin h-6 w-6" : "animate-spin h-5 w-5"} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {!isSmallScreen && "Stopping..."}
                          </>
                        ) : isStreaming ? (
                          <>
                            <svg
                              width={isSmallScreen ? "18" : "14"}
                              height={isSmallScreen ? "18" : "14"}
                              viewBox="0 0 16 16"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <rect x="3" y="3" width="4" height="10" rx="1" fill="currentColor" />
                              <rect x="9" y="3" width="4" height="10" rx="1" fill="currentColor" />
                            </svg>
                            {isSmallScreen ? "Stop" : "Stop Streaming"}
                          </>
                        ) : (
                          <>
                            <svg
                              width={isSmallScreen ? "18" : "14"}
                              height={isSmallScreen ? "18" : "14"}
                              viewBox="0 0 16 16"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path d="M4 2L13 8L4 14V2Z" fill="currentColor" />
                            </svg>
                            {isSmallScreen ? "Start" : "Start Streaming"}
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
                          className={isSmallScreen ? "px-5 py-4 rounded-full font-medium flex items-center gap-2 backdrop-blur-md border transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.99]" : "px-4 py-3 rounded-full font-medium flex items-center gap-2 backdrop-blur-md border transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.99]"}
                          style={{
                            backgroundColor: isTimerHovered ? "rgba(239, 68, 68, 0.15)" : "rgba(255, 255, 255, 0.5)",
                            color: isTimerHovered ? "#dc2626" : "var(--tropx-shadow)",
                            borderColor: isTimerHovered ? "#ef4444" : "rgba(255, 255, 255, 0.5)",
                            transition: "all 0.3s ease",
                          }}
                        >
                          <svg width={isSmallScreen ? "20" : "16"} height={isSmallScreen ? "20" : "16"} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                            <path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                          <span className={isSmallScreen ? "text-lg" : "text-base"}>
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

        {/* Client Launcher - Global singleton - Only on Raspberry Pi */}
        {isRaspberryPi && (
          <Suspense fallback={null}>
            <ClientLauncher
              isLaunched={clientLaunched}
              displayMode={clientDisplay}
              onLaunch={handleLaunchClient}
              onClose={handleCloseClient}
              onMinimize={handleMinimizeClient}
              onSnapLeft={handleSnapClientLeft}
              onSnapRight={handleSnapClientRight}
              onBackToModal={handleClientBackToModal}
            />
          </Suspense>
        )}
      </div>
    </TooltipProvider>
  )
}
