---
id: tag-filter
tags: [dashboard, ui, filtering, charts]
related_files: [
  electron/renderer/src/components/dashboard/DashboardView.tsx,
  electron/renderer/src/components/dashboard/ChartPane.tsx,
  electron/renderer/src/components/dashboard/SessionCard.tsx,
  electron/renderer/src/components/dashboard/SessionsCarousel.tsx,
  electron/renderer/src/components/dashboard/TagFilterBar.tsx
]
checklist: /checklists/tag-filter.md
doc: /docs/tag-filter/README.md
status: complete
last_sync: 2025-01-18
---

# Tag-Based Filtering for OPI Trends Chart

## Overview

Add tag-based filtering to the dashboard that:
- Filters OPI Trends Chart datapoints by session tags
- Highlights matching sessions in the carousel (without hiding non-matching)
- Provides URL-like filter bar with searchable tag dropdown

## Behavior

| Component | Filter Active | Filter Inactive |
|-----------|---------------|-----------------|
| OPI Trends Chart | Shows only matching sessions | Shows all sessions |
| Session Carousel | All visible, matching highlighted | All visible, no highlights |
| TagFilterBar | Shows active tags with marquee | Empty state |

### Auto-Filter Mode (Default: ON)
- Selecting a session automatically sets filter to that session's tags
- Can be toggled off via settings icon in filter bar

### Filter Logic
- **AND logic**: Session must contain ALL selected tags to match
- Empty filter = show all (no filtering)

## UI Components

### TagFilterBar
```
┌─────────────────────────────────────────────────────────┐
│ 🔍  [Squat ×] [Day 1 ×] ←←← marquee ←←←           ⚙️  │
└─────────────────────────────────────────────────────────┘
     ↑                    ↑                            ↑
  Filter icon         Tag chips                   Settings
  (auto-filter       (removable,                  (toggle
   indicator)         scrolling)                   auto-filter)
```

### Session Card Highlight
When `isMatchingFilter = true`:
- Subtle background tint: `bg-[var(--tropx-vibrant)]/5`
- Filter badge icon in top-left corner

## File Structure

| File | Purpose |
|------|---------|
| `TagFilterBar.tsx` | NEW - Filter bar component |
| `DashboardView.tsx` | State management, filtering logic |
| `ChartPane.tsx` | Renders TagFilterBar, passes filtered data |
| `SessionCard.tsx` | Highlight styling for matching cards |
| `SessionsCarousel.tsx` | Passes matching state to cards |

## Data Flow

```
DashboardView
├── sessions[] (all)
├── filterTags[] (active filters)
├── isAutoFilterEnabled (boolean)
│
├── Computed:
│   ├── allTags[] ← unique tags from sessions
│   ├── chartFilteredSessions[] ← sessions matching ALL filterTags
│   └── matchingSessionIds (Set) ← IDs of matching sessions
│
├── → ChartPane
│   ├── sessions = chartFilteredSessions (filtered)
│   ├── filterTags, onFilterTagsChange
│   ├── isAutoFilterEnabled, onAutoFilterChange
│   └── allTags
│
└── → SessionsCarousel
    ├── sessions = sessions (all, unfiltered)
    └── matchingSessionIds (for highlighting)
```

## Edge Cases

1. **Selected session has no tags**: Clear filter (don't filter by empty)
2. **All sessions filtered out**: Show "No sessions match filters" in chart
3. **Tag overflow**: Marquee scrolls horizontally
4. **Dropdown empty search**: Show all available tags
