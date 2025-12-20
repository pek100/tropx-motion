/**
 * PatientInfoCard - Displays selected patient info with avatar and status badge.
 */

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChevronDown, StickyNote } from "lucide-react";

interface PatientInfoCardProps {
  name: string;
  image?: string;
  sessionCount: number;
  isMe?: boolean;
  onClick?: () => void;
  onAddNote?: () => void;
  className?: string;
}

/** Get initials from name (max 2 chars) */
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function PatientInfoCard({
  name,
  image,
  sessionCount,
  isMe,
  onClick,
  onAddNote,
  className,
}: PatientInfoCardProps) {
  const isClickable = !!onClick;
  const Component = isClickable ? "button" : "div";

  return (
    <Component
      onClick={onClick}
      className={cn(
        "w-full px-3 py-2.5 rounded-xl border border-[var(--tropx-border)] bg-[var(--tropx-card)]",
        "flex items-center gap-3",
        "transition-all",
        isClickable && "hover:border-[var(--tropx-vibrant)]/30 hover:shadow-sm cursor-pointer",
        className
      )}
    >
      {/* Avatar */}
      <Avatar className="size-10 border border-[var(--tropx-vibrant)]/20">
        <AvatarImage src={image} alt={name} />
        <AvatarFallback
          className={cn(
            "text-sm font-bold",
            isMe
              ? "bg-violet-100 text-violet-600"
              : "bg-[var(--tropx-hover)] text-[var(--tropx-vibrant)]"
          )}
        >
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>

      {/* Info */}
      <div className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-[var(--tropx-text-main)] truncate">
            {name}
          </h2>
          {isMe && (
            <span className="px-1 py-0.5 text-[9px] font-semibold bg-violet-500 text-white rounded shrink-0">
              Me
            </span>
          )}
        </div>
        <p className="text-[11px] text-[var(--tropx-text-sub)]">
          {sessionCount} session{sessionCount !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Add Note button - only show if handler provided */}
      {onAddNote && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAddNote();
          }}
          className={cn(
            "size-8 flex items-center justify-center rounded-lg shrink-0",
            "bg-[var(--tropx-muted)] text-[var(--tropx-shadow)]",
            "hover:bg-[var(--tropx-vibrant)]/10 hover:text-[var(--tropx-vibrant)]",
            "transition-colors"
          )}
        >
          <StickyNote className="size-4" />
        </button>
      )}

      {/* Chevron - only show if clickable */}
      {isClickable && (
        <ChevronDown className="size-4 text-[var(--tropx-text-sub)] shrink-0" />
      )}
    </Component>
  );
}

export default PatientInfoCard;
