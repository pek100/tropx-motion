/**
 * DashboardView - Redesigned patient progress dashboard.
 * Features: Session carousel, Progress/Session chart tabs, metrics data table.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useMutation, useConvex, useQuery, useSyncOptional } from "@/lib/customConvex";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { mergeChunks, type PackedChunkData } from "../../../../../shared/QuaternionCodec";
import {
  decompressAllChunks,
  type CompressedChunk,
  type SessionMetadata as CompressionSessionMeta,
} from "../../../../../shared/compression/decompressSession";
import { cn } from "@/lib/utils";
import { User, Loader2, TrendingUp, BarChart3 } from "lucide-react";

import { PatientInfoCard } from "./PatientInfoCard";
import { PatientNotes, type PatientNote } from "./PatientNotes";
import { SessionsCarousel } from "./SessionsCarousel";
import { ChartPane, type ChartTab } from "./ChartPane";
import { HorusPane, type AnalysisMode, useHorusAnalysisToast } from "./horus";
import { CompactMetricsPane } from "./CompactMetricsPane";
import { PatientSearchModal } from "../PatientSearchModal";
import { METRIC_DEFINITIONS, type MovementType } from "./MetricsTable";
import type { SessionData } from "./SessionCard";
import type { MetricRow, MetricDomain } from "./columns";
import type { CarouselApi } from "@/components/ui/carousel";
import { useCurrentUser } from "@/hooks/useCurrentUser";

// ─────────────────────────────────────────────────────────────────
// LocalStorage Keys
// ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "tropx-dashboard-state";

interface DashboardState {
  selectedPatientId: string | null;
  selectedPatientName: string | null;
  selectedPatientImage?: string;
  selectedPatientIsMe: boolean;
  selectedSessionId: string | null;
  selectedMetrics: string[];
}

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
// Component
// ─────────────────────────────────────────────────────────────────

export function DashboardView({ className }: DashboardViewProps) {
  // Current user info
  const { user, isLoading: isUserLoading } = useCurrentUser();
  const isPatient = user?.role === "patient";
  const isPhysiotherapist = user?.role === "physiotherapist";

  // Load saved state from localStorage
  const loadSavedState = (): Partial<DashboardState> => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to load dashboard state:", e);
    }
    return {};
  };

  const savedState = useRef(loadSavedState());

  // State - initialize from localStorage if available
  const [selectedPatientId, setSelectedPatientId] = useState<Id<"users"> | null>(
    (savedState.current.selectedPatientId as Id<"users">) || null
  );
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(
    savedState.current.selectedPatientId
      ? {
          id: savedState.current.selectedPatientId,
          name: savedState.current.selectedPatientName || "Patient",
          image: savedState.current.selectedPatientImage,
          isMe: savedState.current.selectedPatientIsMe || false,
          sessionCount: 0,
        }
      : null
  );
  const [isPatientModalOpen, setIsPatientModalOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    savedState.current.selectedSessionId || null
  );
  const [carouselApi, setCarouselApi] = useState<CarouselApi | null>(null);
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(
    new Set(savedState.current.selectedMetrics || ["opiScore"])
  );
  const [patientNotes, setPatientNotes] = useState<PatientNote[]>([]);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isTabsLinked, setIsTabsLinked] = useState(true);

  // Sync states for linked tabs (used to trigger sync in the other pane)
  const [syncChartTab, setSyncChartTab] = useState<ChartTab>("progress");
  const [syncAnalysisMode, setSyncAnalysisMode] = useState<AnalysisMode>("overall");

  // Horus analysis toast
  const { showToast: showHorusToast, ToastComponent: HorusToast } = useHorusAnalysisToast();

  // When ChartPane changes, update the sync state for HorusPane
  const handleChartTabChange = useCallback((tab: ChartTab) => {
    setSyncChartTab(tab);
    setSyncAnalysisMode(tab === "progress" ? "overall" : "session");
  }, []);

  // When HorusPane changes, update the sync state for ChartPane
  const handleAnalysisModeChange = useCallback((mode: AnalysisMode) => {
    setSyncAnalysisMode(mode);
    setSyncChartTab(mode === "overall" ? "progress" : "session");
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (!hasInitialized) return;

    const state: DashboardState = {
      selectedPatientId: selectedPatientId,
      selectedPatientName: selectedPatient?.name || null,
      selectedPatientImage: selectedPatient?.image,
      selectedPatientIsMe: selectedPatient?.isMe || false,
      selectedSessionId: selectedSessionId,
      selectedMetrics: Array.from(selectedMetrics),
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save dashboard state:", e);
    }
  }, [selectedPatientId, selectedPatient, selectedSessionId, selectedMetrics, hasInitialized]);

  // Auto-select self for patients, show modal for physiotherapists
  useEffect(() => {
    if (isUserLoading || hasInitialized) return;

    // Patient: auto-select themselves
    if (isPatient && user) {
      setSelectedPatientId(user._id as Id<"users">);
      setSelectedPatient({
        id: user._id,
        name: user.name,
        image: user.image,
        isMe: true,
        sessionCount: 0,
      });
      setHasInitialized(true);
      return;
    }

    // Physiotherapist: show modal if no patient selected (and no saved state)
    if (isPhysiotherapist && !selectedPatientId) {
      setIsPatientModalOpen(true);
    }

    setHasInitialized(true);
  }, [isUserLoading, isPatient, isPhysiotherapist, user, selectedPatientId, hasInitialized]);

  // Convex client for manual queries
  const convex = useConvex();

  // Sync context for imperative caching
  const sync = useSyncOptional();

  // Queries - add timestamp to bust cache during development
  const [cacheKey] = useState(() => Date.now());
  const metricsHistory = useQuery(
    api.dashboard.getPatientMetricsHistory,
    selectedPatientId ? { subjectId: selectedPatientId, _cacheKey: cacheKey } : "skip"
  );
  const isMetricsLoading = metricsHistory === undefined;

  // State for session waveform data (loaded on demand with decompression)
  const [sessionPackedData, setSessionPackedData] = useState<PackedChunkData | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const loadedSessionIdRef = useRef<string | null>(null);

  // Load session data when selectedSessionId changes
  useEffect(() => {
    if (!selectedSessionId) {
      setSessionPackedData(null);
      loadedSessionIdRef.current = null;
      return;
    }

    // Skip if already loaded
    if (loadedSessionIdRef.current === selectedSessionId) return;

    const loadSessionData = async () => {
      setIsSessionLoading(true);
      try {
        // Check sync cache first
        const cacheKey = `recordingChunks:getSessionWithChunks:${JSON.stringify({ sessionId: selectedSessionId })}`;
        let result = sync?.getQuery(cacheKey) as { session: any; chunks: any[] } | undefined;

        // If not cached, fetch from Convex
        if (!result) {
          result = await convex.query(api.recordingChunks.getSessionWithChunks, {
            sessionId: selectedSessionId,
          });
          // Cache the result
          if (result && sync) {
            sync.setQuery(cacheKey, result);
          }
        }

        // Defensive: validate cached data structure
        if (!result || typeof result !== 'object') {
          setSessionPackedData(null);
          return;
        }

        const { session, chunks } = result;

        // Defensive: ensure chunks is an array with data
        if (!Array.isArray(chunks) || chunks.length === 0) {
          setSessionPackedData(null);
          return;
        }

        // Defensive: ensure session has required properties
        if (!session || typeof session.sessionId !== 'string') {
          setSessionPackedData(null);
          return;
        }

        // Build session metadata for decompression
        const sessionMeta: CompressionSessionMeta = {
          sessionId: session.sessionId,
          sampleRate: session.sampleRate,
          totalSamples: session.totalSamples,
          totalChunks: session.totalChunks,
          activeJoints: session.activeJoints,
          startTime: session.startTime,
          endTime: session.endTime,
        };

        // Decompress all chunks
        const decompressedChunks = decompressAllChunks(
          chunks as CompressedChunk[],
          sessionMeta
        );

        // Convert to PackedChunkData format
        const packedChunks: PackedChunkData[] = decompressedChunks.map((chunk) => ({
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          sampleRate: chunk.sampleRate,
          sampleCount: chunk.sampleCount,
          activeJoints: chunk.activeJoints,
          leftKneeQ: chunk.leftKneeQ,
          rightKneeQ: chunk.rightKneeQ,
          leftKneeInterpolated: chunk.leftKneeInterpolated,
          leftKneeMissing: chunk.leftKneeMissing,
          rightKneeInterpolated: chunk.rightKneeInterpolated,
          rightKneeMissing: chunk.rightKneeMissing,
        }));

        // Merge chunks and set state
        const merged = mergeChunks(packedChunks);
        setSessionPackedData(merged);
        loadedSessionIdRef.current = selectedSessionId;
      } catch (error) {
        console.error("Failed to load session data:", error);
        setSessionPackedData(null);
      } finally {
        setIsSessionLoading(false);
      }
    };

    loadSessionData();
  }, [selectedSessionId, convex, sync]);

  // Query for asymmetry events (for SessionChart overlay)
  const asymmetryEvents = useQuery(
    api.recordingMetrics.getSessionAsymmetryEvents,
    selectedSessionId ? { sessionId: selectedSessionId } : "skip"
  );

  // Mutation for applying custom phase offset
  const applyPhaseOffset = useMutation(api.recordingMetrics.applyCustomPhaseOffset);

  // Mutation for recomputing metrics
  const recomputeMetrics = useMutation(api.recordingMetrics.recomputeMetrics);

  // Recompute state
  const [isRecomputing, setIsRecomputing] = useState(false);

  // Session type
  type Session = NonNullable<typeof metricsHistory>["sessions"][number];

  // Transform sessions for carousel/chart
  const sessions = useMemo<SessionData[]>(() => {
    // Defensive: check it's an array before mapping
    if (!Array.isArray(metricsHistory?.sessions)) return [];

    return metricsHistory.sessions
      .filter((s: Session) => {
        // Defensive: skip invalid session entries from cache
        return s && typeof s.sessionId === 'string' && typeof s.recordedAt === 'number';
      })
      .map((s: Session) => {
        // Defensive: validate preview paths structure (must have x, y, z string properties)
        const validatePreviewPaths = (paths: unknown): typeof paths | null => {
          if (!paths || typeof paths !== 'object') return null;
          const p = paths as Record<string, unknown>;
          if (typeof p.x === 'string' && typeof p.y === 'string' && typeof p.z === 'string') {
            return paths;
          }
          return null; // Invalid structure, likely corrupted cache
        };

        return {
          sessionId: s.sessionId,
          recordedAt: s.recordedAt,
          tags: Array.isArray(s.tags) ? s.tags : [],
          opiScore: typeof s.opiScore === 'number' ? s.opiScore : 0,
          opiGrade: typeof s.opiGrade === 'string' ? s.opiGrade : 'C',
          movementType: (s.movementType as MovementType) || 'unknown',
          metrics: (s.metrics && typeof s.metrics === 'object' ? s.metrics : {}) as Record<string, number | undefined>,
          // Preview SVG paths for tooltip mini chart (all 3 axes) - validate structure
          previewLeftPaths: validatePreviewPaths(s.previewLeftPaths),
          previewRightPaths: validatePreviewPaths(s.previewRightPaths),
        };
      });
  }, [metricsHistory]);

  // Auto-select latest session when data loads
  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[sessions.length - 1].sessionId);
    }
  }, [sessions, selectedSessionId]);

  // Get selected session
  const selectedSession = useMemo(() => {
    if (!selectedSessionId || !Array.isArray(metricsHistory?.sessions)) return null;
    return metricsHistory.sessions.find((s: Session) => s.sessionId === selectedSessionId) || null;
  }, [selectedSessionId, metricsHistory]);

  // Transform metrics for data table
  const metricsTableData = useMemo<MetricRow[]>(() => {
    if (!selectedSession) return [];

    // Get historical average for reference (defensive: ensure array)
    const sessions = Array.isArray(metricsHistory?.sessions) ? metricsHistory.sessions : [];
    const getAverage = (metricId: string): number | undefined => {
      const values = sessions
        .map((s: Session) => (metricId === "opiScore" ? s.opiScore : (s.metrics as Record<string, number | undefined>)[metricId]))
        .filter((v: number | undefined): v is number => v !== undefined);
      if (values.length === 0) return undefined;
      return values.reduce((a: number, b: number) => a + b, 0) / values.length;
    };

    // Get trend by comparing to average of previous sessions
    const getTrend = (metricId: string, currentValue: number | undefined): { trend: "up" | "down" | "stable" | undefined; trendPercent: number | undefined } => {
      if (currentValue === undefined) return { trend: undefined, trendPercent: undefined };

      const allValues = sessions
        .map((s: Session) => (metricId === "opiScore" ? s.opiScore : (s.metrics as Record<string, number | undefined>)[metricId]))
        .filter((v: number | undefined): v is number => v !== undefined);

      if (allValues.length < 2) return { trend: undefined, trendPercent: undefined };

      const previousAvg = allValues.slice(0, -1).reduce((a, b) => a + b, 0) / (allValues.length - 1);
      if (previousAvg === 0) return { trend: undefined, trendPercent: undefined };

      const change = ((currentValue - previousAvg) / Math.abs(previousAvg)) * 100;

      let trend: "up" | "down" | "stable";
      if (Math.abs(change) < 2) {
        trend = "stable";
      } else if (change > 0) {
        trend = "up";
      } else {
        trend = "down";
      }

      return { trend, trendPercent: change };
    };

    return METRIC_DEFINITIONS
      .map((def) => {
        const value = def.id === "opiScore" ? selectedSession.opiScore : (selectedSession.metrics as Record<string, number | undefined>)[def.id];
        const reference = getAverage(def.id);
        const { trend, trendPercent } = getTrend(def.id, value);

        return {
          id: def.id,
          name: def.name,
          domain: def.domain as MetricDomain,
          unit: def.unit,
          value,
          reference,
          trend,
          trendPercent,
          direction: def.direction,
          format: def.format,
        };
      })
      // Filter out metrics with no data (no current value AND no historical reference)
      .filter((row) => row.value !== undefined || row.reference !== undefined);
  }, [selectedSession, metricsHistory]);

  // Transform sessions for Horus AI pane (needs nested per-leg structure)
  const horusSessions = useMemo(() => {
    if (!Array.isArray(metricsHistory?.sessions)) return [];

    const result = metricsHistory.sessions
      .filter((s: Session) => s && typeof s.sessionId === 'string')
      .map((s: Session) => {
        // Access nested per-leg data (added by backend)
        const sessionAny = s as Session & {
          leftLeg?: Record<string, number>;
          rightLeg?: Record<string, number>;
          bilateral?: Record<string, number>;
        };

        // Debug: trace opiScore through transformation
        console.log("[horusSessions] session opiScore:", s.sessionId.slice(-6), s.opiScore);

        // Always provide metrics object with opiScore, use empty objects if leg data missing
        return {
          sessionId: s.sessionId,
          recordedAt: s.recordedAt,
          metrics: {
            leftLeg: sessionAny.leftLeg ?? {},
            rightLeg: sessionAny.rightLeg ?? {},
            bilateral: sessionAny.bilateral ?? {},
            opiScore: s.opiScore,
          },
        };
      });

    return result;
  }, [metricsHistory]);

  // Handle session selection (from carousel or chart)
  const handleSelectSession = useCallback(
    (sessionId: string) => {
      setSelectedSessionId(sessionId);

      // Scroll carousel to selected session
      if (carouselApi) {
        const index = sessions.findIndex((s) => s.sessionId === sessionId);
        if (index >= 0) {
          carouselApi.scrollTo(index);
        }
      }
    },
    [carouselApi, sessions]
  );

  // Handle patient selection
  const handlePatientSelect = useCallback(
    (patient: { userId: Id<"users">; name: string; image?: string; isMe?: boolean }) => {
      setSelectedPatientId(patient.userId);
      setSelectedPatient({
        id: patient.userId,
        name: patient.name,
        image: patient.image,
        isMe: patient.isMe ?? false,
        sessionCount: 0,
      });
      setSelectedSessionId(null); // Reset session selection
      setPatientNotes([]); // Reset notes for new patient
      setIsPatientModalOpen(false);
    },
    []
  );

  // Handle adding a new note
  const handleAddNote = useCallback((content: string) => {
    const newNote: PatientNote = {
      id: `note-${Date.now()}`,
      content,
      createdAt: Date.now(),
    };
    setPatientNotes((prev) => [newNote, ...prev]);
    // TODO: Save to Convex
  }, []);

  // Handle editing a note
  const handleEditNote = useCallback((noteId: string, content: string) => {
    setPatientNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, content } : n))
    );
    // TODO: Update in Convex
  }, []);

  // Handle deleting a note
  const handleDeleteNote = useCallback((noteId: string) => {
    setPatientNotes((prev) => prev.filter((n) => n.id !== noteId));
    // TODO: Delete from Convex
  }, []);

  // Handle applying custom phase offset
  const handlePhaseOffsetApply = useCallback(
    async (newOffsetMs: number) => {
      if (!selectedSessionId) return;
      try {
        await applyPhaseOffset({
          sessionId: selectedSessionId,
          customOffsetMs: newOffsetMs,
        });
        // Metrics will be refetched automatically via Convex reactivity
      } catch (error) {
        console.error("Failed to apply phase offset:", error);
      }
    },
    [selectedSessionId, applyPhaseOffset]
  );

  // Handle recompute metrics
  const handleRecomputeMetrics = useCallback(async () => {
    if (!selectedSessionId) return;
    setIsRecomputing(true);
    try {
      await recomputeMetrics({ sessionId: selectedSessionId });
      // Show Horus analysis toast
      showHorusToast(selectedSessionId, `Session ${selectedSessionId.slice(-6)}`);
      // Metrics will be refetched automatically via Convex reactivity
    } catch (error) {
      console.error("Failed to recompute metrics:", error);
    } finally {
      setIsRecomputing(false);
    }
  }, [selectedSessionId, recomputeMetrics, showHorusToast]);

  // Loading user state
  if (isUserLoading) {
    return (
      <div className={cn("flex items-center justify-center h-full", className)}>
        <Loader2 className="size-8 animate-spin text-[var(--tropx-vibrant)]" />
      </div>
    );
  }

  // If no patient selected, show selector (only for physiotherapists)
  if (!selectedPatientId) {
    return (
      <div className={cn("flex flex-col items-center justify-center h-full p-8", className)}>
        <div className="text-center max-w-md">
          <div className="size-16 mx-auto mb-4 rounded-full bg-[var(--tropx-hover)] flex items-center justify-center">
            <BarChart3 className="size-8 text-[var(--tropx-vibrant)]" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--tropx-text-main)] mb-2">
            {isPatient ? "Your Progress Dashboard" : "Patient Progress Dashboard"}
          </h2>
          <p className="text-[var(--tropx-text-sub)] mb-6">
            {isPatient
              ? "View your progress over time, including OPI scores and detailed metrics."
              : "Select a patient to view their progress over time, including OPI scores and detailed metrics."}
          </p>
          {!isPatient && (
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
          )}
        </div>

        {!isPatient && (
          <PatientSearchModal
            open={isPatientModalOpen}
            onOpenChange={setIsPatientModalOpen}
            onSelectPatient={handlePatientSelect}
            selectedPatientId={selectedPatientId}
          />
        )}
      </div>
    );
  }

  // Loading state
  const isLoading = isMetricsLoading;

  return (
    <div className={cn("flex flex-col h-full overflow-hidden", className)}>
      {/* Content */}
      <div className="flex-1 overflow-y-auto py-4 sm:p-6 space-y-4 sm:space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="size-8 animate-spin text-[var(--tropx-vibrant)]" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <TrendingUp className="size-12 text-[var(--tropx-text-sub)] opacity-50 mb-4" />
            <p className="text-[var(--tropx-text-sub)]">
              No completed recordings with metrics yet.
            </p>
            <p className="text-sm text-[var(--tropx-text-sub)] opacity-75 mt-1">
              Record a session to start tracking progress.
            </p>
          </div>
        ) : (
          <>
            {/* Patient Info - visible on mobile at top */}
            <div className="md:hidden">
              <PatientInfoCard
                name={selectedPatient?.name || "Patient"}
                image={selectedPatient?.image}
                sessionCount={metricsHistory?.totalSessions ?? 0}
                isMe={selectedPatient?.isMe}
                onClick={isPatient ? undefined : () => setIsPatientModalOpen(true)}
                onAddNote={() => {
                  const content = prompt("Add a note:");
                  if (content?.trim()) {
                    handleAddNote(content.trim());
                  }
                }}
                borderless
              />
            </div>

            {/* Top Row: Patient Info/Notes + Sessions Carousel - desktop layout */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:h-[204px] mb-4 sm:mb-0">
              {/* Left Column: Patient Info + Notes - hidden on mobile */}
              <div className="hidden md:flex col-span-1 flex-col gap-2 h-full overflow-hidden">
                <PatientInfoCard
                  name={selectedPatient?.name || "Patient"}
                  image={selectedPatient?.image}
                  sessionCount={metricsHistory?.totalSessions ?? 0}
                  isMe={selectedPatient?.isMe}
                  onClick={isPatient ? undefined : () => setIsPatientModalOpen(true)}
                  className="shrink-0"
                />
                <PatientNotes
                  notes={patientNotes}
                  onAddNote={handleAddNote}
                  onEditNote={handleEditNote}
                  onDeleteNote={handleDeleteNote}
                  className="flex-1 min-h-0 overflow-hidden"
                />
              </div>

              {/* Sessions Carousel */}
              <div className="col-span-1 md:col-span-2 min-h-[100px] max-h-[140px] sm:min-h-[180px] sm:max-h-[220px] md:max-h-none md:h-full">
                <SessionsCarousel
                  sessions={sessions}
                  selectedSessionId={selectedSessionId}
                  onSelectSession={handleSelectSession}
                  onApiReady={setCarouselApi}
                  className="h-full"
                  onRecomputeMetrics={handleRecomputeMetrics}
                  isRecomputing={isRecomputing}
                />
              </div>
            </div>

            {/* Chart Pane with Compact Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
              {/* Compact Metrics Pane - hidden on mobile */}
              <div className="hidden lg:block h-[400px] sm:h-[480px]">
                <CompactMetricsPane
                  data={metricsTableData}
                  sessionTitle={selectedSession?.tags[0]}
                  selectedMetrics={selectedMetrics}
                  onSelectionChange={setSelectedMetrics}
                  borderless
                  className="h-full"
                />
              </div>

              {/* Chart Pane */}
              <ChartPane
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                onSelectSession={handleSelectSession}
                sessionPreviewData={sessionPackedData}
                isSessionLoading={isSessionLoading}
                selectedMetrics={selectedMetrics}
                asymmetryEvents={asymmetryEvents ?? null}
                className="h-[400px] sm:h-[480px]"
                borderless
                onPhaseOffsetApply={handlePhaseOffsetApply}
                isLinked={isTabsLinked}
                onLinkedChange={setIsTabsLinked}
                onTabChange={handleChartTabChange}
                syncToTab={syncChartTab}
              />
            </div>

            {/* Horus AI Analysis Pane */}
            <HorusPane
              patientId={selectedPatientId}
              selectedSessionId={selectedSessionId}
              sessions={horusSessions}
              borderless
              isLinked={isTabsLinked}
              onLinkedChange={setIsTabsLinked}
              onModeChange={handleAnalysisModeChange}
              syncToMode={syncAnalysisMode}
            />
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

      {/* Horus Analysis Toast */}
      {HorusToast}
    </div>
  );
}

export default DashboardView;
