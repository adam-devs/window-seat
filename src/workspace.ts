import type { BoundingBox, SelectionMode } from './types';
import type { ProviderId } from './data/types';
import {
  normalizeDirectionalSelection,
  type DirectionalSelection,
} from './data/directionalView';
import { parseBoundingBox } from './data/geometry';
import {
  parseSavedSelections,
  type SavedSelection,
} from './data/savedSelections';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  clampRefreshMs,
  parseSettingsJson,
} from './settings';

export type { DirectionalSelection } from './data/directionalView';
export type {
  SavedDirection,
  SavedPerimeter,
  SavedSelection,
  SavedSelectionKind,
} from './data/savedSelections';

/**
 * Versioned local workspace.
 *
 * `window-seat:workspace:v2` adds the saved perimeter/View library. Reads fall
 * back to the v1 workspace key, then the legacy refresh-only settings key, so
 * existing installs migrate on first load and the hook writes the v2 envelope.
 */

export const WORKSPACE_STORAGE_KEY = 'window-seat:workspace:v2';
export const LEGACY_WORKSPACE_STORAGE_KEY = 'window-seat:workspace:v1';
export const WORKSPACE_VERSION = 2;

export type UnitSystem = 'aviation' | 'metric';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface Workspace {
  perimeter: BoundingBox | null;
  mode: SelectionMode;
  direction: DirectionalSelection | null;
  /** Named perimeters and directional views, newest last on save. */
  savedSelections: SavedSelection[];
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
  savedSelections: [],
  units: 'aviation',
  theme: 'system',
  autoRefreshMs: DEFAULT_SETTINGS.autoRefreshMs,
  providerId: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    savedSelections: parseSavedSelections(value.savedSelections),
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
    // v1 is the previous envelope; parsing it adds an empty saved library.
    const supported =
      parsed.version === undefined ||
      parsed.version === 1 ||
      parsed.version === WORKSPACE_VERSION;
    if (!supported) return { ...DEFAULT_WORKSPACE };
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

    // Migrate the previous workspace envelope before falling back to the
    // refresh-only settings key.
    const previous = storage.getItem(LEGACY_WORKSPACE_STORAGE_KEY);
    if (previous !== null) return parseWorkspaceJson(previous);

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
