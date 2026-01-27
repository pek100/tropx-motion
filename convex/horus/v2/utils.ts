/**
 * Horus v2 Shared Utilities
 *
 * Common helper functions used across v2 pipeline components.
 */

import type { SessionMetrics } from "./types";

/**
 * Build SessionMetrics from recordingMetrics and optional session document.
 */
export function buildSessionMetrics(
  sessionId: string,
  metricsDoc: any,
  sessionDoc?: any
): SessionMetrics {
  const leftLeg = metricsDoc.leftLeg || {};
  const rightLeg = metricsDoc.rightLeg || {};
  const bilateral = metricsDoc.bilateralAnalysis || {};
  const asymmetries = bilateral.asymmetryIndices || {};
  const temporal = bilateral.temporalAsymmetry || {};
  const advanced = metricsDoc.advancedAsymmetry || {};
  const classification = metricsDoc.movementClassification || {};
  const opiResult = metricsDoc.opiResult || {};
  const smoothnessDoc = metricsDoc.smoothnessMetrics || {};

  // Base metrics
  const metrics: SessionMetrics = {
    sessionId,
    leftLeg: {
      overallMaxRom: leftLeg.overallMaxROM || 0,
      averageRom: leftLeg.averageROM || 0,
      peakFlexion: leftLeg.peakFlexion || 0,
      peakExtension: leftLeg.peakExtension || 0,
      peakAngularVelocity: leftLeg.peakAngularVelocity || 0,
      explosivenessConcentric: leftLeg.explosivenessConcentric || 0,
      explosivenessLoading: leftLeg.explosivenessLoading || 0,
      rmsJerk: leftLeg.rmsJerk || 0,
      romCoV: leftLeg.romCoV || 0,
    },
    rightLeg: {
      overallMaxRom: rightLeg.overallMaxROM || 0,
      averageRom: rightLeg.averageROM || 0,
      peakFlexion: rightLeg.peakFlexion || 0,
      peakExtension: rightLeg.peakExtension || 0,
      peakAngularVelocity: rightLeg.peakAngularVelocity || 0,
      explosivenessConcentric: rightLeg.explosivenessConcentric || 0,
      explosivenessLoading: rightLeg.explosivenessLoading || 0,
      rmsJerk: rightLeg.rmsJerk || 0,
      romCoV: rightLeg.romCoV || 0,
    },
    bilateral: {
      romAsymmetry: asymmetries.overallMaxROM || 0,
      velocityAsymmetry: asymmetries.peakAngularVelocity || 0,
      crossCorrelation: temporal.crossCorrelation || 0,
      realAsymmetryAvg: advanced.avgRealAsymmetry || 0,
      netGlobalAsymmetry: bilateral.netGlobalAsymmetry || 0,
      phaseShift: temporal.phaseShift || 0,
      temporalLag: temporal.temporalLag || 0,
      maxFlexionTimingDiff: metricsDoc.temporalCoordination?.maxFlexionTimingDiff || 0,
    },
    opiScore: opiResult.overallScore,
    opiGrade: opiResult.grade,
    movementType: classification.type === "unilateral" ? "unilateral" : "bilateral",
    // CRITICAL: Use actual session recording date, NOT current time
    // This ensures cross-analysis is "blind" to future sessions
    recordedAt: sessionDoc?.recordedAt ?? sessionDoc?.startTime ?? Date.now(),
  };

  // Add smoothness metrics if available (useful for trend tracking)
  if (smoothnessDoc.sparc !== undefined || smoothnessDoc.ldlj !== undefined) {
    metrics.smoothness = {
      sparc: smoothnessDoc.sparc || 0,
      ldlj: smoothnessDoc.ldlj || 0,
      nVelocityPeaks: smoothnessDoc.nVelocityPeaks || 0,
    };
  }

  // Add session context if available (only include fields with data)
  if (sessionDoc) {
    if (sessionDoc.title) {
      metrics.title = sessionDoc.title;
    }
    if (sessionDoc.notes) {
      metrics.notes = sessionDoc.notes;
    }
    if (sessionDoc.tags && sessionDoc.tags.length > 0) {
      metrics.tags = sessionDoc.tags;
    }
    if (sessionDoc.activityProfile) {
      metrics.activityProfile = sessionDoc.activityProfile;
    }
    if (typeof sessionDoc.sets === "number") {
      metrics.sets = sessionDoc.sets;
    }
    if (typeof sessionDoc.reps === "number") {
      metrics.reps = sessionDoc.reps;
    }
  }

  return metrics;
}
