/**
 * columns.tsx - TanStack Table column definitions for MetricsDataTable.
 * Includes checkbox for chart selection and sortable headers.
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

export type MetricDomain = "opi" | "symmetry" | "power" | "control" | "stability";

export interface MetricRow {
  id: string;
  name: string;
  domain: MetricDomain;
  unit: string;
  value: number | undefined;
  reference: number | undefined;
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
    label: "OPI",
    bgClass: "bg-[var(--tropx-vibrant)]/10",
    textClass: "text-[var(--tropx-vibrant)]",
  },
  symmetry: {
    label: "Symmetry",
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
  stability: {
    label: "Stability",
    bgClass: "bg-emerald-100 dark:bg-emerald-900/30",
    textClass: "text-emerald-700 dark:text-emerald-300",
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
      <span className="font-medium text-[var(--tropx-text-main)]">
        {row.original.name}
      </span>
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
            row.original.domain === "symmetry" && "border-purple-200 dark:border-purple-800",
            row.original.domain === "power" && "border-orange-200 dark:border-orange-800",
            row.original.domain === "control" && "border-cyan-200 dark:border-cyan-800",
            row.original.domain === "stability" && "border-emerald-200 dark:border-emerald-800",
            row.original.domain === "opi" && "border-[var(--tropx-vibrant)]/20"
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

  // Value
  {
    accessorKey: "value",
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Value
      </SortableHeader>
    ),
    cell: ({ row }) => {
      const { value, format, unit } = row.original;
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

  // Reference (Average)
  {
    accessorKey: "reference",
    header: ({ column }) => (
      <SortableHeader column={column} className="justify-end">
        Reference
      </SortableHeader>
    ),
    cell: ({ row }) => {
      const { reference, format } = row.original;
      if (reference === undefined) {
        return <span className="text-[var(--tropx-text-sub)] opacity-50 text-right block">—</span>;
      }
      return (
        <span className="font-mono text-[var(--tropx-text-sub)] text-right block">
          {format(reference)}
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
