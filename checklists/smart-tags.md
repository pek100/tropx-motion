---
id: smart-tags
tags: [ui, database, convex, tags, save-modal]
related_files: [convex/schema.ts, convex/tags.ts, electron/renderer/src/components/SaveModal.tsx, electron/renderer/src/components/TagsInput.tsx]
status: complete
last_sync: 2024-12-16
---

# Smart Tags System

## Schema
- [x] Add `userTags` table to schema
- [x] Remove `exerciseType` from recordings table
- [ ] Run convex deploy to sync

## Backend (convex/tags.ts)
- [x] `getUserTags` - get user's tags sorted by lastUsedAt
- [x] `searchUserTags` - filter tags by prefix for autocomplete
- [x] `syncUserTags` - upsert tags when recording saved

## Frontend Components
- [x] Create `TagsInput.tsx` component
  - [x] Text input with controlled state
  - [x] Chips display for added tags (with X remove)
  - [x] Autocomplete dropdown (keyboard nav)
  - [x] Recent tags section (clickable chips)
  - [x] Enter/comma to add, Backspace to remove last

## SaveModal Refactor
- [x] Remove exerciseType field and state
- [x] Replace tags input with TagsInput component
- [x] Move notes to bottom as textarea
- [x] Update save/edit handlers to track tag usage
- [x] Reorder layout: info → tags → notes → history

## Integration
- [x] Wire TagsInput to getUserTags query
- [x] Call syncUserTags on successful save
- [ ] Test full flow

## Cleanup
- [x] Remove exerciseType from convex/recordings.ts
- [x] Remove exerciseType from useRecordingUpload.ts
- [x] Remove exerciseType from useRecordingSession.ts
- [x] Remove exerciseType from UploadService.ts
- [x] Remove exerciseType from LoadModal.tsx
