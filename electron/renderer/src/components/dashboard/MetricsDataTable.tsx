/**
 * MetricsDataTable - TanStack React Table for session metrics.
 * Features: row selection for chart, sorting, filtering, pagination.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { columns, type MetricRow } from "./columns";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface MetricsDataTableProps {
  data: MetricRow[];
  sessionTitle?: string;
  selectedMetrics?: Set<string>;
  onSelectionChange?: (selected: Set<string>) => void;
  borderless?: boolean;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DOMAIN_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All Categories" },
  { value: "symmetry", label: "Symmetry" },
  { value: "power", label: "Power" },
  { value: "control", label: "Control" },
  { value: "stability", label: "Stability" },
];

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function MetricsDataTable({
  data,
  sessionTitle,
  selectedMetrics,
  onSelectionChange,
  borderless,
  className,
}: MetricsDataTableProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // Initialize row selection from selectedMetrics prop (only on mount/data change)
  useEffect(() => {
    if (selectedMetrics && data.length > 0) {
      const newSelection: RowSelectionState = {};
      data.forEach((row) => {
        if (selectedMetrics.has(row.id)) {
          newSelection[row.id] = true;
        }
      });
      setRowSelection(newSelection);
    }
  }, [data]); // Only run when data changes, not selectedMetrics (to avoid loops)

  // Sync row selection changes back to parent
  const handleRowSelectionChange = useCallback(
    (updater: RowSelectionState | ((old: RowSelectionState) => RowSelectionState)) => {
      setRowSelection((prev) => {
        const newSelection = typeof updater === "function" ? updater(prev) : updater;

        // Sync to parent
        if (onSelectionChange) {
          const selected = new Set<string>();
          Object.keys(newSelection).forEach((id) => {
            if (newSelection[id]) {
              selected.add(id);
            }
          });
          onSelectionChange(selected);
        }

        return newSelection;
      });
    },
    [onSelectionChange]
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      columnFilters,
      globalFilter,
      sorting,
      rowSelection,
    },
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onRowSelectionChange: handleRowSelectionChange,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    getRowId: (row) => row.id,
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  });

  const domainFilter = useMemo(() => {
    const filter = columnFilters.find((f) => f.id === "domain");
    return (filter?.value as string) || "all";
  }, [columnFilters]);

  const handleDomainFilter = (value: string) => {
    if (value === "all") {
      setColumnFilters((prev) => prev.filter((f) => f.id !== "domain"));
    } else {
      setColumnFilters((prev) => {
        const existing = prev.filter((f) => f.id !== "domain");
        return [...existing, { id: "domain", value }];
      });
    }
  };

  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const totalRowCount = data.length;
  const selectedCount = Object.keys(rowSelection).length;

  return (
    <div
      className={cn(
        "bg-[var(--tropx-card)] flex flex-col",
        borderless
          ? "rounded-none border-0 shadow-none sm:rounded-xl sm:border sm:border-[var(--tropx-border)] sm:shadow-sm"
          : "rounded-xl border border-[var(--tropx-border)] shadow-sm",
        className
      )}
    >
      {/* Header */}
      <div className="px-6 py-5 border-b border-[var(--tropx-border)] flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="font-bold text-lg text-[var(--tropx-text-main)]">
            Session Analysis Data
          </h3>
          <p className="text-sm text-[var(--tropx-text-sub)]">
            {sessionTitle
              ? `Metrics for ${sessionTitle}`
              : "Select a session to view metrics"}
            {selectedCount > 0 && (
              <span className="ml-2 text-[var(--tropx-vibrant)]">
                ({selectedCount} selected for chart)
              </span>
            )}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Search */}
          <div className="relative flex-grow md:flex-grow-0">
            <Search className="absolute left-2.5 top-2.5 size-4 text-[var(--tropx-text-sub)]" />
            <Input
              placeholder="Filter metrics..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              className="pl-9 w-full md:w-64 h-9"
            />
          </div>

          {/* Category filter */}
          <Select value={domainFilter} onValueChange={handleDomainFilter}>
            <SelectTrigger className="w-[150px] h-9">
              <SlidersHorizontal className="size-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOMAIN_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto flex-1">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="bg-[var(--tropx-muted)] hover:bg-[var(--tropx-muted)]"
              >
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="h-10 px-6 text-xs uppercase tracking-wider"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => {
                const isOpi = row.original.id === "opiScore";
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    onClick={() => !isOpi && row.toggleSelected()}
                    className={cn(
                      "group transition-colors",
                      isOpi ? "cursor-default" : "cursor-pointer hover:bg-[var(--tropx-muted)]",
                      row.getIsSelected() && "gradient-selection"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-6 py-4">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center text-[var(--tropx-text-sub)]"
                >
                  {data.length === 0
                    ? "No metrics available"
                    : "No results match your filter"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="px-6 py-4 border-t border-[var(--tropx-border)] flex items-center justify-between">
        <p className="text-sm text-[var(--tropx-text-sub)]">
          Showing{" "}
          <span className="font-medium text-[var(--tropx-text-main)]">
            {table.getState().pagination.pageIndex *
              table.getState().pagination.pageSize +
              1}
          </span>{" "}
          to{" "}
          <span className="font-medium text-[var(--tropx-text-main)]">
            {Math.min(
              (table.getState().pagination.pageIndex + 1) *
                table.getState().pagination.pageSize,
              filteredRowCount
            )}
          </span>{" "}
          of{" "}
          <span className="font-medium text-[var(--tropx-text-main)]">
            {filteredRowCount}
          </span>{" "}
          metrics
          {filteredRowCount !== totalRowCount && (
            <span className="text-[var(--tropx-text-sub)]"> (filtered from {totalRowCount})</span>
          )}
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

export default MetricsDataTable;
