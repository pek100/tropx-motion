/**
 * MetricsTableModal - Full-screen modal for the MetricsDataTable.
 * Uses the same animation pattern as PhaseAdjustModal.
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { MetricsDataTable } from "./MetricsDataTable";
import type { MetricRow } from "./columns";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface MetricsTableModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: MetricRow[];
  sessionTitle?: string;
  selectedMetrics?: Set<string>;
  onSelectionChange?: (selected: Set<string>) => void;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function MetricsTableModal({
  open,
  onOpenChange,
  data,
  sessionTitle,
  selectedMetrics,
  onSelectionChange,
}: MetricsTableModalProps) {
  const handleClose = () => onOpenChange(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Blur overlay with fade animation */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 modal-blur-overlay cursor-default",
            "data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]",
            "data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]"
          )}
          style={{
            willChange: "opacity",
            transform: "translateZ(0)",
          }}
          onClick={handleClose}
        />

        {/* Modal content with bubble animation */}
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-[51] m-auto",
            "w-[95vw] max-w-5xl h-[90vh] flex flex-col",
            "bg-[var(--tropx-card)] rounded-2xl shadow-lg border border-[var(--tropx-border)]",
            "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
            "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]",
            "pointer-events-auto"
          )}
          onPointerDownOutside={handleClose}
          onInteractOutside={handleClose}
        >
          {/* Close button */}
          <button
            type="button"
            onClick={handleClose}
            className={cn(
              "absolute top-4 right-4 z-10",
              "rounded-full p-2 hover:bg-[var(--tropx-muted)] transition-colors cursor-pointer"
            )}
          >
            <X className="size-5 text-[var(--tropx-text-sub)]" />
            <span className="sr-only">Close</span>
          </button>

          {/* Table fills the modal */}
          <MetricsDataTable
            data={data}
            sessionTitle={sessionTitle}
            selectedMetrics={selectedMetrics}
            onSelectionChange={onSelectionChange}
            className="flex-1 rounded-2xl border-0 overflow-hidden"
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default MetricsTableModal;
