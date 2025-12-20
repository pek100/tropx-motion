# Biomechanical Metrics Specification v1.2

## Overview

This document defines all biomechanical metrics for the IMU-based movement analysis system, including mathematical formulas and TypeScript implementations.

**Total Metrics: 43**
- Computed Parameters: 11
- Bilateral Analysis: 5
- Unilateral Analysis: 3
- Ground Contact & Flight: 4
- Force/Power Metrics: 3
- Stiffness Metrics: 2
- Smoothness Metrics: 3
- Temporal Coordination: 3
- Gait Cycle: 3
- Movement Classification: 2
- Advanced Asymmetry: 3 (with phase correction)
- Overall Performance: 1 (composite index)

---

## Helper Functions

### 1. Robust Peak Detection (Outlier-Resistant, Adaptive)

Used by all peak-based metrics to filter sensor outliers. Adapts to available data - uses ALL detected peaks, not a fixed number.

**Algorithm:**
1. Find all local maxima in signal
2. Sort descending by value
3. Calculate consecutive differences between sorted peaks
4. Calculate median difference (robust to outliers)
5. Walk from top peak until gap is within threshold (median + k×MAD)
6. Return first "reasonable" peak

```typescript
function findRobustPeak(values: number[], k: number = 3): number {
    if (values.length === 0) return 0;
    if (values.length < 3) return Math.max(...values);

    // 1. Find ALL local maxima
    const peaks: number[] = [];
    for (let i = 1; i < values.length - 1; i++) {
        if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
            peaks.push(values[i]);
        }
    }
    
    // If no peaks found, return global max
    if (peaks.length === 0) return Math.max(...values);
    
    // If only 1-2 peaks, return the highest
    if (peaks.length <= 2) return Math.max(...peaks);

    // 2. Sort ALL peaks descending (adaptive - use all available)
    const sorted = [...peaks].sort((a, b) => b - a);

    // 3. Calculate consecutive diffs between ALL sorted peaks
    const diffs: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        diffs.push(sorted[i] - sorted[i + 1]);
    }

    // 4. Median diff (robust to outliers at top)
    const sortedDiffs = [...diffs].sort((a, b) => a - b);
    const medianDiff = sortedDiffs[Math.floor(sortedDiffs.length / 2)];

    // 5. MAD (Median Absolute Deviation) for adaptive threshold
    const absDevs = diffs.map(d => Math.abs(d - medianDiff)).sort((a, b) => a - b);
    const MAD = absDevs[Math.floor(absDevs.length / 2)] || medianDiff * 0.5;
    const threshold = medianDiff + k * Math.max(MAD, medianDiff * 0.1);

    // 6. Walk from top until gap is reasonable
    for (let i = 0; i < diffs.length; i++) {
        if (diffs[i] <= threshold) {
            return sorted[i]; // This peak has reasonable gap to next
        }
    }

    // 7. Fallback: if all gaps are large, use 95th percentile of ALL values
    const allSorted = [...values].sort((a, b) => b - a);
    const idx95 = Math.floor(allSorted.length * 0.05);
    return allSorted[idx95];
}

function findRobustMin(values: number[], k: number = 3): number {
    const inverted = values.map(v => -v);
    return -findRobustPeak(inverted, k);
}
```

---

### 2. Derivative Calculation (Central Difference)

```typescript
function calculateDerivative(values: number[], timeStep: number): number[] {
    if (values.length < 3) return [];
    const derivative: number[] = [];
    for (let i = 1; i < values.length - 1; i++) {
        derivative.push((values[i + 1] - values[i - 1]) / (2 * timeStep));
    }
    return derivative;
}
```

---

### 3. Moving Average Filter

```typescript
function applyMovingAverageFilter(values: number[], windowSize: number): number[] {
    if (windowSize <= 1 || values.length === 0) return [...values];
    const halfWindow = Math.floor(windowSize / 2);
    const filtered: number[] = [];
    
    for (let i = 0; i < values.length; i++) {
        const start = Math.max(0, i - halfWindow);
        const end = Math.min(values.length, i + halfWindow + 1);
        const window = values.slice(start, end);
        filtered.push(window.reduce((sum, val) => sum + val, 0) / window.length);
    }
    return filtered;
}
```

---

### 4. Butterworth Low-Pass Filter (4th Order, Zero-Phase)

```typescript
function butterworthLowPass(values: number[], fc: number, fs: number): number[] {
    if (values.length < 4) return [...values];
    
    // Normalized cutoff frequency
    const wc = Math.tan(Math.PI * fc / fs);
    const wc2 = wc * wc;
    
    // 2nd order Butterworth coefficients (will cascade twice for 4th order)
    const k = Math.sqrt(2) * wc;
    const norm = 1 / (1 + k + wc2);
    
    const a0 = wc2 * norm;
    const a1 = 2 * a0;
    const a2 = a0;
    const b1 = 2 * (wc2 - 1) * norm;
    const b2 = (1 - k + wc2) * norm;

    // Apply 2nd order filter (forward)
    const pass1 = applyBiquad(values, a0, a1, a2, b1, b2);
    // Apply 2nd order filter (backward) for zero-phase
    const pass2 = applyBiquad([...pass1].reverse(), a0, a1, a2, b1, b2).reverse();
    // Apply again for 4th order (forward)
    const pass3 = applyBiquad(pass2, a0, a1, a2, b1, b2);
    // Apply again (backward) for zero-phase 4th order
    const pass4 = applyBiquad([...pass3].reverse(), a0, a1, a2, b1, b2).reverse();
    
    return pass4;
}

function applyBiquad(
    x: number[], 
    a0: number, a1: number, a2: number, 
    b1: number, b2: number
): number[] {
    const y: number[] = new Array(x.length).fill(0);
    y[0] = a0 * x[0];
    y[1] = a0 * x[1] + a1 * x[0] - b1 * y[0];
    
    for (let i = 2; i < x.length; i++) {
        y[i] = a0 * x[i] + a1 * x[i-1] + a2 * x[i-2] - b1 * y[i-1] - b2 * y[i-2];
    }
    return y;
}
```

---

### 5. Cycle Detection

```typescript
interface MovementCycle {
    startIndex: number;
    endIndex: number;
    duration: number;
}

function detectMovementCycles(values: number[], timeStep: number): MovementCycle[] {
    if (values.length < 10) return [];
    
    const cycles: MovementCycle[] = [];
    const range = Math.max(...values) - Math.min(...values);
    const prominence = Math.max(2, range * 0.1);
    const peaks: { index: number; value: number }[] = [];

    // Detect peaks with prominence threshold
    for (let i = 1; i < values.length - 1; i++) {
        if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
            const windowStart = Math.max(0, i - 10);
            const windowEnd = Math.min(values.length, i + 11);
            const leftMin = Math.min(...values.slice(windowStart, i));
            const rightMin = Math.min(...values.slice(i + 1, windowEnd));
            const peakProminence = values[i] - Math.max(leftMin, rightMin);
            
            if (peakProminence >= prominence) {
                peaks.push({ index: i, value: values[i] });
            }
        }
    }

    // Create cycles from consecutive peaks
    for (let i = 0; i < peaks.length - 1; i++) {
        const duration = (peaks[i + 1].index - peaks[i].index) * timeStep;
        if (duration >= 0.3 && duration <= 5.0) { // Reasonable cycle duration
            cycles.push({
                startIndex: peaks[i].index,
                endIndex: peaks[i + 1].index,
                duration
            });
        }
    }
    return cycles;
}
```

---

### 6. Bilateral Asymmetry

```typescript
function calculateBilateralAsymmetry(leftValue: number, rightValue: number): number {
    const maxValue = Math.max(Math.abs(leftValue), Math.abs(rightValue));
    return maxValue > 0 ? (Math.abs(leftValue - rightValue) / maxValue) * 100 : 0;
}
```

---

### 7. Impact Detection (Ground Contact) - CORRECTED

```typescript
interface GroundContact {
    touchdownIndex: number;
    takeoffIndex: number;
    contactTimeMs: number;
    flightTimeMs: number;
    impactMagnitude: number;
}

function detectGroundContacts(
    accel: number[],           // Vertical acceleration in g-units (1g = stationary)
    timeStep: number, 
    impactThreshold: number = 2.0,   // Impact spike threshold (g)
    freefallThreshold: number = 0.3  // Near-freefall threshold (g, close to 0)
): GroundContact[] {
    const contacts: GroundContact[] = [];
    let i = 0;
    
    while (i < accel.length - 1) {
        // Detect touchdown: acceleration spike above threshold
        if (accel[i] > impactThreshold) {
            const touchdownIndex = i;
            const impactMagnitude = accel[i];
            
            // Find takeoff: acceleration drops to near-freefall (close to 0g)
            let takeoffIndex = i + 1;
            while (takeoffIndex < accel.length && accel[takeoffIndex] > freefallThreshold) {
                takeoffIndex++;
            }
            
            if (takeoffIndex < accel.length) {
                // Find next touchdown for flight time calculation
                let nextTouchdown = takeoffIndex + 1;
                while (nextTouchdown < accel.length && accel[nextTouchdown] < impactThreshold) {
                    nextTouchdown++;
                }
                
                const contactTimeMs = (takeoffIndex - touchdownIndex) * timeStep * 1000;
                const flightTimeMs = nextTouchdown < accel.length 
                    ? (nextTouchdown - takeoffIndex) * timeStep * 1000 
                    : 0;
                
                // Only add valid contacts (reasonable durations)
                if (contactTimeMs > 50 && contactTimeMs < 1000) {
                    contacts.push({
                        touchdownIndex,
                        takeoffIndex,
                        contactTimeMs,
                        flightTimeMs,
                        impactMagnitude
                    });
                }
                
                i = nextTouchdown;
            } else {
                i++;
            }
        } else {
            i++;
        }
    }
    return contacts;
}
```

---

### 8. Cross-Correlation (Normalized Pearson) - CORRECTED

```typescript
interface CrossCorrelationResult {
    correlation: number;  // -1 to 1 (normalized)
    lag: number;          // Sample lag at max correlation
}

function calculateCrossCorrelation(
    left: number[], 
    right: number[]
): CrossCorrelationResult {
    const n = Math.min(left.length, right.length);
    if (n < 10) return { correlation: 1, lag: 0 };
    
    // Calculate means
    const meanL = left.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanR = right.slice(0, n).reduce((a, b) => a + b, 0) / n;
    
    // Calculate standard deviations
    let sumSqL = 0, sumSqR = 0;
    for (let i = 0; i < n; i++) {
        sumSqL += (left[i] - meanL) ** 2;
        sumSqR += (right[i] - meanR) ** 2;
    }
    const stdL = Math.sqrt(sumSqL / n);
    const stdR = Math.sqrt(sumSqR / n);
    
    if (stdL < 1e-10 || stdR < 1e-10) return { correlation: 1, lag: 0 };
    
    // Calculate cross-correlation at various lags
    const maxLag = Math.min(50, Math.floor(n / 4));
    let bestCorr = -Infinity;
    let bestLag = 0;
    
    for (let lag = -maxLag; lag <= maxLag; lag++) {
        let sum = 0;
        let count = 0;
        
        for (let i = 0; i < n; i++) {
            const j = i + lag;
            if (j >= 0 && j < n) {
                sum += (left[i] - meanL) * (right[j] - meanR);
                count++;
            }
        }
        
        const corr = count > 0 ? sum / (count * stdL * stdR) : 0;
        
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }
    
    return { correlation: bestCorr, lag: bestLag };
}
```

---

### 9. FFT Implementation (for SPARC)

```typescript
function performFFT(signal: number[]): { real: number[]; imag: number[] } {
    const N = signal.length;
    const real: number[] = new Array(N).fill(0);
    const imag: number[] = new Array(N).fill(0);
    
    // DFT (for production, use FFT library like fft.js)
    for (let k = 0; k < N; k++) {
        for (let n = 0; n < N; n++) {
            const angle = (2 * Math.PI * k * n) / N;
            real[k] += signal[n] * Math.cos(angle);
            imag[k] -= signal[n] * Math.sin(angle);
        }
    }
    
    return { real, imag };
}

function fftMagnitude(fft: { real: number[]; imag: number[] }): number[] {
    return fft.real.map((r, i) => Math.sqrt(r * r + fft.imag[i] * fft.imag[i]));
}
```

---

## Metric Definitions & Implementations

---

### Category 1: Computed Parameters (Per Leg)

#### 1. overall_max_rom
**Description:** Maximum range of motion achieved during movement  
**Formula:** $|max(x) - min(x)|$  
**Uses Robust Peak:** Yes

```typescript
function calculateOverallMaxROM(values: number[]): number {
    if (values.length === 0) return 0;
    const robustMax = findRobustPeak(values);
    const robustMin = findRobustMin(values);
    return Math.abs(robustMax - robustMin);
}
```

---

#### 2. average_rom
**Description:** Mean ROM across detected movement cycles  
**Formula:** $\frac{1}{n}\sum_{i=1}^{n} |max(x_{cycle_i}) - min(x_{cycle_i})|$  
**Uses Robust Peak:** No (per-cycle calculation)

```typescript
function calculateAverageROM(values: number[], timeStep: number): number {
    if (values.length < 10) return 0;
    
    const filtered = applyMovingAverageFilter(values, 3);
    const cycles = detectMovementCycles(filtered, timeStep);
    
    if (cycles.length === 0) {
        return Math.abs(Math.max(...filtered) - Math.min(...filtered));
    }
    
    const cycleROMs = cycles.map(cycle => {
        const cycleValues = filtered.slice(cycle.startIndex, cycle.endIndex + 1);
        return Math.abs(Math.max(...cycleValues) - Math.min(...cycleValues));
    });
    
    return cycleROMs.reduce((sum, rom) => sum + rom, 0) / cycleROMs.length;
}
```

---

#### 3. peak_flexion_rom
**Description:** Maximum flexion angle achieved  
**Formula:** $max(x)$  
**Uses Robust Peak:** Yes

```typescript
function calculatePeakFlexion(values: number[]): number {
    return findRobustPeak(values);
}
```

---

#### 4. peak_extension_rom
**Description:** Maximum extension angle achieved  
**Formula:** $min(x)$  
**Uses Robust Peak:** Yes

```typescript
function calculatePeakExtension(values: number[]): number {
    return findRobustMin(values);
}
```

---

#### 5. peak_angular_velocity
**Description:** Highest rotational speed during movement  
**Formula:** $max\left(\left|\frac{x_{i+1} - x_{i-1}}{2\Delta t}\right|\right)$  
**Uses Robust Peak:** Yes

```typescript
function calculatePeakAngularVelocity(values: number[], timeStep: number): number {
    if (values.length < 3) return 0;
    const velocity = calculateDerivative(values, timeStep);
    if (velocity.length === 0) return 0;
    const absVelocity = velocity.map(Math.abs);
    return findRobustPeak(absVelocity);
}
```

---

#### 6. explosiveness_loading - CORRECTED
**Description:** Peak velocity during eccentric/loading phase (angle increasing)  
**Formula:** $max(|v_i|)$ where angle is increasing  
**Uses Robust Peak:** Yes

```typescript
function calculateExplosivenessLoading(values: number[], timeStep: number): number {
    if (values.length < 3) return 0;
    const velocity = calculateDerivative(values, timeStep);
    if (velocity.length === 0) return 0;
    
    const loadingVelocities: number[] = [];
    
    // velocity[i] corresponds to values[i+1] due to central difference
    // Check direction of movement at each velocity point
    for (let i = 0; i < velocity.length; i++) {
        const posIdx = i + 1; // Central diff offset
        // Angle increasing = loading phase (for knee flexion)
        if (values[posIdx] > values[posIdx - 1]) {
            loadingVelocities.push(Math.abs(velocity[i]));
        }
    }
    
    return loadingVelocities.length > 0 ? findRobustPeak(loadingVelocities) : 0;
}
```

---

#### 7. explosiveness_concentric - CORRECTED
**Description:** Peak velocity during concentric phase (angle decreasing)  
**Formula:** $max(|v_i|)$ where angle is decreasing  
**Uses Robust Peak:** Yes

```typescript
function calculateExplosivenessConcentric(values: number[], timeStep: number): number {
    if (values.length < 3) return 0;
    const velocity = calculateDerivative(values, timeStep);
    if (velocity.length === 0) return 0;
    
    const concentricVelocities: number[] = [];
    
    for (let i = 0; i < velocity.length; i++) {
        const posIdx = i + 1;
        // Angle decreasing = concentric phase (for knee extension)
        if (values[posIdx] < values[posIdx - 1]) {
            concentricVelocities.push(Math.abs(velocity[i]));
        }
    }
    
    return concentricVelocities.length > 0 ? findRobustPeak(concentricVelocities) : 0;
}
```

---

#### 8. rms_jerk
**Description:** Root mean square of jerk (movement smoothness indicator)  
**Formula:** $\sqrt{\frac{1}{n}\sum_{i=1}^{n} j_i^2}$ where $j = \frac{d^3x}{dt^3}$  
**Uses Robust Peak:** No

```typescript
function calculateRMSJerk(values: number[], timeStep: number): number {
    const velocity = calculateDerivative(values, timeStep);
    const acceleration = calculateDerivative(velocity, timeStep);
    const jerk = calculateDerivative(acceleration, timeStep);
    
    if (jerk.length === 0) return 0;
    
    const sumSquaredJerk = jerk.reduce((sum, j) => sum + j * j, 0);
    return Math.sqrt(sumSquaredJerk / jerk.length);
}
```

---

#### 9. rom_cov_percentage
**Description:** Coefficient of variation for ROM (movement consistency)  
**Formula:** $\frac{\sigma_{peaks}}{\mu_{peaks}} \times 100$  
**Uses Robust Peak:** No

```typescript
function calculateROMCoV(values: number[]): number {
    if (values.length < 3) return 0;
    
    // Find cycle peaks
    const peaks: number[] = [];
    for (let i = 1; i < values.length - 1; i++) {
        if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
            peaks.push(values[i]);
        }
    }
    
    if (peaks.length < 2) return 0;
    
    const mean = peaks.reduce((sum, p) => sum + p, 0) / peaks.length;
    if (mean === 0) return 0;
    
    const variance = peaks.reduce((sum, p) => sum + (p - mean) ** 2, 0) / peaks.length;
    const stdDev = Math.sqrt(variance);
    
    return (stdDev / Math.abs(mean)) * 100;
}
```

---

#### 10. rom_symmetry_index
**Description:** Bilateral ROM symmetry ratio  
**Formula:** $\frac{|L - R|}{max(L, R)} \times 100$  
**Uses Robust Peak:** No (uses pre-calculated ROMs)

```typescript
function calculateROMSymmetryIndex(leftROM: number, rightROM: number): number {
    return calculateBilateralAsymmetry(leftROM, rightROM);
}
```

---

#### 11. peak_resultant_acceleration
**Description:** Maximum acceleration magnitude  
**Formula:** $max\left(\left|\frac{d^2x}{dt^2}\right|\right)$  
**Uses Robust Peak:** Yes

```typescript
function calculatePeakResultantAcceleration(values: number[], timeStep: number): number {
    if (values.length < 3) return 0;
    const velocity = calculateDerivative(values, timeStep);
    const acceleration = calculateDerivative(velocity, timeStep);
    if (acceleration.length === 0) return 0;
    const absAccel = acceleration.map(Math.abs);
    return findRobustPeak(absAccel);
}
```

---

### Category 2: Bilateral Analysis

#### 12. asymmetry
**Description:** Standard bilateral asymmetry index  
**Formula:** $\frac{|L - R|}{max(L, R)} \times 100$

```typescript
function calculateAsymmetry(leftValue: number, rightValue: number): number {
    return calculateBilateralAsymmetry(leftValue, rightValue);
}
```

---

#### 13. net_global_asymmetry
**Description:** Weighted composite asymmetry across all parameters  
**Formula:** $\sum_{i} (w_i \times asymmetry_i)$  
**Note:** Weights sum to 1.0

```typescript
interface MetricsSet {
    overallMaxROM: number;
    averageROM: number;
    peakAngularVelocity: number;
    rmsJerk: number;
    explosivenessLoading: number;
    explosivenessConcentric: number;
}

function calculateNetGlobalAsymmetry(left: MetricsSet, right: MetricsSet): number {
    const asymmetries = [
        calculateBilateralAsymmetry(left.overallMaxROM, right.overallMaxROM),
        calculateBilateralAsymmetry(left.averageROM, right.averageROM),
        calculateBilateralAsymmetry(left.peakAngularVelocity, right.peakAngularVelocity),
        calculateBilateralAsymmetry(left.rmsJerk, right.rmsJerk),
        calculateBilateralAsymmetry(left.explosivenessLoading, right.explosivenessLoading),
        calculateBilateralAsymmetry(left.explosivenessConcentric, right.explosivenessConcentric)
    ];
    
    // Weights: ROM (35%), Velocity (20%), Jerk (17.5%), Explosiveness (27.5%)
    const weights = [0.20, 0.15, 0.20, 0.175, 0.15, 0.125];
    // Sum = 1.0 ✓
    
    return asymmetries.reduce((sum, asym, i) => sum + asym * weights[i], 0);
}
```

---

#### 14. phase_shift
**Description:** Angular phase difference between limbs  
**Formula:** $\frac{lag \times 360}{n}$ (in degrees)

```typescript
function calculatePhaseShift(
    leftValues: number[], 
    rightValues: number[], 
    timeStep: number
): number {
    const { lag } = calculateCrossCorrelation(leftValues, rightValues);
    const n = Math.min(leftValues.length, rightValues.length);
    // Convert lag to phase angle (assuming one cycle = 360°)
    return Math.abs((lag * 360) / n);
}
```

---

#### 15. cross_correlation
**Description:** Maximum normalized correlation between left and right  
**Formula:** Pearson correlation at optimal lag  
**Range:** -1 to 1

```typescript
function getCrossCorrelationValue(left: number[], right: number[]): number {
    const { correlation } = calculateCrossCorrelation(left, right);
    return correlation;
}
```

---

#### 16. temporal_lag
**Description:** Time delay between limbs in milliseconds  
**Formula:** $lag \times \Delta t \times 1000$

```typescript
function calculateTemporalLag(
    leftValues: number[], 
    rightValues: number[], 
    timeStep: number
): number {
    const { lag } = calculateCrossCorrelation(leftValues, rightValues);
    return Math.abs(lag) * timeStep * 1000;
}
```

---

### Category 3: Unilateral Analysis

#### 17. flexor_extensor_ratio
**Description:** Ratio of flexion to extension capability  
**Formula:** $\frac{|peak_{flexion}|}{|peak_{extension}|} \times 100$

```typescript
function calculateFlexorExtensorRatio(peakFlexion: number, peakExtension: number): number {
    const absExtension = Math.abs(peakExtension);
    const absFlexion = Math.abs(peakFlexion);
    return absExtension > 0 ? (absFlexion / absExtension) * 100 : 0;
}
```

---

#### 18. eccentric_concentric_ratio
**Description:** Ratio of loading to concentric explosiveness  
**Formula:** $\frac{explosiveness_{loading}}{explosiveness_{concentric}} \times 100$

```typescript
function calculateEccentricConcentricRatio(
    explosivenessLoading: number, 
    explosivenessConcentric: number
): number {
    return explosivenessConcentric > 0 
        ? (explosivenessLoading / explosivenessConcentric) * 100 
        : 0;
}
```

---

#### 19. bilateral_ratio_difference
**Description:** Difference in unilateral ratios between limbs  
**Formula:** $|ratio_{left} - ratio_{right}|$

```typescript
function calculateBilateralRatioDifference(leftRatio: number, rightRatio: number): number {
    return Math.abs(leftRatio - rightRatio);
}
```

---

### Category 4: Ground Contact & Flight

#### 20. ground_contact_time_ms
**Description:** Duration foot contacts ground  
**Formula:** $t_{takeoff} - t_{touchdown}$

```typescript
function calculateGroundContactTime(accel: number[], timeStep: number): number {
    const contacts = detectGroundContacts(accel, timeStep);
    if (contacts.length === 0) return 0;
    
    const avgContact = contacts.reduce((sum, c) => sum + c.contactTimeMs, 0) / contacts.length;
    return avgContact;
}
```

---

#### 21. flight_time_ms
**Description:** Airborne duration during jumps  
**Formula:** $t_{landing} - t_{takeoff}$

```typescript
function calculateFlightTime(accel: number[], timeStep: number): number {
    const contacts = detectGroundContacts(accel, timeStep);
    if (contacts.length === 0) return 0;
    
    const validFlights = contacts.filter(c => c.flightTimeMs > 0);
    if (validFlights.length === 0) return 0;
    
    return validFlights.reduce((sum, c) => sum + c.flightTimeMs, 0) / validFlights.length;
}
```

---

#### 22. jump_height_cm
**Description:** Estimated vertical displacement from flight time  
**Formula:** $\frac{g \times t_{flight}^2}{8}$  
**Derivation:** $h = \frac{1}{2}g(\frac{t}{2})^2 = \frac{gt^2}{8}$

```typescript
function calculateJumpHeight(flightTimeMs: number): number {
    if (flightTimeMs <= 0) return 0;
    const g = 9.81; // m/s²
    const t = flightTimeMs / 1000; // Convert to seconds
    const heightM = (g * t * t) / 8;
    return heightM * 100; // Convert to cm
}
```

---

#### 23. RSI (Reactive Strength Index)
**Description:** Ratio of jump height to ground contact time  
**Formula:** $\frac{jump\_height(m)}{ground\_contact\_time(s)}$

```typescript
function calculateRSI(jumpHeightCm: number, groundContactTimeMs: number): number {
    if (groundContactTimeMs <= 0) return 0;
    const heightM = jumpHeightCm / 100;
    const contactS = groundContactTimeMs / 1000;
    return heightM / contactS;
}
```

---

### Category 5: Force/Power Metrics

#### 24. RMD (Rate of Motion Development)
**Description:** Rate of acceleration change during concentric phase - measures how quickly motion develops  
**Formula:** $\frac{\Delta a}{\Delta t}$ (g/s)  
**Note:** Renamed from eRFD. Unlike RFD (Rate of Force Development) which requires force plates, RMD measures motion kinematics from IMU acceleration.

```typescript
function calculateRMD(
    accel: number[], 
    timeStep: number, 
    phaseStartIdx: number, 
    phaseEndIdx: number
): number {
    if (phaseEndIdx <= phaseStartIdx) return 0;
    if (phaseStartIdx < 0 || phaseEndIdx >= accel.length) return 0;
    
    const deltaAccel = accel[phaseEndIdx] - accel[phaseStartIdx];
    const deltaTime = (phaseEndIdx - phaseStartIdx) * timeStep;
    
    return deltaTime > 0 ? deltaAccel / deltaTime : 0;
}

// Auto-detect concentric phase and calculate RMD
function calculateRMDAuto(accel: number[], timeStep: number): number {
    // Find the steepest positive slope in acceleration
    let maxRFD = 0;
    const windowSize = Math.max(5, Math.floor(0.05 / timeStep)); // 50ms window
    
    for (let i = 0; i < accel.length - windowSize; i++) {
        const rfd = (accel[i + windowSize] - accel[i]) / (windowSize * timeStep);
        if (rfd > maxRFD) {
            maxRFD = rfd;
        }
    }
    
    return maxRFD;
}
```

---

#### 25. normalized_force - CORRECTED
**Description:** Force relative to body weight  
**Formula:** Acceleration magnitude in g-units (1g = 1 BW static)  
**Note:** For vertical axis, stationary = ~1g

```typescript
function calculateNormalizedForce(accelG: number): number {
    // Input: acceleration in g-units
    // Output: force in body weight multiples
    // At rest pointing up: accel reads ~1g = 1 BW
    // During jump push-off: accel reads ~2-3g = 2-3 BW
    return Math.abs(accelG);
}

function calculatePeakNormalizedForce(accel: number[]): number {
    if (accel.length === 0) return 0;
    const absAccel = accel.map(Math.abs);
    return findRobustPeak(absAccel);
}
```

---

#### 26. impulse_estimate
**Description:** Integral of acceleration over time (velocity change)  
**Formula:** $\int a \, dt$ (m/s, normalized)

```typescript
function calculateImpulseEstimate(accel: number[], timeStep: number): number {
    if (accel.length < 2) return 0;
    
    // Trapezoidal integration
    let impulse = 0;
    for (let i = 1; i < accel.length; i++) {
        impulse += ((accel[i] + accel[i - 1]) / 2) * timeStep;
    }
    return impulse;
}
```

---

### Category 6: Stiffness Metrics

#### 27. leg_stiffness
**Description:** Spring-like behavior of the leg (Morin method)  
**Formula:** $k_{leg} = \frac{m \pi (t_f + t_c)}{t_c^2 \left(\frac{t_f + t_c}{\pi} - \frac{t_c}{4}\right)}$

```typescript
function calculateLegStiffness(
    mass: number,           // kg
    flightTimeMs: number,
    contactTimeMs: number
): number {
    if (contactTimeMs <= 0 || mass <= 0) return 0;
    
    const tf = flightTimeMs / 1000;  // seconds
    const tc = contactTimeMs / 1000; // seconds
    
    const numerator = mass * Math.PI * (tf + tc);
    const denominator = tc * tc * ((tf + tc) / Math.PI - tc / 4);
    
    if (denominator <= 0) return 0;
    
    return numerator / denominator; // N/m
}
```

---

#### 28. vertical_stiffness
**Description:** Vertical spring stiffness  
**Formula:** $k_{vert} = \frac{F_{max}}{\Delta y_{COM}}$

```typescript
function calculateVerticalStiffness(
    peakForceN: number,
    comDisplacementM: number
): number {
    return comDisplacementM > 0 ? peakForceN / comDisplacementM : 0;
}

// Morin method (from temporal parameters only)
function calculateVerticalStiffnessMorin(
    mass: number,
    flightTimeMs: number,
    contactTimeMs: number
): number {
    if (contactTimeMs <= 0 || mass <= 0) return 0;
    
    const tf = flightTimeMs / 1000;
    const tc = contactTimeMs / 1000;
    const g = 9.81;
    
    // Estimate peak force (sine wave assumption)
    const Fmax = mass * g * (Math.PI / 2) * (tf / tc + 1);
    
    // Estimate COM displacement
    const deltaY = (Fmax * tc * tc) / (mass * Math.PI * Math.PI);
    
    return deltaY > 0 ? Fmax / deltaY : 0; // N/m
}
```

---

### Category 7: Smoothness Metrics

#### 29. SPARC (Spectral Arc Length) - CORRECTED
**Description:** Frequency-domain smoothness metric (less negative = smoother, more negative = jerkier)  
**Formula:** $SPARC = -\int_0^{\omega_c} \sqrt{\left(\frac{1}{\omega_c}\right)^2 + \left(\frac{d\hat{V}}{d\omega}\right)^2} \, d\omega$

```typescript
function calculateSPARC(
    velocity: number[], 
    fs: number,              // Sampling frequency (Hz)
    fc: number = 10,         // Cutoff frequency (Hz)
    ampThreshold: number = 0.05
): number {
    if (velocity.length < 4) return 0;
    
    // Compute FFT
    const fft = performFFT(velocity);
    const magnitude = fftMagnitude(fft);
    const N = velocity.length;
    
    // Frequency resolution
    const freqRes = fs / N;
    const freqs = Array.from({ length: Math.floor(N/2) }, (_, i) => i * freqRes);
    
    // Normalize spectrum
    const maxMag = Math.max(...magnitude.slice(0, Math.floor(N/2)));
    if (maxMag === 0) return 0;
    
    const normSpectrum = magnitude.slice(0, Math.floor(N/2)).map(m => m / maxMag);
    
    // Find cutoff index (fc or amplitude threshold)
    let cutoffIdx = freqs.findIndex(f => f > fc);
    if (cutoffIdx === -1) cutoffIdx = freqs.length;
    
    // Also cut at amplitude threshold
    for (let i = 1; i < cutoffIdx; i++) {
        if (normSpectrum[i] < ampThreshold) {
            cutoffIdx = i;
            break;
        }
    }
    
    if (cutoffIdx < 2) return 0;
    
    // Calculate spectral arc length
    let arcLength = 0;
    const dw = 1 / (fc > 0 ? fc : 1); // Normalized frequency step
    
    for (let i = 1; i < cutoffIdx; i++) {
        const dv = normSpectrum[i] - normSpectrum[i - 1];
        arcLength += Math.sqrt(dw * dw + dv * dv);
    }
    
    return -arcLength; // More negative = smoother
}
```

---

#### 30. LDLJ (Log Dimensionless Jerk)
**Description:** Time-domain smoothness metric (less negative = smoother, more negative = jerkier)  
**Formula:** $LDLJ = -\ln\left(\frac{t^3}{v_{peak}^2} \int j^2 \, dt\right)$

```typescript
function calculateLDLJ(values: number[], timeStep: number): number {
    const velocity = calculateDerivative(values, timeStep);
    const acceleration = calculateDerivative(velocity, timeStep);
    const jerk = calculateDerivative(acceleration, timeStep);
    
    if (jerk.length === 0 || velocity.length === 0) return 0;
    
    const duration = jerk.length * timeStep;
    const peakVelocity = Math.max(...velocity.map(Math.abs));
    
    if (peakVelocity < 1e-10 || duration < 1e-10) return 0;
    
    // Integrate jerk squared (trapezoidal)
    let jerkSqIntegral = 0;
    for (let i = 0; i < jerk.length; i++) {
        jerkSqIntegral += jerk[i] * jerk[i] * timeStep;
    }
    
    // Dimensionless jerk
    const dimlessJerk = (duration ** 3 / peakVelocity ** 2) * jerkSqIntegral;
    
    return dimlessJerk > 0 ? -Math.log(dimlessJerk) : 0;
}
```

---

#### 31. n_velocity_peaks
**Description:** Number of peaks in velocity profile (fewer = smoother)  
**Formula:** $count(local\_maxima(v))$ above threshold

```typescript
function calculateVelocityPeaks(values: number[], timeStep: number): number {
    const velocity = calculateDerivative(values, timeStep);
    if (velocity.length < 3) return 0;
    
    const maxVel = Math.max(...velocity.map(Math.abs));
    const threshold = maxVel * 0.1; // 10% of max as noise threshold
    
    let peakCount = 0;
    for (let i = 1; i < velocity.length - 1; i++) {
        const isLocalMax = velocity[i] > velocity[i - 1] && velocity[i] > velocity[i + 1];
        const isLocalMin = velocity[i] < velocity[i - 1] && velocity[i] < velocity[i + 1];
        const aboveThreshold = Math.abs(velocity[i]) > threshold;
        
        if ((isLocalMax || isLocalMin) && aboveThreshold) {
            peakCount++;
        }
    }
    
    return peakCount;
}
```

---

### Category 8: Temporal Coordination

#### 32. max_flexion_timing_diff
**Description:** Time difference between left and right peak flexion  
**Formula:** $|t_{max\_flex\_L} - t_{max\_flex\_R}|$  
**Uses Robust Peak:** Yes (for consistency)

```typescript
function calculateMaxFlexionTimingDiff(
    leftValues: number[], 
    rightValues: number[], 
    timeStep: number
): number {
    if (leftValues.length === 0 || rightValues.length === 0) return 0;
    
    // Find robust peak value, then find its index
    const leftPeakVal = findRobustPeak(leftValues);
    const rightPeakVal = findRobustPeak(rightValues);
    
    // Find first occurrence of this peak value
    const leftMaxIdx = leftValues.findIndex(v => Math.abs(v - leftPeakVal) < 0.01);
    const rightMaxIdx = rightValues.findIndex(v => Math.abs(v - rightPeakVal) < 0.01);
    
    if (leftMaxIdx === -1 || rightMaxIdx === -1) return 0;
    
    return Math.abs(leftMaxIdx - rightMaxIdx) * timeStep * 1000; // ms
}
```

---

#### 33. zero_velocity_phase_ms
**Description:** Duration where angular velocity is near zero (sticking point)  
**Formula:** Total duration where $|\omega| < threshold$

```typescript
function calculateZeroVelocityPhase(
    values: number[], 
    timeStep: number, 
    threshold: number = 2 // degrees per second
): number {
    const velocity = calculateDerivative(values, timeStep);
    if (velocity.length === 0) return 0;
    
    let zeroPhaseCount = 0;
    for (const v of velocity) {
        if (Math.abs(v) < threshold) {
            zeroPhaseCount++;
        }
    }
    
    return zeroPhaseCount * timeStep * 1000; // ms
}
```

---

#### 34. shock_absorption_score
**Description:** Quality of landing mechanics (double-dip pattern detection)  
**Formula:** Heuristic pattern detection in 50-100ms post-impact

```typescript
interface ShockAbsorptionResult {
    score: number;           // 0-100
    doubleDipDetected: boolean;
    patternQuality: 'excellent' | 'good' | 'poor' | 'absent';
}

function calculateShockAbsorptionScore(
    kneeAngle: number[], 
    accel: number[], 
    timeStep: number
): ShockAbsorptionResult {
    const contacts = detectGroundContacts(accel, timeStep);
    
    if (contacts.length === 0) {
        return { score: 0, doubleDipDetected: false, patternQuality: 'absent' };
    }
    
    let totalScore = 0;
    let doubleDipCount = 0;
    
    for (const contact of contacts) {
        // Analyze 50-100ms window post-impact
        const window50ms = Math.floor(0.05 / timeStep);
        const window100ms = Math.floor(0.1 / timeStep);
        const windowStart = contact.touchdownIndex;
        const windowEnd = Math.min(windowStart + window100ms, kneeAngle.length);
        
        if (windowEnd - windowStart < 5) continue;
        
        const windowData = kneeAngle.slice(windowStart, windowEnd);
        
        // Detect double-dip: impact → micro-flexion → extension → main flexion
        const peaks: number[] = [];
        const troughs: number[] = [];
        
        for (let i = 1; i < windowData.length - 1; i++) {
            if (windowData[i] > windowData[i - 1] && windowData[i] > windowData[i + 1]) {
                peaks.push(i);
            }
            if (windowData[i] < windowData[i - 1] && windowData[i] < windowData[i + 1]) {
                troughs.push(i);
            }
        }
        
        // Double dip = at least 2 peaks and 1 trough
        const hasDoubleDip = peaks.length >= 2 && troughs.length >= 1;
        if (hasDoubleDip) doubleDipCount++;
        
        // Score based on pattern presence and timing
        const patternScore = hasDoubleDip ? 80 : 40;
        const timingScore = (peaks.length > 0 && peaks[0] < window50ms) ? 20 : 0;
        
        totalScore += patternScore + timingScore;
    }
    
    const avgScore = contacts.length > 0 ? totalScore / contacts.length : 0;
    const doubleDipRatio = contacts.length > 0 ? doubleDipCount / contacts.length : 0;
    
    let patternQuality: 'excellent' | 'good' | 'poor' | 'absent';
    if (doubleDipRatio > 0.8) patternQuality = 'excellent';
    else if (doubleDipRatio > 0.5) patternQuality = 'good';
    else if (doubleDipRatio > 0) patternQuality = 'poor';
    else patternQuality = 'absent';
    
    return { score: avgScore, doubleDipDetected: doubleDipCount > 0, patternQuality };
}
```

---

### Category 9: Gait Cycle

#### 35. stance_phase_pct
**Description:** Percentage of gait cycle spent in stance  
**Formula:** $\frac{t_{stance}}{t_{stride}} \times 100$

```typescript
function calculateStancePhasePct(stanceTimeMs: number, strideTimeMs: number): number {
    return strideTimeMs > 0 ? (stanceTimeMs / strideTimeMs) * 100 : 0;
}
```

---

#### 36. swing_phase_pct
**Description:** Percentage of gait cycle spent in swing  
**Formula:** $\frac{t_{swing}}{t_{stride}} \times 100 = 100 - stance\%$

```typescript
function calculateSwingPhasePct(stanceTimeMs: number, strideTimeMs: number): number {
    if (strideTimeMs <= 0) return 0;
    const swingTimeMs = strideTimeMs - stanceTimeMs;
    return (swingTimeMs / strideTimeMs) * 100;
}
```

---

#### 37. duty_factor
**Description:** Ratio of contact time to stride time  
**Formula:** $\frac{t_{contact}}{t_{stride}}$ (0-1)

```typescript
function calculateDutyFactor(contactTimeMs: number, strideTimeMs: number): number {
    return strideTimeMs > 0 ? contactTimeMs / strideTimeMs : 0;
}
```

---

### Category 10: Movement Classification

#### 38. movement_type
**Description:** Classifies movement as bilateral (in-phase) or unilateral (anti-phase gait)  
**Method:** Cross-correlation at lag=0 vs optimal lag analysis

```typescript
type MovementType = 'bilateral' | 'unilateral' | 'single_leg' | 'mixed' | 'unknown';

interface MovementClassification {
    type: MovementType;
    confidence: number;              // 0-100
    correlationAtZero: number;       // -1 to 1
    optimalLag: number;              // samples
    optimalCorrelation: number;      // -1 to 1
    estimatedCycleSamples: number;   // for phase calculation
    phaseOffsetDegrees: number;      // 0-360
}

function classifyMovementType(
    left: number[],
    right: number[],
    timeStep: number
): MovementClassification {
    const n = Math.min(left.length, right.length);
    if (n < 20) {
        return {
            type: 'unknown', confidence: 0, correlationAtZero: 0,
            optimalLag: 0, optimalCorrelation: 0, estimatedCycleSamples: 0, phaseOffsetDegrees: 0
        };
    }

    // Calculate means and stds
    const meanL = left.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanR = right.slice(0, n).reduce((a, b) => a + b, 0) / n;
    
    let sumSqL = 0, sumSqR = 0;
    for (let i = 0; i < n; i++) {
        sumSqL += (left[i] - meanL) ** 2;
        sumSqR += (right[i] - meanR) ** 2;
    }
    const stdL = Math.sqrt(sumSqL / n);
    const stdR = Math.sqrt(sumSqR / n);

    // Check for single-leg (one signal flat)
    const cvL = stdL / Math.abs(meanL || 1);
    const cvR = stdR / Math.abs(meanR || 1);
    if (cvL < 0.05 || cvR < 0.05) {
        return {
            type: 'single_leg', confidence: 90, correlationAtZero: 0,
            optimalLag: 0, optimalCorrelation: 0, estimatedCycleSamples: 0, phaseOffsetDegrees: 0
        };
    }

    if (stdL < 1e-10 || stdR < 1e-10) {
        return {
            type: 'unknown', confidence: 0, correlationAtZero: 0,
            optimalLag: 0, optimalCorrelation: 0, estimatedCycleSamples: 0, phaseOffsetDegrees: 0
        };
    }

    // Estimate cycle length from autocorrelation
    const estimatedCycleSamples = estimateCycleLength(left, n);
    const maxLag = Math.min(Math.floor(n / 2), estimatedCycleSamples || 100);

    // Calculate cross-correlation at various lags
    let corrAtZero = 0;
    let bestCorr = -Infinity;
    let bestLag = 0;

    for (let lag = -maxLag; lag <= maxLag; lag++) {
        let sum = 0, count = 0;
        for (let i = 0; i < n; i++) {
            const j = i + lag;
            if (j >= 0 && j < n) {
                sum += (left[i] - meanL) * (right[j] - meanR);
                count++;
            }
        }
        const corr = count > 0 ? sum / (count * stdL * stdR) : 0;
        
        if (lag === 0) corrAtZero = corr;
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }

    // Calculate phase offset in degrees
    const cycleSamples = estimatedCycleSamples || n;
    const phaseOffsetDegrees = Math.abs((bestLag * 360) / cycleSamples) % 360;

    // Classification logic
    let type: MovementType;
    let confidence: number;

    if (corrAtZero > 0.7) {
        // High correlation at zero lag = bilateral (squat, jump)
        type = 'bilateral';
        confidence = Math.min(100, corrAtZero * 100);
    } else if (corrAtZero < -0.3 && phaseOffsetDegrees > 150 && phaseOffsetDegrees < 210) {
        // Negative correlation + ~180° phase = unilateral gait
        type = 'unilateral';
        confidence = Math.min(100, Math.abs(corrAtZero) * 100 + 20);
    } else if (corrAtZero > 0.3 && corrAtZero <= 0.7) {
        // Moderate correlation = could be mixed
        type = 'mixed';
        confidence = 50 + (corrAtZero - 0.3) * 50;
    } else {
        type = 'unilateral';
        confidence = 60;
    }

    return {
        type,
        confidence,
        correlationAtZero: corrAtZero,
        optimalLag: bestLag,
        optimalCorrelation: bestCorr,
        estimatedCycleSamples: cycleSamples,
        phaseOffsetDegrees
    };
}

// Helper: estimate cycle length from autocorrelation
function estimateCycleLength(signal: number[], n: number): number {
    const mean = signal.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let sumSq = 0;
    for (let i = 0; i < n; i++) sumSq += (signal[i] - mean) ** 2;
    const variance = sumSq / n;
    if (variance < 1e-10) return n;

    // Find first peak in autocorrelation after lag 0
    const maxSearchLag = Math.floor(n / 2);
    let prevCorr = 1;
    let increasing = false;
    
    for (let lag = 1; lag < maxSearchLag; lag++) {
        let sum = 0, count = 0;
        for (let i = 0; i < n - lag; i++) {
            sum += (signal[i] - mean) * (signal[i + lag] - mean);
            count++;
        }
        const corr = sum / (count * variance);
        
        if (corr > prevCorr) increasing = true;
        if (increasing && corr < prevCorr && prevCorr > 0.3) {
            return lag - 1; // Previous lag was the peak
        }
        prevCorr = corr;
    }
    return maxSearchLag;
}
```

---

#### 39. rolling_phase_offset
**Description:** Windowed phase offset tracking to detect movement transitions  
**Formula:** Cross-correlation in sliding window

```typescript
interface RollingPhaseResult {
    phaseOffsetSeries: number[];      // Phase offset at each window position (degrees)
    correlationSeries: number[];      // Correlation at each window position
    windowCenters: number[];          // Sample indices of window centers
    transitions: TransitionEvent[];   // Detected movement type changes
    dominantPhaseOffset: number;      // Most common phase offset
}

interface TransitionEvent {
    index: number;
    timeMs: number;
    fromPhase: number;
    toPhase: number;
    fromType: MovementType;
    toType: MovementType;
}

function calculateRollingPhaseOffset(
    left: number[],
    right: number[],
    timeStep: number,
    windowSize: number = 100,    // samples per window
    stepSize: number = 10        // window step
): RollingPhaseResult {
    const n = Math.min(left.length, right.length);
    const phaseOffsetSeries: number[] = [];
    const correlationSeries: number[] = [];
    const windowCenters: number[] = [];
    const transitions: TransitionEvent[] = [];

    if (n < windowSize) {
        return {
            phaseOffsetSeries: [], correlationSeries: [], windowCenters: [],
            transitions: [], dominantPhaseOffset: 0
        };
    }

    let prevClassification: MovementClassification | null = null;
    const PHASE_CHANGE_THRESHOLD = 30; // degrees

    for (let start = 0; start <= n - windowSize; start += stepSize) {
        const end = start + windowSize;
        const windowLeft = left.slice(start, end);
        const windowRight = right.slice(start, end);
        const center = start + Math.floor(windowSize / 2);

        const classification = classifyMovementType(windowLeft, windowRight, timeStep);
        
        phaseOffsetSeries.push(classification.phaseOffsetDegrees);
        correlationSeries.push(classification.correlationAtZero);
        windowCenters.push(center);

        // Detect transitions
        if (prevClassification) {
            const phaseDiff = Math.abs(classification.phaseOffsetDegrees - prevClassification.phaseOffsetDegrees);
            const typeChanged = classification.type !== prevClassification.type;
            
            if (phaseDiff > PHASE_CHANGE_THRESHOLD || typeChanged) {
                transitions.push({
                    index: center,
                    timeMs: center * timeStep * 1000,
                    fromPhase: prevClassification.phaseOffsetDegrees,
                    toPhase: classification.phaseOffsetDegrees,
                    fromType: prevClassification.type,
                    toType: classification.type
                });
            }
        }
        prevClassification = classification;
    }

    // Calculate dominant phase offset (mode)
    const phaseHistogram = new Map<number, number>();
    for (const phase of phaseOffsetSeries) {
        const bucket = Math.round(phase / 10) * 10; // 10° buckets
        phaseHistogram.set(bucket, (phaseHistogram.get(bucket) || 0) + 1);
    }
    let dominantPhaseOffset = 0;
    let maxCount = 0;
    for (const [phase, count] of phaseHistogram) {
        if (count > maxCount) {
            maxCount = count;
            dominantPhaseOffset = phase;
        }
    }

    return {
        phaseOffsetSeries,
        correlationSeries,
        windowCenters,
        transitions,
        dominantPhaseOffset
    };
}
```

---

### Category 11: Advanced Asymmetry Analysis

#### Pre-requisite: Phase Correction

For unilateral movements (gait), signals must be phase-aligned before asymmetry analysis. Otherwise, the natural ~180° phase offset would appear as massive "asymmetry."

```typescript
interface PhaseCorrectedSignals {
    left: number[];
    right: number[];           // Phase-shifted to align with left
    appliedShiftSamples: number;
    appliedShiftMs: number;
    movementType: MovementType;
    requiresCorrection: boolean;
}

function applyPhaseCorrection(
    left: number[],
    right: number[],
    timeStep: number,
    forceCorrection: boolean = false
): PhaseCorrectedSignals {
    const n = Math.min(left.length, right.length);
    
    // 1. Classify movement
    const classification = classifyMovementType(left, right, timeStep);
    
    // 2. Determine if phase correction is needed
    const requiresCorrection = forceCorrection || 
        classification.type === 'unilateral' || 
        classification.type === 'mixed' ||
        classification.correlationAtZero < 0.5;
    
    if (!requiresCorrection) {
        return {
            left: left.slice(0, n),
            right: right.slice(0, n),
            appliedShiftSamples: 0,
            appliedShiftMs: 0,
            movementType: classification.type,
            requiresCorrection: false
        };
    }
    
    // 3. Find optimal alignment
    const alignment = calculateOptimalPhaseAlignment(left, right, timeStep);
    
    // 4. Apply shift to right signal
    const shiftedRight: number[] = new Array(n);
    const shift = alignment.optimalOffsetSamples;
    
    for (let i = 0; i < n; i++) {
        const srcIdx = i + shift;
        if (srcIdx >= 0 && srcIdx < n) {
            shiftedRight[i] = right[srcIdx];
        } else if (srcIdx < 0) {
            // Pad start with first valid value or extrapolate
            shiftedRight[i] = right[0];
        } else {
            // Pad end with last valid value
            shiftedRight[i] = right[n - 1];
        }
    }
    
    return {
        left: left.slice(0, n),
        right: shiftedRight,
        appliedShiftSamples: shift,
        appliedShiftMs: shift * timeStep * 1000,
        movementType: classification.type,
        requiresCorrection: true
    };
}
```

---

#### 40. advanced_asymmetry
**Description:** Separates placement offset from true movement asymmetry using convolution  
**Method:** Phase-correct signals first, then Gaussian kernel convolution extracts low-freq baseline

```typescript
interface AsymmetryEvent {
    startIndex: number;
    endIndex: number;
    startTimeMs: number;
    endTimeMs: number;
    durationMs: number;
    peakAsymmetry: number;
    avgAsymmetry: number;
    direction: 'left_dominant' | 'right_dominant';
    area: number;  // Integral of asymmetry over time (severity)
}

interface AdvancedAsymmetryResult {
    // Phase correction info
    phaseCorrection: PhaseCorrectedSignals;
    
    // Continuous signals (on phase-corrected data)
    baselineOffset: number[];         // Placement offset over time (low-freq)
    realAsymmetry: number[];          // True asymmetry signal (high-freq)
    correctedLeft: number[];          // L with baseline removed
    correctedRight: number[];         // R with baseline removed
    
    // Events
    asymmetryEvents: AsymmetryEvent[];
    
    // Summary statistics
    avgBaselineOffset: number;        // Mean placement offset
    avgRealAsymmetry: number;         // Mean absolute real asymmetry
    maxRealAsymmetry: number;         // Peak real asymmetry
    totalAsymmetryDurationMs: number; // Total time in significant asymmetry
    asymmetryPercentage: number;      // % of recording with significant asymmetry
    
    // Quality metrics
    baselineStability: number;        // How stable is the offset (lower = more stable)
    signalToNoiseRatio: number;       // Real asymmetry vs noise floor
}

// Gaussian kernel generator
function generateGaussianKernel(size: number): number[] {
    const kernel: number[] = [];
    const sigma = size / 4;
    const mid = Math.floor(size / 2);
    let sum = 0;
    
    for (let i = 0; i < size; i++) {
        const val = Math.exp(-0.5 * Math.pow((i - mid) / sigma, 2));
        kernel.push(val);
        sum += val;
    }
    
    // Normalize
    return kernel.map(v => v / sum);
}

// Convolution with edge handling
function convolveSignal(signal: number[], kernel: number[]): number[] {
    const result: number[] = [];
    const half = Math.floor(kernel.length / 2);
    
    for (let i = 0; i < signal.length; i++) {
        let sum = 0;
        let weightSum = 0;
        
        for (let j = 0; j < kernel.length; j++) {
            const idx = i + j - half;
            if (idx >= 0 && idx < signal.length) {
                sum += signal[idx] * kernel[j];
                weightSum += kernel[j];
            }
        }
        
        result.push(weightSum > 0 ? sum / weightSum : 0);
    }
    
    return result;
}

function calculateAdvancedAsymmetry(
    left: number[],
    right: number[],
    timeStep: number,
    kernelSize: number = 100,
    asymmetryThreshold: number = 5,  // Minimum asymmetry to count as "event"
    autoPhaseCorrect: boolean = true // Apply phase correction for unilateral movements
): AdvancedAsymmetryResult {
    
    // 1. Apply phase correction if needed
    const phaseCorrection = autoPhaseCorrect 
        ? applyPhaseCorrection(left, right, timeStep)
        : {
            left: left.slice(0, Math.min(left.length, right.length)),
            right: right.slice(0, Math.min(left.length, right.length)),
            appliedShiftSamples: 0,
            appliedShiftMs: 0,
            movementType: 'unknown' as MovementType,
            requiresCorrection: false
        };
    
    const L = phaseCorrection.left;
    const R = phaseCorrection.right;
    const n = L.length;
    
    if (n < kernelSize) {
        return {
            phaseCorrection,
            baselineOffset: [], realAsymmetry: [], correctedLeft: [], correctedRight: [],
            asymmetryEvents: [], avgBaselineOffset: 0, avgRealAsymmetry: 0, maxRealAsymmetry: 0,
            totalAsymmetryDurationMs: 0, asymmetryPercentage: 0, baselineStability: 0, signalToNoiseRatio: 0
        };
    }

    // 2. Calculate raw difference (now on phase-aligned signals)
    const rawDiff: number[] = [];
    for (let i = 0; i < n; i++) {
        rawDiff.push(L[i] - R[i]);
    }

    // 3. Generate Gaussian kernel and convolve to extract baseline
    const kernel = generateGaussianKernel(kernelSize);
    const baselineOffset = convolveSignal(rawDiff, kernel);

    // 4. Real asymmetry = raw diff - baseline (high-freq component)
    const realAsymmetry: number[] = [];
    for (let i = 0; i < n; i++) {
        realAsymmetry.push(rawDiff[i] - baselineOffset[i]);
    }

    // 5. Correct signals by splitting baseline offset
    const correctedLeft: number[] = [];
    const correctedRight: number[] = [];
    for (let i = 0; i < n; i++) {
        correctedLeft.push(L[i] - baselineOffset[i] / 2);
        correctedRight.push(R[i] + baselineOffset[i] / 2);
    }

    // 6. Detect asymmetry events (periods of significant asymmetry)
    const asymmetryEvents: AsymmetryEvent[] = [];
    let inEvent = false;
    let eventStart = 0;
    let eventPeak = 0;
    let eventSum = 0;
    let eventCount = 0;
    let eventDirection: 'left_dominant' | 'right_dominant' = 'left_dominant';

    for (let i = 0; i < n; i++) {
        const absAsym = Math.abs(realAsymmetry[i]);
        
        if (absAsym > asymmetryThreshold) {
            if (!inEvent) {
                inEvent = true;
                eventStart = i;
                eventPeak = absAsym;
                eventSum = absAsym;
                eventCount = 1;
                eventDirection = realAsymmetry[i] > 0 ? 'left_dominant' : 'right_dominant';
            } else {
                eventPeak = Math.max(eventPeak, absAsym);
                eventSum += absAsym;
                eventCount++;
            }
        } else if (inEvent) {
            const event: AsymmetryEvent = {
                startIndex: eventStart,
                endIndex: i - 1,
                startTimeMs: eventStart * timeStep * 1000,
                endTimeMs: (i - 1) * timeStep * 1000,
                durationMs: (i - 1 - eventStart) * timeStep * 1000,
                peakAsymmetry: eventPeak,
                avgAsymmetry: eventSum / eventCount,
                direction: eventDirection,
                area: eventSum * timeStep
            };
            
            if (event.durationMs > 50) {
                asymmetryEvents.push(event);
            }
            inEvent = false;
        }
    }

    // Handle event at end of signal
    if (inEvent && eventCount > 0) {
        const event: AsymmetryEvent = {
            startIndex: eventStart,
            endIndex: n - 1,
            startTimeMs: eventStart * timeStep * 1000,
            endTimeMs: (n - 1) * timeStep * 1000,
            durationMs: (n - 1 - eventStart) * timeStep * 1000,
            peakAsymmetry: eventPeak,
            avgAsymmetry: eventSum / eventCount,
            direction: eventDirection,
            area: eventSum * timeStep
        };
        if (event.durationMs > 50) {
            asymmetryEvents.push(event);
        }
    }

    // 7. Calculate summary statistics
    const avgBaselineOffset = baselineOffset.reduce((a, b) => a + Math.abs(b), 0) / n;
    const avgRealAsymmetry = realAsymmetry.reduce((a, b) => a + Math.abs(b), 0) / n;
    const maxRealAsymmetry = Math.max(...realAsymmetry.map(Math.abs));
    
    const totalAsymmetryDurationMs = asymmetryEvents.reduce((sum, e) => sum + e.durationMs, 0);
    const totalDurationMs = n * timeStep * 1000;
    const asymmetryPercentage = totalDurationMs > 0 ? (totalAsymmetryDurationMs / totalDurationMs) * 100 : 0;

    // 8. Quality metrics
    let baselineChangeSum = 0;
    for (let i = 1; i < n; i++) {
        baselineChangeSum += Math.abs(baselineOffset[i] - baselineOffset[i - 1]);
    }
    const baselineStability = baselineChangeSum / (n - 1);

    const quietPeriods = realAsymmetry.filter(a => Math.abs(a) < asymmetryThreshold);
    const noiseFloor = quietPeriods.length > 10 
        ? Math.sqrt(quietPeriods.reduce((s, v) => s + v * v, 0) / quietPeriods.length)
        : 1;
    const signalToNoiseRatio = noiseFloor > 0 ? maxRealAsymmetry / noiseFloor : 0;

    return {
        phaseCorrection,
        baselineOffset,
        realAsymmetry,
        correctedLeft,
        correctedRight,
        asymmetryEvents,
        avgBaselineOffset,
        avgRealAsymmetry,
        maxRealAsymmetry,
        totalAsymmetryDurationMs,
        asymmetryPercentage,
        baselineStability,
        signalToNoiseRatio
    };
}
```

---

#### 40b. rolling_advanced_asymmetry
**Description:** Windowed asymmetry analysis with per-window phase correction  
**Use case:** Long recordings with changing movement types (walk → run → walk)

```typescript
interface RollingAsymmetryWindow {
    windowCenter: number;
    windowCenterMs: number;
    movementType: MovementType;
    phaseOffsetApplied: number;
    avgAsymmetry: number;
    maxAsymmetry: number;
    baselineOffset: number;
}

interface RollingAsymmetryResult {
    windows: RollingAsymmetryWindow[];
    asymmetryTimeSeries: number[];     // Interpolated to full signal length
    movementTypeTimeSeries: MovementType[];
    overallSummary: {
        avgAsymmetry: number;
        maxAsymmetry: number;
        timeInBilateral: number;       // ms
        timeInUnilateral: number;      // ms
        transitionCount: number;
    };
}

function calculateRollingAdvancedAsymmetry(
    left: number[],
    right: number[],
    timeStep: number,
    windowSize: number = 100,
    stepSize: number = 20,
    kernelSize: number = 50  // Smaller kernel for windowed analysis
): RollingAsymmetryResult {
    const n = Math.min(left.length, right.length);
    const windows: RollingAsymmetryWindow[] = [];
    const asymmetryTimeSeries: number[] = new Array(n).fill(0);
    const movementTypeTimeSeries: MovementType[] = new Array(n).fill('unknown');
    
    let timeInBilateral = 0;
    let timeInUnilateral = 0;
    let prevType: MovementType | null = null;
    let transitionCount = 0;

    for (let start = 0; start <= n - windowSize; start += stepSize) {
        const end = start + windowSize;
        const center = start + Math.floor(windowSize / 2);
        
        const windowL = left.slice(start, end);
        const windowR = right.slice(start, end);
        
        // Analyze this window
        const result = calculateAdvancedAsymmetry(
            windowL, windowR, timeStep, kernelSize, 5, true
        );
        
        const window: RollingAsymmetryWindow = {
            windowCenter: center,
            windowCenterMs: center * timeStep * 1000,
            movementType: result.phaseCorrection.movementType,
            phaseOffsetApplied: result.phaseCorrection.appliedShiftSamples,
            avgAsymmetry: result.avgRealAsymmetry,
            maxAsymmetry: result.maxRealAsymmetry,
            baselineOffset: result.avgBaselineOffset
        };
        windows.push(window);
        
        // Track time in each movement type
        const windowDurationMs = windowSize * timeStep * 1000;
        if (window.movementType === 'bilateral') {
            timeInBilateral += windowDurationMs;
        } else if (window.movementType === 'unilateral') {
            timeInUnilateral += windowDurationMs;
        }
        
        // Detect transitions
        if (prevType !== null && prevType !== window.movementType) {
            transitionCount++;
        }
        prevType = window.movementType;
        
        // Fill time series for this window region
        const fillStart = Math.max(0, center - Math.floor(stepSize / 2));
        const fillEnd = Math.min(n, center + Math.floor(stepSize / 2));
        for (let i = fillStart; i < fillEnd; i++) {
            asymmetryTimeSeries[i] = window.avgAsymmetry;
            movementTypeTimeSeries[i] = window.movementType;
        }
    }
    
    // Calculate overall summary
    const avgAsymmetry = windows.length > 0
        ? windows.reduce((s, w) => s + w.avgAsymmetry, 0) / windows.length
        : 0;
    const maxAsymmetry = windows.length > 0
        ? Math.max(...windows.map(w => w.maxAsymmetry))
        : 0;

    return {
        windows,
        asymmetryTimeSeries,
        movementTypeTimeSeries,
        overallSummary: {
            avgAsymmetry,
            maxAsymmetry,
            timeInBilateral,
            timeInUnilateral,
            transitionCount
        }
    };
}
```

---

#### 41. optimal_phase_alignment
**Description:** Calculates optimal phase offset to maximize signal alignment  
**Use case:** Align signals before comparison, track alignment changes

```typescript
interface PhaseAlignmentResult {
    optimalOffsetSamples: number;
    optimalOffsetMs: number;
    optimalOffsetDegrees: number;
    alignedCorrelation: number;
    unalignedCorrelation: number;
    correlationImprovement: number;
    alignedRight: number[];  // Right signal shifted for optimal alignment
}

function calculateOptimalPhaseAlignment(
    left: number[],
    right: number[],
    timeStep: number,
    maxSearchSamples: number = 50
): PhaseAlignmentResult {
    const n = Math.min(left.length, right.length);
    
    if (n < 20) {
        return {
            optimalOffsetSamples: 0, optimalOffsetMs: 0, optimalOffsetDegrees: 0,
            alignedCorrelation: 0, unalignedCorrelation: 0, correlationImprovement: 0,
            alignedRight: [...right]
        };
    }

    // Calculate means and stds
    const meanL = left.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const meanR = right.slice(0, n).reduce((a, b) => a + b, 0) / n;
    
    let sumSqL = 0, sumSqR = 0;
    for (let i = 0; i < n; i++) {
        sumSqL += (left[i] - meanL) ** 2;
        sumSqR += (right[i] - meanR) ** 2;
    }
    const stdL = Math.sqrt(sumSqL / n);
    const stdR = Math.sqrt(sumSqR / n);

    if (stdL < 1e-10 || stdR < 1e-10) {
        return {
            optimalOffsetSamples: 0, optimalOffsetMs: 0, optimalOffsetDegrees: 0,
            alignedCorrelation: 1, unalignedCorrelation: 1, correlationImprovement: 0,
            alignedRight: [...right]
        };
    }

    // Find optimal lag
    let bestCorr = -Infinity;
    let bestLag = 0;
    let corrAtZero = 0;

    for (let lag = -maxSearchSamples; lag <= maxSearchSamples; lag++) {
        let sum = 0, count = 0;
        for (let i = 0; i < n; i++) {
            const j = i + lag;
            if (j >= 0 && j < n) {
                sum += (left[i] - meanL) * (right[j] - meanR);
                count++;
            }
        }
        const corr = count > 0 ? sum / (count * stdL * stdR) : 0;
        
        if (lag === 0) corrAtZero = corr;
        if (corr > bestCorr) {
            bestCorr = corr;
            bestLag = lag;
        }
    }

    // Create aligned right signal
    const alignedRight: number[] = new Array(right.length).fill(0);
    for (let i = 0; i < right.length; i++) {
        const srcIdx = i + bestLag;
        if (srcIdx >= 0 && srcIdx < right.length) {
            alignedRight[i] = right[srcIdx];
        } else if (srcIdx < 0) {
            alignedRight[i] = right[0];  // Pad with first value
        } else {
            alignedRight[i] = right[right.length - 1];  // Pad with last value
        }
    }

    // Estimate cycle length for degree conversion
    const cycleSamples = estimateCycleLength(left, n);
    const optimalOffsetDegrees = Math.abs((bestLag * 360) / cycleSamples) % 360;

    return {
        optimalOffsetSamples: bestLag,
        optimalOffsetMs: bestLag * timeStep * 1000,
        optimalOffsetDegrees,
        alignedCorrelation: bestCorr,
        unalignedCorrelation: corrAtZero,
        correlationImprovement: bestCorr - corrAtZero,
        alignedRight
    };
}
```

---

### Category 12: Overall Performance Index

#### 42. overall_performance_index
**Description:** Single composite score (0-100) synthesizing all relevant metrics  
**Method:** Domain-based normalization with activity-aware weighting

##### Literature-Informed Enhancements (v1.2.1)

Based on analysis of FMS, PCA, GSi, CGAM, and wUSI methodologies:

| Enhancement | Source Inspiration | Benefit |
|-------------|-------------------|---------|
| Percentile ranking | GSi | Context vs population |
| Reliability weighting | CGAM | More reliable metrics count more |
| Confidence intervals | Statistical best practice | Uncertainty quantification |
| Age/sex-adjusted thresholds | FMS limitations | Population-appropriate |
| Minimal detectable change | FMS validation | Clinically meaningful change |
| Metric contribution breakdown | PCA loadings | Actionable insights |

```typescript
// ===== Enhanced Configuration =====

interface MetricNormConfig {
    name: string;
    domain: PerformanceDomain;
    direction: 'higher_better' | 'lower_better' | 'optimal_range';
    optimalMin?: number;
    optimalMax?: number;
    goodThreshold: number;
    poorThreshold: number;
    weight: number;
    bilateral: boolean;
    unilateral: boolean;
    
    // NEW: Enhanced properties
    reliability: number;              // ICC or test-retest r (0-1)
    populationMean?: number;          // For percentile calculation
    populationSD?: number;            // For percentile calculation
    ageAdjustment?: (age: number) => { good: number; poor: number };
    sexAdjustment?: (sex: 'M' | 'F') => { good: number; poor: number };
    minDataPoints?: number;           // Minimum samples for reliable metric
}

// ===== Normative Data (when available) =====

interface NormativeDatabase {
    population: string;               // e.g., "NCAA Division I Athletes"
    n: number;                        // Sample size
    metrics: Map<string, {
        mean: number;
        sd: number;
        percentiles: Map<number, number>;  // 5th, 25th, 50th, 75th, 95th
        byAge?: Map<string, { mean: number; sd: number }>;  // "18-25", "26-35", etc.
        bySex?: { M: { mean: number; sd: number }; F: { mean: number; sd: number } };
    }>;
}

// ===== Enhanced Normalization =====

interface NormalizationResult {
    score: number;                    // 0-100 normalized score
    percentile?: number;              // Percentile rank if normative data available
    zScore?: number;                  // Z-score if normative data available
    confidence: number;               // Confidence in this metric (0-100)
    dataQuality: 'excellent' | 'good' | 'fair' | 'poor';
}

function normalizeMetricEnhanced(
    value: number,
    config: MetricNormConfig,
    normativeData?: NormativeDatabase,
    subjectAge?: number,
    subjectSex?: 'M' | 'F',
    sampleCount?: number
): NormalizationResult {
    if (value === null || value === undefined || isNaN(value)) {
        return { score: -1, confidence: 0, dataQuality: 'poor' };
    }

    // 1. Adjust thresholds for age/sex if available
    let goodThreshold = config.goodThreshold;
    let poorThreshold = config.poorThreshold;
    
    if (subjectAge && config.ageAdjustment) {
        const adj = config.ageAdjustment(subjectAge);
        goodThreshold = adj.good;
        poorThreshold = adj.poor;
    }
    
    if (subjectSex && config.sexAdjustment) {
        const adj = config.sexAdjustment(subjectSex);
        goodThreshold = adj.good;
        poorThreshold = adj.poor;
    }

    // 2. Calculate threshold-based score (our original approach)
    let score: number;
    if (config.direction === 'higher_better') {
        if (value >= goodThreshold) score = 100;
        else if (value <= poorThreshold) score = 0;
        else score = ((value - poorThreshold) / (goodThreshold - poorThreshold)) * 100;
    } else if (config.direction === 'lower_better') {
        if (value <= goodThreshold) score = 100;
        else if (value >= poorThreshold) score = 0;
        else score = ((poorThreshold - value) / (poorThreshold - goodThreshold)) * 100;
    } else {
        const optMin = config.optimalMin!;
        const optMax = config.optimalMax!;
        const optRange = optMax - optMin;
        if (value >= optMin && value <= optMax) score = 100;
        else if (value < optMin) score = Math.max(0, 100 - ((optMin - value) / optRange) * 100);
        else score = Math.max(0, 100 - ((value - optMax) / optRange) * 100);
    }
    score = Math.max(0, Math.min(100, score));

    // 3. Calculate percentile if normative data available
    let percentile: number | undefined;
    let zScore: number | undefined;
    
    if (normativeData) {
        const normMetric = normativeData.metrics.get(config.name);
        if (normMetric) {
            let mean = normMetric.mean;
            let sd = normMetric.sd;
            
            // Use age/sex-specific norms if available
            if (subjectAge && normMetric.byAge) {
                const ageGroup = getAgeGroup(subjectAge);
                const ageNorm = normMetric.byAge.get(ageGroup);
                if (ageNorm) { mean = ageNorm.mean; sd = ageNorm.sd; }
            }
            if (subjectSex && normMetric.bySex) {
                const sexNorm = normMetric.bySex[subjectSex];
                if (sexNorm) { mean = sexNorm.mean; sd = sexNorm.sd; }
            }
            
            zScore = (value - mean) / sd;
            
            // Convert z-score to percentile (approximate)
            percentile = normalCDF(zScore) * 100;
            
            // For "lower_better" metrics, invert percentile
            if (config.direction === 'lower_better') {
                percentile = 100 - percentile;
            }
        }
    }

    // 4. Assess data quality
    let dataQuality: 'excellent' | 'good' | 'fair' | 'poor' = 'good';
    const minPoints = config.minDataPoints || 10;
    
    if (sampleCount !== undefined) {
        if (sampleCount >= minPoints * 2) dataQuality = 'excellent';
        else if (sampleCount >= minPoints) dataQuality = 'good';
        else if (sampleCount >= minPoints / 2) dataQuality = 'fair';
        else dataQuality = 'poor';
    }

    // 5. Calculate confidence based on reliability and data quality
    const reliabilityFactor = config.reliability || 0.8;
    const dataQualityFactor = { excellent: 1.0, good: 0.85, fair: 0.6, poor: 0.3 }[dataQuality];
    const confidence = reliabilityFactor * dataQualityFactor * 100;

    return { score, percentile, zScore, confidence, dataQuality };
}

// Helper: Normal CDF approximation
function normalCDF(z: number): number {
    const a1 =  0.254829592;
    const a2 = -0.284496736;
    const a3 =  1.421413741;
    const a4 = -1.453152027;
    const a5 =  1.061405429;
    const p  =  0.3275911;
    
    const sign = z < 0 ? -1 : 1;
    z = Math.abs(z) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * z);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
    return 0.5 * (1.0 + sign * y);
}

function getAgeGroup(age: number): string {
    if (age < 18) return '<18';
    if (age < 26) return '18-25';
    if (age < 36) return '26-35';
    if (age < 46) return '36-45';
    if (age < 56) return '46-55';
    return '56+';
}
```

---

##### Enhanced Domain Scoring with Reliability Weighting

```typescript
// IMPROVEMENT: Weight metrics by their reliability (CGAM-inspired)

interface EnhancedDomainScore {
    domain: PerformanceDomain;
    score: number;                    // 0-100
    confidence: number;               // 0-100
    percentileScore?: number;         // If normative data available
    contributors: MetricContribution[];
    flags: string[];
    
    // NEW: Enhanced outputs
    effectiveWeight: number;          // Actual weight after reliability adjustment
    measurementError: number;         // Estimated SEM
    minDetectableChange: number;      // MDC95 for this domain
}

interface MetricContribution {
    name: string;
    rawValue: number;
    normalizedScore: number;
    weight: number;
    reliabilityAdjustedWeight: number;
    contribution: number;             // % of domain score from this metric
    flag?: string;
}

function calculateEnhancedDomainScore(
    metrics: Map<string, number>,
    domain: PerformanceDomain,
    movementType: MovementType,
    normativeData?: NormativeDatabase,
    subjectAge?: number,
    subjectSex?: 'M' | 'F'
): EnhancedDomainScore {
    const domainConfigs = METRIC_CONFIGS.filter(c => c.domain === domain);
    const isBilateral = movementType === 'bilateral';
    const isUnilateral = movementType === 'unilateral';
    
    const contributors: MetricContribution[] = [];
    const flags: string[] = [];
    
    let weightedSum = 0;
    let totalWeight = 0;
    let totalReliabilityWeight = 0;
    let sumSquaredSEM = 0;  // For combined measurement error
    
    for (const config of domainConfigs) {
        if (isBilateral && !config.bilateral) continue;
        if (isUnilateral && !config.unilateral) continue;
        
        const value = metrics.get(config.name);
        if (value === undefined || value === null) continue;
        
        const normResult = normalizeMetricEnhanced(
            value, config, normativeData, subjectAge, subjectSex
        );
        
        if (normResult.score < 0) continue;
        
        // IMPROVEMENT: Reliability-adjusted weighting (CGAM-inspired)
        const reliability = config.reliability || 0.8;
        const reliabilityAdjustedWeight = config.weight * reliability;
        
        weightedSum += normResult.score * reliabilityAdjustedWeight;
        totalWeight += config.weight;
        totalReliabilityWeight += reliabilityAdjustedWeight;
        
        // Track measurement error
        const metricSEM = (1 - reliability) * normResult.score * 0.1;  // Simplified SEM estimate
        sumSquaredSEM += metricSEM ** 2;
        
        contributors.push({
            name: config.name,
            rawValue: value,
            normalizedScore: normResult.score,
            weight: config.weight,
            reliabilityAdjustedWeight,
            contribution: 0  // Calculate after totals known
        });
        
        if (normResult.score < 30) {
            flags.push(`${config.name}: poor (${value.toFixed(1)})`);
        }
    }
    
    const score = totalReliabilityWeight > 0 ? weightedSum / totalReliabilityWeight : 0;
    
    // Calculate contribution percentages
    for (const c of contributors) {
        c.contribution = totalReliabilityWeight > 0 
            ? (c.normalizedScore * c.reliabilityAdjustedWeight / weightedSum) * 100 
            : 0;
    }
    
    // Sort by contribution (highest first)
    contributors.sort((a, b) => b.contribution - a.contribution);
    
    // Calculate measurement error and MDC
    const combinedSEM = Math.sqrt(sumSquaredSEM);
    const MDC95 = combinedSEM * 1.96 * Math.sqrt(2);  // 95% confidence
    
    const possibleMetrics = domainConfigs.filter(c => 
        (isBilateral && c.bilateral) || (isUnilateral && c.unilateral)
    ).length;
    const confidence = possibleMetrics > 0 
        ? (contributors.length / possibleMetrics) * 100 * (totalReliabilityWeight / totalWeight)
        : 0;

    return {
        domain,
        score,
        confidence,
        contributors,
        flags,
        effectiveWeight: totalReliabilityWeight,
        measurementError: combinedSEM,
        minDetectableChange: MDC95
    };
}
```

---

##### Enhanced Overall Score with Uncertainty

```typescript
interface EnhancedPerformanceResult {
    // Core outputs
    overallScore: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    domainScores: EnhancedDomainScore[];
    
    // NEW: Uncertainty quantification
    confidenceInterval: { lower: number; upper: number };  // 95% CI
    measurementError: number;         // Combined SEM
    minDetectableChange: number;      // MDC95 for overall score
    scoreReliability: number;         // Estimated reliability coefficient
    
    // NEW: Percentile ranking (if normative data)
    percentileRank?: number;
    percentileInterpretation?: string;  // "Above average", "Top 10%", etc.
    
    // NEW: Trend analysis (if historical data)
    trend?: {
        direction: 'improving' | 'stable' | 'declining';
        changeFromLast: number;
        isSignificant: boolean;       // > MDC95
        sessionsAnalyzed: number;
    };
    
    // NEW: Top contributors (actionable insights)
    topStrengths: MetricContribution[];   // Top 3 positive contributors
    topWeaknesses: MetricContribution[];  // Top 3 negative contributors
    
    // Existing
    movementType: MovementType;
    activityProfile: 'power' | 'endurance' | 'rehabilitation' | 'general';
    strengthAreas: string[];
    improvementAreas: string[];
    clinicalFlags: string[];
    dataCompleteness: number;
    scoreConfidence: number;
}

function calculateEnhancedOverallPerformance(
    analysisResult: FullAnalysisResult,
    options?: {
        normativeData?: NormativeDatabase;
        subjectAge?: number;
        subjectSex?: 'M' | 'F';
        previousScores?: number[];      // For trend analysis
        activityOverride?: 'power' | 'endurance' | 'rehabilitation' | 'general';
    }
): EnhancedPerformanceResult {
    
    const opts = options || {};
    
    // Build metrics map (same as before)
    const metrics = buildMetricsMap(analysisResult);
    
    // Determine movement type and activity profile
    const movementType = analysisResult.movementClassification?.type || 'unknown';
    const activityProfile = opts.activityOverride || detectActivityProfile(metrics, movementType);
    
    // Calculate enhanced domain scores
    const domains: PerformanceDomain[] = ['symmetry', 'power', 'control', 'stability', 'efficiency'];
    const domainScores = domains.map(d => 
        calculateEnhancedDomainScore(metrics, d, movementType, opts.normativeData, opts.subjectAge, opts.subjectSex)
    );
    
    // Calculate weighted overall score with reliability adjustment
    const weights = DOMAIN_WEIGHTS[activityProfile];
    let overallScore = 0;
    let totalWeight = 0;
    let sumSquaredSEM = 0;
    
    for (const ds of domainScores) {
        if (ds.confidence > 0) {
            const w = weights[ds.domain] * (ds.confidence / 100);
            overallScore += ds.score * w;
            totalWeight += w;
            sumSquaredSEM += (ds.measurementError * w) ** 2;
        }
    }
    
    if (totalWeight > 0) {
        overallScore = overallScore / totalWeight;
    }
    
    // Calculate overall uncertainty
    const combinedSEM = Math.sqrt(sumSquaredSEM) / totalWeight;
    const MDC95 = combinedSEM * 1.96 * Math.sqrt(2);
    const confidenceInterval = {
        lower: Math.max(0, overallScore - 1.96 * combinedSEM),
        upper: Math.min(100, overallScore + 1.96 * combinedSEM)
    };
    
    // Estimate overall reliability (weighted average of domain reliabilities)
    const scoreReliability = domainScores.reduce((sum, ds) => 
        sum + (ds.effectiveWeight / ds.contributors.length) * weights[ds.domain], 0
    );
    
    // Grade assignment
    let grade: 'A' | 'B' | 'C' | 'D' | 'F';
    if (overallScore >= 90) grade = 'A';
    else if (overallScore >= 80) grade = 'B';
    else if (overallScore >= 70) grade = 'C';
    else if (overallScore >= 60) grade = 'D';
    else grade = 'F';
    
    // Trend analysis (if previous scores available)
    let trend: EnhancedPerformanceResult['trend'];
    if (opts.previousScores && opts.previousScores.length > 0) {
        const lastScore = opts.previousScores[opts.previousScores.length - 1];
        const change = overallScore - lastScore;
        const isSignificant = Math.abs(change) > MDC95;
        
        trend = {
            direction: change > MDC95 ? 'improving' : change < -MDC95 ? 'declining' : 'stable',
            changeFromLast: change,
            isSignificant,
            sessionsAnalyzed: opts.previousScores.length + 1
        };
    }
    
    // Percentile interpretation
    let percentileRank: number | undefined;
    let percentileInterpretation: string | undefined;
    if (opts.normativeData) {
        // Simplified: use overall score as proxy for percentile
        // In practice, would need population-specific overall scores
        percentileRank = normalCDF((overallScore - 70) / 15) * 100;  // Assuming mean=70, SD=15
        
        if (percentileRank >= 95) percentileInterpretation = 'Elite (Top 5%)';
        else if (percentileRank >= 90) percentileInterpretation = 'Excellent (Top 10%)';
        else if (percentileRank >= 75) percentileInterpretation = 'Above Average (Top 25%)';
        else if (percentileRank >= 50) percentileInterpretation = 'Average';
        else if (percentileRank >= 25) percentileInterpretation = 'Below Average';
        else percentileInterpretation = 'Needs Improvement';
    }
    
    // Extract top contributors across all domains
    const allContributors = domainScores.flatMap(ds => ds.contributors);
    const topStrengths = allContributors
        .filter(c => c.normalizedScore >= 80)
        .sort((a, b) => b.normalizedScore - a.normalizedScore)
        .slice(0, 3);
    const topWeaknesses = allContributors
        .filter(c => c.normalizedScore < 50)
        .sort((a, b) => a.normalizedScore - b.normalizedScore)
        .slice(0, 3);
    
    // Collect flags and identify areas
    const clinicalFlags: string[] = [];
    const strengthAreas: string[] = [];
    const improvementAreas: string[] = [];
    
    for (const ds of domainScores) {
        clinicalFlags.push(...ds.flags);
        if (ds.score >= 75 && ds.confidence > 50) {
            strengthAreas.push(`${ds.domain}: ${ds.score.toFixed(0)}/100`);
        }
        if (ds.score < 60 && ds.confidence > 50) {
            improvementAreas.push(`${ds.domain}: ${ds.score.toFixed(0)}/100`);
        }
    }
    
    // Add critical flags
    const asymmetry = metrics.get('net_global_asymmetry') || 0;
    if (asymmetry > 25) clinicalFlags.push('⚠️ HIGH ASYMMETRY - injury risk');
    const sparc = metrics.get('SPARC') || 0;
    if (sparc < -3) clinicalFlags.push('⚠️ POOR SMOOTHNESS - coordination concern');
    
    const dataCompleteness = (metrics.size / METRIC_CONFIGS.length) * 100;
    
    return {
        overallScore: Math.round(overallScore * 10) / 10,
        grade,
        domainScores,
        confidenceInterval,
        measurementError: combinedSEM,
        minDetectableChange: MDC95,
        scoreReliability,
        percentileRank,
        percentileInterpretation,
        trend,
        topStrengths,
        topWeaknesses,
        movementType,
        activityProfile,
        strengthAreas,
        improvementAreas,
        clinicalFlags,
        dataCompleteness: Math.round(dataCompleteness),
        scoreConfidence: Math.round(totalWeight * 100)
    };
}
```

---

##### Example Enhanced Output

```json
{
  "overallScore": 76.4,
  "grade": "C",
  "confidenceInterval": { "lower": 71.2, "upper": 81.6 },
  "measurementError": 2.7,
  "minDetectableChange": 7.5,
  "scoreReliability": 0.82,
  
  "percentileRank": 68,
  "percentileInterpretation": "Above Average (Top 25%)",
  
  "trend": {
    "direction": "improving",
    "changeFromLast": 8.2,
    "isSignificant": true,
    "sessionsAnalyzed": 5
  },
  
  "domainScores": [
    {
      "domain": "symmetry",
      "score": 82,
      "confidence": 95,
      "measurementError": 1.8,
      "minDetectableChange": 5.0,
      "contributors": [
        { "name": "real_asymmetry_avg", "normalizedScore": 88, "contribution": 42 },
        { "name": "cross_correlation", "normalizedScore": 79, "contribution": 31 }
      ]
    }
  ],
  
  "topStrengths": [
    { "name": "RSI", "normalizedScore": 92, "rawValue": 2.3 },
    { "name": "real_asymmetry_avg", "normalizedScore": 88, "rawValue": 4.2 }
  ],
  
  "topWeaknesses": [
    { "name": "SPARC", "normalizedScore": 45, "rawValue": -2.8 },
    { "name": "rom_cov", "normalizedScore": 52, "rawValue": 12.3 }
  ],
  
  "clinicalFlags": ["SPARC: poor (-2.8)"]
}
```

```typescript
// ===== Domain Definitions =====

type PerformanceDomain = 
    | 'symmetry'      // Bilateral balance
    | 'power'         // Force production & explosiveness
    | 'control'       // Smoothness & coordination
    | 'stability'     // Consistency & variability
    | 'efficiency';   // Movement economy

interface DomainScore {
    domain: PerformanceDomain;
    score: number;           // 0-100
    confidence: number;      // 0-100 (based on data availability)
    contributors: string[];  // Which metrics contributed
    flags: string[];         // Clinical concerns
}

interface OverallPerformanceResult {
    overallScore: number;              // 0-100 composite
    grade: 'A' | 'B' | 'C' | 'D' | 'F'; // Letter grade
    domainScores: DomainScore[];
    movementType: MovementType;
    activityProfile: 'power' | 'endurance' | 'rehabilitation' | 'general';
    
    // Breakdown
    strengthAreas: string[];           // Top performing domains
    improvementAreas: string[];        // Domains needing work
    clinicalFlags: string[];           // Red flags requiring attention
    
    // Confidence
    dataCompleteness: number;          // % of metrics available
    scoreConfidence: number;           // Overall confidence in score
}

// ===== Metric Normalization =====

interface MetricNormConfig {
    name: string;
    domain: PerformanceDomain;
    direction: 'higher_better' | 'lower_better' | 'optimal_range';
    optimalMin?: number;
    optimalMax?: number;
    goodThreshold: number;
    poorThreshold: number;
    weight: number;           // Relative importance within domain
    bilateral: boolean;       // Applies to bilateral movements
    unilateral: boolean;      // Applies to unilateral movements
}

const METRIC_CONFIGS: MetricNormConfig[] = [
    // === SYMMETRY DOMAIN ===
    { name: 'rom_asymmetry', domain: 'symmetry', direction: 'lower_better',
      goodThreshold: 5, poorThreshold: 25, weight: 1.0, bilateral: true, unilateral: true },
    { name: 'velocity_asymmetry', domain: 'symmetry', direction: 'lower_better',
      goodThreshold: 8, poorThreshold: 25, weight: 1.0, bilateral: true, unilateral: true },
    { name: 'net_global_asymmetry', domain: 'symmetry', direction: 'lower_better',
      goodThreshold: 10, poorThreshold: 25, weight: 1.2, bilateral: true, unilateral: true },
    { name: 'temporal_lag', domain: 'symmetry', direction: 'lower_better',
      goodThreshold: 15, poorThreshold: 50, weight: 0.8, bilateral: true, unilateral: false },
    { name: 'cross_correlation', domain: 'symmetry', direction: 'higher_better',
      goodThreshold: 0.9, poorThreshold: 0.7, weight: 1.0, bilateral: true, unilateral: false },
    { name: 'real_asymmetry_avg', domain: 'symmetry', direction: 'lower_better',
      goodThreshold: 5, poorThreshold: 20, weight: 1.5, bilateral: true, unilateral: true },
    
    // === POWER DOMAIN ===
    { name: 'peak_angular_velocity', domain: 'power', direction: 'higher_better',
      goodThreshold: 300, poorThreshold: 100, weight: 1.0, bilateral: true, unilateral: true },
    { name: 'explosiveness_concentric', domain: 'power', direction: 'higher_better',
      goodThreshold: 500, poorThreshold: 150, weight: 1.2, bilateral: true, unilateral: true },
    { name: 'RSI', domain: 'power', direction: 'higher_better',
      goodThreshold: 2.0, poorThreshold: 1.0, weight: 1.5, bilateral: true, unilateral: false },
    { name: 'jump_height_cm', domain: 'power', direction: 'higher_better',
      goodThreshold: 35, poorThreshold: 15, weight: 1.3, bilateral: true, unilateral: false },
    { name: 'RMD', domain: 'power', direction: 'higher_better',
      goodThreshold: 50, poorThreshold: 20, weight: 1.0, bilateral: true, unilateral: true },
    { name: 'peak_resultant_accel', domain: 'power', direction: 'higher_better',
      goodThreshold: 500, poorThreshold: 150, weight: 0.8, bilateral: true, unilateral: true },
    
    // === CONTROL DOMAIN ===
    { name: 'SPARC', domain: 'control', direction: 'higher_better',  // less negative = better
      goodThreshold: -1.5, poorThreshold: -3.0, weight: 1.2, bilateral: true, unilateral: true },
    { name: 'LDLJ', domain: 'control', direction: 'higher_better',   // less negative = better
      goodThreshold: -20, poorThreshold: -30, weight: 1.0, bilateral: true, unilateral: true },
    { name: 'n_velocity_peaks', domain: 'control', direction: 'lower_better',
      goodThreshold: 3, poorThreshold: 8, weight: 0.8, bilateral: true, unilateral: true },
    { name: 'rms_jerk', domain: 'control', direction: 'lower_better',
      goodThreshold: 500, poorThreshold: 2000, weight: 1.0, bilateral: true, unilateral: true },
    { name: 'shock_absorption_score', domain: 'control', direction: 'higher_better',
      goodThreshold: 70, poorThreshold: 40, weight: 1.0, bilateral: true, unilateral: true },
    
    // === STABILITY DOMAIN ===
    { name: 'rom_cov', domain: 'stability', direction: 'lower_better',
      goodThreshold: 5, poorThreshold: 15, weight: 1.0, bilateral: true, unilateral: true },
    { name: 'baseline_stability', domain: 'stability', direction: 'lower_better',
      goodThreshold: 2, poorThreshold: 5, weight: 0.8, bilateral: true, unilateral: true },
    { name: 'movement_confidence', domain: 'stability', direction: 'higher_better',
      goodThreshold: 80, poorThreshold: 50, weight: 0.7, bilateral: true, unilateral: true },
    
    // === EFFICIENCY DOMAIN ===
    { name: 'duty_factor', domain: 'efficiency', direction: 'optimal_range',
      optimalMin: 0.30, optimalMax: 0.40, goodThreshold: 0.35, poorThreshold: 0.50, 
      weight: 1.0, bilateral: false, unilateral: true },
    { name: 'stance_phase_pct', domain: 'efficiency', direction: 'optimal_range',
      optimalMin: 58, optimalMax: 62, goodThreshold: 60, poorThreshold: 65,
      weight: 1.0, bilateral: false, unilateral: true },
    { name: 'ground_contact_time', domain: 'efficiency', direction: 'lower_better',
      goodThreshold: 200, poorThreshold: 350, weight: 1.0, bilateral: true, unilateral: false },
    { name: 'leg_stiffness', domain: 'efficiency', direction: 'optimal_range',
      optimalMin: 8000, optimalMax: 15000, goodThreshold: 10000, poorThreshold: 5000,
      weight: 1.0, bilateral: true, unilateral: true },
];

// ===== Normalization Functions =====

function normalizeMetric(value: number, config: MetricNormConfig): number {
    if (value === null || value === undefined || isNaN(value)) return -1; // Missing
    
    let score: number;
    
    if (config.direction === 'higher_better') {
        // Linear scale: poorThreshold=0, goodThreshold=100
        if (value >= config.goodThreshold) {
            score = 100;
        } else if (value <= config.poorThreshold) {
            score = 0;
        } else {
            score = ((value - config.poorThreshold) / (config.goodThreshold - config.poorThreshold)) * 100;
        }
    } else if (config.direction === 'lower_better') {
        // Inverted: poorThreshold=0, goodThreshold=100
        if (value <= config.goodThreshold) {
            score = 100;
        } else if (value >= config.poorThreshold) {
            score = 0;
        } else {
            score = ((config.poorThreshold - value) / (config.poorThreshold - config.goodThreshold)) * 100;
        }
    } else {
        // optimal_range: peak at middle of range, drops off outside
        const optMin = config.optimalMin!;
        const optMax = config.optimalMax!;
        const optMid = (optMin + optMax) / 2;
        const optRange = optMax - optMin;
        
        if (value >= optMin && value <= optMax) {
            score = 100;
        } else if (value < optMin) {
            const dist = optMin - value;
            score = Math.max(0, 100 - (dist / optRange) * 100);
        } else {
            const dist = value - optMax;
            score = Math.max(0, 100 - (dist / optRange) * 100);
        }
    }
    
    return Math.max(0, Math.min(100, score));
}

// ===== Domain Scoring =====

function calculateDomainScore(
    metrics: Map<string, number>,
    domain: PerformanceDomain,
    movementType: MovementType
): DomainScore {
    const domainConfigs = METRIC_CONFIGS.filter(c => c.domain === domain);
    const isBilateral = movementType === 'bilateral';
    const isUnilateral = movementType === 'unilateral';
    
    let weightedSum = 0;
    let totalWeight = 0;
    let availableCount = 0;
    const contributors: string[] = [];
    const flags: string[] = [];
    
    for (const config of domainConfigs) {
        // Skip if not applicable to movement type
        if (isBilateral && !config.bilateral) continue;
        if (isUnilateral && !config.unilateral) continue;
        
        const value = metrics.get(config.name);
        if (value === undefined || value === null) continue;
        
        const score = normalizeMetric(value, config);
        if (score < 0) continue; // Missing data
        
        weightedSum += score * config.weight;
        totalWeight += config.weight;
        availableCount++;
        contributors.push(config.name);
        
        // Flag poor scores
        if (score < 30) {
            flags.push(`${config.name}: poor (${value.toFixed(1)})`);
        }
    }
    
    const score = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const possibleMetrics = domainConfigs.filter(c => 
        (isBilateral && c.bilateral) || (isUnilateral && c.unilateral)
    ).length;
    const confidence = possibleMetrics > 0 ? (availableCount / possibleMetrics) * 100 : 0;
    
    return { domain, score, confidence, contributors, flags };
}

// ===== Activity Profile Detection =====

function detectActivityProfile(
    metrics: Map<string, number>,
    movementType: MovementType
): 'power' | 'endurance' | 'rehabilitation' | 'general' {
    const rsi = metrics.get('RSI') || 0;
    const jumpHeight = metrics.get('jump_height_cm') || 0;
    const asymmetry = metrics.get('net_global_asymmetry') || 0;
    const sparc = metrics.get('SPARC') || -2;
    
    // High asymmetry or poor smoothness suggests rehabilitation
    if (asymmetry > 20 || sparc < -2.5) return 'rehabilitation';
    
    // High RSI and jump height suggests power athlete
    if (rsi > 2.0 && jumpHeight > 35) return 'power';
    
    // Unilateral with good efficiency suggests endurance
    if (movementType === 'unilateral') return 'endurance';
    
    return 'general';
}

// ===== Domain Weights by Activity =====

const DOMAIN_WEIGHTS: Record<string, Record<PerformanceDomain, number>> = {
    power: {
        symmetry: 0.15,
        power: 0.35,
        control: 0.20,
        stability: 0.15,
        efficiency: 0.15
    },
    endurance: {
        symmetry: 0.25,
        power: 0.10,
        control: 0.20,
        stability: 0.20,
        efficiency: 0.25
    },
    rehabilitation: {
        symmetry: 0.35,
        power: 0.10,
        control: 0.25,
        stability: 0.20,
        efficiency: 0.10
    },
    general: {
        symmetry: 0.20,
        power: 0.20,
        control: 0.20,
        stability: 0.20,
        efficiency: 0.20
    }
};

// ===== Main Calculation =====

function calculateOverallPerformanceIndex(
    analysisResult: FullAnalysisResult,
    activityOverride?: 'power' | 'endurance' | 'rehabilitation' | 'general'
): OverallPerformanceResult {
    
    // 1. Build metrics map from analysis result
    const metrics = new Map<string, number>();
    
    // From bilateral analysis
    if (analysisResult.bilateralAnalysis) {
        const ba = analysisResult.bilateralAnalysis;
        metrics.set('rom_asymmetry', ba.asymmetryIndices.overallMaxROM);
        metrics.set('velocity_asymmetry', ba.asymmetryIndices.peakAngularVelocity);
        metrics.set('net_global_asymmetry', ba.netGlobalAsymmetry);
        metrics.set('temporal_lag', ba.temporalAsymmetry.temporalLag);
        metrics.set('cross_correlation', ba.temporalAsymmetry.crossCorrelation);
    }
    
    // From per-leg metrics (average of both legs)
    if (analysisResult.leftLeg && analysisResult.rightLeg) {
        const L = analysisResult.leftLeg;
        const R = analysisResult.rightLeg;
        metrics.set('peak_angular_velocity', (L.peakAngularVelocity + R.peakAngularVelocity) / 2);
        metrics.set('explosiveness_concentric', (L.explosivenessConcentric + R.explosivenessConcentric) / 2);
        metrics.set('rms_jerk', (L.rmsJerk + R.rmsJerk) / 2);
        metrics.set('rom_cov', (L.romCoV + R.romCoV) / 2);
        metrics.set('peak_resultant_accel', (L.peakResultantAcceleration + R.peakResultantAcceleration) / 2);
    }
    
    // From jump metrics
    if (analysisResult.jumpMetrics) {
        const jm = analysisResult.jumpMetrics;
        metrics.set('RSI', jm.RSI);
        metrics.set('jump_height_cm', jm.jumpHeightCm);
        metrics.set('RMD', jm.RMD);
        metrics.set('ground_contact_time', jm.groundContactTimeMs);
        metrics.set('leg_stiffness', jm.legStiffness);
    }
    
    // From smoothness metrics
    if (analysisResult.smoothnessMetrics) {
        const sm = analysisResult.smoothnessMetrics;
        metrics.set('SPARC', sm.SPARC);
        metrics.set('LDLJ', sm.LDLJ);
        metrics.set('n_velocity_peaks', sm.nVelocityPeaks);
    }
    
    // From gait metrics
    if (analysisResult.gaitCycleMetrics) {
        const gm = analysisResult.gaitCycleMetrics;
        metrics.set('duty_factor', gm.dutyFactor);
        metrics.set('stance_phase_pct', gm.stancePhasePct);
    }
    
    // From temporal coordination
    if (analysisResult.temporalCoordination) {
        metrics.set('shock_absorption_score', analysisResult.temporalCoordination.shockAbsorption?.score || 0);
    }
    
    // From advanced asymmetry
    if (analysisResult.advancedAsymmetry) {
        const aa = analysisResult.advancedAsymmetry;
        metrics.set('real_asymmetry_avg', aa.avgRealAsymmetry);
        metrics.set('baseline_stability', aa.baselineStability);
    }
    
    // From movement classification
    if (analysisResult.movementClassification) {
        metrics.set('movement_confidence', analysisResult.movementClassification.confidence);
    }
    
    // 2. Determine movement type and activity profile
    const movementType = analysisResult.movementClassification?.type || 'unknown';
    const activityProfile = activityOverride || detectActivityProfile(metrics, movementType);
    
    // 3. Calculate domain scores
    const domains: PerformanceDomain[] = ['symmetry', 'power', 'control', 'stability', 'efficiency'];
    const domainScores = domains.map(d => calculateDomainScore(metrics, d, movementType));
    
    // 4. Calculate weighted overall score
    const weights = DOMAIN_WEIGHTS[activityProfile];
    let overallScore = 0;
    let totalConfidence = 0;
    
    for (const ds of domainScores) {
        const weight = weights[ds.domain];
        overallScore += ds.score * weight * (ds.confidence / 100);
        totalConfidence += ds.confidence * weight;
    }
    
    // Normalize by actual available weights
    const availableWeight = domainScores.reduce((sum, ds) => {
        return sum + (ds.confidence > 0 ? weights[ds.domain] : 0);
    }, 0);
    
    if (availableWeight > 0) {
        overallScore = overallScore / availableWeight;
    }
    
    // 5. Determine grade
    let grade: 'A' | 'B' | 'C' | 'D' | 'F';
    if (overallScore >= 90) grade = 'A';
    else if (overallScore >= 80) grade = 'B';
    else if (overallScore >= 70) grade = 'C';
    else if (overallScore >= 60) grade = 'D';
    else grade = 'F';
    
    // 6. Identify strengths and improvement areas
    const sortedDomains = [...domainScores]
        .filter(d => d.confidence > 30)
        .sort((a, b) => b.score - a.score);
    
    const strengthAreas = sortedDomains
        .filter(d => d.score >= 75)
        .map(d => `${d.domain}: ${d.score.toFixed(0)}/100`);
    
    const improvementAreas = sortedDomains
        .filter(d => d.score < 60)
        .map(d => `${d.domain}: ${d.score.toFixed(0)}/100`);
    
    // 7. Collect clinical flags
    const clinicalFlags: string[] = [];
    for (const ds of domainScores) {
        clinicalFlags.push(...ds.flags);
    }
    
    // Add critical flags
    const asymmetry = metrics.get('net_global_asymmetry') || 0;
    if (asymmetry > 25) clinicalFlags.push('⚠️ HIGH ASYMMETRY - injury risk');
    
    const sparc = metrics.get('SPARC') || 0;
    if (sparc < -3) clinicalFlags.push('⚠️ POOR SMOOTHNESS - coordination concern');
    
    // 8. Calculate data completeness
    const totalPossibleMetrics = METRIC_CONFIGS.filter(c => 
        (movementType === 'bilateral' && c.bilateral) ||
        (movementType === 'unilateral' && c.unilateral) ||
        movementType === 'mixed' || movementType === 'unknown'
    ).length;
    const dataCompleteness = (metrics.size / totalPossibleMetrics) * 100;
    
    // 9. Overall confidence
    const scoreConfidence = Math.min(100, (dataCompleteness + totalConfidence / domains.length) / 2);
    
    return {
        overallScore: Math.round(overallScore * 10) / 10,
        grade,
        domainScores,
        movementType,
        activityProfile,
        strengthAreas,
        improvementAreas,
        clinicalFlags,
        dataCompleteness: Math.round(dataCompleteness),
        scoreConfidence: Math.round(scoreConfidence)
    };
}
```

---

#### Interpretation Guide

| Overall Score | Grade | Interpretation |
|---------------|-------|----------------|
| 90-100 | A | Excellent - Elite/optimal performance |
| 80-89 | B | Good - Above average, minor improvements possible |
| 70-79 | C | Average - Room for improvement |
| 60-69 | D | Below Average - Significant work needed |
| 0-59 | F | Poor - Rehabilitation/intervention recommended |

#### Metric Reliability Values (Literature-Based)

| Metric | ICC/Reliability | Source |
|--------|-----------------|--------|
| ROM measures | 0.90-0.95 | Goniometry literature |
| Peak angular velocity | 0.85-0.90 | IMU validation studies |
| RSI | 0.85-0.92 | Jump testing literature |
| Jump height | 0.90-0.95 | Force plate validation |
| SPARC | 0.80-0.88 | Smoothness metric studies |
| LDLJ | 0.78-0.85 | Jerk-based measures |
| Cross-correlation | 0.85-0.90 | Signal processing |
| Asymmetry indices | 0.75-0.85 | Bilateral comparison |
| Ground contact time | 0.88-0.93 | Contact mat validation |
| Gait cycle metrics | 0.82-0.90 | Wearable validation |

*Default reliability = 0.80 when specific data unavailable*

#### Minimal Detectable Change (MDC95) Guidelines

| Domain | Typical MDC | Interpretation |
|--------|-------------|----------------|
| Overall Score | 5-8 points | Change < MDC = within measurement error |
| Domain Score | 8-12 points | Larger due to fewer metrics |
| Individual Metric | Varies | See metric-specific literature |

**Clinical Decision Rule:**
- Change > MDC95 → Likely real change (95% confidence)
- Change ≤ MDC95 → Could be measurement error

#### Domain Breakdown

| Domain | What It Measures | Key Metrics |
|--------|------------------|-------------|
| **Symmetry** | Bilateral balance | Asymmetry indices, cross-correlation, real asymmetry |
| **Power** | Force production | RSI, jump height, explosiveness, angular velocity |
| **Control** | Movement quality | SPARC, LDLJ, jerk, velocity peaks |
| **Stability** | Consistency | ROM CoV, baseline stability, confidence |
| **Efficiency** | Movement economy | Duty factor, stance phase, stiffness |

#### Activity Profile Weights

```
POWER (Jumpers/Sprinters):    Power 35%, Control 20%, Symmetry 15%, Stability 15%, Efficiency 15%
ENDURANCE (Runners/Cyclists): Efficiency 25%, Symmetry 25%, Stability 20%, Control 20%, Power 10%
REHABILITATION:               Symmetry 35%, Control 25%, Stability 20%, Power 10%, Efficiency 10%
GENERAL:                      Equal weights (20% each)
```

---

## Complete Type Definitions

```typescript
// ===== Core Metrics =====

interface MetricsSet {
    overallMaxROM: number;
    averageROM: number;
    peakFlexion: number;
    peakExtension: number;
    peakAngularVelocity: number;
    explosivenessLoading: number;
    explosivenessConcentric: number;
    rmsJerk: number;
    romCoV: number;
    peakResultantAcceleration: number;
}

interface BilateralAnalysis {
    asymmetryIndices: {
        overallMaxROM: number;
        averageROM: number;
        peakAngularVelocity: number;
        rmsJerk: number;
        explosivenessLoading: number;
        explosivenessConcentric: number;
    };
    netGlobalAsymmetry: number;
    temporalAsymmetry: {
        phaseShift: number;
        crossCorrelation: number;
        temporalLag: number;
    };
}

interface UnilateralAnalysis {
    flexorExtensorRatio: number;
    eccentricConcentricRatio: number;
}

interface JumpMetrics {
    groundContactTimeMs: number;
    flightTimeMs: number;
    jumpHeightCm: number;
    RSI: number;
    RMD: number;
    peakNormalizedForce: number;
    impulseEstimate: number;
    legStiffness: number;
    verticalStiffness: number;
}

interface SmoothnessMetrics {
    SPARC: number;
    LDLJ: number;
    nVelocityPeaks: number;
    rmsJerk: number;
}

interface GaitCycleMetrics {
    stancePhasePct: number;
    swingPhasePct: number;
    dutyFactor: number;
    strideTimeMs: number;
}

interface TemporalCoordination {
    maxFlexionTimingDiff: number;
    zeroVelocityPhaseMs: number;
    shockAbsorption: ShockAbsorptionResult;
}

// ===== Movement Classification (NEW) =====

type MovementType = 'bilateral' | 'unilateral' | 'single_leg' | 'mixed' | 'unknown';

interface MovementClassification {
    type: MovementType;
    confidence: number;
    correlationAtZero: number;
    optimalLag: number;
    optimalCorrelation: number;
    estimatedCycleSamples: number;
    phaseOffsetDegrees: number;
}

interface TransitionEvent {
    index: number;
    timeMs: number;
    fromPhase: number;
    toPhase: number;
    fromType: MovementType;
    toType: MovementType;
}

interface RollingPhaseResult {
    phaseOffsetSeries: number[];
    correlationSeries: number[];
    windowCenters: number[];
    transitions: TransitionEvent[];
    dominantPhaseOffset: number;
}

// ===== Advanced Asymmetry (NEW) =====

interface PhaseCorrectedSignals {
    left: number[];
    right: number[];
    appliedShiftSamples: number;
    appliedShiftMs: number;
    movementType: MovementType;
    requiresCorrection: boolean;
}

interface AsymmetryEvent {
    startIndex: number;
    endIndex: number;
    startTimeMs: number;
    endTimeMs: number;
    durationMs: number;
    peakAsymmetry: number;
    avgAsymmetry: number;
    direction: 'left_dominant' | 'right_dominant';
    area: number;
}

interface AdvancedAsymmetryResult {
    phaseCorrection: PhaseCorrectedSignals;
    baselineOffset: number[];
    realAsymmetry: number[];
    correctedLeft: number[];
    correctedRight: number[];
    asymmetryEvents: AsymmetryEvent[];
    avgBaselineOffset: number;
    avgRealAsymmetry: number;
    maxRealAsymmetry: number;
    totalAsymmetryDurationMs: number;
    asymmetryPercentage: number;
    baselineStability: number;
    signalToNoiseRatio: number;
}

interface RollingAsymmetryWindow {
    windowCenter: number;
    windowCenterMs: number;
    movementType: MovementType;
    phaseOffsetApplied: number;
    avgAsymmetry: number;
    maxAsymmetry: number;
    baselineOffset: number;
}

interface RollingAsymmetryResult {
    windows: RollingAsymmetryWindow[];
    asymmetryTimeSeries: number[];
    movementTypeTimeSeries: MovementType[];
    overallSummary: {
        avgAsymmetry: number;
        maxAsymmetry: number;
        timeInBilateral: number;
        timeInUnilateral: number;
        transitionCount: number;
    };
}

interface PhaseAlignmentResult {
    optimalOffsetSamples: number;
    optimalOffsetMs: number;
    optimalOffsetDegrees: number;
    alignedCorrelation: number;
    unalignedCorrelation: number;
    correlationImprovement: number;
    alignedRight: number[];
}

// ===== Overall Performance Index (ENHANCED) =====

type PerformanceDomain = 'symmetry' | 'power' | 'control' | 'stability' | 'efficiency';

interface MetricContribution {
    name: string;
    rawValue: number;
    normalizedScore: number;
    weight: number;
    reliabilityAdjustedWeight: number;
    contribution: number;
    flag?: string;
}

interface EnhancedDomainScore {
    domain: PerformanceDomain;
    score: number;
    confidence: number;
    percentileScore?: number;
    contributors: MetricContribution[];
    flags: string[];
    effectiveWeight: number;
    measurementError: number;
    minDetectableChange: number;
}

interface TrendAnalysis {
    direction: 'improving' | 'stable' | 'declining';
    changeFromLast: number;
    isSignificant: boolean;
    sessionsAnalyzed: number;
}

interface OverallPerformanceResult {
    // Core
    overallScore: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    domainScores: EnhancedDomainScore[];
    
    // Uncertainty quantification (NEW)
    confidenceInterval: { lower: number; upper: number };
    measurementError: number;
    minDetectableChange: number;
    scoreReliability: number;
    
    // Population comparison (NEW)
    percentileRank?: number;
    percentileInterpretation?: string;
    
    // Temporal tracking (NEW)
    trend?: TrendAnalysis;
    
    // Actionable insights (NEW)
    topStrengths: MetricContribution[];
    topWeaknesses: MetricContribution[];
    
    // Context
    movementType: MovementType;
    activityProfile: 'power' | 'endurance' | 'rehabilitation' | 'general';
    strengthAreas: string[];
    improvementAreas: string[];
    clinicalFlags: string[];
    dataCompleteness: number;
    scoreConfidence: number;
}

// Legacy support
type DomainScore = EnhancedDomainScore;

// ===== Full Analysis Result =====

interface FullAnalysisResult {
    // Per-leg metrics
    leftLeg: MetricsSet;
    rightLeg: MetricsSet;
    
    // Bilateral analysis
    bilateralAnalysis: BilateralAnalysis;
    unilateralAnalysis: {
        left: UnilateralAnalysis;
        right: UnilateralAnalysis;
        bilateralRatioDiff: number;
    };
    
    // Activity-specific
    jumpMetrics: JumpMetrics;
    smoothnessMetrics: SmoothnessMetrics;
    gaitCycleMetrics: GaitCycleMetrics;
    temporalCoordination: TemporalCoordination;
    
    // Movement classification (NEW)
    movementClassification: MovementClassification;
    rollingPhase: RollingPhaseResult;
    
    // Advanced asymmetry (NEW)
    advancedAsymmetry: AdvancedAsymmetryResult;
    rollingAsymmetry: RollingAsymmetryResult;
    phaseAlignment: PhaseAlignmentResult;
    
    // Overall performance (NEW)
    overallPerformance: OverallPerformanceResult;
}
```

---

## Clinical Thresholds

| Metric | Good | Monitor | High Risk |
|--------|------|---------|-----------|
| Asymmetry (all) | < 10% | 10-25% | > 25% |
| ROM CoV | < 5% | 5-15% | > 15% |
| RSI | > 2.0 | 1.0-2.0 | < 1.0 |
| Duty Factor (running) | 0.30-0.40 | 0.40-0.50 | > 0.50 |
| Stance Phase (walking) | 58-62% | 55-65% | < 55% or > 65% |
| Cross-Correlation | > 0.90 | 0.70-0.90 | < 0.70 |
| Temporal Lag | < 20ms | 20-50ms | > 50ms |
| SPARC (smoothness) | > -1.5 | -1.5 to -3.0 | < -3.0 |
| Movement Classification Confidence | > 80% | 50-80% | < 50% |
| Asymmetry Percentage (time) | < 5% | 5-15% | > 15% |
| Real Asymmetry (peak) | < 10° | 10-20° | > 20° |
| Baseline Stability | < 2 | 2-5 | > 5 |

### Movement Type Interpretation

| Classification | Description | Typical Activities |
|----------------|-------------|-------------------|
| `bilateral` | In-phase movement, corr@0 > 0.7 | Squat, jump, bilateral press |
| `unilateral` | Anti-phase gait, ~180° offset | Walking, running, cycling |
| `single_leg` | One limb active | Single-leg hop, balance |
| `mixed` | Transitions or complex | Walk→run, multi-directional |
| `unknown` | Insufficient data | Very short recordings |

---

## Summary Table

| # | Metric | Category | Uses Robust Peak | Unit |
|---|--------|----------|------------------|------|
| 1 | overall_max_rom | Computed | Yes | ° |
| 2 | average_rom | Computed | No | ° |
| 3 | peak_flexion_rom | Computed | Yes | ° |
| 4 | peak_extension_rom | Computed | Yes | ° |
| 5 | peak_angular_velocity | Computed | Yes | °/s |
| 6 | explosiveness_loading | Computed | Yes | °/s |
| 7 | explosiveness_concentric | Computed | Yes | °/s |
| 8 | rms_jerk | Computed | No | °/s³ |
| 9 | rom_cov_percentage | Computed | No | % |
| 10 | rom_symmetry_index | Computed | No | % |
| 11 | peak_resultant_accel | Computed | Yes | °/s² |
| 12 | asymmetry | Bilateral | No | % |
| 13 | net_global_asymmetry | Bilateral | No | % |
| 14 | phase_shift | Bilateral | No | ° |
| 15 | cross_correlation | Bilateral | No | -1 to 1 |
| 16 | temporal_lag | Bilateral | No | ms |
| 17 | flexor_extensor_ratio | Unilateral | No | % |
| 18 | eccentric_concentric_ratio | Unilateral | No | % |
| 19 | bilateral_ratio_diff | Unilateral | No | % |
| 20 | ground_contact_time_ms | Ground/Flight | No | ms |
| 21 | flight_time_ms | Ground/Flight | No | ms |
| 22 | jump_height_cm | Ground/Flight | No | cm |
| 23 | RSI | Ground/Flight | No | m/s |
| 24 | RMD | Force/Power | No | g/s |
| 25 | normalized_force | Force/Power | Yes | BW |
| 26 | impulse_estimate | Force/Power | No | m/s |
| 27 | leg_stiffness | Stiffness | No | N/m |
| 28 | vertical_stiffness | Stiffness | No | N/m |
| 29 | SPARC | Smoothness | No | - |
| 30 | LDLJ | Smoothness | No | - |
| 31 | n_velocity_peaks | Smoothness | No | count |
| 32 | max_flexion_timing_diff | Temporal | Yes | ms |
| 33 | zero_velocity_phase_ms | Temporal | No | ms |
| 34 | shock_absorption_score | Temporal | No | 0-100 |
| 35 | stance_phase_pct | Gait | No | % |
| 36 | swing_phase_pct | Gait | No | % |
| 37 | duty_factor | Gait | No | 0-1 |
| 38 | movement_type | Classification | No | enum |
| 39 | rolling_phase_offset | Classification | No | ° series |
| 40 | advanced_asymmetry | Adv. Asymmetry | No | complex |
| 40b | rolling_advanced_asymmetry | Adv. Asymmetry | No | complex |
| 41 | optimal_phase_alignment | Adv. Asymmetry | No | complex |
| 42 | overall_performance_index | Performance | No | 0-100 + grade |

### Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    ANALYSIS PIPELINE                            │
├─────────────────────────────────────────────────────────────────┤
│  1. RAW INPUT                                                   │
│     Left[], Right[] signals                                     │
│                         ↓                                       │
│  2. MOVEMENT CLASSIFICATION (#38)                               │
│     → bilateral / unilateral / single_leg / mixed               │
│                         ↓                                       │
│  3. PHASE CORRECTION (if unilateral/mixed)                      │
│     → Calculate optimal lag                                     │
│     → Shift Right signal to align with Left                     │
│                         ↓                                       │
│  4. ADVANCED ASYMMETRY (#40)                                    │
│     → Convolve diff with Gaussian(100) → baseline offset        │
│     → Subtract baseline → real asymmetry                        │
│     → Detect asymmetry events                                   │
│                         ↓                                       │
│  5. STANDARD METRICS (#1-37)                                    │
│     → Computed on corrected signals                             │
│                         ↓                                       │
│  6. OUTPUT                                                      │
│     → Full analysis result with all metrics                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-XX | Initial specification |
| 1.1 | 2025-01-XX | Fixed: adaptive robust peak (all peaks, not fixed N); butterworth 4th order; explosiveness index offset; cross-correlation normalization; detectGroundContacts freefall logic; SPARC implementation; category counts; SPARC/LDLJ interpretation (less negative = smoother) |
| 1.2 | 2025-01-XX | Added: Movement Classification (#38-39) - bilateral/unilateral detection, rolling phase offset with transition detection; Advanced Asymmetry (#40-41) - phase correction for unilateral movements, convolution-based separation of placement offset from real asymmetry, asymmetry event detection, rolling windowed analysis, optimal phase alignment; Overall Performance Index (#42) - composite 0-100 score with 5 domains (symmetry, power, control, stability, efficiency), activity-aware weighting, letter grades, clinical flags; Processing pipeline documentation |
| 1.2.1 | 2025-01-XX | **Enhanced OPI based on literature review (FMS, PCA, GSi, CGAM, wUSI):** Added reliability-adjusted weighting (CGAM-inspired) - more reliable metrics contribute more; Confidence intervals (95% CI) for score uncertainty; Minimal Detectable Change (MDC95) for clinically meaningful change detection; Percentile ranking with interpretation when normative data available; Trend analysis (improving/stable/declining) with significance testing; Age/sex-adjusted thresholds for population-appropriate scoring; Metric contribution breakdown showing top strengths/weaknesses; Enhanced type definitions with full uncertainty quantification |

