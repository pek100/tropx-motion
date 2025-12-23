/**
 * Offline Indicator - Shows connection status and pending mutations
 *
 * Displays:
 * - Offline badge when disconnected
 * - Pending mutation count
 * - Sync button to manually sync when back online
 */

import { useState } from "react";
import { WifiOff, Cloud, CloudOff, RefreshCw, Check } from "lucide-react";
import { useCacheOptional } from "@/lib/cache";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface OfflineIndicatorProps {
  className?: string;
  /** Show only when offline (default: false - always show status) */
  hideWhenOnline?: boolean;
}

export function OfflineIndicator({
  className,
  hideWhenOnline = false,
}: OfflineIndicatorProps) {
  const cache = useCacheOptional();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState<{
    success: number;
    failed: number;
  } | null>(null);

  // If cache not available, use navigator.onLine
  const isOnline = cache?.isOnline ?? navigator.onLine;
  const pendingCount = cache?.pendingMutations ?? 0;

  // Hide when online if requested
  if (hideWhenOnline && isOnline && pendingCount === 0) {
    return null;
  }

  const handleSync = async () => {
    if (!cache?.syncMutations || isSyncing) return;

    setIsSyncing(true);
    try {
      const result = await cache.syncMutations();
      setLastSyncResult(result);
      // Clear result after 3 seconds
      setTimeout(() => setLastSyncResult(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <TooltipProvider>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
          isOnline
            ? pendingCount > 0
              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-red-500/10 text-red-600 dark:text-red-400",
          className
        )}
      >
        {/* Status Icon */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5">
              {isOnline ? (
                pendingCount > 0 ? (
                  <Cloud className="size-3.5" />
                ) : (
                  <Check className="size-3.5" />
                )
              ) : (
                <WifiOff className="size-3.5" />
              )}
              <span>
                {isOnline
                  ? pendingCount > 0
                    ? `${pendingCount} pending`
                    : "Synced"
                  : "Offline"}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {isOnline
              ? pendingCount > 0
                ? `${pendingCount} change(s) waiting to sync`
                : "All changes synced"
              : "No internet connection. Changes will sync when online."}
          </TooltipContent>
        </Tooltip>

        {/* Sync Button (only when online with pending changes) */}
        {isOnline && pendingCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className={cn(
                  "p-1 rounded-full hover:bg-amber-500/20 transition-colors",
                  isSyncing && "animate-spin"
                )}
              >
                <RefreshCw className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Sync now</TooltipContent>
          </Tooltip>
        )}

        {/* Last sync result */}
        {lastSyncResult && (
          <span className="text-[10px] opacity-75">
            {lastSyncResult.success > 0 && `✓${lastSyncResult.success}`}
            {lastSyncResult.failed > 0 && ` ✗${lastSyncResult.failed}`}
          </span>
        )}
      </div>
    </TooltipProvider>
  );
}

/**
 * Compact version for tight spaces (e.g., header)
 */
export function OfflineIndicatorCompact({ className }: { className?: string }) {
  const cache = useCacheOptional();

  const isOnline = cache?.isOnline ?? navigator.onLine;
  const pendingCount = cache?.pendingMutations ?? 0;

  // Only show when offline or has pending mutations
  if (isOnline && pendingCount === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center justify-center size-8 rounded-full transition-all",
              isOnline
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400",
              className
            )}
          >
            {isOnline ? (
              <span className="text-xs font-bold">{pendingCount}</span>
            ) : (
              <WifiOff className="size-4" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {isOnline
            ? `${pendingCount} change(s) pending sync`
            : "You're offline"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default OfflineIndicator;
