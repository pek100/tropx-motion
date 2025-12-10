import { useState } from 'react'
import { CircleUserRound, LayoutDashboard, Disc3, LogOut, Loader2 } from 'lucide-react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { AuthModal } from './auth'
import { NotificationBell } from './NotificationBell'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
}

export function TopNavTabs() {
  const [activeTab, setActiveTab] = useState('record')
  const [authModalOpen, setAuthModalOpen] = useState(false)

  const {
    isAuthenticated,
    isLoading,
    user,
    signOut,
    isConvexEnabled,
  } = useCurrentUser()

  // Build nav items dynamically based on auth state
  const getProfileLabel = () => {
    if (!isConvexEnabled) return 'Profile'
    if (isLoading) return 'Loading...'
    if (isAuthenticated && user) {
      // Show first name only
      const firstName = user.name?.split(' ')[0] || 'Profile'
      return firstName
    }
    return 'Sign In'
  }

  const getProfileIcon = () => {
    if (isLoading) {
      return <Loader2 className="size-5 animate-spin" />
    }
    if (isAuthenticated && user?.image) {
      return (
        <img
          src={user.image}
          alt={user.name || 'User'}
          className="size-6 rounded-full border-2 border-[var(--tropx-vibrant)]/30 object-cover"
        />
      )
    }
    return <CircleUserRound className="size-5" />
  }

  const NAV_ITEMS: NavItem[] = [
    { id: 'profile', label: getProfileLabel(), icon: getProfileIcon() },
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> },
    { id: 'record', label: 'Record', icon: <Disc3 className="size-4" /> },
  ]

  const handleProfileClick = () => {
    console.log('[TopNavTabs] handleProfileClick', { isConvexEnabled, isLoading, isAuthenticated })

    if (!isConvexEnabled) {
      console.warn('[TopNavTabs] Convex not enabled')
      return
    }

    if (isLoading) {
      console.log('[TopNavTabs] Still loading...')
      return
    }

    if (!isAuthenticated) {
      console.log('[TopNavTabs] Opening auth modal')
      setAuthModalOpen(true)
    }
    // If authenticated, dropdown handles it
  }

  const handleSignOut = async () => {
    await signOut()
  }

  const renderProfileTab = (item: NavItem) => {
    const buttonClass = `inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 bg-transparent text-[var(--tropx-shadow)] hover:text-[var(--tropx-vibrant)] data-[active=true]:text-[var(--tropx-vibrant)]`

    // If authenticated, show dropdown menu with bell inside a styled pill
    if (isAuthenticated && user && isConvexEnabled) {
      return (
        <div
          key={item.id}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/80 border border-[var(--tropx-coral)]/30 shadow-sm"
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-active={item.id === activeTab}
                className="inline-flex items-center gap-2 px-2 py-1 text-sm font-medium transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 bg-transparent text-[var(--tropx-dark)] hover:text-[var(--tropx-vibrant)]"
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <span className="font-medium">{user.name}</span>
                  <span className="text-xs text-muted-foreground">{user.email}</span>
                  {user.role && (
                    <span className="text-xs text-muted-foreground capitalize mt-1">
                      {user.role}
                    </span>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-red-600">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="w-px h-4 bg-[var(--tropx-coral)]/30" />
          <NotificationBell />
        </div>
      )
    }

    // Not authenticated - show button that opens auth modal
    return (
      <button
        key={item.id}
        data-active={item.id === activeTab}
        className={buttonClass}
        onClick={handleProfileClick}
        disabled={isLoading}
      >
        {item.icon}
        <span>{item.label}</span>
      </button>
    )
  }

  return (
    <>
      <nav className="flex items-center justify-center gap-6 -mt-2 pointer-events-auto">
        {NAV_ITEMS.map((item) => {
          if (item.id === 'profile') {
            return renderProfileTab(item)
          }

          return (
            <button
              key={item.id}
              data-active={item.id === activeTab}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 bg-transparent text-[var(--tropx-shadow)] hover:text-[var(--tropx-vibrant)] data-[active=true]:text-[var(--tropx-vibrant)]"
              onClick={() => setActiveTab(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Auth Modal */}
      <AuthModal
        open={authModalOpen}
        onOpenChange={setAuthModalOpen}
      />
    </>
  )
}
