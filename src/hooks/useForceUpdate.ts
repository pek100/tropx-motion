/**
 * Custom hook for force updating React components
 * Used to minimize re-renders while maintaining reactivity
 */

import { useCallback, useState } from 'react';

/**
 * Hook that provides a function to force component re-render
 * More efficient than useState for high-frequency updates
 */
export const useForceUpdate = (): (() => void) => {
  const [, setToggle] = useState(false);

  const forceUpdate = useCallback(() => {
    setToggle(prev => !prev);
  }, []);

  return forceUpdate;
};