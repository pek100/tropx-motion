# TropX Motion Authentication System

This document describes the authentication architecture for TropX Motion, covering both the web app and Electron desktop app. The system uses Convex Auth with Google OAuth.

## Overview

TropX Motion supports two platforms that share the same user database but maintain **independent authentication sessions**:

1. **Web App** (`app.tropx.ai`) - Standard browser-based OAuth
2. **Electron App** - Desktop OAuth via system browser callback

The key challenge is ensuring that signing out on one platform does not affect the other. This is solved by creating separate Convex Auth sessions for each platform.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AUTHENTICATION FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐         │
│  │   Electron   │         │   Web App    │         │    Convex    │         │
│  │     App      │         │ app.tropx.ai │         │   Backend    │         │
│  └──────┬───────┘         └──────┬───────┘         └──────┬───────┘         │
│         │                        │                        │                  │
│         │   1. User clicks       │                        │                  │
│         │      "Sign In"         │                        │                  │
│         │                        │                        │                  │
│         │   2. Open browser      │                        │                  │
│         │──────────────────────> │                        │                  │
│         │   with callbackUrl     │                        │                  │
│         │                        │                        │                  │
│         │                        │   3. OAuth flow        │                  │
│         │                        │ ───────────────────────>                  │
│         │                        │                        │                  │
│         │                        │   4. Web session       │                  │
│         │                        │ <───────────────────────                  │
│         │                        │      created           │                  │
│         │                        │                        │                  │
│         │                        │   5. createElectron    │                  │
│         │                        │      Session()         │                  │
│         │                        │ ───────────────────────>                  │
│         │                        │                        │                  │
│         │                        │   6. NEW session       │                  │
│         │                        │ <───────────────────────                  │
│         │                        │      for Electron      │                  │
│         │                        │                        │                  │
│         │   7. Redirect with     │                        │                  │
│         │ <───────────────────── │                        │                  │
│         │   Electron tokens      │                        │                  │
│         │                        │                        │                  │
│         │   8. Store tokens      │                        │                  │
│         │      in localStorage   │                        │                  │
│         │      (electron ns)     │                        │                  │
│         │                        │                        │                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Convex Auth Configuration

**File: `convex/auth.ts`**

```typescript
import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    Google({
      authorization: {
        params: {
          // Always show account picker, don't auto-select
          prompt: "select_account",
        },
      },
    }),
  ],
});
```

Key points:
- Uses `@convex-dev/auth` with Google OAuth provider
- `prompt: "select_account"` ensures users always see the Google account picker
- Exports `store` which is used internally to create sessions

### 2. Electron Session Creator

**File: `convex/electronAuth.ts`**

This action creates a **separate session** for the Electron app, independent of the web session:

```typescript
export const createElectronSession = action({
  args: {},
  handler: async (ctx): Promise<{ jwt: string; refreshToken: string } | null> => {
    // Get the currently authenticated user (from web session)
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // Create a NEW session for Electron
    const result = await ctx.runMutation(internal.auth.store, {
      args: {
        type: "signIn",
        userId,
        generateTokens: true,
      },
    });

    // Extract tokens from result
    return { jwt: tokens.token, refreshToken: tokens.refreshToken };
  },
});
```

This is the critical piece that enables session independence:
- Called after web OAuth completes
- Creates a brand new `authSession` in the Convex database
- Returns fresh tokens that are only used by Electron
- When web signs out, only web's session is deleted

### 3. Web App Auto Sign-In Handler

**File: `electron/renderer/src/components/auth/AutoSignIn.tsx`**

Handles the OAuth callback when Electron redirects to the web app:

```typescript
// URL params handled:
// ?autoSignIn=google        - Triggers Google OAuth
// ?electronAuth=true        - Indicates Electron flow
// ?callbackUrl=<localhost>  - Where to redirect with tokens

// After OAuth completes, creates separate Electron session:
const tokens = await createElectronSession();
if (tokens) {
  window.location.href = `${callbackUrl}?jwt=${tokens.jwt}&refreshToken=${tokens.refreshToken}`;
}
```

Flow:
1. Detects `?electronAuth=true` and stores callback URL in localStorage
2. Triggers Google OAuth via `signIn("google")`
3. After OAuth completes, calls `createElectronSession()` to get separate tokens
4. Redirects to localhost callback with the new Electron-specific tokens

### 4. Electron OAuth Handler

**File: `electron/main/OAuthHandler.ts`**

Manages the desktop OAuth flow:

```typescript
async signInWithGoogle(): Promise<OAuthResult> {
  // 1. Find available port for callback server
  const port = await this.findAvailablePort();
  const callbackUrl = `http://localhost:${port}/callback`;

  // 2. Start temporary HTTP server
  const tokenPromise = this.startCallbackServer(port);

  // 3. Open system browser to web app
  const authUrl = `${WEB_APP_URL}?autoSignIn=google&electronAuth=true&callbackUrl=${callbackUrl}`;
  await shell.openExternal(authUrl);

  // 4. Wait for callback with tokens
  const tokens = await tokenPromise;

  return { success: true, tokens };
}
```

The callback server:
- Validates received JWT tokens (checks expiry)
- Handles retry logic if tokens are invalid
- Shows success/error pages to user

### 5. Electron Main Process Integration

**File: `electron/main/MainProcess.ts`**

Injects tokens into Electron's localStorage with the `electron` namespace:

```typescript
ipcMain.handle('auth:signInWithGoogle', async () => {
  const result = await oauthHandler.signInWithGoogle();

  if (result.success && result.tokens && this.mainWindow) {
    await this.mainWindow.webContents.executeJavaScript(`
      localStorage.setItem('__convexAuthJWT_electron', jwt);
      localStorage.setItem('__convexAuthRefreshToken_electron', refreshToken);
    `);
  }

  return result;
});
```

### 6. Convex Client Provider

**File: `electron/renderer/src/lib/convex.tsx`**

Uses separate storage namespaces for web and Electron:

```typescript
// Web uses default namespace, Electron uses "electron"
const storageNamespace = isElectron() ? "electron" : undefined;

return (
  <ConvexAuthProvider client={convex} storageNamespace={storageNamespace}>
    {children}
  </ConvexAuthProvider>
);
```

This results in different localStorage keys:
- **Web**: `__convexAuthJWT_httpstoughanteater529convexcloud`
- **Electron**: `__convexAuthJWT_electron`

## Session Independence

The key insight is that Convex Auth stores sessions in the `authSessions` table:

```
authSessions:
  - sessionId: "abc123"  (Web session)
    userId: "user123"
    expirationTime: 1234567890

  - sessionId: "xyz789"  (Electron session)
    userId: "user123"
    expirationTime: 1234567890
```

When signing out:
- **Web sign-out**: Only deletes session `abc123`
- **Electron sign-out**: Only deletes session `xyz789`

Each platform has its own session, so they don't affect each other.

## Sign-Out Flow

**File: `electron/renderer/src/hooks/useCurrentUser.ts`**

```typescript
const signOut = async () => {
  // 1. Clear all Convex auth tokens from localStorage
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('__convexAuth')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));

  // 2. Call Convex Auth signOut (invalidates session server-side)
  await authActions.signOut();

  // 3. In Electron, also clear session cookies
  if (isElectron() && window.electronAPI?.auth?.signOut) {
    await window.electronAPI.auth.signOut();
  }
};
```

## Storage Keys Reference

| Platform | JWT Key | Refresh Token Key |
|----------|---------|-------------------|
| Web | `__convexAuthJWT_<convex-url-hash>` | `__convexAuthRefreshToken_<convex-url-hash>` |
| Electron | `__convexAuthJWT_electron` | `__convexAuthRefreshToken_electron` |

## Error Handling

### Stale Token Detection

`AutoSignIn.tsx` includes stale token cleanup:

```typescript
// If we have tokens in localStorage but Convex says not authenticated
if (hasConvexAuthJWT() && !isAuthenticated) {
  // Clear all auth tokens
  keysToRemove.forEach(key => localStorage.removeItem(key));
  // Re-trigger OAuth if in Electron flow
}
```

### Token Validation

`OAuthHandler.ts` validates tokens before accepting them:

```typescript
private validateToken(jwt: string): { valid: boolean; error?: string } {
  const parts = jwt.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

  if (payload.exp * 1000 < Date.now() + 60000) {
    return { valid: false, error: 'Token expired' };
  }
  return { valid: true };
}
```

If validation fails, the handler retries the OAuth flow up to 2 times.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_CONVEX_URL` | Convex deployment URL |
| `TROPX_WEB_URL` | Web app URL (default: `https://app.tropx.ai`) |

## Debugging

Enable verbose auth logging:

1. Add `?verboseAuth=true` to URL, or
2. Set `localStorage.setItem('tropx_verbose_auth', 'true')`

This enables detailed Convex client logging for auth state changes.

## Security Considerations

1. **Token Storage**: Tokens are stored in localStorage, which is isolated per origin
2. **Session Separation**: Each platform has its own session, preventing cross-platform session hijacking
3. **Token Expiry**: JWTs have a 1-hour expiry; refresh tokens handle renewal
4. **HTTPS**: OAuth redirects use HTTPS (except localhost callback)
5. **Account Picker**: `prompt: "select_account"` prevents silent login to wrong account

## Troubleshooting

### "Sign out on web also signs out Electron"

This should no longer happen with the current implementation. If it does:
1. Check that `createElectronSession` is being called during Electron OAuth
2. Verify tokens have different session IDs (decode JWT and check `sub` claim)

### "Invalid token" errors after OAuth

1. Check system clock is accurate
2. Look for network issues during token generation
3. Check Convex logs for `auth:store` errors

### Tokens not persisting in Electron

1. Check localStorage keys match the expected namespace (`electron`)
2. Verify `MainProcess.ts` token injection is executing
3. Check for JavaScript errors in Electron DevTools
