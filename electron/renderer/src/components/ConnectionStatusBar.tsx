/**
 * ConnectionStatusBar - Drawer-style top bar showing connection status
 *
 * Behavior:
 * - Slides down from top when offline (red)
 * - Shows "Back online!" (green) for 3s when reconnected, then slides up
 */

import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useCacheOptional } from "@/lib/cache";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const CONNECTED_DISPLAY_DURATION_MS = 3000;
const PING_INTERVAL_MS = 3000;
const PING_TIMEOUT_MS = 5000;

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function ConnectionStatusBar() {
  const cache = useCacheOptional();

  // Track connection state - start as connected (optimistic)
  const [isOnline, setIsOnline] = useState(true);

  // Track UI state - isVisible controls the slide animation
  const [isVisible, setIsVisible] = useState(false);
  const [status, setStatus] = useState<"offline" | "reconnected">("offline");

  // Track previous state
  const prevOnlineRef = useRef(true);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ping to check actual connectivity (browser events unreliable in Electron)
  useEffect(() => {
    let mounted = true;

    const checkOnline = async () => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

        // Fetch a tiny resource - use Convex health endpoint or Google
        const response = await fetch("https://www.gstatic.com/generate_204", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (mounted && response.ok) {
          setIsOnline(true);
        }
      } catch {
        if (mounted) {
          setIsOnline(false);
        }
      }
    };

    // Initial check after short delay (let app initialize)
    const initialTimeout = setTimeout(checkOnline, 1000);

    // Then check periodically
    const interval = setInterval(checkOnline, PING_INTERVAL_MS);

    return () => {
      mounted = false;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

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

  // Always render - use CSS for drawer animation
  return (
    <div
      className={cn(
        "w-full overflow-hidden transition-all duration-300 ease-out",
        isVisible ? "max-h-12 opacity-100" : "max-h-0 opacity-0"
      )}
    >
      <div
        className={cn(
          "w-full border-b",
          isReconnected
            ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800"
            : "bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800"
        )}
      >
        <div
          className={cn(
            "flex items-center justify-center gap-2 py-2.5 px-4",
            "text-sm font-medium",
            isReconnected
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-red-700 dark:text-red-300"
          )}
        >
          {/* Icon */}
          {isReconnected ? (
            <Wifi className="size-4" />
          ) : (
            <WifiOff className="size-4" />
          )}

          {/* Label */}
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
    </div>
  );
}

export default ConnectionStatusBar;
