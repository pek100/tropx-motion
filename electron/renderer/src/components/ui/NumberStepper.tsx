/**
 * NumberStepper - A numeric input with increment/decrement buttons.
 * Supports min/max constraints, wheel scrolling, and null state.
 */

import { ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NumberStepperProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function NumberStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  disabled = false,
  placeholder = '–',
  className,
}: NumberStepperProps) {
  const handleDecrement = () => {
    if (value === null) return;
    if (value <= min) {
      onChange(null);
    } else {
      onChange(value - 1);
    }
  };

  const handleIncrement = () => {
    onChange(Math.min(max, (value ?? 0) + 1));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) {
      onChange(null);
    } else {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed)) {
        onChange(Math.min(max, Math.max(min, parsed)));
      }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (disabled) return;

    const delta = e.deltaY < 0 ? 1 : -1;
    if (delta > 0) {
      handleIncrement();
    } else {
      handleDecrement();
    }
  };

  return (
    <div
      className={cn(
        'flex items-center rounded-lg border border-[var(--tropx-border)] bg-[var(--tropx-muted)] overflow-hidden',
        'focus-within:ring-2 focus-within:ring-[var(--tropx-vibrant)] focus-within:border-transparent',
        disabled && 'opacity-50',
        className
      )}
    >
      <button
        type="button"
        onClick={handleDecrement}
        disabled={disabled}
        className="px-1.5 py-1.5 text-[var(--tropx-shadow)] hover:text-[var(--tropx-text-main)] hover:bg-[var(--tropx-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronDown className="size-3.5" />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        onChange={handleInputChange}
        onWheel={handleWheel}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'w-8 py-1.5 text-sm text-center bg-transparent',
          'text-[var(--tropx-text-main)] placeholder-[var(--tropx-text-sub)]',
          'focus:outline-none',
          '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
        )}
      />
      <button
        type="button"
        onClick={handleIncrement}
        disabled={disabled || value === max}
        className="px-1.5 py-1.5 text-[var(--tropx-shadow)] hover:text-[var(--tropx-text-main)] hover:bg-[var(--tropx-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronUp className="size-3.5" />
      </button>
    </div>
  );
}
