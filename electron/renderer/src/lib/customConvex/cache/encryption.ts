/**
 * Encryption utilities for offline cache using Web Crypto API.
 *
 * Two-layer architecture:
 * - KEK (Key Encryption Key): Stored in Convex, used to wrap/unwrap DEK
 * - DEK (Data Encryption Key): Stored locally in IndexedDB (wrapped), used to encrypt data
 *
 * All operations use AES-256-GCM for authenticated encryption.
 */

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 16;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface WrappedKey {
  wrapped: string; // Base64-encoded wrapped key
  iv: string; // Base64-encoded IV used for wrapping
  version: number; // KEK version used for wrapping
}

export interface EncryptedData {
  ciphertext: string; // Base64-encoded ciphertext
  iv: string; // Base64-encoded IV
}

// ─────────────────────────────────────────────────────────────────
// Key Generation
// ─────────────────────────────────────────────────────────────────

/** Generate a new random AES-256-GCM key for use as DEK. */
export async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable (needed for wrapping)
    ["encrypt", "decrypt"]
  );
}

/** Generate a new random AES-256-GCM key for use as KEK. */
export async function generateKEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable (needed for storage in Convex)
    ["wrapKey", "unwrapKey"]
  );
}

// ─────────────────────────────────────────────────────────────────
// Key Import/Export
// ─────────────────────────────────────────────────────────────────

/** Export a CryptoKey to base64 string (for storage). */
export async function exportKey(key: CryptoKey): Promise<string> {
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(rawKey);
}

/** Import a base64 string as a CryptoKey. */
export async function importKEK(base64Key: string): Promise<CryptoKey> {
  const rawKey = base64ToArrayBuffer(base64Key);
  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    false, // not extractable (we already have the base64)
    ["wrapKey", "unwrapKey"]
  );
}

/** Import a base64 string as a DEK (for encryption/decryption). */
export async function importDEK(base64Key: string): Promise<CryptoKey> {
  const rawKey = base64ToArrayBuffer(base64Key);
  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

// ─────────────────────────────────────────────────────────────────
// Key Wrapping (KEK wraps DEK)
// ─────────────────────────────────────────────────────────────────

/** Wrap DEK with KEK for secure local storage. */
export async function wrapDEK(
  dek: CryptoKey,
  kek: CryptoKey,
  kekVersion: number
): Promise<WrappedKey> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const wrapped = await crypto.subtle.wrapKey("raw", dek, kek, {
    name: ALGORITHM,
    iv,
  });

  return {
    wrapped: arrayBufferToBase64(wrapped),
    iv: arrayBufferToBase64(iv),
    version: kekVersion,
  };
}

/** Unwrap DEK using KEK. */
export async function unwrapDEK(
  wrappedKey: WrappedKey,
  kek: CryptoKey
): Promise<CryptoKey> {
  const wrapped = base64ToArrayBuffer(wrappedKey.wrapped);
  const iv = base64ToArrayBuffer(wrappedKey.iv);

  return crypto.subtle.unwrapKey(
    "raw",
    wrapped,
    kek,
    { name: ALGORITHM, iv },
    { name: ALGORITHM, length: KEY_LENGTH },
    false, // not extractable
    ["encrypt", "decrypt"]
  );
}

// ─────────────────────────────────────────────────────────────────
// Binary-Safe Serialization
// ─────────────────────────────────────────────────────────────────

// Marker prefix for binary data (unlikely to conflict with real data)
const BINARY_MARKER = "__bin__:";
const TYPED_ARRAY_MARKER = "__typed__:";

// Map of typed array constructors for restoration
const TYPED_ARRAY_CONSTRUCTORS: Record<string, new (buffer: ArrayBuffer) => ArrayBufferView> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array: BigInt64Array as any,
  BigUint64Array: BigUint64Array as any,
};

/**
 * Recursively serialize data, converting binary types to base64 strings.
 * Handles: ArrayBuffer, all TypedArray variants, nested objects/arrays.
 */
function serializeWithBinary(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle ArrayBuffer
  if (data instanceof ArrayBuffer) {
    return BINARY_MARKER + arrayBufferToBase64(data);
  }

  // Handle TypedArrays (Uint8Array, Float32Array, etc.)
  if (ArrayBuffer.isView(data) && !(data instanceof DataView)) {
    const typeName = data.constructor.name;
    const base64 = arrayBufferToBase64(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    return TYPED_ARRAY_MARKER + typeName + ":" + base64;
  }

  // Handle DataView
  if (data instanceof DataView) {
    const base64 = arrayBufferToBase64(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    return BINARY_MARKER + base64;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(serializeWithBinary);
  }

  // Handle plain objects
  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = serializeWithBinary(value);
    }
    return result;
  }

  // Primitives pass through
  return data;
}

/**
 * Recursively deserialize data, restoring binary types from base64 strings.
 */
function deserializeWithBinary(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  // Handle string markers
  if (typeof data === "string") {
    // Check for TypedArray marker
    if (data.startsWith(TYPED_ARRAY_MARKER)) {
      const rest = data.slice(TYPED_ARRAY_MARKER.length);
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        const typeName = rest.slice(0, colonIdx);
        const base64 = rest.slice(colonIdx + 1);
        const buffer = base64ToArrayBuffer(base64);
        const Constructor = TYPED_ARRAY_CONSTRUCTORS[typeName];
        if (Constructor) {
          return new Constructor(buffer);
        }
      }
      // Fallback: return as ArrayBuffer if type not found
      return base64ToArrayBuffer(data.slice(TYPED_ARRAY_MARKER.length));
    }

    // Check for ArrayBuffer marker
    if (data.startsWith(BINARY_MARKER)) {
      return base64ToArrayBuffer(data.slice(BINARY_MARKER.length));
    }

    return data;
  }

  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(deserializeWithBinary);
  }

  // Handle plain objects
  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = deserializeWithBinary(value);
    }
    return result;
  }

  // Primitives pass through
  return data;
}

// ─────────────────────────────────────────────────────────────────
// Data Encryption/Decryption
// ─────────────────────────────────────────────────────────────────

/** Encrypt arbitrary data with DEK. Handles binary data (ArrayBuffer, TypedArrays). */
export async function encrypt(
  data: unknown,
  dek: CryptoKey
): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  // Serialize with binary support before JSON encoding
  const serialized = serializeWithBinary(data);
  const plaintext = new TextEncoder().encode(JSON.stringify(serialized));

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    dek,
    plaintext
  );

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
  };
}

/** Decrypt data with DEK. Restores binary data (ArrayBuffer, TypedArrays). */
export async function decrypt<T = unknown>(
  encrypted: EncryptedData,
  dek: CryptoKey
): Promise<T> {
  const ciphertext = base64ToArrayBuffer(encrypted.ciphertext);
  const iv = base64ToArrayBuffer(encrypted.iv);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    dek,
    ciphertext
  );

  const text = new TextDecoder().decode(plaintext);
  const parsed = JSON.parse(text);
  // Deserialize with binary support after JSON decoding
  return deserializeWithBinary(parsed) as T;
}

// ─────────────────────────────────────────────────────────────────
// Hashing (for cache keys)
// ─────────────────────────────────────────────────────────────────

/** Generate a stable hash of query arguments for cache key. */
export async function hashArgs(args: unknown): Promise<string> {
  // Safely serialize args - handle all edge cases
  let text: string;
  try {
    text = safeStringify(args);
  } catch {
    // Last resort fallback - use JSON.stringify with error handling
    try {
      text = JSON.stringify(args) ?? "null";
    } catch {
      text = "unstringifiable";
    }
  }

  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  // Use first 16 bytes (32 hex chars) for reasonable uniqueness
  return arrayBufferToHex(hash).slice(0, 32);
}

/**
 * Safe stringify that handles all edge cases including:
 * - Convex IDs (which may be special objects)
 * - Circular references
 * - Objects with no proper toString/valueOf
 * - Symbols and other non-serializable types
 */
function safeStringify(value: unknown): string {
  // Handle primitives directly
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const type = typeof value;

  if (type === "string") return JSON.stringify(value);
  if (type === "number" || type === "boolean") return String(value);
  if (type === "bigint") return value.toString() + "n";
  if (type === "symbol") return value.toString();
  if (type === "function") return "[function]";

  // Handle arrays
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      try {
        return safeStringify(item);
      } catch {
        return "[error]";
      }
    });
    return "[" + items.join(",") + "]";
  }

  // Handle objects
  if (type === "object") {
    // Try to detect if it's a primitive wrapper or has a simple valueOf
    try {
      const primitive = (value as any).valueOf();
      if (primitive !== value && (typeof primitive === "string" || typeof primitive === "number")) {
        return JSON.stringify(primitive);
      }
    } catch {
      // Ignore valueOf errors
    }

    // Try to get a string representation if it has a custom toString
    try {
      const str = Object.prototype.toString.call(value);
      // If it's a special object type, use JSON.stringify directly
      if (str !== "[object Object]") {
        const jsonResult = JSON.stringify(value);
        if (jsonResult !== undefined) return jsonResult;
      }
    } catch {
      // Ignore toString errors
    }

    // Regular object - iterate keys safely
    try {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj);
      keys.sort(); // Sort for stable ordering

      const pairs: string[] = [];
      for (const key of keys) {
        try {
          const v = obj[key];
          const keyStr = JSON.stringify(key);
          const valStr = safeStringify(v);
          pairs.push(keyStr + ":" + valStr);
        } catch {
          // Skip problematic keys
        }
      }
      return "{" + pairs.join(",") + "}";
    } catch {
      // Object.keys failed - try JSON.stringify as fallback
      try {
        return JSON.stringify(value) ?? "[object]";
      } catch {
        return "[object]";
      }
    }
  }

  // Unknown type
  return "[unknown]";
}

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────

/** Check if Web Crypto API is available. */
export function isCryptoAvailable(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.subtle.generateKey === "function"
  );
}

/** Verify encryption is working by round-trip test. */
export async function verifyEncryption(): Promise<boolean> {
  try {
    const testData = { test: "encryption-verification", timestamp: Date.now() };
    const dek = await generateDEK();
    const encrypted = await encrypt(testData, dek);
    const decrypted = await decrypt<typeof testData>(encrypted, dek);
    return (
      decrypted.test === testData.test &&
      decrypted.timestamp === testData.timestamp
    );
  } catch {
    return false;
  }
}
