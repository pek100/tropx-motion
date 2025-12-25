---
id: device-preferences
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

# Per-Device Preferences & Session Management

## Overview

Track user devices, store per-device preferences (theme), and allow users to manage active sessions.

## Features

1. **Device Tracking**: Register devices on auth, track last seen + IP
2. **Per-Device Preferences**: Theme (light/dark/system) stored per device
3. **Activity Tab**: View/revoke active devices in Settings
4. **Security Notifications**: In-app notification on new device sign-in

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client                                │
├─────────────────────────────────────────────────────────────┤
│  localStorage          │  Hooks                │  UI        │
│  ├─ deviceId (UUID)    │  ├─ useDeviceReg     │  Settings  │
│  └─ theme              │  └─ useThemeSync     │  └─Activity│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Convex                                │
├─────────────────────────────────────────────────────────────┤
│  userDevices table                                          │
│  ├─ userId, deviceId, deviceName, platform                  │
│  ├─ lastIp, lastSeenAt, createdAt                          │
│  ├─ preferences: { theme }                                  │
│  └─ isRevoked                                               │
└─────────────────────────────────────────────────────────────┘
```

## Device Identification

- **UUID**: Generated on first visit, stored in localStorage
- **IP**: Captured server-side on each request
- Device considered "new" if UUID not seen before for user

## File Structure

```
convex/
  schema.ts          # userDevices table
  devices.ts         # Device CRUD operations

electron/renderer/src/
  lib/device/
    deviceId.ts      # UUID generation, user-agent parsing
  hooks/
    useDeviceRegistration.ts
    useThemeSync.ts
  components/settings/
    SettingsModal.tsx  # Add Activity tab
    ActivityTab.tsx    # Device list + revoke
```
