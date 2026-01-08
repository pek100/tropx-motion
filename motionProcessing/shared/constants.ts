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

export const IDENTITY_QUATERNION = { w: 1, x: 0, y: 0, z: 0 } as const;

/**
 * Device status and health monitoring thresholds.
 */
export enum DEVICE {
    RECENT_ACTIVITY_MULTIPLIER = 10,
    UNKNOWN_SORT_ORDER = 999,
}

/**
 * Mathematical precision constants for angle calculations.
 * @deprecated Use QUATERNION constants instead for quaternion-specific operations
 */
export enum ANGLE {
    EPSILON = 0.000001,
}

/**
 * Quaternion mathematical constants for normalization and interpolation.
 */
export const QUATERNION = {
    /** Magnitude threshold below which a quaternion is considered degenerate.
     *  Used to guard against division by zero in normalization. */
    EPSILON: 1e-6,

    /** Dot product threshold for using linear interpolation in SLERP.
     *  When cos(θ) > 0.9995, angle < 1.8°, LERP ≈ SLERP with better numerical stability.
     *  This is a standard constant used in game engines and graphics libraries. */
    SLERP_LINEAR_THRESHOLD: 0.9995,
} as const;

/**
 * Logging system configuration for batched output.
 */
export enum LOGGER {
    BATCH_SIZE = 50,
    FLUSH_DELAY_MS = 100,
}

/**
 * User interface timing constants.
 */
export enum UI {
    DEVICE_STATE_UPDATE_INTERVAL_MS = 1000,
    UPLOAD_SUCCESS_TIMEOUT_MS = 3000,
    UPLOAD_ERROR_TIMEOUT_MS = 5000,
    TIME_BUFFER_MS = 2000,
    ONE_HOUR_MS = 3600000,
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
