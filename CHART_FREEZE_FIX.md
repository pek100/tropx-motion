# Chart Freeze Bug Fix

## Problem Summary

The Recharts chart component would freeze and stop displaying the Area lines after:
1. Opening the test client modal
2. Closing the modal and stopping/restarting the stream

**Symptoms:**
- Chart container and axes remained visible
- Blue/red Area lines (knee angle data) disappeared
- Data continued flowing in the background (buffer kept filling)
- Chart state updates stopped happening

## Root Cause Analysis

### What We Initially Thought
The data pipeline was broken - WebSocket → React State → Chart props

### What Was Actually Happening
**The data pipeline was fine!** Comprehensive logging revealed:
- ✅ WebSocket continued receiving data
- ✅ React state updates continued
- ✅ Chart props continued updating
- ✅ Circular buffer continued filling
- ❌ **RAF (requestAnimationFrame) stopped being scheduled**

### The Actual Bug

**Location:** `electron/renderer/src/components/knee-area-chart.tsx`

The RAF scheduling code had a flag to prevent duplicate scheduling:

```typescript
if (!pendingUpdateRef.current) {
  pendingUpdateRef.current = true
  animationFrameRef.current = requestAnimationFrame(() => {
    pendingUpdateRef.current = false
    // Update chart...
  })
}
```

**The Problem:**
When the chart remounted (via changing the React `key` prop), the `pendingUpdateRef` was NOT reset. It stayed `true` from before the remount, causing ALL future RAF scheduling attempts to be skipped.

**Result:**
- Buffer kept accumulating data
- `setChartData()` was never called
- Chart showed empty data even though buffer was full
- Area lines disappeared

## The Solution

### Step 1: Add Comprehensive Logging
Added trace logging to every step of the data pipeline to identify where the flow broke.

**Files Modified:**
- `electron/renderer/src/hooks/use-websocket.ts` - WebSocket event logging
- `electron/renderer/src/components/knee-area-chart.tsx` - Chart data flow logging
- `electron/renderer/src/App.tsx` - State change logging
- `electron/renderer/src/components/DynamicIsland/ClientLauncher.tsx` - Modal lifecycle logging
- `electron/main/MainProcess.ts` - Set up electron-log to capture all console output

### Step 2: Add Chart Remount Mechanism
Added ability to force complete chart remount when it gets stuck:

```typescript
const [chartKey, setChartKey] = useState(0)

// In render:
<ComposedChart key={chartKey} data={chartData} ...>
```

When `chartKey` changes, React completely unmounts and remounts Recharts, resetting its internal state.

### Step 3: Auto-Remount on Modal Close
Detect when modal closes and automatically remount chart:

```typescript
useEffect(() => {
  if (prevModalOpenRef.current && !modalOpen) {
    trace('CHART', 'Modal closed, forcing chart remount to recover from freeze');
    setChartKey(prev => prev + 1)
  }
  prevModalOpenRef.current = modalOpen
}, [modalOpen])
```

### Step 4: **THE CRITICAL FIX** - Reset RAF State on Remount

```typescript
useEffect(() => {
  if (clearTrigger > 0) {
    // Cancel any pending RAF and reset RAF state
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = undefined
    }
    pendingUpdateRef.current = false // CRITICAL: Reset pending flag!

    dataBufferRef.current.clear()
    updateCounterRef.current = 0
    setChartData([])
    setChartKey(prev => prev + 1) // Force remount
  }
}, [clearTrigger])
```

**Why This Works:**
- Cancels any pending RAF from before the remount
- Resets `pendingUpdateRef` so new RAF can be scheduled
- Clears all state and forces complete chart remount
- Next data update successfully schedules RAF and updates chart

## Files Changed

1. **electron/renderer/src/components/knee-area-chart.tsx**
   - Added `chartKey` state for forced remounting
   - Added `modalOpen` prop to detect modal state
   - Added RAF state reset on remount (THE FIX)
   - Added auto-remount on modal close
   - Added comprehensive trace logging

2. **electron/renderer/src/App.tsx**
   - Pass `modalOpen` prop to KneeAreaChart
   - Added trace logging for state changes

3. **electron/renderer/src/hooks/use-websocket.ts**
   - Added comprehensive trace logging
   - Added health monitor logging

4. **electron/renderer/src/components/DynamicIsland/ClientLauncher.tsx**
   - Added modal lifecycle logging

5. **electron/main/MainProcess.ts**
   - Integrated electron-log for persistent logging
   - Set up console message capture from renderer

## How It Works Now

1. **Normal Streaming:** RAF schedules and executes normally
2. **Modal Opens:** Chart may freeze (Recharts rendering deprioritized)
3. **Modal Closes:** Auto-remount triggered with RAF state reset
4. **Stop/Restart Stream:** Clear trigger fires with RAF state reset
5. **RAF Can Schedule Again:** `pendingUpdateRef` is false, RAF schedules successfully
6. **Chart Data Updates:** `setChartData()` called, Area lines render

## Key Takeaway

**The bug wasn't about data flow or rendering performance.** It was a simple state management bug where a ref flag (`pendingUpdateRef`) wasn't reset during component remount, permanently blocking the RAF scheduling mechanism.

The extensive logging helped identify that data was flowing perfectly but the final step (RAF → setChartData) was being skipped.

## Testing

To verify the fix works:
1. Start streaming → Chart displays data
2. Open test client modal → Chart may freeze (expected)
3. Close modal → Chart auto-recovers
4. Stop streaming → Chart clears
5. **Start streaming again** → **Chart lines appear immediately! ✓**

## Log File Location

All trace logs are saved to:
- **Linux:** `~/.config/motion-capture-electron/logs/main.log`
- **Mac:** `~/Library/Logs/motion-capture-electron/main.log`
- **Windows:** `%USERPROFILE%\AppData\Roaming\motion-capture-electron\logs\main.log`

Look for `[TRACE:CHART]` lines to see RAF scheduling, execution, and data updates.
