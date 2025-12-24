/**
 * NotificationBell - Unified notification bell with extensible template system.
 *
 * Combines:
 * - Pending invites (with Accept/Decline actions)
 * - Generic notifications (subject notes, recording shared, etc.)
 *
 * Template registry allows easy extension for new notification types.
 */

import { useState, useMemo } from "react";
import { useMutation, useQuery } from "@/lib/customConvex";
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
  Activity,
  Eye,
  LucideIcon,
} from "lucide-react";
import { cn, formatTimeAgo } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
    bgColor: "bg-blue-50 dark:bg-blue-900/30",
  },
  // Subject added a note to your recording
  [NOTIFICATION_TYPES.SUBJECT_NOTE]: {
    icon: MessageSquare,
    iconColor: "text-violet-500",
    bgColor: "bg-violet-50 dark:bg-violet-900/30",
  },
  // Recording shared with you
  [NOTIFICATION_TYPES.RECORDING_SHARED]: {
    icon: Share2,
    iconColor: "text-green-500",
    bgColor: "bg-green-50 dark:bg-green-900/30",
  },
  // Invite was accepted
  [NOTIFICATION_TYPES.INVITE_ACCEPTED]: {
    icon: CheckCircle,
    iconColor: "text-emerald-500",
    bgColor: "bg-emerald-50 dark:bg-emerald-900/30",
  },
  // Added as subject to a recording
  [NOTIFICATION_TYPES.ADDED_AS_SUBJECT]: {
    icon: Activity,
    iconColor: "text-orange-500",
    bgColor: "bg-orange-50 dark:bg-orange-900/30",
  },
};

// Fallback template for unknown types
const DEFAULT_TEMPLATE: NotificationTemplate = {
  icon: Bell,
  iconColor: "text-[var(--tropx-text-sub)]",
  bgColor: "bg-[var(--tropx-muted)]",
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
        "p-4 transition-colors border-b border-[var(--tropx-border)] last:border-b-0",
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
          <p className="text-sm text-[var(--tropx-text-main)]">
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
                "border-2 border-[var(--tropx-border)] text-[var(--tropx-shadow)] text-sm font-medium",
                "hover:border-red-300 dark:hover:border-red-700 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all",
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
  onViewRecording,
}: {
  notification: GenericNotification;
  onMarkRead: (id: Id<"notifications">) => void;
  onDelete: (id: Id<"notifications">) => void;
  onViewRecording?: (sessionId: string) => void;
}) {
  const template = getTemplate(notification.type);
  const Icon = template.icon;
  const sessionId = notification.data?.sessionId as string | undefined;
  const hasViewAction = sessionId && onViewRecording;

  // Special minimal layout for ADDED_AS_SUBJECT (like invite notifications)
  const isAddedAsSubject = notification.type === NOTIFICATION_TYPES.ADDED_AS_SUBJECT;
  const ownerImage = notification.data?.ownerImage as string | undefined;
  const ownerName = notification.data?.ownerName as string | undefined;
  const recordingTitle = notification.data?.recordingTitle as string | undefined;

  // Compact layout for ADDED_AS_SUBJECT
  if (isAddedAsSubject) {
    return (
      <div
        className={cn(
          "px-3 py-2.5 flex items-center gap-2.5 border-b border-[var(--tropx-border)] last:border-b-0 transition-all hover:bg-[var(--tropx-muted)]/50",
          notification.read ? "bg-[var(--tropx-card)]" : "bg-orange-50/30 dark:bg-orange-950/20"
        )}
      >
        {/* Avatar with badge */}
        <div className="relative flex-shrink-0">
          <Avatar className="size-8">
            <AvatarImage src={ownerImage} alt={ownerName || ""} />
            <AvatarFallback className="bg-orange-100 dark:bg-orange-900/30 text-orange-600 text-xs">
              {(ownerName || "?")[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-orange-500 flex items-center justify-center ring-1.5 ring-[var(--tropx-card)]">
            <Activity className="size-2 text-white" />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-xs leading-tight",
            notification.read ? "text-[var(--tropx-shadow)]" : "text-[var(--tropx-text-main)]"
          )}>
            <span className="font-medium">{ownerName || "Someone"}</span>
            {" "}added you to{" "}
            {recordingTitle ? (
              <span className="text-[var(--tropx-shadow)]">&ldquo;{recordingTitle}&rdquo;</span>
            ) : (
              "a recording"
            )}
          </p>
          <p className="text-[10px] text-[var(--tropx-text-sub)] mt-0.5">
            {formatTimeAgo(notification.createdAt)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {hasViewAction && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onViewRecording(sessionId);
                onMarkRead(notification._id);
              }}
              className="h-7 px-2 text-xs text-[var(--tropx-vibrant)] hover:text-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/10"
            >
              <Eye className="size-3" />
              View
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(notification._id);
            }}
            className="size-6 text-[var(--tropx-text-sub)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
            title="Delete"
          >
            <X className="size-3" />
          </Button>
        </div>
      </div>
    );
  }

  // Default layout for other notification types
  return (
    <div
      className={cn(
        "px-3 py-2.5 flex items-start gap-2.5 border-b border-[var(--tropx-border)] last:border-b-0 transition-all hover:bg-[var(--tropx-muted)]/50",
        notification.read ? "bg-[var(--tropx-card)]" : "bg-blue-50/30 dark:bg-blue-950/20"
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "size-8 rounded-full flex items-center justify-center flex-shrink-0",
          template.bgColor
        )}
      >
        <Icon className={cn("size-4", template.iconColor)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-xs leading-tight",
            notification.read
              ? "text-[var(--tropx-shadow)]"
              : "text-[var(--tropx-text-main)] font-medium"
          )}
        >
          {notification.title}
        </p>
        <p className="text-[10px] text-[var(--tropx-shadow)] mt-0.5 line-clamp-2">
          {notification.body}
        </p>
        <p className="text-[10px] text-[var(--tropx-text-sub)] mt-0.5">
          {formatTimeAgo(notification.createdAt)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {hasViewAction && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onViewRecording(sessionId);
              onMarkRead(notification._id);
            }}
            className="h-7 px-2 text-xs text-[var(--tropx-vibrant)] hover:text-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/10"
          >
            <Eye className="size-3" />
            View
          </Button>
        )}
        {!notification.read && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onMarkRead(notification._id);
            }}
            className="size-6 text-[var(--tropx-text-sub)] hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/30"
            title="Mark as read"
          >
            <Check className="size-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(notification._id);
          }}
          className="size-6 text-[var(--tropx-text-sub)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
          title="Delete"
        >
          <X className="size-3" />
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

interface NotificationBellProps {
  /** Alignment of the popover */
  align?: "start" | "center" | "end";
  /** Controlled open state (optional - if not provided, uses internal state) */
  isOpen?: boolean;
  /** Callback when open state changes (required if isOpen is provided) */
  onOpenChange?: (open: boolean) => void;
  /** Callback when user clicks "View" on a recording notification */
  onViewRecording?: (sessionId: string) => void;
}

export function NotificationBell({
  align = "end",
  isOpen: controlledIsOpen,
  onOpenChange,
  onViewRecording,
}: NotificationBellProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [processingInviteId, setProcessingInviteId] = useState<Id<"invites"> | null>(null);

  // Use controlled or internal state
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;
  const setIsOpen = isControlled ? (open: boolean) => onOpenChange?.(open) : setInternalIsOpen;

  // Fetch pending invitations
  const invitations = useQuery(api.invites.getMyPendingInvitations, {}) as Invitation[] | undefined;

  // Fetch generic notifications
  const notifications = useQuery(api.notifications.listForUser, { limit: 20 }) as GenericNotification[] | undefined;

  // Unread count for generic notifications
  const unreadNotificationCount = useQuery(api.notifications.getUnreadCount, {}) ?? 0;

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

    // Add invites (defensive: check it's an array before iterating)
    if (Array.isArray(invitations)) {
      for (const invite of invitations) {
        items.push({ kind: "invite", data: invite });
      }
    }

    // Add notifications (defensive: check it's an array before iterating)
    if (Array.isArray(notifications)) {
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

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
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
      </PopoverTrigger>

      <PopoverContent
        align={align}
        sideOffset={8}
        className="w-80 p-0 bg-[var(--tropx-card)] border-[var(--tropx-border)] rounded-2xl shadow-lg overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--tropx-border)] flex items-center justify-between">
          <h3 className="font-semibold text-[var(--tropx-text-main)]">
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
              <Bell className="size-8 text-[var(--tropx-text-sub)] mx-auto mb-2" />
              <p className="text-sm text-[var(--tropx-shadow)]">
                No notifications
              </p>
              <p className="text-xs text-[var(--tropx-text-sub)] mt-1">You're all caught up!</p>
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
                      onViewRecording={onViewRecording}
                    />
                  );
                }
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationBell;
