# TropX Motion - React Native Migration Plan

## Overview

This document outlines the migration strategy for porting TropX Motion from Electron to React Native. The goal is to create a cross-platform mobile application (iOS/Android) that maintains feature parity with the existing desktop/kiosk application.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Application                      │
├─────────────────────────────────────────────────────────────┤
│  Main Process              │  Renderer Process               │
│  ├── BLE Bridge           │  ├── React UI (Vite)            │
│  │   ├── Noble            │  │   ├── Components             │
│  │   ├── TropXDevice      │  │   ├── Hooks                  │
│  │   └── Transport Layer  │  │   └── UI Profiles            │
│  ├── WebSocket Bridge     │  ├── TropX WS Client            │
│  ├── Motion Processing    │  └── State Management           │
│  └── Time Sync            │                                  │
└─────────────────────────────────────────────────────────────┘
```

## Target Architecture (React Native)

```
┌─────────────────────────────────────────────────────────────┐
│                  React Native Application                    │
├─────────────────────────────────────────────────────────────┤
│  Native Modules           │  JavaScript Thread               │
│  ├── react-native-ble-plx │  ├── React Native UI             │
│  └── Platform APIs        │  │   ├── Components (refactored) │
│                           │  │   ├── Hooks (refactored)      │
│                           │  │   └── UI Profiles (ported)    │
│                           │  ├── BLE Service (rewritten)     │
│                           │  ├── Motion Processing (ported)  │
│                           │  └── Time Sync (ported)          │
└─────────────────────────────────────────────────────────────┘
```

## Key Differences

| Aspect | Electron | React Native |
|--------|----------|--------------|
| BLE Library | Noble (Node.js) | react-native-ble-plx |
| Process Model | Main + Renderer | Single JS thread + Native |
| IPC | WebSocket Bridge | Direct function calls |
| Styling | Tailwind CSS | StyleSheet / NativeWind |
| Navigation | React Router | React Navigation |
| Buffer Handling | Node.js Buffer | Base64 / Uint8Array |
| Platform Detection | /proc/device-tree | Platform.OS |

## Codebase Analysis

### Total Files: 167 TypeScript files

| Module | Files | Portability | Effort |
|--------|-------|-------------|--------|
| ui-profiles | 6 | Direct port | Low |
| motionProcessing | 27 | Mostly portable | Medium |
| time-sync | 7 | Portable (logic) | Low |
| ble-bridge | 24 | Complete rewrite | High |
| websocket-bridge | 18 | Not needed | N/A |
| renderer/components | 64 | Refactor styling | Medium |
| renderer/hooks | 5 | Refactor | Medium |
| shared | 2 | Partial rewrite | Medium |

### Portability Breakdown

- **Direct Port (~40%)**: Pure TypeScript logic, math operations, type definitions
- **Refactor (~35%)**: React components (styling changes), hooks (API adjustments)
- **Rewrite (~25%)**: BLE layer, platform detection, buffer handling

## Estimated Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| Phase 1 | 2-3 days | Project setup, core types, dependencies |
| Phase 2 | 5-7 days | BLE layer rewrite (highest risk) |
| Phase 3 | 4-6 days | UI component migration |
| Phase 4 | 2-3 days | Motion processing integration |
| Phase 5 | 2-4 days | Testing, debugging, polish |
| **Total** | **15-23 days** | |

## Team Requirements

- React Native experience (required)
- BLE development experience (highly recommended)
- iOS/Android native debugging skills
- Knowledge of quaternion math (helpful)

## Risk Factors

1. **BLE Reliability**: react-native-ble-plx has different behavior than Noble
2. **Performance**: 100Hz quaternion streaming on mobile requires optimization
3. **Background Mode**: iOS background BLE restrictions
4. **Binary Protocol**: Buffer handling differences may introduce bugs

## Success Criteria

- [ ] Connect to 4+ TropX devices simultaneously
- [ ] Stream quaternion data at 100Hz with < 10ms latency
- [ ] Time synchronization accuracy within 5ms
- [ ] Smooth UI at 30+ FPS on mid-range devices
- [ ] Offline recording capability
- [ ] Battery life impact < 20% per hour of use

## Related Documents

- [File Mapping](./file-mapping.md) - Detailed file-by-file assessment
- [BLE Rewrite Guide](./ble-rewrite.md) - Noble to react-native-ble-plx migration
- [Architecture Changes](./architecture-changes.md) - Structural differences
- [Implementation Checklist](./checklist.md) - Phase-by-phase tasks
