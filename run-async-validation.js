#!/usr/bin/env node

/**
 * Test runner for AsyncDataParser validation
 * Run with: node run-async-validation.js
 */

const { exec } = require('child_process');
const path = require('path');

console.log('🚀 Starting AsyncDataParser validation...\n');

// Compile TypeScript and run validation
const command = `npx tsc --noEmit && node -r ts-node/register motionProcessing/tests/AsyncParserValidation.ts`;

exec(command, { cwd: __dirname }, (error, stdout, stderr) => {
    if (error) {
        console.error('❌ Validation failed to run:', error);
        process.exit(1);
    }

    if (stderr) {
        console.error('⚠️ Stderr output:', stderr);
    }

    console.log(stdout);
    console.log('✅ Validation completed successfully!');
});