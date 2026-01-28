/**
 * HorusChatInput Component
 *
 * Compact chat input that lives in the header and becomes sticky at the bottom when scrolling.
 * Design matches the reference with atom icon, input field, send button, and previous chat pills.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Send, History, Minus } from "lucide-react";
import { AtomSpin } from "@/components/AtomSpin";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface PreviousChat {
  id: string;
  text: string;
  timestamp: number;
}

interface HorusChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend?: () => void;
  minimized?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  previousChats?: PreviousChat[];
  onSelectPreviousChat?: (chat: PreviousChat) => void;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function HorusChatInput({
  value,
  onChange,
  minimized = false,
  onMinimize,
  onExpand,
  isLoading = false,
  disabled = false,
  previousChats = [],
  onSelectPreviousChat,
  className,
}: HorusChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Show "coming soon" toast
  const showComingSoonToast = useCallback(() => {
    toast.info("Chat functionality is still underway", {
      description: "This feature will be available soon!",
    });
  }, []);

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && value.trim() && !isLoading && !disabled) {
        e.preventDefault();
        showComingSoonToast();
      }
    },
    [value, isLoading, disabled, showComingSoonToast]
  );

  // Truncate text for pills
  const truncateText = (text: string, maxLength: number = 28) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  // Get recent chats (max 3)
  const recentChats = previousChats.slice(0, 3);

  // Minimized state - just show a small pill button
  if (minimized) {
    return (
      <button
        onClick={onExpand}
        className={cn(
          "p-3 rounded-full",
          "hover:brightness-105",
          "border border-[var(--tropx-border)]",
          "text-[var(--tropx-vibrant)]",
          "shadow-lg transition-all duration-150",
          className
        )}
        style={{
          background: `linear-gradient(135deg, transparent 0%, rgba(var(--tropx-vibrant-rgb), 0.15) 100%), var(--tropx-bg)`,
        }}
        title="Open chat"
      >
        <AtomSpin className="size-5" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "relative h-[88px] px-4",
        "rounded-[24px]",
        "border border-[var(--tropx-border)]",
        className
      )}
      style={{
        background: `linear-gradient(135deg, transparent 0%, rgba(var(--tropx-vibrant-rgb), 0.08) 100%), var(--tropx-bg)`,
      }}
    >
      {/* Input row - pill shaped, absolute at top */}
      <div
        className={cn(
          "absolute inset-x-0 top-0",
          "flex items-center gap-2 px-3 py-1.5",
          "bg-[var(--tropx-card)] rounded-full",
          "border border-[var(--tropx-border)]",
          "transition-all duration-200",
          "focus-within:shadow-[0_0_0_1px_rgba(var(--tropx-vibrant-rgb),0.4)]"
        )}
      >
        {/* Atom icon */}
        <div className="flex-shrink-0 text-[var(--tropx-vibrant)]">
          <AtomSpin className={cn("size-4", isLoading && "opacity-100")} />
        </div>

        {/* Input field */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Got any questions?"
          disabled={disabled || isLoading}
          className={cn(
            "flex-1 bg-transparent text-sm",
            "text-[var(--tropx-text-main)] placeholder:text-[var(--tropx-text-sub)]",
            "focus:outline-none",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        />

        {/* Send button */}
        <button
          type="button"
          onClick={showComingSoonToast}
          disabled={!value.trim() || isLoading || disabled}
          className={cn(
            "flex-shrink-0 p-1 rounded-full transition-all duration-150",
            value.trim() && !isLoading && !disabled
              ? "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] cursor-pointer"
              : "text-[var(--tropx-text-sub)]/40 cursor-not-allowed"
          )}
        >
          <Send className="size-4" />
        </button>

        {/* Minimize button */}
        {onMinimize && (
          <button
            type="button"
            onClick={onMinimize}
            className={cn(
              "flex-shrink-0 p-1 rounded-full transition-all duration-150",
              "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)] cursor-pointer"
            )}
            title="Minimize"
          >
            <Minus className="size-4" />
          </button>
        )}
      </div>

      {/* History row - drag handle, centered in bottom portion */}
      <div
        data-drag-handle
        className="absolute inset-x-4 bottom-0 top-[40px] flex items-center gap-1.5 overflow-x-auto scrollbar-none cursor-grab active:cursor-grabbing"
      >
        {/* History icon */}
        <History className="size-3.5 text-[var(--tropx-text-sub)]/60 flex-shrink-0" />

        {/* Chat pills or placeholder */}
        {recentChats.length > 0 ? (
          <>
            {recentChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => onSelectPreviousChat?.(chat)}
                className={cn(
                  "flex-shrink-0 px-2.5 py-1 rounded-full text-xs",
                  "bg-[var(--tropx-card)]/60 text-[var(--tropx-text-sub)]",
                  "hover:bg-[var(--tropx-card)] hover:text-[var(--tropx-text-main)]",
                  "transition-colors duration-150",
                  "max-w-[180px] truncate"
                )}
                title={chat.text}
              >
                {truncateText(chat.text)}
              </button>
            ))}

            {/* "Older" button if there are more chats */}
            {previousChats.length > 3 && (
              <button
                className={cn(
                  "flex-shrink-0 px-2.5 py-1 rounded-full text-xs",
                  "bg-[var(--tropx-card)]/60 text-[var(--tropx-text-sub)]",
                  "hover:bg-[var(--tropx-card)] hover:text-[var(--tropx-text-main)]",
                  "transition-colors duration-150"
                )}
              >
                Older...
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-[var(--tropx-text-sub)]/40">No previous chats</span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sticky Wrapper Component
// ─────────────────────────────────────────────────────────────────

interface StickyHorusChatProps extends HorusChatInputProps {
  /** Reference to the scroll container */
  scrollContainerRef?: React.RefObject<HTMLElement>;
  /** Threshold in pixels before becoming sticky */
  stickyThreshold?: number;
}

export function StickyHorusChat({
  scrollContainerRef,
  stickyThreshold = 200,
  ...chatProps
}: StickyHorusChatProps) {
  const [isSticky, setIsSticky] = useState(false);
  const placeholderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scrollContainer = scrollContainerRef?.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const scrollTop = scrollContainer.scrollTop;
      setIsSticky(scrollTop > stickyThreshold);
    };

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // Check initial state

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
    };
  }, [scrollContainerRef, stickyThreshold]);

  return (
    <>
      {/* Placeholder to maintain layout when chat becomes sticky */}
      <div
        ref={placeholderRef}
        className={cn(
          "transition-all duration-200",
          isSticky ? "h-0" : "h-auto"
        )}
      >
        {!isSticky && <HorusChatInput {...chatProps} />}
      </div>

      {/* Sticky chat at bottom */}
      {isSticky && (
        <div
          className={cn(
            "fixed bottom-0 left-0 right-0 z-40",
            "bg-[var(--tropx-card)]/95 backdrop-blur-sm",
            "border-t border-[var(--tropx-border)]",
            "px-4 py-3",
            "animate-in slide-in-from-bottom-2 duration-200"
          )}
        >
          <div className="max-w-4xl mx-auto">
            <HorusChatInput {...chatProps} />
          </div>
        </div>
      )}
    </>
  );
}

export default HorusChatInput;
