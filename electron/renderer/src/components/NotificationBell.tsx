/**
 * NotificationBell - Unified notification bell with extensible template system.
 *
 * Combines:
 * - Pending invites (with Accept/Decline actions)
 * - Generic notifications (subject notes, recording shared, etc.)
 *
 * Template registry allows easy extension for new notification types.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { NOTIFICATION_TYPES } from "../../../../convex/schema";
import {
  Bell,
  Check,
  CheckCheck,
  X,
  Loader2,
  UserPlus,
  MessageSquare,
  Share2,
  CheckCircle,
  LucideIcon,
} from "lucide-react";
import { cn, formatTimeAgo } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface Invitation {
  _id: Id<"invites">;
  alias?: string;
  createdAt: number;
  expiresAt: number;
  inviter: {
    _id: Id<"users">;
    name?: string;
    email?: string;
    image?: string;
    role?: string;
  } | null;
}

interface GenericNotification {
  _id: Id<"notifications">;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  createdAt: number;
}

// Unified item for rendering
type UnifiedNotificationItem =
  | { kind: "invite"; data: Invitation }
  | { kind: "notification"; data: GenericNotification };

// Template definition
interface NotificationTemplate {
  icon: LucideIcon;
  iconColor: string; // Tailwind text color class
  bgColor: string; // Tailwind bg color class
}

// ─────────────────────────────────────────────────────────────────
// Template Registry (extensible)
// ─────────────────────────────────────────────────────────────────

const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  // Invite (special case - handled separately)
  invite: {
    icon: UserPlus,
    iconColor: "text-blue-500",
    bgColor: "bg-blue-50",
  },
  // Subject added a note to your recording
  [NOTIFICATION_TYPES.SUBJECT_NOTE]: {
    icon: MessageSquare,
    iconColor: "text-violet-500",
    bgColor: "bg-violet-50",
  },
  // Recording shared with you
  [NOTIFICATION_TYPES.RECORDING_SHARED]: {
    icon: Share2,
    iconColor: "text-green-500",
    bgColor: "bg-green-50",
  },
  // Invite was accepted
  [NOTIFICATION_TYPES.INVITE_ACCEPTED]: {
    icon: CheckCircle,
    iconColor: "text-emerald-500",
    bgColor: "bg-emerald-50",
  },
};

// Fallback template for unknown types
const DEFAULT_TEMPLATE: NotificationTemplate = {
  icon: Bell,
  iconColor: "text-gray-500",
  bgColor: "bg-gray-50",
};

function getTemplate(type: string): NotificationTemplate {
  return NOTIFICATION_TEMPLATES[type] || DEFAULT_TEMPLATE;
}

// ─────────────────────────────────────────────────────────────────
// Invite Notification Item (with Accept/Decline)
// ─────────────────────────────────────────────────────────────────

function InviteNotificationItem({
  invite,
  processingId,
  onAccept,
  onReject,
}: {
  invite: Invitation;
  processingId: Id<"invites"> | null;
  onAccept: (id: Id<"invites">) => void;
  onReject: (id: Id<"invites">) => void;
}) {
  const template = getTemplate("invite");
  const Icon = template.icon;
  const isProcessing = processingId === invite._id;

  return (
    <div
      className={cn(
        "p-4 transition-colors border-b border-gray-100 last:border-b-0",
        isProcessing && "opacity-50"
      )}
    >
      <div className="flex gap-3">
        {/* Avatar or Icon */}
        {invite.inviter?.image ? (
          <img
            src={invite.inviter.image}
            alt={invite.inviter.name || ""}
            className="size-10 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className={cn(
              "size-10 rounded-full flex items-center justify-center flex-shrink-0",
              template.bgColor
            )}
          >
            <Icon className={cn("size-5", template.iconColor)} />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[var(--tropx-dark)]">
            <span className="font-medium">
              {invite.inviter?.name || "Someone"}
            </span>{" "}
            invited you to connect
            {invite.alias && (
              <span className="text-[var(--tropx-shadow)]">
                {" "}
                as "{invite.alias}"
              </span>
            )}
          </p>
          <p className="text-xs text-[var(--tropx-shadow)] mt-0.5">
            {formatTimeAgo(invite.createdAt)}
          </p>

          {/* Actions */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onAccept(invite._id)}
              disabled={processingId !== null}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg",
                "bg-[var(--tropx-vibrant)] text-white text-sm font-medium",
                "hover:opacity-90 transition-all",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "hover:scale-[1.02] active:scale-[0.98]"
              )}
            >
              {isProcessing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Accept
            </button>
            <button
              onClick={() => onReject(invite._id)}
              disabled={processingId !== null}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg",
                "border-2 border-gray-200 text-[var(--tropx-shadow)] text-sm font-medium",
                "hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "hover:scale-[1.02] active:scale-[0.98]"
              )}
            >
              {isProcessing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              Decline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Generic Notification Item (with Mark Read/Delete)
// ─────────────────────────────────────────────────────────────────

function GenericNotificationItem({
  notification,
  onMarkRead,
  onDelete,
}: {
  notification: GenericNotification;
  onMarkRead: (id: Id<"notifications">) => void;
  onDelete: (id: Id<"notifications">) => void;
}) {
  const template = getTemplate(notification.type);
  const Icon = template.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-4 border-b border-gray-100 last:border-b-0 transition-colors",
        notification.read ? "bg-white" : "bg-blue-50/30"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex-shrink-0 size-10 rounded-full flex items-center justify-center",
          template.bgColor
        )}
      >
        <Icon className={cn("size-5", template.iconColor)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm",
            notification.read
              ? "text-[var(--tropx-shadow)]"
              : "text-[var(--tropx-dark)] font-medium"
          )}
        >
          {notification.title}
        </p>
        <p className="text-xs text-[var(--tropx-shadow)] mt-0.5 line-clamp-2">
          {notification.body}
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {formatTimeAgo(notification.createdAt)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex items-center gap-1">
        {!notification.read && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead(notification._id);
            }}
            className="p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-green-500 cursor-pointer"
            title="Mark as read"
          >
            <Check className="size-3.5" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(notification._id);
          }}
          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors text-gray-400 hover:text-red-500 cursor-pointer"
          title="Delete"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

interface NotificationBellProps {
  /** Center the dropdown horizontally instead of right-aligned */
  centerDropdown?: boolean;
  /** Controlled open state (optional - if not provided, uses internal state) */
  isOpen?: boolean;
  /** Callback when open state changes (required if isOpen is provided) */
  onOpenChange?: (open: boolean) => void;
}

export function NotificationBell({
  centerDropdown = false,
  isOpen: controlledIsOpen,
  onOpenChange,
}: NotificationBellProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [processingInviteId, setProcessingInviteId] = useState<Id<"invites"> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Use controlled or internal state
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;
  const setIsOpen = isControlled ? (open: boolean) => onOpenChange?.(open) : setInternalIsOpen;

  // Fetch pending invitations
  const invitations = useQuery(api.invites.getMyPendingInvitations) as
    | Invitation[]
    | undefined;

  // Fetch generic notifications
  const notifications = useQuery(api.notifications.listForUser, { limit: 20 }) as
    | GenericNotification[]
    | undefined;

  // Unread count for generic notifications
  const unreadNotificationCount = useQuery(api.notifications.getUnreadCount) ?? 0;

  // Mutations
  const acceptInvite = useMutation(api.invites.acceptInviteById);
  const rejectInvite = useMutation(api.invites.rejectInvite);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const deleteNotification = useMutation(api.notifications.deleteNotification);

  // Combined badge count (invites + unread notifications)
  const inviteCount = invitations?.length ?? 0;
  const totalBadgeCount = inviteCount + unreadNotificationCount;

  // Unified sorted list
  const unifiedItems = useMemo((): UnifiedNotificationItem[] => {
    const items: UnifiedNotificationItem[] = [];

    // Add invites
    if (invitations) {
      for (const invite of invitations) {
        items.push({ kind: "invite", data: invite });
      }
    }

    // Add notifications
    if (notifications) {
      for (const notification of notifications) {
        items.push({ kind: "notification", data: notification });
      }
    }

    // Sort by createdAt descending
    items.sort((a, b) => {
      const aTime = a.kind === "invite" ? a.data.createdAt : a.data.createdAt;
      const bTime = b.kind === "invite" ? b.data.createdAt : b.data.createdAt;
      return bTime - aTime;
    });

    return items;
  }, [invitations, notifications]);

  // Close dropdown when clicking outside or window loses focus (only when uncontrolled)
  useEffect(() => {
    if (isControlled) return; // Parent handles this when controlled

    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleWindowBlur = () => {
      if (isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [isOpen, isControlled]);

  // Close on escape (only when uncontrolled)
  useEffect(() => {
    if (isControlled) return; // Parent handles this when controlled

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, isControlled]);

  // Invite handlers
  const handleAcceptInvite = async (inviteId: Id<"invites">) => {
    setProcessingInviteId(inviteId);
    try {
      await acceptInvite({ inviteId });
    } catch (error) {
      console.error("Failed to accept invite:", error);
    } finally {
      setProcessingInviteId(null);
    }
  };

  const handleRejectInvite = async (inviteId: Id<"invites">) => {
    setProcessingInviteId(inviteId);
    try {
      await rejectInvite({ inviteId });
    } catch (error) {
      console.error("Failed to reject invite:", error);
    } finally {
      setProcessingInviteId(null);
    }
  };

  // Notification handlers
  const handleMarkRead = async (id: Id<"notifications">) => {
    try {
      await markRead({ notificationId: id });
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllRead({});
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error);
    }
  };

  const handleDeleteNotification = async (id: Id<"notifications">) => {
    try {
      await deleteNotification({ notificationId: id });
    } catch (error) {
      console.error("Failed to delete notification:", error);
    }
  };

  const isLoading = invitations === undefined || notifications === undefined;

  // Dropdown content (can be rendered by parent if renderDropdownOutside is true)
  const dropdownContent = (
    <div
      className={cn(
        "w-80 bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden",
        "animate-[modal-bubble-in_0.15s_var(--spring-bounce)_forwards]"
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-[var(--tropx-dark)]">
          Notifications
        </h3>
        {unreadNotificationCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-1 text-xs text-[var(--tropx-vibrant)] hover:underline cursor-pointer"
          >
            <CheckCheck className="size-3.5" />
            Mark all read
          </button>
        )}
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-[var(--tropx-vibrant)]" />
          </div>
        )}

        {!isLoading && unifiedItems.length === 0 && (
          <div className="py-8 text-center">
            <Bell className="size-8 text-[var(--tropx-ivory-dark)] mx-auto mb-2" />
            <p className="text-sm text-[var(--tropx-shadow)]">
              No notifications
            </p>
            <p className="text-xs text-gray-400 mt-1">You're all caught up!</p>
          </div>
        )}

        {!isLoading && unifiedItems.length > 0 && (
          <div>
            {unifiedItems.map((item) => {
              if (item.kind === "invite") {
                return (
                  <InviteNotificationItem
                    key={`invite-${item.data._id}`}
                    invite={item.data}
                    processingId={processingInviteId}
                    onAccept={handleAcceptInvite}
                    onReject={handleRejectInvite}
                  />
                );
              } else {
                return (
                  <GenericNotificationItem
                    key={`notif-${item.data._id}`}
                    notification={item.data}
                    onMarkRead={handleMarkRead}
                    onDelete={handleDeleteNotification}
                  />
                );
              }
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={isControlled ? "" : "relative"} ref={dropdownRef}>
      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "relative p-2 rounded-full transition-all duration-150 cursor-pointer",
          "hover:bg-[var(--tropx-hover)] hover:scale-110 active:scale-95",
          isOpen && "bg-[var(--tropx-hover)] scale-110"
        )}
      >
        <Bell
          className={cn(
            "size-5 transition-colors",
            totalBadgeCount > 0
              ? "text-[var(--tropx-vibrant)]"
              : "text-[var(--tropx-shadow)]"
          )}
        />
        {/* Badge */}
        {totalBadgeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-[var(--tropx-vibrant)] rounded-full px-1">
            {totalBadgeCount > 99 ? "99+" : totalBadgeCount}
          </span>
        )}
      </button>

      {/* Dropdown - positions relative to nearest positioned ancestor */}
      {isOpen && (
        <div
          className={cn(
            "absolute top-full mt-2 z-50",
            centerDropdown ? "left-1/2 ml-[-10rem]" : "right-0"
          )}
        >
          {dropdownContent}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
