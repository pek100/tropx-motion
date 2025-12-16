import { CircleUser, Save, Upload, User, Tag, Check, X } from 'lucide-react'
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

interface ActionBarProps {
  onActionClick: (actionId: ActionId) => void
  onExportCSV: () => void
  isExporting?: boolean
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
  /** Recording title save handler */
  onRecordingTitleSave?: () => void
  /** Recording title revert handler */
  onRecordingTitleRevert?: () => void
  /** Whether title has unsaved changes */
  titleDirty?: boolean
  /** Whether title was just saved (for green flash) */
  titleJustSaved?: boolean
}

export function ActionBar({
  onActionClick,
  onExportCSV,
  isExporting,
  isEditing,
  selectedPatientName,
  selectedPatientImage,
  recordingTitle,
  onRecordingTitleChange,
  onRecordingTitleSave,
  onRecordingTitleRevert,
  titleDirty,
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
    <div className="size-4 rounded-full bg-violet-100 flex items-center justify-center">
      <User className="size-2.5 text-violet-600" />
    </div>
  ) : (
    <CircleUser className="size-4" />
  )
  return (
    <div className="action-bar pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* Left group: Save, Export (dropdown), Load - labels hidden below 1700px */}
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
          isExporting={isExporting}
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

      {/* Middle group: Patient Name + Recording Title Input */}
      <IslandButtonGroup>
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
            "border-l border-gray-200/50",
            "min-w-[200px] max-w-[280px]"
          )}
        >
          <Tag className={cn(
            "size-4 flex-shrink-0 transition-colors duration-300",
            titleJustSaved ? "text-green-500" : titleDirty ? "text-orange-400" : "text-[var(--tropx-shadow)]"
          )} />
          <input
            type="text"
            value={recordingTitle ?? ''}
            onChange={(e) => onRecordingTitleChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && titleDirty) {
                e.preventDefault()
                onRecordingTitleSave?.()
              } else if (e.key === 'Escape' && titleDirty) {
                e.preventDefault()
                onRecordingTitleRevert?.()
              }
            }}
            placeholder="Recording title..."
            className={cn(
              "flex-1 text-sm font-medium",
              "text-[var(--tropx-shadow)] placeholder-[var(--tropx-ivory-dark)]",
              "outline-none min-w-0",
              "px-2 py-1 rounded-md transition-all duration-300",
              titleJustSaved
                ? "bg-green-50 border-2 border-green-500"
                : titleDirty
                  ? "bg-orange-50 border-2 border-orange-400"
                  : "bg-transparent border-2 border-transparent"
            )}
          />
          {titleDirty && (
            <button
              type="button"
              onClick={onRecordingTitleRevert}
              className={cn(
                "p-1 rounded-full transition-all duration-300 flex-shrink-0",
                "cursor-pointer",
                "text-gray-400 hover:text-red-500 hover:bg-red-50"
              )}
            >
              <X className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onRecordingTitleSave}
            disabled={!titleDirty && !titleJustSaved}
            className={cn(
              "p-1 rounded-full transition-all duration-300 flex-shrink-0",
              "cursor-pointer disabled:cursor-default",
              titleJustSaved
                ? "text-green-500 bg-green-50"
                : titleDirty
                  ? "text-orange-500 hover:text-orange-600 hover:bg-orange-50"
                  : "text-gray-300"
            )}
          >
            <Check className="size-4" />
          </button>
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
