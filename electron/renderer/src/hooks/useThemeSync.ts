/**
 * Theme Sync Hook
 *
 * Syncs theme preference between next-themes (localStorage) and server (per-device).
 * Server is source of truth when available, falls back to localStorage.
 */

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { useQuery, useMutation } from "@/lib/customConvex";
import { api } from "../../../../convex/_generated/api";
import { useCurrentUser } from "./useCurrentUser";
import { getDeviceId } from "@/lib/device/deviceId";

type Theme = "light" | "dark" | "system";

export function useThemeSync() {
  const { isAuthenticated, isLoading: authLoading } = useCurrentUser();
  const { theme, setTheme } = useTheme();
  const deviceId = getDeviceId();

  const preferences = useQuery(
    api.devices.getDevicePreferences,
    isAuthenticated ? { deviceId } : "skip"
  );
  const updatePreferences = useMutation(api.devices.updateDevicePreferences);

  const initialSyncDoneRef = useRef(false);
  const lastSavedThemeRef = useRef<string | null>(null);

  // Load theme from server on mount (only once)
  useEffect(() => {
    if (authLoading || !isAuthenticated || initialSyncDoneRef.current) return;
    if (preferences === undefined) return; // Still loading

    initialSyncDoneRef.current = true;
    console.log("[useThemeSync] Initial sync - server preferences:", preferences, "local theme:", theme);

    // If server has a theme preference, apply it (server is source of truth)
    if (preferences?.theme) {
      console.log("[useThemeSync] Applying server theme:", preferences.theme);
      setTheme(preferences.theme);
      lastSavedThemeRef.current = preferences.theme;
    } else {
      // No server preference yet - just track current theme but DON'T save to server
      // Only save when user explicitly changes theme during this session
      console.log("[useThemeSync] No server theme, waiting for user to change theme");
      lastSavedThemeRef.current = theme || null;
    }
  }, [
    authLoading,
    isAuthenticated,
    preferences,
    theme,
    setTheme,
    deviceId,
    updatePreferences,
  ]);

  // Save theme changes to server
  useEffect(() => {
    if (!isAuthenticated || !theme) return;
    if (!initialSyncDoneRef.current) return; // Wait for initial sync
    if (theme === lastSavedThemeRef.current) return; // No change

    console.log("[useThemeSync] Theme changed, saving to server:", theme);
    lastSavedThemeRef.current = theme;
    // Fire & forget
    updatePreferences({
      deviceId,
      preferences: { theme: theme as Theme },
    });
  }, [isAuthenticated, theme, deviceId, updatePreferences]);
}
