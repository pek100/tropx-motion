---
id: convex-integration-decomposition
tags: [auth, database, api, users, recordings, convex]
related_files: [convex/schema.ts, convex/auth.ts, convex/users.ts, convex/recordings.ts]
doc: /docs/convex-integration/README.md
checklist: /checklists/convex-integration.md
status: in-progress
last_sync: 2025-12-10
---

# Convex Integration - Decomposition

## Feature Tree

```
Convex Integration
├── 1. Foundation
│   ├── 1.1 Create convex/ directory structure ✓ atomic
│   ├── 1.2 Define schema.ts with all tables ✓ atomic
│   └── 1.3 Connect to Convex deployment ✓ atomic
│
├── 2. Authentication
│   ├── 2.1 Configure Convex Auth
│   │   ├── 2.1.1 Create auth.config.ts with Google OAuth ✓ atomic
│   │   └── 2.1.2 Create auth.ts setup file ✓ atomic
│   ├── 2.2 Auth Helper Functions
│   │   ├── 2.2.1 getAuthUserId helper ✓ atomic
│   │   └── 2.2.2 requireAuth helper (throws if not auth) ✓ atomic
│   └── 2.3 User Creation on First Login
│       ├── 2.3.1 Check if user exists by authId ✓ atomic
│       ├── 2.3.2 Return needsOnboarding flag ✓ atomic
│       └── 2.3.3 completeOnboarding mutation (set role) ✓ atomic
│
├── 3. Users Module
│   ├── 3.1 Query Functions
│   │   ├── 3.1.1 getMe - current user data ✓ atomic
│   │   ├── 3.1.2 getUser - get user by ID ✓ atomic
│   │   ├── 3.1.3 getContacts - list user's contacts ✓ atomic
│   │   └── 3.1.4 searchUserByEmail ✓ atomic
│   ├── 3.2 Mutation Functions
│   │   ├── 3.2.1 updateProfile (name, image) ✓ atomic
│   │   ├── 3.2.2 addContact (userId, alias?) ✓ atomic
│   │   ├── 3.2.3 updateContactAlias ✓ atomic
│   │   ├── 3.2.4 removeContact ✓ atomic
│   │   └── 3.2.5 archiveUser (self-archive) ✓ atomic
│   └── 3.3 Internal Functions
│       └── 3.3.1 createUserFromAuth (internal) ✓ atomic
│
├── 4. Invites Module
│   ├── 4.1 Query Functions
│   │   ├── 4.1.1 getMyInvites - sent invites ✓ atomic
│   │   ├── 4.1.2 getInviteByToken ✓ atomic
│   │   └── 4.1.3 getPendingInvitesForEmail ✓ atomic
│   └── 4.2 Mutation Functions
│       ├── 4.2.1 createInvite (email, alias?) ✓ atomic
│       ├── 4.2.2 acceptInvite (token) ✓ atomic
│       ├── 4.2.3 cancelInvite ✓ atomic
│       └── 4.2.4 expireOldInvites (internal) ✓ atomic
│
├── 5. Recordings Module
│   ├── 5.1 Query Functions
│   │   ├── 5.1.1 get - single recording with access check ✓ atomic
│   │   ├── 5.1.2 listMyRecordings - owned by me ✓ atomic
│   │   ├── 5.1.3 listRecordingsOfMe - where I'm subject ✓ atomic
│   │   ├── 5.1.4 listSharedWithMe ✓ atomic
│   │   └── 5.1.5 listBySubject - for specific contact ✓ atomic
│   └── 5.2 Mutation Functions
│       ├── 5.2.1 create - save new recording ✓ atomic
│       ├── 5.2.2 update - notes, tags, exerciseType ✓ atomic
│       ├── 5.2.3 shareWith - add user to sharedWith ✓ atomic
│       ├── 5.2.4 unshare - remove from sharedWith ✓ atomic
│       ├── 5.2.5 archive ✓ atomic
│       └── 5.2.6 restore ✓ atomic
│
├── 6. Admin Module
│   ├── 6.1 Query Functions
│   │   ├── 6.1.1 listAllUsers (paginated) ✓ atomic
│   │   └── 6.1.2 getStats (counts, activity) ✓ atomic
│   └── 6.2 Mutation Functions
│       ├── 6.2.1 setUserRole ✓ atomic
│       ├── 6.2.2 archiveUser (any user) ✓ atomic
│       └── 6.2.3 restoreUser ✓ atomic
│
├── 7. Scheduled Jobs
│   ├── 7.1 cleanupArchivedUsers (30 days) ✓ atomic
│   └── 7.2 cleanupArchivedRecordings (30 days) ✓ atomic
│
└── 8. React Integration
    ├── 8.1 Setup
    │   ├── 8.1.1 Install convex package ✓ atomic
    │   ├── 8.1.2 Add VITE_CONVEX_URL to env ✓ atomic
    │   └── 8.1.3 Wrap app with ConvexProvider ✓ atomic
    └── 8.2 Auth UI
        ├── 8.2.1 SignInButton component ✓ atomic
        ├── 8.2.2 RoleSelectionModal component ✓ atomic
        └── 8.2.3 useCurrentUser hook ✓ atomic
```

## Atomic Units List

### Phase 1: Foundation
1. **1.1** Create convex/ directory structure
2. **1.2** Define schema.ts with all tables
3. **1.3** Connect to Convex deployment

### Phase 2: Authentication
4. **2.1.1** Create auth.config.ts with Google OAuth
5. **2.1.2** Create auth.ts setup file
6. **2.2.1** getAuthUserId helper
7. **2.2.2** requireAuth helper
8. **2.3.1** Check if user exists by authId
9. **2.3.2** Return needsOnboarding flag
10. **2.3.3** completeOnboarding mutation

### Phase 3: Users Module
11. **3.1.1** getMe query
12. **3.1.2** getUser query
13. **3.1.3** getContacts query
14. **3.1.4** searchUserByEmail query
15. **3.2.1** updateProfile mutation
16. **3.2.2** addContact mutation
17. **3.2.3** updateContactAlias mutation
18. **3.2.4** removeContact mutation
19. **3.2.5** archiveUser mutation
20. **3.3.1** createUserFromAuth internal

### Phase 4: Invites Module
21. **4.1.1** getMyInvites query
22. **4.1.2** getInviteByToken query
23. **4.1.3** getPendingInvitesForEmail query
24. **4.2.1** createInvite mutation
25. **4.2.2** acceptInvite mutation
26. **4.2.3** cancelInvite mutation
27. **4.2.4** expireOldInvites internal

### Phase 5: Recordings Module
28. **5.1.1** get query
29. **5.1.2** listMyRecordings query
30. **5.1.3** listRecordingsOfMe query
31. **5.1.4** listSharedWithMe query
32. **5.1.5** listBySubject query
33. **5.2.1** create mutation
34. **5.2.2** update mutation
35. **5.2.3** shareWith mutation
36. **5.2.4** unshare mutation
37. **5.2.5** archive mutation
38. **5.2.6** restore mutation

### Phase 6: Admin Module
39. **6.1.1** listAllUsers query
40. **6.1.2** getStats query
41. **6.2.1** setUserRole mutation
42. **6.2.2** archiveUser (admin) mutation
43. **6.2.3** restoreUser mutation

### Phase 7: Scheduled Jobs
44. **7.1** cleanupArchivedUsers cron
45. **7.2** cleanupArchivedRecordings cron

### Phase 8: React Integration
46. **8.1.1** Install convex package
47. **8.1.2** Add VITE_CONVEX_URL to env
48. **8.1.3** Wrap app with ConvexProvider
49. **8.2.1** SignInButton component
50. **8.2.2** RoleSelectionModal component
51. **8.2.3** useCurrentUser hook

**Total: 51 atomic units**
