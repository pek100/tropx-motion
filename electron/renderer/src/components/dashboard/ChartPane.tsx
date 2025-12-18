/**
 * ChartPane - Tabbed container for Progress and Session charts.
 */

import { useState } from "react";
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

interface ChartPaneProps {
  sessions: SessionData[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  sessionPreviewData: PackedChunkData | null;
  isSessionLoading?: boolean;
  selectedMetrics?: Set<string>;
  className?: string;
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
  className,
}: ChartPaneProps) {
  const [activeTab, setActiveTab] = useState<ChartTab>("progress");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("7");

  // Filter sessions based on time filter
  const filteredSessions = filterSessions(sessions, timeFilter);

  // Get selected session title for Session tab
  const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId);
  const sessionTitle = selectedSession?.tags[0] || "Session";

  return (
    <div
      className={cn(
        "flex flex-col bg-[var(--tropx-card)] rounded-xl border border-[var(--tropx-border)] shadow-sm",
        className
      )}
    >
      <Tabs
        value={activeTab}
        onValueChange={(v: string) => setActiveTab(v as ChartTab)}
        className="flex flex-col h-full"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--tropx-border)]">
          <div>
            <h3 className="font-bold text-lg text-[var(--tropx-text-main)]">
              {activeTab === "progress" ? "Progress Over Time" : sessionTitle}
            </h3>
            <p className="text-sm text-[var(--tropx-text-sub)]">
              {activeTab === "progress"
                ? "Historical performance of OPI scores"
                : "Knee angle waveforms for selected session"}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Time filter (only for Progress tab) */}
            {activeTab === "progress" && (
              <Select
                value={timeFilter}
                onValueChange={(v) => setTimeFilter(v as TimeFilter)}
              >
                <SelectTrigger className="w-[160px] h-9 text-sm">
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
            <TabsList className="h-9 bg-[var(--tropx-muted)]">
              <TabsTrigger
                value="progress"
                className={cn(
                  "gap-1.5 text-xs transition-all",
                  activeTab === "progress" &&
                    "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white"
                )}
              >
                <TrendingUp className="size-3.5" />
                Progress
              </TabsTrigger>
              <TabsTrigger
                value="session"
                className={cn(
                  "gap-1.5 text-xs transition-all",
                  activeTab === "session" &&
                    "bg-[var(--tropx-vibrant)] text-white data-[state=active]:bg-[var(--tropx-vibrant)] data-[state=active]:text-white"
                )}
              >
                <Activity className="size-3.5" />
                Session
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
              selectedMetrics={selectedMetrics}
              className="h-full"
            />
          </TabsContent>

          <TabsContent value="session" className="h-full m-0 data-[state=inactive]:hidden p-4">
            <SessionChart
              packedData={sessionPreviewData}
              isLoading={isSessionLoading}
              sessionTitle={sessionTitle}
              className="h-full"
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
