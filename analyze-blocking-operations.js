#!/usr/bin/env node

/**
 * Blocking Operations Analysis Script
 *
 * This script helps you run the app and collect detailed logs about blocking operations.
 * Run this DURING streaming to capture bottlenecks in real-time.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('🔍 TropX Motion - Blocking Operations Analyzer');
console.log('='.repeat(50));

/**
 * Instructions for running blocking analysis
 */
function printInstructions() {
    console.log(`
📋 BLOCKING OPERATION ANALYSIS INSTRUCTIONS:

1. 🚀 START THE APP:
   npm run dev

2. 🔗 CONNECT TO DEVICES:
   - Connect your Bluetooth IMU devices
   - Ensure they're streaming data

3. 📡 START STREAMING:
   - Begin motion capture
   - Let it run for 30-60 seconds during active motion
   - Watch console for blocking operation alerts

4. 📊 MONITOR REAL-TIME ALERTS:
   Look for these warning patterns:
   🚨 [BLOCKING] - Operations >1ms (potential bottlenecks)
   💥 [STREAMING_BOTTLENECK] - Critical streaming blocks >0.3ms
   ⚠️ [EVENT_LOOP] - Event loop delays >10ms

5. 📝 COLLECT LOGS:
   - Copy all console output with blocking warnings
   - Send the logs to Claude for analysis

6. 🔄 ITERATE:
   - I'll convert blocking functions to async
   - Re-run this analysis after each fix
   - Repeat until all bottlenecks are eliminated

💡 KEY ALERTS TO WATCH FOR:
   - WEBSOCKET operations blocking
   - COORDINATOR device processing delays
   - UI rendering blocking operations
   - Array operations (splice, slice, spread)
   - JSON parsing/serialization delays
   - File I/O operations

🎯 SUCCESS CRITERIA:
   - All operations <1ms during streaming
   - No event loop delays >10ms
   - Smooth 60fps UI updates
   - No frame drops during high-frequency motion

🚨 If you see CRITICAL alerts, stop and send logs immediately!
`);
}

/**
 * Generate performance monitoring command
 */
function generateMonitoringCommand() {
    return `
# Set environment variables for enhanced logging
export NODE_ENV=development
export PERF_DEBUG=1

# Run the app with blocking detection enabled
npm run dev

# Alternative: Run with even more verbose logging
# DEBUG=* npm run dev
`;
}

/**
 * Create log collection helper
 */
function createLogCollectionScript() {
    const script = `#!/bin/bash
# TropX Motion Log Collection Script

echo "🔍 Starting TropX Motion with blocking detection..."
echo "📅 Started at: $(date)"
echo "🎯 Monitoring for blocking operations..."

# Create logs directory
mkdir -p ./blocking-analysis-logs

# Generate log filename with timestamp
LOG_FILE="./blocking-analysis-logs/blocking-analysis-$(date +%Y%m%d-%H%M%S).log"

echo "📝 Logs will be saved to: $LOG_FILE"

# Set environment variables
export NODE_ENV=development
export PERF_DEBUG=1

# Run app and capture all output
npm run dev 2>&1 | tee "$LOG_FILE"

echo "📋 Log collection complete. Send $LOG_FILE to Claude for analysis."
`;

    fs.writeFileSync('./run-blocking-analysis.sh', script);
    fs.chmodSync('./run-blocking-analysis.sh', '755');

    console.log('✅ Created ./run-blocking-analysis.sh');
}

/**
 * Main analysis function
 */
function main() {
    printInstructions();

    console.log('\n🛠️ SETUP:');
    createLogCollectionScript();

    console.log('\n📋 QUICK START:');
    console.log('1. Run: ./run-blocking-analysis.sh');
    console.log('2. Use app normally during motion capture');
    console.log('3. Copy ALL console output with blocking warnings');
    console.log('4. Send logs to Claude for bottleneck analysis');

    console.log('\n🎯 EXPECTED OUTPUT PATTERNS:');
    console.log('✅ Normal: [PERF] COORDINATOR[processNewData] device_1 0.234ms');
    console.log('⚠️  Warning: 🚨 [BLOCKING] WEBSOCKET[broadcast] took 1.245ms - POTENTIAL BOTTLENECK!');
    console.log('🔥 Critical: 💥 [STREAMING_BOTTLENECK] WEBSOCKET.motion_data_routing took 2.1ms');

    console.log('\n' + '='.repeat(50));
    console.log('🚀 Ready to analyze blocking operations!');
    console.log('Run ./run-blocking-analysis.sh to begin');
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = {
    printInstructions,
    generateMonitoringCommand,
    createLogCollectionScript
};