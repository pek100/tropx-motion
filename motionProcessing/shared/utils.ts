import { SYSTEM } from './constants';

/**
 * Rounds number to system-defined decimal precision, handling invalid values gracefully.
 */
export const roundToPrecision = (value: number): number => {
    if (!isFinite(value) || isNaN(value)) {
        return 0;
    }
    return Math.round(value * SYSTEM.DECIMAL_PRECISION) / SYSTEM.DECIMAL_PRECISION;
};

/**
 * Returns array length with safety check for non-array values.
 */
export const safeArrayLength = (arr: any): number => {
    return Array.isArray(arr) ? arr.length : 0;
};

/**
 * Filters null values from array while preserving type safety.
 */
export const filterNonNull = <T>(arr: (T | null)[]): T[] => {
    return arr.filter((item): item is T => item !== null);
};

/**
 * Returns current timestamp in milliseconds.
 */
export const getCurrentTimestamp = (): number => Date.now();

/**
 * Converts sensor-relative timestamp to UTC by adding recording start time.
 */
export const convertSensorTimeToUTC = (sensorTimestamp: number, startTime: number): number => {
    return startTime + sensorTimestamp;
};

/**
 * Safely parses JSON string with fallback value on error.
 */
export const safeJSONParse = <T>(str: string, fallback: T): T => {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
};

/**
 * Safely stringifies object to JSON, returning null on error.
 */
export const safeJSONStringify = (obj: any): string | null => {
    try {
        return JSON.stringify(obj);
    } catch {
        return null;
    }
};

/**
 * Tests device ID against regex pattern with fallback to exact string match.
 */
export const testDevicePattern = (deviceId: string, pattern: string): boolean => {
    try {
        return new RegExp(pattern).test(deviceId);
    } catch {
        return deviceId === pattern;
    }
};

/**
 * Tests device ID against multiple patterns, returning true if any pattern matches.
 */
export const testDeviceAgainstPatterns = (deviceId: string, patterns: readonly string[]): boolean => {
    return patterns.some(pattern => testDevicePattern(deviceId, pattern));
};