/**
 * Unified Connectivity Detection
 *
 * Single source of truth for online/offline state.
 * - Polls every 3 seconds via HEAD request to Convex backend
 * - Requires 2 consecutive failures before marking offline
 * - Exponential backoff on failures: 3s → 6s → 12s → 30s (cap)
 * - Browser events trigger immediate check (not state change)
 * - Proper AbortController cleanup
 */

import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from "react";
import { debug } from "./debug";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000; // 3 seconds
const POLL_TIMEOUT_MS = 2_000; // 2 second timeout per request
const FAILURES_BEFORE_OFFLINE = 2; // Require 2 consecutive failures
const BACKOFF_INTERVALS = [3_000, 6_000, 12_000, 30_000]; // Backoff sequence (3s → 6s → 12s → 30s cap)

// Convex deployment URL for connectivity check
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface ConnectivityState {
  isOnline: boolean;
  isChecking: boolean;
  lastCheckAt: number | null;
  consecutiveFailures: number;
}

interface ConnectivityContextValue {
  isOnline: boolean;
  isChecking: boolean;
  checkNow: () => void;
}

// ─────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────

const ConnectivityContext = createContext<ConnectivityContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────

interface ConnectivityProviderProps {
  children: ReactNode;
}

export function ConnectivityProvider({ children }: ConnectivityProviderProps) {
  const [state, setState] = useState<ConnectivityState>({
    isOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    isChecking: false,
    lastCheckAt: null,
    consecutiveFailures: 0,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffIndexRef = useRef(0);

  // Calculate next poll interval based on backoff
  const getNextInterval = useCallback(() => {
    if (state.isOnline) {
      backoffIndexRef.current = 0;
      return POLL_INTERVAL_MS;
    }
    const interval = BACKOFF_INTERVALS[backoffIndexRef.current] ?? BACKOFF_INTERVALS[BACKOFF_INTERVALS.length - 1];
    return interval;
  }, [state.isOnline]);

  // Perform connectivity check
  const checkConnectivity = useCallback(async () => {
    if (!CONVEX_URL) {
      // No URL configured, assume online
      setState((s) => ({ ...s, isOnline: true, isChecking: false }));
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setState((s) => ({ ...s, isChecking: true }));

    try {
      const timeoutId = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);

      await fetch(CONVEX_URL, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Success - reset failures and backoff
      backoffIndexRef.current = 0;
      setState({
        isOnline: true,
        isChecking: false,
        lastCheckAt: Date.now(),
        consecutiveFailures: 0,
      });

      debug.connectivity.log("Check passed");
    } catch (err) {
      // Ignore abort errors (expected on cleanup)
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }

      setState((prev) => {
        const newFailures = prev.consecutiveFailures + 1;
        const shouldGoOffline = newFailures >= FAILURES_BEFORE_OFFLINE;

        if (shouldGoOffline && prev.isOnline) {
          debug.connectivity.warn(`Going offline after ${newFailures} failures`);
          // Advance backoff
          backoffIndexRef.current = Math.min(
            backoffIndexRef.current + 1,
            BACKOFF_INTERVALS.length - 1
          );
        }

        return {
          isOnline: shouldGoOffline ? false : prev.isOnline,
          isChecking: false,
          lastCheckAt: Date.now(),
          consecutiveFailures: newFailures,
        };
      });
    }
  }, []);

  // Schedule next check
  const scheduleNextCheck = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    const interval = getNextInterval();
    debug.connectivity.log(`Next check in ${interval / 1000}s`);
    timeoutRef.current = setTimeout(() => {
      checkConnectivity().then(scheduleNextCheck);
    }, interval);
  }, [checkConnectivity, getNextInterval]);

  // Initial check and polling setup
  useEffect(() => {
    // Initial check
    checkConnectivity().then(scheduleNextCheck);

    // Browser events trigger immediate check (not direct state change)
    const handleOnline = () => {
      debug.connectivity.log("Browser online event - checking...");
      checkConnectivity();
    };

    const handleOffline = () => {
      debug.connectivity.log("Browser offline event - checking...");
      checkConnectivity();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [checkConnectivity, scheduleNextCheck]);

  // Manual check trigger
  const checkNow = useCallback(() => {
    checkConnectivity();
  }, [checkConnectivity]);

  return (
    <ConnectivityContext.Provider
      value={{
        isOnline: state.isOnline,
        isChecking: state.isChecking,
        checkNow,
      }}
    >
      {children}
    </ConnectivityContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────

export function useConnectivity(): ConnectivityContextValue {
  const context = useContext(ConnectivityContext);
  if (!context) {
    throw new Error("useConnectivity must be used within ConnectivityProvider");
  }
  return context;
}

export function useConnectivityOptional(): ConnectivityContextValue | null {
  return useContext(ConnectivityContext);
}

export function useIsOnline(): boolean {
  const context = useContext(ConnectivityContext);
  return context?.isOnline ?? (typeof navigator !== "undefined" ? navigator.onLine : true);
}
