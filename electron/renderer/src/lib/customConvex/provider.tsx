/**
 * ConvexClientProvider - Root provider for Convex with offline support
 *
 * Wraps app with:
 * - ConvexAuthProvider (authentication)
 * - ConnectivityProvider (unified online/offline detection)
 * - CacheProvider (encrypted offline cache)
 * - SyncProvider (proactive query sync)
 */

"use client";

import { ReactNode } from "react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { AutoSignIn } from "../../components/auth/AutoSignIn";
import { convexClient, isConvexConfigured } from "./internal/client";
import { ConnectivityProvider } from "./internal/connectivity";
import { CacheProvider } from "./cache/CacheProvider";
import { SyncProvider } from "./cache/SyncProvider";
import { isElectron } from "../platform";
import { debug } from "./internal/debug";

interface ConvexClientProviderProps {
  children: ReactNode;
}

export function ConvexClientProvider({ children }: ConvexClientProviderProps) {
  // If Convex is not configured, render children without providers
  if (!convexClient) {
    debug.cache.warn(
      "Convex not configured. Set VITE_CONVEX_URL in .env.local to enable cloud features."
    );
    return <>{children}</>;
  }

  // Use separate storage namespace for Electron to avoid conflicts with web app
  const storageNamespace = isElectron() ? "electron" : undefined;

  return (
    <ConvexAuthProvider client={convexClient} storageNamespace={storageNamespace}>
      <AutoSignIn />
      <ConnectivityProvider>
        <CacheProvider>
          <SyncProvider>
            {children}
          </SyncProvider>
        </CacheProvider>
      </ConnectivityProvider>
    </ConvexAuthProvider>
  );
}

export { isConvexConfigured };
