"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { AutoSignIn } from "../components/auth/AutoSignIn";

// Initialize Convex client
// In Electron, get from preload; in web/dev, use import.meta.env
const convexUrl =
  (typeof window !== 'undefined' && window.electronAPI?.config?.convexUrl) ||
  import.meta.env.VITE_CONVEX_URL;

console.log('[Convex] URL source:', window.electronAPI?.config?.convexUrl ? 'preload' : 'vite env')
console.log('[Convex] CONVEX_URL:', convexUrl ? 'configured' : 'NOT SET')

// Only create client if URL is configured
const convex = convexUrl ? new ConvexReactClient(convexUrl, {
  verbose: true, // Enable verbose logging for debugging OAuth
}) : null;

console.log('[Convex] Client created:', !!convex)

interface ConvexClientProviderProps {
  children: ReactNode;
}

// Provider component that wraps app with Convex
export function ConvexClientProvider({ children }: ConvexClientProviderProps) {
  // If Convex is not configured, render children without provider
  if (!convex) {
    console.warn(
      "Convex not configured. Set VITE_CONVEX_URL in .env.local to enable cloud features."
    );
    return <>{children}</>;
  }

  return (
    <ConvexAuthProvider client={convex}>
      <AutoSignIn />
      {children}
    </ConvexAuthProvider>
  );
}

// Export client for direct usage if needed
export { convex };

// Check if Convex is configured
export function isConvexConfigured(): boolean {
  return !!convexUrl && !!convex;
}
