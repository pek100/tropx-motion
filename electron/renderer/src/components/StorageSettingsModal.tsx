import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { FolderOpen, RotateCcw } from 'lucide-react';

interface StorageSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPath: string;
  onSelectFolder: () => Promise<string | null>;
  onResetPath: () => void;
}

export function StorageSettingsModal({
  open,
  onOpenChange,
  currentPath,
  onSelectFolder,
  onResetPath
}: StorageSettingsModalProps) {
  const [isSelecting, setIsSelecting] = useState(false);

  const handleSelectFolder = async () => {
    setIsSelecting(true);
    try {
      await onSelectFolder();
    } finally {
      setIsSelecting(false);
    }
  };

  const handleReset = () => {
    onResetPath();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--tropx-text-main)]">
              Default Export Location
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 text-sm bg-[var(--tropx-muted)] rounded-lg border border-[var(--tropx-border)] truncate text-[var(--tropx-text-main)]">
                {currentPath}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleSelectFolder}
              disabled={isSelecting}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium
                bg-[var(--tropx-vibrant)] text-white rounded-lg
                hover:opacity-90 transition-all
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSelecting ? (
                <svg className="animate-spin size-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <FolderOpen className="size-4" />
              )}
              Change Location
            </button>

            <button
              onClick={handleReset}
              className="flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium
                border border-[var(--tropx-border)] text-[var(--tropx-text-main)] rounded-lg
                hover:bg-[var(--tropx-muted)] transition-all"
            >
              <RotateCcw className="size-4" />
              Reset
            </button>
          </div>

          <p className="text-xs text-[var(--tropx-text-sub)]">
            Recordings will be saved as CSV files with timestamps in the filename.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
