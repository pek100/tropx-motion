import { MotionDataUpdate } from '../types/websocket';

export class DataBatcher {
    private batch: MotionDataUpdate[] = [];
    private batchTimeout: NodeJS.Timeout | null = null;
    private frameCounter = 0;

    constructor(
        private onFlush: (data: MotionDataUpdate | MotionDataUpdate[]) => void,
        private batchSize: number = 10,
        private maxDelayMs: number = 16
    ) {}

    addData(data: MotionDataUpdate): void {
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
                this.onFlush(this.batch[0]);
            } else {
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