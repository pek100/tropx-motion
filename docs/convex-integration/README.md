---
id: convex-integration
tags: [auth, database, api, users, recordings, convex]
related_files: [convex/schema.ts, convex/auth.ts, convex/auth.config.ts, convex/users.ts, convex/recordings.ts, convex/invites.ts, convex/admin.ts, convex/cleanup.ts, convex/crons.ts, convex/lib/auth.ts, electron/renderer/src/lib/convex.tsx, electron/renderer/src/hooks/useCurrentUser.ts, electron/renderer/src/components/auth/SignInButton.tsx, electron/renderer/src/components/auth/RoleSelectionModal.tsx]
checklist: /checklists/convex-integration.md
status: complete
last_sync: 2025-12-10
---

# Convex Backend Integration

## Overview

Cloud backend integration for TropX Motion using Convex, providing:
- User authentication (Google OAuth)
- Role-based access (physiotherapist/patient/admin)
- Contact management with invite system
- Recording storage and sharing
- Soft delete with 30-day cleanup

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TropX Motion (Electron)                   │
├─────────────────────────────────────────────────────────────┤
│  React UI                                                    │
│  ├── ConvexProvider (WebSocket connection)                  │
│  ├── useQuery() - real-time data subscriptions              │
│  └── useMutation() - data modifications                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket
┌─────────────────────────────────────────────────────────────┐
│                      Convex Backend                          │
├─────────────────────────────────────────────────────────────┤
│  Auth          │  Functions        │  Scheduled Jobs        │
│  ├── Google    │  ├── users.ts     │  └── cleanupArchived   │
│  └── Sessions  │  ├── recordings.ts│      (daily)           │
│                │  ├── invites.ts   │                        │
│                │  └── admin.ts     │                        │
├─────────────────────────────────────────────────────────────┤
│                        Database                              │
│  ├── users (roles, contacts)                                │
│  ├── recordings (angles, metadata)                          │
│  └── invites (pending invitations)                          │
└─────────────────────────────────────────────────────────────┘
```

## Tables

### users
| Field | Type | Description |
|-------|------|-------------|
| authId | string | From Convex Auth (Google sub) |
| email | string | User email |
| name | string | Display name |
| image | string? | Profile picture URL |
| role | "physiotherapist" \| "patient" \| "admin" | User role |
| contacts | array | List of {userId, alias?, addedAt} |
| isArchived | boolean? | Soft delete flag |
| archivedAt | number? | Archive timestamp |
| archiveReason | string? | Why archived |
| createdAt | number | Creation timestamp |

### recordings
| Field | Type | Description |
|-------|------|-------------|
| ownerId | Id<"users"> | Who created (physiotherapist) |
| subjectId | Id<"users">? | Who was recorded (patient) |
| subjectAlias | string? | Display name if no user link |
| sharedWith | Id<"users">[]? | Users who can view |
| startTime | number | UTC ms timestamp |
| endTime | number | End timestamp |
| sampleRate | number | Hz (e.g., 100) |
| sampleCount | number | Total samples |
| durationMs | number | Duration in ms |
| leftKnee | float64[] | Left knee angles |
| rightKnee | float64[] | Right knee angles |
| notes | string? | Recording notes |
| exerciseType | string? | Type of exercise |
| tags | string[]? | Custom tags |
| isArchived | boolean? | Soft delete flag |
| archivedAt | number? | Archive timestamp |
| archiveReason | string? | Why archived |
| createdAt | number | Creation timestamp |

### invites
| Field | Type | Description |
|-------|------|-------------|
| fromUserId | Id<"users"> | Who sent invite |
| toEmail | string | Invitee email |
| alias | string? | Alias for contact |
| token | string | Unique invite token |
| status | "pending" \| "accepted" \| "expired" | Invite status |
| expiresAt | number | Expiration timestamp |
| createdAt | number | Creation timestamp |

## User Flows

### Signup Flow
1. User clicks "Sign in with Google"
2. Convex Auth handles OAuth
3. If new user → show role selection (physiotherapist/patient)
4. Create user document with selected role
5. Redirect to main app

### Invite Flow
1. Physiotherapist enters email + optional alias
2. System creates invite record with unique token
3. Invite link sent/displayed
4. Patient clicks link, signs in with Google
5. If new user → auto-assigned "patient" role
6. Contact relationship created (both directions if needed)
7. Invite marked as "accepted"

### Recording Flow
1. Physiotherapist selects subject (self or contact)
2. Recording captured locally
3. On save → mutation creates recording document
4. Recording available in "My Recordings" and subject's "Recordings of Me"

## File Structure

```
convex/
├── _generated/          # Auto-generated by Convex
├── schema.ts            # Table definitions
├── auth.ts              # Convex Auth setup
├── auth.config.ts       # OAuth providers config
├── users.ts             # User CRUD functions
├── recordings.ts        # Recording CRUD functions
├── invites.ts           # Invite management
├── admin.ts             # Admin-only functions
├── crons.ts             # Scheduled cleanup jobs
└── lib/
    └── auth.ts          # Auth helper functions
```

## Status

See [checklist](/checklists/convex-integration.md) for current progress.
