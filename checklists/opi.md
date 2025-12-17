---
id: opi
tags: [metrics, convex, signal-processing, biomechanics, scoring]
related_files: [
  convex/schema.ts,
  convex/recordingMetrics.ts,
  convex/lib/metrics/opi.ts,
  convex/lib/metrics/types.ts,
  convex/lib/metrics/compute.ts,
  convex/lib/metrics/index.ts
]
doc: /docs/opi/README.md
status: complete
last_sync: 2025-01-17
---

# OPI v1.2.2 Implementation Checklist

## Phase 1: Types & Schema
- [x] Add OPI types to `types.ts` (ActivityProfile, OPIDomain, MetricConfig, DomainScore, OPIResult)
- [x] Add `activityProfile` field to recordings schema
- [x] Add OPI validators to `schema.ts`
- [x] Add `opiResult` field to `recordingMetrics` table

## Phase 2: OPI Calculation (`opi.ts`)
- [x] `METRIC_CONFIGS` constant (14 metrics with thresholds, weights, ICC, citations)
- [x] `DOMAIN_WEIGHTS` constant (weights by activity profile)
- [x] `extractMetricsForOPI()` - maps our metrics to OPI input format
- [x] `normalizeMetric()` - raw value to 0-100 score
- [x] `calculateDomainScore()` - aggregate metrics per domain
- [x] `calculateOPI()` - main function with full OPIResult

## Phase 3: Integration
- [x] Add `opiResult` to `FullAnalysisResult` type
- [x] Call `calculateOPI()` in `compute.ts` pipeline
- [x] Export OPI types/functions from `index.ts`
- [x] Update `storeMetricsResult` to persist OPI

## Phase 4: Recording Integration
- [x] Wire `activityProfile` through computation chain
- [x] Fetch `activityProfile` from recording in `computeMetricsInternal`
- [x] Pass to `computeAllMetrics()` and `calculateOPI()`

## Verification
- [x] TypeScript compiles without OPI-related errors
- [ ] Test with real recording data (pending)
- [ ] UI to display OPI results (future)
