# Biomechanical Metrics — Dashboard Clinical Reference

## 12 Metrics Displayed in the TropX Motion Dashboard

---

## Quick Reference

| # | Metric | Category | OPI | Display Name |
|---|--------|----------|-----|--------------|
| 1 | Performance Score | OPI | ✓ | Performance Score |
| 2 | ROM Asymmetry | Symmetry | ✓ | ROM Difference |
| 3 | Real Asymmetry | Symmetry | ✓ | Movement Imbalance |
| 4 | Velocity Asymmetry | Symmetry | ✓ | Speed Difference |
| 5 | Cross-Correlation | Symmetry | ✓ | Movement Similarity |
| 6 | Peak Angular Velocity | Power | ✓ | Peak Speed |
| 7 | Explosiveness (Concentric) | Power | ✓ | Explosiveness |
| 8 | ROM Coefficient of Variation | Control | ✓ | Consistency |
| 9 | SPARC | Control | ✓ | SPARC (Smoothness) |
| 10 | LDLJ | Control | ✓ | LDLJ (Smoothness) |
| 11 | Velocity Peaks Count | Control | ✓ | Velocity Peaks |
| 12 | RMS Jerk | Control | ✓ | Jerkiness |

**OPI Score currently uses 6 metrics** (Symmetry + Power domains). Control domain metrics (SPARC, LDLJ, Velocity Peaks, RMS Jerk) and ROM CoV are displayed but not yet included in OPI pending threshold calibration.

---

## Metric Definitions

### 1. Performance Score (OPI)

**Category**: Overall Performance Index
**Unit**: /100
**Direction**: Higher is better

**What It Measures**: Composite score combining all metrics into a single 0–100 performance rating.

**Grade Scale**:
| Score | Grade |
|-------|-------|
| 90–100 | A (Excellent) |
| 80–89 | B (Good) |
| 70–79 | C (Average) |
| 60–69 | D (Below Average) |
| < 60 | F (Poor) |

---

### 2. ROM Difference (ROM Asymmetry)

**Category**: Symmetry
**Unit**: %
**Direction**: Lower is better

**What It Measures**: Percentage difference in range of motion between left and right limbs.

**Calculation**: `|ROM_L − ROM_R| ÷ max(ROM_L, ROM_R) × 100`

**Normal Values**: < 5% symmetric, 5–15% mild asymmetry, > 15% clinically significant.

**Clinical Significance**: Persistent asymmetry > 10% during squatting/jumping is associated with increased injury risk.

---

### 3. Movement Imbalance (Real Asymmetry)

**Category**: Symmetry
**Unit**: °
**Direction**: Lower is better

**What It Measures**: True limb differences after mathematically separating magnitude asymmetry from timing differences using convolution decomposition.

**Why It Matters**: Standard asymmetry is confounded by phase differences. This isolates genuine magnitude asymmetry and is a better predictor of clinical outcomes.

**Normal Values**: < 5° true symmetry, > 20° significant genuine asymmetry.

---

### 4. Speed Difference (Velocity Asymmetry)

**Category**: Symmetry
**Unit**: %
**Direction**: Lower is better

**What It Measures**: Percentage difference in peak angular velocities between left and right limbs.

**Calculation**: `|ω_L − ω_R| ÷ max(ω_L, ω_R) × 100`

**Normal Values**: < 8% normal, > 20% warrants investigation.

**Clinical Significance**: Velocity differences reveal dynamic deficits that ROM measures miss. Often precedes ROM asymmetry during fatigue.

---

### 5. Movement Similarity (Cross-Correlation)

**Category**: Symmetry
**Unit**: (unitless, 0–1)
**Direction**: Higher is better

**What It Measures**: Similarity of movement waveforms between limbs throughout the entire movement cycle.

**Calculation**: Maximum normalized cross-correlation coefficient.

**Normal Values**: > 0.95 excellent, 0.75–0.95 acceptable, < 0.75 significant pattern difference.

**Clinical Significance**: Low correlation despite normal ROM indicates different movement strategies or compensatory patterns.

---

### 6. Peak Speed (Peak Angular Velocity)

**Category**: Power
**Unit**: °/s
**Direction**: Higher is better

**What It Measures**: Maximum rotational speed of the knee during movement, reflecting explosive capability.

**Calculation**: `max(|dθ/dt|)` — maximum absolute angular velocity

**Normal Values**: Jumping > 400°/s (good), < 200°/s (poor). Walking: 200–300°/s.

**Clinical Significance**: Reduced peak velocity on involved limb despite symmetric ROM indicates incomplete neuromuscular recovery.

---

### 7. Explosiveness (Concentric)

**Category**: Power
**Unit**: °/s²
**Direction**: Higher is better

**What It Measures**: Peak angular acceleration during the concentric phase when the knee is extending against resistance.

**Normal Values**: > 500°/s² indicates rapid force development, < 200°/s² suggests slow force production.

**Clinical Significance**: Concentric explosiveness deficits may persist after strength normalizes, indicating incomplete neuromuscular integration.

---

### 8. Consistency (ROM CoV)

**Category**: Control
**Unit**: %
**Direction**: Lower is better

**What It Measures**: Consistency of movement range across repeated trials, expressed as coefficient of variation.

**Calculation**: `(SD of ROM ÷ Mean ROM) × 100`

**Normal Values**: < 5% highly consistent, > 15% excessive variability.

**Clinical Significance**: Elevated CoV post-surgery indicates incomplete motor re-learning. Also elevated with fatigue and fear-avoidance.

---

### 9. SPARC (Smoothness)

**Category**: Control
**Unit**: (unitless)
**Direction**: Higher (less negative) is better

**What It Measures**: Frequency-domain smoothness metric based on velocity spectrum complexity. Smooth movement has simple frequency content; jerky movement has complex spectrum.

**Normal Values**: > −1.5 smooth/well-controlled, < −3.0 jerky/poorly controlled.

**Clinical Significance**: Validated for stroke, Parkinson's, cerebellar assessment. Tracks motor learning and recovery.

---

### 10. LDLJ (Smoothness)

**Category**: Control
**Unit**: (unitless)
**Direction**: Higher (less negative) is better

**What It Measures**: Time-domain smoothness metric normalizing jerk by movement duration and amplitude. Dimensionless measure allows comparison across different movement speeds and ranges.

**Calculation**: `−ln(duration³ ÷ peakVelocity² × ∫jerk² dt)`

**Normal Values**: > −6 smooth movement, < −10 significant control issues.

**Clinical Significance**: Complements SPARC. If both degrade = global control issue. If only one = specific mechanism.

---

### 11. Velocity Peaks

**Category**: Control
**Unit**: count
**Direction**: Lower is better

**What It Measures**: Number of distinct velocity peaks during a single movement phase. Efficient movement has one smooth velocity peak; multiple peaks indicate corrections or segmentation.

**Normal Values**: 1 peak ideal, > 5 peaks indicates significant corrective sub-movements.

**Clinical Significance**: Elevated in early rehabilitation, cerebellar dysfunction, and novel motor learning.

---

### 12. Jerkiness (RMS Jerk)

**Category**: Control
**Unit**: °/s³
**Direction**: Lower is better

**What It Measures**: Root mean square of jerk (third derivative of position), quantifying movement 'shakiness.'

**Calculation**: `√(mean(jerk²))`

**Normal Values**: < 500°/s³ smooth movement, > 2000°/s³ poor control.

**Clinical Significance**: Increases with fatigue, cognitive load, pain, and neurological conditions. Sensitive to within-session changes.

---

## Signal Processing Summary

| Step | Method | Purpose |
|------|--------|---------|
| Noise Removal | Butterworth 4th order, 6 Hz | Remove sensor noise |
| Differentiation | Central difference | Compute velocity, acceleration, jerk |
| Smoothing | Moving average (5-9 pt) | Reduce noise amplification |
| Peak Detection | Median + k×MAD threshold | Reject outliers |
| Bilateral Alignment | Cross-correlation | Find temporal lag |
| True Asymmetry | Convolution decomposition | Separate phase from magnitude |

---

## Key References

- Balasubramanian S, et al. (2015). The SPARC metric. PLoS ONE.
- Flanagan EP, Comyns TM. (2008). Contact time and RSI. Strength Cond J.
- Forczek W, Staszkiewicz R. (2012). Symmetry in lower limb joints. J Human Kinetics.

---

*Document covers the 12 metrics displayed in the TropX Motion Dashboard metrics table.*
