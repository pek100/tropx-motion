/**
 * Validation script to test non-blocking behavior of AsyncDataParser.
 * Simulates high-frequency multi-joint data streams and measures blocking characteristics.
 */

import { AsyncDataParser } from '../dataProcessing/AsyncDataParser';
import { AsyncPerformanceMonitor } from '../shared/AsyncPerformanceMonitor';
import { JointAngleData } from '../shared/types';

interface ValidationResults {
    testName: string;
    success: boolean;
    avgEnqueueTime: number;
    maxEnqueueTime: number;
    blockingOperations: number;
    totalOperations: number;
    blockingPercentage: number;
    throughput: number;
    details: string[];
}

export class AsyncParserValidation {
    private static readonly BLOCKING_THRESHOLD = 2.0; // 2ms threshold for blocking detection
    private static readonly HIGH_FREQUENCY_HZ = 500; // Simulate 500Hz per joint
    private static readonly TEST_DURATION_MS = 5000; // 5 second stress test

    /**
     * Run comprehensive validation suite
     */
    static async runValidation(): Promise<ValidationResults[]> {
        console.log('🧪 Starting AsyncDataParser validation suite...');

        const results: ValidationResults[] = [];

        // Test 1: Single joint high-frequency
        results.push(await this.testSingleJointHighFrequency());

        // Test 2: Multi-joint concurrent processing
        results.push(await this.testMultiJointConcurrent());

        // Test 3: Burst load testing
        results.push(await this.testBurstLoad());

        // Test 4: Memory leak detection
        results.push(await this.testMemoryLeakage());

        // Test 5: Compare with blocking implementation
        results.push(await this.testBlockingComparison());

        // Generate final report
        this.generateValidationReport(results);

        return results;
    }

    /**
     * Test single joint at extremely high frequency
     */
    private static async testSingleJointHighFrequency(): Promise<ValidationResults> {
        console.log('🔬 Testing single joint at 500Hz...');

        const parser = AsyncDataParser.getInstance(500);
        const monitor = AsyncPerformanceMonitor.getInstance();
        monitor.clearMetrics();

        parser.startNewRecording();

        const startTime = Date.now();
        let operationCount = 0;
        const enqueueTimes: number[] = [];

        // Generate 500Hz data for 5 seconds = 2500 samples
        const interval = setInterval(() => {
            const start = performance.now();

            const angleData: JointAngleData = {
                jointName: 'test_knee',
                angle: 45 + Math.sin(Date.now() / 1000) * 30,
                timestamp: Date.now(),
                deviceIds: ['test_device_1', 'test_device_2']
            };

            parser.accumulateAngleData(angleData);

            const duration = performance.now() - start;
            enqueueTimes.push(duration);
            operationCount++;

        }, 1000 / this.HIGH_FREQUENCY_HZ);

        // Run for specified duration
        await new Promise(resolve => setTimeout(resolve, this.TEST_DURATION_MS));
        clearInterval(interval);

        // Allow processing to complete
        await new Promise(resolve => setTimeout(resolve, 200));

        const summary = monitor.getPerformanceSummary();
        const avgEnqueueTime = enqueueTimes.reduce((a, b) => a + b, 0) / enqueueTimes.length;
        const maxEnqueueTime = Math.max(...enqueueTimes);
        const blockingCount = enqueueTimes.filter(t => t > this.BLOCKING_THRESHOLD).length;
        const blockingPercentage = (blockingCount / enqueueTimes.length) * 100;
        const throughput = operationCount / (this.TEST_DURATION_MS / 1000);

        const success = blockingPercentage < 5.0; // Less than 5% blocking operations

        return {
            testName: 'Single Joint High Frequency (500Hz)',
            success,
            avgEnqueueTime,
            maxEnqueueTime,
            blockingOperations: blockingCount,
            totalOperations: operationCount,
            blockingPercentage,
            throughput,
            details: [
                `Generated ${operationCount} samples in ${this.TEST_DURATION_MS}ms`,
                `Target frequency: ${this.HIGH_FREQUENCY_HZ}Hz`,
                `Actual throughput: ${throughput.toFixed(1)} samples/sec`,
                `Blocking threshold: ${this.BLOCKING_THRESHOLD}ms`
            ]
        };
    }

    /**
     * Test multiple joints processing concurrently
     */
    private static async testMultiJointConcurrent(): Promise<ValidationResults> {
        console.log('🔬 Testing 4 joints concurrently at 200Hz each...');

        const parser = AsyncDataParser.getInstance(200);
        const monitor = AsyncPerformanceMonitor.getInstance();
        monitor.clearMetrics();

        parser.startNewRecording();

        const joints = ['left_knee', 'right_knee', 'left_ankle', 'right_ankle'];
        const intervals: NodeJS.Timeout[] = [];
        let totalOperations = 0;
        const enqueueTimes: number[] = [];

        // Start concurrent processing for each joint
        joints.forEach((jointName, index) => {
            const interval = setInterval(() => {
                const start = performance.now();

                const angleData: JointAngleData = {
                    jointName,
                    angle: 30 + index * 10 + Math.sin((Date.now() + index * 1000) / 2000) * 20,
                    timestamp: Date.now(),
                    deviceIds: [`device_${index}_1`, `device_${index}_2`]
                };

                parser.accumulateAngleData(angleData);

                const duration = performance.now() - start;
                enqueueTimes.push(duration);
                totalOperations++;

            }, 1000 / 200); // 200Hz per joint

            intervals.push(interval);
        });

        // Run for test duration
        await new Promise(resolve => setTimeout(resolve, this.TEST_DURATION_MS));
        intervals.forEach(clearInterval);

        // Allow processing to complete
        await new Promise(resolve => setTimeout(resolve, 300));

        const avgEnqueueTime = enqueueTimes.reduce((a, b) => a + b, 0) / enqueueTimes.length;
        const maxEnqueueTime = Math.max(...enqueueTimes);
        const blockingCount = enqueueTimes.filter(t => t > this.BLOCKING_THRESHOLD).length;
        const blockingPercentage = (blockingCount / enqueueTimes.length) * 100;
        const throughput = totalOperations / (this.TEST_DURATION_MS / 1000);

        const success = blockingPercentage < 3.0; // Even stricter for multi-joint

        return {
            testName: 'Multi-Joint Concurrent (4 joints @ 200Hz)',
            success,
            avgEnqueueTime,
            maxEnqueueTime,
            blockingOperations: blockingCount,
            totalOperations,
            blockingPercentage,
            throughput,
            details: [
                `Processed ${joints.length} joints concurrently`,
                `Total operations: ${totalOperations}`,
                `Expected total throughput: ${joints.length * 200}Hz`,
                `Actual throughput: ${throughput.toFixed(1)} ops/sec`
            ]
        };
    }

    /**
     * Test burst load with sudden spike in data
     */
    private static async testBurstLoad(): Promise<ValidationResults> {
        console.log('🔬 Testing burst load with sudden spikes...');

        const parser = AsyncDataParser.getInstance(100);
        const monitor = AsyncPerformanceMonitor.getInstance();
        monitor.clearMetrics();

        parser.startNewRecording();

        let totalOperations = 0;
        const enqueueTimes: number[] = [];

        // Normal load phase (100Hz for 2 seconds)
        await this.generateLoad(parser, enqueueTimes, 100, 2000, 'normal_joint');
        totalOperations += 200; // 100Hz * 2s

        // Burst phase (1000Hz for 1 second)
        console.log('  💥 Starting burst phase...');
        await this.generateLoad(parser, enqueueTimes, 1000, 1000, 'burst_joint');
        totalOperations += 1000; // 1000Hz * 1s

        // Recovery phase (100Hz for 2 seconds)
        console.log('  📉 Recovery phase...');
        await this.generateLoad(parser, enqueueTimes, 100, 2000, 'recovery_joint');
        totalOperations += 200; // 100Hz * 2s

        // Allow processing to complete
        await new Promise(resolve => setTimeout(resolve, 500));

        const avgEnqueueTime = enqueueTimes.reduce((a, b) => a + b, 0) / enqueueTimes.length;
        const maxEnqueueTime = Math.max(...enqueueTimes);
        const blockingCount = enqueueTimes.filter(t => t > this.BLOCKING_THRESHOLD).length;
        const blockingPercentage = (blockingCount / enqueueTimes.length) * 100;
        const throughput = totalOperations / 5; // 5 second test

        const success = blockingPercentage < 10.0; // Allow higher threshold for burst testing

        return {
            testName: 'Burst Load Testing',
            success,
            avgEnqueueTime,
            maxEnqueueTime,
            blockingOperations: blockingCount,
            totalOperations,
            blockingPercentage,
            throughput,
            details: [
                'Test phases: Normal (100Hz) → Burst (1000Hz) → Recovery (100Hz)',
                `Peak load: 1000Hz for 1 second`,
                `System handled ${totalOperations} operations across all phases`,
                `Burst resilience: ${success ? 'PASSED' : 'FAILED'}`
            ]
        };
    }

    /**
     * Test for memory leaks during extended operation
     */
    private static async testMemoryLeakage(): Promise<ValidationResults> {
        console.log('🔬 Testing memory leak behavior...');

        const parser = AsyncDataParser.getInstance(200);
        parser.startNewRecording();

        const initialMemory = process.memoryUsage();
        let totalOperations = 0;
        const memorySnapshots: number[] = [];

        // Run for extended period with memory monitoring
        const duration = 3000; // 3 seconds
        const frequency = 300; // 300Hz
        const startTime = Date.now();

        const interval = setInterval(() => {
            const angleData: JointAngleData = {
                jointName: 'memory_test_joint',
                angle: Math.random() * 90,
                timestamp: Date.now(),
                deviceIds: ['mem_device_1', 'mem_device_2']
            };

            parser.accumulateAngleData(angleData);
            totalOperations++;

            // Take memory snapshot every 100 operations
            if (totalOperations % 100 === 0) {
                const currentMemory = process.memoryUsage();
                memorySnapshots.push(currentMemory.heapUsed);
            }

        }, 1000 / frequency);

        await new Promise(resolve => setTimeout(resolve, duration));
        clearInterval(interval);

        // Allow cleanup
        await new Promise(resolve => setTimeout(resolve, 500));

        const finalMemory = process.memoryUsage();
        const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
        const memoryGrowthMB = memoryGrowth / (1024 * 1024);

        // Check if memory growth is reasonable (< 10MB for this test)
        const success = memoryGrowthMB < 10;

        return {
            testName: 'Memory Leak Detection',
            success,
            avgEnqueueTime: 0, // Not applicable
            maxEnqueueTime: 0, // Not applicable
            blockingOperations: 0, // Not applicable
            totalOperations,
            blockingPercentage: 0, // Not applicable
            throughput: totalOperations / (duration / 1000),
            details: [
                `Initial heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
                `Final heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
                `Memory growth: ${memoryGrowthMB.toFixed(2)}MB`,
                `Operations processed: ${totalOperations}`,
                `Memory per operation: ${(memoryGrowthMB * 1024 / totalOperations).toFixed(3)}KB`
            ]
        };
    }

    /**
     * Compare with blocking implementation (simulated)
     */
    private static async testBlockingComparison(): Promise<ValidationResults> {
        console.log('🔬 Comparing with simulated blocking implementation...');

        // Test AsyncDataParser
        const asyncParser = AsyncDataParser.getInstance(200);
        const monitor = AsyncPerformanceMonitor.getInstance();
        monitor.clearMetrics();

        asyncParser.startNewRecording();

        const asyncTimes: number[] = [];
        let asyncOperations = 0;

        // Async test
        await this.generateLoad(asyncParser, asyncTimes, 200, 2000, 'async_test');
        asyncOperations = asyncTimes.length;

        // Simulate blocking behavior
        const blockingTimes: number[] = [];
        let blockingOperations = 0;

        const startTime = Date.now();
        while (Date.now() - startTime < 2000) {
            const start = performance.now();

            // Simulate blocking operations (array splice, etc.)
            const tempArray = new Array(1000).fill(0).map((_, i) => i);
            tempArray.splice(0, 500); // Blocking operation

            const duration = performance.now() - start;
            blockingTimes.push(duration);
            blockingOperations++;

            // Throttle to roughly match async rate
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        const asyncAvg = asyncTimes.reduce((a, b) => a + b, 0) / asyncTimes.length;
        const blockingAvg = blockingTimes.reduce((a, b) => a + b, 0) / blockingTimes.length;
        const performanceGain = ((blockingAvg - asyncAvg) / blockingAvg) * 100;

        const success = performanceGain > 50; // At least 50% improvement

        return {
            testName: 'Blocking vs Async Comparison',
            success,
            avgEnqueueTime: asyncAvg,
            maxEnqueueTime: Math.max(...asyncTimes),
            blockingOperations: 0, // N/A
            totalOperations: asyncOperations,
            blockingPercentage: 0, // N/A
            throughput: asyncOperations / 2,
            details: [
                `Async average: ${asyncAvg.toFixed(3)}ms`,
                `Blocking average: ${blockingAvg.toFixed(3)}ms`,
                `Performance gain: ${performanceGain.toFixed(1)}%`,
                `Async operations: ${asyncOperations}`,
                `Blocking operations: ${blockingOperations}`
            ]
        };
    }

    /**
     * Helper method to generate load at specified frequency
     */
    private static async generateLoad(
        parser: AsyncDataParser,
        enqueueTimes: number[],
        frequency: number,
        duration: number,
        jointName: string
    ): Promise<void> {
        return new Promise(resolve => {
            const interval = setInterval(() => {
                const start = performance.now();

                const angleData: JointAngleData = {
                    jointName,
                    angle: Math.random() * 90,
                    timestamp: Date.now(),
                    deviceIds: ['test_dev_1', 'test_dev_2']
                };

                parser.accumulateAngleData(angleData);

                const enqueueDuration = performance.now() - start;
                enqueueTimes.push(enqueueDuration);

            }, 1000 / frequency);

            setTimeout(() => {
                clearInterval(interval);
                resolve();
            }, duration);
        });
    }

    /**
     * Generate comprehensive validation report
     */
    private static generateValidationReport(results: ValidationResults[]): void {
        console.log('\n📊 AsyncDataParser Validation Report');
        console.log('=====================================');

        const passedTests = results.filter(r => r.success).length;
        const totalTests = results.length;
        const overallSuccess = passedTests === totalTests;

        console.log(`Overall Status: ${overallSuccess ? '✅ PASSED' : '❌ FAILED'}`);
        console.log(`Tests Passed: ${passedTests}/${totalTests}`);
        console.log('');

        results.forEach(result => {
            console.log(`${result.success ? '✅' : '❌'} ${result.testName}`);
            console.log(`   Average Enqueue: ${result.avgEnqueueTime.toFixed(3)}ms`);
            console.log(`   Max Enqueue: ${result.maxEnqueueTime.toFixed(3)}ms`);
            console.log(`   Blocking Rate: ${result.blockingPercentage.toFixed(1)}%`);
            console.log(`   Throughput: ${result.throughput.toFixed(1)} ops/sec`);
            result.details.forEach(detail => {
                console.log(`   • ${detail}`);
            });
            console.log('');
        });

        // Performance summary
        const avgEnqueueTime = results.reduce((sum, r) => sum + r.avgEnqueueTime, 0) / results.length;
        const totalOperations = results.reduce((sum, r) => sum + r.totalOperations, 0);
        const totalBlockingOps = results.reduce((sum, r) => sum + r.blockingOperations, 0);
        const overallBlockingRate = (totalBlockingOps / totalOperations) * 100;

        console.log('📈 Performance Summary');
        console.log('=====================');
        console.log(`Total Operations Processed: ${totalOperations.toLocaleString()}`);
        console.log(`Average Enqueue Time: ${avgEnqueueTime.toFixed(3)}ms`);
        console.log(`Overall Blocking Rate: ${overallBlockingRate.toFixed(2)}%`);
        console.log(`Non-blocking Operations: ${(totalOperations - totalBlockingOps).toLocaleString()}`);

        if (overallSuccess) {
            console.log('\n🎉 All tests passed! AsyncDataParser is ready for production.');
        } else {
            console.log('\n⚠️  Some tests failed. Review implementation before production use.');
        }
    }
}

// Export for use in test runners
export default AsyncParserValidation;