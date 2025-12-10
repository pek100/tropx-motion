import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { Bell, Check, X, User, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [processingId, setProcessingId] = useState<Id<"invites"> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch pending invitations
  const invitations = useQuery(api.invites.getMyPendingInvitations) as Invitation[] | undefined;
  const acceptInvite = useMutation(api.invites.acceptInviteById);
  const rejectInvite = useMutation(api.invites.rejectInvite);

  const count = invitations?.length ?? 0;

  // Close dropdown when clicking outside or window loses focus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (isOpen && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleWindowBlur = () => {
      if (isOpen) {
        setIsOpen(false);
      }
    };

    // Use capture phase to ensure we catch the event before it's stopped
    document.addEventListener("mousedown", handleClickOutside, true);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [isOpen]);

  const handleAccept = async (inviteId: Id<"invites">) => {
    setProcessingId(inviteId);
    try {
      await acceptInvite({ inviteId });
    } catch (error) {
      console.error("Failed to accept invite:", error);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (inviteId: Id<"invites">) => {
    setProcessingId(inviteId);
    try {
      await rejectInvite({ inviteId });
    } catch (error) {
      console.error("Failed to reject invite:", error);
    } finally {
      setProcessingId(null);
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
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
            count > 0 ? "text-[var(--tropx-vibrant)]" : "text-[var(--tropx-shadow)]"
          )}
        />
        {/* Badge */}
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white bg-[var(--tropx-vibrant)] rounded-full px-1">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className={cn(
            "absolute top-full right-0 mt-2 w-80",
            "bg-white border border-gray-200 rounded-2xl shadow-lg overflow-hidden",
            "animate-[modal-bubble-in_0.15s_var(--spring-bounce)_forwards]",
            "z-50"
          )}
        >
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-[var(--tropx-dark)]">Notifications</h3>
          </div>

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {invitations === undefined && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-[var(--tropx-vibrant)]" />
              </div>
            )}

            {invitations && invitations.length === 0 && (
              <div className="py-8 text-center">
                <Bell className="size-8 text-[var(--tropx-ivory-dark)] mx-auto mb-2" />
                <p className="text-sm text-[var(--tropx-shadow)]">No notifications</p>
              </div>
            )}

            {invitations && invitations.length > 0 && (
              <div className="divide-y divide-gray-100">
                {invitations.map((invite) => (
                  <div
                    key={invite._id}
                    className={cn(
                      "p-4 transition-colors",
                      processingId === invite._id && "opacity-50"
                    )}
                  >
                    <div className="flex gap-3">
                      {/* Avatar */}
                      {invite.inviter?.image ? (
                        <img
                          src={invite.inviter.image}
                          alt={invite.inviter.name || ""}
                          className="size-10 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="size-10 rounded-full bg-[var(--tropx-ivory)] flex items-center justify-center flex-shrink-0">
                          <User className="size-5 text-[var(--tropx-shadow)]" />
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
                              {" "}as "{invite.alias}"
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-[var(--tropx-shadow)] mt-0.5">
                          {formatTimeAgo(invite.createdAt)}
                        </p>

                        {/* Actions */}
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => handleAccept(invite._id)}
                            disabled={processingId !== null}
                            className={cn(
                              "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg",
                              "bg-[var(--tropx-vibrant)] text-white text-sm font-medium",
                              "hover:opacity-90 transition-all",
                              "disabled:opacity-50 disabled:cursor-not-allowed",
                              "hover:scale-[1.02] active:scale-[0.98]"
                            )}
                          >
                            {processingId === invite._id ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                            Accept
                          </button>
                          <button
                            onClick={() => handleReject(invite._id)}
                            disabled={processingId !== null}
                            className={cn(
                              "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg",
                              "border-2 border-gray-200 text-[var(--tropx-shadow)] text-sm font-medium",
                              "hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all",
                              "disabled:opacity-50 disabled:cursor-not-allowed",
                              "hover:scale-[1.02] active:scale-[0.98]"
                            )}
                          >
                            {processingId === invite._id ? (
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
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
