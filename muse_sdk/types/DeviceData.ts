/**
 * DeviceData.ts
 * 
 * This file defines the core data structures and types used throughout the SDK.
 * It includes interfaces for sensor data, device states, and communication protocols.
 * The structures support both traditional IMU sensors and quaternion orientation data.
 */

// Basic 3D vector interface used for all spatial measurements
export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

// Quaternion interface for representing 3D orientation
// A unit quaternion provides a compact and efficient way to represent rotation
export interface Quaternion {
  w: number;  // Real (scalar) component
  x: number;  // First imaginary component (i)
  y: number;  // Second imaginary component (j)
  z: number;  // Third imaginary component (k)
}

// Combined data structure for all sensor readings
export interface IMUData {
  timestamp: number;       // Unix timestamp in milliseconds
  
  // Traditional IMU sensor data
  axl: Vector3D;          // Accelerometer data (m/s²)
  gyr: Vector3D;          // Gyroscope data (degrees/sec)
  mag: Vector3D;          // Magnetometer data (μT)
  
  // Orientation data
  quaternion: Quaternion; // Device orientation as unit quaternion
}

// Configuration interface for sensor calibration
export interface ConfigurableSensorConfig {
  FullScale: number;    // Maximum measurable value
  Sensitivity: number;  // Conversion factor from raw to physical units
}

// Complete set of sensor configurations
export interface SensorConfigurations {
  gyroscope: ConfigurableSensorConfig;
  accelerometer: ConfigurableSensorConfig;
  magnetometer: ConfigurableSensorConfig;
}

// All possible device connection states
export type ConnectionState = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'streaming';

// Callback type for streaming data
export type StreamCallback = (data: IMUData) => void;

// Interface for device data tracking
export interface DeviceData {
  id: string;                          // Device identifier
  name: string;                        // Device name
  batteryLevel: number | null;         // Battery percentage (0-100)
  connectionState: ConnectionState;     // Current connection state
  imuData: IMUData | null;             // Latest sensor readings
}