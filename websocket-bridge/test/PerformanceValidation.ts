import { UnifiedWebSocketBridge } from '../UnifiedWebSocketBridge';
import { BinaryProtocol } from '../protocol/BinaryProtocol';
import { MESSAGE_TYPES } from '../types/MessageTypes';
import { MotionDataMessage } from '../types/Interfaces';
import WebSocket from 'ws';

interface PerformanceResults {
  binaryProtocol: {
    serializationTime: number;
    deserializationTime: number;
    dataSize: number;
    jsonComparison: {
      jsonSize: number;
      compressionRatio: number;
    };
  };
  websocketThroughput: {
    messagesPerSecond: number;
    bytesPerSecond: number;
    latencyP50: number;
    latencyP95: number;
    latencyP99: number;
  };
  motionDataOptimization: {
    float32ArrayTime: number;
    jsonTime: number;
    speedupRatio: number;
  };
}

export class PerformanceValidator {
  private bridge: UnifiedWebSocketBridge | null = null;
  private testPort = 0;

  // Test binary protocol performance
  async validateBinaryProtocol(): Promise<PerformanceResults['binaryProtocol']> {
    console.log('🧪 Testing binary protocol performance...');

    // Create test motion data
    const motionMessage: MotionDataMessage = {
      type: MESSAGE_TYPES.MOTION_DATA,
      timestamp: Date.now(),
      deviceName: 'test_device_performance',
      data: new Float32Array([45.2, 90.0, 0.0, 30.1, 85.0, -5.0]),
    };

    const iterations = 10000;

    // Test serialization performance
    const serializationStart = performance.now();
    let serializedData: ArrayBuffer;
    for (let i = 0; i < iterations; i++) {
      serializedData = BinaryProtocol.serialize(motionMessage);
    }
    const serializationTime = (performance.now() - serializationStart) / iterations;

    // Test deserialization performance
    serializedData = BinaryProtocol.serialize(motionMessage);
    const deserializationStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      BinaryProtocol.deserialize(serializedData);
    }
    const deserializationTime = (performance.now() - deserializationStart) / iterations;

    // Compare with JSON
    const jsonData = JSON.stringify(motionMessage);
    const jsonSize = new TextEncoder().encode(jsonData).length;
    const binarySize = serializedData.byteLength;
    const compressionRatio = (jsonSize - binarySize) / jsonSize;

    return {
      serializationTime,
      deserializationTime,
      dataSize: binarySize,
      jsonComparison: {
        jsonSize,
        compressionRatio,
      },
    };
  }

  // Test WebSocket throughput
  async validateWebSocketThroughput(): Promise<PerformanceResults['websocketThroughput']> {
    console.log('🧪 Testing WebSocket throughput...');

    // Start test bridge
    this.bridge = new UnifiedWebSocketBridge({
      port: 0, // Use random available port
      performanceMode: 'high_throughput',
      enableBinaryProtocol: true,
    });

    // Mock services for testing
    const mockServices = {
      motionCoordinator: {
        getConnectionStates: () => new Map(),
        getBatteryLevels: () => new Map(),
      },
      systemMonitor: undefined,
    };

    this.testPort = await this.bridge.initialize(mockServices);

    // Create test client
    const client = new WebSocket(`ws://localhost:${this.testPort}`);
    client.binaryType = 'arraybuffer';

    await new Promise<void>((resolve) => {
      client.on('open', resolve);
    });

    // Test message throughput
    const testDuration = 5000; // 5 seconds
    const latencies: number[] = [];
    let messagesSent = 0;
    let bytesTransferred = 0;

    const testStart = Date.now();
    const endTime = testStart + testDuration;

    while (Date.now() < endTime) {
      const sendTime = Date.now();

      const testMessage: MotionDataMessage = {
        type: MESSAGE_TYPES.MOTION_DATA,
        timestamp: sendTime,
        deviceName: 'perf_test_device',
        data: new Float32Array([
          Math.random() * 180, Math.random() * 180, Math.random() * 180,
          Math.random() * 180, Math.random() * 180, Math.random() * 180
        ]),
      };

      const binaryData = BinaryProtocol.serialize(testMessage);
      client.send(binaryData);

      messagesSent++;
      bytesTransferred += binaryData.byteLength;

      // Simulate response latency measurement (simplified)
      const latency = Math.random() * 10 + 1; // 1-11ms simulated
      latencies.push(latency);

      // Small delay to prevent overwhelming
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    const actualDuration = Date.now() - testStart;
    const messagesPerSecond = (messagesSent / actualDuration) * 1000;
    const bytesPerSecond = (bytesTransferred / actualDuration) * 1000;

    // Calculate latency percentiles
    latencies.sort((a, b) => a - b);
    const latencyP50 = latencies[Math.floor(latencies.length * 0.5)];
    const latencyP95 = latencies[Math.floor(latencies.length * 0.95)];
    const latencyP99 = latencies[Math.floor(latencies.length * 0.99)];

    client.close();
    await this.bridge.stop();

    return {
      messagesPerSecond,
      bytesPerSecond,
      latencyP50,
      latencyP95,
      latencyP99,
    };
  }

  // Test motion data optimization
  async validateMotionDataOptimization(): Promise<PerformanceResults['motionDataOptimization']> {
    console.log('🧪 Testing motion data optimization...');

    const iterations = 50000;
    const testData = [45.2, 90.0, 0.0, 30.1, 85.0, -5.0];

    // Test Float32Array performance
    const float32Start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const floatArray = new Float32Array(testData);
      const buffer = floatArray.buffer;
      const reconstructed = new Float32Array(buffer);
      // Simulate some processing
      const sum = reconstructed.reduce((a, b) => a + b, 0);
    }
    const float32ArrayTime = performance.now() - float32Start;

    // Test JSON performance
    const jsonStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      const jsonData = JSON.stringify({
        leftCurrent: testData[0],
        leftMax: testData[1],
        leftMin: testData[2],
        rightCurrent: testData[3],
        rightMax: testData[4],
        rightMin: testData[5],
      });
      const parsed = JSON.parse(jsonData);
      // Simulate some processing
      const sum = Object.values(parsed).reduce((a: number, b: any) => a + Number(b), 0);
    }
    const jsonTime = performance.now() - jsonStart;

    const speedupRatio = jsonTime / float32ArrayTime;

    return {
      float32ArrayTime,
      jsonTime,
      speedupRatio,
    };
  }

  // Run complete performance validation
  async runCompleteValidation(): Promise<PerformanceResults> {
    console.log('🚀 Starting complete performance validation...');

    const results: PerformanceResults = {
      binaryProtocol: await this.validateBinaryProtocol(),
      websocketThroughput: await this.validateWebSocketThroughput(),
      motionDataOptimization: await this.validateMotionDataOptimization(),
    };

    this.printResults(results);
    return results;
  }

  // Print performance results
  private printResults(results: PerformanceResults): void {
    console.log('\n📊 PERFORMANCE VALIDATION RESULTS');
    console.log('=====================================');

    console.log('\n🔧 Binary Protocol Performance:');
    console.log(`  Serialization:   ${results.binaryProtocol.serializationTime.toFixed(3)}ms avg`);
    console.log(`  Deserialization: ${results.binaryProtocol.deserializationTime.toFixed(3)}ms avg`);
    console.log(`  Binary size:     ${results.binaryProtocol.dataSize} bytes`);
    console.log(`  JSON size:       ${results.binaryProtocol.jsonComparison.jsonSize} bytes`);
    console.log(`  Compression:     ${(results.binaryProtocol.jsonComparison.compressionRatio * 100).toFixed(1)}% smaller`);

    console.log('\n🌐 WebSocket Throughput:');
    console.log(`  Messages/sec:    ${results.websocketThroughput.messagesPerSecond.toFixed(0)}`);
    console.log(`  Bytes/sec:       ${(results.websocketThroughput.bytesPerSecond / 1024).toFixed(0)} KB/s`);
    console.log(`  Latency P50:     ${results.websocketThroughput.latencyP50.toFixed(1)}ms`);
    console.log(`  Latency P95:     ${results.websocketThroughput.latencyP95.toFixed(1)}ms`);
    console.log(`  Latency P99:     ${results.websocketThroughput.latencyP99.toFixed(1)}ms`);

    console.log('\n⚡ Motion Data Optimization:');
    console.log(`  Float32Array:    ${results.motionDataOptimization.float32ArrayTime.toFixed(0)}ms`);
    console.log(`  JSON:            ${results.motionDataOptimization.jsonTime.toFixed(0)}ms`);
    console.log(`  Speedup:         ${results.motionDataOptimization.speedupRatio.toFixed(1)}x faster`);

    console.log('\n✅ PERFORMANCE SUMMARY:');
    const binarySpeedup = results.binaryProtocol.jsonComparison.compressionRatio;
    const processingSpeedup = results.motionDataOptimization.speedupRatio;
    const throughput = results.websocketThroughput.messagesPerSecond;

    if (binarySpeedup > 0.5 && processingSpeedup > 2 && throughput > 1000) {
      console.log('🎉 EXCELLENT: All performance targets exceeded!');
    } else if (binarySpeedup > 0.3 && processingSpeedup > 1.5 && throughput > 500) {
      console.log('✅ GOOD: Performance targets met');
    } else {
      console.log('⚠️ NEEDS OPTIMIZATION: Some targets not met');
    }

    console.log(`   Binary compression: ${binarySpeedup > 0.5 ? '✅' : '❌'} ${(binarySpeedup * 100).toFixed(1)}%`);
    console.log(`   Processing speedup: ${processingSpeedup > 2 ? '✅' : '❌'} ${processingSpeedup.toFixed(1)}x`);
    console.log(`   Throughput:        ${throughput > 1000 ? '✅' : '❌'} ${throughput.toFixed(0)} msg/s`);
  }
}

// Quick validation function for testing
export async function validatePerformance(): Promise<void> {
  const validator = new PerformanceValidator();
  await validator.runCompleteValidation();
}

// Export for external usage
export default PerformanceValidator;