"use client";

import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useAction } from "@/lib/customConvex";
import { api } from "../../../../../convex/_generated/api";
import { setOAuthInProgress, shouldSkipStaleTokenCheck } from "@/lib/auth/oauthState";

const ELECTRON_AUTH_KEY = 'tropx_electron_auth_pending';
const ELECTRON_CALLBACK_URL_KEY = 'tropx_electron_callback_url';
const CALLBACK_TIMEOUT_MS = 10000; // 10 seconds timeout for callback

/**
 * Validate that callback URL is localhost only (security measure).
 * Prevents token leakage to malicious external URLs.
 */
function isValidCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'http:' &&
      (hostname === 'localhost' || hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

/**
 * Submit tokens to callback URL via POST (more secure than GET).
 * Tokens are sent in the request body, not visible in URL/browser history.
 */
function postToCallback(
  callbackUrl: string,
  data: { jwt?: string; refreshToken?: string; error?: string }
): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = callbackUrl;
  form.style.display = 'none';

  for (const [key, value] of Object.entries(data)) {
    if (value) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    }
  }

  document.body.appendChild(form);
  form.submit();
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

// Check URL params synchronously to prevent UI flash on first render
const getInitialAuthState = () => {
  if (typeof window === 'undefined') return { hasAutoSignIn: false, hasElectronAuth: false, hasPending: false };
  const params = new URLSearchParams(window.location.search);
  return {
    hasAutoSignIn: params.get('autoSignIn') === 'google',
    hasElectronAuth: params.get('electronAuth') === 'true',
    hasPending: localStorage.getItem(ELECTRON_AUTH_KEY) === 'true',
  };
};

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
  // Get initial state synchronously to prevent flash
  const initialState = getInitialAuthState();

  const [isAutoSignIn, setIsAutoSignIn] = useState(initialState.hasAutoSignIn);
  const [isElectronAuth, setIsElectronAuth] = useState(initialState.hasElectronAuth || initialState.hasPending);
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null);
  const [triggered, setTriggered] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [redirected, setRedirected] = useState(false);
  const [hasCheckedStaleTokens, setHasCheckedStaleTokens] = useState(false);
  const [creatingElectronSession, setCreatingElectronSession] = useState(false);
  const [authStabilized, setAuthStabilized] = useState(false);
  const [callbackTimedOut, setCallbackTimedOut] = useState(false);
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
      // Security: Only accept localhost URLs to prevent token leakage
      if (callbackUrlParam) {
        if (isValidCallbackUrl(callbackUrlParam)) {
          setCallbackUrl(callbackUrlParam);
          localStorage.setItem(ELECTRON_CALLBACK_URL_KEY, callbackUrlParam);
        } else {
          console.error('[AutoSignIn] Invalid callback URL rejected:', callbackUrlParam);
          setAuthError('Invalid callback URL. Only localhost URLs are allowed.');
        }
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
      // Returning from OAuth redirect - restore state from localStorage
      // Note: The Electron OAuth flow uses the system browser, so isElectron()
      // will be false here. We still need to restore the state to complete
      // the callback to the Electron app.
      setIsElectronAuth(true);
      if (storedCallbackUrl) {
        setCallbackUrl(storedCallbackUrl);
      }
    }
  }, []);

  // Check for stale tokens and clear them if invalid
  useEffect(() => {
    if (isLoading || hasCheckedStaleTokens) return;

    // Skip if OAuth is in progress - Convex Auth is still processing tokens
    if (shouldSkipStaleTokenCheck()) {
      setHasCheckedStaleTokens(true);
      return;
    }

    // Skip if we're in an active Electron auth flow - don't clear tokens during OAuth
    const pendingElectronAuth = localStorage.getItem(ELECTRON_AUTH_KEY) === 'true';
    if (pendingElectronAuth) {
      setHasCheckedStaleTokens(true);
      return;
    }

    // Check if we have tokens in localStorage but Convex says not authenticated
    if (hasConvexAuthJWT() && !isAuthenticated) {
      // Clear ALL Convex auth tokens to ensure clean state
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('__convexAuth')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // If we're in electron auth flow, trigger OAuth automatically
      if (isElectronAuth && !triggered) {
        setIsAutoSignIn(true);
      }
    }

    setHasCheckedStaleTokens(true);
  }, [isLoading, isAuthenticated, hasCheckedStaleTokens, isElectronAuth, triggered]);

  // Wait for auth state to stabilize after loading completes
  // This prevents triggering OAuth before isAuthenticated has fully resolved
  useEffect(() => {
    if (isLoading) {
      setAuthStabilized(false);
      return;
    }

    // Give Convex Auth a moment to fully hydrate isAuthenticated
    const timer = setTimeout(() => {
      setAuthStabilized(true);
    }, 100); // 100ms buffer

    return () => clearTimeout(timer);
  }, [isLoading]); // Note: intentionally not including isAuthenticated to avoid reset

  // When auth completes for Electron, create a separate session
  useEffect(() => {
    // Also check localStorage directly as fallback in case state hasn't updated yet
    const pendingElectronAuth = localStorage.getItem(ELECTRON_AUTH_KEY) === 'true';
    const storedCallbackUrl = localStorage.getItem(ELECTRON_CALLBACK_URL_KEY);

    // Use state values if available, otherwise fall back to localStorage
    const effectiveIsElectronAuth = isElectronAuth || pendingElectronAuth;
    const effectiveCallbackUrl = callbackUrl || storedCallbackUrl;

    // Debug logging
    console.log('[AutoSignIn] Effect check:', {
      isElectronAuth,
      pendingElectronAuth,
      effectiveIsElectronAuth,
      isAuthenticated,
      isLoading,
      redirected,
      callbackUrl,
      storedCallbackUrl,
      effectiveCallbackUrl,
      creatingElectronSession,
    });

    if (effectiveIsElectronAuth && isAuthenticated && !isLoading && !redirected && effectiveCallbackUrl && !creatingElectronSession) {
      console.log('[AutoSignIn] Creating Electron session...');
      setCreatingElectronSession(true);

      // Ensure state is synced
      if (!isElectronAuth) setIsElectronAuth(true);
      if (!callbackUrl && storedCallbackUrl) setCallbackUrl(storedCallbackUrl);

      createElectronSession()
        .then((tokens) => {
          console.log('[AutoSignIn] Electron session created:', tokens ? 'success' : 'failed');
          if (tokens) {
            localStorage.removeItem(ELECTRON_AUTH_KEY);
            localStorage.removeItem(ELECTRON_CALLBACK_URL_KEY);
            setRedirected(true);
            console.log('[AutoSignIn] Posting to callback:', effectiveCallbackUrl);
            postToCallback(effectiveCallbackUrl, {
              jwt: tokens.jwt,
              refreshToken: tokens.refreshToken,
            });
          } else {
            setAuthError('Failed to create Electron session');
            setCreatingElectronSession(false);
          }
        })
        .catch((err) => {
          console.error('[AutoSignIn] Failed to create Electron session:', err);
          setAuthError(err.message || 'Failed to create Electron session');
          setCreatingElectronSession(false);
        });
    } else if (effectiveIsElectronAuth && isAuthenticated && !isLoading && !effectiveCallbackUrl) {
      // No callback URL - just clear flags (old protocol-based flow)
      localStorage.removeItem(ELECTRON_AUTH_KEY);
    }
  }, [isElectronAuth, isAuthenticated, isLoading, redirected, callbackUrl, creatingElectronSession, createElectronSession]);

  // Trigger OAuth after detecting param (only if not already authenticated)
  // Wait for auth state to fully stabilize before deciding
  useEffect(() => {
    // Wait for auth state to fully stabilize
    if (isLoading || !authStabilized) return;
    if (!isAutoSignIn || triggered) return;

    // Already authenticated - skip OAuth
    if (isAuthenticated) {
      console.log('[AutoSignIn] Already authenticated, skipping OAuth');
      setTriggered(true);
      return;
    }

    // Not authenticated - trigger OAuth
    console.log('[AutoSignIn] Not authenticated, triggering OAuth');
    setTriggered(true);
    setOAuthInProgress();
    signIn("google").catch((err) => {
      setAuthError(err.message || 'OAuth failed');
      localStorage.removeItem(ELECTRON_AUTH_KEY);
    });
  }, [isAutoSignIn, triggered, signIn, isAuthenticated, isLoading, authStabilized]);

  // Handle non-Electron autoSignIn: clear loading screen after auth completes
  useEffect(() => {
    if (!isAutoSignIn || isElectronAuth || isLoading) return;
    if (isAuthenticated && authStabilized) {
      // Non-Electron autoSignIn completed - clear state to show normal UI
      setIsAutoSignIn(false);
    }
  }, [isAutoSignIn, isElectronAuth, isAuthenticated, isLoading, authStabilized]);

  // Handle error callback via effect (not during render)
  useEffect(() => {
    if (!authError || redirected) return;

    const pendingElectronAuth = localStorage.getItem(ELECTRON_AUTH_KEY) === 'true';
    const storedCallbackUrl = localStorage.getItem(ELECTRON_CALLBACK_URL_KEY);
    const effectiveIsElectronAuth = isElectronAuth || pendingElectronAuth;
    const effectiveCallbackUrl = callbackUrl || storedCallbackUrl;

    if (effectiveIsElectronAuth && effectiveCallbackUrl) {
      setRedirected(true);
      localStorage.removeItem(ELECTRON_AUTH_KEY);
      localStorage.removeItem(ELECTRON_CALLBACK_URL_KEY);
      postToCallback(effectiveCallbackUrl, { error: authError });
    }
  }, [authError, redirected, isElectronAuth, callbackUrl]);

  // Callback timeout: if we've been waiting too long, show error
  useEffect(() => {
    if (!redirected || callbackTimedOut) return;

    const timer = setTimeout(() => {
      setCallbackTimedOut(true);
    }, CALLBACK_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [redirected, callbackTimedOut]);

  // Check localStorage as fallback for render conditions
  const pendingElectronAuthForRender = localStorage.getItem(ELECTRON_AUTH_KEY) === 'true';
  const storedCallbackUrlForRender = localStorage.getItem(ELECTRON_CALLBACK_URL_KEY);
  const effectiveIsElectronAuthForRender = isElectronAuth || pendingElectronAuthForRender || initialState.hasElectronAuth || initialState.hasPending;
  const effectiveCallbackUrlForRender = callbackUrl || storedCallbackUrlForRender;

  // Show loading screen immediately if we have autoSignIn params or pending electron auth
  // This prevents the main page from flashing before we decide what to do
  const shouldShowLoadingScreen = initialState.hasAutoSignIn || initialState.hasPending || isAutoSignIn || effectiveIsElectronAuthForRender;

  // For Electron flow: Show "return to app" screen after successful auth
  if (effectiveIsElectronAuthForRender && !isLoading && isAuthenticated) {
    // If we have a callback URL, show redirecting message
    if (effectiveCallbackUrlForRender) {
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

  // For Electron flow: Show error screen (side effects handled in useEffect above)
  if (effectiveIsElectronAuthForRender && authError) {
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

  // For Electron flow: Show timeout error if callback didn't work
  if (effectiveIsElectronAuthForRender && callbackTimedOut) {
    return (
      <div className="fixed inset-0 bg-[var(--tropx-bg)] flex items-center justify-center z-[9999]">
        <div className="text-center p-8 max-w-md">
          {/* Warning Icon */}
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
            <svg className="w-10 h-10 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <h1 className="text-2xl font-semibold text-[var(--tropx-text-main)] mb-3">
            Connection Issue
          </h1>
          <p className="text-[var(--tropx-text-sub)] mb-4">
            Unable to connect back to TropX Motion. The app may have been closed.
          </p>
          <p className="text-sm text-[var(--tropx-shadow)]">
            Please close this tab and try signing in again from the app.
          </p>
        </div>
      </div>
    );
  }

  // Show loading screen for Electron auth while processing
  if (effectiveIsElectronAuthForRender && isLoading) {
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

  // Show loading screen while redirecting to Google or waiting for auth
  // Use shouldShowLoadingScreen to prevent flash on first render
  if (shouldShowLoadingScreen) {
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
            Please wait...
          </p>
        </div>
      </div>
    );
  }

  return null;
}

export default AutoSignIn;
