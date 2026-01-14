import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { DayButton, DayPicker, getDefaultClassNames } from "react-day-picker"

import { cn } from "@/lib/utils"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "p-3 [--cell-size:2rem] bg-[var(--tropx-card)]",
        className
      )}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          "h-[--cell-size] w-[--cell-size] select-none p-0 rounded-md",
          "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-vibrant)]",
          "hover:bg-[var(--tropx-muted)] transition-colors",
          "flex items-center justify-center",
          "aria-disabled:opacity-30 aria-disabled:pointer-events-none",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          "h-[--cell-size] w-[--cell-size] select-none p-0 rounded-md",
          "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-vibrant)]",
          "hover:bg-[var(--tropx-muted)] transition-colors",
          "flex items-center justify-center",
          "aria-disabled:opacity-30 aria-disabled:pointer-events-none",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-[--cell-size] w-full items-center justify-center px-[--cell-size]",
          defaultClassNames.month_caption
        ),
        caption_label: cn(
          "select-none font-medium text-sm text-[var(--tropx-text-main)]",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 select-none rounded-md text-[0.8rem] font-normal",
          "text-[var(--tropx-shadow)]",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        day: cn(
          "group/day relative aspect-square h-full w-full select-none p-0 text-center",
          defaultClassNames.day
        ),
        range_start: cn(
          "bg-[var(--tropx-vibrant)]/20 rounded-l-md",
          defaultClassNames.range_start
        ),
        range_middle: cn(
          "bg-[var(--tropx-vibrant)]/10 rounded-none",
          defaultClassNames.range_middle
        ),
        range_end: cn(
          "bg-[var(--tropx-vibrant)]/20 rounded-r-md",
          defaultClassNames.range_end
        ),
        today: cn(
          "bg-[var(--tropx-muted)] text-[var(--tropx-vibrant)] rounded-md font-semibold",
          defaultClassNames.today
        ),
        outside: cn(
          "text-[var(--tropx-shadow)]/40",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-[var(--tropx-shadow)]/30 pointer-events-none",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              data-slot="calendar"
              ref={rootRef}
              className={cn(className)}
              {...props}
            />
          )
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            )
          }
          return (
            <ChevronRightIcon className={cn("size-4", className)} {...props} />
          )
        },
        DayButton: CalendarDayButton,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <button
      ref={ref}
      type="button"
      data-day={day.date.toLocaleDateString()}
      data-selected={modifiers.selected}
      data-today={modifiers.today}
      data-outside={modifiers.outside}
      data-disabled={modifiers.disabled}
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "flex aspect-square h-auto w-full min-w-[--cell-size] items-center justify-center",
        "rounded-md text-sm font-normal transition-colors",
        "text-[var(--tropx-text-main)]",
        "hover:bg-[var(--tropx-muted)] hover:text-[var(--tropx-vibrant)]",
        // Selected state (single selection)
        "data-[selected=true]:bg-[var(--tropx-vibrant)] data-[selected=true]:text-white data-[selected=true]:font-medium",
        // Range selection states
        "data-[range-start=true]:bg-[var(--tropx-vibrant)] data-[range-start=true]:text-white",
        "data-[range-end=true]:bg-[var(--tropx-vibrant)] data-[range-end=true]:text-white",
        "data-[range-middle=true]:bg-transparent data-[range-middle=true]:text-[var(--tropx-text-main)]",
        // Outside month
        "data-[outside=true]:text-[var(--tropx-shadow)]/40",
        // Disabled
        "data-[disabled=true]:text-[var(--tropx-shadow)]/30 data-[disabled=true]:pointer-events-none",
        // Focus
        "focus:outline-none focus:ring-2 focus:ring-[var(--tropx-vibrant)]/50 focus:ring-offset-1",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar, CalendarDayButton }
