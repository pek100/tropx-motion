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

# Recording Management Enhancement

## Overview

Comprehensive recording management system with:
- LoadModal: Browse, search, filter, and load recordings
- RecordingModal: Save new recordings or edit existing ones
- Notifications: Subject notes with email notifications
- Audit trail: Git-like diff tracking for modifications

## Features

### 1. LoadModal
- Server-side search across tags, exercise types, notes, subject names
- Subject filter dropdown (All, Me, specific contacts)
- Infinite scroll pagination (newest first)
- Preview panel with metadata before loading
- Import CSV button

### 2. RecordingModal (Save/Edit)
- Dynamic mode: "Save" for new, "Edit & Save" for existing
- System tags (source:csv, source:app) - non-removable
- User tags - editable
- Modification history viewer with diffs
- Subject notes section (for subjects viewing their recordings)

### 3. Permissions
- Owner: Full edit access
- Subject: Read-only + can add notes
- Subject notes trigger notification to owner

### 4. Notifications
- In-app notifications table
- Email notifications (opt-out via user settings)
- First use case: Subject adds note → Owner notified

### 5. Audit Trail
- recordedAt: Original capture timestamp
- modifiedAt: Last edit timestamp
- modificationHistory: Git-like diffs per edit

## Schema Changes

### recordings table additions
```typescript
recordedAt: v.number(),
modifiedAt: v.optional(v.number()),
modificationHistory: v.optional(v.array(v.object({
  modifiedAt: v.number(),
  modifiedBy: v.id("users"),
  diffs: v.array(v.object({
    field: v.string(),
    old: v.any(),
    new: v.any(),
  })),
}))),
systemTags: v.optional(v.array(v.string())), // source:csv, source:app
subjectNotes: v.optional(v.array(v.object({
  userId: v.id("users"),
  note: v.string(),
  createdAt: v.number(),
}))),
```

### notifications table (new)
```typescript
notifications: defineTable({
  userId: v.id("users"),
  type: v.string(), // "subject_note", etc.
  title: v.string(),
  body: v.string(),
  data: v.optional(v.any()), // { sessionId, noteBy, etc. }
  read: v.boolean(),
  createdAt: v.number(),
})
```

### users table additions
```typescript
emailNotifications: v.optional(v.boolean()), // default true
```

## UI Components

### "Me" Styling (Consistent Across App)
- Background: `bg-violet-50`
- Border: `border-violet-200`
- Badge: `bg-violet-500 text-white` pill with "Me"
- Avatar ring: `ring-2 ring-violet-400`

Used in:
- PatientSearchModal (search results)
- LoadModal (subject filter, recording items)
- RecordingModal (subject display)

## File Structure

```
convex/
  schema.ts           - Schema updates
  recordings.ts       - Search, edit with diffs
  notifications.ts    - NEW: Notifications CRUD
  lib/email.ts        - NEW: Email utilities

electron/renderer/src/components/
  LoadModal.tsx           - NEW: Recording browser
  RecordingModal.tsx      - NEW: Save/Edit modal
  RecordingListItem.tsx   - NEW: List item
  RecordingPreview.tsx    - NEW: Preview panel
  NotificationBell.tsx    - NEW: Bell + dropdown
  PatientSearchModal.tsx  - Add "Me" option
  ActionModal.tsx         - Route updates
  ActionBar.tsx           - Dynamic label
```
