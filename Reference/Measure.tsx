// src/pages/measure/Measure.tsx - Updated import and usage
"use client"

import type React from "react"
import { useReducer, useCallback, useEffect, useMemo, useState, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import { usePatient } from "@/context/patient/PatientContext"
import { useDeviceManagement } from "@/hooks/useDeviceManagement"
import KneeAreaChart from "@/components/knee-area-chart/KneeAreaChart"
import KneeCharts from "@/components/Knee-charts/KneeCharts"
import Navbar from "@/components/navbar/Navbar" // Now properly typed
import { museManager } from "@/sdk/core/MuseManager"
import { api } from "@/services/api"
import { useMotionProcessing } from "@/services/motionProcessing/hooks/useMotionProcessing"
import UploadStatusDisplay from "./UploadStatusDisplay"
import ApiDebugPanel from "./ApiDebugPanel"
import { measurementReducer, initialMeasurementState } from "./reducer"
import {
  ActionType,
  DEVICE_TOTAL_COUNT,
  MEASUREMENT_DEFAULT_SETS_COUNT,
  ASYNC_DELAY_MS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  CONFIRMATION_MESSAGES,
  UI_TEXT,
  COLOR_PROFILES,
  CHART_SIDES,
  DEVICE_DATA_CURRENT_DEFAULT,
  DEVICE_DATA_MAX_DEFAULT,
  DEVICE_DATA_MIN_DEFAULT,
  formatMessage,
} from "./constants"
import type { StreamingCallback, RecordingQueryResponse, SessionData, ExerciseData, SdkData } from "./types"
import AIBiomechanicalModal from "@/components/ai-biomechanical-modal/AIBiomechanicalModal"

/** Normalized knee sensor data structure */
interface TransformedKneeData {
  current: number
  max: number
  min: number
  devices: string[]
}

/** Props for dual-knee chart display component */
interface ChartDisplayProps {
  leftKneeData: { current: number }
  rightKneeData: { current: number }
  transformedLeftKnee: TransformedKneeData
  transformedRightKnee: TransformedKneeData
  isRecording: boolean
  recordingStartTime: Date | null
  batteryLevels: Map<string, number>
}

/** Interface for completed recording data */
interface CompletedRecording {
  id: string
  session_instance_id: string
  exercise_instance_id: string
  set: number
  timestamp: string
  duration: number
  reps_completed: number
  joints_arr: Array<{
    id: string
    name: string
    current_angle: number
    max_angle: number
    min_angle: number
    avg_angle: number
  }>
  measurement_sequences: Array<{
    joint_id: string
    start_time: string
    values: number[]
  }>
  exerciseName?: string
  sessionName?: string
}

/** Renders side-by-side knee measurement charts */
const ChartDisplay: React.FC<ChartDisplayProps> = ({
                                                     leftKneeData,
                                                     rightKneeData,
                                                     transformedLeftKnee,
                                                     transformedRightKnee,
                                                     isRecording,
                                                     recordingStartTime,
                                                     batteryLevels,
                                                   }) => (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-12 p-4 h-[45vh]">
        <div className="w-full h-full">
          <KneeAreaChart
              leftKnee={leftKneeData}
              rightKnee={rightKneeData}
              isRecording={isRecording}
              recordingStartTime={recordingStartTime}
          />
        </div>
      </Card>
      <Card className="col-span-6 py-2 px-4 h-[40vh]">
        <div className="w-full h-full">
          <KneeCharts
              devices={transformedLeftKnee}
              side={CHART_SIDES.LEFT}
              flip={true}
              colorProfile={COLOR_PROFILES.LEFT_KNEE}
              batteryLevels={batteryLevels}
          />
        </div>
      </Card>
      <Card className="col-span-6 py-2 px-4 h-[40vh]">
        <div className="w-full h-full">
          <KneeCharts
              devices={transformedRightKnee}
              side={CHART_SIDES.RIGHT}
              colorProfile={COLOR_PROFILES.RIGHT_KNEE}
              batteryLevels={batteryLevels}
          />
        </div>
      </Card>
    </div>
)

/** Normalizes raw knee sensor data to consistent format */
const transformKneeData = (kneeData: unknown): TransformedKneeData => {
  const defaultData: TransformedKneeData = {
    current: DEVICE_DATA_CURRENT_DEFAULT,
    max: DEVICE_DATA_MAX_DEFAULT,
    min: DEVICE_DATA_MIN_DEFAULT,
    devices: [],
  }

  if (!kneeData || typeof kneeData !== "object") {
    return defaultData
  }

  if ("current" in kneeData && typeof kneeData.current === "number") {
    const data = kneeData as any
    return {
      current: data.current,
      max: data.max || DEVICE_DATA_MAX_DEFAULT,
      min: data.min || DEVICE_DATA_MIN_DEFAULT,
      devices: data.devices || [],
    }
  }

  const deviceValues = Object.values(kneeData)
  if (deviceValues.length === 0) {
    return defaultData
  }

  const firstDevice = deviceValues[0] as any
  return {
    current: firstDevice?.current || DEVICE_DATA_CURRENT_DEFAULT,
    max: firstDevice?.max || DEVICE_DATA_MAX_DEFAULT,
    min: firstDevice?.min || DEVICE_DATA_MIN_DEFAULT,
    devices: Object.keys(kneeData),
  }
}

/** Transforms recording data for AI analysis with proper structure */
const transformRecordingForAI = (recording: any): CompletedRecording => {
  try {
    // Ensure we have the required structure
    const transformedJoints =
        recording.joints_arr?.map((joint: any) => ({
          id: joint.id || `joint_${Date.now()}_${Math.random()}`,
          name: joint.joint_name || joint.name || "unknown-joint",
          current_angle: joint.max_flexion || joint.current_angle || 0,
          max_angle: joint.max_flexion || joint.max_angle || 0,
          min_angle: joint.max_extension || joint.min_angle || 0,
          avg_angle: ((joint.max_flexion || 0) + (joint.max_extension || 0)) / 2,
        })) || []

    return {
      ...recording,
      joints_arr: transformedJoints,
      // Ensure all required fields exist
      id: recording.id || `recording_${Date.now()}`,
      session_instance_id: recording.session_instance_id || "unknown_session",
      exercise_instance_id: recording.exercise_instance_id || "unknown_exercise",
      set: recording.set || 1,
      timestamp: recording.timestamp || new Date().toISOString(),
      duration: recording.duration || 0,
      reps_completed: recording.reps_completed || 0,
      measurement_sequences: recording.measurement_sequences || [],
    }
  } catch (error) {
    console.error("Error transforming recording data:", error)
    // Return minimal valid structure
    return {
      id: `fallback_${Date.now()}`,
      session_instance_id: "unknown_session",
      exercise_instance_id: "unknown_exercise",
      set: 1,
      timestamp: new Date().toISOString(),
      duration: 0,
      reps_completed: 0,
      joints_arr: [],
      measurement_sequences: [],
    }
  }
}

/** Main measurement interface for knee sensor data collection */
const Measurement: React.FC = () => {
  const { selectedPatient } = usePatient()
  const [state, dispatch] = useReducer(measurementReducer, initialMeasurementState)

  // AI Analysis Modal state management (now triggered from navbar)
  const [isAiModalOpen, setIsAiModalOpen] = useState(false)
  const [recordingData, setRecordingData] = useState<CompletedRecording | null>(null)
  const [cachedAnalysisResults, setCachedAnalysisResults] = useState<any>(null)
  const [analysisRecordingId, setAnalysisRecordingId] = useState<string | null>(null)

  const { isConnecting, connectedDevices, batteryLevels, handleConnect } = useDeviceManagement()
  const {
    kneeData,
    isRecording,
    isInitialized,
    error: motionError,
    startRecording: startMotionRecording,
    stopRecording: stopMotionRecording,
    processData,
    updateBatteryLevel,
    getQueueSize,
    coordinator,
    getLastRecording,
  } = useMotionProcessing()

  const showDebugPanel = false
  const recordingCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)

  /** Fetches completed exercise sets from API */
  const fetchCompletedSets = useCallback(async () => {
    if (!state.selectedExercise?._id || !state.selectedSession?.id) {
      dispatch({ type: ActionType.SET_COMPLETED_SETS, payload: [] })
      return
    }

    try {
      const response = (await api.recordings.query({
        session_ids: [state.selectedSession.id],
        exercise_ids: [state.selectedExercise._id],
        include: ["sessions"],
      })) as RecordingQueryResponse

      const completedSetNumbers = new Set<number>()
      if (response.success && response.data?.sessions) {
        response.data.sessions.forEach((session: any) => {
          if (session.exercise_instance_id === state.selectedExercise._id && session.set) {
            completedSetNumbers.add(session.set)
          }
        })
      }

      dispatch({
        type: ActionType.SET_COMPLETED_SETS,
        payload: Array.from(completedSetNumbers),
      })
    } catch (error) {
      dispatch({ type: ActionType.SET_COMPLETED_SETS, payload: [] })
    }
  }, [state.selectedExercise, state.selectedSession])

  /** Updates selected session and exercise, triggers set fetch */
  const selectSessionExercise = useCallback(
      async (session: SessionData, exercise: ExerciseData) => {
        dispatch({
          type: ActionType.SET_SESSION_EXERCISE,
          payload: { session, exercise },
        })

        if (exercise?._id && session?.id) {
          setTimeout(() => fetchCompletedSets(), ASYNC_DELAY_MS)
        }
      },
      [fetchCompletedSets],
  )

  /** Handles exercise set selection with re-recording confirmation */
  const handleSetChange = useCallback(
      async (setNumber: number) => {
        if (isRecording) return

        if (state.completedSets.has(setNumber)) {
          const confirmRerecord = window.confirm(
              `${UI_TEXT.SET_PREFIX}${setNumber} ${CONFIRMATION_MESSAGES.RE_RECORDING_CONFIRM}`,
          )
          if (!confirmRerecord) return

          dispatch({ type: ActionType.REMOVE_COMPLETED_SET, payload: { setNumber } })
          dispatch({ type: ActionType.SET_CURRENT_SET, payload: { setNumber } })
          await fetchCompletedSets()
        } else {
          dispatch({ type: ActionType.SET_CURRENT_SET, payload: { setNumber } })
        }
      },
      [isRecording, state.completedSets, fetchCompletedSets],
  )

  /** Creates streaming callback for real-time sensor data processing */
  const createDataCallback = useCallback((): StreamingCallback => {
    return (deviceName: string, sdkData: unknown) => {
      if (sdkData && typeof sdkData === "object" && "quaternion" in sdkData && "timestamp" in sdkData) {
        processData(deviceName, sdkData as unknown as SdkData)
      }
    }
  }, [processData])

  /** recording data monitoring */
  useEffect(() => {
    // Start monitoring for recording data when not recording
    if (!isRecording && !recordingCheckIntervalRef.current) {
      console.log("🔍 Starting recording data monitoring...")

      const DEVICE_PROCESSING_BUFFER_MS = 3000
      const POLLING_INTERVAL_MS = 4000

      const timeoutId = setTimeout(() => {
        recordingCheckIntervalRef.current = setInterval(() => {
          const latestRecording = getLastRecording()
          if (latestRecording) {
            console.log("📊 Found recording data:", {
              id: latestRecording.id,
              jointsCount: latestRecording.joints_arr?.length || 0,
              measurementsCount: latestRecording.measurement_sequences?.length || 0,
            })

            // Update recording data if it's new or different
            if (!recordingData || recordingData.id !== latestRecording.id) {
              const transformedData = transformRecordingForAI(latestRecording)
              setRecordingData(transformedData)

              // Clear cached analysis if this is a new recording
              if (analysisRecordingId !== transformedData.id) {
                setCachedAnalysisResults(null)
                setAnalysisRecordingId(null)
                console.log("🗑️ Cleared cached analysis for new recording")
              }

              console.log("✅ Recording data updated in component state")
            }
          } else if (recordingData) {
            // Clear old recording data if no new data is available
            console.log("📭 No recording data available, clearing old data")
            setRecordingData(null)
          }
        }, POLLING_INTERVAL_MS)
      }, DEVICE_PROCESSING_BUFFER_MS)

      // Store timeout ID for cleanup (will be converted to interval)
      recordingCheckIntervalRef.current = timeoutId as any
    }

    // stop monitoring when recording starts
    if (isRecording && recordingCheckIntervalRef.current) {
      console.log("⏸️ Stopping recording data monitoring (recording in progress)")
      clearInterval(recordingCheckIntervalRef.current)
      clearTimeout(recordingCheckIntervalRef.current) // Handle both interval and timeout
      recordingCheckIntervalRef.current = null
    }

    return () => {
      if (recordingCheckIntervalRef.current) {
        clearInterval(recordingCheckIntervalRef.current)
        clearTimeout(recordingCheckIntervalRef.current) // Handle both interval and timeout
        recordingCheckIntervalRef.current = null
      }
    }
  }, [isRecording]) // Simplified dependency array prevents excessive re-runs

  /** Initiates recording session with motion processing and device streaming */
  const startRecording = useCallback(async () => {
    if (!state.selectedSession || !state.selectedExercise) {
      dispatch({
        type: ActionType.UPLOAD_FAILED,
        payload: { message: ERROR_MESSAGES.SESSION_EXERCISE_REQUIRED },
      })
      return
    }

    // Clear any previous recording data
    setRecordingData(null)

    const motionSuccess = startMotionRecording(state.selectedSession.id, state.selectedExercise._id, state.currentSet)

    if (!motionSuccess) {
      dispatch({
        type: ActionType.UPLOAD_FAILED,
        payload: { message: ERROR_MESSAGES.MOTION_RECORDING_FAILED },
      })
      return
    }

    const streamingCallback = createDataCallback()
    const streamSuccess = await museManager.startStreaming(streamingCallback)

    if (!streamSuccess) {
      stopMotionRecording()
      dispatch({
        type: ActionType.UPLOAD_FAILED,
        payload: { message: ERROR_MESSAGES.DEVICE_STREAMING_FAILED },
      })
      return
    }

    dispatch({
      type: ActionType.START_RECORDING,
      payload: { startTime: new Date() },
    })

    console.log("🎬 Recording started successfully")
  }, [
    state.selectedSession,
    state.selectedExercise,
    state.currentSet,
    startMotionRecording,
    createDataCallback,
    stopMotionRecording,
  ])

  /** Stops recording and processes data with enhanced monitoring */
  const stopRecording = useCallback(async () => {
    console.log("🛑 Stopping recording...")
    await museManager.stopStreaming()
    dispatch({ type: ActionType.STOP_RECORDING })

    try {
      const success = await stopMotionRecording()
      const queueSize = getQueueSize()
      console.log("📊 Motion recording stopped:", { success, queueSize })

      // Handle upload status
      if (success && queueSize === 0) {
        dispatch({ type: ActionType.UPLOAD_SUCCESS })
      } else if (success && queueSize > 0) {
        dispatch({
          type: ActionType.UPLOAD_PARTIAL,
          payload: {
            message: formatMessage(SUCCESS_MESSAGES.RECORDING_SAVED_WITH_QUEUE, queueSize.toString()),
          },
        })
      } else {
        dispatch({
          type: ActionType.UPLOAD_FAILED,
          payload: {
            message: formatMessage(ERROR_MESSAGES.UPLOAD_FAILED_WITH_QUEUE, queueSize.toString()),
          },
        })
      }

      await fetchCompletedSets()

      if (state.currentSet < (state.selectedExercise?.sets || MEASUREMENT_DEFAULT_SETS_COUNT)) {
        dispatch({
          type: ActionType.SET_CURRENT_SET,
          payload: { setNumber: state.currentSet + 1 },
        })
      }

      console.log("✅ Recording stopped and processing initiated")
    } catch (error) {
      console.error("❌ stopRecording error:", error)
      dispatch({
        type: ActionType.UPLOAD_FAILED,
        payload: { message: ERROR_MESSAGES.UPLOAD_FAILED_GENERAL },
      })
    }
  }, [stopMotionRecording, getQueueSize, fetchCompletedSets, state.currentSet, state.selectedExercise])

  /** Toggles recording state with error handling */
  const handleRecording = useCallback(async () => {
    try {
      if (isRecording) {
        await stopRecording()
      } else {
        await startRecording()
      }
    } catch (error: any) {
      dispatch({
        type: ActionType.UPLOAD_FAILED,
        payload: { message: `${ERROR_MESSAGES.RECORDING_FAILED_PREFIX}${error.message}` },
      })
    }
  }, [isRecording, startRecording, stopRecording])

  /** Resets recording state and stops all active processes */
  const handleReset = useCallback(async () => {
    try {
      await museManager.stopStreaming()
      stopMotionRecording()
      dispatch({ type: ActionType.RESET_ALL })
      setRecordingData(null)
    } catch (error) {
      dispatch({
        type: ActionType.UPLOAD_FAILED,
        payload: { message: ERROR_MESSAGES.RECORDING_RESET_FAILED },
      })
    }
  }, [stopMotionRecording])

  /** Handler for opening AI analysis modal (triggered from navbar) */
  const handleOpenAiAnalysis = useCallback(() => {
    console.log("🧠 Opening AI analysis modal from navbar...")

    // Get the latest recording data if available
    let analysisData: CompletedRecording | null = recordingData

    // Fallback: Try to get from coordinator
    if (!analysisData) {
      const latestRecording = getLastRecording()
      if (latestRecording) {
        console.log("📡 Using recording data from coordinator")
        const transformedData = transformRecordingForAI(latestRecording)
        setRecordingData(transformedData)
        analysisData = transformedData
      }
    }

    // Enrich data with exercise and session names
    if (analysisData) {
      analysisData.exerciseName = state.selectedExercise?.name || "Unknown Exercise"
      analysisData.sessionName = state.selectedSession?.name || "Unknown Session"
      console.log(`📝 Added exercise name to analysis: ${analysisData.exerciseName}`)
      console.log(`📝 Added session name to analysis: ${analysisData.sessionName}`)
    }

    // Always open the modal - let the modal handle the no-data state
    if (analysisData) {
      console.log(`✅ Opening modal with recording data:`, {
        id: analysisData.id,
        exerciseName: analysisData.exerciseName,
        sessionName: analysisData.sessionName,
        jointsCount: analysisData.joints_arr?.length || 0,
        measurementsCount: analysisData.measurement_sequences?.length || 0,
      })

      // Load cached results for this recording
      if (analysisData.id !== analysisRecordingId) {
        setCachedAnalysisResults(null)
        setAnalysisRecordingId(analysisData.id)
        console.log("🔄 Reset cache for recording:", analysisData.id)
      }
    } else {
      console.log("📭 Opening modal without recording data - modal will show guidance")
    }

    // Always open the modal regardless of data availability
    setIsAiModalOpen(true)
  }, [recordingData, getLastRecording, analysisRecordingId, state.selectedExercise, state.selectedSession])

  /** Enhanced handler for analysis completion with persistent storage */
  const handleAnalysisComplete = useCallback(
      (results: any) => {
        if (recordingData && recordingData.id) {
          console.log("💾 Analysis completed, results will be auto-saved by modal")
          setCachedAnalysisResults(results)
          setAnalysisRecordingId(recordingData.id)
        }
      },
      [recordingData],
  )

  /** Enhanced handler for regenerating analysis */
  const handleRegenerateAnalysis = useCallback(() => {
    console.log("🔄 Regenerating analysis - clearing local cache")
    setCachedAnalysisResults(null)
    // Modal will handle clearing its own storage
  }, [])

  /** Subscribes to device battery level updates */
  useEffect(() => {
    const unsubscribe = museManager.onBatteryLevelsUpdate((levels: Map<string, number>) => {
      levels.forEach((level, deviceId) => {
        updateBatteryLevel(deviceId, level)
      })
    })

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe()
      }
    }
  }, [updateBatteryLevel])

  /** Refreshes completed sets when session/exercise changes */
  useEffect(() => {
    if (state.selectedExercise && state.selectedSession) {
      fetchCompletedSets()
    }
  }, [state.selectedExercise, state.selectedSession, fetchCompletedSets])

  /** Cleanup streaming on component unmount */
  useEffect(() => {
    return () => {
      museManager.stopStreaming().catch(() => {})
      if (recordingCheckIntervalRef.current) {
        clearInterval(recordingCheckIntervalRef.current)
      }
    }
  }, [])

  /** Memoized knee data transformation for chart rendering */
  const chartData = useMemo(() => {
    const transformedLeft = transformKneeData(kneeData?.left)
    const transformedRight = transformKneeData(kneeData?.right)

    return {
      left: { current: transformedLeft.current },
      right: { current: transformedRight.current },
      transformedLeft,
      transformedRight,
    }
  }, [kneeData])

  // Determine if we have recording data for navbar
  const hasRecordingData = Boolean(recordingData && recordingData.id)

  if (motionError) {
    return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-red-500">
            <h2 className="text-xl font-semibold mb-2">{ERROR_MESSAGES.MOTION_PROCESSING_ERROR}</h2>
            <p>{motionError}</p>
            <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
              {ERROR_MESSAGES.PAGE_RELOAD_REQUIRED}
            </button>
          </div>
        </div>
    )
  }

  if (!isInitialized) {
    return (
        <div className="flex items-center justify-center h-screen">
          <p className="text-gray-500">{ERROR_MESSAGES.INITIALIZATION_FAILED}</p>
        </div>
    )
  }

  if (!selectedPatient) {
    return (
        <div className="flex items-center justify-center h-screen">
          <p className="text-gray-500">{ERROR_MESSAGES.PATIENT_SELECTION_REQUIRED}</p>
        </div>
    )
  }

  const totalSets = state.selectedExercise?.sets || MEASUREMENT_DEFAULT_SETS_COUNT

  return (
      <div className="h-screen flex flex-col">
        <UploadStatusDisplay uploadStatus={state.uploadStatus} uploadMessage={state.uploadMessage} />

        <ApiDebugPanel
            isVisible={showDebugPanel}
            selectedSession={state.selectedSession}
            selectedExercise={state.selectedExercise}
            currentSet={state.currentSet}
            isRecording={isRecording}
            recordingStartTime={state.recordingStartTime}
            lastRecordingStartTime={state.lastRecordingStartTime}
            coordinator={coordinator}
        />

        <div className="flex-none">
          <Navbar
              connectedCount={connectedDevices.size}
              totalDevices={DEVICE_TOTAL_COUNT}
              onConnectAll={handleConnect}
              isConnecting={isConnecting}
              isRecording={isRecording}
              onRecord={handleRecording}
              onReset={handleReset}
              onShowDevices={() => {}}
              batteryLevels={batteryLevels as any}
              onSessionExerciseSelect={selectSessionExercise as any}
              selectedSession={state.selectedSession as any}
              connectedDevices={connectedDevices as any}
              selectedExercise={state.selectedExercise as any}
              onOpenAI={handleOpenAiAnalysis}
              hasRecordingData={hasRecordingData}
              currentSet={state.currentSet}
              totalSets={totalSets}
              onSetChange={handleSetChange}
              completedSets={state.completedSets}
          />
        </div>

        {/* Charts section - SetSelector removed */}
        <ScrollArea className="flex-grow">
          <div className="p-6 max-w-[1400px] mx-auto">
            <ChartDisplay
                leftKneeData={chartData.left}
                rightKneeData={chartData.right}
                transformedLeftKnee={chartData.transformedLeft}
                transformedRightKnee={chartData.transformedRight}
                isRecording={isRecording}
                recordingStartTime={state.recordingStartTime}
                batteryLevels={batteryLevels as any}
            />
          </div>
        </ScrollArea>

        {/* AI Analysis Modal - Triggered from Navbar */}
        <AIBiomechanicalModal
            isOpen={isAiModalOpen}
            onClose={() => setIsAiModalOpen(false)}
            jointData={recordingData}
            cachedResults={cachedAnalysisResults}
            onAnalysisComplete={handleAnalysisComplete}
            onRegenerateAnalysis={handleRegenerateAnalysis}
            disableCacheLoadOnOpen={true}
        />
      </div>
  )
}

export default Measurement