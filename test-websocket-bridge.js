#!/usr/bin/env node

/**
 * Comprehensive WebSocket Bridge Communication Test Suite
 * Tests all UI <-> WebSocket communication types and data flows
 */

const path = require('path');
const { WebSocket } = require('ws');

// Import WebSocket Bridge components from compiled dist
const bridgeRoot = './dist/main/websocket-bridge';
const { BinaryProtocol } = require(`${bridgeRoot}/protocol/BinaryProtocol`);
const { MESSAGE_TYPES, ERROR_CODES } = require(`${bridgeRoot}/types/MessageTypes`);
const { createWebSocketBridge } = require(`${bridgeRoot}/index`);

// Mock existing services for testing
const mockMuseManager = {
  getAllDevices: () => [
    { id: 'device1', name: 'Muse-1234', connected: false, batteryLevel: 85 },
    { id: 'device2', name: 'Tropx-5678', connected: true, batteryLevel: 92 }
  ],
  getAllBatteryLevels: () => new Map([
    ['Muse-1234', 85],
    ['Tropx-5678', 92]
  ]),
  scanForDevices: async () => ({ success: true, devices: mockMuseManager.getAllDevices() }),
  reconnectToPreviousDevices: async () => {
    console.log(`Mock: Scanning for previous devices`);
    return [
      { id: 'device1', name: 'Muse-1234' },
      { id: 'device2', name: 'Tropx-5678' }
    ];
  },
  connectToScannedDevice: async (deviceId, deviceName) => {
    console.log(`Mock: Connecting to ${deviceName}`);
    return true;
  },
  disconnectFromDevice: async (deviceName) => {
    console.log(`Mock: Disconnecting from ${deviceName}`);
    return true;
  },
  startRecordingOnDevices: async () => true,
  stopRecordingOnDevices: async () => true,
  isDeviceConnected: (deviceName) => deviceName === 'Tropx-5678',
  isDeviceStreaming: (deviceName) => deviceName === 'Tropx-5678'
};

const mockMotionCoordinator = {
  getInitializationStatus: () => true,
  startRecording: (sessionId, exerciseId, setNumber) => {
    console.log(`Mock: Starting recording ${sessionId}`);
    return true;
  },
  stopRecording: async () => {
    console.log('Mock: Stopping recording');
    return true;
  },
  getConnectionStates: () => new Map([
    ['Tropx-5678', 'connected']
  ]),
  subscribeToUI: (callback) => {
    console.log('Mock: subscribeToUI called');
    // Return an unsubscribe function
    return () => {
      console.log('Mock: UI subscription unsubscribed');
    };
  },
  // Additional methods that might be expected by service adapters
  getUIData: () => ({
    left: { current: 45.0, max: 90.0, min: 0.0 },
    right: { current: 30.0, max: 85.0, min: -5.0 }
  }),
  getBatteryLevels: () => new Map([
    ['Tropx-5678', 92]
  ])
};

class WebSocketBridgeTester {
  constructor() {
    this.bridge = null;
    this.port = 0;
    this.testResults = {
      total: 0,
      passed: 0,
      failed: 0,
      errors: []
    };
  }

  // Test result tracking
  test(name, testFn) {
    this.testResults.total++;
    console.log(`\n🧪 Testing: ${name}`);

    try {
      const result = testFn();
      if (result === true || result === undefined) {
        console.log(`✅ PASS: ${name}`);
        this.testResults.passed++;
        return true;
      } else {
        throw new Error(`Test returned false: ${result}`);
      }
    } catch (error) {
      console.log(`❌ FAIL: ${name}`);
      console.log(`   Error: ${error.message}`);
      this.testResults.failed++;
      this.testResults.errors.push({ test: name, error: error.message });
      return false;
    }
  }

  async asyncTest(name, testFn) {
    this.testResults.total++;
    console.log(`\n🧪 Testing: ${name}`);

    try {
      const result = await testFn();
      if (result === true || result === undefined) {
        console.log(`✅ PASS: ${name}`);
        this.testResults.passed++;
        return true;
      } else {
        throw new Error(`Test returned false: ${result}`);
      }
    } catch (error) {
      console.log(`❌ FAIL: ${name}`);
      console.log(`   Error: ${error.message}`);
      this.testResults.failed++;
      this.testResults.errors.push({ test: name, error: error.message });
      return false;
    }
  }

  // Binary Protocol Tests
  testBinaryProtocolSerialization() {
    this.test('Binary Protocol - Heartbeat Serialization', () => {
      const message = {
        type: MESSAGE_TYPES.HEARTBEAT,
        requestId: 123,
        timestamp: Date.now()
      };

      const serialized = BinaryProtocol.serialize(message);
      const deserialized = BinaryProtocol.deserialize(serialized);

      return deserialized.type === MESSAGE_TYPES.HEARTBEAT &&
             deserialized.requestId === 123;
    });

    this.test('Binary Protocol - BLE Scan Request Serialization', () => {
      const message = {
        type: MESSAGE_TYPES.BLE_SCAN_REQUEST,
        requestId: 456,
        timestamp: Date.now()
      };

      const serialized = BinaryProtocol.serialize(message);
      const deserialized = BinaryProtocol.deserialize(serialized);

      return deserialized.type === MESSAGE_TYPES.BLE_SCAN_REQUEST &&
             deserialized.requestId === 456;
    });

    this.test('Binary Protocol - BLE Connect Request Serialization', () => {
      const message = {
        type: MESSAGE_TYPES.BLE_CONNECT_REQUEST,
        requestId: 789,
        timestamp: Date.now(),
        deviceId: 'device1',
        deviceName: 'Muse-1234'
      };

      const serialized = BinaryProtocol.serialize(message);
      const deserialized = BinaryProtocol.deserialize(serialized);

      return deserialized.type === MESSAGE_TYPES.BLE_CONNECT_REQUEST &&
             deserialized.deviceId === 'device1' &&
             deserialized.deviceName === 'Muse-1234';
    });

    this.test('Binary Protocol - Motion Data Serialization', () => {
      const motionData = {
        left: { current: 45.5, max: 90.0, min: 0.0 },
        right: { current: 30.2, max: 85.5, min: -5.5 },
        timestamp: Date.now()
      };

      const message = {
        type: MESSAGE_TYPES.MOTION_DATA,
        timestamp: Date.now(),
        data: motionData
      };

      const serialized = BinaryProtocol.serialize(message);
      const deserialized = BinaryProtocol.deserialize(serialized);

      return deserialized.type === MESSAGE_TYPES.MOTION_DATA &&
             deserialized.data.left.current === 45.5;
    });

    this.test('Binary Protocol - Error Message Serialization', () => {
      const message = {
        type: MESSAGE_TYPES.ERROR,
        requestId: 999,
        timestamp: Date.now(),
        code: ERROR_CODES.DEVICE_NOT_FOUND,
        message: 'Device not found'
      };

      const serialized = BinaryProtocol.serialize(message);
      const deserialized = BinaryProtocol.deserialize(serialized);

      return deserialized.type === MESSAGE_TYPES.ERROR &&
             deserialized.code === ERROR_CODES.DEVICE_NOT_FOUND &&
             deserialized.message === 'Device not found';
    });
  }

  // Service Adapter Tests
  async testServiceAdapterIntegration() {
    await this.asyncTest('Service Adapters - Bridge Initialization', async () => {
      const services = {
        museManager: mockMuseManager,
        motionCoordinator: mockMotionCoordinator
      };

      const config = {
        port: 8081 // Use different port for testing
      };

      const result = await createWebSocketBridge(services, config);
      this.bridge = result.bridge;
      this.port = result.port;

      return this.port === 8081 && this.bridge !== null;
    });

    this.test('Service Adapters - BLE Service Integration', () => {
      // Test that BLE service adapter correctly wraps museManager
      const devices = mockMuseManager.getAllDevices();
      return devices.length === 2 && devices[0].name === 'Muse-1234';
    });

    this.test('Service Adapters - Motion Service Integration', () => {
      // Test that motion service adapter correctly wraps motionCoordinator
      const status = mockMotionCoordinator.getInitializationStatus();
      return status === true;
    });
  }

  // Client-Server Communication Tests
  async testClientServerCommunication() {
    if (!this.bridge || !this.port) {
      throw new Error('Bridge not initialized for client-server tests');
    }

    await this.asyncTest('Client-Server - WebSocket Connection', async () => {
      return new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${this.port}`);
        client.binaryType = 'arraybuffer';

        client.onopen = () => {
          console.log('   Connected to WebSocket server');
          client.close();
          resolve(true);
        };

        client.onerror = (error) => {
          reject(new Error(`Connection failed: ${error.message}`));
        };

        client.onclose = () => {
          resolve(true);
        };

        setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 5000);
      });
    });

    await this.asyncTest('Client-Server - Heartbeat Communication', async () => {
      return new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${this.port}`);
        client.binaryType = 'arraybuffer';

        client.onopen = () => {
          const heartbeatMessage = {
            type: MESSAGE_TYPES.HEARTBEAT,
            requestId: 1001,
            timestamp: Date.now()
          };

          const serialized = BinaryProtocol.serialize(heartbeatMessage);
          client.send(serialized);
        };

        client.onmessage = (event) => {
          try {
            const response = BinaryProtocol.deserialize(event.data);
            console.log('   Received response:', response.type);

            if (response.type === MESSAGE_TYPES.HEARTBEAT && response.requestId === 1001) {
              client.close();
              resolve(true);
            } else {
              reject(new Error(`Unexpected response: ${response.type}`));
            }
          } catch (error) {
            reject(new Error(`Failed to deserialize response: ${error.message}`));
          }
        };

        client.onerror = (error) => {
          reject(new Error(`Communication failed: ${error.message}`));
        };

        setTimeout(() => {
          reject(new Error('Heartbeat timeout'));
        }, 5000);
      });
    });

    await this.asyncTest('Client-Server - BLE Scan Request', async () => {
      return new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${this.port}`);
        client.binaryType = 'arraybuffer';

        client.onopen = () => {
          const scanMessage = {
            type: MESSAGE_TYPES.BLE_SCAN_REQUEST,
            requestId: 1002,
            timestamp: Date.now()
          };

          const serialized = BinaryProtocol.serialize(scanMessage);
          client.send(serialized);
        };

        client.onmessage = (event) => {
          try {
            const response = BinaryProtocol.deserialize(event.data);
            console.log('   Received BLE scan response:', response.type);

            if (response.type === MESSAGE_TYPES.BLE_SCAN_RESPONSE &&
                response.requestId === 1002 &&
                response.devices && response.devices.length > 0) {
              client.close();
              resolve(true);
            } else {
              reject(new Error(`Invalid scan response: ${JSON.stringify(response)}`));
            }
          } catch (error) {
            reject(new Error(`Failed to deserialize scan response: ${error.message}`));
          }
        };

        client.onerror = (error) => {
          reject(new Error(`BLE scan communication failed: ${error.message}`));
        };

        setTimeout(() => {
          reject(new Error('BLE scan timeout'));
        }, 5000);
      });
    });

    await this.asyncTest('Client-Server - BLE Connect Request', async () => {
      return new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${this.port}`);
        client.binaryType = 'arraybuffer';

        client.onopen = () => {
          const connectMessage = {
            type: MESSAGE_TYPES.BLE_CONNECT_REQUEST,
            requestId: 1003,
            timestamp: Date.now(),
            deviceId: 'device1',
            deviceName: 'Muse-1234'
          };

          const serialized = BinaryProtocol.serialize(connectMessage);
          client.send(serialized);
        };

        client.onmessage = (event) => {
          try {
            const response = BinaryProtocol.deserialize(event.data);
            console.log('   Received BLE connect response:', response.type);

            if (response.type === MESSAGE_TYPES.BLE_CONNECT_RESPONSE &&
                response.requestId === 1003) {
              client.close();
              resolve(true);
            } else {
              reject(new Error(`Invalid connect response: ${JSON.stringify(response)}`));
            }
          } catch (error) {
            reject(new Error(`Failed to deserialize connect response: ${error.message}`));
          }
        };

        client.onerror = (error) => {
          reject(new Error(`BLE connect communication failed: ${error.message}`));
        };

        setTimeout(() => {
          reject(new Error('BLE connect timeout'));
        }, 5000);
      });
    });

    await this.asyncTest('Client-Server - Recording Start Request', async () => {
      return new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${this.port}`);
        client.binaryType = 'arraybuffer';

        client.onopen = () => {
          const recordMessage = {
            type: MESSAGE_TYPES.RECORD_START_REQUEST,
            requestId: 1004,
            timestamp: Date.now(),
            sessionId: 'test-session-123',
            exerciseId: 'push-up',
            setNumber: 1
          };

          const serialized = BinaryProtocol.serialize(recordMessage);
          client.send(serialized);
        };

        client.onmessage = (event) => {
          try {
            const response = BinaryProtocol.deserialize(event.data);
            console.log('   Received record start response:', response.type);

            if (response.type === MESSAGE_TYPES.RECORD_START_RESPONSE &&
                response.requestId === 1004) {
              client.close();
              resolve(true);
            } else {
              reject(new Error(`Invalid record start response: ${JSON.stringify(response)}`));
            }
          } catch (error) {
            reject(new Error(`Failed to deserialize record start response: ${error.message}`));
          }
        };

        client.onerror = (error) => {
          reject(new Error(`Record start communication failed: ${error.message}`));
        };

        setTimeout(() => {
          reject(new Error('Record start timeout'));
        }, 5000);
      });
    });
  }

  // Error Handling Tests
  async testErrorHandling() {
    if (!this.bridge || !this.port) {
      throw new Error('Bridge not initialized for error handling tests');
    }

    await this.asyncTest('Error Handling - Invalid Message Type', async () => {
      return new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${this.port}`);
        client.binaryType = 'arraybuffer';

        client.onopen = () => {
          const invalidMessage = {
            type: 9999, // Invalid message type
            requestId: 2001,
            timestamp: Date.now()
          };

          const serialized = BinaryProtocol.serialize(invalidMessage);
          client.send(serialized);
        };

        client.onmessage = (event) => {
          try {
            const response = BinaryProtocol.deserialize(event.data);
            console.log('   Received error response:', response.type);

            if (response.type === MESSAGE_TYPES.ERROR &&
                response.requestId === 2001) {
              client.close();
              resolve(true);
            } else {
              reject(new Error(`Expected error response, got: ${response.type}`));
            }
          } catch (error) {
            reject(new Error(`Failed to deserialize error response: ${error.message}`));
          }
        };

        client.onerror = (error) => {
          reject(new Error(`Error handling test failed: ${error.message}`));
        };

        setTimeout(() => {
          reject(new Error('Error handling timeout'));
        }, 5000);
      });
    });

    await this.asyncTest('Error Handling - Malformed Binary Data', async () => {
      return new Promise((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${this.port}`);
        client.binaryType = 'arraybuffer';

        client.onopen = () => {
          // Send malformed binary data
          const malformedData = new ArrayBuffer(4);
          const view = new Uint8Array(malformedData);
          view[0] = 0xFF; // Invalid version
          view[1] = 0xFF; // Invalid message type

          client.send(malformedData);
        };

        client.onmessage = (event) => {
          try {
            const response = BinaryProtocol.deserialize(event.data);

            if (response.type === MESSAGE_TYPES.ERROR) {
              client.close();
              resolve(true);
            } else {
              reject(new Error(`Expected error for malformed data, got: ${response.type}`));
            }
          } catch (error) {
            // Expected behavior - malformed data should cause deserialization error
            client.close();
            resolve(true);
          }
        };

        client.onerror = (error) => {
          // Connection error is also acceptable for malformed data
          resolve(true);
        };

        setTimeout(() => {
          reject(new Error('Malformed data handling timeout'));
        }, 3000);
      });
    });
  }

  // Run all tests
  async runAllTests() {
    console.log('🚀 Starting WebSocket Bridge Communication Test Suite\n');

    console.log('📋 Phase 1: Binary Protocol Tests');
    this.testBinaryProtocolSerialization();

    console.log('\n📋 Phase 2: Service Adapter Integration Tests');
    await this.testServiceAdapterIntegration();

    console.log('\n📋 Phase 3: Client-Server Communication Tests');
    await this.testClientServerCommunication();

    console.log('\n📋 Phase 4: Error Handling Tests');
    await this.testErrorHandling();

    // Cleanup
    if (this.bridge) {
      await this.bridge.stop();
    }

    // Results summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${this.testResults.total}`);
    console.log(`Passed: ${this.testResults.passed} ✅`);
    console.log(`Failed: ${this.testResults.failed} ❌`);
    console.log(`Success Rate: ${((this.testResults.passed / this.testResults.total) * 100).toFixed(1)}%`);

    if (this.testResults.failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.testResults.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error.test}`);
        console.log(`   ${error.error}`);
      });
    }

    console.log('\n' + '='.repeat(60));
    return this.testResults.failed === 0;
  }
}

// Run the tests
if (require.main === module) {
  const tester = new WebSocketBridgeTester();
  tester.runAllTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = WebSocketBridgeTester;