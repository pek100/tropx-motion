---
id: device-preferences-checklist
tags: [auth, users, preferences, devices, notifications, ui]
related_files:
  - convex/schema.ts
  - convex/devices.ts
  - electron/renderer/src/lib/device/deviceId.ts
  - electron/renderer/src/hooks/useDeviceRegistration.ts
  - electron/renderer/src/hooks/useThemeSync.ts
  - electron/renderer/src/components/settings/SettingsModal.tsx
  - electron/renderer/src/components/settings/ActivityTab.tsx
checklist: /checklists/device-preferences.md
doc: /docs/device-preferences/README.md
status: in-progress
last_sync: 2024-12-25
---

# Device Preferences Implementation Checklist

## Phase 1: Schema & Backend

- [ ] **1.1** Add userDevices table to schema.ts [atom:1]
  - Fields: userId, deviceId, deviceName, platform, userAgent, lastIp, lastSeenAt, createdAt, preferences, isRevoked
  - Indexes: by_user, by_device, by_user_device

- [ ] **1.2** Add NEW_DEVICE to NOTIFICATION_TYPES [atom:2]

- [ ] **1.3** Create convex/devices.ts [atoms:3-8]
  - [ ] registerDevice mutation
  - [ ] updateDeviceActivity mutation
  - [ ] updateDevicePreferences mutation
  - [ ] getMyDevices query
  - [ ] revokeDevice mutation
  - [ ] notifyNewDevice internal function

## Phase 2: Client Utilities

- [ ] **2.1** Create lib/device/deviceId.ts [atoms:9-10]
  - [ ] generateDeviceId (UUID v4)
  - [ ] getDeviceId (get or create)
  - [ ] parseUserAgent (browser + OS)

- [ ] **2.2** Create hooks/useDeviceRegistration.ts [atom:11]
  - Register device on auth
  - Update activity periodically

- [ ] **2.3** Preserve theme on logout [atom:12]
  - Update useCurrentUser.signOut

## Phase 3: Theme Sync

- [ ] **3.1** Create hooks/useThemeSync.ts [atom:13]
  - Load theme from server on mount
  - Save theme changes to server

- [ ] **3.2** Update GeneralTab [atom:14]
  - Use useThemeSync hook

## Phase 4: Activity Tab UI

- [ ] **4.1** Create ActivityTab component [atoms:15-16,18]
  - DeviceCard sub-component
  - Revoke confirmation dialog
  - Current device indicator

- [ ] **4.2** Add Activity tab to SettingsModal [atom:17]
  - Add to TABS array
  - Add to renderTabContent switch

---

## Progress

- Phase 1: 0/3 complete
- Phase 2: 0/3 complete
- Phase 3: 0/2 complete
- Phase 4: 0/2 complete
- **Total: 0/10 complete**
