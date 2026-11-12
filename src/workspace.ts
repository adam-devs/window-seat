import type { BoundingBox, SelectionMode } from './types';
import type { ProviderId } from './data/types';
import {
  normalizeDirectionalSelection,
  type DirectionalSelection,
} from './data/directionalView';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  clampRefreshMs,
  parseSettingsJson,
} from './settings';

export type { DirectionalSelection } from './data/directionalView';

/**
 * Versioned local workspace.
 *
 * This is separate from the legacy refresh-only settings key so the schema can
 * grow without breaking existing installs. `loadWorkspace` migrates the old
 * refresh interval on first read; the UI still uses `useSettings` until M3.2
 * switches startup restore over to the workspace hook.
 */

export const WORKSPACE_STORAGE_KEY = 'window-seat:workspace:v1';
export const WORKSPACE_VERSION = 1;

export type UnitSystem = 'aviation' | 'metric';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Workspace {
  perimeter: BoundingBox | null;
  mode: SelectionMode;
  direction: DirectionalSelection | null;
  units: UnitSystem;
  theme: ThemePreference;
  autoRefreshMs: number;
  providerId: ProviderId | null;
}

export interface StoredWorkspace extends Workspace {
  version: typeof WORKSPACE_VERSION;
}

export const DEFAULT_WORKSPACE: Workspace = {
  perimeter: null,
  mode: 'perimeter',
  direction: null,
  units: 'aviation',
  theme: 'system',
  autoRefreshMs: DEFAULT_SETTINGS.autoRefreshMs,
  providerId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseBoundingBox(value: unknown): BoundingBox | null {
  if (!isRecord(value)) return null;

  const lamin = finiteNumber(value.lamin);
  const lamax = finiteNumber(value.lamax);
  const lomin = finiteNumber(value.lomin);
  const lomax = finiteNumber(value.lomax);
  if (
    lamin === null ||
    lamax === null ||
    lomin === null ||
    lomax === null ||
    lamin < -90 ||
    lamax > 90 ||
    lomin < -180 ||
    lomax > 180
  ) {
    return null;
  }

  const south = Math.min(lamin, lamax);
  const north = Math.max(lamin, lamax);
  const west = Math.min(lomin, lomax);
  const east = Math.max(lomin, lomax);
  if (south === north || west === east) return null;

  return { lamin: south, lomin: west, lamax: north, lomax: east };
}

function parseUnits(value: unknown): UnitSystem {
  return value === 'metric' ? 'metric' : 'aviation';
}

function parseTheme(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function parseProvider(value: unknown): ProviderId | null {
  return value === 'opensky' ? 'opensky' : null;
}

/** Validate and normalize an already-parsed workspace object. */
export function parseWorkspace(value: unknown): Workspace {
  if (!isRecord(value)) return { ...DEFAULT_WORKSPACE };

  const direction = normalizeDirectionalSelection(value.direction);
  // View mode is valid without a direction: the user may be between the origin
  // click and the bearing click, or may have just cleared the cone.
  const mode: SelectionMode =
    value.mode === 'direction' ? 'direction' : 'perimeter';

  return {
    perimeter: parseBoundingBox(value.perimeter),
    mode,
    direction,
    units: parseUnits(value.units),
    theme: parseTheme(value.theme),
    autoRefreshMs:
      value.autoRefreshMs === undefined
        ? DEFAULT_WORKSPACE.autoRefreshMs
        : clampRefreshMs(value.autoRefreshMs),
    providerId: parseProvider(value.providerId),
  };
}

/** Validate a raw workspace JSON string; corrupt/unknown versions reset. */
export function parseWorkspaceJson(raw: string | null): Workspace {
  if (!raw) return { ...DEFAULT_WORKSPACE };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...DEFAULT_WORKSPACE };
    if (
      parsed.version !== undefined &&
      parsed.version !== WORKSPACE_VERSION
    ) {
      return { ...DEFAULT_WORKSPACE };
    }
    return parseWorkspace(parsed);
  } catch {
    return { ...DEFAULT_WORKSPACE };
  }
}

/** Read the refresh interval from the legacy settings key. */
export function migrateLegacySettings(raw: string | null): Workspace {
  const legacy = parseSettingsJson(raw);
  return { ...DEFAULT_WORKSPACE, autoRefreshMs: legacy.autoRefreshMs };
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadWorkspace(
  storage: Storage | null = getStorage(),
): Workspace {
  if (!storage) return { ...DEFAULT_WORKSPACE };
  try {
    const stored = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (stored !== null) return parseWorkspaceJson(stored);

    const legacy = storage.getItem(SETTINGS_STORAGE_KEY);
    return legacy === null
      ? { ...DEFAULT_WORKSPACE }
      : migrateLegacySettings(legacy);
  } catch {
    return { ...DEFAULT_WORKSPACE };
  }
}

/** Persist a normalized workspace, adding the version envelope. */
export function saveWorkspace(
  workspace: Workspace,
  storage: Storage | null = getStorage(),
): boolean {
  if (!storage) return false;
  try {
    const stored: StoredWorkspace = {
      version: WORKSPACE_VERSION,
      ...parseWorkspace(workspace),
    };
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}
