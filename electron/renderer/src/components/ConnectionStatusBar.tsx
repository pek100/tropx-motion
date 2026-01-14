/**
 * ConnectionStatusBar - Floating bar at top showing connection status
 *
 * Behavior:
 * - Slides down from top when offline (red bar)
 * - Shows "X days remaining until logout" when offline
 * - Auto-hides after 5 seconds, shows red border indicator
 * - Slides out on hover, slides in immediately on mouse out
 * - Shows "Back online!" (green bar) for 3s when reconnected
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Wifi, WifiOff, AlertTriangle } from "lucide-react";
import { useIsOnline, useCacheOptional } from "@/lib/customConvex";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const CONNECTED_DISPLAY_DURATION_MS = 3000;
const AUTO_COLLAPSE_DELAY_MS = 5000;
const WARNING_THRESHOLD_DAYS = 7; // Show warning styling when <= 7 days remaining

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function ConnectionStatusBar() {
  const isOnline = useIsOnline();
  const cache = useCacheOptional();

  // Track UI state
  const [isExpanded, setIsExpanded] = useState(false); // Full bar visible
  const [isCollapsed, setIsCollapsed] = useState(false); // Only border line visible
  const [status, setStatus] = useState<"offline" | "reconnected" | "hidden">("hidden");
  const [isHovering, setIsHovering] = useState(false);

  // Track previous state
  const prevOnlineRef = useRef(true);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingCount = cache?.pendingMutations ?? 0;
  const leaseValidUntil = cache?.leaseValidUntil;
  const daysRemaining = cache?.leaseDaysRemaining ?? 30;
  const isLeaseExpired = cache?.isLeaseExpired ?? false;

  // Don't show lease warning if lease was never stored (null validUntil)
  const hasLease = leaseValidUntil !== null;

  // Track if this is the first render
  const isFirstRenderRef = useRef(true);

  // Clear all timeouts
  const clearAllTimeouts = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  }, []);

  // Schedule auto-collapse when offline
  const scheduleCollapse = useCallback(() => {
    clearAllTimeouts();
    collapseTimeoutRef.current = setTimeout(() => {
      if (!isHovering) {
        setIsExpanded(false);
        setIsCollapsed(true);
      }
    }, AUTO_COLLAPSE_DELAY_MS);
  }, [clearAllTimeouts, isHovering]);

  // Handle hover - expand the bar
  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    if (isCollapsed) {
      setIsExpanded(true);
      setIsCollapsed(false);
    }
  }, [isCollapsed]);

  // Handle mouse leave - collapse immediately
  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    if (status === "offline" && isExpanded) {
      // Collapse immediately on mouse out
      setIsExpanded(false);
      setIsCollapsed(true);
    }
  }, [status, isExpanded]);

  // Handle status changes
  useEffect(() => {
    // Skip first render
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }

    clearAllTimeouts();

    const wasOnline = prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (!isOnline && wasOnline) {
      // Going offline - slide down, then auto-collapse after 5s
      setStatus("offline");
      setIsExpanded(true);
      setIsCollapsed(false);
      scheduleCollapse();
    } else if (isOnline && !wasOnline) {
      // Just reconnected - show "Back online!" then hide completely
      setStatus("reconnected");
      setIsExpanded(true);
      setIsCollapsed(false);

      hideTimeoutRef.current = setTimeout(() => {
        setIsExpanded(false);
        setIsCollapsed(false);
        setStatus("hidden");
      }, CONNECTED_DISPLAY_DURATION_MS);
    }

    return clearAllTimeouts;
  }, [isOnline, clearAllTimeouts, scheduleCollapse]);

  const isReconnected = status === "reconnected";
  // Only show warning if lease exists and is running low, or if explicitly expired
  const showWarning = hasLease && (daysRemaining <= WARNING_THRESHOLD_DAYS || isLeaseExpired);
  const shouldShowBar = isExpanded || isCollapsed;

  // Don't render anything if hidden
  if (!shouldShowBar) {
    return null;
  }

  return (
    <>
      {/* Spacer - pushes content down when expanded */}
      <div
        className={cn(
          "w-full transition-all duration-300 ease-out",
          isExpanded ? "h-10" : isCollapsed ? "h-1" : "h-0"
        )}
      />

      {/* Container for hover detection */}
      <div
        className="fixed top-0 left-0 right-0 z-50"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Collapsed state - just a red border line */}
        {isCollapsed && !isExpanded && (
          <div
            className={cn(
              "h-1 w-full transition-all duration-150",
              showWarning
                ? "bg-amber-500 dark:bg-amber-600"
                : "bg-red-500 dark:bg-red-600"
            )}
          />
        )}

        {/* Expanded state - full bar */}
        <div
          className={cn(
            "transition-all duration-300 ease-out overflow-hidden",
            isExpanded ? "max-h-20 opacity-100" : "max-h-0 opacity-0"
          )}
        >
          <div
            className={cn(
              "flex items-center justify-center gap-2 py-2.5 px-4",
              "text-sm font-medium",
              isReconnected
                ? "bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 border-b border-emerald-200 dark:border-emerald-800"
                : showWarning
                  ? "bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 border-b border-amber-200 dark:border-amber-800"
                  : "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 border-b border-red-200 dark:border-red-800"
            )}
          >
            {isReconnected ? (
              <Wifi className="size-4" />
            ) : showWarning ? (
              <AlertTriangle className="size-4" />
            ) : (
              <WifiOff className="size-4" />
            )}
            <span>
              {isReconnected ? (
                "Back online!"
              ) : isLeaseExpired ? (
                "Session expired — connect to internet to continue"
              ) : (
                <>
                  You're offline
                  {hasLease && daysRemaining <= WARNING_THRESHOLD_DAYS && (
                    <span className="ml-1 font-semibold">
                      · {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining until logout
                    </span>
                  )}
                  {pendingCount > 0 && (!hasLease || daysRemaining > WARNING_THRESHOLD_DAYS) && (
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
    </>
  );
}

export default ConnectionStatusBar;
