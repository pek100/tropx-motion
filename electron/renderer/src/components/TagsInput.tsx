import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@/lib/customConvex';
import { api } from '../../../../convex/_generated/api';
import { X, Sparkles, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_TAGS = 10;
const SUGGESTED_TAGS_COUNT = 10;

interface TagsInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function TagsInput({
  value,
  onChange,
  disabled = false,
  placeholder = 'Add tags...',
}: TagsInputProps) {
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Check if content overflows
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const checkOverflow = () => {
      setIsOverflowing(container.scrollWidth > container.clientWidth);
    };

    checkOverflow();
    // Recheck on resize
    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [value]);

  // Scroll to end when focused
  useEffect(() => {
    if (isFocused && scrollContainerRef.current) {
      scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
    }
  }, [isFocused, value]);

  // Fetch user's tags + defaults (no limit for cache key consistency)
  const tagsData = useQuery(api.tags.getTagsWithDefaults, {});

  // Merge all tags for suggestions/recent
  const allTags = useMemo(() => {
    if (!tagsData) return [];

    // Defensive: ensure arrays exist before spreading
    const userTags = Array.isArray(tagsData.userTags) ? tagsData.userTags : [];
    const defaults = Array.isArray(tagsData.defaults) ? tagsData.defaults : [];

    // User tags first (already sorted by recent), then defaults
    return [...userTags, ...defaults];
  }, [tagsData]);

  // Filter suggestions based on input
  const suggestions = useMemo(() => {
    const query = input.toLowerCase().trim();
    if (!query) return [];

    return allTags
      .filter((t) => {
        if (value.includes(t.tag)) return false;
        if (!t.tag.toLowerCase().startsWith(query)) return false;
        return true;
      })
      .slice(0, 8);
  }, [allTags, input, value]);

  // Tags to show as suggestions (user's recent + unused defaults)
  const suggestedTags = useMemo(() => {
    return allTags
      .filter((t) => !value.includes(t.tag))
      .slice(0, SUGGESTED_TAGS_COUNT);
  }, [allTags, value]);

  // Add tag
  const addTag = useCallback((tag: string) => {
    const cleaned = tag.trim();
    if (!cleaned) return;
    if (value.includes(cleaned)) return;
    if (value.length >= MAX_TAGS) return;

    onChange([...value, cleaned]);
    setInput('');
    setHighlightIndex(-1);
  }, [value, onChange]);

  // Remove tag
  const removeTag = useCallback((tag: string) => {
    onChange(value.filter((t) => t !== tag));
  }, [value, onChange]);

  // Start editing a tag
  const startEdit = useCallback((tag: string) => {
    setEditingTag(tag);
    setEditValue(tag);
  }, []);

  // Save edited tag
  const saveEdit = useCallback(() => {
    if (!editingTag) return;
    const cleaned = editValue.trim();

    if (!cleaned || cleaned === editingTag) {
      // No change or empty - just cancel
      setEditingTag(null);
      setEditValue('');
      return;
    }

    // Check if new value already exists (and isn't the current tag)
    if (value.includes(cleaned)) {
      // Just remove the old tag since new one exists
      onChange(value.filter((t) => t !== editingTag));
    } else {
      // Replace old tag with new
      onChange(value.map((t) => t === editingTag ? cleaned : t));
    }

    setEditingTag(null);
    setEditValue('');
  }, [editingTag, editValue, value, onChange]);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    setEditingTag(null);
    setEditValue('');
  }, []);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingTag && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTag]);

  // Handle key down - uses dropdownItems which is either filtered suggestions or all suggested tags
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    // Get the current dropdown items based on input state
    const currentItems = input.trim().length > 0 ? suggestions : suggestedTags;

    switch (e.key) {
      case 'Enter':
      case ',':
        e.preventDefault();
        if (highlightIndex >= 0 && currentItems[highlightIndex]) {
          addTag(currentItems[highlightIndex].tag);
        } else if (input.trim()) {
          addTag(input);
        }
        break;

      case 'Backspace':
        if (!input && value.length > 0) {
          removeTag(value[value.length - 1]);
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (currentItems.length > 0) {
          setHighlightIndex((prev) =>
            prev < currentItems.length - 1 ? prev + 1 : 0
          );
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (currentItems.length > 0) {
          setHighlightIndex((prev) =>
            prev > 0 ? prev - 1 : currentItems.length - 1
          );
        }
        break;

      case 'Escape':
        setIsOpen(false);
        setHighlightIndex(-1);
        break;
    }
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlightIndex(-1);
  }, [input]);

  // Show dropdown when focused - either with filtered suggestions or all suggested tags
  const showDropdown = isOpen && (suggestions.length > 0 || (suggestedTags.length > 0 && !input.trim()));

  // Items to display in dropdown
  const dropdownItems = input.trim().length > 0 ? suggestions : suggestedTags;

  return (
    <div ref={containerRef} className="relative">
      {/* Input area with chips */}
      <div
        ref={scrollContainerRef}
        className={cn(
          'flex items-center gap-1.5 px-3 h-[38px] overflow-x-auto overflow-y-hidden',
          'border border-[var(--tropx-border)] rounded-lg bg-[var(--tropx-muted)]',
          'focus-within:ring-2 focus-within:ring-[var(--tropx-vibrant)] focus-within:border-transparent',
          // Hide scrollbar but allow scrolling
          'scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onClick={() => inputRef.current?.focus()}
        onFocus={() => setIsFocused(true)}
        onBlur={(e) => {
          // Only blur if focus is leaving the container entirely
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setIsFocused(false);
          }
        }}
      >
        {/* Marquee wrapper for tags when not focused and overflowing */}
        {!isFocused && isOverflowing && value.length > 0 ? (
          <div
            className="flex items-center gap-1.5 shrink-0 animate-marquee"
            style={{
              animationDuration: `${Math.max(8, value.length * 3)}s`,
            }}
          >
            {/* First set of tags */}
            {value.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium shrink-0 bg-[var(--tropx-vibrant)] text-white shadow-sm"
              >
                {tag}
              </span>
            ))}
            {/* Spacer */}
            <span className="w-8 shrink-0" />
            {/* Duplicate tags for seamless loop */}
            {value.map((tag) => (
              <span
                key={`dup-${tag}`}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium shrink-0 bg-[var(--tropx-vibrant)] text-white shadow-sm"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
        {/* Selected tags as chips */}
        {value.map((tag) => (
          editingTag === tag ? (
            // Edit mode - show input (matches filled style)
            <input
              key={tag}
              ref={editInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={saveEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === 'Escape') {
                  cancelEdit();
                }
                e.stopPropagation();
              }}
              className={cn(
                'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium shrink-0',
                'bg-[var(--tropx-vibrant)] text-white',
                'outline-none ring-2 ring-white ring-offset-1 ring-offset-[var(--tropx-vibrant)]',
                'min-w-[60px] w-auto'
              )}
              style={{ width: `${Math.max(editValue.length * 7, 60)}px` }}
            />
          ) : (
            // Display mode - chip with centered overlay on hover
            <span
              key={tag}
              className={cn(
                'group relative inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium shrink-0',
                'bg-[var(--tropx-vibrant)] text-white',
                'shadow-sm',
                !disabled && 'cursor-pointer'
              )}
              onClick={(e) => {
                if (!disabled) {
                  e.stopPropagation();
                  removeTag(tag);
                }
              }}
            >
              {tag}
              {!disabled && (
                <div className="absolute inset-0 rounded-full bg-[var(--tropx-vibrant)] hidden group-hover:flex items-center justify-center gap-1">
                  {/* Edit button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(tag);
                    }}
                    className={cn(
                      'rounded-full p-1',
                      'hover:bg-white/20',
                      'active:scale-95'
                    )}
                  >
                    <Pencil className="size-3" />
                  </button>
                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTag(tag);
                    }}
                    className={cn(
                      'rounded-full p-1',
                      'hover:bg-white/20',
                      'active:scale-95'
                    )}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
            </span>
          )
        ))}
        </div>
        )}

        {/* Input */}
        {value.length < MAX_TAGS && (
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
            placeholder={value.length === 0 ? placeholder : ''}
            disabled={disabled}
            className={cn(
              'flex-1 min-w-[100px] bg-transparent outline-none text-sm',
              'text-[var(--tropx-text-main)] placeholder-[var(--tropx-text-sub)]'
            )}
          />
        )}
      </div>

      {/* Autocomplete dropdown */}
      {showDropdown && (
        <div
          className={cn(
            'absolute top-full left-0 right-0 z-50 mt-1',
            'bg-[var(--tropx-card)] rounded-lg shadow-lg',
            'border border-[var(--tropx-border)] backdrop-blur-sm',
            'max-h-28 overflow-y-auto',
            // Custom scrollbar styling
            'scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[var(--tropx-border)]',
            '[&::-webkit-scrollbar]:w-1.5',
            '[&::-webkit-scrollbar-track]:bg-transparent',
            '[&::-webkit-scrollbar-thumb]:bg-[var(--tropx-border)]',
            '[&::-webkit-scrollbar-thumb]:rounded-full'
          )}
        >
          <div className="py-0.5">
            {dropdownItems.map((item, idx) => (
              <button
                key={item.tag}
                type="button"
                onClick={() => addTag(item.tag)}
                className={cn(
                  'w-full text-left px-2.5 py-2 text-sm transition-all',
                  'hover:bg-gradient-to-r hover:from-[var(--tropx-muted)] hover:to-transparent',
                  idx === highlightIndex && 'bg-[var(--tropx-muted)]'
                )}
              >
                <span className="text-[var(--tropx-text-main)] font-medium">{item.tag}</span>
                {item.isDefault ? (
                  <span className="text-[var(--tropx-vibrant)] text-xs ml-1.5 inline-flex items-center gap-0.5">
                    <Sparkles className="size-3" />
                    suggested
                  </span>
                ) : (
                  <span className="text-[var(--tropx-text-sub)] text-xs ml-1.5">
                    {item.usageCount}x
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
