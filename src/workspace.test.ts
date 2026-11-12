import { describe, expect, it } from 'vitest';
import { MIN_REFRESH_MS, config } from './config';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
} from './settings';
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_STORAGE_KEY,
  WORKSPACE_VERSION,
  loadWorkspace,
  migrateLegacySettings,
  parseWorkspace,
  parseWorkspaceJson,
  saveWorkspace,
} from './workspace';

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const throwingStorage: Storage = {
  get length() {
    return 0;
  },
  clear() {},
  getItem() {
    throw new Error('storage unavailable');
  },
  key() {
    return null;
  },
  removeItem() {},
  setItem() {
    throw new Error('storage unavailable');
  },
};

describe('DEFAULT_WORKSPACE', () => {
  it('starts with no area and the configured refresh interval', () => {
    expect(DEFAULT_WORKSPACE).toEqual({
      perimeter: null,
      mode: 'perimeter',
      direction: null,
      units: 'aviation',
      theme: 'system',
      autoRefreshMs: DEFAULT_SETTINGS.autoRefreshMs,
      providerId: null,
    });
    expect(config.defaultRefreshMs).toBe(DEFAULT_WORKSPACE.autoRefreshMs);
  });
});

describe('parseWorkspace', () => {
  it('resets non-object input', () => {
    for (const value of [null, undefined, 42, 'workspace', []]) {
      expect(parseWorkspace(value)).toEqual(DEFAULT_WORKSPACE);
    }
  });

  it('parses a full workspace and normalizes the perimeter', () => {
    expect(
      parseWorkspace({
        perimeter: { lamin: 52, lamax: 51, lomin: 1, lomax: -1 },
        mode: 'perimeter',
        direction: null,
        units: 'metric',
        theme: 'dark',
        autoRefreshMs: 60_000,
        providerId: 'opensky',
      }),
    ).toEqual({
      perimeter: { lamin: 51, lamax: 52, lomin: -1, lomax: 1 },
      mode: 'perimeter',
      direction: null,
      units: 'metric',
      theme: 'dark',
      autoRefreshMs: 60_000,
      providerId: 'opensky',
    });
  });

  it('rejects invalid or degenerate perimeters', () => {
    for (const perimeter of [
      null,
      {},
      { lamin: 51, lamax: 51, lomin: 0, lomax: 1 },
      { lamin: 51, lamax: 52, lomin: 0, lomax: 0 },
      { lamin: -91, lamax: 51, lomin: 0, lomax: 1 },
      { lamin: 51, lamax: 52, lomin: -181, lomax: 0 },
      { lamin: '51', lamax: 52, lomin: 0, lomax: 1 },
    ]) {
      expect(parseWorkspace({ perimeter }).perimeter).toBeNull();
    }
  });

  it('parses and clamps a directional selection', () => {
    const parsed = parseWorkspace({
      mode: 'direction',
      direction: {
        origin: { latitude: 51.5, longitude: -0.1 },
        bearingDeg: 725,
        angleDeg: 500,
        visibilityKm: 900,
      },
    });

    expect(parsed.mode).toBe('direction');
    expect(parsed.direction).toEqual({
      origin: { latitude: 51.5, longitude: -0.1 },
      bearingDeg: 5,
      angleDeg: 180,
      visibilityKm: 500,
    });
  });

  it('falls back to perimeter when direction is invalid', () => {
    for (const direction of [
      null,
      {},
      { origin: { latitude: 91, longitude: 0 }, bearingDeg: 10 },
      { origin: { latitude: 51, longitude: 0 } },
    ]) {
      const parsed = parseWorkspace({ mode: 'direction', direction });
      expect(parsed.mode).toBe('perimeter');
      expect(parsed.direction).toBeNull();
    }
  });

  it('falls back for invalid units, theme, and provider', () => {
    const parsed = parseWorkspace({
      units: 'nautical',
      theme: 'sepia',
      providerId: 'adsb.lol',
    });

    expect(parsed.units).toBe('aviation');
    expect(parsed.theme).toBe('system');
    expect(parsed.providerId).toBeNull();
  });

  it('clamps the refresh interval', () => {
    expect(parseWorkspace({ autoRefreshMs: 1 }).autoRefreshMs).toBe(
      MIN_REFRESH_MS,
    );
    expect(
      parseWorkspace({ autoRefreshMs: 'invalid' }).autoRefreshMs,
    ).toBe(DEFAULT_WORKSPACE.autoRefreshMs);
  });
});

describe('parseWorkspaceJson', () => {
  it('resets missing, corrupt, non-object, or unknown-version data', () => {
    for (const raw of [
      null,
      '',
      '{',
      'null',
      '[]',
      '42',
      JSON.stringify({ version: 2, units: 'metric' }),
    ]) {
      expect(parseWorkspaceJson(raw)).toEqual(DEFAULT_WORKSPACE);
    }
  });

  it('parses a versioned stored workspace', () => {
    expect(
      parseWorkspaceJson(
        JSON.stringify({
          version: WORKSPACE_VERSION,
          units: 'metric',
          theme: 'light',
          autoRefreshMs: 60_000,
        }),
      ),
    ).toEqual({
      ...DEFAULT_WORKSPACE,
      units: 'metric',
      theme: 'light',
      autoRefreshMs: 60_000,
    });
  });
});

describe('migration', () => {
  it('imports the refresh interval from the legacy settings key', () => {
    expect(
      migrateLegacySettings(JSON.stringify({ autoRefreshMs: 120_000 })),
    ).toEqual({
      ...DEFAULT_WORKSPACE,
      autoRefreshMs: 120_000,
    });
  });

  it('uses defaults for corrupt legacy settings', () => {
    expect(migrateLegacySettings('{bad')).toEqual(DEFAULT_WORKSPACE);
  });

  it('prefers the workspace key and falls back to legacy', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ autoRefreshMs: 60_000 }),
    );
    expect(loadWorkspace(storage).autoRefreshMs).toBe(60_000);

    storage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: 1, autoRefreshMs: 120_000 }),
    );
    expect(loadWorkspace(storage).autoRefreshMs).toBe(120_000);
  });
});

describe('saveWorkspace / loadWorkspace', () => {
  it('writes a normalized, versioned envelope', () => {
    const storage = new MemoryStorage();

    expect(
      saveWorkspace(
        {
          ...DEFAULT_WORKSPACE,
          perimeter: { lamin: 52, lamax: 51, lomin: 1, lomax: -1 },
          units: 'metric',
        },
        storage,
      ),
    ).toBe(true);

    expect(JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY)!)).toEqual({
      version: 1,
      ...DEFAULT_WORKSPACE,
      perimeter: { lamin: 51, lamax: 52, lomin: -1, lomax: 1 },
      units: 'metric',
    });
  });

  it('round-trips through the workspace key', () => {
    const storage = new MemoryStorage();
    const workspace = {
      ...DEFAULT_WORKSPACE,
      perimeter: { lamin: 50, lamax: 51, lomin: -1, lomax: 0 },
      direction: {
        origin: { latitude: 51, longitude: 0 },
        bearingDeg: 90,
        angleDeg: 60,
        visibilityKm: 100,
      },
      mode: 'direction' as const,
      units: 'metric' as const,
      theme: 'dark' as const,
      providerId: 'opensky' as const,
    };

    saveWorkspace(workspace, storage);

    expect(loadWorkspace(storage)).toEqual(workspace);
  });

  it('falls back without storage and survives access failures', () => {
    expect(loadWorkspace(null)).toEqual(DEFAULT_WORKSPACE);
    expect(saveWorkspace(DEFAULT_WORKSPACE, null)).toBe(false);
    expect(loadWorkspace(throwingStorage)).toEqual(DEFAULT_WORKSPACE);
    expect(saveWorkspace(DEFAULT_WORKSPACE, throwingStorage)).toBe(false);
  });

  it('does not modify the legacy key', () => {
    const storage = new MemoryStorage();
    const legacy = JSON.stringify({ autoRefreshMs: 60_000 });
    storage.setItem(SETTINGS_STORAGE_KEY, legacy);

    saveWorkspace(DEFAULT_WORKSPACE, storage);

    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(legacy);
  });
});
