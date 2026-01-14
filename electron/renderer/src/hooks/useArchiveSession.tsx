/**
 * useArchiveSession Hook
 *
 * Reusable hook for archiving sessions with:
 * - Optimistic UI update (instant, via useMutation filter mode)
 * - Toast notification with recover option
 * - Consistent UX across all components
 *
 * IMPORTANT: This uses fire-and-forget mutations.
 * - UI updates INSTANTLY via optimistic update
 * - Server sync happens in background
 * - Server errors are rare and self-heal via Convex subscription
 * - onArchived callback fires after optimistic update, not server confirmation
 */

import { useCallback, useRef } from "react";
import { useMutation } from "@/lib/customConvex";
import { api } from "../../../../convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Loader2 } from "lucide-react";

interface UseArchiveSessionOptions {
  /** Called after optimistic update (UI updated, server sync pending) */
  onArchived?: (sessionId: string) => void;
}

export function useArchiveSession(options: UseArchiveSessionOptions = {}) {
  const archiveSession = useMutation(api.recordingSessions.archiveSession);
  const restoreSession = useMutation(api.recordingSessions.restoreSession);
  const { toast } = useToast();
  // Use ref instead of state to avoid stale closure in toast onClick
  // (state value is captured when toast is created, ref.current is always fresh)
  const isRestoringRef = useRef(false);

  const archive = useCallback(
    (sessionId: string) => {
      // Fire mutation (optimistic update happens synchronously inside useMutation)
      // This is fire-and-forget - no await, no try/catch needed
      archiveSession({ sessionId });

      // Show toast with recover option
      // This runs immediately after optimistic update
      const { dismiss, update } = toast({
        title: "Session deleted",
        description: `You deleted session ${sessionId.slice(-6)}`,
        duration: 6000,
        action: (
          <ToastAction
            altText="Recover"
            onClick={() => {
              // Guard against double-click (ref avoids stale closure issue)
              if (isRestoringRef.current) return;
              isRestoringRef.current = true;

              // Update toast to show restoring state
              update({
                title: "Restoring...",
                description: "Please wait",
                action: (
                  <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--tropx-text-sub)]">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                ),
              });

              // Fire restore mutation (Convex subscription will re-add session)
              restoreSession({ sessionId });

              // Show success after brief delay (gives visual feedback)
              setTimeout(() => {
                dismiss();
                isRestoringRef.current = false;
                toast({
                  title: "Session recovered",
                  description: "The session has been restored",
                  variant: "success",
                  duration: 3000,
                });
              }, 800);
            }}
          >
            Recover
          </ToastAction>
        ),
      });

      // Callback fires after optimistic update
      options.onArchived?.(sessionId);
    },
    [archiveSession, restoreSession, toast, options]
  );

  return { archive };
}
