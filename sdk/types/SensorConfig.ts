/**
 * SensorConfig.ts
 * 
 * This file defines the types used for sensor configuration across the SDK.
 * We separate these into their own file to maintain clean organization and
 * prevent circular dependencies.
 */

// Base interface for all sensor configurations
export interface ConfigurableSensorConfig {
    FullScale: number;    // The maximum measurable value for the sensor
    Sensitivity: number;  // Conversion factor from raw values to physical units
  }
  
  // Type for a complete set of sensor configurations
  export interface SensorConfigurations {
    gyroscope: ConfigurableSensorConfig;
    accelerometer: ConfigurableSensorConfig;
    magnetometer: ConfigurableSensorConfig;
  }