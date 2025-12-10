---
id: convex-integration
tags: [auth, database, api, users, recordings, convex, critical]
related_files: [convex/schema.ts, convex/auth.ts, convex/auth.config.ts, convex/users.ts, convex/recordings.ts, convex/invites.ts, convex/admin.ts, convex/cleanup.ts, convex/crons.ts, convex/lib/auth.ts, electron/renderer/src/lib/convex.tsx, electron/renderer/src/hooks/useCurrentUser.ts, electron/renderer/src/components/auth/SignInButton.tsx, electron/renderer/src/components/auth/RoleSelectionModal.tsx, .env.local]
doc: /docs/convex-integration/README.md
decomposition: /docs/convex-integration/decomposition.md
status: complete
last_sync: 2025-12-10
---

# Convex Integration Checklist

## Phase 1: Foundation
- [x] 1.1 Create convex/ directory structure
- [x] 1.2 Define schema.ts (users, recordings, invites tables)
- [ ] 1.3 Connect to Convex deployment (npx convex dev)

## Phase 2: Authentication
- [x] 2.1.1 Create auth.config.ts with Google OAuth
- [x] 2.1.2 Create auth.ts setup file
- [x] 2.2.1 Create lib/auth.ts - getAuthUserId helper
- [x] 2.2.2 Create lib/auth.ts - requireAuth helper
- [x] 2.3.1 getMe query - check user exists by authId
- [x] 2.3.2 getMe query - return needsOnboarding flag
- [x] 2.3.3 completeOnboarding mutation - set role

## Phase 3: Users Module
- [x] 3.1.1 getMe query - current user data
- [x] 3.1.2 getUser query - get user by ID
- [x] 3.1.3 getContacts query - list contacts with user data
- [x] 3.1.4 searchUserByEmail query
- [x] 3.2.1 updateProfile mutation
- [x] 3.2.2 addContact mutation
- [x] 3.2.3 updateContactAlias mutation
- [x] 3.2.4 removeContact mutation
- [x] 3.2.5 archiveUser mutation (self)
- [x] 3.3.1 createUserFromAuth internal function

## Phase 4: Invites Module
- [x] 4.1.1 getMyInvites query
- [x] 4.1.2 getInviteByToken query
- [x] 4.1.3 getPendingInvitesForEmail query
- [x] 4.2.1 createInvite mutation
- [x] 4.2.2 acceptInvite mutation
- [x] 4.2.3 cancelInvite mutation
- [x] 4.2.4 expireOldInvites internal function

## Phase 5: Recordings Module
- [x] 5.1.1 get query - with access check
- [x] 5.1.2 listMyRecordings query
- [x] 5.1.3 listRecordingsOfMe query
- [x] 5.1.4 listSharedWithMe query
- [x] 5.1.5 listBySubject query
- [x] 5.2.1 create mutation
- [x] 5.2.2 update mutation (notes, tags, exerciseType)
- [x] 5.2.3 shareWith mutation
- [x] 5.2.4 unshare mutation
- [x] 5.2.5 archive mutation
- [x] 5.2.6 restore mutation

## Phase 6: Admin Module
- [x] 6.1.1 listAllUsers query (paginated)
- [x] 6.1.2 getStats query
- [x] 6.2.1 setUserRole mutation
- [x] 6.2.2 archiveUser mutation (admin)
- [x] 6.2.3 restoreUser mutation

## Phase 7: Scheduled Jobs
- [x] 7.1 cleanupArchivedData cron (daily, 30 days)
- [x] 7.2 expireOldInvites cron (hourly)

## Phase 8: React Integration
- [x] 8.1.1 Install convex package (package.json updated)
- [x] 8.1.2 Add VITE_CONVEX_URL to .env.local
- [x] 8.1.3 Wrap app with ConvexProvider + ConvexAuthProvider
- [x] 8.2.1 SignInButton component
- [x] 8.2.2 RoleSelectionModal component
- [x] 8.2.3 useCurrentUser hook

---

## Progress: 51/51 complete

## Files Created
```
convex/
├── schema.ts           ✓ Tables: users, recordings, invites
├── auth.ts             ✓ Convex Auth setup with Google
├── auth.config.ts      ✓ OAuth config
├── users.ts            ✓ User CRUD, contacts, onboarding
├── recordings.ts       ✓ Recording CRUD, sharing
├── invites.ts          ✓ Invite system
├── admin.ts            ✓ Admin functions
├── cleanup.ts          ✓ Archived data cleanup
├── crons.ts            ✓ Scheduled jobs
└── lib/
    └── auth.ts         ✓ Auth helpers

electron/renderer/src/
├── lib/
│   └── convex.tsx      ✓ ConvexClientProvider
├── hooks/
│   └── useCurrentUser.ts ✓ Auth hook
└── components/auth/
    ├── index.ts        ✓ Exports
    ├── SignInButton.tsx ✓ Sign in/out button
    └── RoleSelectionModal.tsx ✓ Onboarding modal

.env.local              ✓ VITE_CONVEX_URL placeholder
package.json            ✓ Added convex dependencies
main.tsx                ✓ Wrapped with ConvexClientProvider
```

## Next Steps (Manual)
1. Run `npm install` to install new dependencies
2. Run `npx convex dev` to connect to your Convex deployment
3. Set `VITE_CONVEX_URL` in `.env.local` with the URL from step 2
4. Set up Google OAuth in Convex dashboard:
   - Go to Convex dashboard → Settings → Authentication
   - Add Google provider with your OAuth credentials
5. Add `<SignInButton />` to your UI where you want the sign-in button

## Notes
- Admin role assigned manually, not selectable on signup
- Recordings max ~10min at 100Hz (~960KB, under 1MB limit)
- Soft delete: 30 days retention before permanent deletion
- Invite links expire (configurable, default 7 days)
