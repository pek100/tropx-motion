---
id: biomechanical-metrics
tags: [metrics, convex, signal-processing, biomechanics]
related_files: [
  convex/schema.ts,
  convex/recordings.ts,
  convex/recordingMetrics.ts,
  convex/lib/metrics/types.ts,
  convex/lib/metrics/helpers.ts,
  convex/lib/metrics/quaternionUtils.ts,
  convex/lib/metrics/computedParams.ts,
  convex/lib/metrics/bilateral.ts,
  convex/lib/metrics/classification.ts,
  convex/lib/metrics/smoothness.ts,
  convex/lib/metrics/groundContact.ts,
  convex/lib/metrics/compute.ts
]
doc: /docs/biomechanical-metrics/README.md
status: complete
last_sync: 2025-01-17
---

# Biomechanical Metrics Implementation Checklist

## Phase 1: Infrastructure & Schema
- [ ] Create `convex/lib/metrics/` folder structure
- [ ] Create `types.ts` with all metric interfaces
- [ ] Expand `recordingMetrics` schema in `schema.ts`
- [ ] Create `quaternionUtils.ts` (port from QuaternionService)

## Phase 2: Helper Functions (`helpers.ts`)
- [ ] `calculateDerivative()` - central difference
- [ ] `applyMovingAverageFilter()`
- [ ] `butterworthLowPass()` - 4th order zero-phase
- [ ] `applyBiquad()` - biquad filter helper
- [ ] `findRobustPeak()` - outlier-resistant peak detection
- [ ] `findRobustMin()` - outlier-resistant min detection
- [ ] `detectMovementCycles()` - cycle detection with prominence
- [ ] `calculateBilateralAsymmetry()` - standard asymmetry formula
- [ ] `calculateCrossCorrelation()` - normalized Pearson with lag
- [ ] `performFFT()` - DFT implementation
- [ ] `fftMagnitude()` - magnitude from FFT result
- [ ] `convolveSignal()` - convolution with edge handling
- [ ] `generateGaussianKernel()` - for baseline extraction

## Phase 3: Computed Parameters (#1-11) - `computedParams.ts`
- [ ] `calculateOverallMaxROM()` - #1
- [ ] `calculateAverageROM()` - #2
- [ ] `calculatePeakFlexion()` - #3
- [ ] `calculatePeakExtension()` - #4
- [ ] `calculatePeakAngularVelocity()` - #5
- [ ] `calculateExplosivenessLoading()` - #6
- [ ] `calculateExplosivenessConcentric()` - #7
- [ ] `calculateRMSJerk()` - #8
- [ ] `calculateROMCoV()` - #9
- [ ] `calculateROMSymmetryIndex()` - #10
- [ ] `calculatePeakResultantAcceleration()` - #11
- [ ] `calculatePerLegMetrics()` - aggregate function

## Phase 4: Bilateral & Unilateral (#12-19) - `bilateral.ts`
- [ ] `calculateAsymmetry()` - #12
- [ ] `calculateNetGlobalAsymmetry()` - #13 (weighted composite)
- [ ] `calculatePhaseShift()` - #14
- [ ] `getCrossCorrelationValue()` - #15
- [ ] `calculateTemporalLag()` - #16
- [ ] `calculateFlexorExtensorRatio()` - #17
- [ ] `calculateEccentricConcentricRatio()` - #18
- [ ] `calculateBilateralRatioDifference()` - #19
- [ ] `calculateBilateralAnalysis()` - aggregate function
- [ ] `calculateUnilateralAnalysis()` - aggregate function

## Phase 5: Classification & Advanced Asymmetry (#38-41) - `classification.ts`
- [ ] `estimateCycleLength()` - autocorrelation helper
- [ ] `classifyMovementType()` - #38 (bilateral/unilateral/mixed)
- [ ] `calculateRollingPhaseOffset()` - #39 (transition detection)
- [ ] `calculateOptimalPhaseAlignment()` - #41
- [ ] `applyPhaseCorrection()` - signal alignment
- [ ] `calculateAdvancedAsymmetry()` - #40 (baseline separation)
- [ ] `calculateRollingAdvancedAsymmetry()` - #40b (windowed)

## Phase 6: Smoothness & Temporal (#29-34) - `smoothness.ts`
- [ ] `calculateSPARC()` - #29 (spectral arc length)
- [ ] `calculateLDLJ()` - #30 (log dimensionless jerk)
- [ ] `calculateVelocityPeaks()` - #31
- [ ] `calculateMaxFlexionTimingDiff()` - #32
- [ ] `calculateZeroVelocityPhase()` - #33
- [ ] `calculateShockAbsorptionScore()` - #34
- [ ] `calculateSmoothnessMetrics()` - aggregate function
- [ ] `calculateTemporalCoordination()` - aggregate function

## Phase 7: Ground Contact, Force, Stiffness, Gait (#20-37) - `groundContact.ts`
> All marked `// TODO: review needed - uses angular acceleration, not raw gyro`
- [ ] `detectGroundContacts()` - impact detection
- [ ] `calculateGroundContactTime()` - #20
- [ ] `calculateFlightTime()` - #21
- [ ] `calculateJumpHeight()` - #22
- [ ] `calculateRSI()` - #23
- [ ] `calculateERFD()` - #24
- [ ] `calculatePeakNormalizedForce()` - #25
- [ ] `calculateImpulseEstimate()` - #26
- [ ] `calculateLegStiffness()` - #27
- [ ] `calculateVerticalStiffness()` - #28
- [ ] `calculateStancePhasePct()` - #35
- [ ] `calculateSwingPhasePct()` - #36
- [ ] `calculateDutyFactor()` - #37
- [ ] `calculateJumpMetrics()` - aggregate function
- [ ] `calculateGaitCycleMetrics()` - aggregate function

## Phase 8: Main Orchestrator (`compute.ts`)
- [ ] `extractAnglesFromChunks()` - fetch & convert quat→angles
- [ ] `computeAllMetrics()` - main pipeline orchestrator
- [ ] Pipeline: Classification → Phase Correction → All Metrics
- [ ] Error handling and partial results

## Phase 9: Convex Integration (`recordingMetrics.ts`)
- [ ] `triggerMetricComputation` - internal action (async)
- [ ] `getMetrics` - query by sessionId
- [ ] `recomputeMetrics` - manual re-trigger mutation
- [ ] Wire trigger into `recordings.ts` `createChunk`
- [ ] Status management (pending → computing → complete/failed)

## Phase 10: Testing & Validation
- [ ] Unit tests for helper functions
- [ ] Integration test with sample data
- [ ] Verify all 42 metrics compute correctly
