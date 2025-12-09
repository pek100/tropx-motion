---
id: csv-recording-export
tags: [recording, export, csv, storage, ui, ipc]
related_files: []
checklist: /checklists/csv-recording-export.md
status: planning
last_sync: 2024-12-09
---

# CSV Recording Export - Decomposition

## Feature Tree

```
CSV Recording Export
├── RecordingBuffer (main process)
│   ├── push(timestamp, leftKnee, rightKnee) ✓ atomic
│   ├── flushToStorage() ✓ atomic
│   ├── exportToCSV() ✓ atomic
│   ├── clear() ✓ atomic
│   └── getStats() ✓ atomic
│
├── RecordingExporter (main process)
│   ├── writeCSVFile(data, path) ✓ atomic
│   ├── getDefaultExportPath() ✓ atomic
│   ├── ensureDirectoryExists(path) ✓ atomic
│   ├── generateFilename() ✓ atomic
│   ├── openFile(path) ✓ atomic
│   └── openFileLocation(path) ✓ atomic
│
├── StorageSettings (main process)
│   ├── getExportPath() ✓ atomic
│   ├── setExportPath(path) ✓ atomic
│   └── resetToDefault() ✓ atomic
│
├── IPC Handlers (main process)
│   ├── recording:export ✓ atomic
│   ├── recording:getPath ✓ atomic
│   ├── recording:setPath ✓ atomic
│   ├── recording:openFile ✓ atomic
│   ├── recording:openFolder ✓ atomic
│   └── dialog:selectFolder ✓ atomic
│
├── Preload API
│   └── expose recording methods to renderer ✓ atomic
│
├── Integration (main process)
│   └── wire RecordingBuffer into MotionProcessingCoordinator ✓ atomic
│
├── SaveDropdownButton (renderer)
│   ├── main button click → export CSV ✓ atomic
│   ├── arrow click → open dropdown ✓ atomic
│   └── dropdown menu rendering ✓ atomic
│
├── StorageSettingsModal (renderer)
│   ├── display current path ✓ atomic
│   ├── change path button → folder picker ✓ atomic
│   └── reset to default button ✓ atomic
│
├── Export Toast (renderer)
│   ├── success toast with actions ✓ atomic
│   ├── Open button handler ✓ atomic
│   ├── Show in Folder button handler ✓ atomic
│   └── Settings button handler ✓ atomic
│
└── ActionBar Integration (renderer)
    └── replace Save button with SaveDropdownButton ✓ atomic
```

## Atomic Units

### Main Process (8 units)

1. **RecordingBuffer.push** - Add angle data to buffer array
   - Input: timestamp, leftKnee, rightKnee
   - Output: void (triggers overflow check)

2. **RecordingBuffer.flushToStorage** - Save buffer to localStorage on overflow
   - Input: none
   - Output: void (clears buffer, stores chunk key)

3. **RecordingBuffer.exportToCSV** - Combine chunks + buffer into CSV string
   - Input: none
   - Output: CSV string with metadata header

4. **RecordingBuffer.clear** - Reset buffer and clear localStorage chunks
   - Input: none
   - Output: void

5. **RecordingExporter.writeCSVFile** - Write CSV string to file
   - Input: csvContent, filePath
   - Output: Promise<{success, path, error?}>

6. **RecordingExporter.openFile** - Open file with system default app
   - Input: filePath
   - Output: Promise<void>

7. **RecordingExporter.openFileLocation** - Open folder with file selected
   - Input: filePath
   - Output: Promise<void>

8. **StorageSettings** - electron-store wrapper for export path
   - get/set/reset export path

### IPC Layer (6 units)

9. **IPC: recording:export** - Export current recording to CSV
10. **IPC: recording:getPath** - Get current export path
11. **IPC: recording:setPath** - Set new export path
12. **IPC: recording:openFile** - Open exported file
13. **IPC: recording:openFolder** - Show file in folder
14. **IPC: dialog:selectFolder** - Open folder picker dialog

### Preload (1 unit)

15. **Preload API** - Expose IPC methods to renderer

### Renderer Components (4 units)

16. **SaveDropdownButton** - Split button with dropdown
17. **StorageSettingsModal** - Path configuration modal
18. **ExportToast** - Success toast with action buttons
19. **ActionBar integration** - Wire up SaveDropdownButton

### Integration (1 unit)

20. **Coordinator integration** - Wire RecordingBuffer into data flow

## Implementation Order

1. **Core** (main process foundation)
   - RecordingBuffer
   - RecordingExporter
   - StorageSettings

2. **IPC** (bridge)
   - IPC handlers in MainProcess.ts
   - Preload API

3. **UI** (renderer)
   - SaveDropdownButton
   - StorageSettingsModal
   - ExportToast
   - ActionBar integration

4. **Integration**
   - Wire RecordingBuffer into MotionProcessingCoordinator
   - Test end-to-end flow

## Data Structures

### RecordingBuffer internal
```typescript
interface RecordingSample {
  t: number;  // timestamp (ms)
  l: number;  // left knee angle
  r: number;  // right knee angle
}

class RecordingBuffer {
  private buffer: RecordingSample[] = [];
  private overflowChunks: string[] = []; // localStorage keys
  private readonly MAX_SIZE = 60000; // 10 min at 100Hz
  private recordingStartTime: number | null = null;
}
```

### CSV Output Format
```csv
# TropX Motion Recording
# Date: 2024-12-09T14:30:45.123Z
# Duration: 120.5s
# Samples: 12050
timestamp,left-knee,right-knee
1702134645123,45.3,32.1
1702134645133,45.4,32.2
...
```

### IPC Response
```typescript
interface ExportResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}
```
