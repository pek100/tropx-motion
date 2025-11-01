/**
 * Time Synchronization Constants
 *
 * Based on Muse v3 TimeSync Protocol Specification
 * All timestamps use milliseconds (no conversions required)
 */

// Reference epoch for TropX/Muse devices (Jan 26, 2020 00:53:20 UTC)
// Per official spec (AN_221e line 324): (ulong)1580000000 * 1000
export const REFERENCE_EPOCH_SECONDS = 1580000000;
export const REFERENCE_EPOCH_MS = REFERENCE_EPOCH_SECONDS * 1000;

// Time sync commands (Muse v3 protocol)
export enum TimeSyncCommand {
  SET_DATETIME = 0x0b,
  ENTER_TIMESYNC = 0x32,
  GET_TIMESTAMP = 0xb2,
  EXIT_TIMESYNC = 0x33,
  SET_CLOCK_OFFSET = 0x31
}

// Time sync configuration
export const SAMPLE_COUNT = 20;
export const OUTLIER_REMOVAL_PERCENT = 0.2;
export const SAMPLE_DELAY_MS = 10;
export const RETRY_MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 1000;
