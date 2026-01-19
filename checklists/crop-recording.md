---
id: crop-recording
tags: [recording, ui, modal, convex, schema]
related_files: [
  electron/renderer/src/components/SaveModal.tsx,
  electron/renderer/src/components/CropModal.tsx,
  convex/schema.ts,
  convex/recordingSessions.ts,
  electron/renderer/src/lib/recording/UploadService.ts,
  electron/renderer/src/hooks/useRecordingUpload.ts,
  electron/renderer/src/hooks/useRecordingSession.ts,
  convex/lib/metrics/compute.ts,
  convex/recordingMetrics.ts
]
status: complete
last_sync: 2025-01-18
---

# Crop Recording Feature

## Schema & Backend
- [x] Add croppedRange to convex/schema.ts
- [x] Update createSession mutation in recordingSessions.ts
- [x] Update updateSession mutation in recordingSessions.ts

## CropModal Component
- [x] Create CropModal.tsx with embedded mode support
- [x] Implement CropChart (larger SVG preview with crop overlay)
- [x] Implement dual-range slider (min 1 second)
- [x] Add time display labels (start, end, duration)
- [x] Add Reset/Apply buttons

## SaveModal Integration
- [x] Add cropRange state and isCropModalOpen state
- [x] Update MiniRecordingChart with hover crop button
- [x] Add crop overlay visualization to MiniRecordingChart
- [x] Render CropModal side-by-side (right side)
- [x] Pass croppedRange to upload options
- [x] Update onPointerDownOutside handler

## Edit Mode Support
- [x] Load existing croppedRange from session data
- [x] Allow crop modification in edit mode (data only, no visual preview)

## Default Cropped Data (v2)
- [x] Add `includeFullData` flag to useRecordingSession.loadSession
- [x] Add `CroppedRange` type and export from useRecordingSession
- [x] Add `isCropped`, `fullDurationMs` to SessionMetadata
- [x] Apply sample-level crop filtering after decompression (default: on)
- [x] Filter samples by timestamp within croppedRange bounds
- [x] Adjust metadata (totalSampleCount, durationMs) to reflect cropped data

## Backend Metrics Cropping
- [x] Add CroppedRange type to convex/lib/metrics/compute.ts
- [x] Update extractAnglesFromChunks to accept optional croppedRange
- [x] Update computeAllMetrics to pass croppedRange to extractAnglesFromChunks
- [x] Update recordingMetrics.ts computeMetricsInternal to use session croppedRange
- [x] Update recordingMetrics.ts recalculatePhaseMetricsInternal to use crop filtering
- [x] Fix TypeScript errors (add Doc<"recordingChunks"> type annotations)
- [x] Fix croppedRange not passed through useRecordingUpload to UploadService
