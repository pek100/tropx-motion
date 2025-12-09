
 import { screen } from 'electron';
  import * as fs from 'fs';

  export function getWindowDimensions() {
    try {
      const display = screen.getPrimaryDisplay();
      const { width, height } = display.bounds;

      console.log(`Screen detected: ${width}x${height}`);

      // Check if running on Raspberry Pi
      let isRaspberryPi = false;
      try {
        if (fs.existsSync('/proc/device-tree/model')) {
          const model = fs.readFileSync('/proc/device-tree/model', 'utf8');
          isRaspberryPi = model.includes('Raspberry Pi');
          if (isRaspberryPi) {
            console.log(`Raspberry Pi detected: ${model.trim()}`);
          }
        }
      } catch (err) {
        console.warn('Could not detect Raspberry Pi:', err);
      }

      // Force fullscreen + small screen mode on Raspberry Pi regardless of actual screen size
      if (isRaspberryPi) {
        console.log('Raspberry Pi - using fullscreen mode with small screen layout');
        return {
          width,
          height,
          minWidth: width,
          minHeight: height,
          isSmallScreen: true,
          isRaspberryPi: true,
          fullscreen: true
        };
      }

      // Use actual screen size if it's small (<=480px)
      if (width <= 480 || height <= 480) {
        console.log('Small screen detected - using full screen dimensions');
        return {
          width,
          height,
          minWidth: width,
          minHeight: height,
          isSmallScreen: true
        };
      }

      // Use defaults for larger screens
      return {
        width: 1700,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        isSmallScreen: false
      };
    } catch (e) {
      console.error('Screen detection failed, assuming 480x320:', e);
      return {
        width: 480,
        height: 320,
        minWidth: 480,
        minHeight: 320,
        isSmallScreen: true
      };
    }
  }

