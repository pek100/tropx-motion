/**
 * Device Registration Hook
 *
 * Registers device on auth, updates activity periodically.
 */

import { useEffect, useRef } from "react";
import { useMutation } from "@/lib/customConvex";
import { api } from "../../../../convex/_generated/api";
import { useCurrentUser } from "./useCurrentUser";
import { getDeviceInfo } from "@/lib/device/deviceId";

const ACTIVITY_UPDATE_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useDeviceRegistration() {
  const { isAuthenticated, isLoading } = useCurrentUser();
  const registerDevice = useMutation(api.devices.registerDevice);
  const updateActivity = useMutation(api.devices.updateDeviceActivity);

  const registeredRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      registeredRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Already registered in this session
    if (registeredRef.current) return;

    const deviceInfo = getDeviceInfo();
    console.log("[useDeviceRegistration] Registering device:", deviceInfo);

    // Register device (fire & forget)
    registerDevice(deviceInfo);
    registeredRef.current = true;

    // Update activity periodically (fire & forget)
    intervalRef.current = setInterval(() => {
      updateActivity({ deviceId: deviceInfo.deviceId });
    }, ACTIVITY_UPDATE_INTERVAL);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isAuthenticated, isLoading, registerDevice, updateActivity]);
}
