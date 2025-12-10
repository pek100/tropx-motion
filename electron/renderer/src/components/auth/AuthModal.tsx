"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Loader2 } from "lucide-react";
import { isConvexConfigured } from "../../lib/convex";
import { useAuthActions } from "@convex-dev/auth/react";
import { isElectron } from "../../lib/platform";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// Inner component that uses hooks - only rendered when Convex is configured
function AuthModalContent({
  open,
  onOpenChange,
  onSuccess,
}: AuthModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signIn } = useAuthActions();

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (isElectron() && window.electronAPI?.auth) {
        // Electron: Use popup OAuth flow via web app
        console.log('[AuthModal] Using Electron OAuth popup flow');
        const result = await window.electronAPI.auth.signInWithGoogle();

        if (result.success) {
          console.log('[AuthModal] OAuth successful');
          onOpenChange(false);
          onSuccess?.();
          // Reload the page to pick up the new auth state
          window.location.reload();
        } else {
          setError(result.error || "Failed to sign in. Please try again.");
          setIsLoading(false);
        }
      } else {
        // Web: Use Convex Auth directly
        console.log('[AuthModal] Using Convex Auth (web)');
        await signIn("google");
        // Convex Auth handles the redirect, no need to do anything else
      }
    } catch (err) {
      console.error("Sign in error:", err);
      setError("Failed to sign in. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <AuthModalUI
      open={open}
      onOpenChange={onOpenChange}
      isLoading={isLoading}
      error={error}
      onGoogleSignIn={handleGoogleSignIn}
    />
  );
}

// UI-only component - no hooks
function AuthModalUI({
  open,
  onOpenChange,
  isLoading,
  error,
  onGoogleSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  error: string | null;
  onGoogleSignIn: () => void;
}) {

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="space-y-4">
          {/* TropX Branding */}
          <div className="mx-auto flex h-20 w-20 items-center justify-center">
            <svg
              width="80"
              height="80"
              viewBox="0 0 1024 1024"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M536.573 188.5C480.508 217.268 427.514 275.625 441.339 293.707C458.235 315.077 528.125 283.844 583.423 229.597C645.632 167.952 620.288 146.582 536.573 188.5Z"
                fill="var(--tropx-vibrant)"
              />
              <path
                d="M753.405 396.365C627.93 499.319 494.412 599.86 487.977 595.838C484.76 594.229 480.738 549.187 478.325 497.71C471.89 367.409 452.587 326.388 397.892 326.388C348.828 326.388 279.656 410.038 191.985 575.73C116.378 718.9 98.6828 808.18 138.899 840.353C150.964 850.005 167.051 857.244 175.898 857.244C199.224 857.244 260.352 823.462 326.307 773.594L385.023 729.356L406.74 771.181C452.587 862.874 525.78 873.331 658.494 807.376C699.515 786.463 771.904 739.812 818.555 702.813C899.792 640.076 986.66 563.665 986.66 555.622C986.66 553.209 960.117 570.099 927.14 591.816C817.751 665.814 673.777 728.552 615.061 728.552C583.692 728.552 534.628 701.205 515.324 673.053L496.02 644.098L537.845 607.903C675.385 490.471 853.141 327.193 848.315 322.367C847.511 320.758 804.078 353.736 753.405 396.365ZM389.849 566.882C396.284 603.077 398.697 637.663 396.284 644.098C393.871 650.532 375.371 664.206 355.263 673.858C321.481 690.748 316.655 690.748 296.547 679.488C265.983 662.597 262.765 616.75 289.308 576.534C316.655 535.513 359.285 493.688 370.545 497.71C375.371 499.319 384.219 529.883 389.849 566.882Z"
                fill="var(--tropx-vibrant)"
              />
            </svg>
          </div>

          <DialogTitle className="text-center text-2xl font-bold">
            Welcome to TropX Motion
          </DialogTitle>

          <DialogDescription className="text-center text-base">
            Sign in to sync your recordings to the cloud and access them from
            anywhere.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {/* Google Sign In Button */}
          <Button
            onClick={onGoogleSignIn}
            disabled={isLoading}
            size="lg"
            className="w-full relative group"
            variant="outline"
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <svg
                className="mr-2 h-5 w-5"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
            )}
            {isLoading ? "Signing in..." : "Continue with Google"}
          </Button>

          {/* Error Message */}
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Features Info */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
            <h4 className="font-semibold text-sm">Cloud Features:</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li className="flex items-start">
                <span className="mr-2 text-[var(--tropx-vibrant)]">✓</span>
                <span>Sync recordings across devices</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-[var(--tropx-vibrant)]">✓</span>
                <span>Manage patient contacts</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2 text-[var(--tropx-vibrant)]">✓</span>
                <span>Share recordings securely</span>
              </li>
            </ul>
          </div>

          {/* Terms */}
          <p className="text-center text-xs text-muted-foreground">
            By signing in, you agree to our{" "}
            <a href="#" className="underline hover:text-foreground">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="underline hover:text-foreground">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Main export - checks if Convex is configured
export function AuthModal({ open, onOpenChange, onSuccess }: AuthModalProps) {
  // If Convex not configured, don't render anything
  if (!isConvexConfigured()) {
    return null;
  }

  return (
    <AuthModalContent
      open={open}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />
  );
}

export default AuthModal;
