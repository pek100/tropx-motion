import { MotionDataUpdate } from '../types/websocket';

export class DataBatcher {
    private frameCounter = 0;

    constructor(
        private onFlush: (data: MotionDataUpdate | MotionDataUpdate[]) => void,
        private batchSize: number = 1,  // Real-time: process immediately
        private maxDelayMs: number = 0   // No delays for real-time streaming
    ) {}

    addData(data: MotionDataUpdate): void {
        data.frameId = ++this.frameCounter;

        // Real-time streaming: send immediately without batching delays
        this.onFlush(data);
    }

    cleanup(): void {
    }
}