"use client";

import { useEffect, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { isElectron } from "../../lib/platform";

/**
 * AutoSignIn Component
 *
 * Handles ?autoSignIn=google URL parameter for direct OAuth flow.
 * When the web app loads with this param, it immediately triggers Google OAuth.
 * Used by Electron app to bypass the sign-in modal and go straight to Google.
 */
export function AutoSignIn() {
  const [triggered, setTriggered] = useState(false);
  const { signIn } = useAuthActions();

  useEffect(() => {
    // Skip in Electron - Electron handles OAuth via popup window
    if (triggered || isElectron()) return;

    const params = new URLSearchParams(window.location.search);
    const autoSignIn = params.get('autoSignIn');

    if (autoSignIn === 'google') {
      console.log('[AutoSignIn] Triggering Google OAuth via URL param');
      setTriggered(true);

      // Clear the URL param to prevent re-triggering on back navigation
      const url = new URL(window.location.href);
      url.searchParams.delete('autoSignIn');
      window.history.replaceState({}, '', url.toString());

      // Trigger Google sign-in - this will redirect to Google OAuth
      signIn("google");
    }
  }, [triggered, signIn]);

  // This component renders nothing - it's purely for side effects
  return null;
}

export default AutoSignIn;
