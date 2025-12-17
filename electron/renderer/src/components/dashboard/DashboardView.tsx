/**
 * DashboardView - Patient progress dashboard with OPI chart and metrics table.
 */

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "convex/react";
import { useConvex } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { FunctionReturnType } from "convex/server";
import { Id } from "../../../../../convex/_generated/dataModel";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn, formatDateTime } from "@/lib/utils";
import { User, ChevronDown, Loader2, TrendingUp, BarChart3 } from "lucide-react";
import { MetricsTable, METRIC_DEFINITIONS, type MetricValue, type MovementType } from "./MetricsTable";
import { DetectedExerciseCard } from "./DetectedExerciseCard";
import { PatientSearchModal } from "../PatientSearchModal";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface Patient {
  id: string;
  name: string;
  image?: string;
  isMe: boolean;
  sessionCount: number;
}

interface DashboardViewProps {
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const CHART_COLORS: Record<string, string> = {
  opiScore: "var(--tropx-vibrant)",
  romAsymmetry: "#8b5cf6",
  velocityAsymmetry: "#a78bfa",
  crossCorrelation: "#7c3aed",
  realAsymmetryAvg: "#6d28d9",
  rsi: "#f97316",
  jumpHeightCm: "#fb923c",
  peakAngularVelocity: "#ea580c",
  explosivenessConcentric: "#c2410c",
  sparc: "#06b6d4",
  ldlj: "#22d3ee",
  nVelocityPeaks: "#0891b2",
  rmsJerk: "#0e7490",
  romCoV: "#22c55e",
  groundContactTimeMs: "#16a34a",
};

const GRADE_BANDS = [
  { grade: "A", min: 90, color: "#22c55e20" },
  { grade: "B", min: 80, color: "#84cc1620" },
  { grade: "C", min: 70, color: "#eab30820" },
  { grade: "D", min: 60, color: "#f9731620" },
  { grade: "F", min: 0, color: "#ef444420" },
];

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function DashboardView({ className }: DashboardViewProps) {
  // State
  const [selectedPatientId, setSelectedPatientId] = useState<Id<"users"> | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(
    new Set(["opiScore"]) // OPI always selected by default
  );

  // Queries - use dynamic import path since types may not be regenerated yet
  const patients = useQuery(
    (api as any).dashboard?.getPatientsList ?? { _name: "skip" }
  ) as Patient[] | undefined;

  const metricsHistory = useQuery(
    (api as any).dashboard?.getPatientMetricsHistory ?? { _name: "skip" },
    selectedPatientId ? { subjectId: selectedPatientId } : "skip"
  ) as {
    subjectId: string;
    sessions: Array<{
      sessionId: string;
      recordedAt: number;
      activityProfile: string;
      tags: string[];
      notes?: string;
      opiScore: number;
      opiGrade: string;
      domainScores: any[];
      movementType: MovementType;
      movementConfidence: number;
      metrics: Record<string, number | undefined>;
    }>;
    totalSessions: number;
  } | null | undefined;

  // Session type for internal use
  type Session = NonNullable<typeof metricsHistory>["sessions"][number];

  // Process chart data
  const chartData = useMemo(() => {
    if (!metricsHistory?.sessions) return [];

    return metricsHistory.sessions.map((session: Session) => ({
      date: session.recordedAt,
      dateLabel: formatDateTime(session.recordedAt),
      opiScore: session.opiScore,
      ...session.metrics,
    }));
  }, [metricsHistory]);

  // Calculate metrics summary for table
  const metricsTableData = useMemo<Record<string, MetricValue>>(() => {
    if (!metricsHistory?.sessions || metricsHistory.sessions.length === 0) {
      return {};
    }

    const sessions = metricsHistory.sessions;
    const result: Record<string, MetricValue> = {};

    for (const metric of METRIC_DEFINITIONS) {
      const values = sessions
        .map((s: Session) => {
          if (metric.id === "opiScore") return s.opiScore;
          return s.metrics[metric.id];
        })
        .filter((v: number | undefined): v is number => v !== undefined);

      if (values.length === 0) {
        result[metric.id] = { latest: undefined, average: undefined, trend: undefined, trendPercent: undefined };
        continue;
      }

      const latest = values[values.length - 1];
      const average = values.reduce((a: number, b: number) => a + b, 0) / values.length;

      // Calculate trend (compare last to first, or last two values)
      let trend: "up" | "down" | "stable" | undefined;
      let trendPercent: number | undefined;

      if (values.length >= 2) {
        const first = values[0];
        const last = values[values.length - 1];
        const change = ((last - first) / Math.abs(first)) * 100;
        trendPercent = change;

        if (Math.abs(change) < 2) {
          trend = "stable";
        } else if (change > 0) {
          trend = "up";
        } else {
          trend = "down";
        }
      }

      result[metric.id] = { latest, average, trend, trendPercent };
    }

    return result;
  }, [metricsHistory]);

  // Chart config for selected metrics
  const chartConfig = useMemo<ChartConfig>(() => {
    const config: ChartConfig = {};
    for (const metricId of selectedMetrics) {
      const def = METRIC_DEFINITIONS.find((m) => m.id === metricId);
      if (def) {
        config[metricId] = {
          label: def.name,
          color: CHART_COLORS[metricId] || "#666",
        };
      }
    }
    return config;
  }, [selectedMetrics]);

  // Get latest session's movement type for filtering metrics
  const latestSession = useMemo(() => {
    if (!metricsHistory?.sessions || metricsHistory.sessions.length === 0) {
      return null;
    }
    return metricsHistory.sessions[metricsHistory.sessions.length - 1];
  }, [metricsHistory]);

  // Handlers
  const handlePatientSelect = useCallback((patient: { userId: Id<"users">; name: string; image?: string }) => {
    setSelectedPatientId(patient.userId);
    setSelectedPatient({
      id: patient.userId,
      name: patient.name,
      image: patient.image,
      isMe: false,
      sessionCount: 0,
    });
    setIsPatientModalOpen(false);
  }, []);

  // If no patient selected, show selector
  if (!selectedPatientId) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full p-8", className)}>
        <div className="text-center max-w-md">
          <div className="size-16 mx-auto mb-4 rounded-full bg-[var(--tropx-hover)] flex items-center justify-center">
            <BarChart3 className="size-8 text-[var(--tropx-vibrant)]" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--tropx-dark)] mb-2">
            Patient Progress Dashboard
          </h2>
          <p className="text-[var(--tropx-shadow)] mb-6">
            Select a patient to view their progress over time, including OPI scores and detailed metrics.
          </p>
          <button
            onClick={() => setIsPatientModalOpen(true)}
            className={cn(
              "inline-flex items-center gap-2 px-6 py-3 rounded-xl",
              "bg-[var(--tropx-vibrant)] text-white font-medium",
              "hover:opacity-90 transition-all",
              "hover:scale-[1.02] active:scale-[0.98]"
            )}
          >
            <User className="size-5" />
            Select Patient
          </button>
        </div>

        <PatientSearchModal
          open={isPatientModalOpen}
          onOpenChange={setIsPatientModalOpen}
          onSelectPatient={handlePatientSelect}
          selectedPatientId={selectedPatientId}
        />
      </div>
    );
  }

  // Loading state
  const isLoading = metricsHistory === undefined;

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        {/* Patient Selector */}
        <button
          onClick={() => setIsPatientModalOpen(true)}
          className={cn(
            "flex items-center gap-3 px-4 py-2 rounded-xl",
            "bg-white border border-gray-200 hover:border-gray-300",
            "transition-all hover:scale-[1.01] active:scale-[0.99]"
          )}
        >
          {selectedPatient?.image ? (
            <img
              src={selectedPatient.image}
              alt={selectedPatient.name}
              className="size-8 rounded-full object-cover"
            />
          ) : (
            <div className="size-8 rounded-full bg-[var(--tropx-hover)] flex items-center justify-center">
              <User className="size-4 text-[var(--tropx-vibrant)]" />
            </div>
          )}
          <div className="text-left">
            <p className="font-medium text-[var(--tropx-dark)]">
              {selectedPatient?.name || "Patient"}
            </p>
            <p className="text-xs text-[var(--tropx-shadow)]">
              {metricsHistory?.totalSessions ?? 0} sessions
            </p>
          </div>
          <ChevronDown className="size-4 text-[var(--tropx-shadow)]" />
        </button>

        {/* Summary Stats */}
        {!isLoading && metricsHistory && metricsHistory.sessions.length > 0 && (
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-[var(--tropx-shadow)]">Latest OPI</p>
              <p className="text-2xl font-bold text-[var(--tropx-vibrant)]">
                {metricsHistory.sessions[metricsHistory.sessions.length - 1].opiScore}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[var(--tropx-shadow)]">Grade</p>
              <p className="text-2xl font-bold text-[var(--tropx-dark)]">
                {metricsHistory.sessions[metricsHistory.sessions.length - 1].opiGrade}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="size-8 animate-spin text-[var(--tropx-vibrant)]" />
          </div>
        ) : metricsHistory?.sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <TrendingUp className="size-12 text-gray-300 mb-4" />
            <p className="text-[var(--tropx-shadow)]">
              No completed recordings with metrics yet.
            </p>
            <p className="text-sm text-gray-400 mt-1">
              Record a session to start tracking progress.
            </p>
          </div>
        ) : (
          <>
            {/* Detected Exercise Type Card */}
            {latestSession && (
              <DetectedExerciseCard
                movementType={latestSession.movementType}
                confidence={latestSession.movementConfidence}
              />
            )}

            {/* Chart */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 w-full">
              <h3 className="text-sm font-medium text-[var(--tropx-dark)] mb-4">
                Progress Over Time
              </h3>
              <div className="w-full">
                <ChartContainer config={chartConfig} className="h-64 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(ts) => new Date(ts).toLocaleDateString()}
                    stroke="#9ca3af"
                    fontSize={12}
                  />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) => {
                          if (payload?.[0]?.payload?.dateLabel) {
                            return payload[0].payload.dateLabel;
                          }
                          return "";
                        }}
                      />
                    }
                  />
                  <Legend />

                  {/* Grade reference bands for OPI */}
                  {selectedMetrics.has("opiScore") && (
                    <>
                      <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="3 3" />
                      <ReferenceLine y={80} stroke="#84cc16" strokeDasharray="3 3" />
                      <ReferenceLine y={70} stroke="#eab308" strokeDasharray="3 3" />
                      <ReferenceLine y={60} stroke="#f97316" strokeDasharray="3 3" />
                    </>
                  )}

                  {/* Lines for selected metrics */}
                  {Array.from(selectedMetrics).map((metricId) => (
                    <Line
                      key={metricId}
                      type="monotone"
                      dataKey={metricId}
                      stroke={CHART_COLORS[metricId] || "#666"}
                      strokeWidth={metricId === "opiScore" ? 3 : 2}
                      dot={{ r: metricId === "opiScore" ? 4 : 3 }}
                      activeDot={{ r: metricId === "opiScore" ? 6 : 4 }}
                      name={METRIC_DEFINITIONS.find((m) => m.id === metricId)?.name || metricId}
                    />
                  ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </div>
            </div>

            {/* Metrics Table */}
            <div>
              <h3 className="text-sm font-medium text-[var(--tropx-dark)] mb-3">
                Metrics
                <span className="ml-2 text-xs text-[var(--tropx-shadow)] font-normal">
                  (select rows to add to chart{latestSession?.movementType && latestSession.movementType !== "unknown" ? ` - dimmed metrics not relevant for ${latestSession.movementType}` : ""})
                </span>
              </h3>
              <MetricsTable
                metricsData={metricsTableData}
                selectedMetrics={selectedMetrics}
                onSelectionChange={setSelectedMetrics}
                movementType={latestSession?.movementType}
                showIrrelevant={true}
              />
            </div>
          </>
        )}
      </div>

      {/* Patient Search Modal */}
      <PatientSearchModal
        open={isPatientModalOpen}
        onOpenChange={setIsPatientModalOpen}
        onSelectPatient={handlePatientSelect}
        selectedPatientId={selectedPatientId}
      />
    </div>
  );
}

export default DashboardView;
