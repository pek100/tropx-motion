// electron/main/utils/DataBatcher.ts
import { MotionDataUpdate } from '../types/websocket';

export class DataBatcher {
    private batch: MotionDataUpdate[] = [];
    private batchTimeout: NodeJS.Timeout | null = null;
    private frameCounter = 0;

    constructor(
        private onFlush: (data: MotionDataUpdate | MotionDataUpdate[]) => void,
        private batchSize: number = 10,
        private maxDelayMs: number = 16 // ~60fps
    ) {}

    addData(data: MotionDataUpdate): void {
        // Add frame ID for tracking
        data.frameId = ++this.frameCounter;
        this.batch.push(data);

        if (this.batch.length >= this.batchSize) {
            this.flushBatch();
        } else if (!this.batchTimeout) {
            this.batchTimeout = setTimeout(() => this.flushBatch(), this.maxDelayMs);
        }
    }

    private flushBatch(): void {
        if (this.batch.length > 0) {
            if (this.batch.length === 1) {
                // Send single data point
                this.onFlush(this.batch[0]);
            } else {
                // Send batch
                this.onFlush([...this.batch]);
            }
            this.batch = [];
        }

        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }
    }

    cleanup(): void {
        if (this.batchTimeout) {
            clearTimeout(this.batchTimeout);
            this.batchTimeout = null;
        }
        this.batch = [];
    }
}

// electron/main/utils/environment.ts
export const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

export const getAppPath = () => {
    return isDev ? process.cwd() : process.resourcesPath;
};

// electron/main/utils/PerformanceMonitor.ts
export class PerformanceMonitor {
    private metrics = new Map<string, number[]>();
    private readonly maxSamples = 100;

    startTiming(label: string): () => void {
        const start = performance.now();
        return () => {
            const duration = performance.now() - start;
            this.addMetric(label, duration);
        };
    }

    addMetric(label: string, value: number): void {
        if (!this.metrics.has(label)) {
            this.metrics.set(label, []);
        }

        const samples = this.metrics.get(label)!;
        samples.push(value);

        // Keep only recent samples
        if (samples.length > this.maxSamples) {
            samples.splice(0, samples.length - this.maxSamples);
        }
    }

    getMetrics(label: string): { avg: number; min: number; max: number; count: number } | null {
        const samples = this.metrics.get(label);
        if (!samples || samples.length === 0) return null;

        const avg = samples.reduce((sum, val) => sum + val, 0) / samples.length;
        const min = Math.min(...samples);
        const max = Math.max(...samples);

        return { avg, min, max, count: samples.length };
    }

    getAllMetrics(): Record<string, ReturnType<PerformanceMonitor['getMetrics']>> {
        const result: Record<string, any> = {};
        this.metrics.forEach((_, label) => {
            result[label] = this.getMetrics(label);
        });
        return result;
    }

    reset(label?: string): void {
        if (label) {
            this.metrics.delete(label);
        } else {
            this.metrics.clear();
        }
    }
}

// electron/main/utils/ConnectionManager.ts
import { WebSocket } from 'ws';

export interface ClientInfo {
    id: string;
    ws: WebSocket;
    connectedAt: Date;
    lastPing?: Date;
    isAlive: boolean;
    metadata?: Record<string, any>;
}

export class ConnectionManager {
    private clients = new Map<string, ClientInfo>();
    private pingInterval: NodeJS.Timeout | null = null;
    private readonly PING_INTERVAL = 30000; // 30 seconds

    constructor() {
        this.startPingInterval();
    }

    addClient(ws: WebSocket, metadata?: Record<string, any>): string {
        const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const clientInfo: ClientInfo = {
            id: clientId,
            ws,
            connectedAt: new Date(),
            isAlive: true,
            metadata
        };

        this.clients.set(clientId, clientInfo);

        // Setup WebSocket event handlers
        ws.on('pong', () => {
            const client = this.clients.get(clientId);
            if (client) {
                client.isAlive = true;
                client.lastPing = new Date();
            }
        });

        ws.on('close', () => {
            this.removeClient(clientId);
        });

        console.log(`👤 Client connected: ${clientId} (${this.clients.size} total)`);
        return clientId;
    }

    removeClient(clientId: string): void {
        const client = this.clients.get(clientId);
        if (client) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.close();
            }
            this.clients.delete(clientId);
            console.log(`👤 Client disconnected: ${clientId} (${this.clients.size} remaining)`);
        }
    }

    getClient(clientId: string): ClientInfo | undefined {
        return this.clients.get(clientId);
    }

    getAllClients(): ClientInfo[] {
        return Array.from(this.clients.values());
    }

    getActiveClients(): ClientInfo[] {
        return this.getAllClients().filter(client => 
            client.isAlive && client.ws.readyState === WebSocket.OPEN
        );
    }

    broadcastToAll(message: string | Buffer): void {
        this.getActiveClients().forEach(client => {
            try {
                client.ws.send(message);
            } catch (error) {
                console.error(`❌ Failed to send to client ${client.id}:`, error);
                this.removeClient(client.id);
            }
        });
    }

    sendToClient(clientId: string, message: string | Buffer): boolean {
        const client = this.getClient(clientId);
        if (client && client.ws.readyState === WebSocket.OPEN) {
            try {
                client.ws.send(message);
                return true;
            } catch (error) {
                console.error(`❌ Failed to send to client ${clientId}:`, error);
                this.removeClient(clientId);
                return false;
            }
        }
        return false;
    }

    private startPingInterval(): void {
        this.pingInterval = setInterval(() => {
            this.clients.forEach((client, clientId) => {
                if (!client.isAlive) {
                    console.log(`💔 Removing dead client: ${clientId}`);
                    this.removeClient(clientId);
                    return;
                }

                if (client.ws.readyState === WebSocket.OPEN) {
                    client.isAlive = false;
                    client.ws.ping();
                } else {
                    this.removeClient(clientId);
                }
            });
        }, this.PING_INTERVAL);
    }

    getConnectionStats(): {
        totalClients: number;
        activeClients: number;
        deadClients: number;
        averageConnectionTime: number;
    } {
        const all = this.getAllClients();
        const active = this.getActiveClients();
        const now = new Date();

        const averageConnectionTime = all.length > 0 
            ? all.reduce((sum, client) => 
                sum + (now.getTime() - client.connectedAt.getTime()), 0
              ) / all.length
            : 0;

        return {
            totalClients: all.length,
            activeClients: active.length,
            deadClients: all.length - active.length,
            averageConnectionTime
        };
    }

    cleanup(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        this.clients.forEach((client, clientId) => {
            this.removeClient(clientId);
        });

        this.clients.clear();
        console.log('🧹 ConnectionManager cleanup complete');
    }
}