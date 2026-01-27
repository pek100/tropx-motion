/**
 * Visualization Queries for Metrics Vector Analysis
 *
 * Provides data for visualizing patient session clusters
 * with 2D PCA projection.
 */

import { v } from "convex/values";
import { internalQuery, query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import {
  clusterSessionsByDensity,
  labelClustersByQuality,
} from "./clusterAnalysis";
import type { SessionVector, PerformanceCluster } from "./types";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface VisualizationSession {
  sessionId: string;
  recordedAt: number;
  tags: string[];
  notes?: string;
  opiScore?: number;
  /** Key metrics for tooltip preview */
  metrics?: {
    avgMaxROM?: number;
    asymmetryIndex?: number;
    avgVelocity?: number;
    avgSmoothness?: number;
    opiScore?: number;
  };
  /** Original 32-dim vector (for client-side PCA) */
  vector: number[];
  /** Pre-computed 2D projection (PCA) */
  projected: { x: number; y: number };
  /** Cluster assignment */
  clusterId: string;
  clusterLabel: string;
}

export interface VisualizationCluster {
  clusterId: string;
  label: string;
  sessionCount: number;
  qualityScore: number;
  /** Centroid projected to 2D */
  centroid2D: { x: number; y: number };
  color: string;
}

export interface VectorVisualizationData {
  sessions: VisualizationSession[];
  clusters: VisualizationCluster[];
  /** Principal components for projection (2x32 matrix) */
  principalComponents: number[][];
  /** Explained variance ratio for PC1 and PC2 */
  explainedVariance: [number, number];
  /** Data bounds for axis scaling */
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  totalSessions: number;
  dateRange: {
    earliest: number;
    latest: number;
  };
}

// ─────────────────────────────────────────────────────────────────
// Main Query
// ─────────────────────────────────────────────────────────────────

/**
 * Get visualization data for a patient's metrics vectors.
 */
export const getVisualizationData = query({
  args: {
    patientId: v.id("users"),
  },
  handler: async (ctx, args): Promise<VectorVisualizationData | null> => {
    // 1. Get all session vectors for patient
    const vectorDocs = await ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
      .collect();

    if (vectorDocs.length < 2) {
      return null; // Need at least 2 sessions
    }

    // 2. Get recording sessions for metadata
    const sessions: SessionVector[] = [];
    const sessionMetrics: Map<string, {
      opiScore?: number;
      avgMaxROM?: number;
      asymmetryIndex?: number;
      avgVelocity?: number;
      avgSmoothness?: number;
    }> = new Map();

    for (const vectorDoc of vectorDocs) {
      const recordingSession = await ctx.db
        .query("recordingSessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", vectorDoc.sessionId))
        .first();

      sessions.push({
        sessionId: vectorDoc.sessionId,
        recordedAt: vectorDoc.recordedAt,
        vector: vectorDoc.metricsVector,
        tags: recordingSession?.tags ?? [],
        notes: recordingSession?.notes,
      });

      // Extract key metrics for tooltip preview
      if (vectorDoc.rawMetrics) {
        sessionMetrics.set(vectorDoc.sessionId, {
          opiScore: vectorDoc.rawMetrics.opiScore,
          avgMaxROM: vectorDoc.rawMetrics.avgMaxROM,
          asymmetryIndex: vectorDoc.rawMetrics.romAsymmetry,
          avgVelocity: vectorDoc.rawMetrics.peakAngularVelocity,
          avgSmoothness: vectorDoc.rawMetrics.sparc,
        });
      }
    }

    // 3. Run clustering
    const clusters = clusterSessionsByDensity(sessions);

    // 4. Create session -> cluster mapping
    const sessionClusterMap = new Map<string, PerformanceCluster>();
    for (const cluster of clusters) {
      for (const sessionId of cluster.sessionIds) {
        sessionClusterMap.set(sessionId, cluster);
      }
    }

    // 5. Compute PCA
    const vectors = sessions.map((s) => s.vector);
    const { projectedPoints, principalComponents, explainedVariance } =
      computePCA(vectors);

    // 6. Project cluster centroids
    const clusterCentroids2D = clusters.map((c) =>
      projectPoint(c.centroid, principalComponents)
    );

    // 7. Assign colors to clusters
    const clusterColors = generateClusterColors(clusters.length);

    // 8. Build output
    const vizSessions: VisualizationSession[] = sessions.map((s, i) => {
      const cluster = sessionClusterMap.get(s.sessionId);
      const metrics = sessionMetrics.get(s.sessionId);
      return {
        sessionId: s.sessionId,
        recordedAt: s.recordedAt,
        tags: s.tags,
        notes: s.notes,
        opiScore: metrics?.opiScore,
        metrics,
        vector: s.vector,
        projected: projectedPoints[i],
        clusterId: cluster?.clusterId ?? "unknown",
        clusterLabel: cluster?.label ?? "Unknown",
      };
    });

    const vizClusters: VisualizationCluster[] = clusters.map((c, i) => ({
      clusterId: c.clusterId,
      label: c.label,
      sessionCount: c.sessionCount,
      qualityScore: c.qualityScore,
      centroid2D: clusterCentroids2D[i],
      color: clusterColors[i],
    }));

    // 9. Calculate bounds
    const allX = projectedPoints.map((p) => p.x);
    const allY = projectedPoints.map((p) => p.y);
    const bounds = {
      minX: Math.min(...allX),
      maxX: Math.max(...allX),
      minY: Math.min(...allY),
      maxY: Math.max(...allY),
    };

    // Add padding
    const padX = (bounds.maxX - bounds.minX) * 0.1;
    const padY = (bounds.maxY - bounds.minY) * 0.1;
    bounds.minX -= padX;
    bounds.maxX += padX;
    bounds.minY -= padY;
    bounds.maxY += padY;

    // 10. Date range
    const dates = sessions.map((s) => s.recordedAt);
    const dateRange = {
      earliest: Math.min(...dates),
      latest: Math.max(...dates),
    };

    return {
      sessions: vizSessions,
      clusters: vizClusters,
      principalComponents,
      explainedVariance,
      bounds,
      totalSessions: sessions.length,
      dateRange,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// PCA Implementation
// ─────────────────────────────────────────────────────────────────

interface PCAResult {
  projectedPoints: Array<{ x: number; y: number }>;
  principalComponents: number[][];
  explainedVariance: [number, number];
}

/**
 * Compute PCA to project high-dimensional vectors to 2D.
 * Uses power iteration method for simplicity.
 */
function computePCA(vectors: number[][]): PCAResult {
  if (vectors.length === 0) {
    return {
      projectedPoints: [],
      principalComponents: [],
      explainedVariance: [0, 0],
    };
  }

  const n = vectors.length;
  const d = vectors[0].length;

  // 1. Center the data (subtract mean)
  const mean = new Array(d).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < d; i++) {
      mean[i] += v[i] / n;
    }
  }

  const centered = vectors.map((v) => v.map((val, i) => val - mean[i]));

  // 2. Compute covariance matrix (d x d) - simplified for small d
  const cov = new Array(d).fill(null).map(() => new Array(d).fill(0));
  for (const v of centered) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        cov[i][j] += (v[i] * v[j]) / (n - 1);
      }
    }
  }

  // 3. Find top 2 eigenvectors using power iteration
  const pc1 = powerIteration(cov, d);
  const pc1Eigenvalue = rayleighQuotient(cov, pc1);

  // Deflate matrix for second eigenvector
  const covDeflated = deflateMatrix(cov, pc1, pc1Eigenvalue);
  const pc2 = powerIteration(covDeflated, d);
  const pc2Eigenvalue = rayleighQuotient(covDeflated, pc2);

  // 4. Calculate explained variance
  const totalVariance = cov.reduce((sum, row, i) => sum + row[i], 0);
  const explainedVariance: [number, number] = [
    totalVariance > 0 ? pc1Eigenvalue / totalVariance : 0,
    totalVariance > 0 ? pc2Eigenvalue / totalVariance : 0,
  ];

  // 5. Project points
  const projectedPoints = centered.map((v) => ({
    x: dotProduct(v, pc1),
    y: dotProduct(v, pc2),
  }));

  return {
    projectedPoints,
    principalComponents: [pc1, pc2],
    explainedVariance,
  };
}

/**
 * Power iteration to find dominant eigenvector.
 */
function powerIteration(matrix: number[][], d: number, iterations = 50): number[] {
  // Start with random vector
  let v = new Array(d).fill(0).map(() => Math.random() - 0.5);
  v = normalize(v);

  for (let iter = 0; iter < iterations; iter++) {
    // Multiply by matrix
    const newV = new Array(d).fill(0);
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        newV[i] += matrix[i][j] * v[j];
      }
    }
    v = normalize(newV);
  }

  return v;
}

/**
 * Rayleigh quotient to estimate eigenvalue.
 */
function rayleighQuotient(matrix: number[][], v: number[]): number {
  const d = v.length;
  const Av = new Array(d).fill(0);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      Av[i] += matrix[i][j] * v[j];
    }
  }
  return dotProduct(v, Av);
}

/**
 * Deflate matrix by removing contribution of eigenvector.
 */
function deflateMatrix(
  matrix: number[][],
  eigenvector: number[],
  eigenvalue: number
): number[][] {
  const d = matrix.length;
  const deflated = matrix.map((row) => [...row]);

  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      deflated[i][j] -= eigenvalue * eigenvector[i] * eigenvector[j];
    }
  }

  return deflated;
}

/**
 * Normalize a vector to unit length.
 */
function normalize(v: number[]): number[] {
  const mag = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return mag > 0 ? v.map((x) => x / mag) : v;
}

/**
 * Dot product of two vectors.
 */
function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * b[i], 0);
}

/**
 * Project a point using principal components.
 */
function projectPoint(
  point: number[],
  pcs: number[][]
): { x: number; y: number } {
  if (pcs.length < 2) return { x: 0, y: 0 };
  return {
    x: dotProduct(point, pcs[0]),
    y: dotProduct(point, pcs[1]),
  };
}

// ─────────────────────────────────────────────────────────────────
// Color Generation
// ─────────────────────────────────────────────────────────────────

/**
 * Generate distinct colors for clusters.
 */
function generateClusterColors(count: number): string[] {
  const colors = [
    "#22c55e", // Green - High Performance
    "#f59e0b", // Amber - Average
    "#ef4444", // Red - Needs Improvement
    "#3b82f6", // Blue
    "#8b5cf6", // Purple
    "#ec4899", // Pink
    "#06b6d4", // Cyan
    "#84cc16", // Lime
  ];

  return Array.from({ length: count }, (_, i) => colors[i % colors.length]);
}
