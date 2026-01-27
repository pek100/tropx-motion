/**
 * HorusChatInput Component
 *
 * Compact chat input that lives in the header and becomes sticky at the bottom when scrolling.
 * Design matches the reference with atom icon, input field, send button, and previous chat pills.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Send, History } from "lucide-react";
import { AtomSpin } from "@/components/AtomSpin";

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
  onSend: () => void;
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
  onSend,
  isLoading = false,
  disabled = false,
  previousChats = [],
  onSelectPreviousChat,
  className,
}: HorusChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && value.trim() && !isLoading && !disabled) {
        e.preventDefault();
        onSend();
      }
    },
    [value, isLoading, disabled, onSend]
  );

  // Truncate text for pills
  const truncateText = (text: string, maxLength: number = 28) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  // Get recent chats (max 3)
  const recentChats = previousChats.slice(0, 3);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Main input container */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2",
          "bg-[var(--tropx-surface)] rounded-xl",
          "border border-[var(--tropx-border)]/50",
          "transition-all duration-200",
          "focus-within:border-[var(--tropx-vibrant)]/50 focus-within:ring-1 focus-within:ring-[var(--tropx-vibrant)]/20"
        )}
      >
        {/* Atom icon */}
        <div className="flex-shrink-0 text-[var(--tropx-vibrant)]">
          <AtomSpin className={cn("size-5", isLoading && "opacity-100")} />
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
            "text-[var(--tropx-text)] placeholder:text-[var(--tropx-text-sub)]",
            "focus:outline-none",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        />

        {/* Send button */}
        <button
          type="button"
          onClick={onSend}
          disabled={!value.trim() || isLoading || disabled}
          className={cn(
            "flex-shrink-0 p-1.5 rounded-lg transition-all duration-150",
            value.trim() && !isLoading && !disabled
              ? "text-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/10 cursor-pointer"
              : "text-[var(--tropx-text-sub)]/50 cursor-not-allowed"
          )}
        >
          <Send className="size-4" />
        </button>
      </div>

      {/* Previous chats pills */}
      {recentChats.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {/* History icon */}
          <History className="size-3.5 text-[var(--tropx-text-sub)] flex-shrink-0" />

          {/* Chat pills */}
          {recentChats.map((chat) => (
            <button
              key={chat.id}
              onClick={() => onSelectPreviousChat?.(chat)}
              className={cn(
                "flex-shrink-0 px-2.5 py-1 rounded-full text-xs",
                "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)]",
                "hover:bg-[var(--tropx-surface)] hover:text-[var(--tropx-text)]",
                "border border-[var(--tropx-border)]/30",
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
                "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)]",
                "hover:bg-[var(--tropx-surface)] hover:text-[var(--tropx-text)]",
                "border border-[var(--tropx-border)]/30",
                "transition-colors duration-150"
              )}
            >
              Older...
            </button>
          )}
        </div>
      )}
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
