import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import './ClientLauncher.css';

const CLIENT_URL = 'http://localhost:3000';

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
}: ClientLauncherProps) {
  // Modal is open when in modal mode
  const isModalOpen = displayMode === 'modal';

  return (
    <>
      {/* Launch Button - shown in main Dynamic Island */}
      {!isLaunched && (
        <button className="client-launcher-button" onClick={onLaunch} title="Launch Test Client">
          🚀
        </button>
      )}

      {/* Modal with iframe and controls */}
      <Dialog open={isModalOpen} onOpenChange={(open) => !open && onMinimize()}>
        <DialogContent className="client-launcher-modal" showCloseButton={false}>
          <div className="client-launcher-content">
            <iframe
              src={CLIENT_URL}
              className="client-launcher-iframe"
              title="Test Client"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />

            {/* Modal Dynamic Island - floating controls at bottom */}
            <ClientModalIsland
              onClose={onClose}
              onMinimize={onMinimize}
              onSnapLeft={onSnapLeft}
              onSnapRight={onSnapRight}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface ClientModalIslandProps {
  onClose: () => void;
  onMinimize: () => void;
  onSnapLeft: () => void;
  onSnapRight: () => void;
}

function ClientModalIsland({
  onClose,
  onMinimize,
  onSnapLeft,
  onSnapRight,
}: ClientModalIslandProps) {
  return (
    <div className="client-modal-island-container">
      <motion.div
        className="client-modal-island"
        layout
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.3 }}
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

          <button
            className="modal-island-btn"
            onClick={onMinimize}
            title="Minimize to background"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Minimize</span>
          </button>

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
      </motion.div>
    </div>
  );
}

interface ClientSnappedIslandProps {
  isLeft: boolean;
  onClose: () => void;
  onBackToModal: () => void;
}

export function ClientSnappedIsland({
  isLeft,
  onClose,
  onBackToModal,
}: ClientSnappedIslandProps) {
  return (
    <div className="client-snapped-island-container">
      <motion.div
        className="client-snapped-island"
        layout
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', bounce: 0.3 }}
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
      </motion.div>
    </div>
  );
}

interface ClientIframeProps {
  className?: string;
}

export function ClientIframe({ className }: ClientIframeProps) {
  return (
    <iframe
      src={CLIENT_URL}
      className={className || 'client-iframe'}
      title="Test Client"
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
}
