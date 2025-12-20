/**
 * BitStream - Bit-level read/write operations for Gorilla compression.
 */

// ─────────────────────────────────────────────────────────────────
// BitWriter
// ─────────────────────────────────────────────────────────────────

export class BitWriter {
  private buffer: number[] = [];
  private current = 0;
  private bitPos = 0;

  /** Write `count` bits from `value` (MSB first). */
  writeBits(value: number, count: number): void {
    if (count === 0) return;
    if (count > 32) {
      // Handle large values by splitting
      this.writeBits(Math.floor(value / 0x100000000), count - 32);
      this.writeBits(value >>> 0, 32);
      return;
    }

    for (let i = count - 1; i >= 0; i--) {
      const bit = (value >> i) & 1;
      this.current = (this.current << 1) | bit;
      this.bitPos++;

      if (this.bitPos === 8) {
        this.buffer.push(this.current);
        this.current = 0;
        this.bitPos = 0;
      }
    }
  }

  /** Write a single bit. */
  writeBit(bit: number): void {
    this.current = (this.current << 1) | (bit & 1);
    this.bitPos++;

    if (this.bitPos === 8) {
      this.buffer.push(this.current);
      this.current = 0;
      this.bitPos = 0;
    }
  }

  /** Finalize and return the byte array. */
  finish(): Uint8Array {
    if (this.bitPos > 0) {
      // Pad remaining bits with zeros
      this.buffer.push(this.current << (8 - this.bitPos));
    }
    return new Uint8Array(this.buffer);
  }

  /** Get current bit count. */
  getBitCount(): number {
    return this.buffer.length * 8 + this.bitPos;
  }
}

// ─────────────────────────────────────────────────────────────────
// BitReader
// ─────────────────────────────────────────────────────────────────

export class BitReader {
  private data: Uint8Array;
  private bytePos = 0;
  private bitPos = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  /** Read `count` bits and return as number. */
  readBits(count: number): number {
    if (count === 0) return 0;
    if (count > 32) {
      const high = this.readBits(count - 32);
      const low = this.readBits(32);
      return high * 0x100000000 + (low >>> 0);
    }

    let result = 0;
    for (let i = 0; i < count; i++) {
      if (this.bytePos >= this.data.length) {
        throw new Error('BitReader: unexpected end of data');
      }

      const bit = (this.data[this.bytePos] >> (7 - this.bitPos)) & 1;
      result = (result << 1) | bit;
      this.bitPos++;

      if (this.bitPos === 8) {
        this.bitPos = 0;
        this.bytePos++;
      }
    }

    return result >>> 0;
  }

  /** Read a single bit. */
  readBit(): number {
    if (this.bytePos >= this.data.length) {
      throw new Error('BitReader: unexpected end of data');
    }

    const bit = (this.data[this.bytePos] >> (7 - this.bitPos)) & 1;
    this.bitPos++;

    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos++;
    }

    return bit;
  }

  /** Check if there are more bits to read. */
  hasMore(): boolean {
    return this.bytePos < this.data.length;
  }

  /** Get current bit position. */
  getPosition(): number {
    return this.bytePos * 8 + this.bitPos;
  }
}
