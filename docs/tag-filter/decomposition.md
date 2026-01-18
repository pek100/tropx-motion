---
id: tag-filter
tags: [dashboard, ui, filtering, charts]
related_files: [
  electron/renderer/src/components/dashboard/DashboardView.tsx,
  electron/renderer/src/components/dashboard/ChartPane.tsx,
  electron/renderer/src/components/dashboard/SessionCard.tsx,
  electron/renderer/src/components/dashboard/SessionsCarousel.tsx,
  electron/renderer/src/components/dashboard/ProgressChart.tsx
]
checklist: /checklists/tag-filter.md
doc: /docs/tag-filter/README.md
status: in-progress
last_sync: 2025-01-18
---

# Tag Filter Feature Decomposition

```
Feature: Tag-Based Filtering for OPI Trends

Tag-Based Filtering
├── State Management (DashboardView)
│   ├── filterTags state ✓ atomic
│   ├── isAutoFilterEnabled state ✓ atomic
│   ├── allTags computed (extract unique tags) ✓ atomic
│   ├── chartFilteredSessions computed (AND logic) ✓ atomic
│   ├── matchingSessionIds computed (Set for carousel) ✓ atomic
│   └── Auto-filter on selection
│       ├── Update handleSelectSession ✓ atomic
│       └── Clear filter when session has no tags ✓ atomic
│
├── TagFilterBar Component (NEW)
│   ├── Container Structure
│   │   ├── URL-like wrapper styling ✓ atomic
│   │   ├── Filter icon (left) with auto-filter indicator ✓ atomic
│   │   └── Settings toggle (right) ✓ atomic
│   │
│   ├── Tag Chips Display
│   │   ├── Chip rendering with × button ✓ atomic
│   │   ├── Marquee container (overflow detection) ✓ atomic
│   │   └── Marquee animation (CSS keyframes) ✓ atomic
│   │
│   └── Tag Dropdown (Searchable)
│       ├── Trigger on click/focus ✓ atomic
│       ├── Search input with filtering ✓ atomic
│       ├── Available tags list rendering ✓ atomic
│       └── Tag selection handler ✓ atomic
│
├── SessionCard Highlight
│   ├── isMatchingFilter prop ✓ atomic
│   ├── Background tint when matching ✓ atomic
│   └── Filter badge icon (top-left) ✓ atomic
│
├── SessionsCarousel Integration
│   └── Pass matchingSessionIds to cards ✓ atomic
│
└── ChartPane Integration
    ├── Add filter props to interface ✓ atomic
    ├── Render TagFilterBar in header ✓ atomic
    └── Pass filtered sessions to ProgressChart ✓ atomic
```

## Atomic Units (Flat List)

### State Management
1. **filterTags state** - useState for active filter tags array
2. **isAutoFilterEnabled state** - useState boolean, default true
3. **allTags computed** - useMemo extracting unique tags from all sessions
4. **chartFilteredSessions computed** - useMemo filtering sessions by AND logic
5. **matchingSessionIds computed** - useMemo creating Set of matching IDs
6. **handleSelectSession update** - Add auto-filter logic to existing handler
7. **clearFilterOnNoTags** - Clear filter when selected session has no tags

### TagFilterBar Component
8. **URL wrapper styling** - Container with border, rounded corners, flex layout
9. **Filter icon left** - Icon that indicates auto-filter state (filled/outline)
10. **Settings toggle right** - Button to toggle auto-filter mode
11. **Chip rendering** - Map tags to styled chips with × remove button
12. **Marquee container** - Overflow detection using ref + ResizeObserver
13. **Marquee animation** - CSS keyframes for continuous left-to-right scroll
14. **Dropdown trigger** - Open popover on click/focus of empty area
15. **Search input** - Controlled input filtering available tags
16. **Available tags list** - Render filtered tags as selectable items
17. **Tag selection handler** - Add/remove tag from filterTags

### SessionCard Highlight
18. **isMatchingFilter prop** - Add optional boolean prop to interface
19. **Background tint** - Conditional bg class when matching
20. **Filter badge** - Small icon in top-left corner when matching

### Integration
21. **SessionsCarousel matchingSessionIds** - Add prop and pass to cards
22. **ChartPane filter props** - Extend interface with filter-related props
23. **ChartPane TagFilterBar render** - Add component in header
24. **ChartPane filtered sessions** - Pass chartFilteredSessions to ProgressChart
