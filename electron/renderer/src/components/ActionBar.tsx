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
      {/* Left group: Save, Export (dropdown), Load - labels hidden below 1700px */}
      <IslandButtonGroup>
        <IslandButton
          icon={<Save className="size-4" />}
          label="Save"
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

      {/* Middle group: Patient Name, Recording Title, Description - short labels below 1700px */}
      <IslandButtonGroup>
        <IslandButton
          icon={<CircleUser className="size-4" />}
          label="Patient Name"
          shortLabel="Name"
          grouped
          onClick={() => onActionClick('patient-name')}
        />
        <IslandButton
          icon={<Tag className="size-4" />}
          label="Recording Title"
          shortLabel="Title"
          grouped
          onClick={() => onActionClick('recording-title')}
        />
        <IslandButton
          icon={<FileText className="size-4" />}
          label="Description"
          shortLabel="Desc"
          grouped
          onClick={() => onActionClick('description')}
        />
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
