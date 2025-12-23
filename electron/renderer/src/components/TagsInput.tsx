import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { api } from '../../../../convex/_generated/api';
import { useSyncedQuery } from '@/lib/cache';
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
  const inputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch user's tags + defaults (synced with timestamps)
  const { data: tagsData } = useSyncedQuery(api.tags.getTagsWithDefaults, { limit: 20 }, {
    timestamps: api.sync.getTagTimestamps,
  });

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

  // Handle key down
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    switch (e.key) {
      case 'Enter':
      case ',':
        e.preventDefault();
        if (highlightIndex >= 0 && suggestions[highlightIndex]) {
          addTag(suggestions[highlightIndex].tag);
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
        if (suggestions.length > 0) {
          setHighlightIndex((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (suggestions.length > 0) {
          setHighlightIndex((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
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

  const showDropdown = isOpen && suggestions.length > 0 && input.trim().length > 0;

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Input area with chips */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 p-2 min-h-[42px]',
          'border border-[var(--tropx-border)] rounded-lg bg-[var(--tropx-card)]',
          'focus-within:ring-2 focus-within:ring-[var(--tropx-vibrant)] focus-within:border-transparent',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        onClick={() => inputRef.current?.focus()}
      >
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
                'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
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
                'group relative inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
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
        <div className="relative">
          <div className={cn(
            'absolute z-10 w-full bg-[var(--tropx-card)] rounded-xl shadow-lg max-h-48 overflow-y-auto',
            'border border-[var(--tropx-border)] backdrop-blur-sm'
          )}>
            {suggestions.map((suggestion, idx) => (
              <button
                key={suggestion.tag}
                type="button"
                onClick={() => addTag(suggestion.tag)}
                className={cn(
                  'w-full text-left px-3 py-2.5 text-sm transition-all',
                  'hover:bg-gradient-to-r hover:from-[var(--tropx-muted)] hover:to-transparent',
                  idx === highlightIndex && 'bg-[var(--tropx-muted)]',
                  idx === 0 && 'rounded-t-xl',
                  idx === suggestions.length - 1 && 'rounded-b-xl'
                )}
              >
                <span className="text-[var(--tropx-text-main)] font-medium">{suggestion.tag}</span>
                {suggestion.isDefault ? (
                  <span className="text-[var(--tropx-vibrant)] text-xs ml-2 inline-flex items-center gap-1">
                    <Sparkles className="size-3" />
                    suggested
                  </span>
                ) : (
                  <span className="text-[var(--tropx-text-sub)] text-xs ml-2">
                    used {suggestion.usageCount}x
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Suggested tags - animated on focus */}
      <div
        className={cn(
          'grid transition-all duration-300 ease-out',
          isOpen && suggestedTags.length > 0 && !disabled
            ? 'grid-rows-[1fr] opacity-100'
            : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <span className="text-xs text-[var(--tropx-text-sub)] flex items-center gap-1">
              <Sparkles className="size-3" />
            </span>
            {suggestedTags.map((tag, idx) => (
              <button
                key={tag.tag}
                type="button"
                onClick={() => addTag(tag.tag)}
                disabled={disabled}
                style={{
                  transitionDelay: isOpen ? `${idx * 30}ms` : '0ms',
                }}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-medium',
                  'transition-all duration-200',
                  'hover:scale-105 active:scale-95',
                  isOpen
                    ? 'translate-y-0 opacity-100'
                    : 'translate-y-2 opacity-0',
                  // Ghost orange style for all suggested tags
                  'bg-transparent text-[var(--tropx-vibrant)] border border-[var(--tropx-vibrant)]/40',
                  'hover:border-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/5',
                  disabled && 'cursor-not-allowed opacity-50'
                )}
              >
                {tag.tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tag count indicator */}
      {value.length > 0 && (
        <div className="text-xs text-[var(--tropx-text-sub)] text-right">
          {value.length}/{MAX_TAGS} tags
        </div>
      )}
    </div>
  );
}
