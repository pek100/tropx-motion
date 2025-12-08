"use client"

import React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { ComposedChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip } from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import { Check } from "lucide-react"

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
  BUTTON_BASE:
    "px-4 py-2 rounded-full text-sm font-medium transition-all backdrop-blur-md flex items-center gap-2 cursor-pointer hover:scale-105 active:scale-95 border shadow-lg",
  FLEX_CONTROLS: "flex gap-2 mb-3 justify-center",
  CHART_CONTAINER: "w-full h-[350px] flex flex-col",
}

const TimeFormat = {
  OPTIONS: {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  } as const,
}

interface KneeData {
  current: number
  max?: number
  min?: number
  rom?: number
  sensorTimestamp?: number
  lastUpdate?: number
}

interface KneeAreaChartProps {
  leftKnee?: KneeData
  rightKnee?: KneeData
  isRecording?: boolean
  recordingStartTime?: Date | null
  useSensorTimestamps?: boolean
  clearTrigger?: number // Added clearTrigger prop to reset chart data
}

const KNEE_CONFIGS = [
  {
    key: "left",
    label: Labels.LEFT_KNEE,
    dataKey: DataKeys.LEFT_ANGLE,
    primaryColor: Colors.LEFT_KNEE_PRIMARY,
    secondaryColor: "#93c5fd",
    buttonColors: {
      active: "bg-blue-500/10 text-blue-600 border-blue-500/50 hover:bg-blue-500/20",
      inactive: "bg-white/5 text-gray-600 border-white/20 hover:bg-white/10",
    },
  },
  {
    key: "right",
    label: Labels.RIGHT_KNEE,
    dataKey: DataKeys.RIGHT_ANGLE,
    primaryColor: Colors.RIGHT_KNEE_PRIMARY,
    secondaryColor: "#fca5a5",
    buttonColors: {
      active: "bg-red-500/10 text-red-600 border-red-500/50 hover:bg-red-500/20",
      inactive: "bg-white/5 text-gray-600 border-white/20 hover:bg-white/10",
    },
  },
]

const OPACITY = {
  AREA_FILL_PRIMARY: 0.2,
  AREA_FILL_SECONDARY: 0.1,
}

const MAX_DATA_POINTS = 150

const KneeAreaChart: React.FC<KneeAreaChartProps> = ({
  leftKnee,
  rightKnee,
  isRecording = false,
  recordingStartTime,
  useSensorTimestamps = true,
  clearTrigger = 0, // Added clearTrigger prop
}) => {
  const [kneeVisibility, setKneeVisibility] = useState({
    left: true,
    right: true,
  })

  const [chartData, setChartData] = useState<ChartDataPoint[]>([])
  const [chartKey, setChartKey] = useState(0) // Force remount when chart breaks

  const dataBufferRef = useRef<SimpleCircularBuffer<ChartDataPoint>>(
    new SimpleCircularBuffer<ChartDataPoint>(MAX_DATA_POINTS),
  )

  const updateCounterRef = useRef(0)

  const animationFrameRef = useRef<number>()
  const pendingUpdateRef = useRef(false)
  const lastRenderTimeRef = useRef(0)
  const RENDER_INTERVAL_MS = 22 // 45fps throttle for Recharts performance

  // Store latest props in refs to avoid recreating updateData callback
  // This prevents 100 useEffect cleanups per second at 100Hz data rate
  const leftKneeRef = useRef(leftKnee)
  const rightKneeRef = useRef(rightKnee)

  // Keep refs in sync with props
  useEffect(() => {
    leftKneeRef.current = leftKnee
    rightKneeRef.current = rightKnee
  }, [leftKnee, rightKnee])

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

  // ARCHITECTURE: Data capture vs. rendering are decoupled for smooth visualization
  // - ALL data (100% of samples) is captured immediately in circular buffer
  // - Rendering is throttled to 45fps (22ms) - Recharts SVG is too slow for 60fps
  // - Result: No stuttering, no data loss, smooth animation
  const updateData = useCallback(() => {
    const left = leftKneeRef.current
    const right = rightKneeRef.current

    if (!left && !right) {
      trace('CHART', 'updateData skipped - no knee data');
      return
    }

    // Use sensor timestamps for accurate time axis
    const timestamp = left?.sensorTimestamp || right?.sensorTimestamp || Date.now()
    updateCounterRef.current++

    const newDataPoint: ChartDataPoint = {
      time: timestamp,
      leftAngle: roundToOneDecimal(clampValue(left?.current || ANGLE_CONSTRAINTS.STRAIGHT_LEG)),
      rightAngle: roundToOneDecimal(clampValue(right?.current || ANGLE_CONSTRAINTS.STRAIGHT_LEG)),
      _updateId: updateCounterRef.current,
    }

    trace('CHART', `updateData: left=${newDataPoint.leftAngle}, right=${newDataPoint.rightAngle}, ts=${timestamp}, updateId=${updateCounterRef.current}`);

    // CRITICAL: Capture data IMMEDIATELY (100% capture rate, no throttling)
    dataBufferRef.current.push(newDataPoint)
    trace('CHART', `Buffer push: bufferSize=${dataBufferRef.current.getSize()}`);

    // Throttle chart RE-RENDER to 30fps for Recharts performance
    // Recharts SVG rendering is expensive - 30fps is smooth enough for visualization
    // All data is still captured in buffer, just rendered less frequently
    const now = Date.now()
    if (now - lastRenderTimeRef.current < RENDER_INTERVAL_MS) {
      return // Skip render, but data is already in buffer
    }

    // Schedule chart RE-RENDER using RAF
    if (!pendingUpdateRef.current) {
      pendingUpdateRef.current = true
      trace('CHART', 'Scheduling RAF');
      animationFrameRef.current = requestAnimationFrame(() => {
        try {
          trace('CHART', 'RAF executing');
          lastRenderTimeRef.current = Date.now()
          // Render with latest data from buffer (all samples preserved)
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

  const renderToggleButton = (config: (typeof KNEE_CONFIGS)[0]) => {
    const isVisible = kneeVisibility[config.key as keyof typeof kneeVisibility]
    const currentAngle = config.key === "left" ? leftKnee?.current : rightKnee?.current
    const angleDisplay = currentAngle !== undefined ? `${Math.round(currentAngle)}°` : "--°"

    return (
      <button
        key={config.key}
        onClick={() => toggleKneeVisibility(config.key)}
        className={`${CssClasses.BUTTON_BASE} ${isVisible ? config.buttonColors.active : config.buttonColors.inactive}`}
      >
        {isVisible && <Check className="w-4 h-4" />}
        {config.label}
        <span className="font-mono font-bold ml-1">{angleDisplay}</span>
      </button>
    )
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) {
      return null
    }

    const data = payload[0].payload
    const timestamp = new Date(data.time).toLocaleTimeString([], TimeFormat.OPTIONS)

    return (
      <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg p-3">
        <p className="text-sm font-medium mb-2 text-foreground">{timestamp}</p>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: Colors.LEFT_KNEE_PRIMARY }} />
            <span className="text-sm text-foreground">
              {Labels.LEFT_KNEE}: {data.leftAngle}°
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: Colors.RIGHT_KNEE_PRIMARY }} />
            <span className="text-sm text-foreground">
              {Labels.RIGHT_KNEE}: {data.rightAngle}°
            </span>
          </div>
        </div>
      </div>
    )
  }

  const COMMON_AREA_PROPS = {
    type: "monotone" as const,
    strokeWidth: CHART_LAYOUT.STROKE_WIDTH,
    isAnimationActive: false,
    connectNulls: true,
  }

  const renderKneeAreas = (config: (typeof KNEE_CONFIGS)[0]) => {
    if (!kneeVisibility[config.key as keyof typeof kneeVisibility]) return null

    const gradientId = config.key === "left" ? "url(#colorLeft)" : "url(#colorRight)"

    return (
      <React.Fragment key={config.key}>
        <Area
          {...COMMON_AREA_PROPS}
          dataKey={config.dataKey}
          stroke={config.primaryColor}
          fillOpacity={1}
          fill={gradientId}
          name={config.label}
        />
      </React.Fragment>
    )
  }

  return (
    <div className={CssClasses.CHART_CONTAINER}>
      <div className={CssClasses.FLEX_CONTROLS}>{KNEE_CONFIGS.map(renderToggleButton)}</div>

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
              data={chartData}
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

              <Tooltip content={<CustomTooltip />} />

              <ReferenceLine
                y={ANGLE_CONSTRAINTS.STRAIGHT_LEG}
                stroke={Colors.REFERENCE_LINE}
                strokeDasharray={CHART_LAYOUT.GRID_DASH_ARRAY}
                label={{ value: Labels.STRAIGHT_REFERENCE, position: "top" }}
              />

              {KNEE_CONFIGS.map(renderKneeAreas)}
            </ComposedChart>
          </ResponsiveContainer>
        </ChartContainer>
      </div>
    </div>
  )
}

export default React.memo(KneeAreaChart)
