---
id: recording-management-decomposition
tags: [decomposition, planning]
related_files: []
checklist: /checklists/recording-management.md
doc: /docs/recording-management/README.md
status: in-progress
last_sync: 2024-12-15
---

# Recording Management - Decomposition

## Tree Structure

```
Recording Management Enhancement
├── Schema Layer
│   ├── [1.1] recordings table updates ✓ atomic
│   │   - recordedAt, modifiedAt, modificationHistory, systemTags, subjectNotes
│   ├── [1.2] notifications table (new) ✓ atomic
│   │   - userId, type, title, body, data, read, createdAt
│   └── [1.3] users table update ✓ atomic
│       - emailNotifications setting
│
├── Backend Queries & Mutations
│   ├── [2.1] searchSessions query ✓ atomic
│   │   - server-side search, cursor pagination, subject filter
│   ├── [2.2] getDistinctSubjects query ✓ atomic
│   │   - unique subjects for filter dropdown
│   ├── [2.3] createChunk update ✓ atomic
│   │   - accept recordedAt, systemTags
│   ├── [3.1] updateSession with diff tracking ✓ atomic
│   │   - compute diffs, append to history
│   └── [3.2] addSubjectNote mutation ✓ atomic
│       - add note, trigger notification
│
├── Notifications Backend
│   ├── [4.1] Notifications CRUD ✓ atomic
│   │   - create, listForUser, markRead, markAllRead
│   ├── [4.2] Email template: subject note ✓ atomic
│   └── [4.3] Send notification email action ✓ atomic
│
├── PatientSearchModal Update
│   └── [5.1] "Me" option in search results ✓ atomic
│       - violet styling, badge, appears when searching
│
├── LoadModal Component
│   ├── [6.1] LoadModal shell with layout ✓ atomic
│   │   - header, two-column layout
│   ├── [6.2] Search bar + Import CSV button ✓ atomic
│   ├── [6.3] Subject filter dropdown ✓ atomic
│   ├── [6.4] Recording list with infinite scroll ✓ atomic
│   ├── [6.5] Recording list item component ✓ atomic
│   │   - date, exercise, duration, subject, tags
│   └── [6.6] Preview panel + load action ✓ atomic
│
├── RecordingModal (Save/Edit)
│   ├── [7.1] Refactor SaveModal → RecordingModal ✓ atomic
│   │   - mode prop: "save" | "edit"
│   ├── [7.2] Edit mode with pre-filled data ✓ atomic
│   ├── [7.3] System tags display (non-removable) ✓ atomic
│   ├── [7.4] Modification history viewer ✓ atomic
│   └── [7.5] Subject notes section ✓ atomic
│       - for subjects viewing their recordings
│
├── ActionBar Updates
│   ├── [8.1] Track currentRecording in App.tsx ✓ atomic
│   ├── [8.2] Dynamic "Save" / "Edit & Save" label ✓ atomic
│   └── [8.3] Wire up ActionModal routing ✓ atomic
│
└── Notifications UI
    ├── [9.1] Notification bell icon ✓ atomic
    ├── [9.2] Notification dropdown panel ✓ atomic
    └── [9.3] Mark as read functionality ✓ atomic
```

## Atomic Units Summary

| ID | Unit | Parent | Description |
|----|------|--------|-------------|
| 1.1 | recordings table updates | Schema Layer | Add recordedAt, modifiedAt, modificationHistory, systemTags, subjectNotes |
| 1.2 | notifications table | Schema Layer | New table for in-app notifications |
| 1.3 | users table update | Schema Layer | Add emailNotifications setting |
| 2.1 | searchSessions query | Backend Queries | Server-side search with pagination and filters |
| 2.2 | getDistinctSubjects query | Backend Queries | Get unique subjects for filter dropdown |
| 2.3 | createChunk update | Backend Queries | Accept recordedAt, systemTags params |
| 3.1 | updateSession with diffs | Backend Edit | Compute and store git-like diffs |
| 3.2 | addSubjectNote mutation | Backend Edit | Add note, create notification |
| 4.1 | Notifications CRUD | Notifications Backend | create, list, markRead operations |
| 4.2 | Email template | Notifications Backend | Subject note email template |
| 4.3 | Send email action | Notifications Backend | Convex action to send email |
| 5.1 | "Me" in PatientSearchModal | PatientSearchModal | Violet-styled "Me" option in search |
| 6.1 | LoadModal shell | LoadModal | Basic layout and structure |
| 6.2 | Search bar + Import | LoadModal | Search input and CSV import button |
| 6.3 | Subject filter dropdown | LoadModal | Filter by subject |
| 6.4 | Recording list | LoadModal | Infinite scroll list |
| 6.5 | Recording list item | LoadModal | Individual item component |
| 6.6 | Preview panel | LoadModal | Preview + load action |
| 7.1 | RecordingModal base | RecordingModal | Refactor SaveModal with mode support |
| 7.2 | Edit mode | RecordingModal | Pre-fill data for editing |
| 7.3 | System tags display | RecordingModal | Non-removable tags UI |
| 7.4 | History viewer | RecordingModal | Show modification diffs |
| 7.5 | Subject notes | RecordingModal | Notes section for subjects |
| 8.1 | Track currentRecording | App Integration | State in App.tsx |
| 8.2 | Dynamic ActionBar label | App Integration | Save vs Edit & Save |
| 8.3 | ActionModal routing | App Integration | Route to correct modal |
| 9.1 | Notification bell | Notifications UI | Bell icon component |
| 9.2 | Notification dropdown | Notifications UI | List of notifications |
| 9.3 | Mark as read | Notifications UI | Read status handling |

**Total: 27 atomic units across 9 phases**
