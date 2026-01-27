/**
 * Cluster Analysis Utilities
 *
 * Density-based clustering for session performance grouping.
 * Clusters emerge naturally from 32-dim metrics vector density.
 */

import type {
  SessionVector,
  PerformanceCluster,
  ClusterMembershipOverTime,
  ClusterTrends,
  ClusterMembershipTrend,
  TrendDirection,
  OverallPattern,
  ClusterDistribution,
} from "./types";
import { euclideanDistance, cosineSimilarity } from "../vectordb/metricsVector";

// ─────────────────────────────────────────────────────────────────
// Density-Based Clustering (DBSCAN-like)
// ─────────────────────────────────────────────────────────────────

export interface ClusteringOptions {
  /** Min neighbors for a point to be "dense" (default: 2) */
  minNeighbors?: number;
  /** Neighborhood radius - auto-calculated if omitted */
  epsilon?: number;
  /** Minimum sessions per cluster (default: 1) */
  minClusterSize?: number;
}

/**
 * Cluster sessions by vector density.
 * Clusters emerge naturally from dense regions in 32-dim space.
 */
export function clusterSessionsByDensity(
  sessions: SessionVector[],
  options: ClusteringOptions = {}
): PerformanceCluster[] {
  const { minNeighbors = 2, minClusterSize = 1 } = options;

  if (sessions.length === 0) return [];
  if (sessions.length === 1) {
    return [createSingleSessionCluster(sessions[0])];
  }

  // 1. Auto-calculate epsilon if not provided
  const epsilon =
    options.epsilon ??
    calculateEpsilon(
      sessions.map((s) => s.vector),
      minNeighbors
    );

  // 2. Calculate density for each point
  const densityMap = calculateDensityMap(sessions, epsilon);

  // 3. Expand clusters from dense points
  const clusters: PerformanceCluster[] = [];
  const visited = new Set<string>();

  for (const session of sessions) {
    if (visited.has(session.sessionId)) continue;

    const density = densityMap.get(session.sessionId) ?? 0;
    if (density < minNeighbors) continue; // Skip sparse points for now

    // Start new cluster from this dense point
    const cluster = expandCluster(
      session,
      sessions,
      densityMap,
      epsilon,
      minNeighbors,
      visited
    );
    clusters.push(cluster);
  }

  // 4. Assign remaining sparse points to nearest cluster
  assignSparsePoints(sessions, clusters, visited);

  // 5. Merge small clusters if needed
  const mergedClusters = mergeSmallClusters(clusters, minClusterSize);

  // 6. Label clusters by quality
  return labelClustersByQuality(mergedClusters);
}

/**
 * Create a cluster from a single session.
 */
function createSingleSessionCluster(session: SessionVector): PerformanceCluster {
  return {
    clusterId: `cluster_${Date.now()}_0`,
    label: "Current Performance",
    centroid: session.vector,
    sessionIds: [session.sessionId],
    sessionCount: 1,
    qualityScore: calculateQualityScore(session.vector),
  };
}

/**
 * Calculate epsilon using k-distance heuristic.
 * Uses median of k-th nearest neighbor distances.
 */
export function calculateEpsilon(vectors: number[][], k: number): number {
  if (vectors.length < 2) return 1.0;

  const kDistances = vectors.map((v) => {
    const distances = vectors
      .map((other) => euclideanDistance(v, other))
      .filter((d) => d > 0) // Exclude self
      .sort((a, b) => a - b);

    return distances[Math.min(k - 1, distances.length - 1)] ?? 1.0;
  });

  // Sort k-distances and take median
  kDistances.sort((a, b) => a - b);
  const median = kDistances[Math.floor(kDistances.length * 0.5)];

  // Tune epsilon based on session count
  return tuneEpsilon(vectors.length, median);
}

/**
 * Tune epsilon based on total session count.
 */
function tuneEpsilon(totalSessions: number, baseEpsilon: number): number {
  // With few sessions, use larger epsilon to avoid too many tiny clusters
  if (totalSessions < 6) return baseEpsilon * 1.8;
  if (totalSessions < 10) return baseEpsilon * 1.5;
  // With many sessions, can be more selective
  if (totalSessions > 30) return baseEpsilon * 0.8;
  return baseEpsilon;
}

/**
 * Calculate density (neighbor count) for each session.
 */
function calculateDensityMap(
  sessions: SessionVector[],
  epsilon: number
): Map<string, number> {
  const densityMap = new Map<string, number>();

  for (const session of sessions) {
    const neighbors = findNeighbors(session, sessions, epsilon);
    densityMap.set(session.sessionId, neighbors.length);
  }

  return densityMap;
}

/**
 * Find all sessions within epsilon distance of a point.
 */
export function findNeighbors(
  point: SessionVector,
  allSessions: SessionVector[],
  epsilon: number
): SessionVector[] {
  return allSessions.filter((other) => {
    if (other.sessionId === point.sessionId) return false;
    const distance = euclideanDistance(point.vector, other.vector);
    return distance <= epsilon;
  });
}

/**
 * Expand cluster from a dense seed point.
 */
function expandCluster(
  seed: SessionVector,
  allSessions: SessionVector[],
  densityMap: Map<string, number>,
  epsilon: number,
  minNeighbors: number,
  visited: Set<string>
): PerformanceCluster {
  const clusterSessionIds: string[] = [];
  const clusterVectors: number[][] = [];
  const queue = [seed];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.sessionId)) continue;

    visited.add(current.sessionId);
    clusterSessionIds.push(current.sessionId);
    clusterVectors.push(current.vector);

    // Find neighbors
    const neighbors = findNeighbors(current, allSessions, epsilon);

    // If current point is dense, add unvisited neighbors to queue
    const density = densityMap.get(current.sessionId) ?? 0;
    if (density >= minNeighbors) {
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor.sessionId)) {
          queue.push(neighbor);
        }
      }
    }
  }

  // Calculate cluster centroid
  const centroid = calculateCentroid(clusterVectors);

  return {
    clusterId: `cluster_${Date.now()}_${clusterSessionIds.length}`,
    label: "", // Set by labelClustersByQuality
    centroid,
    sessionIds: clusterSessionIds,
    sessionCount: clusterSessionIds.length,
    qualityScore: calculateQualityScore(centroid),
  };
}

/**
 * Assign sparse (unvisited) points to nearest cluster.
 */
function assignSparsePoints(
  sessions: SessionVector[],
  clusters: PerformanceCluster[],
  visited: Set<string>
): void {
  if (clusters.length === 0) return;

  for (const session of sessions) {
    if (visited.has(session.sessionId)) continue;

    // Find nearest cluster
    let nearestCluster = clusters[0];
    let minDistance = Infinity;

    for (const cluster of clusters) {
      const distance = euclideanDistance(session.vector, cluster.centroid);
      if (distance < minDistance) {
        minDistance = distance;
        nearestCluster = cluster;
      }
    }

    // Add to nearest cluster
    nearestCluster.sessionIds.push(session.sessionId);
    nearestCluster.sessionCount++;

    // Recalculate centroid
    const clusterVectors = sessions
      .filter((s) => nearestCluster.sessionIds.includes(s.sessionId))
      .map((s) => s.vector);
    nearestCluster.centroid = calculateCentroid(clusterVectors);
    nearestCluster.qualityScore = calculateQualityScore(nearestCluster.centroid);

    visited.add(session.sessionId);
  }
}

/**
 * Merge clusters smaller than minSize into nearest larger cluster.
 * Recalculates centroids after merging using weighted average.
 */
function mergeSmallClusters(
  clusters: PerformanceCluster[],
  minSize: number
): PerformanceCluster[] {
  if (minSize <= 1 || clusters.length <= 1) return clusters;

  const largeClusters = clusters.filter((c) => c.sessionCount >= minSize);
  const smallClusters = clusters.filter((c) => c.sessionCount < minSize);

  if (largeClusters.length === 0) {
    // All clusters are small - keep them all
    return clusters;
  }

  // Track which small clusters merge into which large cluster
  const mergeMap = new Map<PerformanceCluster, PerformanceCluster[]>();
  for (const large of largeClusters) {
    mergeMap.set(large, []);
  }

  // Merge small clusters into nearest large cluster
  for (const small of smallClusters) {
    let nearestLarge = largeClusters[0];
    let minDistance = Infinity;

    for (const large of largeClusters) {
      const distance = euclideanDistance(small.centroid, large.centroid);
      if (distance < minDistance) {
        minDistance = distance;
        nearestLarge = large;
      }
    }

    // Track the merge
    mergeMap.get(nearestLarge)!.push(small);

    // Merge session IDs
    nearestLarge.sessionIds.push(...small.sessionIds);
    nearestLarge.sessionCount += small.sessionCount;
  }

  // Recalculate centroids using weighted average
  for (const [large, mergedSmalls] of mergeMap.entries()) {
    if (mergedSmalls.length === 0) continue;

    // Calculate original count (before merges)
    const mergedCount = mergedSmalls.reduce((a, s) => a + s.sessionCount, 0);
    const originalCount = large.sessionCount - mergedCount;
    const totalCount = large.sessionCount;

    // Weighted average of centroids
    const newCentroid = large.centroid.map((_, i) => {
      let sum = large.centroid[i] * originalCount;
      for (const small of mergedSmalls) {
        sum += small.centroid[i] * small.sessionCount;
      }
      return sum / totalCount;
    });

    large.centroid = newCentroid;
    large.qualityScore = calculateQualityScore(newCentroid);
  }

  return largeClusters;
}

/**
 * Calculate centroid (average) of vectors.
 */
export function calculateCentroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];

  const dimensions = vectors[0].length;
  const centroid = new Array(dimensions).fill(0);

  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += vector[i];
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= vectors.length;
  }

  return centroid;
}

/**
 * Calculate quality score from centroid.
 * Higher score = better performance (avg of normalized dimensions).
 */
function calculateQualityScore(centroid: number[]): number {
  if (centroid.length === 0) return 0;
  return centroid.reduce((a, b) => a + b, 0) / centroid.length;
}

/**
 * Label clusters by performance quality (based on centroid).
 */
export function labelClustersByQuality(
  clusters: PerformanceCluster[]
): PerformanceCluster[] {
  if (clusters.length === 0) return [];

  // Sort by quality score (highest first)
  const sorted = [...clusters].sort((a, b) => b.qualityScore - a.qualityScore);

  // Assign labels based on rank
  sorted.forEach((cluster, i) => {
    const percentile = (i / sorted.length) * 100;
    if (sorted.length === 1) {
      cluster.label = "Current Performance";
    } else if (percentile < 33) {
      cluster.label = "High Performance";
    } else if (percentile < 66) {
      cluster.label = "Average Performance";
    } else {
      cluster.label = "Needs Improvement";
    }

    // Update clusterId to be more stable
    cluster.clusterId = `cluster_${i}_q${Math.round(cluster.qualityScore * 100)}`;
  });

  return sorted;
}

// ─────────────────────────────────────────────────────────────────
// Cluster Membership Over Time
// ─────────────────────────────────────────────────────────────────

/**
 * Track cluster membership over time in monthly buckets.
 */
export function trackClusterMembershipOverTime(
  sessions: SessionVector[],
  clusters: PerformanceCluster[]
): ClusterMembershipOverTime[] {
  if (sessions.length === 0 || clusters.length === 0) return [];

  // Create session -> cluster mapping
  const sessionClusterMap = new Map<string, string>();
  for (const cluster of clusters) {
    for (const sessionId of cluster.sessionIds) {
      sessionClusterMap.set(sessionId, cluster.clusterId);
    }
  }

  // Group sessions by month
  const monthBuckets = groupSessionsByMonth(sessions);

  // Build membership for each month
  const history: ClusterMembershipOverTime[] = [];
  let previousDistribution: Record<string, ClusterDistribution> | null = null;

  for (const [period, monthSessions] of monthBuckets) {
    const distribution: Record<string, ClusterDistribution> = {};

    // Initialize all clusters
    for (const cluster of clusters) {
      distribution[cluster.clusterId] = {
        clusterId: cluster.clusterId,
        sessionCount: 0,
        percentage: 0,
        sessionIds: [],
      };
    }

    // Count sessions in each cluster
    for (const session of monthSessions) {
      const clusterId = sessionClusterMap.get(session.sessionId);
      if (clusterId && distribution[clusterId]) {
        distribution[clusterId].sessionCount++;
        distribution[clusterId].sessionIds.push(session.sessionId);
      }
    }

    // Calculate percentages
    const totalInMonth = monthSessions.length;
    for (const clusterId of Object.keys(distribution)) {
      distribution[clusterId].percentage =
        totalInMonth > 0
          ? (distribution[clusterId].sessionCount / totalInMonth) * 100
          : 0;
    }

    // Calculate migrations from previous period
    const migrations = previousDistribution
      ? calculateMigrations(previousDistribution, distribution, clusters)
      : undefined;

    const dates = monthSessions.map((s) => s.recordedAt);
    // Guard against empty dates array (shouldn't happen but defensive)
    const startDate = dates.length > 0 ? Math.min(...dates) : 0;
    const endDate = dates.length > 0 ? Math.max(...dates) : 0;

    history.push({
      period,
      startDate,
      endDate,
      distribution,
      migrations,
    });

    previousDistribution = distribution;
  }

  return history;
}

/**
 * Group sessions into monthly buckets.
 */
function groupSessionsByMonth(
  sessions: SessionVector[]
): Map<string, SessionVector[]> {
  const buckets = new Map<string, SessionVector[]>();

  for (const session of sessions) {
    const date = new Date(session.recordedAt);
    const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    if (!buckets.has(period)) {
      buckets.set(period, []);
    }
    buckets.get(period)!.push(session);
  }

  // Sort by period
  const sorted = new Map(
    [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
  );

  return sorted;
}

/**
 * Calculate migrations between periods.
 */
function calculateMigrations(
  previous: Record<string, ClusterDistribution>,
  current: Record<string, ClusterDistribution>,
  clusters: PerformanceCluster[]
): import("./types").ClusterMigration[] {
  const migrations: import("./types").ClusterMigration[] = [];

  // Create quality ranking
  const qualityRank = new Map<string, number>();
  clusters.forEach((c, i) => qualityRank.set(c.clusterId, i));

  for (const [clusterId, prevDist] of Object.entries(previous)) {
    const currDist = current[clusterId];
    if (!currDist) continue;

    const diff = currDist.percentage - prevDist.percentage;
    if (Math.abs(diff) < 5) continue; // Ignore small changes

    // Find which cluster gained/lost
    for (const [otherClusterId, otherPrevDist] of Object.entries(previous)) {
      if (otherClusterId === clusterId) continue;

      const otherCurrDist = current[otherClusterId];
      if (!otherCurrDist) continue;

      const otherDiff = otherCurrDist.percentage - otherPrevDist.percentage;

      // If one lost and other gained significantly
      if (diff < -5 && otherDiff > 5) {
        const fromRank = qualityRank.get(clusterId) ?? 0;
        const toRank = qualityRank.get(otherClusterId) ?? 0;

        migrations.push({
          fromCluster: clusterId,
          toCluster: otherClusterId,
          sessionCount: Math.round((Math.abs(diff) / 100) * 10), // Approximate
          direction: toRank < fromRank ? "improved" : toRank > fromRank ? "declined" : "lateral",
        });
      }
    }
  }

  return migrations;
}

// ─────────────────────────────────────────────────────────────────
// Cluster Trends
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate cluster membership trends using linear regression.
 */
export function calculateClusterTrends(
  membershipHistory: ClusterMembershipOverTime[],
  clusters: PerformanceCluster[]
): ClusterTrends {
  const clusterTrends: Record<string, ClusterMembershipTrend> = {};

  // Calculate trend for each cluster
  for (const cluster of clusters) {
    const percentages = membershipHistory.map(
      (h) => h.distribution[cluster.clusterId]?.percentage ?? 0
    );

    const { slope, rSquared } = linearRegression(percentages);

    const direction: TrendDirection =
      slope > 0.5 ? "improving" : slope < -0.5 ? "declining" : "stable";

    clusterTrends[cluster.clusterId] = {
      clusterId: cluster.clusterId,
      label: cluster.label,
      membershipTrend: direction,
      slopePerPeriod: slope,
      rSquared,
    };
  }

  // Calculate overall pattern
  const overallPattern = detectOverallPattern(clusterTrends, clusters);

  // Calculate time in each tier
  const { high, medium, low } = calculateTimeInTiers(membershipHistory, clusters);

  return {
    clusterTrends,
    overallPattern,
    timeInHighPerformance: high,
    timeInMediumPerformance: medium,
    timeInLowPerformance: low,
  };
}

/**
 * Simple linear regression on y values (x = indices).
 */
function linearRegression(values: number[]): { slope: number; rSquared: number } {
  if (values.length < 2) return { slope: 0, rSquared: 0 };

  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const y = values;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumXX = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumYY = y.reduce((acc, yi) => acc + yi * yi, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const meanY = sumY / n;

  // R² calculation
  const ssTotal = y.reduce((acc, yi) => acc + Math.pow(yi - meanY, 2), 0);
  const ssResidual = y.reduce((acc, yi, i) => {
    const predicted = (sumY / n) + slope * (i - sumX / n);
    return acc + Math.pow(yi - predicted, 2);
  }, 0);

  const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

  return { slope: isNaN(slope) ? 0 : slope, rSquared: Math.max(0, Math.min(1, rSquared)) };
}

/**
 * Detect overall pattern from cluster trends.
 */
function detectOverallPattern(
  trends: Record<string, ClusterMembershipTrend>,
  clusters: PerformanceCluster[]
): OverallPattern {
  // Find high and low performance clusters
  const sortedByQuality = [...clusters].sort(
    (a, b) => b.qualityScore - a.qualityScore
  );

  if (sortedByQuality.length === 0) return "stable";

  const highCluster = sortedByQuality[0];
  const lowCluster = sortedByQuality[sortedByQuality.length - 1];

  const highTrend = trends[highCluster.clusterId];
  const lowTrend = trends[lowCluster.clusterId];

  if (!highTrend || !lowTrend) return "stable";

  // More time in high-performance cluster over time
  if (highTrend.slopePerPeriod > 5 && lowTrend.slopePerPeriod < -5) {
    return "consistent_improvement";
  }

  // High performance improving, low stable
  if (highTrend.slopePerPeriod > 3) {
    return "improving";
  }

  // All cluster memberships stable
  if (
    Math.abs(highTrend.slopePerPeriod) < 2 &&
    Math.abs(lowTrend.slopePerPeriod) < 2
  ) {
    return "stable";
  }

  // More time in struggling cluster
  if (lowTrend.slopePerPeriod > 5) {
    return "declining";
  }

  // High variance in cluster membership
  if (highTrend.rSquared < 0.15 && lowTrend.rSquared < 0.15) {
    return "volatile";
  }

  return "plateau";
}

/**
 * Calculate percentage of time in each performance tier.
 */
function calculateTimeInTiers(
  history: ClusterMembershipOverTime[],
  clusters: PerformanceCluster[]
): { high: number; medium: number; low: number } {
  if (history.length === 0 || clusters.length === 0) {
    return { high: 0, medium: 0, low: 0 };
  }

  // Sort clusters by quality
  const sortedByQuality = [...clusters].sort(
    (a, b) => b.qualityScore - a.qualityScore
  );

  // Assign tiers
  const tiers = new Map<string, "high" | "medium" | "low">();
  sortedByQuality.forEach((cluster, i) => {
    const percentile = (i / sortedByQuality.length) * 100;
    tiers.set(
      cluster.clusterId,
      percentile < 33 ? "high" : percentile < 66 ? "medium" : "low"
    );
  });

  // Sum up percentages across all periods
  let totalHigh = 0;
  let totalMedium = 0;
  let totalLow = 0;

  for (const period of history) {
    for (const [clusterId, dist] of Object.entries(period.distribution)) {
      const tier = tiers.get(clusterId);
      if (tier === "high") totalHigh += dist.percentage;
      else if (tier === "medium") totalMedium += dist.percentage;
      else totalLow += dist.percentage;
    }
  }

  const totalPeriods = history.length * 100; // Each period sums to 100%
  return {
    high: totalPeriods > 0 ? (totalHigh / totalPeriods) * 100 : 0,
    medium: totalPeriods > 0 ? (totalMedium / totalPeriods) * 100 : 0,
    low: totalPeriods > 0 ? (totalLow / totalPeriods) * 100 : 0,
  };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate percentile of values.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;
  return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
}

/**
 * Find the nearest cluster for a session vector.
 */
export function findNearestCluster(
  vector: number[],
  clusters: PerformanceCluster[]
): { clusterId: string; label: string; similarity: number } | undefined {
  if (clusters.length === 0) return undefined;

  let nearest = clusters[0];
  let maxSimilarity = 0;

  for (const cluster of clusters) {
    const similarity = cosineSimilarity(vector, cluster.centroid);
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      nearest = cluster;
    }
  }

  return {
    clusterId: nearest.clusterId,
    label: nearest.label,
    similarity: maxSimilarity,
  };
}
