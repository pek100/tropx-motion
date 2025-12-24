/**
 * ConnectionStatusBar - Floating bar at top showing connection status
 *
 * Behavior:
 * - Slides down from top when offline (red bar)
 * - Shows "Back online!" (green bar) for 3s when reconnected, then slides up
 *
 * Detection:
 * - Uses unified ConnectivityProvider (10s polling with debounce)
 * - No redundant HEAD requests
 */

import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useIsOnline, useCacheOptional } from "@/lib/customConvex";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const CONNECTED_DISPLAY_DURATION_MS = 3000;

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function ConnectionStatusBar() {
  const isOnline = useIsOnline();
  const cache = useCacheOptional();

  // Track UI state - isVisible controls the slide animation
  const [isVisible, setIsVisible] = useState(false);
  const [status, setStatus] = useState<"offline" | "reconnected">("offline");

  // Track previous state
  const prevOnlineRef = useRef(true);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
