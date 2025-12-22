/**
 * ChartPane - Tabbed container for Progress and Session charts.
 */

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, Activity } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProgressChart } from "./ProgressChart";
import { SessionChart } from "./SessionChart";
import type { SessionData } from "./SessionCard";
import type { PackedChunkData } from "../../../../../shared/QuaternionCodec";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type ChartTab = "progress" | "session";
type TimeFilter = "7" | "30" | "90" | "all";

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
  phaseAlignment: PhaseAlignmentData | null;
}

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
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const TIME_FILTER_OPTIONS: { value: TimeFilter; label: string }[] = [
  { value: "7", label: "Last 7 Sessions" },
  { value: "30", label: "Last 30 Days" },
  { value: "90", label: "Last 3 Months" },
  { value: "all", label: "All Time" },
];

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
}: ChartPaneProps) {
  const [activeTab, setActiveTab] = useState<ChartTab>("progress");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("7");

  // Filter sessions based on time filter
  const filteredSessions = filterSessions(sessions, timeFilter);

  // Get selected session title for Session tab
  const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId);
  const sessionTitle = selectedSession?.tags[0] || "Session";

  // Handle view session (select + switch to waveform tab)
  const handleViewSession = useCallback((sessionId: string) => {
    onSelectSession(sessionId);
    setActiveTab("session");
  }, [onSelectSession]);

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
        onValueChange={(v: string) => setActiveTab(v as ChartTab)}
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
            {/* Time filter (only for Progress tab) */}
            {activeTab === "progress" && (
              <Select
                value={timeFilter}
                onValueChange={(v) => setTimeFilter(v as TimeFilter)}
              >
                <SelectTrigger className="w-[130px] sm:w-[160px] h-8 sm:h-9 text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_FILTER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Tabs */}
            <TabsList className="h-8 sm:h-9 bg-[var(--tropx-muted)]">
              <TabsTrigger
                value="progress"
                className={cn(
                  "gap-1 sm:gap-1.5 text-xs px-2 sm:px-3 transition-all",
                  activeTab === "progress" &&
                    "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white"
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
                    "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white"
                )}
              >
                <Activity className="size-3 sm:size-3.5" />
                <span className="hidden xs:inline sm:hidden">Motion</span>
                <span className="hidden sm:inline">Waveform</span>
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        {/* Chart Content */}
        <div className="flex-1 min-h-0">
          <TabsContent value="progress" className="h-full m-0 data-[state=inactive]:hidden p-4">
            <ProgressChart
              sessions={filteredSessions}
              selectedSessionId={selectedSessionId}
              onSelectSession={onSelectSession}
              onViewSession={handleViewSession}
              selectedMetrics={selectedMetrics}
              className="h-full"
            />
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

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Filter sessions by time range */
function filterSessions(sessions: SessionData[], filter: TimeFilter): SessionData[] {
  if (filter === "all") return sessions;

  const now = Date.now();
  let cutoff: number;

  switch (filter) {
    case "7":
      // Last 7 sessions (not time-based)
      return sessions.slice(-7);
    case "30":
      cutoff = now - 30 * 24 * 60 * 60 * 1000;
      break;
    case "90":
      cutoff = now - 90 * 24 * 60 * 60 * 1000;
      break;
    default:
      return sessions;
  }

  return sessions.filter((s) => s.recordedAt >= cutoff);
}

export default ChartPane;
