#!/bin/bash
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
