import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClientMetadata, ClientAction } from '../../lib/tropx-ws-client/types/messages';
import './ClientRegistry.css';

interface ClientRegistryProps {
  clients: ClientMetadata[];
  onActionTrigger: (clientId: string, actionId: string) => void;
}

// Use CSS variables for colors (single source of truth in globals.css)
const CLIENT_TYPE_COLORS: Record<string, string> = {
  main: 'var(--island-main)',
  recording: 'var(--island-recording)',
  monitor: 'var(--island-monitor)',
  custom: 'var(--island-custom)',
};

const CLIENT_TYPE_ICONS: Record<string, string> = {
  main: '🖥️',
  recording: '🎥',
  monitor: '📊',
  custom: '⚙️',
};

export function ClientRegistry({ clients, onActionTrigger }: ClientRegistryProps) {
  const [pinnedClient, setPinnedClient] = useState<ClientMetadata | null>(null);
  const [launchedClient, setLaunchedClient] = useState<ClientMetadata | null>(null);

  const handlePin = (client: ClientMetadata) => {
    setPinnedClient(pinnedClient?.clientId === client.clientId ? null : client);
  };

  const handleLaunch = (client: ClientMetadata) => {
    setLaunchedClient(client);
  };

  if (clients.length === 0 && !pinnedClient) {
    return (
      <div className="client-registry-empty">
        <span className="empty-icon">👥</span>
        <span className="empty-text">No clients</span>
      </div>
    );
  }

  // Show pinned client if exists, otherwise show all clients
  const displayClient = pinnedClient || (clients.length === 1 ? clients[0] : null);

  if (displayClient) {
    return (
      <>
        <ClientCard
          client={displayClient}
          onActionTrigger={onActionTrigger}
          onPin={handlePin}
          onLaunch={handleLaunch}
          isPinned={pinnedClient?.clientId === displayClient.clientId}
          compact
        />
        <AnimatePresence>
          {launchedClient && (
            <ClientModal
              client={launchedClient}
              onClose={() => setLaunchedClient(null)}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <div className="client-registry">
      <div className="client-registry-header">
        <span className="header-icon">👥</span>
        <span className="header-text">{clients.length} clients</span>
      </div>
      <div className="client-list">
        {clients.map((client) => (
          <ClientCard
            key={client.clientId}
            client={client}
            onActionTrigger={onActionTrigger}
            onPin={handlePin}
            onLaunch={handleLaunch}
            isPinned={pinnedClient?.clientId === client.clientId}
          />
        ))}
      </div>
    </div>
  );
}

interface ClientCardProps {
  client: ClientMetadata;
  onActionTrigger: (clientId: string, actionId: string) => void;
  onPin: (client: ClientMetadata) => void;
  onLaunch: (client: ClientMetadata) => void;
  isPinned?: boolean;
  compact?: boolean;
}

function ClientCard({ client, onActionTrigger, onPin, onLaunch, isPinned, compact }: ClientCardProps) {
  const color = CLIENT_TYPE_COLORS[client.type] || CLIENT_TYPE_COLORS.custom;
  const icon = CLIENT_TYPE_ICONS[client.type] || CLIENT_TYPE_ICONS.custom;
  const hasActions = client.actions && client.actions.length > 0;

  if (compact) {
    return (
      <div className="client-card-compact" onClick={() => onLaunch(client)}>
        <span className="client-icon">{icon}</span>
        <div className="client-details-compact">
          <span className="client-name-compact">{client.name}</span>
          <span className="client-type-compact" style={{ color }}>
            {client.type.toUpperCase()}
          </span>
        </div>
        <div className="status-indicator-compact" style={{ backgroundColor: color }} />
      </div>
    );
  }

  return (
    <div className="client-card" style={{ borderLeftColor: color }}>
      <div className="client-header">
        <div className="client-info">
          <span className="client-icon">{icon}</span>
          <div className="client-details">
            <span className="client-name">{client.name}</span>
            <span className="client-type" style={{ color }}>
              {client.type.toUpperCase()}
            </span>
          </div>
        </div>
        <div className="client-actions-header">
          <button
            className="pin-button"
            onClick={(e) => {
              e.stopPropagation();
              onPin(client);
            }}
            title={isPinned ? 'Unpin' : 'Pin to island'}
          >
            {isPinned ? '📌' : '📍'}
          </button>
          <button
            className="launch-button"
            onClick={(e) => {
              e.stopPropagation();
              onLaunch(client);
            }}
            title="Launch client"
          >
            🚀
          </button>
          <div className="status-indicator" style={{ backgroundColor: color }} />
        </div>
      </div>

      {hasActions && (
        <div className="client-actions">
          {client.actions!.map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              clientColor={color}
              onClick={() => onActionTrigger(client.clientId, action.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ActionButtonProps {
  action: ClientAction;
  clientColor: string;
  onClick: () => void;
}

function ActionButton({ action, clientColor, onClick }: ActionButtonProps) {
  return (
    <button
      className="action-button"
      onClick={onClick}
      style={{ borderColor: clientColor }}
      title={action.category}
    >
      {action.icon && <span className="action-icon">{action.icon}</span>}
      <span className="action-label">{action.label}</span>
    </button>
  );
}

interface ClientModalProps {
  client: ClientMetadata;
  onClose: () => void;
}

function ClientModal({ client, onClose }: ClientModalProps) {
  // For now, we'll show a placeholder. In the future, this would load the client's URL
  const clientUrl = `http://localhost:3000`; // Default Vite dev server for testClient

  return (
    <motion.div
      className="client-modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="client-modal"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', bounce: 0.3 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="client-modal-header">
          <div className="client-modal-title">
            <span className="client-modal-icon">{CLIENT_TYPE_ICONS[client.type]}</span>
            <span>{client.name}</span>
          </div>
          <button className="client-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="client-modal-content">
          <iframe
            src={clientUrl}
            className="client-modal-iframe"
            title={client.name}
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </motion.div>
    </motion.div>
  );
}
