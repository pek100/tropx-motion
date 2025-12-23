/**
 * ConnectionStatusBar - Floating pill at top showing connection status
 *
 * Behavior:
 * - Slides down from top when offline (red pill)
 * - Shows "Back online!" (green pill) for 3s when reconnected, then slides up
 *
 * Detection: Fast heartbeat approach
 * - Pings Convex deployment every 2s with 1.5s timeout
 * - Combined with browser events for instant OS-level hints
 * - Much faster than waiting for WebSocket timeout
 */

import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useCacheOptional } from "@/lib/cache";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const CONNECTED_DISPLAY_DURATION_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 2000; // Check every 2 seconds
const HEARTBEAT_TIMEOUT_MS = 1500; // Fail fast after 1.5 seconds

// Convex deployment URL for heartbeat (same origin, no CORS issues)
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string;

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function ConnectionStatusBar() {
  const cache = useCacheOptional();

  // Heartbeat-based connectivity (fast and reliable)
  const [heartbeatOnline, setHeartbeatOnline] = useState(true);

  // Browser-level connectivity (instant OS-level hint)
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);

  // Combined: offline if EITHER says offline
  const isOnline = browserOnline && heartbeatOnline;

  // Fast heartbeat to Convex deployment
  useEffect(() => {
    let mounted = true;

    const checkHeartbeat = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);

        // HEAD request to Convex URL (lightweight, same origin)
        await fetch(CONVEX_URL, {
          method: "HEAD",
          mode: "no-cors",
          cache: "no-store",
          signal: controller.signal,
        });

        clearTimeout(timeout);
        if (mounted) setHeartbeatOnline(true);
      } catch {
        if (mounted) setHeartbeatOnline(false);
      }
    };

    // Initial check
    checkHeartbeat();

    // Fast interval
    const interval = setInterval(checkHeartbeat, HEARTBEAT_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Listen to browser online/offline events (instant hints)
  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Track UI state - isVisible controls the slide animation
  const [isVisible, setIsVisible] = useState(false);
  const [status, setStatus] = useState<"offline" | "reconnected">("offline");

  // Track previous state
  const prevOnlineRef = useRef(true);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const pendingCount = cache?.pendingMutations ?? 0;

  // Track if this is the first render
  const isFirstRenderRef = useRef(true);

  // Handle status changes
  useEffect(() => {
    // Skip first render
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    // Clear any pending hide timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    const wasOnline = prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (!isOnline && wasOnline) {
      // Going offline - slide down
      setStatus("offline");
      setIsVisible(true);
    } else if (isOnline && !wasOnline) {
      // Just reconnected - show "Back online!" then slide up
      setStatus("reconnected");
      setIsVisible(true);

      hideTimeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, CONNECTED_DISPLAY_DURATION_MS);
    }

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [isOnline]);

  const isReconnected = status === "reconnected";

  return (
    <>
      {/* Spacer - pushes content down when header is visible */}
      <div
        className={cn(
          "w-full transition-all duration-300 ease-out",
          isVisible ? "h-10" : "h-0"
        )}
      />

      {/* Fixed full-width header at top */}
      <div
        className={cn(
          "fixed top-0 left-0 right-0 z-50",
          "transition-all duration-300 ease-out",
          isVisible
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0 pointer-events-none"
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center gap-2 py-2.5 px-4",
            "text-sm font-medium",
            isReconnected
              ? "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-b border-emerald-200 dark:border-emerald-800"
              : "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 border-b border-red-200 dark:border-red-800"
          )}
        >
          {isReconnected ? (
            <Wifi className="size-4" />
          ) : (
            <WifiOff className="size-4" />
          )}
          <span>
            {isReconnected ? (
              "Back online!"
            ) : (
              <>
                You're offline
                {pendingCount > 0 && (
                  <span className="ml-1 opacity-75">
                    · {pendingCount} change{pendingCount !== 1 ? "s" : ""} pending
                  </span>
                )}
              </>
            )}
          </span>
        </div>
      </div>
    </>
  );
}

export default ConnectionStatusBar;
