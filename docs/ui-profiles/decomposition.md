---
id: ui-profiles
tags: [ui, layout, responsive, profiles, react-context]
related_files:
  - electron/renderer/src/lib/ui-profiles/types.ts
  - electron/renderer/src/lib/ui-profiles/profiles.ts
  - electron/renderer/src/lib/ui-profiles/matchers.ts
  - electron/renderer/src/lib/ui-profiles/persistence.ts
  - electron/renderer/src/lib/ui-profiles/UIProfileContext.tsx
  - electron/renderer/src/components/ProfileSelector.tsx
checklist: /checklists/ui-profiles.md
doc: /docs/ui-profiles/README.md
status: in-progress
last_sync: 2025-12-06
---

# UI Profile System - Decomposition

```
Feature: UI Profile System

UI Profile System
├── Types & Interfaces
│   ├── ProfileId type definition ✓ atomic
│   ├── UIProfile interface (all token categories) ✓ atomic
│   └── ProfileMatcher interface ✓ atomic
│
├── Profile Definitions
│   ├── DESKTOP profile object ✓ atomic
│   ├── COMPACT profile object ✓ atomic
│   ├── KIOSK profile object ✓ atomic
│   └── TABLET profile object ✓ atomic
│
├── Profile Resolution
│   ├── Matchers Configuration
│   │   └── PROFILE_MATCHERS array with priorities ✓ atomic
│   │
│   ├── Detection Logic
│   │   ├── getPlatformInfo() - fetch from main process ✓ atomic
│   │   ├── getWindowDimensions() - current viewport size ✓ atomic
│   │   ├── evaluateMatcher(matcher, context) - check single matcher ✓ atomic
│   │   └── resolveProfile(context) - find highest priority match ✓ atomic
│   │
│   └── Override Logic
│       ├── getStoredOverride() - read from persistence ✓ atomic
│       ├── setStoredOverride(profileId | null) - write to persistence ✓ atomic
│       └── clearOverride() - reset to auto-detect ✓ atomic
│
├── React Integration
│   ├── Context
│   │   ├── UIProfileContext creation ✓ atomic
│   │   ├── UIProfileProvider component ✓ atomic
│   │   └── useUIProfile() hook ✓ atomic
│   │
│   └── Effects
│       ├── Initial profile resolution on mount ✓ atomic
│       ├── Window resize listener ✓ atomic
│       └── Profile change event emission ✓ atomic
│
├── Profile Selector UI
│   ├── ProfileSelector component
│   │   ├── Modal container with backdrop ✓ atomic
│   │   ├── Profile radio button list ✓ atomic
│   │   ├── "Auto" option with detected label ✓ atomic
│   │   ├── Current selection indicator ✓ atomic
│   │   └── Close button / ESC handler ✓ atomic
│   │
│   └── Keyboard Integration
│       ├── Ctrl+Shift+R handler - open selector ✓ atomic
│       ├── Ctrl+Shift+A handler - reset to auto ✓ atomic
│       └── Arrow key navigation in selector ✓ atomic
│
├── Component Migration
│   ├── App.tsx
│   │   ├── Wrap with UIProfileProvider ✓ atomic
│   │   ├── Replace isSmallScreen state ✓ atomic
│   │   ├── Replace isRaspberryPi state ✓ atomic
│   │   ├── Update layout conditionals ✓ atomic
│   │   ├── Update header visibility ✓ atomic
│   │   ├── Update button styling ✓ atomic
│   │   └── Update DynamicIsland conditional ✓ atomic
│   │
│   ├── device-card.tsx
│   │   ├── Replace isSmallScreen prop ✓ atomic
│   │   ├── Update padding classes ✓ atomic
│   │   ├── Update icon sizes ✓ atomic
│   │   ├── Update text label visibility ✓ atomic
│   │   └── Update touch target sizes ✓ atomic
│   │
│   ├── chart-svg.tsx
│   │   └── Replace isRaspberryPi check ✓ atomic
│   │
│   └── platform-indicator.tsx
│       └── Update platform display logic ✓ atomic
│
└── Cleanup
    ├── Remove isSmallScreen from App.tsx ✓ atomic
    ├── Remove isRaspberryPi from App.tsx ✓ atomic
    ├── Remove smallScreenOverride from App.tsx ✓ atomic
    ├── Remove keyboard toggle (replaced by selector) ✓ atomic
    ├── Update persistence.ts exports ✓ atomic
    └── Remove isSmallScreen prop from DeviceCard interface ✓ atomic
```

## Atomic Units (49 total)

### TYPES & INTERFACES (3)
1. ProfileId type definition - (parent: Types & Interfaces)
2. UIProfile interface - (parent: Types & Interfaces)
3. ProfileMatcher interface - (parent: Types & Interfaces)

### PROFILE DEFINITIONS (4)
4. DESKTOP profile object - (parent: Profile Definitions)
5. COMPACT profile object - (parent: Profile Definitions)
6. KIOSK profile object - (parent: Profile Definitions)
7. TABLET profile object - (parent: Profile Definitions)

### MATCHERS (1)
8. PROFILE_MATCHERS array - (parent: Matchers Configuration)

### DETECTION LOGIC (4)
9. getPlatformInfo() - (parent: Detection Logic)
10. getWindowDimensions() - (parent: Detection Logic)
11. evaluateMatcher() - (parent: Detection Logic)
12. resolveProfile() - (parent: Detection Logic)

### OVERRIDE LOGIC (3)
13. getStoredOverride() - (parent: Override Logic)
14. setStoredOverride() - (parent: Override Logic)
15. clearOverride() - (parent: Override Logic)

### REACT CONTEXT (3)
16. UIProfileContext creation - (parent: Context)
17. UIProfileProvider component - (parent: Context)
18. useUIProfile() hook - (parent: Context)

### REACT EFFECTS (3)
19. Initial profile resolution - (parent: Effects)
20. Window resize listener - (parent: Effects)
21. Profile change event emission - (parent: Effects)

### PROFILE SELECTOR UI (5)
22. Modal container - (parent: ProfileSelector component)
23. Profile radio list - (parent: ProfileSelector component)
24. Auto option with label - (parent: ProfileSelector component)
25. Selection indicator - (parent: ProfileSelector component)
26. Close/ESC handler - (parent: ProfileSelector component)

### KEYBOARD (3)
27. Ctrl+Shift+R open handler - (parent: Keyboard Integration)
28. Ctrl+Shift+A reset handler - (parent: Keyboard Integration)
29. Arrow navigation - (parent: Keyboard Integration)

### APP.TSX MIGRATION (7)
30. Wrap with UIProfileProvider - (parent: App.tsx)
31. Replace isSmallScreen state - (parent: App.tsx)
32. Replace isRaspberryPi state - (parent: App.tsx)
33. Update layout conditionals - (parent: App.tsx)
34. Update header visibility - (parent: App.tsx)
35. Update button styling - (parent: App.tsx)
36. Update DynamicIsland conditional - (parent: App.tsx)

### DEVICE-CARD MIGRATION (5)
37. Replace isSmallScreen prop - (parent: device-card.tsx)
38. Update padding classes - (parent: device-card.tsx)
39. Update icon sizes - (parent: device-card.tsx)
40. Update text label visibility - (parent: device-card.tsx)
41. Update touch target sizes - (parent: device-card.tsx)

### OTHER COMPONENT MIGRATION (2)
42. chart-svg.tsx update - (parent: chart-svg.tsx)
43. platform-indicator.tsx update - (parent: platform-indicator.tsx)

### CLEANUP (6)
44. Remove isSmallScreen state - (parent: Cleanup)
45. Remove isRaspberryPi state - (parent: Cleanup)
46. Remove smallScreenOverride state - (parent: Cleanup)
47. Remove old keyboard toggle - (parent: Cleanup)
48. Update persistence.ts - (parent: Cleanup)
49. Remove isSmallScreen prop from DeviceCard - (parent: Cleanup)
