/**
 * Gorilla Compression - XOR-based float compression algorithm.
 * Based on Facebook's Gorilla paper (2015).
 *
 * Optimized for time-series float data where consecutive values are similar.
 */

import { BitWriter, BitReader } from './bitstream';

// ─────────────────────────────────────────────────────────────────
// Float64 ↔ Bits Conversion
// ─────────────────────────────────────────────────────────────────

const FLOAT_BUFFER = new ArrayBuffer(8);
const FLOAT_VIEW = new Float64Array(FLOAT_BUFFER);
const BYTE_VIEW = new Uint8Array(FLOAT_BUFFER);

/** Convert float64 to 8 bytes (big-endian for consistent bit ordering). */
function floatToBytes(value: number): Uint8Array {
  FLOAT_VIEW[0] = value;
  // Convert to big-endian
  const result = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    result[i] = BYTE_VIEW[7 - i];
  }
  return result;
}

/** Convert 8 bytes (big-endian) back to float64. */
function bytesToFloat(bytes: Uint8Array): number {
  for (let i = 0; i < 8; i++) {
    BYTE_VIEW[7 - i] = bytes[i];
  }
  return FLOAT_VIEW[0];
}

/** XOR two byte arrays. */
function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

/** Check if all bytes are zero. */
function isZeroBytes(bytes: Uint8Array): boolean {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

/** Count leading zero bits in byte array. */
function countLeadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] === 0) {
      count += 8;
    } else {
      count += Math.clz32(bytes[i]) - 24; // clz32 counts for 32-bit, adjust for 8-bit
      break;
    }
  }
  return count;
}

/** Count trailing zero bits in byte array. */
function countTrailingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (let i = 7; i >= 0; i--) {
    if (bytes[i] === 0) {
      count += 8;
    } else {
      let b = bytes[i];
      while ((b & 1) === 0) {
        count++;
        b >>>= 1;
      }
      break;
    }
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────
// Simplified Gorilla Encoder/Decoder (Byte-oriented for correctness)
// ─────────────────────────────────────────────────────────────────

/**
 * Compress float64 values using simplified Gorilla algorithm.
 * Uses byte-oriented operations for robustness.
 */
export function gorillaEncodeSimple(values: number[] | Float64Array): Uint8Array {
  if (values.length === 0) {
    return new Uint8Array(0);
  }

  const writer = new BitWriter();

  // Write count as 32-bit header
  writer.writeBits(values.length, 32);

  // First value: store all 64 bits (8 bytes)
  let prevBytes = floatToBytes(values[0]);
  for (let i = 0; i < 8; i++) {
    writer.writeBits(prevBytes[i], 8);
  }

  for (let i = 1; i < values.length; i++) {
    const currBytes = floatToBytes(values[i]);
    const xor = xorBytes(prevBytes, currBytes);

    if (isZeroBytes(xor)) {
      // Same value: single 0 bit
      writer.writeBit(0);
    } else {
      // Different value
      writer.writeBit(1);

      const leading = countLeadingZeroBits(xor);
      const trailing = countTrailingZeroBits(xor);
      const meaningful = 64 - leading - trailing;

      // Write leading zeros (6 bits, 0-63)
      writer.writeBits(leading, 6);
      // Write meaningful bits count minus 1 (6 bits, so 1-64 maps to 0-63)
      writer.writeBits(meaningful - 1, 6);

      // Write the meaningful bits (bit by bit for correctness)
      const startBit = leading;
      for (let b = 0; b < meaningful; b++) {
        const bitPos = startBit + b;
        const byteIdx = Math.floor(bitPos / 8);
        const bitIdx = 7 - (bitPos % 8); // MSB first
        const bit = (xor[byteIdx] >> bitIdx) & 1;
        writer.writeBit(bit);
      }
    }

    prevBytes = currBytes;
  }

  return writer.finish();
}

/**
 * Decompress Gorilla-encoded data.
 */
export function gorillaDecodeSimple(data: Uint8Array): Float64Array {
  if (data.length === 0) {
    return new Float64Array(0);
  }

  const reader = new BitReader(data);

  // Read count
  const count = reader.readBits(32);
  if (count === 0) {
    return new Float64Array(0);
  }

  const result = new Float64Array(count);

  // First value: read all 64 bits
  const firstBytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    firstBytes[i] = reader.readBits(8);
  }
  result[0] = bytesToFloat(firstBytes);

  let prevBytes = firstBytes;

  for (let i = 1; i < count; i++) {
    if (reader.readBit() === 0) {
      // Same value as previous
      result[i] = bytesToFloat(prevBytes);
    } else {
      // Different value
      const leading = reader.readBits(6);
      const meaningful = reader.readBits(6) + 1; // Decode back to 1-64

      // Read meaningful bits and reconstruct XOR
      const xor = new Uint8Array(8);
      const startBit = leading;

      for (let b = 0; b < meaningful; b++) {
        const bit = reader.readBit();
        const bitPos = startBit + b;
        const byteIdx = Math.floor(bitPos / 8);
        const bitIdx = 7 - (bitPos % 8);
        xor[byteIdx] |= bit << bitIdx;
      }

      // XOR with previous to get current
      const currBytes = xorBytes(prevBytes, xor);
      result[i] = bytesToFloat(currBytes);
      prevBytes = currBytes;
    }
  }

  return result;
}

// Legacy exports for compatibility
export const gorillaEncode = gorillaEncodeSimple;
export const gorillaDecode = gorillaDecodeSimple;
