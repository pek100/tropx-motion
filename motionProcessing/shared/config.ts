import { MotionConfig } from "./types";
import { SAMPLE_RATES, CACHE, DEVICE_PATTERNS } from './constants';

export enum PerformanceProfile {
    HZ_100_SAMPLING = '100HZ_SAMPLING',
    HZ_200_SAMPLING = '200HZ_SAMPLING',
    HZ_400_SAMPLING = '400HZ_SAMPLING'
}

export enum JointName {
    LEFT_KNEE = 'left-knee',
    RIGHT_KNEE = 'right-knee'
}


interface PerformanceSettings {
    sampleRate: number;
    cacheSize: number;
    logging: boolean;
}

/**
 * Predefined performance profiles for different use cases.
 * Higher frequencies provide more precision but require more processing power.
 */
const PERFORMANCE_OPTIONS: Record<PerformanceProfile, PerformanceSettings> = {
    [PerformanceProfile.HZ_100_SAMPLING]: {
        sampleRate: SAMPLE_RATES.HZ_100,
        cacheSize: CACHE.SIZE_LOW_FREQ,
        logging: false
    },
    [PerformanceProfile.HZ_200_SAMPLING]: {
        sampleRate: SAMPLE_RATES.HZ_200,
        cacheSize: CACHE.SIZE_MID_FREQ,
        logging: false
    },
    [PerformanceProfile.HZ_400_SAMPLING]: {
        sampleRate: SAMPLE_RATES.HZ_400,
        cacheSize: CACHE.SIZE_HIGH_FREQ,
        logging: false
    }
};

/**
 * Creates motion processing configuration with specified performance profile.
 * Configures sampling rate, cache sizes, and joint definitions.
 */
export function createMotionConfig(
    profile: PerformanceProfile = PerformanceProfile.HZ_100_SAMPLING,
    enableLogging: boolean = false
): MotionConfig {
    const settings = PERFORMANCE_OPTIONS[profile];

    return {
        targetHz: settings.sampleRate,
        logging: enableLogging || settings.logging,
        joints: createJointConfigs(),
        performance: {
            cacheSize: settings.cacheSize
        }
    };
}

/**
 * Creates standard joint configurations for left and right knee tracking.
 * Uses device pattern matching to automatically assign sensors to joints.
 */
function createJointConfigs() {
    return [
        {
            name: JointName.LEFT_KNEE,
            topSensorPattern: DEVICE_PATTERNS.leftKnee.top,
            bottomSensorPattern: DEVICE_PATTERNS.leftKnee.bottom,
            calibration: { offset: 0, multiplier: 1 }
        },
        {
            name: JointName.RIGHT_KNEE,
            topSensorPattern: DEVICE_PATTERNS.rightKnee.top,
            bottomSensorPattern: DEVICE_PATTERNS.rightKnee.bottom,
            calibration: { offset: 0, multiplier: 1 }
        }
    ];
}