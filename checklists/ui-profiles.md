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
  - electron/renderer/src/components/device-card.tsx
  - electron/renderer/src/components/chart-svg.tsx
  - electron/renderer/src/App.tsx
checklist: /checklists/ui-profiles.md
doc: /docs/ui-profiles/README.md
status: complete
last_sync: 2025-12-06
---

# UI Profile System - Checklist

## Phase 1: Foundation
> Atoms 1-15 from decomposition.md

- [x] **1.1** Create `types.ts` with ProfileId, UIProfile, ProfileMatcher interfaces
- [x] **1.2** Create `profiles.ts` with DESKTOP profile (complete)
- [x] **1.3** Create `profiles.ts` with COMPACT profile (complete)
- [x] **1.4** Create `profiles.ts` with KIOSK profile (complete)
- [x] **1.5** Create `profiles.ts` with TABLET profile (complete)
- [x] **1.6** Create `matchers.ts` with PROFILE_MATCHERS array
- [x] **1.7** Create `matchers.ts` detection functions (getPlatformInfo, getWindowDimensions, evaluateMatcher, resolveProfile)
- [x] **1.8** Create `persistence.ts` with getStoredOverride, setStoredOverride, clearOverride

## Phase 2: React Integration
> Atoms 16-21 from decomposition.md

- [x] **2.1** Create UIProfileContext with createContext
- [x] **2.2** Implement UIProfileProvider component with state
- [x] **2.3** Implement useUIProfile() hook
- [x] **2.4** Add initial profile resolution on mount
- [x] **2.5** Add window resize listener effect
- [x] **2.6** Add profile change event emission
- [x] **2.7** Create index.ts with public exports

## Phase 3: Profile Selector UI
> Atoms 22-29 from decomposition.md

- [x] **3.1** Create ProfileSelector.tsx modal container with backdrop
- [x] **3.2** Implement profile radio button list
- [x] **3.3** Implement "Auto" option with detected profile label
- [x] **3.4** Add current selection indicator styling
- [x] **3.5** Add close button and ESC handler
- [x] **3.6** Wire Ctrl+Shift+R to open selector (in App.tsx)
- [x] **3.7** Wire Ctrl+Shift+A to reset to auto (in App.tsx)
- [x] **3.8** Add arrow key navigation in selector

## Phase 4: Component Migration
> Atoms 30-43 from decomposition.md

### App.tsx
- [x] **4.1** Wrap root with UIProfileProvider
- [x] **4.2** Replace isSmallScreen state with useUIProfile
- [x] **4.3** Replace isRaspberryPi state with profile.features
- [x] **4.4** Update layout conditionals (split vs centered)
- [x] **4.5** Update header visibility logic
- [x] **4.6** Update all button styling to use profile.spacing
- [x] **4.7** Update DynamicIsland conditional to profile.features.dynamicIsland

### device-card.tsx
- [x] **4.8** Remove isSmallScreen prop, add useUIProfile hook
- [x] **4.9** Update padding classes to profile.spacing
- [x] **4.10** Update icon sizes to profile.sizing.iconSize
- [x] **4.11** Update text label visibility to profile.features.textLabels
- [x] **4.12** Update touch target sizes to profile.sizing.touchTarget

### Other Components
- [x] **4.13** chart-svg.tsx: Replace isRaspberryPi with profile check
- [x] **4.14** platform-indicator.tsx: Uses isRaspberryPi for display (intentional - shows platform info)

## Phase 5: Cleanup
> Atoms 44-49 from decomposition.md

- [x] **5.1** Remove isSmallScreen state from App.tsx
- [x] **5.2** Remove isRaspberryPi state from App.tsx
- [x] **5.3** Remove smallScreenOverride state from App.tsx
- [x] **5.4** Remove old keyboard toggle logic (now in selector)
- [x] **5.5** Profile persistence uses new storage key
- [x] **5.6** Remove isSmallScreen prop from DeviceCardProps interface
- [x] **5.7** Grep codebase - only platform-indicator.tsx (display) and lib/ui-profiles/* (system) have references

## Verification

- [ ] Desktop profile matches current desktop behavior
- [ ] Kiosk profile works on Raspberry Pi
- [ ] Compact profile works in small window
- [ ] Profile persists across page refresh
- [ ] Auto-detect works correctly
- [ ] Ctrl+Shift+R opens selector
- [ ] Ctrl+Shift+A resets to auto
