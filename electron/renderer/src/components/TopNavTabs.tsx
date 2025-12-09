import { useState } from 'react'
import { CircleUserRound, LayoutDashboard, Disc3 } from 'lucide-react'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { id: 'patient', label: 'Michael', icon: <CircleUserRound className="size-4" /> },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
  { id: 'record', label: 'Record', icon: <Disc3 className="size-4" /> },
]

export function TopNavTabs() {
  const [activeTab, setActiveTab] = useState('record')

  return (
    <nav className="flex items-center justify-center gap-6 -mt-2 pointer-events-auto">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          data-active={item.id === activeTab}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 bg-transparent text-[var(--tropx-shadow)] hover:text-[var(--tropx-vibrant)] data-[active=true]:text-[var(--tropx-vibrant)]"
          onClick={() => setActiveTab(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
