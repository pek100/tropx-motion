import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer
} from 'recharts';
import { Check } from 'lucide-react';
import { UICircularBuffer, DataPoint } from '../utils/UICircularBuffer';
import { uiEventLoopMonitor } from '../utils/UIEventLoopMonitor';
import { streamingLogger } from '../utils/StreamingPerformanceLogger';
import { withPerformanceProfiler, useRenderTracking } from '../utils/ReactPerformanceProfiler';

const ANGLE_CONSTRAINTS = {
  MIN: -20,
  MAX: 200,
  STRAIGHT_LEG: 0,
  FULLY_BENT: 180
};

const TIME_CONSTRAINTS = {
  WINDOW_MS: 160 * 1000, // 160 seconds (20 * 8)
  MS_TO_SECONDS: 1000
};

const CHART_LAYOUT = {
  MARGINS: { top: 10, right: 30, left: 0, bottom: 0 },
  Y_AXIS_TICKS: [-20, 0, 45, 90, 135, 180],
  STROKE_WIDTH: 2,
  GRID_DASH_ARRAY: "3 3",
  FONT_SIZE: 12
};

const OPACITY = {
  AREA_FILL_PRIMARY: 0.2,
  AREA_FILL_SECONDARY: 0.1,
  TOOLTIP_BACKGROUND: 0.8
};

const Colors = {
  LEFT_KNEE_PRIMARY: '#2563eb',
  LEFT_KNEE_SECONDARY: '#93c5fd',
  RIGHT_KNEE_PRIMARY: '#dc2626',
  RIGHT_KNEE_SECONDARY: '#fca5a5',
  GRID_COLOR: '#E5E7EB',
  TEXT_COLOR: '#6B7280',
  REFERENCE_LINE: '#9CA3AF',
  BLUE_BG: 'bg-blue-50',
  BLUE_TEXT: 'text-blue-700',
  BLUE_RING: 'ring-blue-700/10',
  BLUE_HOVER: 'hover:bg-blue-100',
  RED_BG: 'bg-red-50',
  RED_TEXT: 'text-red-700',
  RED_RING: 'ring-red-700/10',
  RED_HOVER: 'hover:bg-red-100',
  GRAY_BG: 'bg-gray-50',
  GRAY_TEXT: 'text-gray-500',
  GRAY_HOVER: 'hover:bg-gray-100',
  GRAY_RING: 'ring-gray-200'
};

const DataKeys = {
  TIME: 'time',
  LEFT_ANGLE: 'leftAngle',
  RIGHT_ANGLE: 'rightAngle'
};

const Labels = {
  LEFT_KNEE: 'Left Knee',
  RIGHT_KNEE: 'Right Knee',
  STRAIGHT_REFERENCE: 'Straight',
  ANGLE_UNIT: '°'
};

const CssClasses = {
  BUTTON_BASE: 'px-4 py-1.5 rounded-full text-sm font-medium transition-all shadow-sm inline-flex items-center gap-2',
  TOOLTIP_CONTAINER: 'bg-white/80 backdrop-blur-sm p-3 border border-gray-100 shadow-lg rounded-lg',
  TOOLTIP_TIME: 'text-sm font-medium text-gray-600 mb-2',
  TOOLTIP_CONTENT: 'space-y-1',
  TOOLTIP_VALUE: 'text-sm font-medium',
  FLEX_CONTROLS: 'flex items-center gap-2 mb-4',
  FLEX_ITEMS_GAP: 'flex items-center gap-2',
  CHART_CONTAINER: 'w-full h-full'
};

const TimeFormat = {
  OPTIONS: {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  } as const
};

interface KneeData {
  current: number;
  max?: number;
  min?: number;
  rom?: number;
  sensorTimestamp?: number;
  lastUpdate?: number;
}

interface KneeAreaChartProps {
  leftKnee?: KneeData;
  rightKnee?: KneeData;
  isRecording?: boolean;
  recordingStartTime?: Date | null;
  useSensorTimestamps?: boolean;
}

interface ChartDataPoint extends DataPoint {
  time: number;
  leftAngle: number;
  rightAngle: number;
  _updateId: number;
}

/** Configuration for rendering left and right knee data */
const KNEE_CONFIGS = [
  {
    key: 'left',
    label: Labels.LEFT_KNEE,
    dataKey: DataKeys.LEFT_ANGLE,
    primaryColor: Colors.LEFT_KNEE_PRIMARY,
    secondaryColor: Colors.LEFT_KNEE_SECONDARY,
    buttonColors: {
      active: `${Colors.BLUE_BG} ${Colors.BLUE_TEXT} ring-1 ${Colors.BLUE_RING} ${Colors.BLUE_HOVER}`,
      inactive: `${Colors.GRAY_BG} ${Colors.GRAY_TEXT} ${Colors.GRAY_HOVER} ring-1 ${Colors.GRAY_RING}`
    }
  },
  {
    key: 'right',
    label: Labels.RIGHT_KNEE,
    dataKey: DataKeys.RIGHT_ANGLE,
    primaryColor: Colors.RIGHT_KNEE_PRIMARY,
    secondaryColor: Colors.RIGHT_KNEE_SECONDARY,
    buttonColors: {
      active: `${Colors.RED_BG} ${Colors.RED_TEXT} ring-1 ${Colors.RED_RING} ${Colors.RED_HOVER}`,
      inactive: `${Colors.GRAY_BG} ${Colors.GRAY_TEXT} ${Colors.GRAY_HOVER} ring-1 ${Colors.GRAY_RING}`
    }
  }
];

const COMMON_AREA_PROPS = {
  yAxisId: 'angle',
  type: 'monotone' as const,
  strokeWidth: CHART_LAYOUT.STROKE_WIDTH,
  baseValue: ANGLE_CONSTRAINTS.STRAIGHT_LEG,
  isAnimationActive: false,
  connectNulls: true
};

/** Real-time knee angle visualization with 1 decimal precision */
const KneeAreaChart: React.FC<KneeAreaChartProps> = ({
  leftKnee,
  rightKnee,
  isRecording = false,
  recordingStartTime,
  useSensorTimestamps = true
}) => {
  // Track component render performance
  useRenderTracking('KneeAreaChart');

  const [kneeVisibility, setKneeVisibility] = useState({
    left: true,
    right: true
  });

  // Replace blocking array state with UICircularBuffer
  // Buffer size: 400 points (50 * 8) for 160 second window at ~2.5 Hz display rate
  const dataBufferRef = useRef<UICircularBuffer<ChartDataPoint>>(
    new UICircularBuffer<ChartDataPoint>(400, TIME_CONSTRAINTS.WINDOW_MS)
  );
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const updateCounterRef = useRef(0);

  /** Toggles visibility of individual knee data series */
  const toggleKneeVisibility = (kneeKey: string) => {
    setKneeVisibility(prev => ({
      ...prev,
      [kneeKey as keyof typeof prev]: !prev[kneeKey as keyof typeof prev]
    }));
  };

  /** Rounds angle to 1 decimal place for chart display */
  const roundToOneDecimal = (value: number) => Math.round(value * 10) / 10;

  /** Gets the appropriate timestamp based on configuration */
  const getTimestamp = (leftKnee?: KneeData, rightKnee?: KneeData) => {
    if (useSensorTimestamps && (leftKnee || rightKnee)) {
      const leftTimestamp = leftKnee?.sensorTimestamp;
      const rightTimestamp = rightKnee?.sensorTimestamp;

      if (leftTimestamp && rightTimestamp) {
        return Math.max(leftTimestamp, rightTimestamp);
      }
      return leftTimestamp || rightTimestamp || Date.now();
    }
    return Date.now();
  };

  /** Constrains values within physiological angle limits */
  const clampValue = (value: number) => Math.max(ANGLE_CONSTRAINTS.MIN, Math.min(ANGLE_CONSTRAINTS.MAX, value));

  // Use requestAnimationFrame for smooth updates and throttling
  const animationFrameRef = useRef<number>();
  
  /**
   * NON-BLOCKING data update using UICircularBuffer - O(1) operation
   * Eliminates array spreading and slicing that blocks rendering
   */
  const updateData = useCallback(() => {
    if (!leftKnee && !rightKnee) {
      // DISABLED for performance (called at 100Hz)
      // console.log('📊 [CHART_DEBUG] No knee data - skipping update', { leftKnee, rightKnee });
      return;
    }

    // DISABLED for performance (called at 100Hz)
    // console.log('📊 [CHART_DEBUG] Chart update triggered', {
    //   leftKneeValue: leftKnee?.current,
    //   rightKneeValue: rightKnee?.current,
    //   updateCounter: updateCounterRef.current
    // });

    const trackingId = streamingLogger.startOperation('data_update', 'KneeAreaChart', 'updateData', {
      leftKneeValue: leftKnee?.current,
      rightKneeValue: rightKnee?.current,
      updateCounter: updateCounterRef.current
    });

    const start = performance.now();
    const timestamp = getTimestamp(leftKnee, rightKnee);
    updateCounterRef.current++;

    // Track data update frequency
    uiEventLoopMonitor.recordDataUpdate('KneeAreaChart');

    // Create new data point with 1 decimal rounding
    const newDataPoint: ChartDataPoint = {
      time: timestamp,
      leftAngle: roundToOneDecimal(clampValue(leftKnee?.current || ANGLE_CONSTRAINTS.STRAIGHT_LEG)),
      rightAngle: roundToOneDecimal(clampValue(rightKnee?.current || ANGLE_CONSTRAINTS.STRAIGHT_LEG)),
      _updateId: updateCounterRef.current // Force uniqueness
    };

    // PERFORMANCE CRITICAL: O(1) buffer operation - never blocks!
    dataBufferRef.current.push(newDataPoint);

    // Update chart data from buffer - only when needed
    const newChartData = dataBufferRef.current.getChartData(timestamp);
    setChartData(newChartData);

    // Monitor for blocking operations in UI updates
    const duration = performance.now() - start;

    // Track chart render - this triggers a React re-render of the chart
    uiEventLoopMonitor.recordChartRender('KneeAreaChart', duration);

    if (duration > 5) {
      uiEventLoopMonitor.recordBlockingEvent(
        'CHART_DATA_UPDATE',
        'KneeAreaChart',
        duration,
        {
          dataPointsCount: newChartData.length,
          updateCounter: updateCounterRef.current
        }
      );
    }

    streamingLogger.endOperation(trackingId, JSON.stringify(newDataPoint).length);

  }, [leftKnee, rightKnee]);

  /** Updates real-time data stream with smooth 60fps updates */
  useEffect(() => {
    // DISABLED for performance (called at 100Hz)
    // console.log('📊 [CHART_DEBUG] useEffect triggered', {
    //   hasLeftKnee: !!leftKnee,
    //   hasRightKnee: !!rightKnee,
    //   leftKneeValue: leftKnee?.current,
    //   rightKneeValue: rightKnee?.current,
    //   leftTimestamp: leftKnee?.sensorTimestamp,
    //   rightTimestamp: rightKnee?.sensorTimestamp
    // });

    if (!leftKnee && !rightKnee) {
      // DISABLED for performance (called at 100Hz)
      // console.log('📊 [CHART_DEBUG] No knee data in useEffect - early return');
      return;
    }

    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Schedule update on next animation frame (smooth 60fps)
    animationFrameRef.current = requestAnimationFrame(updateData);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    leftKnee?.current,
    rightKnee?.current,
    leftKnee?.sensorTimestamp,
    rightKnee?.sensorTimestamp,
    updateData
  ]);

  /** Formats Y-axis labels with degree symbol */
  const formatYAxis = (value: number) => `${value}${Labels.ANGLE_UNIT}`;

  /** Renders visibility toggle button for knee data series */
  const renderToggleButton = (config: typeof KNEE_CONFIGS[0]) => {
    const isVisible = kneeVisibility[config.key as keyof typeof kneeVisibility];
    return (
      <button
        key={config.key}
        onClick={() => toggleKneeVisibility(config.key)}
        className={`${CssClasses.BUTTON_BASE} ${isVisible ? config.buttonColors.active : config.buttonColors.inactive}`}
      >
        <span className={CssClasses.FLEX_ITEMS_GAP}>
          {config.label}
          {isVisible && <Check className="w-4 h-4" />}
        </span>
      </button>
    );
  };

  /** Renders primary and secondary area components for knee data */
  const renderKneeAreas = (config: typeof KNEE_CONFIGS[0]) => {
    if (!kneeVisibility[config.key as keyof typeof kneeVisibility]) return null;

    return (
      <React.Fragment key={config.key}>
        <Area
          {...COMMON_AREA_PROPS}
          dataKey={config.dataKey}
          stroke={config.primaryColor}
          fillOpacity={OPACITY.AREA_FILL_PRIMARY}
          fill={config.primaryColor}
          name={config.dataKey}
        />
        <Area
          {...COMMON_AREA_PROPS}
          dataKey={config.dataKey}
          stroke={config.secondaryColor}
          fillOpacity={OPACITY.AREA_FILL_SECONDARY}
          fill={config.secondaryColor}
        />
      </React.Fragment>
    );
  };

  /** Custom tooltip with 1 decimal precision display */
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const time = new Date(payload[0].payload.time);

      const uniquePayload = payload.reduce((acc: any, entry: any) => {
        acc[entry.dataKey] = entry;
        return acc;
      }, {});

      const formatAngle = (value: number) => value.toFixed(1); // 1 decimal place

      const renderTooltipEntry = (config: typeof KNEE_CONFIGS[0]) => {
        const payloadEntry = uniquePayload[config.dataKey];
        if (!payloadEntry) return null;

        return (
          <div key={config.key} className={CssClasses.TOOLTIP_VALUE}>
            <span style={{ color: config.primaryColor }}>
              {config.label}: {formatAngle(payloadEntry.value)}{Labels.ANGLE_UNIT}
            </span>
          </div>
        );
      };

      return (
        <div className={CssClasses.TOOLTIP_CONTAINER}>
          <div className={CssClasses.TOOLTIP_TIME}>
            {time.toLocaleTimeString([], TimeFormat.OPTIONS)}
          </div>
          <div className={CssClasses.TOOLTIP_CONTENT}>
            {KNEE_CONFIGS.map(renderTooltipEntry)}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={CssClasses.CHART_CONTAINER}>
      <div className={CssClasses.FLEX_CONTROLS}>
        {KNEE_CONFIGS.map(renderToggleButton)}
      </div>

      <ResponsiveContainer width="100%" height="90%">
        <ComposedChart
          data={chartData}
          margin={CHART_LAYOUT.MARGINS}
        >
          <CartesianGrid
            strokeDasharray={CHART_LAYOUT.GRID_DASH_ARRAY}
            stroke={Colors.GRID_COLOR}
            vertical={false}
          />

          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(time) => {
              return new Date(time).toLocaleTimeString([], TimeFormat.OPTIONS);
            }}
            interval="preserveStartEnd"
            tick={{ fill: Colors.TEXT_COLOR, fontSize: CHART_LAYOUT.FONT_SIZE }}
            axisLine={{ stroke: Colors.GRID_COLOR }}
            tickLine={{ stroke: Colors.GRID_COLOR }}
          />

          <YAxis
            yAxisId="angle"
            domain={[ANGLE_CONSTRAINTS.MIN, ANGLE_CONSTRAINTS.FULLY_BENT]}
            reversed={true}
            tickFormatter={formatYAxis}
            ticks={CHART_LAYOUT.Y_AXIS_TICKS}
            tick={{ fill: Colors.TEXT_COLOR, fontSize: CHART_LAYOUT.FONT_SIZE }}
            axisLine={{ stroke: Colors.GRID_COLOR }}
            tickLine={{ stroke: Colors.GRID_COLOR }}
          />

          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: Colors.TEXT_COLOR, strokeDasharray: CHART_LAYOUT.GRID_DASH_ARRAY }}
          />

          <ReferenceLine
            y={ANGLE_CONSTRAINTS.STRAIGHT_LEG}
            yAxisId="angle"
            stroke={Colors.REFERENCE_LINE}
            strokeDasharray={CHART_LAYOUT.GRID_DASH_ARRAY}
            label={{ value: Labels.STRAIGHT_REFERENCE, position: 'top' }}
          />

          {KNEE_CONFIGS.map(renderKneeAreas)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

// Wrap component with performance profiler for React render tracking
export default withPerformanceProfiler(KneeAreaChart, 'KneeAreaChart');