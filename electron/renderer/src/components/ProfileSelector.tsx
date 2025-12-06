/**
 * Profile Selector Modal
 * Opened via Ctrl+Shift+R, allows manual profile selection
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useUIProfile, getAllProfiles, type ProfileId } from '@/lib/ui-profiles';

interface ProfileSelectorProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileSelector({ isOpen, onClose }: ProfileSelectorProps) {
  const { profileId, isAutoDetected, detectedProfileId, setOverride } = useUIProfile();
  const modalRef = useRef<HTMLDivElement>(null);
  const selectedIndexRef = useRef(0);

  // Memoize profiles list (stable reference)
  const profiles = useMemo(() => getAllProfiles(), []);

  // Memoize options array to prevent unnecessary re-renders
  const options = useMemo(() => [
    { id: null as ProfileId | null, label: `Auto (${detectedProfileId})` },
    ...profiles.map(p => ({ id: p.id as ProfileId | null, label: p.label })),
  ], [profiles, detectedProfileId]);

  // Find current selection index
  const currentIndex = isAutoDetected
    ? 0
    : options.findIndex(o => o.id === profileId);

  useEffect(() => {
    selectedIndexRef.current = currentIndex >= 0 ? currentIndex : 0;
  }, [currentIndex]);

  // Handle selection
  const handleSelect = useCallback((id: ProfileId | null) => {
    setOverride(id);
    onClose();
  }, [setOverride, onClose]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;

        case 'ArrowDown':
          e.preventDefault();
          selectedIndexRef.current = Math.min(selectedIndexRef.current + 1, options.length - 1);
          updateFocus();
          break;

        case 'ArrowUp':
          e.preventDefault();
          selectedIndexRef.current = Math.max(selectedIndexRef.current - 1, 0);
          updateFocus();
          break;

        case 'Enter':
          e.preventDefault();
          const selected = options[selectedIndexRef.current];
          if (selected) handleSelect(selected.id);
          break;
      }
    };

    const updateFocus = () => {
      const buttons = modalRef.current?.querySelectorAll<HTMLButtonElement>('[data-profile-option]');
      buttons?.[selectedIndexRef.current]?.focus();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, options, handleSelect, onClose]);

  // Focus first option on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        const buttons = modalRef.current?.querySelectorAll<HTMLButtonElement>('[data-profile-option]');
        const focusIndex = currentIndex >= 0 ? currentIndex : 0;
        buttons?.[focusIndex]?.focus();
      }, 50);
    }
  }, [isOpen, currentIndex]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative bg-white rounded-2xl shadow-2xl w-[320px] overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="UI Profile Selector"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">UI Profile</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Options */}
        <div className="py-2">
          {options.map((option, index) => {
            const isSelected = option.id === null
              ? isAutoDetected
              : option.id === profileId && !isAutoDetected;

            const isAuto = option.id === null;

            return (
              <button
                key={option.id ?? 'auto'}
                data-profile-option
                onClick={() => handleSelect(option.id)}
                className={`w-full px-5 py-3 flex items-center gap-3 text-left transition-colors focus:outline-none focus:bg-gray-50
                  ${isSelected ? 'bg-orange-50' : 'hover:bg-gray-50'}
                  ${isAuto ? 'border-b border-gray-100' : ''}
                `}
              >
                {/* Radio indicator */}
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
                  ${isSelected ? 'border-orange-500' : 'border-gray-300'}
                `}>
                  {isSelected && (
                    <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                  )}
                </div>

                {/* Label */}
                <span className={`text-sm ${isSelected ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
                  {option.label}
                </span>

                {/* Current indicator */}
                {isSelected && (
                  <span className="ml-auto text-xs text-orange-600 font-medium">
                    Active
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer with shortcuts */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <span>
            <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-200 font-mono">↑↓</kbd>
            {' '}Navigate
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-200 font-mono">Enter</kbd>
            {' '}Select
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-200 font-mono">Esc</kbd>
            {' '}Close
          </span>
        </div>
      </div>
    </div>
  );
}
