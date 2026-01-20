/**
 * OAuth State Management
 *
 * Tracks OAuth flow state via sessionStorage to prevent infinite auth loops.
 * The state persists across OAuth redirects but not across browser sessions.
 */

const OAUTH_IN_PROGRESS_KEY = 'tropx_oauth_in_progress';
const OAUTH_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const JWT_FRESH_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes - enough time for OAuth flow to complete

/**
 * Mark OAuth flow as in progress (call before redirecting to OAuth provider)
 */
export function setOAuthInProgress(): void {
  sessionStorage.setItem(OAUTH_IN_PROGRESS_KEY, Date.now().toString());
}

/**
 * Check if OAuth flow is currently in progress
 */
export function isOAuthInProgress(): boolean {
  const timestamp = sessionStorage.getItem(OAUTH_IN_PROGRESS_KEY);
  if (!timestamp) return false;

  const elapsed = Date.now() - parseInt(timestamp, 10);
  return elapsed < OAUTH_TIMEOUT_MS;
}

/**
 * Clear OAuth in progress flag (call after auth succeeds or on sign out)
 */
export function clearOAuthInProgress(): void {
  sessionStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
}

/**
 * Check if URL contains OAuth callback parameters
 */
export function isOAuthCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('code') || params.has('error');
}

/**
 * Check if JWT was issued recently (likely fresh from OAuth).
 * Prevents treating a just-issued token as stale while Convex Auth processes it.
 */
export function isJWTFresh(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('__convexAuthJWT')) continue;

      const jwt = localStorage.getItem(key);
      if (!jwt) continue;

      const parts = jwt.split('.');
      if (parts.length !== 3) continue;

      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

      if (payload.iat) {
        const elapsed = Date.now() - payload.iat * 1000;
        if (elapsed < JWT_FRESH_THRESHOLD_MS) {
          return true;
        }
      }
    }
  } catch {
    // Ignore decode errors
  }
  return false;
}

/**
 * Check if we should skip stale token detection.
 * Returns true if any condition indicates OAuth is in progress.
 */
export function shouldSkipStaleTokenCheck(): boolean {
  return isOAuthCallback() || isOAuthInProgress() || isJWTFresh();
}
