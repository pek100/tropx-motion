import { CircleUser, Tag, FileText, Save, Upload } from 'lucide-react'
import { IslandButton } from './IslandButton'
import { IslandButtonGroup } from './IslandButtonGroup'
import { AtomSpin } from './AtomSpin'
import { ExportDropdownButton } from './ExportDropdownButton'

// Action bar item identifiers
export type ActionId =
  | 'ai-analysis'
  | 'patient-name'
  | 'recording-title'
  | 'description'
  | 'save'
  | 'load'

interface ActionBarProps {
  onActionClick: (actionId: ActionId) => void
  onExportCSV: () => void
  isExporting?: boolean
}

export function ActionBar({ onActionClick, onExportCSV, isExporting }: ActionBarProps) {
  return (
    <div className="action-bar pointer-events-auto" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* AI Analysis - single button island for consistency */}
      <IslandButtonGroup>
        <IslandButton
          icon={<AtomSpin className="size-4 text-[var(--tropx-vibrant)]" />}
          label="AI Analysis"
          grouped
          onClick={() => onActionClick('ai-analysis')}
        />
      </IslandButtonGroup>

      {/* Middle group: Patient Name, Recording Title, Description */}
      <IslandButtonGroup>
        <IslandButton
          icon={<CircleUser className="size-4" />}
          label="Patient Name"
          grouped
          onClick={() => onActionClick('patient-name')}
        />
        <IslandButton
          icon={<Tag className="size-4" />}
          label="Recording Title"
          grouped
          onClick={() => onActionClick('recording-title')}
        />
        <IslandButton
          icon={<FileText className="size-4" />}
          label="Description"
          grouped
          onClick={() => onActionClick('description')}
        />
      </IslandButtonGroup>

      {/* Right group: Save, Export (dropdown), Load */}
      <IslandButtonGroup>
        <IslandButton
          icon={<Save className="size-4" />}
          label="Save"
          grouped
          onClick={() => onActionClick('save')}
        />
        <ExportDropdownButton
          onExportCSV={onExportCSV}
          isExporting={isExporting}
        />
        <IslandButton
          icon={<Upload className="size-4" />}
          label="Load"
          grouped
          onClick={() => onActionClick('load')}
        />
      </IslandButtonGroup>
    </div>
  )
}
