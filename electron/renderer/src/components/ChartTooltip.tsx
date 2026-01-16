"use client"

interface ChartTooltipProps {
  active?: boolean
  payload?: Array<{ value: number; dataKey: string; color: string }>
  timeKey?: string // Key to extract time label from payload (defaults to "timeLabel")
  formatTime?: boolean // If true, format the time value as HH:MM:SS (for raw timestamps)
}

// Axis colors matching the chart (using CSS variables from globals.css)
const AXIS_COLORS = {
  X: "var(--axis-x)", // fuchsia-500
  Y: "var(--axis-y)", // cyan-500
  Z: "var(--axis-z)", // violet-500
} as const

// Parse dataKey to get knee side and axis (e.g., "left_x" -> { knee: "Left", axis: "X" })
function parseDataKey(dataKey: string) {
  // Single-axis mode keys
  if (dataKey === "left" || dataKey === "leftAngle") return { knee: "Left", axis: null }
  if (dataKey === "right" || dataKey === "rightAngle") return { knee: "Right", axis: null }

  // Multi-axis mode keys (e.g., "left_x", "right_y")
  const match = dataKey.match(/^(left|right)_([xyz])$/)
  if (match) {
    return {
      knee: match[1] === "left" ? "Left" : "Right",
      axis: match[2].toUpperCase() as "X" | "Y" | "Z",
    }
  }
  return { knee: dataKey, axis: null }
}

export function ChartTooltip({ active, payload, timeKey = "timeLabel", formatTime = false }: ChartTooltipProps) {
  if (!active || !payload?.length) return null

  const data = (payload[0] as any)?.payload
  const rawTime = data?.[timeKey]
  const timeLabel = formatTime && typeof rawTime === "number"
    ? new Date(rawTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : rawTime

  // Filter duplicates: Layer 2 (axis color segments) use same dataKey as Layer 1
  // Keep only unique dataKeys to avoid showing duplicate values
  const seenDataKeys = new Set<string>()
  const filteredPayload = payload.filter((item) => {
    if (seenDataKeys.has(item.dataKey)) return false
    seenDataKeys.add(item.dataKey)
    return true
  })

  return (
    <div className="px-3 py-2 rounded-lg shadow-lg border border-[var(--tropx-border)] bg-[var(--tropx-card)] text-xs">
      <p className="text-[var(--tropx-text-sub)] mb-1">{timeLabel}</p>
      <div className="space-y-1">
        {filteredPayload.map((item) => {
          const { knee, axis } = parseDataKey(item.dataKey)
          return (
            <div key={item.dataKey} className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[var(--tropx-text-main)]">
                {knee}
                {axis && (
                  <>
                    {" "}
                    <span style={{ color: AXIS_COLORS[axis], fontWeight: 600 }}>{axis}</span>
                  </>
                )}
                : <strong>{item.value.toFixed(1)}°</strong>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
