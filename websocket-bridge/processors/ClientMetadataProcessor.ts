import { BaseMessage } from '../types/Interfaces';
import { MESSAGE_TYPES } from '../types/MessageTypes';
import { MESSAGE_DOMAINS, MessageDomain } from '../core/UnifiedMessageRouter';
import { ConnectionManager, ClientMetadata, ClientAction } from '../core/ConnectionManager';

export class ClientMetadataProcessor {
  private connectionManager: ConnectionManager | null = null;

  // Get domain identifier
  getDomain(): MessageDomain {
    return MESSAGE_DOMAINS.CLIENT_METADATA;
  }

  // Set connection manager reference
  setConnectionManager(manager: ConnectionManager): void {
    this.connectionManager = manager;
  }

  // Process client metadata messages
  async process(message: BaseMessage, clientId: string): Promise<BaseMessage | void> {
    if (!this.connectionManager) {
      return this.createErrorResponse('Connection manager not initialized');
    }

    switch (message.type) {
      case MESSAGE_TYPES.CLIENT_REGISTER:
        return this.handleClientRegister(message, clientId);

      case MESSAGE_TYPES.CLIENT_METADATA_UPDATE:
        return this.handleMetadataUpdate(message, clientId);

      case MESSAGE_TYPES.CLIENT_ACTION_REGISTER:
        return this.handleActionRegister(message, clientId);

      case MESSAGE_TYPES.CLIENT_ACTION_TRIGGER:
        return this.handleActionTrigger(message, clientId);

      default:
        return;
    }
  }

  // Handle client registration
  private handleClientRegister(message: any, clientId: string): BaseMessage {
    const { metadata } = message;

    if (!metadata || !metadata.name || !metadata.type) {
      return this.createErrorResponse('Invalid metadata: name and type required');
    }

    this.connectionManager!.registerClient(clientId, {
      name: metadata.name,
      type: metadata.type,
      capabilities: metadata.capabilities,
      actions: metadata.actions,
    });

    return {
      type: MESSAGE_TYPES.ACK,
      timestamp: Date.now(),
      message: `Client registered: ${metadata.name}`,
    } as any;
  }

  // Handle metadata update
  private handleMetadataUpdate(message: any, clientId: string): BaseMessage {
    const { metadata } = message;

    if (!metadata) {
      return this.createErrorResponse('No metadata provided');
    }

    this.connectionManager!.updateClientMetadata(clientId, metadata);

    return {
      type: MESSAGE_TYPES.ACK,
      timestamp: Date.now(),
      message: 'Metadata updated',
    } as any;
  }

  // Handle action registration
  private handleActionRegister(message: any, clientId: string): BaseMessage {
    const { action } = message;

    if (!action || !action.id || !action.label) {
      return this.createErrorResponse('Invalid action: id and label required');
    }

    this.connectionManager!.addClientAction(clientId, action);

    return {
      type: MESSAGE_TYPES.ACK,
      timestamp: Date.now(),
      message: `Action registered: ${action.label}`,
    } as any;
  }

  // Handle action trigger - forward to target client
  private async handleActionTrigger(message: any, clientId: string): Promise<BaseMessage> {
    const { clientId: targetClientId, actionId, params } = message;

    if (!targetClientId || !actionId) {
      return this.createErrorResponse('Target clientId and actionId required');
    }

    // Verify target client exists and has the action
    const targetMetadata = this.connectionManager!.getClientMetadata(targetClientId);
    if (!targetMetadata) {
      return this.createErrorResponse(`Target client not found: ${targetClientId}`);
    }

    const action = targetMetadata.actions?.find(a => a.id === actionId);
    if (!action) {
      return this.createErrorResponse(`Action not found: ${actionId}`);
    }

    // Forward action trigger to target client
    const triggerMessage: BaseMessage = {
      type: MESSAGE_TYPES.CLIENT_ACTION_TRIGGER,
      timestamp: Date.now(),
      clientId: targetClientId,
      actionId,
      params,
    } as any;

    const sent = await this.connectionManager!.sendToClient(targetClientId, triggerMessage);

    if (!sent) {
      return this.createErrorResponse(`Failed to send action to target client: ${targetClientId}`);
    }

    return {
      type: MESSAGE_TYPES.ACK,
      timestamp: Date.now(),
      message: `Action triggered: ${action.label}`,
    } as any;
  }

  // Create error response
  private createErrorResponse(message: string): BaseMessage {
    return {
      type: MESSAGE_TYPES.ERROR,
      timestamp: Date.now(),
      message,
    } as any;
  }

  // Get processor stats
  getStats(): { processed: number } {
    return { processed: 0 };
  }
}
