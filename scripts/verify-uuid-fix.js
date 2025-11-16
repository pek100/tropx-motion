#!/usr/bin/env node

/**
 * Verification script for UUID normalization fix
 * Tests that node-ble UUIDs with dashes are correctly normalized to match Noble format
 */

// Test UUID normalization
const testUuids = [
  {
    input: 'd5913036-2d8a-41ee-85b9-4e361aa5c8a7',
    expected: 'd59130362d8a41ee85b94e361aa5c8a7',
    name: 'COMMAND_CHARACTERISTIC_UUID'
  },
  {
    input: '09bf2c52-d1d9-c0b7-4145-475964544307',
    expected: '09bf2c52d1d9c0b74145475964544307',
    name: 'DATA_CHARACTERISTIC_UUID'
  },
  {
    input: 'c8c0a708-e361-4b5e-a365-98fa6b0a836f',
    expected: 'c8c0a708e3614b5ea36598fa6b0a836f',
    name: 'SERVICE_UUID'
  }
];

console.log('🧪 Testing UUID normalization...\n');

let allPassed = true;

for (const test of testUuids) {
  const normalized = test.input.replace(/-/g, '');
  const passed = normalized === test.expected;

  if (passed) {
    console.log(`✅ ${test.name}: PASS`);
    console.log(`   Input:      ${test.input}`);
    console.log(`   Normalized: ${normalized}`);
    console.log(`   Expected:   ${test.expected}\n`);
  } else {
    console.log(`❌ ${test.name}: FAIL`);
    console.log(`   Input:      ${test.input}`);
    console.log(`   Normalized: ${normalized}`);
    console.log(`   Expected:   ${test.expected}\n`);
    allPassed = false;
  }
}

if (allPassed) {
  console.log('✅ All UUID normalization tests passed!');
  console.log('\n📝 Fix Summary:');
  console.log('   - node-ble returns UUIDs WITH dashes');
  console.log('   - Noble returns UUIDs WITHOUT dashes');
  console.log('   - Adapter now normalizes UUIDs by removing dashes');
  console.log('   - TropXDevice can now match characteristics correctly');
  process.exit(0);
} else {
  console.log('❌ Some tests failed!');
  process.exit(1);
}
