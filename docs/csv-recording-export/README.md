---
id: csv-recording-export
tags: [recording, export, csv, storage, ui]
related_files: []
checklist: /checklists/csv-recording-export.md
status: planned
last_sync: 2024-12-09
---

# CSV Recording Export Feature

## Overview

Export recorded angle data to CSV format with overflow protection.

## Requirements (from user discussion)

### 1. UI Trigger
- Save button in toolbar with dropdown arrow
- Click main button → default action (CSV export)
- Click arrow → dropdown with options (CSV, future options)

### 2. Storage
- Default path: `~/Documents/TropX/recordings/`
- Sonner toast after save with:
  - "Open" button (opens CSV file)
  - "Show in Folder" button
  - "Settings" button (opens path settings modal)
- Settings modal: change default path via folder picker

### 3. CSV Format
Single file with all joints:
```csv
timestamp,left-knee,right-knee
2024-12-09T14:30:45.123Z,45.3,32.1
```

Optional metadata header:
```csv
# TropX Motion Recording
# Date: 2024-12-09
# Duration: 120s
# Session: session_1234567890
```

### 4. Filename
Simple format: `recording_YYYY-MM-DD_HH-mm-ss.csv`

## Architecture

### Buffer Strategy (No Data Loss)
```
Recording starts
    ↓
RecordingBuffer (regular array, 60k samples = 10 min at 100Hz)
    ↓ on overflow (buffer.length >= MAX_BUFFER_SIZE)
Flush to localStorage → reset buffer
    ↓ on save
Combine: [localStorage chunks] + [current buffer] → CSV file
```

### Why This Approach
- **No circular buffer** = no data loss
- **localStorage overflow** = handles long recordings
- **Simple array** = O(1) push, no GC overhead
- **Crash safety** = overflow chunks persist in localStorage

### New Components Needed

1. **RecordingBuffer.ts** (motionProcessing/recording/)
   ```typescript
   class RecordingBuffer {
     private buffer: Array<{timestamp: number, leftKnee: number, rightKnee: number}> = [];
     private overflowChunks: string[] = []; // localStorage keys
     private readonly MAX_BUFFER_SIZE = 60000; // 10 min at 100Hz

     push(timestamp: number, leftKnee: number, rightKnee: number): void
     flushToStorage(): void
     exportToCSV(): string
     clear(): void
   }
   ```

2. **RecordingExporter.ts** (electron/main/services/)
   - `exportToCSV(data, outputPath)` - writes CSV file
   - `getDefaultExportPath()` - returns ~/Documents/TropX/recordings/
   - `ensureDirectoryExists(path)`
   - `openFile(path)` - shell.openPath()
   - `openFileLocation(path)` - shell.showItemInFolder()

3. **SaveDropdownButton.tsx** (renderer component)
   - Split button with dropdown arrow
   - Menu: CSV Export (default), JSON (future), Cloud Sync (future)

4. **StorageSettingsModal.tsx** (renderer component)
   - Current path display
   - Change Location button → folder picker
   - Reset to Default button

5. **IPC Handlers** (MainProcess.ts)
   - `recording:exportCSV`
   - `recording:getStoragePath`
   - `recording:setStoragePath`
   - `recording:openFile`
   - `recording:openFileLocation`
   - `dialog:selectFolder`

6. **useRecordingExport.ts** (hook)
   - `exportCSV()` - triggers export
   - `getStoragePath()` / `setStoragePath(path)`
   - Loading/error states

## Data Flow Analysis

### Current Flow (angle to UI) - KEEP
```
BLE → DeviceProcessor → JointProcessor → UIProcessor → WebSocket → UI
```

### Recording Flow - NEW (after cleanup)
```
JointProcessor.subscribe((angleData) => {
    // UI update (existing)
    uiProcessor.updateJointAngle(angleData);

    // Recording (NEW - simple buffer)
    if (isRecording) {
        recordingBuffer.push(angleData.timestamp, leftKnee, rightKnee);
    }
});
```

## Previous Issues (Removed)

### Old Architecture Problems
1. **CircularBuffer** - 10k sample limit, overwrote old data
2. **AsyncDataParser** - Complex batching, unnecessary for simple CSV
3. **ServerService** - Broken (no base URL), never worked
4. **ChunkingService** - Depended on broken ServerService
5. **recordingCache** - Write-only, never retrieved

### UI Throttle Issue
- `UIProcessor.broadcastJointAngleData()` had 10ms throttle
- Dropped data with `pendingBroadcast = true; return;`
- **Fixed:** Remove throttle, WebSocket already handles batching

## Implementation Notes

- Use `electron-store` for path persistence (already in package.json)
- Cross-platform paths via `os.homedir()` + `path.join()`
- Sonner toast already available in project
