---
id: device-preferences-decomposition
tags: [auth, users, preferences, devices]
related_files: []
checklist: /checklists/device-preferences.md
doc: /docs/device-preferences/README.md
status: in-progress
last_sync: 2024-12-25
---

# Feature Decomposition

```
Per-Device Preferences & Session Management
├── Schema Layer
│   ├── [1] userDevices table definition ✓ atomic
│   └── [2] Add NEW_DEVICE notification type ✓ atomic
├── Convex Functions
│   ├── [3] registerDevice mutation ✓ atomic
│   ├── [4] updateDeviceActivity mutation ✓ atomic
│   ├── [5] updateDevicePreferences mutation ✓ atomic
│   ├── [6] getMyDevices query ✓ atomic
│   ├── [7] revokeDevice mutation ✓ atomic
│   └── [8] notifyNewDevice (internal) ✓ atomic
├── Client: Device Management
│   ├── [9] generateDeviceId utility ✓ atomic
│   ├── [10] parseUserAgent utility ✓ atomic
│   ├── [11] useDeviceRegistration hook ✓ atomic
│   └── [12] Preserve theme on logout ✓ atomic
├── Client: Theme Sync
│   ├── [13] useThemeSync hook ✓ atomic
│   └── [14] Update GeneralTab to sync theme ✓ atomic
└── UI: Activity Tab
    ├── [15] ActivityTab component ✓ atomic
    ├── [16] DeviceCard sub-component ✓ atomic
    ├── [17] Add tab to SettingsModal ✓ atomic
    └── [18] Revoke confirmation dialog ✓ atomic
```

## Atomic Units

| # | Unit | Parent | Description |
|---|------|--------|-------------|
| 1 | userDevices table | Schema | Define table with indexes |
| 2 | NEW_DEVICE notification | Schema | Add to NOTIFICATION_TYPES |
| 3 | registerDevice | Convex | Create/update device on auth |
| 4 | updateDeviceActivity | Convex | Update lastSeenAt, lastIp |
| 5 | updateDevicePreferences | Convex | Update theme preference |
| 6 | getMyDevices | Convex | Query all user's devices |
| 7 | revokeDevice | Convex | Mark device as revoked |
| 8 | notifyNewDevice | Convex | Send in-app notification |
| 9 | generateDeviceId | Client | UUID v4 generation + storage |
| 10 | parseUserAgent | Client | Extract browser/OS from UA |
| 11 | useDeviceRegistration | Client | Register device on auth |
| 12 | Preserve theme | Client | Don't clear theme on logout |
| 13 | useThemeSync | Client | Sync theme to server |
| 14 | GeneralTab update | UI | Use synced theme |
| 15 | ActivityTab | UI | Main tab component |
| 16 | DeviceCard | UI | Individual device display |
| 17 | SettingsModal update | UI | Add Activity tab |
| 18 | Revoke dialog | UI | Confirmation before revoke |
