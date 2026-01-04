"use client"

import React from "react"
import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { ComposedChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip } from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import { ChartTooltip } from "./ChartTooltip"
import { GlossyChartControls, type Axis } from "./GlossyChartControls"
import { quaternionToAngle, type EulerAxis } from "../../../../shared/QuaternionCodec"

// Debug trace logging (disabled in production)
const DEBUG_TRACE = false;
const trace = (component: string, msg: string, data?: any) => {
  if (!DEBUG_TRACE) return;
  if (data !== undefined) {
    console.log(`[TRACE:${component}] ${msg}`, data);
  } else {
    console.log(`[TRACE:${component}] ${msg}`);
  }
};

interface ChartDataPoint {
  time: number
  leftAngle: number
  rightAngle: number
  // Multi-axis data
  left_x?: number
  left_y?: number
  left_z?: number
  right_x?: number
  right_y?: number
  right_z?: number
  _updateId: number
}

class SimpleCircularBuffer<T extends { time: number }> {
  private buffer: T[]
  private head = 0
  private size = 0
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
  }

  push(item: T): void {
    this.buffer[this.head] = item
    this.head = (this.head + 1) % this.capacity
    if (this.size < this.capacity) {
      this.size++
    }
  }

  toArray(): T[] {
    if (this.size === 0) return []
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size)
    }
    return [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)]
  }

  getChartData(currentTime: number, windowMs: number = TIME_CONSTRAINTS.WINDOW_MS): T[] {
    const cutoffTime = currentTime - windowMs
    return this.toArray().filter((point) => point.time >= cutoffTime)
  }

  clear(): void {
    this.head = 0
    this.size = 0
  }

  getSize(): number {
    return this.size
  }
}

const ANGLE_CONSTRAINTS = {
  MIN: -20,
  MAX: 200,
  STRAIGHT_LEG: 0,
  FULLY_BENT: 180,
}

const TIME_CONSTRAINTS = {
  WINDOW_MS: 160 * 1000,
  MS_TO_SECONDS: 1000,
}

const CHART_LAYOUT = {
  MARGINS: { top: 10, right: 10, left: 0, bottom: 0 },
  Y_AXIS_TICKS: [-20, 0, 45, 90, 135, 180],
  STROKE_WIDTH: 2,
  GRID_DASH_ARRAY: "3 3",
  FONT_SIZE: 12,
}

const Colors = {
  LEFT_KNEE_PRIMARY: "#2563eb",
  RIGHT_KNEE_PRIMARY: "#dc2626",
  GRID_COLOR: "#e5e5e5",
  REFERENCE_LINE: "#9CA3AF",
}

// Multi-axis mode colors (matching SessionChart)
const AXIS_COLORS = {
  x: "#d946ef", // fuchsia-500
  y: "#06b6d4", // cyan-500
  z: "#8b5cf6", // violet-500
} as const

const DataKeys = {
  TIME: "time",
  LEFT_ANGLE: "leftAngle",
  RIGHT_ANGLE: "rightAngle",
}

const Labels = {
  LEFT_KNEE: "Left Knee",
  RIGHT_KNEE: "Right Knee",
  STRAIGHT_REFERENCE: "Straight",
  ANGLE_UNIT: "°",
}

const CssClasses = {
  CHART_CONTAINER: "w-full h-[350px] flex flex-col",
}

const TimeFormat = {
  OPTIONS: {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  } as const,
}

interface Quaternion {
  w: number
  x: number
  y: number
  z: number
}

interface KneeData {
  current: number
  max?: number
  min?: number
  rom?: number
  sensorTimestamp?: number
  lastUpdate?: number
  quaternion?: Quaternion
}

interface ImportedDataPoint {
  t: number;        // timestamp (ms)
  relative: number; // relative seconds
  l: number;        // left knee angle
  r: number;        // right knee angle
}

interface KneeAreaChartProps {
  leftKnee?: KneeData
  rightKnee?: KneeData
  isRecording?: boolean
  recordingStartTime?: Date | null
  useSensorTimestamps?: boolean
  clearTrigger?: number // Added clearTrigger prop to reset chart data
  importedData?: ImportedDataPoint[] // Static imported data to display
}


const MAX_DATA_POINTS = 150

const KneeAreaChart: React.FC<KneeAreaChartProps> = ({
  leftKnee,
  rightKnee,
  isRecording = false,
  recordingStartTime,
  useSensorTimestamps = true,
  clearTrigger = 0, // Added clearTrigger prop
  importedData, // Static imported data
}) => {
  const [kneeVisibility, setKneeVisibility] = useState({
    left: true,
    right: true,
  })

  // Axis selection (matching SessionChart)
  const [selectedAxis, setSelectedAxis] = useState<Axis>("y");
  const [multiAxisMode, setMultiAxisMode] = useState(false);
  const [selectedAxes, setSelectedAxes] = useState<Set<Axis>>(new Set(["y"]));

  // Toggle axis in multi-mode
  const toggleAxis = useCallback((axis: Axis) => {
    if (multiAxisMode) {
      setSelectedAxes((prev) => {
        const next = new Set<Axis>(prev);
        if (next.has(axis)) {
          if (next.size > 1) next.delete(axis);
        } else {
          next.add(axis);
        }
        return next;
      });
    } else {
      setSelectedAxis(axis);
    }
  }, [multiAxisMode]);

  // Toggle multi-axis mode
  const toggleMultiAxisMode = useCallback(() => {
    setMultiAxisMode((prev) => {
      if (!prev) {
        setSelectedAxes(new Set([selectedAxis]));
      } else {
        const firstAxis = Array.from(selectedAxes)[0] || "y";
        setSelectedAxis(firstAxis);
      }
      return !prev;
    });
  }, [selectedAxis, selectedAxes]);

  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [chartKey, setChartKey] = useState(0) // Force remount when chart breaks

  const dataBufferRef = useRef<SimpleCircularBuffer<ChartDataPoint>>(
    new SimpleCircularBuffer<ChartDataPoint>(MAX_DATA_POINTS),
  )

  const updateCounterRef = useRef(0)

  const animationFrameRef = useRef<number>()
  const pendingUpdateRef = useRef(false)

  // Store latest props in refs to avoid recreating updateData callback
  // This prevents 100 useEffect cleanups per second at 100Hz data rate
  const leftKneeRef = useRef(leftKnee)
  const rightKneeRef = useRef(rightKnee)
  const selectedAxisRef = useRef<Axis>(selectedAxis)
  const multiAxisModeRef = useRef(multiAxisMode)
  const selectedAxesRef = useRef(selectedAxes)

  // Keep refs in sync with props/state
  useEffect(() => {
    leftKneeRef.current = leftKnee
    rightKneeRef.current = rightKnee
  }, [leftKnee, rightKnee])

  useEffect(() => {
    selectedAxisRef.current = selectedAxis
    // Clear buffer when axis changes (single mode) to avoid mixing different axis data
    if (!multiAxisModeRef.current) {
      dataBufferRef.current.clear()
      setChartData([])
    }
  }, [selectedAxis])

  useEffect(() => {
    multiAxisModeRef.current = multiAxisMode
    selectedAxesRef.current = selectedAxes
    // Clear buffer when switching modes
    dataBufferRef.current.clear()
    setChartData([])
  }, [multiAxisMode, selectedAxes])

  const toggleKneeVisibility = (kneeKey: string) => {
    setKneeVisibility((prev) => ({
      ...prev,
      [kneeKey as keyof typeof prev]: !prev[kneeKey as keyof typeof prev],
    }))
  }

  const roundToOneDecimal = (value: number) => Math.round(value * 10) / 10

  const getTimestamp = (leftKnee?: KneeData, rightKnee?: KneeData) => {
    if (useSensorTimestamps && (leftKnee || rightKnee)) {
      const leftTimestamp = leftKnee?.sensorTimestamp
      const rightTimestamp = rightKnee?.sensorTimestamp

      if (leftTimestamp && rightTimestamp) {
        return Math.max(leftTimestamp, rightTimestamp)
      }
      return leftTimestamp || rightTimestamp || Date.now()
    }
    return Date.now()
  }

  const clampValue = (value: number) => Math.max(ANGLE_CONSTRAINTS.MIN, Math.min(ANGLE_CONSTRAINTS.MAX, value))

  // Convert imported data to chart format when provided
  // Limit to prevent performance issues with large datasets
  const MAX_IMPORTED_POINTS = 5000;
  const importedChartData = useMemo(() => {
    if (!importedData || importedData.length === 0) return null;
    try {
      // Downsample if too many points
      let dataToProcess = importedData;
      if (importedData.length > MAX_IMPORTED_POINTS) {
        const step = Math.ceil(importedData.length / MAX_IMPORTED_POINTS);
        dataToProcess = importedData.filter((_, idx) => idx % step === 0);
      }
      return dataToProcess.map((point, idx) => ({
        time: point.t || idx * 10, // Use timestamp or generate from index
        leftAngle: roundToOneDecimal(clampValue(point.l ?? 0)),
        rightAngle: roundToOneDecimal(clampValue(point.r ?? 0)),
        _updateId: idx,
      }));
    } catch (err) {
      console.error('Failed to process imported data:', err);
      return null;
    }
  }, [importedData]);

  // Use imported data if available, otherwise use streaming data
  const displayData = importedChartData || chartData;

  // Helper to compute angle from quaternion or use pre-computed angle
  const getAngleFromKneeData = useCallback((data: KneeData | undefined, axis: Axis): number => {
    if (!data) return ANGLE_CONSTRAINTS.STRAIGHT_LEG

    // If axis is Y (default), use pre-computed angle
    if (axis === "y") {
      return data.current || ANGLE_CONSTRAINTS.STRAIGHT_LEG
    }

    // For X or Z axis, decode from quaternion if available
    if (data.quaternion) {
      return quaternionToAngle(data.quaternion, axis as EulerAxis)
    }

    // Fallback to current angle if no quaternion
    return data.current || ANGLE_CONSTRAINTS.STRAIGHT_LEG
  }, [])

  // Use refs in callback to avoid recreating on every prop change
  // This is critical for high-frequency updates (100Hz)
  const updateData = useCallback(() => {
    const left = leftKneeRef.current
    const right = rightKneeRef.current
    const axis = selectedAxisRef.current
    const isMultiAxis = multiAxisModeRef.current
    const axes = selectedAxesRef.current

    if (!left && !right) {
      trace('CHART', 'updateData skipped - no knee data');
      return
    }

    // Use sensor timestamps for accurate time axis
    const timestamp = left?.sensorTimestamp || right?.sensorTimestamp || Date.now()
    updateCounterRef.current++

    // Compute angles based on selected axis (decodes from quaternion for X/Z)
    const leftAngle = getAngleFromKneeData(left, axis)
    const rightAngle = getAngleFromKneeData(right, axis)

    const newDataPoint: ChartDataPoint = {
      time: timestamp,
      leftAngle: roundToOneDecimal(clampValue(leftAngle)),
      rightAngle: roundToOneDecimal(clampValue(rightAngle)),
      _updateId: updateCounterRef.current,
    }

    // In multi-axis mode, compute all selected axes
    if (isMultiAxis) {
      for (const ax of axes) {
        const leftVal = getAngleFromKneeData(left, ax)
        const rightVal = getAngleFromKneeData(right, ax)
        newDataPoint[`left_${ax}` as keyof ChartDataPoint] = roundToOneDecimal(clampValue(leftVal)) as any
        newDataPoint[`right_${ax}` as keyof ChartDataPoint] = roundToOneDecimal(clampValue(rightVal)) as any
      }
    }

    trace('CHART', `updateData: left=${newDataPoint.leftAngle}, right=${newDataPoint.rightAngle}, ts=${timestamp}, updateId=${updateCounterRef.current}`);

    // Add to buffer immediately for data integrity
    dataBufferRef.current.push(newDataPoint)
    trace('CHART', `Buffer push: bufferSize=${dataBufferRef.current.getSize()}`);

    // Schedule chart update using RAF to batch multiple updates per frame
    if (!pendingUpdateRef.current) {
      pendingUpdateRef.current = true
      trace('CHART', 'Scheduling RAF');
      animationFrameRef.current = requestAnimationFrame(() => {
        try {
          trace('CHART', 'RAF executing');
          // Use latest timestamp from buffer for window calculation
          const latestPoint = dataBufferRef.current.toArray().slice(-1)[0]
          if (latestPoint) {
            const newChartData = dataBufferRef.current.getChartData(latestPoint.time)
            setChartData(newChartData)
            trace('CHART', `Chart data updated: points=${newChartData.length}`);
          }
        } catch (error) {
          console.error('[CHART] RAF callback error:', error);
        } finally {
          // CRITICAL: Always reset pending flag, even on error
          // Without this, an error would permanently freeze the chart
          pendingUpdateRef.current = false
        }
      })
    }
  }, []) // Empty deps - uses refs for latest values

  // Trigger data update when props change
  // updateData is stable (empty deps) so this effect only runs when knee data changes
  useEffect(() => {
    if (!leftKnee && !rightKnee) {
      trace('CHART', 'useEffect skipped - no knee data');
      return
    }

    trace('CHART', `Props changed: left=${leftKnee?.current}, right=${rightKnee?.current}, leftTs=${leftKnee?.sensorTimestamp}, rightTs=${rightKnee?.sensorTimestamp}`);

    // Update data on every change - RAF batching inside updateData prevents stutter
    updateData()

    // No cleanup needed here - RAF cleanup only on unmount
    // The RAF batching mechanism handles rapid updates correctly
  }, [leftKnee, rightKnee, updateData])

  // Cleanup RAF on unmount only (not on every prop change)
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = undefined
      }
      pendingUpdateRef.current = false
    }
  }, [])

  useEffect(() => {
    if (clearTrigger > 0) {
      trace('CHART', `Clear trigger fired: ${clearTrigger}, forcing chart remount`);
      // Cancel any pending RAF and reset RAF state
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = undefined
      }
      pendingUpdateRef.current = false // CRITICAL: Reset pending flag so RAF can be scheduled again

      dataBufferRef.current.clear()
      updateCounterRef.current = 0
      setChartData([])
      // Increment chartKey to force complete remount of Recharts (fixes frozen rendering)
      setChartKey(prev => prev + 1)
    }
  }, [clearTrigger])

  const formatYAxis = (value: number) => `${value}${Labels.ANGLE_UNIT}`

  const COMMON_AREA_PROPS = {
    type: "monotone" as const,
    strokeWidth: CHART_LAYOUT.STROKE_WIDTH,
    isAnimationActive: false,
    connectNulls: true,
  }

  return (
    <div className={CssClasses.CHART_CONTAINER}>
      {/* Glossy controls bar */}
      <GlossyChartControls
        leftValue={getAngleFromKneeData(leftKnee, selectedAxis)}
        rightValue={getAngleFromKneeData(rightKnee, selectedAxis)}
        leftVisible={kneeVisibility.left}
        rightVisible={kneeVisibility.right}
        onLeftToggle={() => toggleKneeVisibility("left")}
        onRightToggle={() => toggleKneeVisibility("right")}
        selectedAxis={selectedAxis}
        multiAxisMode={multiAxisMode}
        selectedAxes={selectedAxes}
        onAxisToggle={toggleAxis}
        onMultiAxisToggle={toggleMultiAxisMode}
        className="mb-3"
      />

      <div className="flex-1 min-h-0">
        <ChartContainer
          config={{
            leftAngle: {
              label: Labels.LEFT_KNEE,
              color: Colors.LEFT_KNEE_PRIMARY,
            },
            rightAngle: {
              label: Labels.RIGHT_KNEE,
              color: Colors.RIGHT_KNEE_PRIMARY,
            },
          }}
          className="h-full w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              key={chartKey}
              data={displayData}
              margin={CHART_LAYOUT.MARGINS}
            >
              <defs>
                <linearGradient id="colorLeft" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={Colors.LEFT_KNEE_PRIMARY} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={Colors.LEFT_KNEE_PRIMARY} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorRight" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={Colors.RIGHT_KNEE_PRIMARY} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={Colors.RIGHT_KNEE_PRIMARY} stopOpacity={0} />
                </linearGradient>
                {/* Multi-axis gradients */}
                <linearGradient id="leftGradient_x" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.x} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={AXIS_COLORS.x} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="rightGradient_x" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.x} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={AXIS_COLORS.x} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="leftGradient_y" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.y} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={AXIS_COLORS.y} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="rightGradient_y" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.y} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={AXIS_COLORS.y} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="leftGradient_z" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.z} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={AXIS_COLORS.z} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="rightGradient_z" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.z} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={AXIS_COLORS.z} stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray={CHART_LAYOUT.GRID_DASH_ARRAY} stroke={Colors.GRID_COLOR} />

              <XAxis
                dataKey="time"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(time) => new Date(time).toLocaleTimeString([], TimeFormat.OPTIONS)}
                interval="preserveStartEnd"
                stroke="var(--tropx-shadow)"
                style={{ fontSize: CHART_LAYOUT.FONT_SIZE }}
                tick={{ fill: "var(--tropx-shadow)" }}
              />

              <YAxis
                domain={[ANGLE_CONSTRAINTS.MIN, ANGLE_CONSTRAINTS.FULLY_BENT]}
                reversed={true}
                tickFormatter={formatYAxis}
                ticks={CHART_LAYOUT.Y_AXIS_TICKS}
                stroke="var(--tropx-shadow)"
                style={{ fontSize: CHART_LAYOUT.FONT_SIZE }}
                tick={{ fill: "var(--tropx-shadow)" }}
              />

              <Tooltip content={<ChartTooltip timeKey="time" formatTime />} />

              <ReferenceLine
                y={ANGLE_CONSTRAINTS.STRAIGHT_LEG}
                stroke={Colors.REFERENCE_LINE}
                strokeDasharray={CHART_LAYOUT.GRID_DASH_ARRAY}
                label={{ value: Labels.STRAIGHT_REFERENCE, position: "top" }}
              />

              {/* Single-axis mode: standard left/right areas */}
              {!multiAxisMode && kneeVisibility.left && (
                <Area
                  {...COMMON_AREA_PROPS}
                  dataKey="leftAngle"
                  stroke={Colors.LEFT_KNEE_PRIMARY}
                  fill="url(#colorLeft)"
                  name={Labels.LEFT_KNEE}
                />
              )}
              {!multiAxisMode && kneeVisibility.right && (
                <Area
                  {...COMMON_AREA_PROPS}
                  dataKey="rightAngle"
                  stroke={Colors.RIGHT_KNEE_PRIMARY}
                  fill="url(#colorRight)"
                  name={Labels.RIGHT_KNEE}
                />
              )}

              {/* Multi-axis mode: alternating pattern (8px knee color, 4px axis color) */}
              {/* Layer 1: knee color segments */}
              {multiAxisMode && kneeVisibility.left && Array.from(selectedAxes).map((axis) => (
                <Area
                  key={`left_${axis}_knee`}
                  {...COMMON_AREA_PROPS}
                  dataKey={`left_${axis}`}
                  stroke={Colors.LEFT_KNEE_PRIMARY}
                  strokeDasharray="8 4"
                  fill={`url(#leftGradient_${axis})`}
                  name={`Left (${axis.toUpperCase()})`}
                  activeDot={{ r: 4, fill: AXIS_COLORS[axis], stroke: Colors.LEFT_KNEE_PRIMARY, strokeWidth: 2 }}
                  dot={false}
                />
              ))}
              {multiAxisMode && kneeVisibility.right && Array.from(selectedAxes).map((axis) => (
                <Area
                  key={`right_${axis}_knee`}
                  {...COMMON_AREA_PROPS}
                  dataKey={`right_${axis}`}
                  stroke={Colors.RIGHT_KNEE_PRIMARY}
                  strokeDasharray="8 4"
                  fill={`url(#rightGradient_${axis})`}
                  name={`Right (${axis.toUpperCase()})`}
                  activeDot={{ r: 4, fill: AXIS_COLORS[axis], stroke: Colors.RIGHT_KNEE_PRIMARY, strokeWidth: 2 }}
                  dot={false}
                />
              ))}
              {/* Layer 2: axis color segments (offset to fill gaps) - excluded from tooltip/legend */}
              {multiAxisMode && kneeVisibility.left && Array.from(selectedAxes).map((axis) => (
                <Area
                  key={`left_${axis}_axis`}
                  {...COMMON_AREA_PROPS}
                  dataKey={`left_${axis}`}
                  stroke={AXIS_COLORS[axis]}
                  strokeDasharray="4 8"
                  strokeDashoffset={-8}
                  fill="none"
                  dot={false}
                  activeDot={false}
                  legendType="none"
                />
              ))}
              {multiAxisMode && kneeVisibility.right && Array.from(selectedAxes).map((axis) => (
                <Area
                  key={`right_${axis}_axis`}
                  {...COMMON_AREA_PROPS}
                  dataKey={`right_${axis}`}
                  stroke={AXIS_COLORS[axis]}
                  strokeDasharray="4 8"
                  strokeDashoffset={-8}
                  fill="none"
                  dot={false}
                  activeDot={false}
                  legendType="none"
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </div>
  )
}

export default React.memo(KneeAreaChart)
