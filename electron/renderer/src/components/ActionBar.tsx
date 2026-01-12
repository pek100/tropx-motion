import { CircleUser, Save, Upload, User, Tag } from 'lucide-react'
import { IslandButton } from './IslandButton'
import { IslandButtonGroup } from './IslandButtonGroup'
import { AtomSpin } from './AtomSpin'
import { ExportDropdownButton } from './ExportDropdownButton'
import { cn } from '@/lib/utils'

// Action bar item identifiers
export type ActionId =
  | 'ai-analysis'
  | 'patient-name'
  | 'save'
  | 'load'

// ─────────────────────────────────────────────────────────────────
// Title Input Styling Constants
// ─────────────────────────────────────────────────────────────────

const TITLE_ICON_STYLES = {
  base: "size-4 flex-shrink-0 transition-colors duration-300",
  typing: "text-orange-400",
  saved: "text-green-500",
  idle: "text-[var(--tropx-shadow)]",
} as const

const TITLE_INPUT_STYLES = {
  base: "flex-1 text-sm font-medium text-[var(--tropx-text-main)] placeholder-[var(--tropx-text-sub)] outline-none min-w-0 px-2 py-1 rounded-md transition-all duration-300 border-2",
  typing: "bg-orange-50 dark:bg-orange-950/30 border-orange-400",
  saved: "bg-green-50 dark:bg-green-950/30 border-green-500",
  idle: "bg-transparent border-transparent",
} as const

interface ActionBarProps {
  onActionClick: (actionId: ActionId) => void
  onExportCSV: () => void
  onImportCSV: () => void
  isExporting?: boolean
  isImporting?: boolean
  /** When true, shows "Edit & Save" instead of "Save" */
  isEditing?: boolean
  /** Selected patient name to display */
  selectedPatientName?: string
  /** Selected patient image URL */
  selectedPatientImage?: string
  /** Recording title value */
  recordingTitle?: string
  /** Recording title change handler */
  onRecordingTitleChange?: (title: string) => void
  /** Whether user is actively typing */
  isTyping?: boolean
  /** Whether title was just saved (for green flash) */
  titleJustSaved?: boolean
}

export function ActionBar({
  onActionClick,
  onExportCSV,
  onImportCSV,
  isExporting,
  isImporting,
  isEditing,
  selectedPatientName,
  selectedPatientImage,
  recordingTitle,
  onRecordingTitleChange,
  isTyping,
  titleJustSaved,
}: ActionBarProps) {
  // Patient button icon - show image if available, otherwise default icon
  const patientIcon = selectedPatientImage ? (
    <img
      src={selectedPatientImage}
      alt={selectedPatientName || 'Patient'}
      className="size-4 rounded-full object-cover"
    />
  ) : selectedPatientName ? (
    <div className="size-4 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
      <User className="size-2.5 text-violet-600" />
    </div>
  ) : (
    <CircleUser className="size-4" />
  )
  return (
    <div className="action-bar pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* Left group: Save, Export/Import dropdown, Load - labels hidden below 1700px */}
      <IslandButtonGroup>
        <IslandButton
          icon={<Save className="size-4" />}
          label={isEditing ? "Edit & Save" : "Save"}
          hideLabel
          grouped
          onClick={() => onActionClick('save')}
        />
        <ExportDropdownButton
          onExportCSV={onExportCSV}
          onImportCSV={onImportCSV}
          isExporting={isExporting}
          isImporting={isImporting}
          hideLabel
        />
        <IslandButton
          icon={<Upload className="size-4" />}
          label="Load"
          hideLabel
          grouped
          onClick={() => onActionClick('load')}
        />
      </IslandButtonGroup>

      {/* Middle group: Patient Name + Recording Title Input - hidden below 1300px */}
      <IslandButtonGroup className="!hidden min-[1300px]:!flex">
        <IslandButton
          icon={patientIcon}
          label={selectedPatientName || "Patient Name"}
          shortLabel={selectedPatientName || "Name"}
          grouped
          onClick={() => onActionClick('patient-name')}
        />
        {/* Recording Title Input */}
        <div
          className={cn(
            "flex items-center gap-2.5 px-4 py-2.5",
            "border-l border-[var(--tropx-border)]/50",
            "min-w-[200px] max-w-[280px]"
          )}
        >
          <Tag className={cn(
            TITLE_ICON_STYLES.base,
            titleJustSaved ? TITLE_ICON_STYLES.saved : isTyping ? TITLE_ICON_STYLES.typing : TITLE_ICON_STYLES.idle
          )} />
          <input
            type="text"
            value={recordingTitle ?? ''}
            onChange={(e) => onRecordingTitleChange?.(e.target.value)}
            placeholder="Recording title..."
            className={cn(
              TITLE_INPUT_STYLES.base,
              titleJustSaved ? TITLE_INPUT_STYLES.saved : isTyping ? TITLE_INPUT_STYLES.typing : TITLE_INPUT_STYLES.idle
            )}
          />
        </div>
      </IslandButtonGroup>

      {/* Right group: AI Analysis - icon only below 1200px, "AI Analysis" at 1200px+ */}
      <IslandButtonGroup>
        <IslandButton
          icon={<AtomSpin className="size-4 text-[var(--tropx-vibrant)]" />}
          label="AI Analysis"
          showFullAt1200
          grouped
          onClick={() => onActionClick('ai-analysis')}
        />
      </IslandButtonGroup>
    </div>
  )
}
