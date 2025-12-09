import { cn } from '@/lib/utils'

interface IslandButtonGroupProps {
  children: React.ReactNode
  className?: string
}

// Container for grouped island buttons with shared background and separator
export function IslandButtonGroup({ children, className }: IslandButtonGroupProps) {
  return (
    <div className={cn('island-group', className)}>
      {children}
    </div>
  )
}
