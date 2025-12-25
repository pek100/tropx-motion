import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../../convex/_generated/api";
import { isConvexConfigured, useQuery } from "../lib/customConvex";
import { isElectron } from "../lib/platform";

// Track OAuth flow via sessionStorage (shared with App.tsx)
const OAUTH_IN_PROGRESS_KEY = 'tropx_oauth_in_progress';

function setOAuthInProgress(): void {
  sessionStorage.setItem(OAUTH_IN_PROGRESS_KEY, Date.now().toString());
}

function clearOAuthInProgress(): void {
  sessionStorage.removeItem(OAUTH_IN_PROGRESS_KEY);
}

export type UserRole = "physiotherapist" | "patient" | "admin";

export interface CurrentUser {
  _id: string;
  email: string;
  name: string;
  image?: string;
  role?: UserRole;
  contacts: Array<{
    userId: string;
    alias?: string;
    addedAt: number;
  }>;
  needsOnboarding: boolean;
  createdAt?: number;
}

export interface UseCurrentUserResult {
  // Auth state
  isAuthenticated: boolean;
  isLoading: boolean;

  // User data
  user: CurrentUser | null;
  needsOnboarding: boolean;

  // Auth actions
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;

  // Onboarding
  completeOnboarding: (role: "physiotherapist" | "patient") => Promise<void>;

  // Convex status
  isConvexEnabled: boolean;
}

// Disabled state for when Convex is not configured
const DISABLED_RESULT: UseCurrentUserResult = {
  isAuthenticated: false,
  isLoading: false,
  user: null,
  needsOnboarding: false,
  signIn: async () => {
    console.warn("Convex not configured");
  },
  signOut: async () => {
    console.warn("Convex not configured");
  },
  completeOnboarding: async () => {
    console.warn("Convex not configured");
  },
  isConvexEnabled: false,
};

// Hook that uses Convex - only call when Convex is configured
function useCurrentUserEnabled(): UseCurrentUserResult {
  const authActions = useAuthActions();
  const userData = useQuery(api.users.getMe, {});
  const completeOnboardingMutation = useMutation(api.users.completeOnboarding);

  const isLoading = userData === undefined;
  const isAuthenticated = userData !== null && userData !== undefined;
  const needsOnboarding = userData?.needsOnboarding ?? false;

  const signIn = async () => {
    // Mark OAuth as in progress before redirecting
    setOAuthInProgress();
    await authActions.signIn("google");
  };

  const signOut = async () => {
    // Clear OAuth tracking
    clearOAuthInProgress();

    // Clear all Convex auth tokens from localStorage
    // This ensures both namespaced and non-namespaced keys are removed
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('__convexAuth')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log('[useCurrentUser] Cleared localStorage keys:', keysToRemove);

    // Call Convex Auth signOut
    await authActions.signOut();

    // In Electron, also call the main process sign out to clear session cookies
    if (isElectron() && window.electronAPI?.auth?.signOut) {
      try {
        await window.electronAPI.auth.signOut();
        console.log('[useCurrentUser] Cleared Electron session');
      } catch (err) {
        console.error('[useCurrentUser] Failed to clear Electron session:', err);
      }
    }

    // Refresh the page to clear all cached data and show unauthenticated state
    window.location.reload();
  };

  const completeOnboarding = async (role: "physiotherapist" | "patient") => {
    await completeOnboardingMutation({ role });
  };

  return {
    isAuthenticated,
    isLoading,
    user: isAuthenticated ? (userData as CurrentUser) : null,
    needsOnboarding,
    signIn,
    signOut,
    completeOnboarding,
    isConvexEnabled: true,
  };
}

// Main hook - checks if Convex is configured first
export function useCurrentUser(): UseCurrentUserResult {
  const isEnabled = isConvexConfigured();

  // This is safe because isConvexConfigured() returns a constant
  // (determined at module load time), so the branch is always the same
  if (!isEnabled) {
    return DISABLED_RESULT;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useCurrentUserEnabled();
}

export default useCurrentUser;
