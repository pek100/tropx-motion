/**
 * useV2Analysis Hook
 *
 * Fetches and manages V2 analysis pipeline state for a session.
 * Provides data, status, and actions for running/retrying analysis.
 */

import { useMemo, useCallback } from "react";
import { useQuery } from "convex/react";
import { useAction } from "convex/react";
import { api } from "../../../../../../../convex/_generated/api";
import type { V2PipelineOutput, V2PipelineStatus, EnrichedSectionData } from "../v2";
import type { CrossAnalysisResult } from "../../../../../../../convex/horus/crossAnalysis/types";

interface V2AnalysisError {
  agent?: string;
  message: string;
  sectionId?: string;
}

interface UseV2AnalysisResult {
  // Data
  output: V2PipelineOutput | null;
  status: V2PipelineStatus;
  error: V2AnalysisError | null;

  // Actions
  runAnalysis: () => Promise<void>;
  retryAnalysis: () => Promise<void>;

  // Derived state
  isLoading: boolean;
  isAnalyzing: boolean;
  isResearching: boolean;
  isCrossAnalyzing: boolean;
  isComplete: boolean;
  hasError: boolean;
}

export function useV2Analysis(sessionId: string | undefined): UseV2AnalysisResult {
  // Fetch analysis data
  const analysisData = useQuery(
    api.horus.v2.queries.getAnalysisV2,
    sessionId ? { sessionId } : "skip"
  );

  // Fetch pipeline status
  const statusData = useQuery(
    api.horus.v2.queries.getAnalysisStatusV2,
    sessionId ? { sessionId } : "skip"
  );

  // Actions
  const analyzeAction = useAction(api.horus.v2.actions.analyzeSession);
  const retryAction = useAction(api.horus.v2.actions.retryAnalysis);

  // Determine current status
  const status: V2PipelineStatus = useMemo(() => {
    // Priority: status table > analysis table > pending
    if (statusData?.status) {
      return statusData.status as V2PipelineStatus;
    }
    if (analysisData?.status === "complete") {
      return "complete";
    }
    return "pending";
  }, [statusData, analysisData]);

  // Extract error
  const error: V2AnalysisError | null = useMemo(() => {
    if (statusData?.error) {
      return statusData.error as V2AnalysisError;
    }
    return null;
  }, [statusData]);

  // Transform output to match UI types
  const output: V2PipelineOutput | null = useMemo(() => {
    if (!analysisData?.output) return null;

    const { output: rawOutput } = analysisData;

    // Provide default radar scores if not present (for backward compatibility)
    const defaultRadarScores = {
      flexibility: 5,
      consistency: 5,
      symmetry: 5,
      smoothness: 5,
      control: 5,
    };

    return {
      sessionId: analysisData.sessionId,
      overallGrade: rawOutput.overallGrade,
      radarScores: rawOutput.radarScores || defaultRadarScores,
      keyFindings: rawOutput.keyFindings || [],
      clinicalImplications: rawOutput.clinicalImplications || "",
      enrichedSections: (rawOutput.enrichedSections || []) as EnrichedSectionData[],
      summary: rawOutput.summary || "",
      strengths: rawOutput.strengths || [],
      weaknesses: rawOutput.weaknesses || [],
      recommendations: rawOutput.recommendations || [],
      speculativeInsights: rawOutput.speculativeInsights || [],
      failedEnrichments: rawOutput.failedEnrichments || [],
      crossAnalysis: rawOutput.crossAnalysis as CrossAnalysisResult | undefined,
      totalDurationMs: rawOutput.totalDurationMs || 0,
    };
  }, [analysisData]);

  // Actions
  const runAnalysis = useCallback(async () => {
    if (!sessionId) return;
    await analyzeAction({ sessionId });
  }, [sessionId, analyzeAction]);

  const retryAnalysis = useCallback(async () => {
    if (!sessionId) return;
    await retryAction({ sessionId });
  }, [sessionId, retryAction]);

  // Derived state (DB stores "analysis"/"research"/"progress", not "analyzing"/"researching"/"cross_analyzing")
  const isLoading = analysisData === undefined || statusData === undefined;
  const isAnalyzing = status === "analysis";
  const isResearching = status === "research";
  const isCrossAnalyzing = status === "progress"; // Cross-analysis maps to "progress" status
  const isComplete = status === "complete";
  const hasError = status === "error";

  return {
    output,
    status,
    error,
    runAnalysis,
    retryAnalysis,
    isLoading,
    isAnalyzing,
    isResearching,
    isCrossAnalyzing,
    isComplete,
    hasError,
  };
}
