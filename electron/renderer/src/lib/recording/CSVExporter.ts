import { RecordingBuffer } from './RecordingBuffer';

interface ExportOptions {
  includeMetadata?: boolean;
}

export function generateCSV(options: ExportOptions = {}): string {
  const { includeMetadata = true } = options;

  try {
    // Get a snapshot copy of samples to avoid race conditions during streaming
    const samples = [...RecordingBuffer.getAllSamples()];
    const metadata = RecordingBuffer.getMetadata();

    if (samples.length === 0) {
      return '';
    }

    const lines: string[] = [];

    // Metadata header
    if (includeMetadata && metadata) {
      const duration = ((metadata.endTime - metadata.startTime) / 1000).toFixed(1);
      lines.push('# TropX Motion Recording');
      lines.push(`# Date: ${new Date(metadata.startTime).toISOString()}`);
      lines.push(`# Duration: ${duration}s`);
      lines.push(`# Samples: ${metadata.sampleCount}`);
      lines.push('#');
    }

    // CSV header
    lines.push('timestamp,relative_s,left_knee,right_knee');

    // Data rows - safely handle edge case where first sample might be undefined
    const firstSample = samples[0];
    if (!firstSample) {
      return '';
    }

    const startTime = firstSample.t ?? 0;
    for (const sample of samples) {
      if (!sample) continue;
      const relativeS = ((sample.t - startTime) / 1000).toFixed(3);
      lines.push(`${sample.t ?? 0},${relativeS},${sample.l ?? 0},${sample.r ?? 0}`);
    }

    return lines.join('\n');
  } catch (err) {
    console.error('generateCSV error:', err);
    return '';
  }
}

export function generateFilename(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `recording_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.csv`;
}

export function getDefaultExportPath(): string {
  const saved = localStorage.getItem('tropx_export_path');
  if (saved) return saved;

  // Default: ~/Documents/TropX/recordings/
  // This will be resolved by main process
  return '~/Documents/TropX/recordings/';
}

export function setDefaultExportPath(path: string): void {
  localStorage.setItem('tropx_export_path', path);
}

export function resetExportPath(): void {
  localStorage.removeItem('tropx_export_path');
}

// ============ CSV Import/Parser ============

export interface ImportedSample {
  t: number;        // timestamp (ms)
  relative: number; // relative seconds
  l: number;        // left knee angle
  r: number;        // right knee angle
}

export interface ImportedRecording {
  samples: ImportedSample[];
  metadata: {
    date?: string;
    duration?: string;
    sampleCount: number;
    fileName: string;
  };
}

export function parseCSV(content: string, fileName: string): ImportedRecording {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const samples: ImportedSample[] = [];
  const metadata: ImportedRecording['metadata'] = {
    sampleCount: 0,
    fileName
  };

  let headerParsed = false;
  let columnMap: { timestamp: number; relative: number; left: number; right: number } | null = null;

  for (const line of lines) {
    // Parse metadata comments
    if (line.startsWith('#')) {
      const match = line.match(/^#\s*(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        if (key.toLowerCase() === 'date') metadata.date = value;
        if (key.toLowerCase() === 'duration') metadata.duration = value;
      }
      continue;
    }

    // Parse header row
    if (!headerParsed) {
      const cols = line.toLowerCase().split(',').map(c => c.trim());
      columnMap = {
        timestamp: cols.findIndex(c => c === 'timestamp'),
        relative: cols.findIndex(c => c === 'relative_s' || c === 'relative'),
        left: cols.findIndex(c => c === 'left_knee' || c === 'left-knee' || c === 'left'),
        right: cols.findIndex(c => c === 'right_knee' || c === 'right-knee' || c === 'right')
      };
      headerParsed = true;
      continue;
    }

    // Parse data rows
    if (columnMap) {
      const values = line.split(',').map(v => v.trim());
      const timestamp = columnMap.timestamp >= 0 ? parseFloat(values[columnMap.timestamp]) : 0;
      const relative = columnMap.relative >= 0 ? parseFloat(values[columnMap.relative]) : 0;
      const left = columnMap.left >= 0 ? parseFloat(values[columnMap.left]) : 0;
      const right = columnMap.right >= 0 ? parseFloat(values[columnMap.right]) : 0;

      if (!isNaN(left) || !isNaN(right)) {
        samples.push({
          t: isNaN(timestamp) ? 0 : timestamp,
          relative: isNaN(relative) ? 0 : relative,
          l: isNaN(left) ? 0 : left,
          r: isNaN(right) ? 0 : right
        });
      }
    }
  }

  metadata.sampleCount = samples.length;
  return { samples, metadata };
}
