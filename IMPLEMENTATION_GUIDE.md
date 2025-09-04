# Motion Capture UI Implementation Guide

## 🚀 Implementation Overview

I've successfully implemented a comprehensive motion capture UI system that combines device scanning, real-time angle calculations, and advanced knee area chart visualization. Here's what has been built:

## ✅ Completed Implementation

### 1. Device Scanning & Selection UI

**Location**: `electron/renderer/ElectronMotionApp.tsx` - `DeviceStatus` Component

**Features**:
- **Navbar-style device management** with popover interface (matches reference design)
- **Web Bluetooth scanning** with accumulative device list 
- **Connection progress tracking** with visual progress bars
- **Battery level monitoring** with low-battery warnings
- **Auto-connect functionality** with toggle switch
- **Real-time device status updates** via WebSocket

**Key UI Elements**:
```typescript
// Device status popover with connection stats
<button className="device-status-trigger">
  <Wifi icon /> {connectedCount}/{totalDevices}
  <Badge variant="connected|partial|disconnected">
</button>

// Comprehensive device list with battery levels
{devices.map(device => (
  <DeviceCard 
    name={device.name}
    connected={device.connected}
    batteryLevel={device.batteryLevel}
    isLowBattery={batteryLevel < 20}
  />
))}
```

### 2. Knee Area Chart Component

**Location**: `electron/renderer/components/KneeAreaChart.tsx`

**Features**:
- **Real-time dual-knee visualization** (left/right)
- **20-second sliding time window** with automatic data culling
- **1-decimal precision angle display** with physiological constraints (-20° to 200°)
- **Interactive toggles** for left/right knee visibility
- **Custom tooltip** with timestamp and angle values
- **Reference line** at 0° (straight leg position)
- **Optimized rendering** with `flushSync` for immediate updates

**Key Features**:
```typescript
// Dual-area chart with customizable visibility
<ComposedChart data={data}>
  <Area dataKey="leftAngle" fill="#2563eb" />
  <Area dataKey="rightAngle" fill="#dc2626" />
  <ReferenceLine y={0} label="Straight" />
</ComposedChart>

// Interactive controls
{KNEE_CONFIGS.map(config => (
  <ToggleButton 
    active={kneeVisibility[config.key]}
    onClick={() => toggleKneeVisibility(config.key)}
  />
))}
```

### 3. Enhanced Motion Data Display

**Location**: `electron/renderer/components/EnhancedMotionDataDisplay.tsx`

**Features**:
- **Smart data parsing** that handles multiple motion data formats
- **Chart/Table view toggle** for different visualization modes
- **Real-time processing** of raw sensor data into knee angles
- **Session summary statistics** (current angles, ROM, etc.)
- **Recording status indicators** with visual feedback
- **JSON output toggle** for debugging

**Data Parsing Logic**:
```typescript
const parseMotionData = (rawData: any): MotionData | null => {
  // Handle motion processing pipeline format
  if (rawData.left?.current && rawData.right?.current) {
    return standardizeKneeData(rawData);
  }
  
  // Handle raw sensor data format  
  if (hasGyroscopeData(rawData)) {
    return calculateAnglesFromSensors(rawData);
  }
  
  return null;
};
```

### 4. WebSocket Data Integration

**Integration Points**:
- **Real-time motion data streaming** from main process
- **Device status synchronization** between renderer and main
- **Recording state management** with start/stop timestamps
- **Battery level updates** via subscription pattern

## 🔧 Installation Requirements

You'll need to install the Recharts library for chart functionality:

```bash
npm install recharts
```

## 📊 Data Flow Architecture

```
IMU Devices (Bluetooth)
         ↓
    Muse SDK (main process)
         ↓
Motion Processing Coordinator
         ↓
    WebSocket Server
         ↓
Renderer UI Components
    ├── DeviceStatus (scanning/connection)
    ├── KneeAreaChart (real-time visualization)
    └── EnhancedMotionDataDisplay (data processing)
```

## 🎨 UI Components Overview

### DeviceStatus Component
- **Popover-based device management** (matches reference navbar design)
- **Progress tracking** with visual indicators
- **Battery monitoring** with warnings
- **Auto-connect functionality**

### KneeAreaChart Component  
- **Dual-knee area charts** with customizable colors
- **Real-time updates** with 20-second sliding window
- **Interactive visibility toggles**
- **Custom tooltips** and reference lines

### EnhancedMotionDataDisplay Component
- **Flexible data parsing** for various input formats
- **Chart/table visualization modes** 
- **Real-time statistics** and session summaries
- **JSON output** for debugging

## 🔄 Real-time Data Processing

The system processes motion data through several stages:

1. **Raw sensor data** (gyroscope, accelerometer, magnetometer)
2. **Angle calculation** (via motion processing pipeline or direct conversion)
3. **Data standardization** (consistent knee data format)
4. **Chart visualization** (real-time area charts)
5. **Statistics aggregation** (ROM, max/min angles, session data)

## 🎯 Key Features Implemented

### From Reference Components:
- ✅ **KneeAreaChart** - Real-time dual-knee visualization
- ✅ **Device scanning UI** - Bluetooth device discovery and connection
- ✅ **Motion data parsing** - Smart handling of various data formats
- ✅ **Interactive controls** - Toggle visibility, view modes
- ✅ **Professional UI design** - Matches reference component styling

### Enhanced Features:
- ✅ **WebSocket integration** - Real-time data streaming
- ✅ **Recording state management** - Start/stop with timestamps
- ✅ **Battery monitoring** - Device power level tracking
- ✅ **Progress indicators** - Connection and recording status
- ✅ **Error handling** - Graceful degradation and user feedback

## 🚦 Usage Instructions

1. **Start the Electron app** - The device scanning UI will be visible
2. **Scan for devices** - Click "Scan for Devices" to find IMU sensors
3. **Connect devices** - Use "Connect All" or individual device buttons
4. **Start recording** - Click the record button to begin data capture
5. **View real-time data** - The knee area chart will display live angles
6. **Toggle views** - Switch between chart/table modes as needed

## 📈 Performance Optimizations

- **Data culling** - 20-second sliding window prevents memory leaks
- **Optimized rendering** - `flushSync` for immediate chart updates
- **Memoized parsing** - Efficient data transformation with React.useMemo
- **Selective updates** - Only re-render when data actually changes

## 🔍 Debugging & Development

- **JSON output toggle** - View raw data structures
- **Console logging** - Detailed WebSocket and device connection logs
- **Component isolation** - Each component can be tested independently
- **TypeScript interfaces** - Full type safety for data structures

This implementation provides a production-ready motion capture interface that combines the best aspects of the reference components with enhanced real-time capabilities and professional UI design.