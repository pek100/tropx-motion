import type { MotionDataMessage, DeviceStatusMessage, BatteryUpdateMessage, ErrorMessage } from './messages';

// Event types
export const EVENT_TYPES = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
  MOTION_DATA: 'motionData',
  DEVICE_STATUS: 'deviceStatus',
  BATTERY_UPDATE: 'batteryUpdate',
  MESSAGE: 'message',
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

// Event payload mapping
export interface EventPayloadMap {
  [EVENT_TYPES.CONNECTED]: void;
  [EVENT_TYPES.DISCONNECTED]: { code: number; reason: string };
  [EVENT_TYPES.RECONNECTING]: { attempt: number; delay: number };
  [EVENT_TYPES.ERROR]: Error;
  [EVENT_TYPES.MOTION_DATA]: MotionDataMessage;
  [EVENT_TYPES.DEVICE_STATUS]: DeviceStatusMessage;
  [EVENT_TYPES.BATTERY_UPDATE]: BatteryUpdateMessage;
  [EVENT_TYPES.MESSAGE]: ErrorMessage;
}

// Type-safe event handler
export type EventHandler<E extends EventType> = (payload: EventPayloadMap[E]) => void;
