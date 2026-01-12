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

/** Quaternion type for imported data */
export interface ImportedQuaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Imported sample with optional quaternions.
 * If quaternions are present, they can be used for axis selection.
 */
export interface ImportedSample {
  t: number;              // timestamp (ms)
  relative: number;       // relative seconds
  l: number;              // left knee angle (Y-axis by default)
  r: number;              // right knee angle (Y-axis by default)
  // Optional quaternions (present if CSV was exported with quaternion format)
  lq?: ImportedQuaternion;
  rq?: ImportedQuaternion;
}

export interface ImportedRecording {
  samples: ImportedSample[];
  metadata: {
    date?: string;
    duration?: string;
    sampleRate?: number;
    sampleCount: number;
    fileName: string;
    hasQuaternions: boolean;  // Indicates if quaternion data is available
  };
}

/**
 * Parse CSV content into ImportedRecording.
 * Supports both legacy format (angles only) and new format (quaternions + angles).
 */
export function parseCSV(content: string, fileName: string): ImportedRecording {
  const lines = content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const samples: ImportedSample[] = [];
  const metadata: ImportedRecording['metadata'] = {
    sampleCount: 0,
    fileName,
    hasQuaternions: false
  };

  let headerParsed = false;
  let columnMap: {
    timestamp: number;
    relative: number;
    // Legacy angle columns
    left: number;
    right: number;
    // New quaternion columns
    lq_w: number;
    lq_x: number;
    lq_y: number;
    lq_z: number;
    rq_w: number;
    rq_x: number;
    rq_y: number;
    rq_z: number;
    // New per-axis angle columns
    left_x: number;
    left_y: number;
    left_z: number;
    right_x: number;
    right_y: number;
    right_z: number;
  } | null = null;

  for (const line of lines) {
    // Parse metadata comments
    if (line.startsWith('#')) {
      const match = line.match(/^#\s*(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        const keyLower = key.toLowerCase();
        if (keyLower === 'date') metadata.date = value;
        if (keyLower === 'duration') metadata.duration = value;
        if (keyLower === 'samplerate') {
          const hz = parseInt(value);
          if (!isNaN(hz)) metadata.sampleRate = hz;
        }
      }
      continue;
    }

    // Parse header row
    if (!headerParsed) {
      const cols = line.toLowerCase().split(',').map(c => c.trim());
      columnMap = {
        timestamp: cols.findIndex(c => c === 'timestamp'),
        relative: cols.findIndex(c => c === 'relative_s' || c === 'relative'),
        // Legacy columns
        left: cols.findIndex(c => c === 'left_knee' || c === 'left-knee' || c === 'left'),
        right: cols.findIndex(c => c === 'right_knee' || c === 'right-knee' || c === 'right'),
        // Quaternion columns
        lq_w: cols.findIndex(c => c === 'lq_w'),
        lq_x: cols.findIndex(c => c === 'lq_x'),
        lq_y: cols.findIndex(c => c === 'lq_y'),
        lq_z: cols.findIndex(c => c === 'lq_z'),
        rq_w: cols.findIndex(c => c === 'rq_w'),
        rq_x: cols.findIndex(c => c === 'rq_x'),
        rq_y: cols.findIndex(c => c === 'rq_y'),
        rq_z: cols.findIndex(c => c === 'rq_z'),
        // Per-axis angle columns
        left_x: cols.findIndex(c => c === 'left_x'),
        left_y: cols.findIndex(c => c === 'left_y'),
        left_z: cols.findIndex(c => c === 'left_z'),
        right_x: cols.findIndex(c => c === 'right_x'),
        right_y: cols.findIndex(c => c === 'right_y'),
        right_z: cols.findIndex(c => c === 'right_z'),
      };

      // Check if quaternion columns are present
      metadata.hasQuaternions = columnMap.lq_w >= 0 && columnMap.lq_x >= 0 &&
                                 columnMap.lq_y >= 0 && columnMap.lq_z >= 0;

      headerParsed = true;
      continue;
    }

    // Parse data rows
    if (columnMap) {
      const values = line.split(',').map(v => v.trim());

      const timestamp = columnMap.timestamp >= 0 ? parseFloat(values[columnMap.timestamp]) : 0;
      const relative = columnMap.relative >= 0 ? parseFloat(values[columnMap.relative]) : 0;

      // Get angles - prefer Y-axis columns if available, else fallback to legacy
      let left: number;
      let right: number;

      if (columnMap.left_y >= 0) {
        // New format: use left_y / right_y (flexion/extension)
        left = parseFloat(values[columnMap.left_y]);
        right = parseFloat(values[columnMap.right_y]);
      } else if (columnMap.left >= 0) {
        // Legacy format
        left = parseFloat(values[columnMap.left]);
        right = parseFloat(values[columnMap.right]);
      } else {
        left = 0;
        right = 0;
      }

      // Skip invalid rows
      if (isNaN(left) && isNaN(right)) continue;

      const sample: ImportedSample = {
        t: isNaN(timestamp) ? 0 : timestamp,
        relative: isNaN(relative) ? 0 : relative,
        l: isNaN(left) ? 0 : left,
        r: isNaN(right) ? 0 : right,
      };

      // Parse quaternions if available
      if (metadata.hasQuaternions) {
        const lq_w = parseFloat(values[columnMap.lq_w]);
        const lq_x = parseFloat(values[columnMap.lq_x]);
        const lq_y = parseFloat(values[columnMap.lq_y]);
        const lq_z = parseFloat(values[columnMap.lq_z]);
        const rq_w = parseFloat(values[columnMap.rq_w]);
        const rq_x = parseFloat(values[columnMap.rq_x]);
        const rq_y = parseFloat(values[columnMap.rq_y]);
        const rq_z = parseFloat(values[columnMap.rq_z]);

        if (!isNaN(lq_w) && !isNaN(lq_x) && !isNaN(lq_y) && !isNaN(lq_z)) {
          sample.lq = { w: lq_w, x: lq_x, y: lq_y, z: lq_z };
        }
        if (!isNaN(rq_w) && !isNaN(rq_x) && !isNaN(rq_y) && !isNaN(rq_z)) {
          sample.rq = { w: rq_w, x: rq_x, y: rq_y, z: rq_z };
        }
      }

      samples.push(sample);
    }
  }

  metadata.sampleCount = samples.length;
  return { samples, metadata };
}
