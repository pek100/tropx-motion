import { SynchronizedJointPair } from '../MotionProcessingCoordinator';

/**
 * Broadcasts synchronized joint data to WebSocket clients.
 *
 * Receives synchronized pairs from BatchSynchronizer via MotionProcessingCoordinator.
 * Broadcasts quaternions directly - frontend handles Euler angle conversion.
 */
export class UIProcessor {
    private static instance: UIProcessor | null = null;
    private webSocketBroadcast: ((message: any, clientIds: string[]) => Promise<void>) | null = null;

    /** Debug counter */
    private static debugBroadcastCount = 0;

    private constructor() {}

    static getInstance(): UIProcessor {
        if (!UIProcessor.instance) {
            UIProcessor.instance = new UIProcessor();
        }
        return UIProcessor.instance;
    }

    static reset(): void {
        if (UIProcessor.instance) {
            UIProcessor.instance.cleanup();
            UIProcessor.instance = null;
        }
    }

    /** Reset state for new recording session. */
    static resetForNewRecording(): void {
        UIProcessor.debugBroadcastCount = 0;
        console.log('🔄 [UI_PROCESSOR] Reset for new recording');
    }

    setWebSocketBroadcast(broadcastFn: (message: any, clientIds: string[]) => Promise<void>): void {
        this.webSocketBroadcast = broadcastFn;
        console.log('📡 UIProcessor: WebSocket broadcast function configured');
    }

    /** Get debug stats for pipeline analysis */
    static getDebugStats(): { broadcastCount: number } {
        return {
            broadcastCount: UIProcessor.debugBroadcastCount
        };
    }

    /**
     * Broadcast synchronized joint pair via WebSocket.
     * Sends quaternions directly - frontend converts to Euler angles for display.
     */
    broadcastCompletePair(pair: SynchronizedJointPair): void {
        if (!this.webSocketBroadcast) {
            return;
        }

        UIProcessor.debugBroadcastCount++;

        // Debug logging at intervals
        if (UIProcessor.debugBroadcastCount === 50 || UIProcessor.debugBroadcastCount === 200) {
            console.log(`📊 [UI_PROC_DEBUG] broadcasts=${UIProcessor.debugBroadcastCount}`);
        }

        try {
            // Send only quaternions - frontend decodes to any axis
            // Format: [lqW, lqX, lqY, lqZ, rqW, rqX, rqY, rqZ]
            const lq = pair.leftKnee.relativeQuat;
            const rq = pair.rightKnee.relativeQuat;
            const data = new Float32Array([
                lq.w, lq.x, lq.y, lq.z,
                rq.w, rq.x, rq.y, rq.z
            ]);

            const message = {
                type: 0x30, // MESSAGE_TYPES.MOTION_DATA
                requestId: 0,
                timestamp: pair.timestamp,
                deviceName: [...pair.leftKnee.deviceIds, ...pair.rightKnee.deviceIds].join(','),
                data: data
            };

            this.webSocketBroadcast(message, []).catch(error => {
                console.error('❌ [UI_PROCESSOR] Error broadcasting:', error);
            });

        } catch (error) {
            console.error('❌ [UI_PROCESSOR] Error creating WebSocket message:', error);
        }
    }

    cleanup(): void {
        // No state to clean up - WebSocket broadcast is managed externally
    }
}
