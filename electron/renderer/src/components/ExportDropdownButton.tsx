import { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExportDropdownButtonProps {
  onExportCSV: () => void;
  onImportCSV: () => void;
  disabled?: boolean;
  isExporting?: boolean;
  isImporting?: boolean;
  /** Hide label at smallest breakpoint */
  hideLabel?: boolean;
}

type MenuOption = 'export' | 'import';

interface MenuItem {
  id: MenuOption;
  label: string;
  icon: React.ReactNode;
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'export', label: 'Export CSV', icon: <Download className="size-4" /> },
  { id: 'import', label: 'Import CSV', icon: <Upload className="size-4" /> },
];

export function ExportDropdownButton({ onExportCSV, onImportCSV, disabled, isExporting, isImporting, hideLabel }: ExportDropdownButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isBusy = isExporting || isImporting;

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
    if (disabled || isBusy) return;
    onExportCSV();
  };

  const handleMenuItemClick = (item: MenuItem) => {
    setIsOpen(false);
    if (item.id === 'export') {
      onExportCSV();
    } else if (item.id === 'import') {
      onImportCSV();
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Combined button matching IslandButton style */}
      <button
        onClick={handleMainClick}
        disabled={disabled || isBusy}
        className={cn(
          'inline-flex items-center gap-2.5 pl-6 pr-2 py-4 text-sm font-medium cursor-pointer whitespace-nowrap border-transparent',
          'text-[var(--tropx-shadow)]',
          'disabled:opacity-50 disabled:cursor-not-allowed'
        )}
      >
        {isBusy ? (
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
            if (!disabled && !isBusy) setIsOpen(!isOpen);
          }}
          className="ml-1 pl-2 border-l border-[var(--tropx-shadow)]/20 cursor-pointer"
        >
          <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} />
        </div>
      </button>

      {/* Dropdown menu - opens upward */}
      {isOpen && (
        <div
          className="absolute right-0 bottom-full mb-2 w-48 bg-[var(--tropx-card)] rounded-xl shadow-lg border border-[var(--tropx-border)] py-1 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
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
              className={cn(
                'w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors',
                'text-[var(--tropx-text-main)] hover:bg-[var(--tropx-muted)] cursor-pointer'
              )}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
