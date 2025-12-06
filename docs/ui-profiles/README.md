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

# UI Profile System

Centralized UI profile system for adaptive layouts across desktop, tablet, and Raspberry Pi.

## Overview

Replaces scattered `isSmallScreen` and `isRaspberryPi` boolean checks with a token-driven profile system. Each profile is a complete, self-contained specification of layout, spacing, sizing, and feature toggles.

## Profiles

| Profile | Use Case | Key Characteristics |
|---------|----------|---------------------|
| `desktop` | Windows/Mac large screens | Full header, borders, text labels (DEFAULT) |
| `compact` | Small windows, testing | 50/50 split, icon-only buttons |
| `kiosk` | Raspberry Pi production | Fullscreen, touch-optimized, no header |
| `tablet` | iPad/medium screens | Balanced spacing, optional header |

## Auto-Detection

Profiles are auto-selected based on priority matchers:

| Priority | Profile | Condition |
|----------|---------|-----------|
| 100 | kiosk | isRaspberryPi: true |
| 50 | compact | maxWidth: 480px |
| 25 | tablet | maxWidth: 1024px, minWidth: 481px |
| 0 | desktop | (default fallback) |

## Manual Override

- **Ctrl+Shift+R**: Open profile selector modal
- **Ctrl+Shift+A**: Reset to auto-detect

Override is persisted to localStorage.

## Usage

```tsx
import { UIProfileProvider, useUIProfile } from '@/lib/ui-profiles';

// Wrap app
function App() {
  return (
    <UIProfileProvider>
      <MainContent />
    </UIProfileProvider>
  );
}

// Use in components
function MyButton() {
  const { profile } = useUIProfile();

  return (
    <button className={`${profile.spacing.buttonPx} ${profile.spacing.buttonPy}`}>
      {profile.features.textLabels && <span>Click Me</span>}
    </button>
  );
}
```

## Profile Token Structure

```typescript
interface UIProfile {
  id: ProfileId;
  label: string;

  layout: {
    mode: 'centered' | 'split';
    showHeader: boolean;
    showBorders: boolean;
    fullscreen: boolean;
  };

  spacing: {
    buttonPx: string;
    buttonPy: string;
    gap: string;
    cardPadding: string;
  };

  sizing: {
    iconSize: number;
    iconSizeLg: number;
    touchTarget: string;
    fontSize: string;
    fontSizeLg: string;
  };

  features: {
    textLabels: boolean;
    dynamicIsland: boolean;
    clientLauncher: boolean;
    animations: boolean;
  };
}
```

## File Structure

```
electron/renderer/src/lib/ui-profiles/
├── index.ts              # Public exports
├── types.ts              # ProfileId, UIProfile, ProfileMatcher
├── profiles.ts           # DESKTOP, COMPACT, KIOSK, TABLET
├── matchers.ts           # PROFILE_MATCHERS, resolveProfile()
├── persistence.ts        # Override storage
└── UIProfileContext.tsx  # Provider + hook

electron/renderer/src/components/
└── ProfileSelector.tsx   # Ctrl+Shift+R modal
```

## Migration from Legacy

Before:
```tsx
const isSmallScreen = ...;
<button className={isSmallScreen ? "px-5 py-3" : "px-4 py-2"}>
  {!isSmallScreen && "Label"}
</button>
```

After:
```tsx
const { profile } = useUIProfile();
<button className={`${profile.spacing.buttonPx} ${profile.spacing.buttonPy}`}>
  {profile.features.textLabels && "Label"}
</button>
```
