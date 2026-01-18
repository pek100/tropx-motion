/**
 * TagFilterBar - Compact filter bar for OPI trends chart.
 * Follows TagsInput patterns with marquee for overflow in compact mode.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Filter, X } from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface TagFilterBarProps {
  activeTags: string[];
  onTagsChange: (tags: string[]) => void;
  availableTags: string[];
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function TagFilterBar({
  activeTags,
  onTagsChange,
  availableTags,
  className,
}: TagFilterBarProps) {
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chipsContainerRef = useRef<HTMLDivElement>(null);
  const chipsContentRef = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────────────────────────────
  // Overflow detection for marquee
  // ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = chipsContainerRef.current;
    const content = chipsContentRef.current;
    if (!container || !content) return;

    const checkOverflow = () => {
      setIsOverflowing(content.scrollWidth > container.clientWidth);
    };

    checkOverflow();
    const observer = new ResizeObserver(checkOverflow);
    observer.observe(container);
    observer.observe(content);

    return () => observer.disconnect();
  }, [activeTags]);

  // ─────────────────────────────────────────────────────────────────
  // Suggestions logic (matches TagsInput)
  // ─────────────────────────────────────────────────────────────────

  // Suggestions - filtered when typing, all available when not
  const suggestions = useMemo(() => {
    const query = input.toLowerCase().trim();

    return availableTags
      .filter((t) => {
        if (activeTags.includes(t)) return false;
        if (query && !t.toLowerCase().startsWith(query)) return false;
        return true;
      })
      .slice(0, 8);
  }, [availableTags, input, activeTags]);

  // ─────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────

  const addTag = useCallback(
    (tag: string) => {
      const cleaned = tag.trim();
      if (!cleaned || activeTags.includes(cleaned)) return;
      onTagsChange([...activeTags, cleaned]);
      setInput("");
      setHighlightIndex(-1);
    },
    [activeTags, onTagsChange]
  );

  const removeTag = useCallback(
    (tag: string) => {
      onTagsChange(activeTags.filter((t) => t !== tag));
    },
    [activeTags, onTagsChange]
  );

  const clearAll = useCallback(() => {
    onTagsChange([]);
  }, [onTagsChange]);

  // ─────────────────────────────────────────────────────────────────
  // Keyboard handling
  // ─────────────────────────────────────────────────────────────────

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        if (highlightIndex >= 0 && suggestions[highlightIndex]) {
          addTag(suggestions[highlightIndex]);
        } else if (input.trim()) {
          addTag(input);
        }
        break;

      case "Backspace":
        if (!input && activeTags.length > 0) {
          removeTag(activeTags[activeTags.length - 1]);
        }
        break;

      case "ArrowDown":
        e.preventDefault();
        if (suggestions.length > 0) {
          setHighlightIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        if (suggestions.length > 0) {
          setHighlightIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
        }
        break;

      case "Escape":
        setIsOpen(false);
        setHighlightIndex(-1);
        break;
    }
  };

  // ─────────────────────────────────────────────────────────────────
  // Click outside handler
  // ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset highlight when input changes
  useEffect(() => {
    setHighlightIndex(-1);
  }, [input]);

  // Show dropdown when focused and has suggestions
  const showDropdown = isOpen && suggestions.length > 0;

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Main input area */}
      <div
        className={cn(
          "flex items-center gap-1.5 h-8 px-2 rounded-lg",
          "border bg-[var(--tropx-card)]",
          "focus-within:ring-2 focus-within:ring-[var(--tropx-vibrant)] focus-within:border-transparent",
          activeTags.length > 0
            ? "border-[var(--tropx-vibrant)]/30"
            : "border-[var(--tropx-border)]"
        )}
        onClick={() => {
          inputRef.current?.focus();
          setIsOpen(true);
        }}
      >
        {/* Filter icon */}
        <Filter
          className={cn(
            "size-3.5 flex-shrink-0",
            activeTags.length > 0
              ? "text-[var(--tropx-vibrant)]"
              : "text-[var(--tropx-text-sub)]"
          )}
        />

        {/* Tags container with marquee */}
        <div
          ref={chipsContainerRef}
          className="flex-1 min-w-0 overflow-hidden"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {activeTags.length === 0 ? (
            // Empty state - just show input
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setIsOpen(true);
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder="Filter by tags..."
              className={cn(
                "w-full bg-transparent outline-none text-xs",
                "text-[var(--tropx-text-main)] placeholder-[var(--tropx-text-sub)]"
              )}
            />
          ) : (
            // Tags with marquee
            <div
              ref={chipsContentRef}
              className={cn(
                "flex items-center gap-1 whitespace-nowrap",
                isOverflowing && !isPaused && "animate-marquee"
              )}
              style={
                isOverflowing
                  ? { animationPlayState: isPaused ? "paused" : "running" }
                  : undefined
              }
            >
              {activeTags.map((tag) => (
                <span
                  key={tag}
                  className={cn(
                    "group relative inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
                    "bg-[var(--tropx-vibrant)] text-white shadow-sm",
                    "cursor-pointer"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTag(tag);
                  }}
                >
                  {tag}
                  <div className="absolute inset-0 rounded-full bg-[var(--tropx-vibrant)] hidden group-hover:flex items-center justify-center">
                    <X className="size-3" />
                  </div>
                </span>
              ))}
              {/* Duplicate for seamless marquee loop */}
              {isOverflowing &&
                activeTags.map((tag) => (
                  <span
                    key={`dup-${tag}`}
                    className={cn(
                      "group relative inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium",
                      "bg-[var(--tropx-vibrant)] text-white shadow-sm",
                      "cursor-pointer"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTag(tag);
                    }}
                  >
                    {tag}
                    <div className="absolute inset-0 rounded-full bg-[var(--tropx-vibrant)] hidden group-hover:flex items-center justify-center">
                      <X className="size-3" />
                    </div>
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* Input when tags exist */}
        {activeTags.length > 0 && (
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            className={cn(
              "w-6 bg-transparent outline-none text-xs text-center flex-shrink-0",
              "text-[var(--tropx-text-main)]"
            )}
          />
        )}

        {/* Clear all button */}
        {activeTags.length > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
            className="flex-shrink-0 p-0.5 rounded text-[var(--tropx-text-sub)] hover:text-red-500 transition-colors"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* Dropdown with suggestions */}
      {showDropdown && (
        <div
          className={cn(
            "absolute top-full left-0 right-0 z-50 mt-1",
            "bg-[var(--tropx-card)] rounded-xl shadow-lg max-h-48 overflow-y-auto",
            "border border-[var(--tropx-border)] backdrop-blur-sm"
          )}
        >
          {suggestions.map((tag, idx) => (
            <button
              key={tag}
              type="button"
              onClick={() => addTag(tag)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm transition-all",
                "hover:bg-gradient-to-r hover:from-[var(--tropx-muted)] hover:to-transparent",
                idx === highlightIndex && "bg-[var(--tropx-muted)]",
                idx === 0 && "rounded-t-xl",
                idx === suggestions.length - 1 && "rounded-b-xl"
              )}
            >
              <span className="text-[var(--tropx-text-main)] font-medium">
                {tag}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Marquee animation styles */}
      <style>{`
        @keyframes marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .animate-marquee {
          animation: marquee 10s linear infinite;
        }
      `}</style>
    </div>
  );
}

export default TagFilterBar;
