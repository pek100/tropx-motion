// PERFORMANCE_TEST.js - Test to isolate WebSocket vs Data Parsing bottlenecks

// Test 1: JSON Stringify/Parse Performance
console.log('=== JSON PERFORMANCE TEST ===');

// Simulate motion data structure from your code
const sampleMotionData = {
    type: 'motion_data',
    data: {
        deviceName: 'tropx_ln_sensor1',
        timestamp: Date.now(),
        quaternion: { w: 0.707, x: 0.707, y: 0, z: 0 }
    },
    timestamp: Date.now()
};

// Test JSON operations at high frequency
const iterations = 10000;
let startTime, endTime;

// Test JSON.stringify performance
startTime = performance.now();
for (let i = 0; i < iterations; i++) {
    JSON.stringify(sampleMotionData);
}
endTime = performance.now();
console.log(`JSON.stringify ${iterations} times: ${endTime - startTime}ms`);
console.log(`Average per stringify: ${(endTime - startTime) / iterations}ms`);

// Test JSON.parse performance
const jsonString = JSON.stringify(sampleMotionData);
startTime = performance.now();
for (let i = 0; i < iterations; i++) {
    JSON.parse(jsonString);
}
endTime = performance.now();
console.log(`JSON.parse ${iterations} times: ${endTime - startTime}ms`);
console.log(`Average per parse: ${(endTime - startTime) / iterations}ms`);

// Test 2: Data Parser Performance (simulate your MuseDataParser)
console.log('\n=== DATA PARSER PERFORMANCE TEST ===');

// Simulate raw BLE data packet (6 bytes quaternion + 8 byte header)
const samplePacket = new Uint8Array([
    0x02, 0x05, 0x08, 0x10, 0x00, 0x00, 0x10, 0x00, // Header
    0x7F, 0xFF, 0x7F, 0xFF, 0x00, 0x00              // Quaternion x,y,z as int16
]);

// Simulate your decodePacket function
function testDecodePacket(buffer, timestamp) {
    const data = {
        timestamp,
        gyr: { x: 0, y: 0, z: 0 },
        axl: { x: 0, y: 0, z: 0 },
        mag: { x: 0, y: 0, z: 0 },
        quaternion: { w: 1, x: 0, y: 0, z: 0 }
    };

    const dataView = new DataView(buffer.buffer, buffer.byteOffset + 8, buffer.length - 8);
    const scale = 1.0 / 32767.0;
    
    data.quaternion.x = dataView.getInt16(0, true) * scale;
    data.quaternion.y = dataView.getInt16(2, true) * scale;
    data.quaternion.z = dataView.getInt16(4, true) * scale;
    
    const sumSquares = 
        data.quaternion.x * data.quaternion.x +
        data.quaternion.y * data.quaternion.y +
        data.quaternion.z * data.quaternion.z;
    data.quaternion.w = Math.sqrt(Math.max(0, 1 - sumSquares));

    return data;
}

// Test data parsing performance
startTime = performance.now();
for (let i = 0; i < iterations; i++) {
    testDecodePacket(samplePacket, Date.now());
}
endTime = performance.now();
console.log(`Data parsing ${iterations} times: ${endTime - startTime}ms`);
console.log(`Average per parse: ${(endTime - startTime) / iterations}ms`);

// Test 3: Console Logging Impact
console.log('\n=== CONSOLE LOGGING PERFORMANCE TEST ===');

startTime = performance.now();
for (let i = 0; i < iterations; i++) {
    // Simulate your frequent console logs (commented out to not spam)
    // console.log(`🔍 Data received from device: device_${i}`);
}
endTime = performance.now();
console.log(`${iterations} console.log calls: ${endTime - startTime}ms`);

// Test with actual console.log (smaller sample)
const smallIterations = 1000;
startTime = performance.now();
for (let i = 0; i < smallIterations; i++) {
    console.log(`🔍 Test log ${i}`);
}
endTime = performance.now();
console.log(`${smallIterations} actual console.log calls: ${endTime - startTime}ms`);
console.log(`Average per console.log: ${(endTime - startTime) / smallIterations}ms`);

// Test 4: WebSocket Message Simulation
console.log('\n=== WEBSOCKET MESSAGE SIMULATION ===');

// Simulate WebSocket send operations (without actual network)
startTime = performance.now();
for (let i = 0; i < iterations; i++) {
    // Simulate the WebSocket message creation pipeline from your code
    const motionData = {
        left: { current: 45.5, max: 90, min: 0, rom: 90 },
        right: { current: 23.2, max: 80, min: -10, rom: 90 },
        timestamp: Date.now()
    };
    
    // This is what happens in your dataBatcher.addData()
    motionData.frameId = i;
    
    // This is what happens in broadcastMotionData()
    const message = {
        type: 'motion_data',
        data: motionData,
        timestamp: Date.now()
    };
    
    // This is the expensive JSON.stringify in broadcast()
    const jsonData = JSON.stringify(message);
    
    // Simulate send operation (no actual network)
    // ws.send(jsonData);
}
endTime = performance.now();
console.log(`Full WebSocket pipeline ${iterations} times: ${endTime - startTime}ms`);
console.log(`Average per message: ${(endTime - startTime) / iterations}ms`);

// Test 5: Memory allocation patterns
console.log('\n=== MEMORY ALLOCATION TEST ===');

// Test Map operations (like your batteryLevels, connectedDevices)
const testMap = new Map();
startTime = performance.now();
for (let i = 0; i < iterations; i++) {
    testMap.set(`device_${i}`, { batteryLevel: 75, connected: true });
}
endTime = performance.now();
console.log(`Map.set ${iterations} times: ${endTime - startTime}ms`);

// Test Map.get operations
startTime = performance.now();
for (let i = 0; i < iterations; i++) {
    testMap.get(`device_${i}`);
}
endTime = performance.now();
console.log(`Map.get ${iterations} times: ${endTime - startTime}ms`);

console.log('\n=== TEST COMPLETE ===');
console.log('Run this in browser console to test your environment');