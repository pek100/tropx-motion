/**
 * columns.tsx - TanStack Table column definitions for MetricsDataTable.
 * Shows per-leg values (Left/Right) and combined value for bilateral metrics.
 */

import { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type MetricDomain = "opi" | "range" | "symmetry" | "power" | "control" | "timing";

export interface MetricRow {
  id: string;
  name: string;
  domain: MetricDomain;
  unit: string;
  /** Combined/bilateral value (for non per-leg metrics) */
  value: number | undefined;
  /** Left leg value (for per-leg metrics) */
  leftValue: number | undefined;
  /** Right leg value (for per-leg metrics) */
  rightValue: number | undefined;
  /** Whether this metric has per-leg values */
  perLeg: boolean;
  trend: "up" | "down" | "stable" | undefined;
  trendPercent: number | undefined;
  direction: "higher_better" | "lower_better" | "optimal_range";
  format: (value: number) => string;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DOMAIN_CONFIG: Record<MetricDomain, { label: string; bgClass: string; textClass: string }> = {
  opi: {
    label: "Score",
    bgClass: "bg-[var(--tropx-vibrant)]/10",
    textClass: "text-[var(--tropx-vibrant)]",
  },
  range: {
    label: "Range",
    bgClass: "bg-emerald-100 dark:bg-emerald-900/30",
    textClass: "text-emerald-700 dark:text-emerald-300",
  },
  symmetry: {
    label: "Balance",
    bgClass: "bg-purple-100 dark:bg-purple-900/30",
    textClass: "text-purple-700 dark:text-purple-300",
  },
  power: {
    label: "Power",
    bgClass: "bg-orange-100 dark:bg-orange-900/30",
    textClass: "text-orange-700 dark:text-orange-300",
  },
  control: {
    label: "Control",
    bgClass: "bg-cyan-100 dark:bg-cyan-900/30",
    textClass: "text-cyan-700 dark:text-cyan-300",
  },
  timing: {
    label: "Timing",
    bgClass: "bg-pink-100 dark:bg-pink-900/30",
    textClass: "text-pink-700 dark:text-pink-300",
  },
};

// ─────────────────────────────────────────────────────────────────
// Sortable Header Component
// ─────────────────────────────────────────────────────────────────

interface SortableHeaderProps {
  column: any;
  children: React.ReactNode;
  className?: string;
}

function SortableHeader({ column, children, className }: SortableHeaderProps) {
  const sorted = column.getIsSorted();

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-8 -ml-3 font-semibold text-[var(--tropx-text-sub)]", className)}
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {children}
      {sorted === "asc" ? (
        <ArrowUp className="ml-1 size-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDown className="ml-1 size-3.5" />
      ) : (
        <ArrowUpDown className="ml-1 size-3.5 opacity-50" />
      )}
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Column Definitions
// ─────────────────────────────────────────────────────────────────

export const columns: ColumnDef<MetricRow>[] = [
  // Checkbox for chart selection
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
        className="translate-y-[2px] data-[state=checked]:bg-orange-500 dark:data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 dark:data-[state=checked]:border-orange-500 data-[state=indeterminate]:bg-orange-500 dark:data-[state=indeterminate]:bg-orange-500 data-[state=indeterminate]:border-orange-500 dark:data-[state=indeterminate]:border-orange-500"
      />
    ),
    cell: ({ row }) => {
      return (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select row"
          className="translate-y-[2px] data-[state=checked]:bg-orange-500 dark:data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500 dark:data-[state=checked]:border-orange-500"
        />
      );
    },
    enableSorting: false,
    enableHiding: false,
  },

  // Metric Name
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column}>Metric</SortableHeader>,
    cell: ({ row }) => (
      <div>
        <span className="font-medium text-[var(--tropx-text-main)]">
          {row.original.name}
        </span>
        {row.original.unit && (
          <span className="ml-1 text-xs text-[var(--tropx-text-sub)]">
            {row.original.unit}
          </span>
        )}
      </div>
    ),
  },

  // Category Badge
  {
    accessorKey: "domain",
    header: ({ column }) => <SortableHeader column={column}>Category</SortableHeader>,
    cell: ({ row }) => {
      const config = DOMAIN_CONFIG[row.original.domain];
      return (
        <span
          className={cn(
            "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium border",
            config.bgClass,
            config.textClass,
            row.original.domain === "opi" && "border-[var(--tropx-vibrant)]/20",
            row.original.domain === "range" && "border-emerald-200 dark:border-emerald-800",
            row.original.domain === "symmetry" && "border-purple-200 dark:border-purple-800",
            row.original.domain === "power" && "border-orange-200 dark:border-orange-800",
            row.original.domain === "control" && "border-cyan-200 dark:border-cyan-800",
            row.original.domain === "timing" && "border-pink-200 dark:border-pink-800"
          )}
        >
          {config.label}
        </span>
      );
    },
    filterFn: (row, id, filterValue) => {
      if (!filterValue || filterValue === "all") return true;
      return row.original.domain === filterValue;
    },
  },

  // Left Leg Value
  {
    accessorKey: "leftValue",
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Left
      </SortableHeader>
    ),
    cell: ({ row }) => {
      const { leftValue, perLeg, format } = row.original;
      if (!perLeg) {
        return <span className="text-[var(--tropx-text-sub)] opacity-30 text-right block">—</span>;
      }
      if (leftValue === undefined) {
        return <span className="text-[var(--tropx-text-sub)] opacity-50 text-right block">—</span>;
      }
      return (
        <span className="font-mono text-[var(--tropx-text-main)] text-right block">
          {format(leftValue)}
        </span>
      );
    },
  },

  // Right Leg Value
  {
    accessorKey: "rightValue",
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Right
      </SortableHeader>
    ),
    cell: ({ row }) => {
      const { rightValue, perLeg, format } = row.original;
      if (!perLeg) {
        return <span className="text-[var(--tropx-text-sub)] opacity-30 text-right block">—</span>;
      }
      if (rightValue === undefined) {
        return <span className="text-[var(--tropx-text-sub)] opacity-50 text-right block">—</span>;
      }
      return (
        <span className="font-mono text-[var(--tropx-text-main)] text-right block">
          {format(rightValue)}
        </span>
      );
    },
  },

  // Combined Value (for bilateral metrics) or Average (for per-leg metrics)
  {
    accessorKey: "value",
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Value
      </SortableHeader>
    ),
    cell: ({ row }) => {
      const { value, leftValue, rightValue, perLeg, format } = row.original;

      // For per-leg metrics, show average
      if (perLeg) {
        if (leftValue !== undefined && rightValue !== undefined) {
          const avg = (leftValue + rightValue) / 2;
          return (
            <span className="font-mono text-[var(--tropx-text-sub)] text-right block text-xs">
              avg: {format(avg)}
            </span>
          );
        }
        return <span className="text-[var(--tropx-text-sub)] opacity-50 text-right block">—</span>;
      }

      // For bilateral metrics, show combined value
      if (value === undefined) {
        return <span className="text-[var(--tropx-text-sub)] opacity-50 text-right block">—</span>;
      }
      return (
        <span className="font-mono text-[var(--tropx-text-main)] text-right block">
          {format(value)}
        </span>
      );
    },
  },

  // Trend
  {
    accessorKey: "trendPercent",
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Trend
      </SortableHeader>
    ),
    cell: ({ row }) => {
      const { trend, trendPercent, direction } = row.original;

      if (!trend || trend === "stable") {
        return (
          <div className="flex justify-end">
            <span className="text-[var(--tropx-text-sub)] opacity-75 text-xs">—</span>
          </div>
        );
      }

      const isGood =
        (direction === "higher_better" && trend === "up") ||
        (direction === "lower_better" && trend === "down");

      const Icon = trend === "up" ? TrendingUp : TrendingDown;

      return (
        <div className="flex justify-end">
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium",
              isGood
                ? "bg-[var(--tropx-green)]/10 text-[var(--tropx-green)]"
                : "bg-[var(--tropx-red)]/10 text-[var(--tropx-red)]"
            )}
          >
            <Icon className="size-3.5" />
            {trendPercent !== undefined && `${Math.abs(trendPercent).toFixed(0)}%`}
          </span>
        </div>
      );
    },
  },
];

export default columns;
