import { screen } from 'electron';

export function getWindowDimensions() {
  try {
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.bounds;

    console.log(`Screen detected: ${width}x${height}`);

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
      width: 1600,
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
