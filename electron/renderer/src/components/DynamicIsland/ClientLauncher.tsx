import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import './ClientLauncher.css';

// Debug trace logging
const DEBUG_TRACE = true;
const trace = (component: string, msg: string, data?: any) => {
  if (!DEBUG_TRACE) return;
  if (data !== undefined) {
    console.log(`[TRACE:${component}] ${msg}`, data);
  } else {
    console.log(`[TRACE:${component}] ${msg}`);
  }
};

export type ClientDisplayMode = 'modal' | 'snapped-left' | 'snapped-right' | 'minimized' | 'closed';

interface ClientLauncherProps {
  isLaunched: boolean;
  displayMode: ClientDisplayMode;
  onLaunch: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onSnapLeft: () => void;
  onSnapRight: () => void;
  onBackToModal: () => void;
  isStreaming?: boolean;
  onToggleStreaming?: () => void;
  isValidatingState?: boolean;
  isStoppingStreaming?: boolean;
}

export function ClientLauncher({
  isLaunched,
  displayMode,
  onLaunch,
  onClose,
  onMinimize,
  onSnapLeft,
  onSnapRight,
  onBackToModal,
  isStreaming = false,
  onToggleStreaming,
  isValidatingState = false,
  isStoppingStreaming = false,
}: ClientLauncherProps) {
  // Modal is open when in modal mode
  const isModalOpen = displayMode === 'modal';

  // Dynamic port discovery for test client
  const [clientUrl, setClientUrl] = useState<string | null>(null);
  const [portError, setPortError] = useState<string | null>(null);

  // Monitor client launcher state changes
  useEffect(() => {
    trace('CLIENT_LAUNCHER', `State changed: isLaunched=${isLaunched}, displayMode=${displayMode}, isModalOpen=${isModalOpen}`);
  }, [isLaunched, displayMode, isModalOpen]);

  // Monitor modal open/close specifically
  useEffect(() => {
    if (isModalOpen) {
      trace('CLIENT_LAUNCHER', 'Modal OPENED');
    } else if (isLaunched) {
      trace('CLIENT_LAUNCHER', `Modal CLOSED (now in ${displayMode} mode)`);
    }
  }, [isModalOpen, isLaunched, displayMode]);

  // Discover test client port when modal opens
  useEffect(() => {
    if (isModalOpen && !clientUrl) {
      trace('CLIENT_LAUNCHER', 'Discovering test client port...');
      window.electronAPI.testClient.discoverPort().then(result => {
        if (result.success && result.url) {
          trace('CLIENT_LAUNCHER', `Test client discovered at ${result.url}`);
          setClientUrl(result.url);
          setPortError(null);
        } else {
          trace('CLIENT_LAUNCHER', `Port discovery failed: ${result.error}`);
          setPortError(result.error || 'Dev server not running');
        }
      }).catch(err => {
        trace('CLIENT_LAUNCHER', `Port discovery error: ${err.message}`);
        setPortError('Failed to discover port');
      });
    }
  }, [isModalOpen, clientUrl]);

  return (
    <>
      {/* Modal with iframe and controls */}
      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          trace('CLIENT_LAUNCHER', `Dialog onOpenChange: open=${open}`);
          if (!open) {
            trace('CLIENT_LAUNCHER', 'Dialog closing, calling onMinimize()');
            onMinimize();
          }
        }}
      >
        <DialogContent className="client-launcher-modal" showCloseButton={false}>
          <div className="client-launcher-content">
            {portError ? (
              <div className="client-launcher-error">
                <p>Could not connect to test client dev server</p>
                <p className="error-details">{portError}</p>
                <p className="error-hint">Make sure the dev server is running on ports 3000-3010</p>
              </div>
            ) : clientUrl ? (
              <iframe
                src={clientUrl}
                className="client-launcher-iframe"
                title="Test Client"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            ) : (
              <div className="client-launcher-loading">
                <p>Discovering test client...</p>
              </div>
            )}

            {/* Modal Dynamic Island - floating controls at bottom */}
            <ClientModalIsland
              onClose={onClose}
              onSnapLeft={onSnapLeft}
              onSnapRight={onSnapRight}
              isStreaming={isStreaming}
              onToggleStreaming={onToggleStreaming}
              isValidatingState={isValidatingState}
              isStoppingStreaming={isStoppingStreaming}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ClientModalIslandProps {
  onClose: () => void;
  onSnapLeft: () => void;
  onSnapRight: () => void;
  isStreaming?: boolean;
  onToggleStreaming?: () => void;
  isValidatingState?: boolean;
  isStoppingStreaming?: boolean;
}

function ClientModalIsland({
  onClose,
  onSnapLeft,
  onSnapRight,
  isStreaming = false,
  onToggleStreaming,
  isValidatingState = false,
  isStoppingStreaming = false,
}: ClientModalIslandProps) {
  return (
    <div className="client-modal-island-container">
      <div
        className="client-modal-island"
      >
        <div className="client-modal-island-controls">
          <button
            className="modal-island-btn modal-island-btn-danger"
            onClick={onClose}
            title="Exit and close client"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Exit</span>
          </button>

          {onToggleStreaming && (
            <>
              <div className="modal-island-divider" />
              <button
                className="modal-island-btn"
                onClick={onToggleStreaming}
                disabled={isValidatingState || isStoppingStreaming}
                title={isStreaming ? "Stop streaming" : "Start streaming"}
                style={{
                  opacity: (isValidatingState || isStoppingStreaming) ? 0.5 : 1,
                  backgroundColor: isStreaming ? 'rgba(var(--streaming-stop-rgb), 0.1)' : 'rgba(var(--streaming-start-rgb), 0.1)',
                  color: isStreaming ? 'var(--streaming-stop)' : 'var(--streaming-start)',
                }}
              >
                {isValidatingState ? (
                  <svg className="animate-spin" width="14" height="14" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : isStoppingStreaming ? (
                  <svg className="animate-spin" width="14" height="14" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : isStreaming ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="3" width="4" height="10" rx="1" fill="currentColor" />
                    <rect x="9" y="3" width="4" height="10" rx="1" fill="currentColor" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 2L13 8L4 14V2Z" fill="currentColor" />
                  </svg>
                )}
                <span>{isValidatingState ? 'Starting...' : isStoppingStreaming ? 'Stopping...' : isStreaming ? 'Stop' : 'Start'}</span>
              </button>
            </>
          )}

          <div className="modal-island-divider" />

          <button
            className="modal-island-btn"
            onClick={onSnapLeft}
            title="Snap to left pane"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="3" width="8" height="18" stroke="currentColor" strokeWidth="2" rx="2" />
              <rect x="13" y="3" width="8" height="18" stroke="currentColor" strokeWidth="2" rx="2" opacity="0.3" />
            </svg>
            <span>Snap Left</span>
          </button>

          <button
            className="modal-island-btn"
            onClick={onSnapRight}
            title="Snap to right pane"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="3" width="8" height="18" stroke="currentColor" strokeWidth="2" rx="2" opacity="0.3" />
              <rect x="13" y="3" width="8" height="18" stroke="currentColor" strokeWidth="2" rx="2" />
            </svg>
            <span>Snap Right</span>
          </button>
        </div>
      </div>
    </div>
  );
}

interface ClientSnappedIslandProps {
  isLeft: boolean;
  onClose: () => void;
  onBackToModal: () => void;
  isStreaming?: boolean;
  onToggleStreaming?: () => void;
  isValidatingState?: boolean;
  isStoppingStreaming?: boolean;
}

export function ClientSnappedIsland({
  isLeft,
  onClose,
  onBackToModal,
  isStreaming = false,
  onToggleStreaming,
  isValidatingState = false,
  isStoppingStreaming = false,
}: ClientSnappedIslandProps) {
  return (
    <div className="client-snapped-island-container">
      <div
        className="client-snapped-island"
      >
        <div className="client-snapped-island-controls">
          <button
            className="snapped-island-btn snapped-island-btn-danger"
            onClick={onClose}
            title="Exit and close client"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Exit</span>
          </button>

          {onToggleStreaming && (
            <>
              <button
                className="snapped-island-btn"
                onClick={onToggleStreaming}
                disabled={isValidatingState || isStoppingStreaming}
                title={isStreaming ? "Stop streaming" : "Start streaming"}
                style={{
                  opacity: (isValidatingState || isStoppingStreaming) ? 0.5 : 1,
                  backgroundColor: isStreaming ? 'rgba(var(--streaming-stop-rgb), 0.1)' : 'rgba(var(--streaming-start-rgb), 0.1)',
                  color: isStreaming ? 'var(--streaming-stop)' : 'var(--streaming-start)',
                }}
              >
                {isValidatingState ? (
                  <svg className="animate-spin" width="12" height="12" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : isStoppingStreaming ? (
                  <svg className="animate-spin" width="12" height="12" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : isStreaming ? (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="3" y="3" width="4" height="10" rx="1" fill="currentColor" />
                    <rect x="9" y="3" width="4" height="10" rx="1" fill="currentColor" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 2L13 8L4 14V2Z" fill="currentColor" />
                  </svg>
                )}
                <span>{isValidatingState ? 'Starting...' : isStoppingStreaming ? 'Stopping...' : isStreaming ? 'Stop' : 'Start'}</span>
              </button>
            </>
          )}

          <button
            className="snapped-island-btn"
            onClick={onBackToModal}
            title="Back to modal"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="3" width="18" height="18" stroke="currentColor" strokeWidth="2" rx="2" />
            </svg>
            <span>Back to Modal</span>
          </button>
        </div>
      </div>
    </div>
  );
}

interface ClientIframeProps {
  className?: string;
}

export function ClientIframe({ className }: ClientIframeProps) {
  const [clientUrl, setClientUrl] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.testClient.discoverPort().then(result => {
      if (result.success && result.url) {
        setClientUrl(result.url);
      }
    });
  }, []);

  if (!clientUrl) {
    return <div className={className || 'client-iframe'}>Loading test client...</div>;
  }

  return (
    <iframe
      src={clientUrl}
      className={className || 'client-iframe'}
      title="Test Client"
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
}
