/**
 * Validation script for quaternion to Euler angle conversion.
 * Tests that pure single-axis rotations produce correct results without cross-contamination.
 *
 * Run with: npx tsx scripts/validate-quaternion-euler.ts
 */

interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

type EulerAxis = "x" | "y" | "z";

// Copy of the fixed quaternionToAngle function for testing
function quaternionToAngle(q: Quaternion, axis: EulerAxis = "y"): number {
  const { w, x, y, z } = q;

  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;

  let angle: number;

  switch (axis) {
    case "x": {
      const sinX = yz + wx;
      const cosX = 1 - (xx + zz);
      angle = Math.atan2(sinX, cosX);
      break;
    }
    case "y": {
      const sinY = xz + wy;
      const cosY = 1 - (yy + zz);
      angle = Math.atan2(sinY, cosY);
      break;
    }
    case "z": {
      const sinZ = xy + wz;
      const cosZ = 1 - (xx + zz);
      angle = Math.atan2(sinZ, cosZ);
      break;
    }
  }

  return angle * (180 / Math.PI);
}

// Helper to create quaternion from axis-angle
function axisAngleToQuaternion(
  axis: "x" | "y" | "z",
  angleDeg: number
): Quaternion {
  const angleRad = (angleDeg * Math.PI) / 180;
  const halfAngle = angleRad / 2;
  const s = Math.sin(halfAngle);
  const c = Math.cos(halfAngle);

  switch (axis) {
    case "x":
      return { w: c, x: s, y: 0, z: 0 };
    case "y":
      return { w: c, x: 0, y: s, z: 0 };
    case "z":
      return { w: c, x: 0, y: 0, z: s };
  }
}

// Test configuration
const TEST_ANGLES = [0, 30, 45, 60, 90, 120, 135, 150, 180, -30, -90, -120];
const TOLERANCE = 0.01; // degrees

interface TestResult {
  passed: boolean;
  input: string;
  expected: { x: number; y: number; z: number };
  actual: { x: number; y: number; z: number };
  errors: string[];
}

function runTest(
  axis: "x" | "y" | "z",
  angleDeg: number
): TestResult {
  const q = axisAngleToQuaternion(axis, angleDeg);

  const actualX = quaternionToAngle(q, "x");
  const actualY = quaternionToAngle(q, "y");
  const actualZ = quaternionToAngle(q, "z");

  // For a pure rotation around one axis, the other two should be ~0
  const expected = {
    x: axis === "x" ? angleDeg : 0,
    y: axis === "y" ? angleDeg : 0,
    z: axis === "z" ? angleDeg : 0,
  };

  const actual = { x: actualX, y: actualY, z: actualZ };
  const errors: string[] = [];

  // Check each axis
  for (const a of ["x", "y", "z"] as const) {
    const diff = Math.abs(actual[a] - expected[a]);
    // Handle wraparound at ±180°
    const diffWrap = Math.min(diff, 360 - diff);
    if (diffWrap > TOLERANCE) {
      errors.push(
        `${a.toUpperCase()}: expected ${expected[a].toFixed(2)}°, got ${actual[a].toFixed(2)}° (diff: ${diffWrap.toFixed(2)}°)`
      );
    }
  }

  return {
    passed: errors.length === 0,
    input: `Pure ${axis.toUpperCase()} rotation of ${angleDeg}°`,
    expected,
    actual,
    errors,
  };
}

// Run all tests
console.log("=".repeat(70));
console.log("Quaternion to Euler Angle Validation");
console.log("=".repeat(70));
console.log();

let passCount = 0;
let failCount = 0;
const failedTests: TestResult[] = [];

for (const axis of ["x", "y", "z"] as const) {
  console.log(`Testing pure ${axis.toUpperCase()}-axis rotations:`);
  console.log("-".repeat(50));

  for (const angle of TEST_ANGLES) {
    const result = runTest(axis, angle);

    if (result.passed) {
      console.log(`  ✓ ${result.input}`);
      passCount++;
    } else {
      console.log(`  ✗ ${result.input}`);
      for (const err of result.errors) {
        console.log(`      ${err}`);
      }
      failCount++;
      failedTests.push(result);
    }
  }
  console.log();
}

// Summary
console.log("=".repeat(70));
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log("=".repeat(70));

if (failCount > 0) {
  console.log("\nFailed tests summary:");
  for (const test of failedTests) {
    console.log(`\n  ${test.input}:`);
    console.log(
      `    Expected: X=${test.expected.x.toFixed(1)}°, Y=${test.expected.y.toFixed(1)}°, Z=${test.expected.z.toFixed(1)}°`
    );
    console.log(
      `    Actual:   X=${test.actual.x.toFixed(1)}°, Y=${test.actual.y.toFixed(1)}°, Z=${test.actual.z.toFixed(1)}°`
    );
  }
  process.exit(1);
} else {
  console.log("\nAll tests passed! The quaternion to Euler conversion is working correctly.");
  process.exit(0);
}
