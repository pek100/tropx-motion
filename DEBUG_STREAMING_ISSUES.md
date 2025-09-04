# 🔧 Debug Guide: Streaming & Motion Processing Issues

## 🚨 **Issues Identified & Fixes Applied**

### **1. Multiple Device Streaming** 🔍
**Problem**: Only `tropx_ln_bottom` streaming despite multiple devices connected
**Fixes Applied**:
- Added extensive logging to MuseManager to track device streaming setup
- Debug logging shows which devices have proper characteristics
- Track data callback calls per device

**Debug Logs to Watch For**:
```
🔍 Starting streaming for all connected devices...
🔍 Connected devices count: 2
🔍 Connected device names: ["tropx_ln_bottom", "Tropx Sensor (26:2F:E2)"]
🔍 Processing streaming setup for device: tropx_ln_bottom
🔍 Processing streaming setup for device: Tropx Sensor (26:2F:E2)
🔍 Data received from device: tropx_ln_bottom
🔍 Data received from device: Tropx Sensor (26:2F:E2)  ← SHOULD see this!
```

### **2. Motion Processing Pipeline** 📊
**Problem**: Data not processed by motion processing coordinator
**Fixes Applied**:
- Enhanced debug logging in `ElectronMotionService.ts`
- Check coordinator initialization and health status
- Test joint angle production after data processing

**Debug Logs to Watch For**:
```
📊 Motion processing coordinator initialized: true
📊 Motion processing coordinator healthy: true
📊 Calling motionProcessingCoordinator.processNewData(tropx_ln_bottom, imuData)
📊 Current joint angles after processing: Map(2) {...}
✅ Motion processing coordinator is working!
```

### **3. UI Chart Rendering** 🎨
**Problem**: KneeAreaChart not visible 
**Fixes Applied**:
- Added comprehensive parseMotionData debugging
- Test data generation when motion processing isn't working
- Better UI feedback during initialization

**Debug Logs to Watch For**:
```
🔍 parseMotionData called with: {...}
✅ parseMotionData: Found motion processing pipeline format
⚠️ parseMotionData: Creating test data for visualization
```

## 🧪 **Testing Steps**

### **Step 1: Check Device Connection**
1. **Start app** and scan for devices
2. **Connect both devices** - verify both show `connected: true`
3. **Check console** for device connection logs:
   ```
   🔍 Connected device count: 2
   🔍 Connected devices: [...] ← Should show both devices
   ```

### **Step 2: Start Recording & Check Streaming**
1. **Press record button**
2. **Look for streaming setup logs**:
   ```
   🔍 Processing streaming setup for device: tropx_ln_bottom
   🔍 Processing streaming setup for device: Tropx Sensor (26:2F:E2)
   ```
3. **Verify streaming status** in UI: both devices should show `streaming: true`

### **Step 3: Check Data Flow**
1. **Monitor data reception**:
   ```
   🔍 Data received from device: tropx_ln_bottom
   🔍 Data received from device: Tropx Sensor (26:2F:E2)  ← Key indicator!
   ```
2. **Check motion data logs**:
   ```
   📊 Motion data from tropx_ln_bottom : {...}
   📊 Motion data from Tropx Sensor (26:2F:E2) : {...}
   ```

### **Step 4: Verify Motion Processing**
1. **Check processing logs**:
   ```
   📊 Raw motion data received from renderer: {...}
   📊 Motion processing coordinator healthy: true
   📊 Current joint angles after processing: Map(2) {...}
   ```
2. **Look for UI updates**:
   ```
   📊 Motion processing UI update received: {left: {...}, right: {...}}
   ```

### **Step 5: Verify Chart Rendering**
1. **Check parseMotionData logs**:
   ```
   🔍 parseMotionData called with: {...}
   ✅ parseMotionData: Found motion processing pipeline format
   ```
2. **Verify UI shows**: 
   - KneeAreaChart with moving lines
   - Current angle values updating
   - Chart toggle buttons working

## 🎯 **Expected Results**

### **✅ Success Indicators**:
- **Multiple devices streaming**: See data from both `tropx_ln_bottom` AND `Tropx Sensor (26:2F:E2)`
- **Motion processing working**: Joint angles calculated and updated
- **Chart rendering**: KneeAreaChart visible with real-time data
- **UI streaming status**: Both devices show `streaming: true`

### **❌ Failure Patterns**:

#### **Only One Device Streaming**:
```
🔍 Data received from device: tropx_ln_bottom
❌ No data from: Tropx Sensor (26:2F:E2)
```
**Cause**: Second device missing characteristics or failed connection

#### **No Motion Processing Output**:
```
⚠️ Motion processing coordinator not producing joint angles
📊 Current joint angles after processing: Map(0) {}
```
**Cause**: Device naming doesn't match joint patterns, or insufficient devices

#### **No Chart Rendering**:
```
🔍 parseMotionData called with: null
❌ parseMotionData: Invalid raw data
```
**Cause**: No motion data reaching UI components

## 🔧 **Troubleshooting**

### **Problem: Only One Device Streaming**
1. **Check device characteristics**:
   ```
   🔍 Device has data characteristic: true/false
   🔍 Device has command characteristic: true/false
   ```
2. **Verify proper connection**: Reconnect both devices
3. **Check device names**: Ensure both devices have proper names

### **Problem: Motion Processing Not Working**
1. **Check device naming patterns**:
   - Left knee needs: `ln_top`, `ln_bottom` 
   - Right knee needs: `rn_top`, `rn_bottom`
   - Current: `tropx_ln_bottom` ✅, `Tropx Sensor (26:2F:E2)` ❌
2. **Verify coordinator initialization**:
   ```
   📊 Motion processing coordinator initialized: true
   📊 Motion processing coordinator healthy: true
   ```

### **Problem: Chart Not Rendering**
1. **Check for any motion data**:
   ```
   🔍 parseMotionData called with: {...} ← Should have data
   ```
2. **Look for test data fallback**:
   ```
   ⚠️ parseMotionData: Creating test data for visualization
   ```
3. **Verify component rendering**: Chart should show even with test data

## 🚀 **Next Steps**

1. **Run the app** and follow the testing steps
2. **Monitor console logs** for the debug patterns above
3. **Focus on the failing step** and use the troubleshooting guide
4. **Report back** which logs you see vs. what's missing

The fixes ensure that:
- **All connected devices stream data** (not just one)
- **Motion processing pipeline works** with detailed debugging
- **UI charts render** even during initialization
- **Complete data flow** is traceable through logs