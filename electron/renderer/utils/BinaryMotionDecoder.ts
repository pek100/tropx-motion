/**
 * High-Performance Binary Motion Data Decoder
 * 
 * Decodes binary motion data packets from the optimized WebSocket service.
 * Provides 5x faster parsing compared to JSON for high-frequency motion data.
 */

export interface MotionDataPoint {
    timestamp: number;
    left: {
        current: number;
        max: number;
        min: number;
        rom: number;
    };
    right: {
        current: number;
        max: number;
        min: number;
        rom: number;
    };
}

export class BinaryMotionDecoder {
    /**
     * Decodes binary motion data buffer into structured motion points
     */
    static decode(buffer: ArrayBuffer): MotionDataPoint[] {
        const dataView = new DataView(buffer);
        let offset = 0;
        
        // Read header
        const messageType = dataView.getUint8(offset);
        offset += 1;
        
        if (messageType !== 0x01) {
            throw new Error(`Unknown binary message type: ${messageType}`);
        }
        
        // Read batch size
        const batchSize = dataView.getUint32(offset, true); // little endian
        offset += 4;
        
        const motionPoints: MotionDataPoint[] = [];
        
        // Read motion data points
        for (let i = 0; i < batchSize; i++) {
            // Timestamp (8 bytes)
            const timestamp = Number(dataView.getBigUint64(offset, true));
            offset += 8;
            
            // Left knee data (16 bytes)
            const leftCurrent = dataView.getFloat32(offset, true);
            const leftMax = dataView.getFloat32(offset + 4, true);
            const leftMin = dataView.getFloat32(offset + 8, true);
            const leftRom = dataView.getFloat32(offset + 12, true);
            offset += 16;
            
            // Right knee data (16 bytes)
            const rightCurrent = dataView.getFloat32(offset, true);
            const rightMax = dataView.getFloat32(offset + 4, true);
            const rightMin = dataView.getFloat32(offset + 8, true);
            const rightRom = dataView.getFloat32(offset + 12, true);
            offset += 16;
            
            motionPoints.push({
                timestamp,
                left: {
                    current: leftCurrent,
                    max: leftMax,
                    min: leftMin,
                    rom: leftRom
                },
                right: {
                    current: rightCurrent,
                    max: rightMax,
                    min: rightMin,
                    rom: rightRom
                }
            });
        }
        
        return motionPoints;
    }

    /**
     * Validates that the buffer contains a valid binary motion message
     */
    static isValidMotionBuffer(buffer: ArrayBuffer): boolean {
        if (buffer.byteLength < 5) return false; // Minimum header size
        
        const dataView = new DataView(buffer);
        const messageType = dataView.getUint8(0);
        const batchSize = dataView.getUint32(1, true);
        
        // Check message type and expected size
        const expectedSize = 5 + (batchSize * 40); // Header + (samples * 40 bytes each)
        
        return messageType === 0x01 && buffer.byteLength === expectedSize && batchSize > 0 && batchSize <= 100;
    }

    /**
     * Performance benchmark for binary vs JSON decoding
     */
    static benchmark(iterations: number = 1000): { binary: number; json: number; speedup: number } {
        // Create test data
        const testData: MotionDataPoint[] = Array.from({ length: 10 }, (_, i) => ({
            timestamp: Date.now() + i,
            left: { current: i * 1.5, max: i * 2, min: i * 0.5, rom: i * 1.5 },
            right: { current: i * 1.2, max: i * 1.8, min: i * 0.3, rom: i * 1.5 }
        }));

        // Create binary buffer (simulate server encoding)
        const binaryBuffer = this.createTestBinaryBuffer(testData);
        
        // Create JSON string
        const jsonString = JSON.stringify({ batch: testData });

        // Benchmark binary decoding
        const binaryStart = performance.now();
        for (let i = 0; i < iterations; i++) {
            this.decode(binaryBuffer);
        }
        const binaryTime = performance.now() - binaryStart;

        // Benchmark JSON parsing
        const jsonStart = performance.now();
        for (let i = 0; i < iterations; i++) {
            JSON.parse(jsonString);
        }
        const jsonTime = performance.now() - jsonStart;

        return {
            binary: binaryTime,
            json: jsonTime,
            speedup: jsonTime / binaryTime
        };
    }

    /**
     * Creates a test binary buffer (for benchmarking)
     */
    private static createTestBinaryBuffer(data: MotionDataPoint[]): ArrayBuffer {
        const bufferSize = 5 + (data.length * 40);
        const buffer = new ArrayBuffer(bufferSize);
        const dataView = new DataView(buffer);
        
        let offset = 0;
        
        // Header
        dataView.setUint8(offset, 0x01);
        offset += 1;
        
        dataView.setUint32(offset, data.length, true);
        offset += 4;
        
        // Data points
        for (const point of data) {
            dataView.setBigUint64(offset, BigInt(point.timestamp), true);
            offset += 8;
            
            dataView.setFloat32(offset, point.left.current, true);
            dataView.setFloat32(offset + 4, point.left.max, true);
            dataView.setFloat32(offset + 8, point.left.min, true);
            dataView.setFloat32(offset + 12, point.left.rom, true);
            offset += 16;
            
            dataView.setFloat32(offset, point.right.current, true);
            dataView.setFloat32(offset + 4, point.right.max, true);
            dataView.setFloat32(offset + 8, point.right.min, true);
            dataView.setFloat32(offset + 12, point.right.rom, true);
            offset += 16;
        }
        
        return buffer;
    }
}

/**
 * High-performance WebSocket hook for motion data streaming
 */
export class OptimizedMotionWebSocket {
    private ws: WebSocket | null = null;
    private onMotionData: ((data: MotionDataPoint[]) => void) | null = null;
    private onStatusUpdate: ((status: any) => void) | null = null;
    private binaryMode = true;
    
    constructor(
        private url: string,
        options: {
            onMotionData?: (data: MotionDataPoint[]) => void;
            onStatusUpdate?: (status: any) => void;
            binaryMode?: boolean;
        } = {}
    ) {
        this.onMotionData = options.onMotionData || null;
        this.onStatusUpdate = options.onStatusUpdate || null;
        this.binaryMode = options.binaryMode ?? true;
    }

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);
                
                this.ws.onopen = () => {
                    console.log('🔌 Optimized WebSocket connected');
                    
                    // Set binary mode preference
                    this.send({
                        type: 'set_binary_mode',
                        data: { enabled: this.binaryMode }
                    });
                    
                    // Request initial status
                    this.send({ type: 'request_status' });
                    
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    if (event.data instanceof ArrayBuffer) {
                        // Binary motion data
                        if (BinaryMotionDecoder.isValidMotionBuffer(event.data)) {
                            try {
                                const motionPoints = BinaryMotionDecoder.decode(event.data);
                                this.onMotionData?.(motionPoints);
                            } catch (error) {
                                console.error('❌ Failed to decode binary motion data:', error);
                            }
                        }
                    } else {
                        // JSON message (status updates, etc.)
                        try {
                            const message = JSON.parse(event.data);
                            if (message.type === 'status_update') {
                                this.onStatusUpdate?.(message.data);
                            } else if (message.type === 'motion_data_batch') {
                                // Fallback JSON motion data
                                this.onMotionData?.(message.data.batch);
                            }
                        } catch (error) {
                            console.error('❌ Failed to parse JSON message:', error);
                        }
                    }
                };

                this.ws.onclose = () => {
                    console.log('🔌 Optimized WebSocket disconnected');
                };

                this.ws.onerror = (error) => {
                    console.error('❌ Optimized WebSocket error:', error);
                    reject(error);
                };
                
            } catch (error) {
                reject(error);
            }
        });
    }

    send(message: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    close(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    setBinaryMode(enabled: boolean): void {
        this.binaryMode = enabled;
        this.send({
            type: 'set_binary_mode',
            data: { enabled }
        });
    }

    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}