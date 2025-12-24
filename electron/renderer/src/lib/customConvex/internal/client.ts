/**
 * Convex client singleton
 */

import { ConvexReactClient } from "convex/react";
import { debug } from "./debug";

// Get Convex URL from environment
// In Electron: preload script injects config
// In web/dev: Vite env variable
const convexUrl =
  (typeof window !== "undefined" && window.electronAPI?.config?.convexUrl) ||
  import.meta.env.VITE_CONVEX_URL;

// Verbose mode for auth debugging (opt-in via URL param or localStorage)
const isVerboseAuth =
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).get("verboseAuth") === "true" ||
    localStorage.getItem("tropx_verbose_auth") === "true");

// Create singleton client
export const convexClient = convexUrl
  ? new ConvexReactClient(convexUrl, { verbose: isVerboseAuth })
  : null;

export const isConvexConfigured = (): boolean => {
  return !!convexUrl && !!convexClient;
};

// Log initialization status in dev
debug.cache.log("URL source:", window.electronAPI?.config?.convexUrl ? "preload" : "vite env");
debug.cache.log("Client created:", !!convexClient);
if (isVerboseAuth) {
  debug.cache.log("Verbose auth logging enabled");
}
