
 // Screen detection for small displays
  const { screen } = require('electron');

  function detectScreenSize() {
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.bounds;

      console.log(`Detected screen: ${width}x${height}`);

      // If screen is small (like 480x320), use it directly
      if (width <= 480 || height <= 480) {
        return { width, height, small: true };
      }

      // Otherwise use default
      return { width: 1700, height: 800, small: false };
    } catch (e) {
      console.error('Screen detection failed:', e);
      return { width: 480, height: 320, small: true }; // Assume small if detection fails
    }
  }

  module.exports = { detectScreenSize };

