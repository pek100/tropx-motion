/**
 * SettingsModal - Application settings with tabbed interface
 *
 * Tabs:
 * - General: Theme, notifications
 * - Profile: User info (read-only from OAuth)
 * - Security: Encryption key rotation, cache management
 */

import { useState, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTheme } from "next-themes";
import {
  X,
  Settings2,
  User,
  Shield,
  Key,
  Trash2,
  RefreshCw,
  Loader2,
  Database,
  AlertTriangle,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useCacheOptional } from "@/lib/customConvex";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type TabId = "general" | "profile" | "security";

interface Tab {
  id: TabId;
  label: string;
  icon: typeof Settings2;
}

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const TABS: Tab[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "profile", label: "Profile", icon: User },
  { id: "security", label: "Security", icon: Shield },
];

// ─────────────────────────────────────────────────────────────────
// Tab Content Components
// ─────────────────────────────────────────────────────────────────

type ThemeOption = "light" | "dark" | "system";

const THEME_OPTIONS: { value: ThemeOption; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function GeneralTab() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-[var(--tropx-text-main)] mb-1">
          Appearance
        </h3>
        <p className="text-xs text-[var(--tropx-text-sub)] mb-3">
          Choose how TropX Motion looks to you.
        </p>

        {/* Theme Selector */}
        <div className="flex gap-2">
          {THEME_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isActive = mounted && theme === option.value;

            return (
              <button
                key={option.value}
                onClick={() => setTheme(option.value)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                  "hover:scale-[1.02] active:scale-[0.98]",
                  isActive
                    ? "border-[var(--tropx-vibrant)] bg-[var(--tropx-vibrant)]/10"
                    : "border-[var(--tropx-border)] hover:border-[var(--tropx-shadow)]"
                )}
              >
                <Icon
                  className={cn(
                    "size-5",
                    isActive
                      ? "text-[var(--tropx-vibrant)]"
                      : "text-[var(--tropx-shadow)]"
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    isActive
                      ? "text-[var(--tropx-vibrant)]"
                      : "text-[var(--tropx-text-sub)]"
                  )}
                >
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[var(--tropx-text-main)] mb-1">
          Notifications
        </h3>
        <p className="text-xs text-[var(--tropx-text-sub)] mb-3">
          Manage how you receive notifications.
        </p>
        <div className="p-3 bg-[var(--tropx-muted)] rounded-lg text-xs text-[var(--tropx-shadow)]">
          Notification settings coming soon
        </div>
      </div>
    </div>
  );
}

function ProfileTab() {
  const { user } = useCurrentUser();

  if (!user) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="size-5 animate-spin text-[var(--tropx-vibrant)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Avatar and Name */}
      <div className="flex items-center gap-4">
        {user.image ? (
          <img
            src={user.image}
            alt={user.name}
            className="size-16 rounded-full object-cover border-2 border-[var(--tropx-border)]"
          />
        ) : (
          <div className="size-16 rounded-full bg-[var(--tropx-muted)] flex items-center justify-center">
            <User className="size-8 text-[var(--tropx-shadow)]" />
          </div>
        )}
        <div>
          <h3 className="text-lg font-semibold text-[var(--tropx-text-main)]">
            {user.name}
          </h3>
          <p className="text-sm text-[var(--tropx-text-sub)]">{user.email}</p>
        </div>
      </div>

      {/* Role */}
      <div>
        <label className="text-xs font-medium text-[var(--tropx-text-sub)] uppercase tracking-wide">
          Role
        </label>
        <p className="mt-1 text-sm text-[var(--tropx-text-main)] capitalize">
          {user.role || "Not set"}
        </p>
      </div>

      {/* Info */}
      <div className="p-3 bg-[var(--tropx-muted)] rounded-lg">
        <p className="text-xs text-[var(--tropx-shadow)]">
          Profile information is managed by your Google account.
        </p>
      </div>
    </div>
  );
}

function SecurityTab() {
  const cache = useCacheOptional();
  const [isRotating, setIsRotating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleRotateKey = async () => {
    if (!cache) return;
    setIsRotating(true);
    try {
      await cache.rotateKey();
      setShowRotateConfirm(false);
    } finally {
      setIsRotating(false);
    }
  };

  const handleClearCache = async () => {
    if (!cache) return;
    setIsClearing(true);
    try {
      await cache.clearCache();
      setShowClearConfirm(false);
    } finally {
      setIsClearing(false);
    }
  };

  // If cache isn't available, show a message
  if (!cache) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Shield className="size-8 text-[var(--tropx-shadow)] mb-3" />
        <p className="text-sm text-[var(--tropx-text-sub)]">
          Cache not initialized yet.
        </p>
        <p className="text-xs text-[var(--tropx-shadow)] mt-1">
          Sign in to enable security settings.
        </p>
      </div>
    );
  }

  // Format last rotated date
  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return "Never";
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Encryption Key Section */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Key className="size-4 text-[var(--tropx-vibrant)]" />
          <h3 className="text-sm font-semibold text-[var(--tropx-text-main)]">
            Encryption Key
          </h3>
        </div>
        <p className="text-xs text-[var(--tropx-text-sub)] mb-3">
          Your data is encrypted locally with a unique key.
        </p>

        {/* Key Info */}
        <div className="p-3 bg-[var(--tropx-muted)] rounded-lg space-y-2 mb-3">
          <div className="flex justify-between text-xs">
            <span className="text-[var(--tropx-shadow)]">Key Version</span>
            <span className="text-[var(--tropx-text-main)] font-medium">
              v{cache.kekVersion || 1}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[var(--tropx-shadow)]">Status</span>
            <span
              className={cn(
                "font-medium",
                cache.needsRotation
                  ? "text-[var(--tropx-warning-text)]"
                  : "text-[var(--tropx-green)]"
              )}
            >
              {cache.needsRotation ? "Rotation recommended" : "Active"}
            </span>
          </div>
        </div>

        {/* Rotation Warning/Confirm */}
        {showRotateConfirm ? (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg mb-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-amber-800 dark:text-amber-200 font-medium">
                  This will invalidate cache on all your devices
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  You'll need to re-download data on each device.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowRotateConfirm(false)}
                disabled={isRotating}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--tropx-text-main)] bg-[var(--tropx-card)] border border-[var(--tropx-border)] rounded-lg hover:bg-[var(--tropx-muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRotateKey}
                disabled={isRotating}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isRotating ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                Confirm Rotate
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowRotateConfirm(true)}
            className={cn(
              "w-full px-3 py-2 text-xs font-medium rounded-lg transition-all",
              "flex items-center justify-center gap-2",
              "border-2 border-[var(--tropx-border)] text-[var(--tropx-text-main)]",
              "hover:border-[var(--tropx-vibrant)] hover:text-[var(--tropx-vibrant)]",
              "hover:scale-[1.01] active:scale-[0.99]"
            )}
          >
            <RefreshCw className="size-3.5" />
            Rotate Encryption Key
          </button>
        )}
      </div>

      {/* Local Cache Section */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Database className="size-4 text-[var(--tropx-vibrant)]" />
          <h3 className="text-sm font-semibold text-[var(--tropx-text-main)]">
            Local Cache
          </h3>
        </div>
        <p className="text-xs text-[var(--tropx-text-sub)] mb-3">
          Cached data for offline access.
        </p>

        {/* Cache Info */}
        <div className="p-3 bg-[var(--tropx-muted)] rounded-lg space-y-2 mb-3">
          <div className="flex justify-between text-xs">
            <span className="text-[var(--tropx-shadow)]">Status</span>
            <span
              className={cn(
                "font-medium",
                cache.isReady
                  ? "text-[var(--tropx-green)]"
                  : "text-[var(--tropx-shadow)]"
              )}
            >
              {cache.isReady ? "Ready" : "Initializing..."}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-[var(--tropx-shadow)]">Pending Syncs</span>
            <span className="text-[var(--tropx-text-main)] font-medium">
              {cache.pendingMutations}
            </span>
          </div>
        </div>

        {/* Clear Cache Confirm */}
        {showClearConfirm ? (
          <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg mb-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-red-800 dark:text-red-200 font-medium">
                  Clear all locally cached data?
                </p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                  Data will be re-downloaded from the server.
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setShowClearConfirm(false)}
                disabled={isClearing}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-[var(--tropx-text-main)] bg-[var(--tropx-card)] border border-[var(--tropx-border)] rounded-lg hover:bg-[var(--tropx-muted)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClearCache}
                disabled={isClearing}
                className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isClearing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
                Clear Cache
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowClearConfirm(true)}
            className={cn(
              "w-full px-3 py-2 text-xs font-medium rounded-lg transition-all",
              "flex items-center justify-center gap-2",
              "border-2 border-[var(--tropx-border)] text-[var(--tropx-text-main)]",
              "hover:border-red-300 dark:hover:border-red-700 hover:text-red-500",
              "hover:scale-[1.01] active:scale-[0.99]"
            )}
          >
            <Trash2 className="size-3.5" />
            Clear Local Cache
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>("general");

  const handleClose = () => onOpenChange(false);

  const renderTabContent = () => {
    switch (activeTab) {
      case "general":
        return <GeneralTab />;
      case "profile":
        return <ProfileTab />;
      case "security":
        return <SecurityTab />;
      default:
        return null;
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 modal-blur-overlay cursor-default",
            "data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]",
            "data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]"
          )}
          onClick={handleClose}
        />

        {/* Modal */}
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-[51] m-auto",
            "w-full max-w-lg h-fit max-h-[80vh]",
            "bg-[var(--tropx-card)] rounded-2xl shadow-lg border border-[var(--tropx-border)]",
            "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
            "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]",
            "pointer-events-auto overflow-hidden flex flex-col"
          )}
          onPointerDownOutside={handleClose}
          onInteractOutside={handleClose}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--tropx-border)]">
            <DialogPrimitive.Title className="text-lg font-semibold text-[var(--tropx-text-main)]">
              Settings
            </DialogPrimitive.Title>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-1.5 hover:bg-[var(--tropx-muted)] transition-colors cursor-pointer"
            >
              <X className="size-4 text-[var(--tropx-shadow)]" />
            </button>
          </div>

          {/* Body with Tabs */}
          <div className="flex flex-1 overflow-hidden">
            {/* Tab Navigation */}
            <div className="w-40 border-r border-[var(--tropx-border)] p-2 space-y-1 flex-shrink-0">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      isActive
                        ? "bg-[var(--tropx-vibrant)]/10 text-[var(--tropx-vibrant)]"
                        : "text-[var(--tropx-text-sub)] hover:bg-[var(--tropx-muted)] hover:text-[var(--tropx-text-main)]"
                    )}
                  >
                    <Icon className="size-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Tab Content */}
            <div className="flex-1 p-6 overflow-y-auto">{renderTabContent()}</div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default SettingsModal;
