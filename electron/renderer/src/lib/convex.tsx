"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { AutoSignIn } from "../components/auth/AutoSignIn";
import { CacheProvider } from "./cache";
import { isElectron } from "./platform";

// Initialize Convex client
// In Electron, get from preload; in web/dev, use import.meta.env
const convexUrl =
  (typeof window !== 'undefined' && window.electronAPI?.config?.convexUrl) ||
  import.meta.env.VITE_CONVEX_URL;

// Enable verbose logging for auth debugging (check URL param or localStorage)
const isVerboseAuth = typeof window !== 'undefined' && (
  new URLSearchParams(window.location.search).get('verboseAuth') === 'true' ||
  localStorage.getItem('tropx_verbose_auth') === 'true'
);

console.log('[Convex] URL source:', window.electronAPI?.config?.convexUrl ? 'preload' : 'vite env')
console.log('[Convex] CONVEX_URL:', convexUrl ? 'configured' : 'NOT SET')
if (isVerboseAuth) {
  console.log('[Convex] Verbose auth logging enabled');
}

// Only create client if URL is configured
// Enable verbose mode for auth debugging when requested
const convex = convexUrl ? new ConvexReactClient(convexUrl, {
  verbose: isVerboseAuth,
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

  // Use separate storage namespace for Electron to avoid conflicts with web app
  // Web uses default (convex URL), Electron uses "electron"
  const storageNamespace = isElectron() ? "electron" : undefined;

  return (
    <ConvexAuthProvider client={convex} storageNamespace={storageNamespace}>
      <AutoSignIn />
      <CacheProvider>
        {children}
      </CacheProvider>
    </ConvexAuthProvider>
  );
}

// Export client for direct usage if needed
export { convex };

// Check if Convex is configured
export function isConvexConfigured(): boolean {
  return !!convexUrl && !!convex;
}
