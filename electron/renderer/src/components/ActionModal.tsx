import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ActionId } from './ActionBar'

// Modal titles for each action
const MODAL_TITLES: Record<ActionId, string> = {
  'ai-analysis': 'AI Analysis',
  'patient-name': 'Patient Name',
  'recording-title': 'Recording Title',
  'description': 'Description',
  'save': 'Save Recording',
  'export': 'Export Data',
  'load': 'Load Recording',
}

interface ActionModalProps {
  actionId: ActionId | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ActionModal({ actionId, open, onOpenChange }: ActionModalProps) {
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
