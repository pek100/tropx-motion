# Motion Processing Pipeline Debug Guide

## 🔧 **Issue Fixed**: Sensor Data Not Processed by Motion Processing Pipeline

### **Root Cause**
The WebSocket message handler in `ElectronMotionService.ts` was missing the `motion_data` case, so sensor data from the renderer wasn't being fed to the motion processing coordinator.

### **Changes Made**

#### 1. **Added Motion Data Handler** (`ElectronMotionService.ts:446-449`)
```typescript
case 'motion_data':
    // Process incoming motion data from renderer
    this.processMotionDataFromRenderer(parsed.data);
    break;
```

#### 2. **Implemented Data Processing Method** (`ElectronMotionService.ts:432-490`)
```typescript
private processMotionDataFromRenderer(data: any): void {
    // Convert renderer data → IMU format → Motion processing coordinator
    const imuData: IMUData = {
        timestamp: data.timestamp || Date.now(),
        gyroscope: data.gyroscope || { x: 0, y: 0, z: 0 },
        accelerometer: data.accelerometer || { x: 0, y: 0, z: 0 },
        magnetometer: data.magnetometer || { x: 0, y: 0, z: 0 }
    };

    motionProcessingCoordinator.processNewData(deviceName, imuData);
}
```

#### 3. **Enhanced UI Data Broadcasting** (`ElectronMotionService.ts:160-180`)
```typescript
motionProcessingCoordinator.subscribeToUI((data: any) => {
    // Always broadcast to UI (not just when recording)
    this.dataBatcher.addData(motionData);
    
    // Also broadcast immediately for real-time UI updates
    this.broadcastMotionData(motionData);
});
```

#### 4. **Added Extensive Debug Logging**
- Motion processing coordinator initialization verification
- Detailed data structure logging
- Health checks after processing
- Error stack traces

## 🧪 **Testing Steps**

### **1. Start the Application**
```bash
npm run dev
```

### **2. Monitor Console Logs**
Look for these initialization messages:
```
🔧 Motion processing coordinator init status: true
🔧 Motion processing coordinator health check: [boolean]
🔧 Motion processing coordinator recording status: {...}
✅ Motion processing coordinator ready and verified
📊 Motion processing callbacks setup complete
```

### **3. Connect Devices & Start Recording**
1. **Scan for devices** - Click "📡 Scan for Devices"
2. **Connect devices** - Click individual "Connect" buttons
3. **Start recording** - Click the red record button

### **4. Verify Data Flow**
Watch for these log patterns:

#### **A. Renderer Sending Data**
```
📊 Motion data from [deviceName] : {...}
```

#### **B. Main Process Receiving Data**
```
📊 Raw motion data received from renderer: {...}
📊 Processing motion data for device: [deviceName]
📊 Motion data details: {...}
📊 Converted IMU data: {...}
📊 Calling motionProcessingCoordinator.processNewData([deviceName], imuData)
✅ Motion data processed successfully by coordinator
```

#### **C. Motion Processing Output**
```
📊 Motion processing UI update received: {...}
```

#### **D. UI Updates**
```
📨 Received WebSocket message: motion_data {...}
```

## 🎯 **Expected Results**

### **1. Real-time Knee Angle Charts**
- **KneeAreaChart component** should show moving lines
- **Left/Right knee toggles** should work
- **Angles should update** in real-time (not just show 0°)

### **2. Enhanced Motion Data Display**
- **Chart view** should show live data
- **Current angles** should change dynamically
- **Session summary** should update with ROM values

### **3. Console Confirmation**
- **No error messages** about motion processing
- **Health checks return true** after processing data
- **Continuous data flow** during recording

## 🚨 **Troubleshooting**

### **If Still Not Working:**

#### **Check 1: Motion Processing Coordinator**
```typescript
// In browser console (renderer):
console.log('Motion processing coordinator status:', window.motionProcessingCoordinator?.getInitializationStatus());
```

#### **Check 2: WebSocket Connection**
```typescript
// Look for WebSocket connection messages
🔌 WebSocket connected to: ws://localhost:8080
📨 Received WebSocket message: status_update
```

#### **Check 3: Sensor Data Format**
Verify the sensor data structure in renderer logs:
```typescript
📊 Motion data from [device] : {
  timestamp: [number],
  gyroscope: { x: [number], y: [number], z: [number] },
  accelerometer: { x: [number], y: [number], z: [number] },
  // ... should have actual sensor values, not all zeros
}
```

#### **Check 4: IMU Data Processing**
In main process console:
```typescript
📊 Converted IMU data: {
  timestamp: [recent timestamp],
  gyroscope: { x: [non-zero], y: [non-zero], z: [non-zero] },
  // ... should have real sensor values
}
```

## 🔄 **Data Flow Verification**

```
1. IMU Sensors → Bluetooth → Renderer (MuseManager SDK)
   ↓ 📊 Motion data from [device]: {...}

2. Renderer → WebSocket → Main Process (ElectronMotionService)
   ↓ 📊 Raw motion data received from renderer: {...}

3. Main Process → Motion Processing Coordinator
   ↓ 📊 Calling motionProcessingCoordinator.processNewData(...)

4. Motion Processing → Knee Angle Calculation
   ↓ 📊 Motion processing UI update received: {...}

5. Processed Data → WebSocket → Renderer UI
   ↓ 📨 Received WebSocket message: motion_data

6. UI Components → Real-time Charts
   ↓ KneeAreaChart + EnhancedMotionDataDisplay updates
```

## ✅ **Success Indicators**

- **✅ Real-time angle values** in KneeAreaChart (not stuck at 0°)
- **✅ Moving chart lines** during device movement
- **✅ Updated ROM values** in session summary
- **✅ No console errors** about motion processing
- **✅ Health checks return true** after data flows

## 🚀 **Performance Notes**

- **Real-time updates** should appear within ~16ms (60fps)
- **Data batching** prevents UI flooding
- **20-second sliding window** keeps memory usage low
- **Automatic data culling** maintains smooth performance

This fix establishes the complete data pipeline from sensor input to real-time angle visualization!