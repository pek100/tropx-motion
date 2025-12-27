/**
 * useVisualization Hook
 *
 * Fetches analysis data and prepares evaluation context for blocks.
 * Uses pipeline status updatedAt for cache invalidation with customConvex.
 */

import { useMemo } from "react";
import { useQuery as useConvexQuery } from "convex/react";
import { useQuery } from "@/lib/customConvex";
import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import type { EvaluationContext, SessionMetrics } from "../types";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface SessionData {
  sessionId: string;
  metrics?: {
    leftLeg: Record<string, number>;
    rightLeg: Record<string, number>;
    bilateral: Record<string, number>;
    opiScore?: number;
  };
  recordedAt: number;
}

interface UseVisualizationResult {
  isLoading: boolean;
  hasAnalysis: boolean;
  context: EvaluationContext | null;
  overallBlocks: unknown[]; // Will be typed properly when AI outputs blocks
  sessionBlocks: unknown[];
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────
// Helper: Convert session data to SessionMetrics
// ─────────────────────────────────────────────────────────────────

function toSessionMetrics(session: SessionData | null): SessionMetrics | undefined {
  if (!session?.metrics) return undefined;

  return {
    sessionId: session.sessionId,
    leftLeg: {
      overallMaxRom: session.metrics.leftLeg?.overallMaxRom ?? 0,
      averageRom: session.metrics.leftLeg?.averageRom ?? 0,
      peakFlexion: session.metrics.leftLeg?.peakFlexion ?? 0,
      peakExtension: session.metrics.leftLeg?.peakExtension ?? 0,
      peakAngularVelocity: session.metrics.leftLeg?.peakAngularVelocity ?? 0,
      explosivenessConcentric: session.metrics.leftLeg?.explosivenessConcentric ?? 0,
      explosivenessLoading: session.metrics.leftLeg?.explosivenessLoading ?? 0,
      rmsJerk: session.metrics.leftLeg?.rmsJerk ?? 0,
      romCoV: session.metrics.leftLeg?.romCoV ?? 0,
    },
    rightLeg: {
      overallMaxRom: session.metrics.rightLeg?.overallMaxRom ?? 0,
      averageRom: session.metrics.rightLeg?.averageRom ?? 0,
      peakFlexion: session.metrics.rightLeg?.peakFlexion ?? 0,
      peakExtension: session.metrics.rightLeg?.peakExtension ?? 0,
      peakAngularVelocity: session.metrics.rightLeg?.peakAngularVelocity ?? 0,
      explosivenessConcentric: session.metrics.rightLeg?.explosivenessConcentric ?? 0,
      explosivenessLoading: session.metrics.rightLeg?.explosivenessLoading ?? 0,
      rmsJerk: session.metrics.rightLeg?.rmsJerk ?? 0,
      romCoV: session.metrics.rightLeg?.romCoV ?? 0,
    },
    bilateral: {
      romAsymmetry: session.metrics.bilateral?.romAsymmetry ?? 0,
      velocityAsymmetry: session.metrics.bilateral?.velocityAsymmetry ?? 0,
      crossCorrelation: session.metrics.bilateral?.crossCorrelation ?? 0,
      realAsymmetryAvg: session.metrics.bilateral?.realAsymmetryAvg ?? 0,
      netGlobalAsymmetry: session.metrics.bilateral?.netGlobalAsymmetry ?? 0,
      phaseShift: session.metrics.bilateral?.phaseShift ?? 0,
      temporalLag: session.metrics.bilateral?.temporalLag ?? 0,
      maxFlexionTimingDiff: session.metrics.bilateral?.maxFlexionTimingDiff ?? 0,
    },
    opiScore: session.metrics.opiScore,
    movementType: "bilateral" as const,
    recordedAt: session.recordedAt,
  };
}

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

export function useVisualization(
  patientId: Id<"users"> | null,
  selectedSessionId: string | null,
  sessions: SessionData[]
): UseVisualizationResult {
  // First, get pipeline status (real-time, not cached) for updatedAt
  // This drives cache invalidation for the analysis query
  const pipelineStatus = useConvexQuery(
    api.horus.queries.getPipelineStatus,
    selectedSessionId ? { sessionId: selectedSessionId } : "skip"
  );

  // Fetch analysis for the selected session (cached via customConvex)
  // Use updatedAt as _cacheKey to invalidate cache when analysis changes
  // IMPORTANT: Only query after pipelineStatus is loaded to get correct _cacheKey
  const shouldFetchAnalysis = selectedSessionId && pipelineStatus?.updatedAt !== undefined;
  const analysis = useQuery(
    api.horus.queries.getAnalysis,
    shouldFetchAnalysis
      ? { sessionId: selectedSessionId, _cacheKey: pipelineStatus.updatedAt }
      : "skip"
  );

  // Build evaluation context
  const context = useMemo<EvaluationContext | null>(() => {
    if (!sessions.length) return null;

    // Find current session
    const currentSession = selectedSessionId
      ? sessions.find((s) => s.sessionId === selectedSessionId)
      : sessions[0];

    if (!currentSession) return null;

    const current = toSessionMetrics(currentSession);
    if (!current) return null;

    // Sort sessions by date (oldest first for history)
    const sortedSessions = [...sessions].sort((a, b) => a.recordedAt - b.recordedAt);

    // Find index of current session
    const currentIndex = sortedSessions.findIndex(
      (s) => s.sessionId === currentSession.sessionId
    );

    // Previous session (one before current)
    const previousSession = currentIndex > 0 ? sortedSessions[currentIndex - 1] : null;

    // Baseline is first session
    const baselineSession = sortedSessions[0];

    // All sessions as history
    const history = sortedSessions
      .map(toSessionMetrics)
      .filter((s): s is SessionMetrics => s !== undefined);

    const ctx = {
      current,
      previous: toSessionMetrics(previousSession) ?? undefined,
      baseline:
        baselineSession?.sessionId !== currentSession.sessionId
          ? toSessionMetrics(baselineSession)
          : undefined,
      history,
    };

    return ctx;
  }, [sessions, selectedSessionId]);

  // Extract blocks from analysis
  const blocks = useMemo(() => {
    if (!analysis?.analysis) {
      return {
        overallBlocks: [],
        sessionBlocks: [],
      };
    }

    // Cast to access visualization property
    const analysisData = analysis.analysis as {
      visualization?: {
        overallBlocks?: unknown[];
        sessionBlocks?: unknown[];
      };
    };

    return {
      overallBlocks: analysisData.visualization?.overallBlocks || [],
      sessionBlocks: analysisData.visualization?.sessionBlocks || [],
    };
  }, [analysis]);

  // Loading states:
  // 1. Waiting for pipeline status to load (so we can get updatedAt for cache key)
  // 2. Waiting for analysis to load after we have pipeline status
  const isLoading =
    selectedSessionId !== null &&
    (pipelineStatus === undefined || (shouldFetchAnalysis && analysis === undefined));

  return {
    isLoading,
    // Analysis is available once saved, even if progress agent is still running
    hasAnalysis: !!analysis?.analysis && (analysis?.status === "complete" || analysis?.status === "progress" || analysis?.status === "validation"),
    context,
    overallBlocks: blocks.overallBlocks,
    sessionBlocks: blocks.sessionBlocks,
    error: analysis?.error?.message ?? pipelineStatus?.error?.message ?? null,
  };
}
