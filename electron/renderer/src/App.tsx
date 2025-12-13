import { DeviceCard } from "@/components/device-card"
import { ChartSvg } from "@/components/chart-svg"
import KneeAreaChart from "@/components/knee-area-chart"
import { PlatformIndicator } from "@/components/platform-indicator"
import { ProfileSelector } from "@/components/ProfileSelector"
import { TopNavTabs } from "@/components/TopNavTabs"
import { ActionBar, type ActionId } from "@/components/ActionBar"
import { ActionModal } from "@/components/ActionModal"
import { StorageSettingsModal } from "@/components/StorageSettingsModal"
import { isElectron, isWeb } from "@/lib/platform"
import { platformInfo } from "@/lib/platform"
import { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from "react"
import { useToast } from "@/hooks/use-toast"
import { ToastAction } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useDevices, type UIDevice, DeviceId } from "@/hooks/useDevices"
import { useRecordingExport } from "@/hooks/useRecordingExport"
import { persistence } from "@/lib/persistence"
import { UIProfileProvider, useUIProfile } from "@/lib/ui-profiles"

// Pending Operations - Optimistic UI State
enum PendingOp {
  STOP_LOCATE = 'stop_locate',
  STOP_STREAMING = 'stop_streaming',
}

interface PendingState {
  operations: Set<PendingOp>;
  disconnecting: Set<string>;
}

const PENDING_TIMEOUT_MS = 10000;

// Lazy load RPi-specific components
const DynamicIsland = lazy(() => import("@/components/DynamicIsland").then(m => ({ default: m.DynamicIsland })))
const ClientLauncher = lazy(() => import("@/components/DynamicIsland/ClientLauncher").then(m => ({ default: m.ClientLauncher })))
const ClientSnappedIsland = lazy(() => import("@/components/DynamicIsland/ClientLauncher").then(m => ({ default: m.ClientSnappedIsland })))
const ClientIframe = lazy(() => import("@/components/DynamicIsland/ClientLauncher").then(m => ({ default: m.ClientIframe })))
type ClientDisplayMode = 'closed' | 'modal' | 'minimized' | 'snapped-left' | 'snapped-right';

// Main content component (uses profile context)
function AppContent() {
  const { toast } = useToast()
  const { profile, clearOverride } = useUIProfile()
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const locateDelayTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Profile selector state
  const [isProfileSelectorOpen, setIsProfileSelectorOpen] = useState(false)

  // Derive layout flags from profile
  const isCompact = profile.layout.mode === 'split'
  const showHeader = profile.layout.showHeader
  const showDynamicIsland = profile.features.dynamicIsland
  const showClientLauncher = profile.features.clientLauncher

  // Unified device state hook
  const {
    uiDevices,
    allDevices,
    isConnected,
    isScanning,
    isSyncing,
    isStreaming,
    isLocating,
    syncProgress,
    vibratingDeviceIds,
    leftKneeData,
    rightKneeData,
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

  // UI state
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [hasStartedStreaming, setHasStartedStreaming] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [isValidatingState, setIsValidatingState] = useState(false)
  const [isValidatingLocate, setIsValidatingLocate] = useState(false)
  const [streamStartTime, setStreamStartTime] = useState<number | null>(null)
  const [streamElapsedTime, setStreamElapsedTime] = useState(0)
  const [clearChartTrigger, setClearChartTrigger] = useState(0)
  const [isTimerHovered, setIsTimerHovered] = useState(false)

  // Auto-sync before streaming overlay state
  const [autoSyncOverlay, setAutoSyncOverlay] = useState<'idle' | 'syncing' | 'countdown'>('idle')
  const [countdownNumber, setCountdownNumber] = useState(2)
  // Track devices synced this session (client-side, cleared on page refresh)
  const syncedThisSessionRef = useRef<Set<string>>(new Set())
  // Ref to track current isSyncing value (for async checks during countdown)
  const isSyncingRef = useRef(isSyncing)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const touchStartIndex = useRef<number | null>(null)
  const [deviceOrder, setDeviceOrder] = useState<string[]>([])

  // Pending operations for optimistic UI
  const [pending, setPendingState] = useState<PendingState>({
    operations: new Set(),
    disconnecting: new Set(),
  })
  const pendingTimeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Client Launcher state
  const [clientLaunched, setClientLaunched] = useState(false)
  const [clientDisplay, setClientDisplay] = useState<ClientDisplayMode>('closed')

  // Action modal state
  const [activeActionModal, setActiveActionModal] = useState<ActionId | null>(null)

  // Storage settings modal state
  const [isStorageSettingsOpen, setIsStorageSettingsOpen] = useState(false)

  // Recording export/import hook
  const {
    isExporting,
    exportCSV,
    openFile,
    openFolder,
    selectFolder,
    exportPath,
    resetPath,
    isImporting,
    importedRecording,
    importCSV,
    clearImport,
  } = useRecordingExport()

  const autoStartRef = useRef(false)

  // Web feature toast helper
  const showWebFeatureToast = useCallback(() => {
    toast({
      title: "Desktop App Required",
      description: "To scan and stream you need to download the TropX Motion app.",
      duration: 8000,
      action: (
        <ToastAction altText="Download now" onClick={() => window.open(platformInfo.downloadUrl, '_blank')}>
          Download
        </ToastAction>
      ),
    })
  }, [toast])

  // Sync isRefreshing with backend
  useEffect(() => {
    setIsRefreshing(isScanning)
  }, [isScanning])

  // Keep isSyncingRef in sync with isSyncing (for async countdown checks)
  useEffect(() => {
    isSyncingRef.current = isSyncing
  }, [isSyncing])

  // Load persisted state
  useEffect(() => {
    const savedState = persistence.loadState()
    if (savedState.deviceOrder.length > 0) {
      setDeviceOrder(savedState.deviceOrder)
    }
  }, [])

  // Save device order
  useEffect(() => {
    persistence.saveDeviceOrder(deviceOrder)
  }, [deviceOrder])

  useEffect(() => {
    persistence.saveClientDisplay(clientDisplay)
  }, [clientDisplay])

  // Save state before unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      persistence.saveStateImmediate({
        deviceOrder,
        smallScreenOverride: null,
        clientDisplay,
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [deviceOrder, clientDisplay])

  // Auto-start scan
  useEffect(() => {
    if (!isConnected || autoStartRef.current) return
    autoStartRef.current = true
    startBurstScan()
  }, [isConnected, startBurstScan])

  // Keyboard shortcuts: Ctrl+Shift+R for profile selector, Ctrl+Shift+A to reset
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
        e.preventDefault()
        setIsProfileSelectorOpen(prev => !prev)
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        clearOverride()
        toast({
          title: "Auto-Detect Mode",
          description: "Profile selection reset to automatic.",
          duration: 2000,
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clearOverride, toast])

  // Initialize device order
  const lastDeviceIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(uiDevices.map(d => d.id));
    const newDeviceIds = Array.from(currentIds).filter(id => !lastDeviceIdsRef.current.has(id));
    if (newDeviceIds.length > 0) {
      setDeviceOrder(prev => {
        if (prev.length === 0) return Array.from(currentIds);
        return [...prev, ...newDeviceIds];
      });
    }
    lastDeviceIdsRef.current = currentIds;
  }, [uiDevices]);

  // Restore streaming state
  useEffect(() => {
    if (isStreaming && !hasStartedStreaming) {
      setHasStartedStreaming(true)
      setStreamStartTime(Date.now())
    }
  }, [isStreaming, hasStartedStreaming])

  useEffect(() => {
    if (!isStreaming || streamStartTime === null) return
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - streamStartTime) / 1000)
      setStreamElapsedTime(elapsed)
    }, 1000)
    return () => clearInterval(interval)
  }, [isStreaming, streamStartTime])

  // Sort devices
  const sortedDevices = useMemo(() => {
    if (deviceOrder.length === 0) return uiDevices;
    return [...uiDevices].sort((a, b) => {
      const indexA = deviceOrder.indexOf(a.id);
      const indexB = deviceOrder.indexOf(b.id);
      if (indexA !== -1 && indexB !== -1) return indexA - indexB;
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
    const hasLeftKnee = connectedIds.has(DeviceId.LEFT_SHIN) && connectedIds.has(DeviceId.LEFT_THIGH)
    const hasRightKnee = connectedIds.has(DeviceId.RIGHT_SHIN) && connectedIds.has(DeviceId.RIGHT_THIGH)
    return hasLeftKnee || hasRightKnee
  }

  // Handlers
  const handleToggleConnection = async (index: number) => {
    if (isLocating || sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return
    const device = sortedDevices[index]
    if (!device) return

    if (device.connectionStatus === "connected" || device.connectionStatus === "connecting") {
      if (isStreaming) {
        setPendingOp(PendingOp.STOP_STREAMING)
        await stopStreaming()
      }
      setPendingDisconnect(device.id)
      await disconnectDevice(device.id)
      return
    }

    if (device.connectionStatus === "disconnected" || device.connectionStatus === "reconnecting" || device.connectionStatus === "unavailable") {
      await connectDevice(device.id, device.bleName)
    }
  }

  const handleConnectAll = async () => {
    if (isLocating || sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return
    await connectAllDevices()
  }

  const handleDisconnectAll = async () => {
    if (isLocating || sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return
    const connectedDevices = sortedDevices.filter(d => d.connectionStatus === "connected")
    if (connectedDevices.length === 0) return
    if (isStreaming) {
      setPendingOp(PendingOp.STOP_STREAMING)
      await stopStreaming()
    }
    connectedDevices.forEach(device => setPendingDisconnect(device.id))
    await Promise.all(connectedDevices.map(device => disconnectDevice(device.id)))
  }

  const handleRefresh = async () => {
    if (isWeb()) {
      showWebFeatureToast()
      return
    }
    if (isStreaming) {
      toast({ title: "Cannot Scan", description: "Stop angle streaming before scanning.", variant: "destructive", duration: 3000 })
      return
    }
    if (isLocating) {
      toast({ title: "Cannot Scan", description: "Stop locating mode before scanning.", variant: "destructive", duration: 3000 })
      return
    }
    if (isSyncing) return
    if (isRefreshing || isScanning) {
      await stopBurstScan()
      return
    }
    await startBurstScan()
  }

  const SYNC_TIMEOUT_MS = 15000
  const handleSync = async () => {
    if (isWeb()) {
      showWebFeatureToast()
      return
    }
    if (isLocating) return
    try {
      const syncPromise = syncAllDevices()
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Sync timeout')), SYNC_TIMEOUT_MS)
      })
      await Promise.race([syncPromise, timeoutPromise])
    } catch (error) {
      if (error instanceof Error && error.message === 'Sync timeout') {
        toast({ title: "Sync Timeout", description: "Sync took too long. Please try again.", variant: "destructive", duration: 4000 })
      } else {
        toast({ title: "Sync Failed", description: error instanceof Error ? error.message : "An error occurred", variant: "destructive", duration: 4000 })
      }
    }
  }

  const handleLocate = async () => {
    if (isWeb()) {
      showWebFeatureToast()
      return
    }
    if (sortedDevices.some((d) => d.connectionStatus === "synchronizing")) return
    if (isLocating) {
      if (locateDelayTimeoutRef.current) {
        clearTimeout(locateDelayTimeoutRef.current)
        locateDelayTimeoutRef.current = null
      }
      setPendingOp(PendingOp.STOP_LOCATE)
      await stopLocateMode()
      return
    }
    const connectedIndices = sortedDevices.map((device, index) => (device.connectionStatus === "connected" ? index : -1)).filter((index) => index !== -1)
    if (connectedIndices.length === 0) {
      toast({ title: "No Connected Devices", description: "Connect at least one device to use locate.", variant: "destructive", duration: 4000 })
      return
    }
    if (isRefreshing || isScanning) await stopBurstScan()
    setIsValidatingLocate(true)
    const result = await startLocateMode()
    setIsValidatingLocate(false)
    if (!result.success) {
      toast({ title: "Locate Mode Failed", description: result.error || "Failed to start locate mode", variant: "destructive", duration: 4000 })
    }
  }

  const handleToggleStreaming = async () => {
    if (isWeb()) {
      showWebFeatureToast()
      return
    }
    if (isLocating || isSyncing) return
    if (!isStreaming && !validateStreaming()) {
      toast({ title: "Cannot Start Streaming", description: "Connect at least 2 devices of the same joint type.", variant: "destructive", duration: 4000 })
      setIsFlashing(true)
      setTimeout(() => setIsFlashing(false), 1000)
      return
    }
    if (!isStreaming) {
      // Check if any connected device needs sync (not synced this session - client-side tracking)
      const connectedDevices = sortedDevices.filter(d => d.connectionStatus === "connected")
      const devicesNeedingSync = connectedDevices.filter(d => !syncedThisSessionRef.current.has(d.id))

      if (devicesNeedingSync.length > 0) {
        // Show sync overlay and auto-sync before streaming
        setAutoSyncOverlay('syncing')
        setIsValidatingState(true)

        try {
          // Run sync
          await syncAllDevices()

          // Mark all connected devices as synced this session
          connectedDevices.forEach(d => syncedThisSessionRef.current.add(d.id))

          // Wait for state to settle (STATE_UPDATE propagation delay)
          await new Promise(resolve => setTimeout(resolve, 300))

          // Sync complete - start countdown
          setAutoSyncOverlay('countdown')
          setCountdownNumber(2)

          // Helper to start streaming after countdown
          const startStreamAfterCountdown = async () => {
            setHasStartedStreaming(true)
            setStreamStartTime(Date.now())
            setStreamElapsedTime(0)
            setClearChartTrigger((prev) => prev + 1)
            const sessionId = `session_${Date.now()}`
            const result = await startStreaming(sessionId, "test_exercise", 1)
            setAutoSyncOverlay('idle')
            setIsValidatingState(false)
            if (!result.success) {
              setHasStartedStreaming(false)
              setStreamStartTime(null)
              toast({ title: "Cannot Start Streaming", description: (result as any).error || "Failed", variant: "destructive", duration: 6000 })
            }
          }

          // Countdown: 2 -> 1 -> start (with sync check)
          for (let i = 2; i >= 1; i--) {
            // Check if sync became active again (shouldn't happen, but be safe)
            if (isSyncingRef.current) {
              setAutoSyncOverlay('syncing')
              // Wait for sync to complete
              await new Promise<void>(resolve => {
                const checkSync = setInterval(() => {
                  if (!isSyncingRef.current) {
                    clearInterval(checkSync)
                    resolve()
                  }
                }, 100)
              })
              // Restart countdown
              setAutoSyncOverlay('countdown')
              i = 3 // Will decrement to 2 at loop end
              continue
            }
            setCountdownNumber(i)
            await new Promise(resolve => setTimeout(resolve, 1000))
          }

          // Final check before starting stream
          if (isSyncingRef.current) {
            setAutoSyncOverlay('syncing')
            // Wait for sync to complete then restart
            await new Promise<void>(resolve => {
              const checkSync = setInterval(() => {
                if (!isSyncingRef.current) {
                  clearInterval(checkSync)
                  resolve()
                }
              }, 100)
            })
          }

          // After countdown, start streaming
          await startStreamAfterCountdown()

        } catch (error) {
          setAutoSyncOverlay('idle')
          setIsValidatingState(false)
          toast({ title: "Sync Failed", description: error instanceof Error ? error.message : "Sync failed before streaming", variant: "destructive", duration: 4000 })
        }
        return
      }

      // No sync needed - start streaming immediately
      setIsValidatingState(true)
      setHasStartedStreaming(true)
      setStreamStartTime(Date.now())
      setStreamElapsedTime(0)
      setClearChartTrigger((prev) => prev + 1)
      const sessionId = `session_${Date.now()}`
      const result = await startStreaming(sessionId, "test_exercise", 1)
      setIsValidatingState(false)
      if (!result.success) {
        setHasStartedStreaming(false)
        setStreamStartTime(null)
        toast({ title: "Cannot Start Streaming", description: (result as any).error || "Failed", variant: "destructive", duration: 6000 })
      }
    } else {
      setPendingOp(PendingOp.STOP_STREAMING)
      await stopStreaming()
    }
  }

  const handleClearChart = () => {
    if (isStreaming) {
      setClearChartTrigger((prev) => prev + 1)
      setStreamStartTime(Date.now())
      setStreamElapsedTime(0)
    } else {
      setHasStartedStreaming(false)
      setStreamStartTime(null)
      setStreamElapsedTime(0)
    }
  }

  // Client launcher handlers
  const handleLaunchClient = () => { setClientLaunched(true); setClientDisplay('modal') }
  const handleCloseClient = () => { setClientLaunched(false); setClientDisplay('closed') }
  const handleMinimizeClient = () => { setClientDisplay('minimized') }
  const handleSnapClientLeft = () => { setClientDisplay('snapped-left') }
  const handleSnapClientRight = () => { setClientDisplay('snapped-right') }
  const handleClientBackToModal = () => { setClientDisplay('modal') }

  // Action bar handler
  const handleActionClick = async (actionId: ActionId) => {
    if (actionId === 'load') {
      if (isStreaming) {
        toast({
          title: "Cannot Load",
          description: "Stop streaming before loading a recording.",
          variant: "destructive",
          duration: 4000,
        })
        return
      }

      // Handle load directly - open file picker and import
      const result = await importCSV()
      if (result.success && result.recording) {
        // Clear streaming state to show imported data
        setHasStartedStreaming(true)
        setClearChartTrigger(prev => prev + 1)
        toast({
          title: "Recording Loaded",
          description: `${result.recording.metadata.fileName} (${result.recording.metadata.sampleCount} samples)`,
          duration: 4000,
        })
      } else if (!result.canceled && result.error) {
        toast({
          title: "Import Failed",
          description: result.error,
          variant: "destructive",
          duration: 5000,
        })
      }
      return
    }
    setActiveActionModal(actionId)
  }

  // CSV export handler
  const handleExportCSV = useCallback(async (interpolated: boolean = false) => {
    if (isStreaming) {
      toast({
        title: "Cannot Export",
        description: "Stop streaming before exporting the recording.",
        variant: "destructive",
        duration: 4000,
      })
      return
    }

    const result = await exportCSV(interpolated)

    if (result.success) {
      // Web export (no filePath, just downloaded) vs Electron export (has filePath)
      if (result.filePath) {
        toast({
          title: "Recording Exported",
          description: result.fileName,
          duration: 8000,
          action: (
            <div className="flex gap-2">
              <ToastAction altText="Open file" onClick={() => openFile(result.filePath!)}>
                Open
              </ToastAction>
              <ToastAction altText="Show in folder" onClick={() => openFolder(result.filePath!)}>
                Folder
              </ToastAction>
              <ToastAction altText="Settings" onClick={() => setIsStorageSettingsOpen(true)}>
                Settings
              </ToastAction>
            </div>
          ),
        })
      } else {
        toast({
          title: "Recording Downloaded",
          description: result.fileName,
          duration: 5000,
        })
      }
    } else {
      toast({
        title: "Export Failed",
        description: result.error || "Could not export recording",
        variant: "destructive",
        duration: 5000,
      })
    }
  }, [isStreaming, exportCSV, openFile, openFolder, toast])

  // Drag & drop handlers
  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    if (isLocating || isSyncing) return
    setDraggingIndex(index)
    setDragOverIndex(null)
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(index))
    } catch {}
  }
  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    if (isLocating || isSyncing) return
    e.preventDefault()
    if (dragOverIndex !== index && draggingIndex !== index) {
      setDragOverIndex(index)
      setDeviceOrder(prev => {
        const from = draggingIndex
        if (from === null || from === index) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(index, 0, moved)
        return next
      })
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
  const handleDragEnd = () => { setDraggingIndex(null); setDragOverIndex(null) }

  const handleTouchStart = (index: number) => (e: React.TouchEvent) => {
    if (isLocating || isSyncing) return
    const target = e.target as HTMLElement
    if (target.closest('button')) return
    touchStartY.current = e.touches[0].clientY
    touchStartIndex.current = index
    setDraggingIndex(index)
  }
  const handleTouchMove = (index: number) => (e: React.TouchEvent) => {
    if (isLocating || isSyncing) return
    if (touchStartIndex.current === null || touchStartY.current === null) return
    const currentY = e.touches[0].clientY
    const deltaY = currentY - touchStartY.current
    const cardHeight = 80
    const moveSteps = Math.round(deltaY / cardHeight)
    const newIndex = Math.max(0, Math.min(sortedDevices.length - 1, touchStartIndex.current + moveSteps))
    if (newIndex !== draggingIndex) {
      setDeviceOrder(prev => {
        const from = draggingIndex
        if (from === null || from === newIndex) return prev
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        next.splice(newIndex, 0, moved)
        return next
      })
      setDraggingIndex(newIndex)
      setDragOverIndex(newIndex)
    }
  }
  const handleTouchEnd = () => {
    touchStartY.current = null
    touchStartIndex.current = null
    setDraggingIndex(null)
    setDragOverIndex(null)
  }

  const formatElapsedTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  // Pending state helpers
  const clearPendingTimeout = useCallback((key: string) => {
    const timeout = pendingTimeoutRefs.current.get(key)
    if (timeout) { clearTimeout(timeout); pendingTimeoutRefs.current.delete(key) }
  }, [])

  const setPendingOp = useCallback((op: PendingOp) => {
    clearPendingTimeout(op)
    setPendingState(prev => ({ ...prev, operations: new Set(prev.operations).add(op) }))
    const timeout = setTimeout(() => {
      setPendingState(prev => { const next = new Set(prev.operations); next.delete(op); return { ...prev, operations: next } })
      pendingTimeoutRefs.current.delete(op)
    }, PENDING_TIMEOUT_MS)
    pendingTimeoutRefs.current.set(op, timeout)
  }, [clearPendingTimeout])

  const clearPendingOp = useCallback((op: PendingOp) => {
    clearPendingTimeout(op)
    setPendingState(prev => { const next = new Set(prev.operations); next.delete(op); return { ...prev, operations: next } })
  }, [clearPendingTimeout])

  const setPendingDisconnect = useCallback((deviceId: string) => {
    const key = `disconnect_${deviceId}`
    clearPendingTimeout(key)
    setPendingState(prev => ({ ...prev, disconnecting: new Set(prev.disconnecting).add(deviceId) }))
    const timeout = setTimeout(() => {
      setPendingState(prev => { const next = new Set(prev.disconnecting); next.delete(deviceId); return { ...prev, disconnecting: next } })
      pendingTimeoutRefs.current.delete(key)
    }, PENDING_TIMEOUT_MS)
    pendingTimeoutRefs.current.set(key, timeout)
  }, [clearPendingTimeout])

  const clearPendingDisconnect = useCallback((deviceId: string) => {
    const key = `disconnect_${deviceId}`
    clearPendingTimeout(key)
    setPendingState(prev => { const next = new Set(prev.disconnecting); next.delete(deviceId); return { ...prev, disconnecting: next } })
  }, [clearPendingTimeout])

  useEffect(() => { if (!isLocating) clearPendingOp(PendingOp.STOP_LOCATE) }, [isLocating, clearPendingOp])
  useEffect(() => { if (!isStreaming) clearPendingOp(PendingOp.STOP_STREAMING) }, [isStreaming, clearPendingOp])
  useEffect(() => {
    pending.disconnecting.forEach(deviceId => {
      const device = uiDevices.find(d => d.id === deviceId)
      if (device && device.connectionStatus === 'disconnected') clearPendingDisconnect(deviceId)
    })
  }, [uiDevices, pending.disconnecting, clearPendingDisconnect])

  const isStoppingLocate = pending.operations.has(PendingOp.STOP_LOCATE)
  const isStoppingStreaming = pending.operations.has(PendingOp.STOP_STREAMING)

  const getFillStyle = () => {
    if (connectedDevicesCount === 0) return { backgroundColor: "rgba(255, 255, 255, 0.3)" }
    if (connectedDevicesCount === 1) return { backgroundColor: "rgba(255, 77, 53, 0.15)" }
    if (connectedDevicesCount === 2) return { backgroundColor: "rgba(255, 77, 53, 0.3)" }
    if (connectedDevicesCount === 3) return { backgroundColor: "rgba(255, 77, 53, 0.6)" }
    if (connectedDevicesCount === 4) return { backgroundColor: "rgba(255, 77, 53, 1)", color: "white" }
    return {}
  }

  // Profile-based classes
  const btnClass = `${profile.spacing.buttonPx} ${profile.spacing.buttonPy} ${profile.sizing.fontSize}`
  const iconSize = profile.sizing.iconSize

  return (
    <TooltipProvider delayDuration={1500}>
      <div className={`${isCompact ? "h-screen bg-[#fff6f3] flex flex-col relative overflow-hidden" : "min-h-screen bg-[#fff6f3] flex flex-col relative"} ${showDynamicIsland ? "raspberry-pi" : ""}`}>
        {/* Draggable region */}
        <div className="fixed inset-0 w-full h-full" style={{ WebkitAppRegion: 'drag', zIndex: 1 } as any} />

        {/* Content */}
        <div className={isCompact ? "relative h-screen flex flex-col pointer-events-none" : "relative min-h-screen flex flex-col pointer-events-none"} style={{ zIndex: 2 } as any}>
          {/* Window Controls - Desktop only */}
          {isElectron() && (
            <div className="fixed top-4 right-4 flex items-center gap-1 pointer-events-auto" style={{ zIndex: 50, WebkitAppRegion: 'no-drag' } as any}>
              <button onClick={() => window.electronAPI?.window.minimize()} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm hover:bg-white transition-all shadow-sm" title="Minimize">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              </button>
              <button onClick={() => window.electronAPI?.window.maximize()} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm hover:bg-white transition-all shadow-sm" title="Maximize">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
              </button>
              <button onClick={() => window.electronAPI?.window.close()} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm hover:bg-red-500 hover:text-white transition-all shadow-sm" title="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
          )}

          <PlatformIndicator />

          {/* Header - hidden on compact layouts */}
          {showHeader && (
            <header className="p-8 pb-0 pointer-events-auto">
              <div className="flex items-start gap-3 mb-2">
                <svg width="40" height="40" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 mt-1">
                  <path d="M536.573 188.5C480.508 217.268 427.514 275.625 441.339 293.707C458.235 315.077 528.125 283.844 583.423 229.597C645.632 167.952 620.288 146.582 536.573 188.5Z" fill="var(--tropx-vibrant)" />
                  <path d="M753.405 396.365C627.93 499.319 494.412 599.86 487.977 595.838C484.76 594.229 480.738 549.187 478.325 497.71C471.89 367.409 452.587 326.388 397.892 326.388C348.828 326.388 279.656 410.038 191.985 575.73C116.378 718.9 98.6828 808.18 138.899 840.353C150.964 850.005 167.051 857.244 175.898 857.244C199.224 857.244 260.352 823.462 326.307 773.594L385.023 729.356L406.74 771.181C452.587 862.874 525.78 873.331 658.494 807.376C699.515 786.463 771.904 739.812 818.555 702.813C899.792 640.076 986.66 563.665 986.66 555.622C986.66 553.209 960.117 570.099 927.14 591.816C817.751 665.814 673.777 728.552 615.061 728.552C583.692 728.552 534.628 701.205 515.324 673.053L496.02 644.098L537.845 607.903C675.385 490.471 853.141 327.193 848.315 322.367C847.511 320.758 804.078 353.736 753.405 396.365ZM389.849 566.882C396.284 603.077 398.697 637.663 396.284 644.098C393.871 650.532 375.371 664.206 355.263 673.858C321.481 690.748 316.655 690.748 296.547 679.488C265.983 662.597 262.765 616.75 289.308 576.534C316.655 535.513 359.285 493.688 370.545 497.71C375.371 499.319 384.219 529.883 389.849 566.882Z" fill="var(--tropx-vibrant)" />
                </svg>
                <div>
                  <h1 className="text-3xl font-semibold leading-tight"><span style={{ color: "var(--tropx-dark)" }} className="italic">TropX</span></h1>
                  <p className="text-sm italic" style={{ color: "var(--tropx-shadow)" }}>Motion</p>
                </div>
              </div>
            </header>
          )}

          {/* Top Navigation Tabs - non-compact only */}
          {!isCompact && (
            <div className="pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as any}>
              <TopNavTabs />
            </div>
          )}

          <div className={isCompact ? "flex-1 flex relative pointer-events-none" : "flex-1 flex items-center justify-center px-8 relative pointer-events-none"}>
            <div className={isCompact ? "flex gap-0 w-full h-full pointer-events-none" : "flex gap-6 w-[90%] pointer-events-none"}>
              {/* Left Pane */}
              <div
                className={`flex-shrink-0 bg-white flex flex-col transition-all pointer-events-auto ${isFlashing ? "flash-pane" : ""} ${isCompact ? "w-1/2 h-full p-4" : "w-[470px] p-6"}`}
                style={{
                  border: isCompact ? "none" : "1px solid #e5e5e5",
                  borderRadius: isCompact ? "0" : "36px",
                  height: isCompact ? "100%" : "550px",
                  WebkitAppRegion: 'no-drag',
                  position: 'relative',
                  padding: clientDisplay === 'snapped-left' ? '0' : undefined,
                } as any}
              >
                {showClientLauncher && clientDisplay === 'snapped-left' ? (
                  <Suspense fallback={null}>
                    <ClientIframe className="client-iframe" />
                    <ClientSnappedIsland isLeft={true} onClose={handleCloseClient} onBackToModal={handleClientBackToModal} isStreaming={isStreaming} onToggleStreaming={handleToggleStreaming} isValidatingState={isValidatingState} isStoppingStreaming={isStoppingStreaming} />
                  </Suspense>
                ) : (
                  <>
                    <div className={isCompact ? "flex justify-between mb-3" : "flex justify-between mb-4"}>
                      <div className="flex gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={handleLocate}
                              disabled={sortedDevices.some((d) => d.connectionStatus === "synchronizing") || isStreaming || isValidatingState || isValidatingLocate || isStoppingLocate}
                              className={`${btnClass} rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]`}
                              style={{ backgroundColor: (isLocating || isStoppingLocate) ? "rgba(75, 175, 39, 0.15)" : "rgba(255, 255, 255, 0.5)", color: (isLocating || isStoppingLocate) ? "#4baf27" : "var(--tropx-shadow)", transition: "all 0.3s ease" }}
                            >
                              {(isValidatingLocate || isStoppingLocate) ? (
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                              ) : (
                                <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                              )}
                              {profile.features.textLabels && (isValidatingLocate ? "Connecting..." : isStoppingLocate ? "Stopping..." : isLocating ? "Stop Locating" : "Locate")}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent><p>Shake a device to locate it</p></TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={handleSync}
                              disabled={isLocating || isStreaming || isValidatingState || isValidatingLocate}
                              className={`${btnClass} rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md text-tropx-shadow hover:text-purple-600 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]`}
                              style={{ backgroundColor: "rgba(255, 255, 255, 0.5)", transition: "all 0.3s ease" }}
                            >
                              <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              {profile.features.textLabels && "Sync"}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent><p>Synchronize clocks between devices</p></TooltipContent>
                        </Tooltip>
                      </div>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={handleRefresh}
                            disabled={isLocating || isSyncing || isStreaming || isValidatingState || isValidatingLocate}
                            className={`${btnClass} rounded-full transition-all cursor-pointer backdrop-blur-md disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99] flex items-center gap-2`}
                            style={{ backgroundColor: isRefreshing ? "rgba(255, 77, 53, 0.15)" : "rgba(255, 255, 255, 0.5)", transition: "all 0.3s ease" }}
                          >
                            <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={`transition-transform ${isRefreshing ? "animate-spin" : ""}`} style={{ color: isRefreshing ? "var(--tropx-vibrant)" : "var(--tropx-shadow)" }}>
                              <path d="M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C14.8273 3 17.35 4.30367 19 6.34267" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path d="M19 3V6.5H15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span>Scan</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent><p>Rescan bluetooth devices</p></TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Device cards */}
                    <div className="overflow-y-auto overflow-x-hidden flex flex-col items-center gap-4 p-3 min-h-0 relative">
                      {isRefreshing && <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden"><div className="visor-scan" /></div>}
                      {isLocating && vibratingDeviceIds.length === 0 && (
                        <>
                          <div className="absolute inset-0 locate-overlay-light z-20 pointer-events-none rounded-xl" />
                          <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                            <div className="py-3 px-6 rounded-full backdrop-blur-md border border-white/30" style={{ backgroundColor: "rgba(75, 175, 39, 0.15)", color: "#4baf27", border: "1px solid #4baf27" }}>
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
                          errorMessage={device.errorMessage}
                          isStreaming={isStreaming}
                          isLocating={isLocating}
                          isLocatingTarget={isLocating && vibratingDeviceIds.includes(device.id)}
                          isReconnecting={device.isReconnecting}
                          isDisconnecting={pending.disconnecting.has(device.id)}
                          reconnectAttempts={device.reconnectAttempts}
                          disabled={isLocating || isSyncing}
                          onToggleConnection={() => handleToggleConnection(index)}
                          onRemove={async () => {
                            const result = await removeDevice(device.id);
                            if (!result.success) {
                              toast({ title: "Remove Failed", description: result.error || "Could not remove device", variant: "destructive" });
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
                          onTouchStart={handleTouchStart(index)}
                          onTouchMove={handleTouchMove(index)}
                          onTouchEnd={handleTouchEnd}
                        />
                      ))}
                    </div>

                    {/* Connect/Disconnect buttons */}
                    <div className={isCompact ? "flex gap-2 mt-4" : "flex gap-3 mt-6"}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={handleDisconnectAll} disabled={isLocating || isSyncing} className={`flex-1 ${btnClass} rounded-full border-2 border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99] flex items-center justify-center gap-2`}>
                            <svg width={isCompact ? 18 : 14} height={isCompact ? 18 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 7h2a5 5 0 0 1 0 10h-2m-6 0H7A5 5 0 0 1 7 7h2" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
                            {isCompact ? "Disconnect" : "Disconnect All"}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent><p>Disconnect all connected devices</p></TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={handleConnectAll} disabled={isLocating || isSyncing} className={`flex-1 ${btnClass} rounded-full font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99] flex items-center justify-center gap-2 ${allDevicesConnected ? "border-2 bg-transparent hover:bg-white/50" : "text-white hover:opacity-90"}`} style={allDevicesConnected ? { borderColor: "var(--tropx-vibrant)", color: "var(--tropx-vibrant)" } : { backgroundColor: "var(--tropx-vibrant)" }}>
                            <svg width={isCompact ? 18 : 14} height={isCompact ? 18 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 7h2a5 5 0 0 1 0 10h-2m-6 0H7A5 5 0 0 1 7 7h2" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                            {isCompact ? "Connect" : "Connect All"}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent><p>Connect all available devices</p></TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Dynamic Island - only on profiles with feature enabled */}
                    {showDynamicIsland && (
                      <Suspense fallback={null}>
                        <DynamicIsland expanded={false} onToggle={handleLaunchClient}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', cursor: 'pointer' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                              <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                            </svg>
                            <span style={{ fontWeight: 500 }}>Launch Client</span>
                          </div>
                        </DynamicIsland>
                      </Suspense>
                    )}
                  </>
                )}
              </div>

              {/* Right Container - holds right pane and action bar */}
              <div
                className={isCompact ? "w-1/2 h-full" : "flex-1 flex flex-col"}
                style={{ height: isCompact ? undefined : '550px' }}
              >
                {/* Right Pane */}
                <div
                  className={`bg-white gradient-diagonal flex flex-col pointer-events-auto ${clientDisplay === 'snapped-right' ? '' : 'items-center justify-center'} ${isCompact ? "h-full p-4" : "flex-1 p-6"}`}
                style={{
                  border: isCompact ? "none" : "1px solid #e5e5e5",
                  borderRadius: isCompact ? "0" : "36px",
                  WebkitAppRegion: 'no-drag',
                  position: 'relative',
                  padding: clientDisplay === 'snapped-right' ? '0' : undefined,
                } as any}
              >
                {showClientLauncher && clientDisplay === 'snapped-right' ? (
                  <Suspense fallback={null}>
                    <ClientIframe className="client-iframe" />
                    <ClientSnappedIsland isLeft={false} onClose={handleCloseClient} onBackToModal={handleClientBackToModal} isStreaming={isStreaming} onToggleStreaming={handleToggleStreaming} isValidatingState={isValidatingState} isStoppingStreaming={isStoppingStreaming} />
                  </Suspense>
                ) : (
                  <>
                    {/* Auto-sync overlay for chart area */}
                    {autoSyncOverlay !== 'idle' && (
                      <>
                        <div className="absolute inset-0 bg-white/60 z-20 pointer-events-none rounded-3xl" />
                        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
                          <div className="flex flex-col items-center gap-2">
                            <div
                              className="py-4 px-8 rounded-full backdrop-blur-md shadow-lg relative overflow-hidden"
                              style={{
                                backgroundColor: "rgba(147, 51, 234, 0.25)",
                                color: "#7c3aed",
                                border: "2px solid rgba(147, 51, 234, 0.3)",
                              }}
                            >
                              {/* Progress border overlay */}
                              {autoSyncOverlay === 'syncing' && (
                                <div
                                  className="absolute inset-0 rounded-full pointer-events-none"
                                  style={{
                                    background: (() => {
                                      const syncingDevices = sortedDevices.filter(d =>
                                        d.connectionStatus === "connected" || d.connectionStatus === "synchronizing"
                                      )
                                      if (syncingDevices.length === 0) return 'none'
                                      const totalProgress = syncingDevices.reduce((sum, d) => {
                                        const deviceProgress = syncProgress[d.id]?.progress
                                        return sum + (deviceProgress ?? 0)
                                      }, 0)
                                      const percent = Math.round(totalProgress / syncingDevices.length)
                                      // Conic gradient for circular progress border
                                      return `conic-gradient(#9333ea ${percent * 3.6}deg, transparent ${percent * 3.6}deg)`
                                    })(),
                                    mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                                    maskComposite: 'xor',
                                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                                    WebkitMaskComposite: 'xor',
                                    padding: '4px',
                                  }}
                                />
                              )}
                              <p className="text-base font-medium whitespace-nowrap relative z-10">
                                {autoSyncOverlay === 'countdown' ? countdownNumber : 'Syncing device clocks...'}
                              </p>
                            </div>
                            {autoSyncOverlay === 'syncing' && (
                              <span className="text-sm font-medium" style={{ color: "#7c3aed" }}>
                                {(() => {
                                  const syncingDevices = sortedDevices.filter(d =>
                                    d.connectionStatus === "connected" || d.connectionStatus === "synchronizing"
                                  )
                                  if (syncingDevices.length === 0) return '0%'
                                  const totalProgress = syncingDevices.reduce((sum, d) => {
                                    const deviceProgress = syncProgress[d.id]?.progress
                                    return sum + (deviceProgress ?? 0)
                                  }, 0)
                                  return `${Math.round(totalProgress / syncingDevices.length)}%`
                                })()}
                              </span>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                    {isStreaming || hasStartedStreaming ? (
                      <KneeAreaChart
                        leftKnee={leftKneeData}
                        rightKnee={rightKneeData}
                        clearTrigger={clearChartTrigger}
                        importedData={importedRecording?.samples}
                      />
                    ) : (
                      <ChartSvg />
                    )}

                    <div className={isCompact ? "mt-4 flex items-center gap-2" : "mt-8 flex items-center gap-3"}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={handleToggleStreaming}
                            disabled={isLocating || isSyncing || isValidatingState || isValidatingLocate || isStoppingStreaming}
                            className={`${isCompact ? "px-7 py-4 text-lg" : "px-6 py-3 text-base"} rounded-full font-medium transition-all cursor-pointer flex items-center gap-2 backdrop-blur-md border border-white/50 hover:border-white/60 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.99]`}
                            style={getFillStyle()}
                          >
                            {isValidatingState ? (
                              <>
                                <svg className={isCompact ? "animate-spin h-6 w-6" : "animate-spin h-5 w-5"} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                {!isCompact && "Connecting..."}
                              </>
                            ) : isStoppingStreaming ? (
                              <>
                                <svg className={isCompact ? "animate-spin h-6 w-6" : "animate-spin h-5 w-5"} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                {!isCompact && "Stopping..."}
                              </>
                            ) : isStreaming ? (
                              <>
                                <svg width={isCompact ? 18 : 14} height={isCompact ? 18 : 14} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="4" height="10" rx="1" fill="currentColor" /><rect x="9" y="3" width="4" height="10" rx="1" fill="currentColor" /></svg>
                                {isCompact ? "Stop" : "Stop Streaming"}
                              </>
                            ) : (
                              <>
                                <svg width={isCompact ? 18 : 14} height={isCompact ? 18 : 14} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 2L13 8L4 14V2Z" fill="currentColor" /></svg>
                                {isCompact ? "Start" : "Start Streaming"}
                              </>
                            )}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent><p>Stream joint angle data from connected devices</p></TooltipContent>
                      </Tooltip>

                      {hasStartedStreaming && streamStartTime !== null && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={handleClearChart}
                              onMouseEnter={() => setIsTimerHovered(true)}
                              onMouseLeave={() => setIsTimerHovered(false)}
                              className={`${isCompact ? "px-5 py-4" : "px-4 py-3"} rounded-full font-medium flex items-center gap-2 backdrop-blur-md border transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.99]`}
                              style={{ backgroundColor: isTimerHovered ? "rgba(239, 68, 68, 0.15)" : "rgba(255, 255, 255, 0.5)", color: isTimerHovered ? "#dc2626" : "var(--tropx-shadow)", borderColor: isTimerHovered ? "#ef4444" : "rgba(255, 255, 255, 0.5)" }}
                            >
                              <svg width={isCompact ? 20 : 16} height={isCompact ? 20 : 16} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="M12 6v6l4 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                              <span className={isCompact ? "text-lg" : "text-base"}>{isTimerHovered ? "Clear" : formatElapsedTime(streamElapsedTime)}</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent><p>{isStreaming ? "Clear chart data and restart timer" : "Clear chart and return to default view"}</p></TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </>
                )}
                </div>

                {/* Action Bar - non-compact only */}
                {!isCompact && (
                  <ActionBar
                    onActionClick={handleActionClick}
                    onExportCSV={handleExportCSV}
                    isExporting={isExporting}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Client Launcher modal */}
        {showClientLauncher && (
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
              isStreaming={isStreaming}
              onToggleStreaming={handleToggleStreaming}
              isValidatingState={isValidatingState}
              isStoppingStreaming={isStoppingStreaming}
            />
          </Suspense>
        )}

        {/* Profile Selector */}
        <ProfileSelector isOpen={isProfileSelectorOpen} onClose={() => setIsProfileSelectorOpen(false)} />

        {/* Action Modal */}
        <ActionModal
          actionId={activeActionModal}
          open={activeActionModal !== null}
          onOpenChange={(open) => !open && setActiveActionModal(null)}
        />

        {/* Storage Settings Modal */}
        <StorageSettingsModal
          open={isStorageSettingsOpen}
          onOpenChange={setIsStorageSettingsOpen}
          currentPath={exportPath}
          onSelectFolder={selectFolder}
          onResetPath={resetPath}
        />
      </div>
    </TooltipProvider>
  )
}

// Root component wraps with provider
export default function Page() {
  return (
    <UIProfileProvider>
      <AppContent />
    </UIProfileProvider>
  )
}
