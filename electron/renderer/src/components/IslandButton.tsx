import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

interface IslandButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode
  label: string
  highlighted?: boolean
  grouped?: boolean
}

// Standalone island button with shadow
export const IslandButton = forwardRef<HTMLButtonElement, IslandButtonProps>(
  ({ icon, label, highlighted = false, grouped = false, className, ...props }, ref) => {
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
        <span>{label}</span>
      </button>
    )
  }
)

IslandButton.displayName = 'IslandButton'
