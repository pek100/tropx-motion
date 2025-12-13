import { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, FileText, Cloud, Database, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExportDropdownButtonProps {
  onExportCSV: (interpolated?: boolean) => void;
  disabled?: boolean;
  isExporting?: boolean;
  /** Hide label at smallest breakpoint */
  hideLabel?: boolean;
}

type ExportOption = 'csv' | 'csv-interpolated' | 'json' | 'cloud';

interface MenuItem {
  id: ExportOption;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  badge?: string;
  description?: string;
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'csv', label: 'Export CSV', icon: <FileText className="size-4" />, description: 'Raw data' },
  { id: 'csv-interpolated', label: 'Export Interpolated', icon: <Wand2 className="size-4" />, description: 'Uniform 100Hz' },
  { id: 'json', label: 'Export JSON', icon: <Database className="size-4" />, disabled: true, badge: 'Soon' },
  { id: 'cloud', label: 'Cloud Sync', icon: <Cloud className="size-4" />, disabled: true, badge: 'Soon' },
];

export function ExportDropdownButton({ onExportCSV, disabled, isExporting, hideLabel }: ExportDropdownButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [defaultAction] = useState<ExportOption>('csv');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMainClick = () => {
    if (disabled || isExporting) return;
    if (defaultAction === 'csv') {
      onExportCSV(false);
    } else if (defaultAction === 'csv-interpolated') {
      onExportCSV(true);
    }
  };

  const handleMenuItemClick = (item: MenuItem) => {
    if (item.disabled) return;
    setIsOpen(false);
    if (item.id === 'csv') {
      onExportCSV(false);
    } else if (item.id === 'csv-interpolated') {
      onExportCSV(true);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Combined button matching IslandButton style */}
      <button
        onClick={handleMainClick}
        disabled={disabled || isExporting}
        className={cn(
          'inline-flex items-center gap-2.5 pl-6 pr-2 py-4 text-sm font-medium cursor-pointer whitespace-nowrap border-transparent',
          'text-[var(--tropx-shadow)]',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        {isExporting ? (
          <svg className="animate-spin size-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <Download className="size-4" />
        )}
        <span className={cn(hideLabel && 'hidden actionbar-lg:inline')}>Export</span>

        {/* Dropdown arrow integrated */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled && !isExporting) setIsOpen(!isOpen);
          }}
          className="ml-1 pl-2 border-l border-[var(--tropx-shadow)]/20 cursor-pointer"
        >
          <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} />
        </div>
      </button>

      {/* Dropdown menu - opens upward */}
      {isOpen && (
        <div
          className="absolute right-0 bottom-full mb-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleMenuItemClick(item);
              }}
              disabled={item.disabled}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors',
                item.disabled ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-50 cursor-pointer',
                item.id === defaultAction && !item.disabled && 'bg-gray-50'
              )}
            >
              {item.icon}
              <div className="flex-1">
                <div>{item.label}</div>
                {item.description && (
                  <div className="text-xs text-gray-400">{item.description}</div>
                )}
              </div>
              {item.badge && (
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                  {item.badge}
                </span>
              )}
              {item.id === defaultAction && !item.disabled && (
                <span className="text-xs text-[var(--tropx-vibrant)]">Default</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
