import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActionId } from './ActionBar'
import { PatientSearchModal } from './PatientSearchModal'
import { SaveModal } from './SaveModal'
import { LoadModal } from './LoadModal'
import { Id } from '../../../../convex/_generated/dataModel'

// Modal titles for each action
const MODAL_TITLES: Record<ActionId, string> = {
  'ai-analysis': 'AI Analysis',
  'patient-name': 'Patient Name',
  'save': 'Save Recording',
  'load': 'Load Recording',
}

interface ActionModalProps {
  actionId: ActionId | null
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedPatientId?: Id<"users"> | null
  selectedPatientName?: string
  selectedPatientImage?: string
  onPatientSelect?: (patient: { userId: Id<"users">; name: string; alias?: string; image?: string } | undefined) => void
  // Recording title (synced with toolbar)
  recordingTitle?: string
  onRecordingTitleChange?: (title: string) => void
  // Recording context for save/edit mode
  currentSessionId?: string | null
  recordingSource?: 'app' | 'csv'
  onLoadSession?: (sessionId: string) => void
  onImportCSV?: () => void
  // Pre-select session in LoadModal (from notification)
  initialLoadSessionId?: string
}

export function ActionModal({
  actionId,
  open,
  onOpenChange,
  selectedPatientId,
  selectedPatientName,
  selectedPatientImage,
  onPatientSelect,
  recordingTitle,
  onRecordingTitleChange,
  currentSessionId,
  recordingSource = 'app',
  onLoadSession,
  onImportCSV,
  initialLoadSessionId,
}: ActionModalProps) {
  // For patient-name, use PatientSearchModal directly
  if (actionId === 'patient-name') {
    return (
      <PatientSearchModal
        open={open}
        onOpenChange={onOpenChange}
        selectedPatientId={selectedPatientId}
        onSelectPatient={(patient) => {
          onPatientSelect?.({
            userId: patient.userId,
            name: patient.name,
            alias: patient.alias,
            image: patient.image,
          })
        }}
      />
    )
  }

  // For save, use SaveModal
  // If currentSessionId exists, it's edit mode; otherwise save mode
  if (actionId === 'save') {
    return (
      <SaveModal
        open={open}
        onOpenChange={onOpenChange}
        mode={currentSessionId ? 'edit' : 'save'}
        selectedPatientId={selectedPatientId}
        selectedPatientName={selectedPatientName}
        selectedPatientImage={selectedPatientImage}
        recordingSource={recordingSource}
        recordingTitle={recordingTitle}
        onRecordingTitleChange={onRecordingTitleChange}
        onPatientSelect={(patient) => {
          if (patient) {
            onPatientSelect?.({
              userId: patient.userId,
              name: patient.name,
              image: patient.image,
            })
          } else {
            // Clear selection - need to handle in App.tsx
            onPatientSelect?.(undefined as any)
          }
        }}
        sessionId={currentSessionId ?? undefined}
      />
    )
  }

  // For load, use LoadModal
  if (actionId === 'load') {
    return (
      <LoadModal
        open={open}
        onOpenChange={onOpenChange}
        onLoadSession={onLoadSession ?? (() => {})}
        onImportCSV={onImportCSV}
        initialSessionId={initialLoadSessionId}
      />
    )
  }

  if (!actionId) return null

  const handleClose = () => onOpenChange(false)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Blur overlay - click to close */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 modal-blur-overlay cursor-default',
            'data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]',
            'data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]'
          )}
          style={{
            willChange: 'opacity',
            transform: 'translateZ(0)',
          }}
          onClick={handleClose}
        />

        {/* Modal content */}
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 z-[51] m-auto',
            'w-full max-w-md h-fit p-6',
            'bg-white rounded-2xl shadow-lg border border-gray-100',
            'data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]',
            'data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]',
            'pointer-events-auto'
          )}
          onPointerDownOutside={handleClose}
          onInteractOutside={handleClose}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <DialogPrimitive.Title className="text-lg font-semibold text-[var(--tropx-dark)]">
              {MODAL_TITLES[actionId]}
            </DialogPrimitive.Title>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-1.5 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <XIcon className="size-4 text-[var(--tropx-shadow)]" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          {/* Empty content placeholder */}
          <div className="min-h-[200px] flex items-center justify-center text-[var(--tropx-shadow)] text-sm">
            Content coming soon...
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
