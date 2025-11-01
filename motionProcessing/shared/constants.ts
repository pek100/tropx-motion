/**
 * System-wide mathematical and timing constants.
 */
export enum SYSTEM {
    DECIMAL_PRECISION = 10,
    MILLISECONDS_PER_SECOND = 1000,
    ZERO_TIMEOUT = 0,
    SET_INCREMENT = 1,
    MINIMUM_DEVICES_FOR_JOINT = 2,
}
// Complex objects that can't be converted to simple enums
export const IDENTITY_QUATERNION = { w: 1, x: 0, y: 0, z: 0 } as const;
/**
 * Configuration for data chunking and upload optimization.
 */
export enum CHUNKING {
    DEFAULT_MEASUREMENTS_PER_CHUNK = 100000,
    BYTES_PER_MEASUREMENT_ESTIMATE = 8,
    SAFETY_LIMIT_CHUNKS = 100,
    CHUNK_SIZE_HIGH_FREQ = 200000,
    CHUNK_SIZE_MID_FREQ = 300000,
    CHUNK_SIZE_LOW_FREQ = 500000,
}

/**
 * Cache configuration for different data types and performance levels.
 */
export enum CACHE {
    RECORDING_SIZE = 10,
    RECORDING_TTL_MS = 300000,
    DEFAULT_MAX_SIZE = 1000,
    DEFAULT_MAX_AGE_MS = 30000,
    CLEANUP_INTERVAL_MS = 60000,
    TTL_MS = 50,
    SIZE_LOW_FREQ = 500,
    SIZE_MID_FREQ = 1000,
    SIZE_HIGH_FREQ = 2000,
}

/**
 * Server communication and retry configuration.
 */
export enum SERVER {
    MAX_RETRIES = 3,
    RETRY_DELAY_MS = 5000,
    BATCH_SIZE = 10,
    MAX_QUEUE_SIZE = 100,
}

/**
 * Device synchronization timing parameters.
 */
export enum SYNC {
    TIMEOUT_PAIRED_MS = 500,
    TIMEOUT_UNPAIRED_MS = 1000,
    CHECK_INTERVAL_MS = 100,
}

/**
 * Device status and health monitoring thresholds.
 */
export enum DEVICE {
    RECENT_ACTIVITY_MULTIPLIER = 10,
    UNKNOWN_SORT_ORDER = 999,
}

/**
 * Mathematical constants for quaternion interpolation and processing.
 */
export enum INTERPOLATION {
    BUFFER_SIZE = 4,
    MAX_PROCESSED_HISTORY = 100,
    QUATERNION_POOL_SIZE = 50,
    EPSILON = 0.001,
    DOT_PRODUCT_THRESHOLD = 0.95,
    CORRECTION_FACTOR = 0.35,
}

/**
 * Mathematical precision constants for angle calculations.
 */
export enum ANGLE {
    EPSILON = 0.000001, // 1e-6
}

/**
 * Statistical data collection limits to prevent memory overflow.
 */
export enum STATISTICS {
    MAX_VALUES_HISTORY = 1000,
}

/**
 * Logging system configuration for batched output.
 */
export enum LOGGER {
    BATCH_SIZE = 50,
    FLUSH_DELAY_MS = 100,
}

/**
 * User interface timing and update frequency constants.
 */
export enum UI {
    THROTTLE_INTERVAL_MS = 16,
    DEVICE_STATE_UPDATE_INTERVAL_MS = 1000,
    UPLOAD_SUCCESS_TIMEOUT_MS = 3000,
    UPLOAD_ERROR_TIMEOUT_MS = 5000,
    TIME_BUFFER_MS = 2000,
    ONE_HOUR_MS = 3600000, // 60 * 60 * 1000
}

/**
 * Supported sampling rates for different performance profiles.
 */
export enum SAMPLE_RATES {
    HZ_100 = 100,
    HZ_200 = 200,
    HZ_400 = 400,
}

/**
 * Battery level thresholds for device monitoring and alerts.
 */
export enum BATTERY {
    LOW = 20,
    CRITICAL = 5,
    FULL = 100,
    EMPTY = 0,
}

/**
 * Standard device connection state identifiers.
 */
export enum CONNECTION_STATE {
    CONNECTED = 'connected',
    STREAMING = 'streaming',
    DISCONNECTED = 'disconnected',
    ERROR = 'error',
}

// Complex nested objects that can't be converted to simple enums
export const DEVICE_PATTERNS = {
    leftKnee: {
        top: ['^.*ln_top.*$', '^muse_v3_2$'],
        bottom: ['^.*ln_bottom.*$', '^muse_v3$']
    },
    rightKnee: {
        top: ['^.*rn_top.*$', '^muse_v3_01$'],
        bottom: ['^.*rn_bottom.*$', '^muse_v3_02$']
    }
} as const;