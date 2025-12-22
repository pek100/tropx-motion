"use client";

import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useAction } from "convex/react";
import { api } from "../../../../../convex/_generated/api";

const ELECTRON_AUTH_KEY = 'tropx_electron_auth_pending';
const ELECTRON_CALLBACK_URL_KEY = 'tropx_electron_callback_url';

// Find Convex Auth tokens in localStorage by prefix
// Convex Auth stores as __convexAuthJWT_<namespace> and __convexAuthRefreshToken_<namespace>
function findConvexAuthTokens(): { jwt: string | null; refreshToken: string | null } {
  let jwt: string | null = null;
  let refreshToken: string | null = null;

  // Debug: log all localStorage keys
  const allKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) allKeys.push(key);
  }
  console.log('[AutoSignIn] All localStorage keys:', allKeys);
  console.log('[AutoSignIn] Convex-related keys:', allKeys.filter(k => k.includes('convex') || k.includes('Convex')));

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;

    if (key.startsWith('__convexAuthJWT')) {
      jwt = localStorage.getItem(key);
      console.log('[AutoSignIn] Found JWT with key:', key, 'length:', jwt?.length);
    } else if (key.startsWith('__convexAuthRefreshToken')) {
      refreshToken = localStorage.getItem(key);
      console.log('[AutoSignIn] Found refreshToken with key:', key, 'length:', refreshToken?.length);
    }
  }

  return { jwt, refreshToken };
}

function hasConvexAuthJWT(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('__convexAuthJWT')) {
      return true;
    }
  }
  return false;
}

/**
 * AutoSignIn Component
 *
 * Handles ?autoSignIn=google URL parameter for direct OAuth flow.
 * When the web app loads with this param, it immediately triggers Google OAuth.
 * Used by Electron app to bypass the sign-in modal and go straight to Google.
 * Shows a loading screen while redirecting to provide immediate visual feedback.
 *
 * For Electron auth flow (?electronAuth=true):
 * After successful auth, shows a "return to app" screen with a button.
 * Uses localStorage to persist the electronAuth flag across OAuth redirects.
 */
export function AutoSignIn() {
  const [isAutoSignIn, setIsAutoSignIn] = useState(false);
  const [isElectronAuth, setIsElectronAuth] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [triggered, setTriggered] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [redirected, setRedirected] = useState(false);
  const [hasCheckedStaleTokens, setHasCheckedStaleTokens] = useState(false);
  const [creatingElectronSession, setCreatingElectronSession] = useState(false);
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const createElectronSession = useAction(api.electronAuth.createElectronSession);

  // Check for autoSignIn param OR pending electron auth on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const autoSignIn = params.get('autoSignIn');
    const electronAuth = params.get('electronAuth');
    const callbackUrlParam = params.get('callbackUrl');

    // Check if there's a pending electron auth from localStorage
    const pendingElectronAuth = localStorage.getItem(ELECTRON_AUTH_KEY) === 'true';
    const storedCallbackUrl = localStorage.getItem(ELECTRON_CALLBACK_URL_KEY);

    if (autoSignIn === 'google') {
      setIsAutoSignIn(true);
      const isElectron = electronAuth === 'true';
      setIsElectronAuth(isElectron);

      // Store callback URL if provided (for localhost callback)
      if (callbackUrlParam) {
        setCallbackUrl(callbackUrlParam);
        localStorage.setItem(ELECTRON_CALLBACK_URL_KEY, callbackUrlParam);
      }

      // Persist electron auth flag across OAuth redirect
      if (isElectron) {
        localStorage.setItem(ELECTRON_AUTH_KEY, 'true');
      }

      // Clear the URL params to prevent re-triggering on back navigation
      const url = new URL(window.location.href);
      url.searchParams.delete('autoSignIn');
      url.searchParams.delete('electronAuth');
      url.searchParams.delete('callbackUrl');
      window.history.replaceState({}, '', url.toString());
    } else if (pendingElectronAuth) {
      // We're returning from OAuth redirect - restore electron auth state
      setIsElectronAuth(true);
      if (storedCallbackUrl) {
        setCallbackUrl(storedCallbackUrl);
      }
      console.log('[AutoSignIn] Restored electronAuth from localStorage, callback:', storedCallbackUrl);
    }
  }, []);

  // Check for stale tokens and clear them if invalid
  // This ensures we don't proceed with invalid tokens
  useEffect(() => {
    if (isLoading || hasCheckedStaleTokens) return;

    // Check if we have tokens in localStorage but Convex says not authenticated
    if (hasConvexAuthJWT() && !isAuthenticated) {
      console.log('[AutoSignIn] Stale token detected - clearing all auth tokens');

      // Clear ALL Convex auth tokens to ensure clean state
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('__convexAuth')) {
          keysToRemove.push(key);
        }
      }
      console.log('[AutoSignIn] Removing keys:', keysToRemove);
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // If we're in electron auth flow, trigger OAuth automatically
      if (isElectronAuth && !triggered) {
        console.log('[AutoSignIn] Auto-triggering OAuth after stale token cleanup');
        setIsAutoSignIn(true);
      }
    }

    setHasCheckedStaleTokens(true);
  }, [isLoading, isAuthenticated, hasCheckedStaleTokens, isElectronAuth, triggered]);

  // When auth completes for Electron, create a SEPARATE session for Electron
  // This ensures web and Electron have independent sessions
  useEffect(() => {
    if (isElectronAuth && isAuthenticated && !isLoading && !redirected && callbackUrl && !creatingElectronSession) {
      console.log('[AutoSignIn] Auth complete, creating separate Electron session...');
      setCreatingElectronSession(true);

      // Create a new session specifically for Electron (separate from web's session)
      createElectronSession()
        .then((tokens) => {
          if (tokens) {
            console.log('[AutoSignIn] Electron session created, JWT length:', tokens.jwt.length);

            // Clear pending flags
            localStorage.removeItem(ELECTRON_AUTH_KEY);
            localStorage.removeItem(ELECTRON_CALLBACK_URL_KEY);

            // Redirect to callback with the NEW tokens (not web's tokens)
            const redirectUrl = `${callbackUrl}?jwt=${encodeURIComponent(tokens.jwt)}&refreshToken=${encodeURIComponent(tokens.refreshToken)}`;
            setRedirected(true);
            window.location.href = redirectUrl;
          } else {
            console.error('[AutoSignIn] Failed to create Electron session');
            setAuthError('Failed to create Electron session');
            setCreatingElectronSession(false);
          }
        })
        .catch((err) => {
          console.error('[AutoSignIn] Error creating Electron session:', err);
          setAuthError(err.message || 'Failed to create Electron session');
          setCreatingElectronSession(false);
        });
    } else if (isElectronAuth && isAuthenticated && !isLoading && !callbackUrl) {
      // No callback URL - just clear flags (old protocol-based flow)
      localStorage.removeItem(ELECTRON_AUTH_KEY);
    }
  }, [isElectronAuth, isAuthenticated, isLoading, redirected, callbackUrl, creatingElectronSession, createElectronSession]);

  // Trigger OAuth after detecting param (only if not already authenticated)
  // Wait for isLoading to be false before deciding
  useEffect(() => {
    // Don't do anything while still loading auth state
    if (isLoading) return;

    if (isAutoSignIn && !triggered && !isAuthenticated) {
      console.log('[AutoSignIn] Triggering Google OAuth, electronAuth:', isElectronAuth);
      setTriggered(true);

      // Trigger Google sign-in - this will redirect to Google OAuth
      signIn("google").catch((err) => {
        console.error('[AutoSignIn] OAuth error:', err);
        setAuthError(err.message || 'OAuth failed');
        // Clear pending flag on error
        localStorage.removeItem(ELECTRON_AUTH_KEY);
      });
    } else if (isAutoSignIn && isAuthenticated && !triggered) {
      // Already authenticated - skip OAuth
      console.log('[AutoSignIn] Already authenticated, skipping OAuth');
      setTriggered(true);
    }
  }, [isAutoSignIn, triggered, signIn, isElectronAuth, isAuthenticated, isLoading]);


  // For Electron flow: Show "return to app" screen after successful auth
  if (isElectronAuth && !isLoading && isAuthenticated) {
    // If we have a callback URL, show redirecting message
    if (callbackUrl) {
      return (
        <div className="fixed inset-0 bg-[var(--tropx-bg)] flex items-center justify-center z-[9999]">
          <div className="text-center p-8 max-w-md">
            {/* Success Icon */}
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="w-10 h-10 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            <h1 className="text-2xl font-semibold text-[var(--tropx-text-main)] mb-3">
              Sign-in Successful!
            </h1>
            <p className="text-[var(--tropx-text-sub)] mb-4">
              Returning to TropX Motion...
            </p>

            {/* Spinner */}
            <div className="w-6 h-6 mx-auto rounded-full animate-spin border-2 border-[var(--tropx-border)] border-t-[var(--tropx-vibrant)]" />
          </div>
        </div>
      );
    }

    // No callback URL - show manual return button (fallback)
    return (
      <div className="fixed inset-0 bg-[var(--tropx-bg)] flex items-center justify-center z-[9999]">
        <div className="text-center p-8 max-w-md">
          {/* Success Icon */}
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <svg className="w-10 h-10 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-2xl font-semibold text-[var(--tropx-text-main)] mb-3">
            Sign-in Successful!
          </h1>
          <p className="text-[var(--tropx-text-sub)] mb-4">
            You can close this tab and return to TropX Motion.
          </p>
        </div>
      </div>
    );
  }

  // For Electron flow: Show error screen
  if (isElectronAuth && authError) {
    // If we have a callback URL, redirect with error
    if (callbackUrl && !redirected) {
      setRedirected(true);
      localStorage.removeItem(ELECTRON_AUTH_KEY);
      localStorage.removeItem(ELECTRON_CALLBACK_URL_KEY);
      window.location.href = `${callbackUrl}?error=${encodeURIComponent(authError)}`;
    }

    return (
      <div className="fixed inset-0 bg-[var(--tropx-bg)] flex items-center justify-center z-[9999]">
        <div className="text-center p-8 max-w-md">
          {/* Error Icon */}
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg className="w-10 h-10 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>

          <h1 className="text-2xl font-semibold text-[var(--tropx-text-main)] mb-3">
            Sign-in Failed
          </h1>
          <p className="text-[var(--tropx-text-sub)] mb-4">
            {authError}
          </p>
          <p className="text-sm text-[var(--tropx-shadow)]">
            You can close this tab and try again.
          </p>
        </div>
      </div>
    );
  }

  // Show loading screen for Electron auth while processing
  if (isElectronAuth && isLoading) {
    return (
      <div className="fixed inset-0 bg-[var(--tropx-bg)] flex items-center justify-center z-[9999]">
        <div className="text-center p-8">
          {/* TropX Logo */}
          <svg
            className="w-16 h-16 mx-auto mb-6"
            viewBox="0 0 1024 1024"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M536.573 188.5C480.508 217.268 427.514 275.625 441.339 293.707C458.235 315.077 528.125 283.844 583.423 229.597C645.632 167.952 620.288 146.582 536.573 188.5Z" fill="var(--tropx-vibrant)"/>
            <path d="M753.405 396.365C627.93 499.319 494.412 599.86 487.977 595.838C484.76 594.229 480.738 549.187 478.325 497.71C471.89 367.409 452.587 326.388 397.892 326.388C348.828 326.388 279.656 410.038 191.985 575.73C116.378 718.9 98.6828 808.18 138.899 840.353C150.964 850.005 167.051 857.244 175.898 857.244C199.224 857.244 260.352 823.462 326.307 773.594L385.023 729.356L406.74 771.181C452.587 862.874 525.78 873.331 658.494 807.376C699.515 786.463 771.904 739.812 818.555 702.813C899.792 640.076 986.66 563.665 986.66 555.622C986.66 553.209 960.117 570.099 927.14 591.816C817.751 665.814 673.777 728.552 615.061 728.552C583.692 728.552 534.628 701.205 515.324 673.053L496.02 644.098L537.845 607.903C675.385 490.471 853.141 327.193 848.315 322.367C847.511 320.758 804.078 353.736 753.405 396.365ZM389.849 566.882C396.284 603.077 398.697 637.663 396.284 644.098C393.871 650.532 375.371 664.206 355.263 673.858C321.481 690.748 316.655 690.748 296.547 679.488C265.983 662.597 262.765 616.75 289.308 576.534C316.655 535.513 359.285 493.688 370.545 497.71C375.371 499.319 384.219 529.883 389.849 566.882Z" fill="var(--tropx-vibrant)"/>
          </svg>

          {/* Spinner */}
          <div className="w-8 h-8 mx-auto mb-5 rounded-full animate-spin border-3 border-[var(--tropx-hover)] border-t-[var(--tropx-vibrant)]" />

          {/* Text */}
          <h1 className="text-xl font-semibold text-[var(--tropx-text-main)] mb-2">
            Completing sign-in...
          </h1>
          <p className="text-sm text-[var(--tropx-text-sub)]">
            Please wait
          </p>
        </div>
      </div>
    );
  }

  // Show loading screen while redirecting to Google
  if (isAutoSignIn) {
    return (
      <div className="fixed inset-0 bg-[var(--tropx-bg)] flex items-center justify-center z-[9999]">
        <div className="text-center p-8">
          {/* TropX Logo */}
          <svg
            className="w-16 h-16 mx-auto mb-6"
            viewBox="0 0 1024 1024"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M536.573 188.5C480.508 217.268 427.514 275.625 441.339 293.707C458.235 315.077 528.125 283.844 583.423 229.597C645.632 167.952 620.288 146.582 536.573 188.5Z" fill="var(--tropx-vibrant)"/>
            <path d="M753.405 396.365C627.93 499.319 494.412 599.86 487.977 595.838C484.76 594.229 480.738 549.187 478.325 497.71C471.89 367.409 452.587 326.388 397.892 326.388C348.828 326.388 279.656 410.038 191.985 575.73C116.378 718.9 98.6828 808.18 138.899 840.353C150.964 850.005 167.051 857.244 175.898 857.244C199.224 857.244 260.352 823.462 326.307 773.594L385.023 729.356L406.74 771.181C452.587 862.874 525.78 873.331 658.494 807.376C699.515 786.463 771.904 739.812 818.555 702.813C899.792 640.076 986.66 563.665 986.66 555.622C986.66 553.209 960.117 570.099 927.14 591.816C817.751 665.814 673.777 728.552 615.061 728.552C583.692 728.552 534.628 701.205 515.324 673.053L496.02 644.098L537.845 607.903C675.385 490.471 853.141 327.193 848.315 322.367C847.511 320.758 804.078 353.736 753.405 396.365ZM389.849 566.882C396.284 603.077 398.697 637.663 396.284 644.098C393.871 650.532 375.371 664.206 355.263 673.858C321.481 690.748 316.655 690.748 296.547 679.488C265.983 662.597 262.765 616.75 289.308 576.534C316.655 535.513 359.285 493.688 370.545 497.71C375.371 499.319 384.219 529.883 389.849 566.882Z" fill="var(--tropx-vibrant)"/>
          </svg>

          {/* Spinner */}
          <div className="w-8 h-8 mx-auto mb-5 rounded-full animate-spin border-3 border-[var(--tropx-hover)] border-t-[var(--tropx-vibrant)]" />

          {/* Text */}
          <h1 className="text-xl font-semibold text-[var(--tropx-text-main)] mb-2">
            Signing in to TropX
          </h1>
          <p className="text-sm text-[var(--tropx-text-sub)]">
            Redirecting to Google...
          </p>
        </div>
      </div>
    );
  }

  return null;
}

export default AutoSignIn;
