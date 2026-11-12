import { MAX_REFRESH_MS, MIN_REFRESH_MS, config } from './config';

/**
 * User-tunable settings. Only safe, non-sensitive values belong here; this is
 * persisted to `localStorage` and is visible in the browser.
 */
export interface Settings {
  /** Auto-refresh interval in milliseconds. */
  autoRefreshMs: number;
}

export const SETTINGS_STORAGE_KEY = 'window-seat:settings:v1';

export const REFRESH_OPTIONS_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;

export const DEFAULT_SETTINGS: Settings = {
  autoRefreshMs: config.defaultRefreshMs,
};

/** Clamp any value to a supported refresh interval. Invalid values fall back. */
export function clampRefreshMs(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_SETTINGS.autoRefreshMs;
  return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, Math.round(parsed)));
}

/** Validate an already-parsed settings object. Unknown/malformed fields reset. */
export function parseSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };

  const record = value as Record<string, unknown>;
  return {
    autoRefreshMs:
      record.autoRefreshMs === undefined
        ? DEFAULT_SETTINGS.autoRefreshMs
        : clampRefreshMs(record.autoRefreshMs),
  };
}

/** Validate a raw `localStorage` string; corrupt JSON resets to defaults. */
export function parseSettingsJson(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return parseSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    // Access can throw in private mode or when storage is disabled.
    return null;
  }
}

export function loadSettings(storage: Storage | null = getStorage()): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    return parseSettingsJson(storage.getItem(SETTINGS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: Settings,
  storage: Storage | null = getStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parseSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

/** Human-readable interval label, e.g. `15 s`, `2 min`. */
export function formatInterval(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`;
}
