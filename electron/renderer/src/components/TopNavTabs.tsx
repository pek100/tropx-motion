import { useState, useRef, useEffect } from 'react'
import { CircleUserRound, LayoutDashboard, Disc3, LogOut, Loader2 } from 'lucide-react'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { AuthModal } from './auth'
import { NotificationBell } from './NotificationBell'
import { cn } from '@/lib/utils'

interface NavItem {
  id: string
  label: string
  icon: React.ReactNode
}

export type NavTabId = 'profile' | 'dashboard' | 'record';

interface TopNavTabsProps {
  /** Callback when user clicks "View" on a recording notification */
  onViewRecording?: (sessionId: string) => void;
  /** Current active tab (controlled) */
  activeTab?: NavTabId;
  /** Callback when tab changes */
  onTabChange?: (tabId: NavTabId) => void;
}

export function TopNavTabs({
  onViewRecording,
  activeTab: controlledActiveTab,
  onTabChange,
}: TopNavTabsProps = {}) {
  const [internalActiveTab, setInternalActiveTab] = useState<NavTabId>('record')

  // Use controlled or internal state
  const activeTab = controlledActiveTab ?? internalActiveTab
  const setActiveTab = (tabId: NavTabId) => {
    if (onTabChange) {
      onTabChange(tabId)
    } else {
      setInternalActiveTab(tabId)
    }
  }
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [profilePanelOpen, setProfilePanelOpen] = useState(false)
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false)
  const pillRef = useRef<HTMLDivElement>(null)

  const {
    isAuthenticated,
    isLoading,
    user,
    signOut,
    isConvexEnabled,
  } = useCurrentUser()

  // Toggle profile panel (closes notification)
  const toggleProfilePanel = () => {
    if (profilePanelOpen) {
      setProfilePanelOpen(false)
    } else {
      setNotificationPanelOpen(false)
      setProfilePanelOpen(true)
    }
  }

  // Toggle notification panel (closes profile)
  const toggleNotificationPanel = () => {
    if (notificationPanelOpen) {
      setNotificationPanelOpen(false)
    } else {
      setProfilePanelOpen(false)
      setNotificationPanelOpen(true)
    }
  }

  // Close all panels
  const closeAllPanels = () => {
    setProfilePanelOpen(false)
    setNotificationPanelOpen(false)
  }

  // Close panels when clicking outside or on blur/escape
  useEffect(() => {
    const anyPanelOpen = profilePanelOpen || notificationPanelOpen

    const handleClickOutside = (e: MouseEvent) => {
      if (
        anyPanelOpen &&
        pillRef.current &&
        !pillRef.current.contains(e.target as Node)
      ) {
        closeAllPanels()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && anyPanelOpen) {
        closeAllPanels()
      }
    }

    const handleBlur = () => {
      if (anyPanelOpen) {
        closeAllPanels()
      }
    }

    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('blur', handleBlur)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('blur', handleBlur)
    }
  }, [profilePanelOpen, notificationPanelOpen])

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

    // If authenticated, show profile button + notification bell inside a styled pill
    if (isAuthenticated && user && isConvexEnabled) {
      return (
        <div
          key={item.id}
          ref={pillRef}
          className="relative inline-flex items-center gap-1 px-2 py-1 rounded-full bg-white/80 border border-[var(--tropx-coral)]/30 shadow-sm"
        >
          {/* Profile button */}
          <button
            onClick={toggleProfilePanel}
            className={cn(
              "inline-flex items-center gap-2 px-2 py-1 text-sm font-medium transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 bg-transparent text-[var(--tropx-dark)] hover:text-[var(--tropx-vibrant)]",
              profilePanelOpen && "text-[var(--tropx-vibrant)]"
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>

          <div className="w-px h-4 bg-[var(--tropx-coral)]/30" />

          {/* Notification bell (controlled by parent - dropdown positions relative to pill) */}
          <NotificationBell
            isOpen={notificationPanelOpen}
            onOpenChange={(open) => {
              if (open) {
                toggleNotificationPanel()
              } else {
                setNotificationPanelOpen(false)
              }
            }}
            centerDropdown
            onViewRecording={(sessionId) => {
              closeAllPanels()
              onViewRecording?.(sessionId)
            }}
          />

          {/* Profile Panel - centered under the pill (w-72 = 18rem, half = 9rem = ml-[-9rem]) */}
          {profilePanelOpen && (
            <div
              className={cn(
                "absolute top-full left-1/2 ml-[-9rem] mt-2 w-72 z-50",
                "bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden",
                "animate-[modal-bubble-in_0.15s_var(--spring-bounce)_forwards]"
              )}
            >
              {/* Profile Header */}
              <div className="px-4 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  {user.image ? (
                    <img
                      src={user.image}
                      alt={user.name || 'User'}
                      className="size-12 rounded-full object-cover border-2 border-[var(--tropx-vibrant)]/20"
                    />
                  ) : (
                    <div className="size-12 rounded-full bg-[var(--tropx-hover)] flex items-center justify-center">
                      <CircleUserRound className="size-6 text-[var(--tropx-vibrant)]" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[var(--tropx-dark)] truncate">
                      {user.name || 'User'}
                    </p>
                    <p className="text-sm text-[var(--tropx-shadow)] truncate">
                      {user.email}
                    </p>
                    {user.role && (
                      <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--tropx-hover)] text-[var(--tropx-vibrant)] capitalize">
                        {user.role}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Sign Out Button */}
              <div className="p-3">
                <button
                  onClick={() => {
                    closeAllPanels()
                    handleSignOut()
                  }}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl",
                    "text-sm font-medium text-red-600",
                    "border-2 border-red-200 hover:bg-red-50 hover:border-red-300",
                    "transition-all hover:scale-[1.02] active:scale-[0.98]"
                  )}
                >
                  <LogOut className="size-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
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
              onClick={() => setActiveTab(item.id as NavTabId)}
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
