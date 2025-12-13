/**
 * Web/Fallback Recording Buffer
 *
 * This renderer-side buffer stores pre-computed angle values for web exports.
 * It serves as a fallback when the backend quaternion buffer is unavailable.
 *
 * For Electron builds, the backend RecordingBuffer (motionProcessing/recording/)
 * stores raw quaternions and supports SLERP interpolation for uniform sample rates.
 * The useRecordingExport hook automatically uses the backend when available.
 *
 * This buffer stores angles directly (no interpolation support).
 */

const MAX_BUFFER_SIZE = 60000; // 10 min at 100Hz
const STORAGE_PREFIX = 'tropx_recording_chunk_';

interface RecordingSample {
  t: number;  // timestamp (ms)
  l: number;  // left knee angle
  r: number;  // right knee angle
}

interface RecordingMetadata {
  startTime: number;
  endTime: number;
  sampleCount: number;
}

class RecordingBufferClass {
  private buffer: RecordingSample[] = [];
  private overflowChunks: string[] = [];
  private startTime: number | null = null;
  private isRecording = false;

  start(): void {
    // Clear previous recording data when starting a new one
    this.clearStorage();
    this.buffer = [];
    this.overflowChunks = [];
    this.startTime = Date.now();
    this.isRecording = true;
  }

  stop(): void {
    this.isRecording = false;
  }

  push(timestamp: number, leftKnee: number, rightKnee: number): void {
    if (!this.isRecording) return;

    this.buffer.push({
      t: timestamp,
      l: Math.round(leftKnee * 10) / 10,
      r: Math.round(rightKnee * 10) / 10
    });

    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.flushToStorage();
    }
  }

  private flushToStorage(): void {
    if (this.buffer.length === 0) return;

    const chunkKey = `${STORAGE_PREFIX}${Date.now()}`;
    try {
      localStorage.setItem(chunkKey, JSON.stringify(this.buffer));
      this.overflowChunks.push(chunkKey);
      this.buffer = [];
    } catch (e) {
      console.error('Failed to flush recording to storage:', e);
    }
  }

  getAllSamples(): RecordingSample[] {
    const allSamples: RecordingSample[] = [];

    // Load overflow chunks
    for (const key of this.overflowChunks) {
      try {
        const data = localStorage.getItem(key);
        if (data) {
          allSamples.push(...JSON.parse(data));
        }
      } catch (e) {
        console.error('Failed to load chunk:', key, e);
      }
    }

    // Add current buffer
    allSamples.push(...this.buffer);

    return allSamples;
  }

  getMetadata(): RecordingMetadata | null {
    const samples = this.getAllSamples();
    if (samples.length === 0 || !this.startTime) return null;

    return {
      startTime: this.startTime,
      endTime: samples[samples.length - 1]?.t || Date.now(),
      sampleCount: samples.length
    };
  }

  private clearStorage(): void {
    for (const key of this.overflowChunks) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.error('Failed to remove chunk:', key, e);
      }
    }
  }

  clear(): void {
    this.clearStorage();
    this.buffer = [];
    this.overflowChunks = [];
    this.startTime = null;
    this.isRecording = false;
  }

  isEmpty(): boolean {
    return this.buffer.length === 0 && this.overflowChunks.length === 0;
  }

  getSampleCount(): number {
    return this.buffer.length + this.overflowChunks.length * MAX_BUFFER_SIZE;
  }
}

// Singleton instance
export const RecordingBuffer = new RecordingBufferClass();
