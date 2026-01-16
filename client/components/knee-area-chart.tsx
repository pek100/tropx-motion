"use client"

import React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { ComposedChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip } from "recharts"
import { ChartContainer } from "@/components/ui/chart"
import { Check } from "lucide-react"

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

// Use CSS variables for knee colors (single source of truth in globals.css)
const Colors = {
  LEFT_KNEE_PRIMARY: "var(--leg-left-band)",
  RIGHT_KNEE_PRIMARY: "var(--leg-right-band)",
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

  const dataBufferRef = useRef<SimpleCircularBuffer<ChartDataPoint>>(
    new SimpleCircularBuffer<ChartDataPoint>(MAX_DATA_POINTS),
  )

  const updateCounterRef = useRef(0)

  const animationFrameRef = useRef<number>()

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

  const updateData = useCallback(() => {
    if (!leftKnee && !rightKnee) {
      return
    }

    const timestamp = getTimestamp(leftKnee, rightKnee)
    updateCounterRef.current++

    const newDataPoint: ChartDataPoint = {
      time: timestamp,
      leftAngle: roundToOneDecimal(clampValue(leftKnee?.current || ANGLE_CONSTRAINTS.STRAIGHT_LEG)),
      rightAngle: roundToOneDecimal(clampValue(rightKnee?.current || ANGLE_CONSTRAINTS.STRAIGHT_LEG)),
      _updateId: updateCounterRef.current,
    }

    dataBufferRef.current.push(newDataPoint)

    const newChartData = dataBufferRef.current.getChartData(timestamp)
    setChartData(newChartData)
  }, [leftKnee, rightKnee, useSensorTimestamps])

  useEffect(() => {
    if (!leftKnee && !rightKnee) {
      return
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }

    animationFrameRef.current = requestAnimationFrame(updateData)

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [leftKnee, rightKnee, useSensorTimestamps])

  useEffect(() => {
    if (clearTrigger > 0) {
      dataBufferRef.current.clear()
      setChartData([])
      updateCounterRef.current = 0
    }
  }, [clearTrigger])

  const formatYAxis = (value: number) => `${value}${Labels.ANGLE_UNIT}`

  const renderToggleButton = (config: (typeof KNEE_CONFIGS)[0]) => {
    const isVisible = kneeVisibility[config.key as keyof typeof kneeVisibility]
    return (
      <button
        key={config.key}
        onClick={() => toggleKneeVisibility(config.key)}
        className={`${CssClasses.BUTTON_BASE} ${isVisible ? config.buttonColors.active : config.buttonColors.inactive}`}
      >
        {isVisible && <Check className="w-4 h-4" />}
        {config.label}
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
            <ComposedChart data={chartData} margin={CHART_LAYOUT.MARGINS}>
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
                label={{ value: "Angle (°)", angle: -90, position: "insideLeft", fill: "var(--tropx-shadow)" }}
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
