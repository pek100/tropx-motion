/**
 * OptimizedWebSocketService.ts
 * 
 * Ultra-low latency WebSocket service using binary protocol
 * Eliminates JSON bottlenecks for real-time motion data streaming
 */

import { WebSocket, WebSocketServer, RawData } from 'ws';
// Import from shared utils to avoid main/renderer path issues
import { OptimizedBinaryProtocol, MESSAGE_TYPES } from '../utils/OptimizedBinaryProtocol';

interface BinaryWSMessage {
    type: number;
    buffer: ArrayBuffer;
}

class OptimizedWebSocketService {
    private wsServer: WebSocketServer | null = null;
    private clients = new Set<WebSocket>();
    private isInitialized = false;
    private WS_PORT = 8080;

    // Performance monitoring
    private messageCount = 0;
    private lastPerformanceLog = 0;
    private totalLatency = 0;

    constructor() {}

    async initialize(): Promise<void> {
        try {
            console.log('🚀 Initializing Optimized WebSocket Service...');

            await this.initializeWebSocketServer();
            this.startPerformanceMonitoring();

            this.isInitialized = true;
            console.log('✅ Optimized WebSocket Service initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize OptimizedWebSocketService:', error);
            throw error;
        }
    }

    private async initializeWebSocketServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.wsServer = new WebSocketServer({
                    port: this.WS_PORT,
                    perMessageDeflate: false, // Disable compression for lowest latency
                });

                this.wsServer.on('listening', () => {
                    console.log(`🌐 Optimized WebSocket server listening on port ${this.WS_PORT}`);
                    resolve();
                });

                this.wsServer.on('connection', (ws) => {
                    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    console.log(`🔌 Optimized client connected: ${clientId}`);

                    this.clients.add(ws);

                    // Send initial status using binary protocol
                    this.sendBinaryStatus(ws);

                    ws.on('message', (data) => {
                        this.handleBinaryMessage(ws, data, clientId);
                    });

                    ws.on('close', () => {
                        console.log(`🔌 Optimized client disconnected: ${clientId}`);
                        this.clients.delete(ws);
                    });

                    ws.on('error', (error) => {
                        console.error(`❌ Optimized WebSocket client error (${clientId}):`, error);
                        this.clients.delete(ws);
                    });
                });

                this.wsServer.on('error', (error) => {
                    console.error('❌ Optimized WebSocket server error:', error);
                    reject(error);
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Broadcasts motion data using binary protocol - CRITICAL PATH
     * This must be as fast as possible
     */
    broadcastMotionDataBinary(deviceName: string, quaternion: { w: number; x: number; y: number; z: number }): void {
        if (this.clients.size === 0) return;

        const startTime = performance.now();

        // Serialize to binary (24 bytes vs ~150+ bytes for JSON)
        const buffer = OptimizedBinaryProtocol.serializeMotionData(deviceName, quaternion);

        // Send binary data directly - no JSON.stringify bottleneck
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(buffer); // Direct binary send - fastest possible
                } catch (error) {
                    console.error('❌ Failed to send binary data to client, removing:', error);
                    this.clients.delete(client);
                }
            } else {
                this.clients.delete(client);
            }
        });

        // Performance tracking
        const latency = performance.now() - startTime;
        this.totalLatency += latency;
        this.messageCount++;

        // Log performance every 1000 messages
        if (this.messageCount % 1000 === 0) {
            const avgLatency = this.totalLatency / this.messageCount;
            console.log(`📊 Binary Protocol Performance: ${this.messageCount} messages, avg ${avgLatency.toFixed(3)}ms latency`);
        }
    }

    /**
     * Broadcasts device status using binary protocol
     */
    broadcastDeviceStatusBinary(devices: Array<{ name: string; connected: boolean; batteryLevel: number }>): void {
        if (this.clients.size === 0) return;

        const buffer = OptimizedBinaryProtocol.serializeDeviceStatus(devices);

        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(buffer);
                } catch (error) {
                    console.error('❌ Failed to send device status to client:', error);
                    this.clients.delete(client);
                }
            } else {
                this.clients.delete(client);
            }
        });
    }

    /**
     * NEW: Broadcasts JSON messages for device discovery and other non-motion data
     * This maintains compatibility with the existing device discovery system
     */
    broadcastJsonMessage(message: any): void {
        if (this.clients.size === 0) return;

        try {
            const jsonString = JSON.stringify(message);

            this.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    try {
                        client.send(jsonString);
                    } catch (error) {
                        console.error('❌ Failed to send JSON message to client:', error);
                        this.clients.delete(client);
                    }
                } else {
                    this.clients.delete(client);
                }
            });

            console.log(`📡 Broadcasted JSON message: ${message.type} to ${this.clients.size} clients`);
        } catch (error) {
            console.error('❌ Failed to broadcast JSON message:', error);
        }
    }

    private handleBinaryMessage(ws: WebSocket, data: RawData, clientId: string): void {
        try {
            // Convert RawData to a proper ArrayBuffer (not ArrayBufferLike)
            let buffer: ArrayBuffer;

            if (data instanceof Buffer) {
                // Always create a new ArrayBuffer to avoid SharedArrayBuffer issues
                buffer = new ArrayBuffer(data.length);
                new Uint8Array(buffer).set(data);
            } else if (data instanceof ArrayBuffer) {
                buffer = data;
            } else if (Array.isArray(data)) {
                // Handle Buffer array case
                const combinedBuffer = Buffer.concat(data);
                buffer = new ArrayBuffer(combinedBuffer.length);
                new Uint8Array(buffer).set(combinedBuffer);
            } else {
                console.warn('Unsupported data type received:', typeof data);
                return;
            }

            const messageType = OptimizedBinaryProtocol.getMessageType(buffer);

            switch (messageType) {
                case MESSAGE_TYPES.MOTION_DATA:
                    // Handle binary motion data if needed
                    break;

                case MESSAGE_TYPES.DEVICE_STATUS:
                    // Handle binary device status if needed
                    break;

                default:
                    console.warn(`Unknown binary message type: ${messageType}`);
            }
        } catch (error) {
            // Fallback to JSON for non-binary messages
            try {
                const messageText = data instanceof Buffer ? data.toString() :
                                  Array.isArray(data) ? Buffer.concat(data).toString() :
                                  String(data);
                const parsed = JSON.parse(messageText);
                this.handleFallbackJsonMessage(ws, parsed, clientId);
            } catch (jsonError) {
                console.error(`❌ Error handling message:`, error, jsonError);
            }
        }
    }

    private handleFallbackJsonMessage(ws: WebSocket, message: any, clientId: string): void {
        switch (message.type) {
            case 'ping':
                // Send binary pong for even ping responses
                ws.send(Buffer.from([MESSAGE_TYPES.HEARTBEAT]));
                break;

            case 'request_status':
                this.sendBinaryStatus(ws);
                break;

            default:
                console.warn(`Unknown JSON message type: ${message.type}`);
        }
    }

    private sendBinaryStatus(ws: WebSocket): void {
        // For now, send a simple status buffer
        // In production, this would contain actual device status
        const statusBuffer = Buffer.from([MESSAGE_TYPES.DEVICE_STATUS]);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(statusBuffer);
        }
    }

    private startPerformanceMonitoring(): void {
        // Log performance statistics every 10 seconds
        setInterval(() => {
            const now = Date.now();
            if (now - this.lastPerformanceLog > 10000) {
                const avgLatency = this.messageCount > 0 ? this.totalLatency / this.messageCount : 0;
                console.log(`📈 Binary WebSocket Performance: ${this.clients.size} clients, ${this.messageCount} messages, ${avgLatency.toFixed(3)}ms avg latency`);
                
                // Reset counters
                this.messageCount = 0;
                this.totalLatency = 0;
                this.lastPerformanceLog = now;
            }
        }, 10000);
    }

    getWebSocketPort(): number {
        return this.WS_PORT;
    }

    getClientCount(): number {
        return this.clients.size;
    }

    cleanup(): void {
        console.log('🧹 Cleaning up OptimizedWebSocketService...');
        
        this.clients.forEach(client => {
            client.close();
        });
        this.clients.clear();

        if (this.wsServer) {
            this.wsServer.close();
        }

        console.log('✅ OptimizedWebSocketService cleanup complete');
    }
}

export { OptimizedWebSocketService };