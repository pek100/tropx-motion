"use client";

/**
 * ConvexClientProvider - Root provider for Convex in the web client
 *
 * Simplified version for OAuth redirect handling only.
 * The web client is used to handle Electron OAuth flow.
 */

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { AutoSignIn } from "@/components/auth/AutoSignIn";

// Get Convex URL from environment
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

// Create singleton client
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

interface ConvexClientProviderProps {
  children: ReactNode;
}

export function ConvexClientProvider({ children }: ConvexClientProviderProps) {
  // If Convex is not configured, render children without providers
  if (!convexClient) {
    console.warn(
      "Convex not configured. Set NEXT_PUBLIC_CONVEX_URL in .env.local to enable auth."
    );
    return <>{children}</>;
  }

  return (
    <ConvexAuthProvider client={convexClient}>
      <AutoSignIn />
      {children}
    </ConvexAuthProvider>
  );
}
