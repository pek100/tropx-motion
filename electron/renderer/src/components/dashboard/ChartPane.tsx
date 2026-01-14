/**
 * ChartPane - Tabbed container for Progress and Session charts.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, Activity, Link, Unlink, RotateCcw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ProgressChart } from "./ProgressChart";
import { SessionChart } from "./SessionChart";
import type { SessionData } from "./SessionCard";
import type { PackedChunkData } from "../../../../../shared/QuaternionCodec";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

// Asymmetry event type from backend
export interface AsymmetryEvent {
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  peakAsymmetry: number;
  avgAsymmetry: number;
  direction: "left_dominant" | "right_dominant";
  area: number;
}

// Phase alignment data from backend
export interface PhaseAlignmentData {
  optimalOffsetSamples: number;
  optimalOffsetMs: number;
  optimalOffsetDegrees: number;
  alignedCorrelation: number;
  unalignedCorrelation: number;
  correlationImprovement: number;
}


export interface AsymmetryEventsData {
  sessionId: string;
  sessionStartTime: number;
  sampleRate: number;
  events: AsymmetryEvent[];
  summary: {
    avgRealAsymmetry: number;
    maxRealAsymmetry: number;
    asymmetryPercentage: number;
  };
  // Currently applied phase offset (may be manually adjusted)
  phaseOffsetMs: number;
  // Default (calculated) phase alignment data (for reset functionality)
  defaultPhaseAlignment: PhaseAlignmentData | null;
}

export type ChartTab = "progress" | "session";

interface ChartPaneProps {
  sessions: SessionData[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  sessionPreviewData: PackedChunkData | null;
  isSessionLoading?: boolean;
  selectedMetrics?: Set<string>;
  asymmetryEvents?: AsymmetryEventsData | null;
  borderless?: boolean;
  className?: string;
  /** Callback when user applies a custom phase offset (triggers server-side recalculation) */
  onPhaseOffsetApply?: (newOffsetMs: number) => void;
  /** Whether tabs are linked with AI Analysis pane */
  isLinked?: boolean;
  /** Callback when link state changes */
  onLinkedChange?: (linked: boolean) => void;
  /** Called when tab changes (so parent can sync other pane) */
  onTabChange?: (tab: ChartTab) => void;
  /** External tab to sync to when linked */
  syncToTab?: ChartTab;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DEFAULT_VISIBLE_SESSIONS = 10; // Default number of sessions to show

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function ChartPane({
  sessions,
  selectedSessionId,
  onSelectSession,
  sessionPreviewData,
  isSessionLoading,
  selectedMetrics,
  asymmetryEvents,
  borderless,
  className,
  onPhaseOffsetApply,
  isLinked = true,
  onLinkedChange,
  onTabChange,
  syncToTab,
}: ChartPaneProps) {
  const [activeTab, setActiveTab] = useState<ChartTab>("progress");

  // Sync to external tab when linked
  useEffect(() => {
    if (isLinked && syncToTab !== undefined && syncToTab !== activeTab) {
      setActiveTab(syncToTab);
    }
  }, [syncToTab, isLinked]);

  // Handle tab change
  const handleTabChange = useCallback((tab: ChartTab) => {
    setActiveTab(tab);
    if (isLinked) {
      onTabChange?.(tab);
    }
  }, [onTabChange, isLinked]);

  // Timeline state: indices into sessions array [startIdx, endIdx]
  const [isDraggingCenter, setIsDraggingCenter] = useState(false);
  const dragStartRef = useRef<{ x: number; range: [number, number] } | null>(null);

  // Total number of sessions (like sessionDuration in waveform)
  const totalSessions = sessions.length;

  // Compute default range for given session count
  const getDefaultRange = (count: number): [number, number] => {
    if (count === 0) return [0, 0];
    const startIdx = Math.max(0, count - DEFAULT_VISIBLE_SESSIONS);
    return [startIdx, count - 1];
  };

  const [timelineRange, setTimelineRange] = useState<[number, number]>(() => getDefaultRange(sessions.length));

  // Always show last 10 sessions when session count changes
  useEffect(() => {
    if (totalSessions > 0) {
      setTimelineRange(getDefaultRange(totalSessions));
    }
  }, [totalSessions]);

  // Track previous selected session to only auto-scroll on actual user selection
  const prevSelectedSessionIdRef = useRef<string | null>(null);

  // Auto-scroll timeline when selected session changes (from carousel click, not initial load)
  useEffect(() => {
    if (!selectedSessionId || totalSessions === 0) return;

    // Only auto-scroll if this is a user-initiated selection change (not initial mount)
    const isInitialMount = prevSelectedSessionIdRef.current === null;
    const isSameSession = prevSelectedSessionIdRef.current === selectedSessionId;
    prevSelectedSessionIdRef.current = selectedSessionId;

    // Skip auto-scroll on initial mount or if same session
    if (isInitialMount || isSameSession) return;

    const selectedIdx = sessions.findIndex(s => s.sessionId === selectedSessionId);
    if (selectedIdx === -1) return;

    const [startIdx, endIdx] = timelineRange;

    // If selected session is outside visible range, scroll to include it
    if (selectedIdx < startIdx || selectedIdx > endIdx) {
      const windowSize = endIdx - startIdx;
      // Center the selected session in the window
      const newStart = Math.max(0, Math.min(
        totalSessions - windowSize - 1,
        selectedIdx - Math.floor(windowSize / 2)
      ));
      const newEnd = Math.min(totalSessions - 1, newStart + windowSize);
      setTimelineRange([newStart, newEnd]);
    }
  }, [selectedSessionId, sessions, totalSessions]);

  // Filter sessions based on timeline range
  const filteredSessions = useMemo(() => {
    if (totalSessions === 0) return [];
    const [startIdx, endIdx] = timelineRange;
    return sessions.slice(startIdx, endIdx + 1);
  }, [sessions, timelineRange, totalSessions]);

  // Handle range slider change
  const handleRangeChange = useCallback((newRange: [number, number]) => {
    setTimelineRange(newRange);
  }, []);

  // Handle center drag of range slider
  const handleCenterDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    dragStartRef.current = { x: clientX, range: [...timelineRange] as [number, number] };
    setIsDraggingCenter(true);
  }, [timelineRange]);

  const handleCenterDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragStartRef.current || !isDraggingCenter) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const sliderElement = (e.target as HTMLElement)?.closest('.range-slider-container');
    const sliderWidth = sliderElement?.clientWidth || 1;
    const deltaX = clientX - dragStartRef.current.x;
    const deltaIdx = Math.round((deltaX / sliderWidth) * totalSessions);

    const windowSize = dragStartRef.current.range[1] - dragStartRef.current.range[0];
    let newStart = dragStartRef.current.range[0] + deltaIdx;
    let newEnd = dragStartRef.current.range[1] + deltaIdx;

    // Clamp to valid range
    if (newStart < 0) {
      newStart = 0;
      newEnd = windowSize;
    }
    if (newEnd > totalSessions - 1) {
      newEnd = totalSessions - 1;
      newStart = totalSessions - 1 - windowSize;
    }

    setTimelineRange([newStart, newEnd]);
  }, [isDraggingCenter, totalSessions]);

  const handleCenterDragEnd = useCallback(() => {
    setIsDraggingCenter(false);
    dragStartRef.current = null;
  }, []);

  // Add global mouse/touch listeners for center drag
  useEffect(() => {
    if (isDraggingCenter) {
      window.addEventListener('mousemove', handleCenterDragMove);
      window.addEventListener('mouseup', handleCenterDragEnd);
      window.addEventListener('touchmove', handleCenterDragMove);
      window.addEventListener('touchend', handleCenterDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleCenterDragMove);
      window.removeEventListener('mouseup', handleCenterDragEnd);
      window.removeEventListener('touchmove', handleCenterDragMove);
      window.removeEventListener('touchend', handleCenterDragEnd);
    };
  }, [isDraggingCenter, handleCenterDragMove, handleCenterDragEnd]);

  // Reset timeline to default
  const resetTimeline = useCallback(() => {
    const startIdx = Math.max(0, totalSessions - DEFAULT_VISIBLE_SESSIONS);
    setTimelineRange([startIdx, totalSessions - 1]);
  }, [totalSessions]);

  // Date picker state
  const [startDatePickerOpen, setStartDatePickerOpen] = useState(false);
  const [endDatePickerOpen, setEndDatePickerOpen] = useState(false);

  // Get date bounds from sessions for calendar constraints
  const sessionDateBounds = useMemo(() => {
    if (sessions.length === 0) return { from: undefined, to: undefined };
    return {
      from: new Date(sessions[0].recordedAt),
      to: new Date(sessions[sessions.length - 1].recordedAt),
    };
  }, [sessions]);

  // Handle start date selection - find nearest session to selected date
  const handleStartDateSelect = useCallback((date: Date | undefined) => {
    if (!date || sessions.length === 0) return;

    const targetTs = date.getTime();

    // Find the session closest to this date
    let closestIdx = 0;
    let closestDiff = Math.abs(sessions[0].recordedAt - targetTs);

    for (let i = 1; i < sessions.length; i++) {
      const diff = Math.abs(sessions[i].recordedAt - targetTs);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
    }

    setTimelineRange(prev => {
      const newStart = closestIdx;
      const newEnd = prev[1];
      // Auto-swap if inverted
      return newStart <= newEnd ? [newStart, newEnd] : [newEnd, newStart];
    });
    setStartDatePickerOpen(false);
  }, [sessions]);

  // Handle end date selection - find nearest session to selected date
  const handleEndDateSelect = useCallback((date: Date | undefined) => {
    if (!date || sessions.length === 0) return;

    const targetTs = date.getTime();

    // Find the session closest to this date
    let closestIdx = 0;
    let closestDiff = Math.abs(sessions[0].recordedAt - targetTs);

    for (let i = 1; i < sessions.length; i++) {
      const diff = Math.abs(sessions[i].recordedAt - targetTs);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIdx = i;
      }
    }

    setTimelineRange(prev => {
      const newStart = prev[0];
      const newEnd = closestIdx;
      // Auto-swap if inverted
      return newStart <= newEnd ? [newStart, newEnd] : [newEnd, newStart];
    });
    setEndDatePickerOpen(false);
  }, [sessions]);

  // Get selected session title for Session tab
  const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId);
  const sessionTitle = selectedSession?.tags[0] || "Session";

  // Handle view session (select + switch to waveform tab)
  const handleViewSession = useCallback((sessionId: string) => {
    onSelectSession(sessionId);
    handleTabChange("session");
  }, [onSelectSession, handleTabChange]);

  return (
    <div
      className={cn(
        "flex flex-col bg-[var(--tropx-card)]",
        borderless
          ? "rounded-none border-0 shadow-none sm:rounded-xl sm:border sm:border-[var(--tropx-border)] sm:shadow-sm"
          : "rounded-xl border border-[var(--tropx-border)] shadow-sm",
        className
      )}
    >
      <Tabs
        value={activeTab}
        onValueChange={(v: string) => handleTabChange(v as ChartTab)}
        className="flex flex-col h-full"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-[var(--tropx-border)]">
          <div className="min-w-0">
            <h3 className="font-bold text-base sm:text-lg text-[var(--tropx-text-main)] truncate">
              {activeTab === "progress" ? "Performance Trends" : sessionTitle}
            </h3>
            <p className="hidden sm:block text-sm text-[var(--tropx-text-sub)]">
              {activeTab === "progress"
                ? "Track your metrics across all sessions"
                : "View knee motion for this recording"}
            </p>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Date range pickers (only for Progress tab) */}
            {activeTab === "progress" && sessions.length > 0 && (
              <div className="flex items-center gap-1">
                {/* Start date picker */}
                <Popover open={startDatePickerOpen} onOpenChange={setStartDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "px-2 py-1 rounded-md text-xs sm:text-sm font-medium",
                        "bg-[var(--tropx-muted)] border border-[var(--tropx-border)]",
                        "hover:border-[var(--tropx-vibrant)] hover:text-[var(--tropx-vibrant)]",
                        "transition-colors cursor-pointer text-[var(--tropx-text-main)]"
                      )}
                    >
                      {filteredSessions[0]
                        ? new Date(filteredSessions[0].recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
                        : '—'}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-[var(--tropx-card)] border-[var(--tropx-border)]" align="start">
                    <Calendar
                      mode="single"
                      selected={sessions[timelineRange[0]] ? new Date(sessions[timelineRange[0]].recordedAt) : undefined}
                      onSelect={handleStartDateSelect}
                      defaultMonth={sessions[timelineRange[0]] ? new Date(sessions[timelineRange[0]].recordedAt) : undefined}
                    />
                  </PopoverContent>
                </Popover>

                <span className="text-[var(--tropx-text-sub)] text-xs">–</span>

                {/* End date picker */}
                <Popover open={endDatePickerOpen} onOpenChange={setEndDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className={cn(
                        "px-2 py-1 rounded-md text-xs sm:text-sm font-medium",
                        "bg-[var(--tropx-muted)] border border-[var(--tropx-border)]",
                        "hover:border-[var(--tropx-vibrant)] hover:text-[var(--tropx-vibrant)]",
                        "transition-colors cursor-pointer text-[var(--tropx-text-main)]"
                      )}
                    >
                      {filteredSessions[filteredSessions.length - 1]
                        ? new Date(filteredSessions[filteredSessions.length - 1].recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
                        : '—'}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0 bg-[var(--tropx-card)] border-[var(--tropx-border)]" align="end">
                    <Calendar
                      mode="single"
                      selected={sessions[timelineRange[1]] ? new Date(sessions[timelineRange[1]].recordedAt) : undefined}
                      onSelect={handleEndDateSelect}
                      defaultMonth={sessions[timelineRange[1]] ? new Date(sessions[timelineRange[1]].recordedAt) : undefined}
                    />
                  </PopoverContent>
                </Popover>

                <span className="text-[10px] text-[var(--tropx-text-sub)] ml-1">
                  ({filteredSessions.length}/{sessions.length})
                </span>
              </div>
            )}

            {/* Tabs */}
            <TabsList className="h-8 sm:h-9 bg-[var(--tropx-muted)]">
              <TabsTrigger
                value="progress"
                className={cn(
                  "gap-1 sm:gap-1.5 text-xs px-2 sm:px-3 transition-all",
                  activeTab === "progress" &&
                    "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white dark:bg-[var(--tropx-vibrant)] dark:text-white dark:data-[state=active]:bg-[var(--tropx-vibrant)] dark:data-[state=active]:text-white"
                )}
              >
                <TrendingUp className="size-3 sm:size-3.5" />
                <span className="hidden xs:inline sm:hidden">Trends</span>
                <span className="hidden sm:inline">All Trends</span>
              </TabsTrigger>
              <TabsTrigger
                value="session"
                className={cn(
                  "gap-1 sm:gap-1.5 text-xs px-2 sm:px-3 transition-all",
                  activeTab === "session" &&
                    "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white dark:bg-[var(--tropx-vibrant)] dark:text-white dark:data-[state=active]:bg-[var(--tropx-vibrant)] dark:data-[state=active]:text-white"
                )}
              >
                <Activity className="size-3 sm:size-3.5" />
                <span className="hidden xs:inline sm:hidden">Motion</span>
                <span className="hidden sm:inline">Waveform</span>
              </TabsTrigger>
            </TabsList>

            {/* Link toggle */}
            <button
              type="button"
              onClick={() => onLinkedChange?.(!isLinked)}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                isLinked
                  ? "text-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/10"
                  : "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] hover:bg-[var(--tropx-muted)]"
              )}
              title={isLinked ? "Unlink from AI Analysis" : "Link with AI Analysis"}
            >
              {isLinked ? <Link className="size-4" /> : <Unlink className="size-4" />}
            </button>
          </div>
        </div>

        {/* Chart Content */}
        <div className="flex-1 min-h-0">
          <TabsContent value="progress" className="h-full m-0 data-[state=inactive]:hidden p-4 flex flex-col">
            <div className="flex-1 min-h-0">
              <ProgressChart
                sessions={filteredSessions}
                selectedSessionId={selectedSessionId}
                onSelectSession={onSelectSession}
                onViewSession={handleViewSession}
                selectedMetrics={selectedMetrics}
                className="h-full"
              />
            </div>

            {/* Timeline with dual-range slider (like SessionChart) */}
            {totalSessions > 0 && (
              <div className="flex items-center gap-2 pt-3 border-t border-[var(--tropx-border)] mt-3">
                <span className="text-[10px] font-mono text-[var(--tropx-text-sub)] w-20 text-right">
                  {filteredSessions[0] ? new Date(filteredSessions[0].recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : ''}
                </span>

                {/* Dual-range slider */}
                <div className="flex-1 relative h-6 flex items-center range-slider-container">
                  {/* Track background */}
                  <div className="absolute inset-x-0 h-1.5 bg-[var(--tropx-muted)] rounded-full" />

                  {/* Selected range highlight with center drag zone */}
                  <div
                    className={cn(
                      "absolute h-1.5 rounded-full z-20 cursor-grab active:cursor-grabbing",
                      isDraggingCenter ? "cursor-grabbing" : ""
                    )}
                    style={{
                      left: `${(timelineRange[0] / (totalSessions - 1)) * 100}%`,
                      right: `${100 - (timelineRange[1] / (totalSessions - 1)) * 100}%`,
                      background: `repeating-linear-gradient(
                        90deg,
                        color-mix(in srgb, var(--tropx-vibrant) 70%, white) 0px,
                        color-mix(in srgb, var(--tropx-vibrant) 70%, white) 2px,
                        color-mix(in srgb, var(--tropx-vibrant) 40%, white) 2px,
                        color-mix(in srgb, var(--tropx-vibrant) 40%, white) 4px
                      )`,
                    }}
                    onMouseDown={handleCenterDragStart}
                    onTouchStart={handleCenterDragStart}
                  />

                  {/* Left thumb */}
                  <input
                    type="range"
                    min={0}
                    max={totalSessions - 1}
                    value={timelineRange[0]}
                    onChange={(e) => {
                      const newStart = Math.min(parseInt(e.target.value), timelineRange[1]);
                      handleRangeChange([Math.max(0, newStart), timelineRange[1]]);
                    }}
                    className={cn(
                      "absolute w-full h-6 appearance-none bg-transparent pointer-events-none z-30",
                      "[&::-webkit-slider-thumb]:appearance-none",
                      "[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4",
                      "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--tropx-vibrant)]",
                      "[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer",
                      "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
                      "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125",
                      "[&::-webkit-slider-thumb]:pointer-events-auto",
                      "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4",
                      "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--tropx-vibrant)]",
                      "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white",
                      "[&::-moz-range-thumb]:cursor-pointer",
                      "[&::-moz-range-thumb]:pointer-events-auto"
                    )}
                  />

                  {/* Right thumb */}
                  <input
                    type="range"
                    min={0}
                    max={totalSessions - 1}
                    value={timelineRange[1]}
                    onChange={(e) => {
                      const newEnd = Math.max(parseInt(e.target.value), timelineRange[0]);
                      handleRangeChange([timelineRange[0], Math.min(totalSessions - 1, newEnd)]);
                    }}
                    className={cn(
                      "absolute w-full h-6 appearance-none bg-transparent pointer-events-none z-30",
                      "[&::-webkit-slider-thumb]:appearance-none",
                      "[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4",
                      "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--tropx-vibrant)]",
                      "[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer",
                      "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
                      "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125",
                      "[&::-webkit-slider-thumb]:pointer-events-auto",
                      "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4",
                      "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--tropx-vibrant)]",
                      "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white",
                      "[&::-moz-range-thumb]:cursor-pointer",
                      "[&::-moz-range-thumb]:pointer-events-auto"
                    )}
                  />
                </div>

                <span className="text-[10px] font-mono text-[var(--tropx-text-sub)] w-20">
                  {filteredSessions[filteredSessions.length - 1] ? new Date(filteredSessions[filteredSessions.length - 1].recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : ''}
                </span>

                {/* Reset button */}
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={resetTimeline}
                      className={cn(
                        "p-1 rounded-md transition-colors",
                        "hover:bg-[var(--tropx-muted)]",
                        "text-[var(--tropx-text-sub)]"
                      )}
                    >
                      <RotateCcw className="size-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Reset to recent sessions
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </TabsContent>

          <TabsContent value="session" className="h-full m-0 data-[state=inactive]:hidden p-4">
            <SessionChart
              packedData={sessionPreviewData}
              isLoading={isSessionLoading}
              sessionTitle={sessionTitle}
              asymmetryEvents={asymmetryEvents ?? undefined}
              className="h-full"
              onPhaseOffsetApply={onPhaseOffsetApply}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export default ChartPane;
