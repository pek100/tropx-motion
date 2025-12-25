import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../../convex/_generated/api";
import { isConvexConfigured, useQuery } from "../lib/customConvex";
import { isElectron } from "../lib/platform";
import { setOAuthInProgress, clearOAuthInProgress } from "../lib/auth/oauthState";

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
    clearOAuthInProgress();

    // Clear all Convex auth tokens from localStorage
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('__convexAuth')) {
        localStorage.removeItem(key);
      }
    }

    await authActions.signOut();

    // In Electron, also clear session cookies
    if (isElectron() && window.electronAPI?.auth?.signOut) {
      await window.electronAPI.auth.signOut().catch(() => {});
    }

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
