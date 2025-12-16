---
id: recording-management
tags: [ui, convex, recordings, notifications, load, save, edit]
related_files:
  - convex/schema.ts
  - convex/recordings.ts
  - convex/notifications.ts
  - electron/renderer/src/components/LoadModal.tsx
  - electron/renderer/src/components/RecordingModal.tsx
  - electron/renderer/src/components/PatientSearchModal.tsx
  - electron/renderer/src/components/ActionModal.tsx
  - electron/renderer/src/components/ActionBar.tsx
checklist: /checklists/recording-management.md
doc: /docs/recording-management/README.md
status: in-progress
last_sync: 2024-12-15
---

# Recording Management - Checklist

## Phase 1: Schema & Foundation
- [x] 1.1 Update recordings table (recordedAt, modifiedAt, modificationHistory, systemTags, subjectNotes)
- [x] 1.2 Create notifications table
- [x] 1.3 Add emailNotifications to users table

## Phase 2: Backend - Search & Queries
- [x] 2.1 searchSessions query (paginated, server-side search, subject filter)
- [x] 2.2 getDistinctSubjects query
- [x] 2.3 Update createChunk for recordedAt, systemTags

## Phase 3: Backend - Edit & Audit
- [x] 3.1 Update updateSession with git-like diff tracking
- [x] 3.2 addSubjectNote mutation (+ trigger notification)

## Phase 4: Backend - Notifications
- [x] 4.1 Notifications CRUD (create, listForUser, markRead, markAllRead)
- [x] 4.2 Email template for subject note notification
- [x] 4.3 Send notification email action (placeholder - needs email provider)

## Phase 5: PatientSearchModal "Me" Option
- [x] 5.1 Add "Me" option in search results with violet styling

## Phase 6: LoadModal Component
- [x] 6.1 LoadModal shell with layout (header, two-column)
- [x] 6.2 Search bar + Import CSV button
- [x] 6.3 Subject filter dropdown
- [x] 6.4 Recording list with infinite scroll
- [x] 6.5 Recording list item component
- [x] 6.6 Preview panel + load action

## Phase 7: RecordingModal (Save/Edit)
- [x] 7.1 Refactor SaveModal → RecordingModal with mode support
- [x] 7.2 Edit mode with pre-filled data
- [x] 7.3 System tags display (non-removable styling)
- [x] 7.4 Modification history viewer
- [x] 7.5 Subject notes section (for subjects)

## Phase 8: App Integration
- [ ] 8.1 Track currentRecording & recordingSource in App.tsx
- [ ] 8.2 Dynamic ActionBar label (Save vs Edit & Save)
- [x] 8.3 Wire up ActionModal routing

## Phase 9: Notifications UI
- [ ] 9.1 Notification bell icon in header
- [ ] 9.2 Notification dropdown panel
- [ ] 9.3 Mark as read functionality
