import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface IslandButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode
  label: string
  /** Short label shown at 1200px-1700px (optional) */
  shortLabel?: string
  /** Hide label entirely below 1700px (icons only until 1700px) */
  hideLabel?: boolean
  /** Show full label at 1200px instead of 1700px */
  showFullAt1200?: boolean
  highlighted?: boolean
  grouped?: boolean
}

// Standalone island button with shadow
export const IslandButton = forwardRef<HTMLButtonElement, IslandButtonProps>(
  ({ icon, label, shortLabel, hideLabel = false, showFullAt1200 = false, highlighted = false, grouped = false, className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        data-highlighted={highlighted}
        className={cn(
          'inline-flex items-center gap-2.5 px-6 py-4 text-sm font-medium cursor-pointer whitespace-nowrap border-transparent',
          'text-[var(--tropx-shadow)]',
          'data-[highlighted=true]:text-[var(--tropx-vibrant)]',
          !grouped && 'bg-white rounded-full island-shadow',
          className
        )}
        {...props}
      >
        {icon}
        {/* Full label visibility logic */}
        <span className={cn(
          // If shortLabel is provided: show full label at lg (1700px+)
          shortLabel && 'hidden actionbar-lg:inline',
          // If showFullAt1200 (no shortLabel): show full label at md (1200px+)
          showFullAt1200 && !shortLabel && 'hidden actionbar-md:inline',
          // If hideLabel is true (no shortLabel, no showFullAt1200): show label only at lg (1700px+)
          hideLabel && !shortLabel && !showFullAt1200 && 'hidden actionbar-lg:inline'
        )}>
          {label}
        </span>
        {/* Short label - shown at 1200px-1700px (hidden below 1200px and above 1700px) */}
        {shortLabel && (
          <span className="hidden actionbar-sm:inline actionbar-lg:hidden">
            {shortLabel}
          </span>
        )}
      </button>
    )
  }
)

IslandButton.displayName = 'IslandButton'
