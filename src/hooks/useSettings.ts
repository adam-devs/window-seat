import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type Settings,
  clampRefreshMs,
  loadSettings,
  parseSettings,
  parseSettingsJson,
  saveSettings,
} from '../settings';

export interface UseSettingsResult {
  settings: Settings;
  setAutoRefreshMs: (ms: number) => void;
  resetSettings: () => void;
}

/**
 * Shared settings state backed by `localStorage`.
 *
 * Persistence is synchronous so a reload immediately picks up the last choice.
 * Storage failures (private mode, quota) degrade to in-memory state.
 */
export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const apply = useCallback((next: Settings) => {
    const normalized = parseSettings(next);
    settingsRef.current = normalized;
    saveSettings(normalized);
    setSettings(normalized);
  }, []);

  const setAutoRefreshMs = useCallback(
    (ms: number) => {
      apply({ ...settingsRef.current, autoRefreshMs: clampRefreshMs(ms) });
    },
    [apply],
  );

  const resetSettings = useCallback(() => {
    apply(DEFAULT_SETTINGS);
  }, [apply]);

  // Keep multiple tabs in sync. Storage events do not fire in the source tab.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    function handleStorage(event: StorageEvent) {
      if (event.key !== SETTINGS_STORAGE_KEY) return;
      setSettings(parseSettingsJson(event.newValue));
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  return { settings, setAutoRefreshMs, resetSettings };
}
