import { describe, expect, it } from 'vitest';
import { MAX_REFRESH_MS, MIN_REFRESH_MS, config } from './config';
import {
  DEFAULT_SETTINGS,
  REFRESH_OPTIONS_MS,
  SETTINGS_STORAGE_KEY,
  clampRefreshMs,
  formatInterval,
  loadSettings,
  parseSettings,
  parseSettingsJson,
  saveSettings,
} from './settings';

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

describe('clampRefreshMs', () => {
  it('keeps supported numeric intervals', () => {
    expect(clampRefreshMs(MIN_REFRESH_MS)).toBe(MIN_REFRESH_MS);
    expect(clampRefreshMs(30_000)).toBe(30_000);
    expect(clampRefreshMs(60_000)).toBe(60_000);
    expect(clampRefreshMs(MAX_REFRESH_MS)).toBe(MAX_REFRESH_MS);
  });

  it('accepts numeric strings', () => {
    expect(clampRefreshMs('60000')).toBe(60_000);
    expect(clampRefreshMs(' 120000 ')).toBe(120_000);
  });

  it('clamps values outside the supported range', () => {
    expect(clampRefreshMs(1_000)).toBe(MIN_REFRESH_MS);
    expect(clampRefreshMs(0)).toBe(MIN_REFRESH_MS);
    expect(clampRefreshMs(-5)).toBe(MIN_REFRESH_MS);
    expect(clampRefreshMs(999_999)).toBe(MAX_REFRESH_MS);
  });

  it('rounds fractional intervals', () => {
    expect(clampRefreshMs(30_000.4)).toBe(30_000);
    expect(clampRefreshMs('45000.6')).toBe(45_001);
  });

  it('falls back to the default for missing or invalid values', () => {
    for (const value of [
      undefined,
      null,
      '',
      '   ',
      'not-a-number',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      false,
      true,
      {},
      [],
    ]) {
      expect(clampRefreshMs(value)).toBe(DEFAULT_SETTINGS.autoRefreshMs);
    }
  });
});

describe('parseSettings', () => {
  it('resets non-object input', () => {
    for (const value of [null, undefined, 42, '60 s', true, []]) {
      expect(parseSettings(value)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('uses the default for a missing field', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ unrelated: 1 })).toEqual(DEFAULT_SETTINGS);
  });

  it('parses and clamps a persisted interval', () => {
    expect(parseSettings({ autoRefreshMs: 60_000 })).toEqual({
      autoRefreshMs: 60_000,
    });
    expect(parseSettings({ autoRefreshMs: '120000' })).toEqual({
      autoRefreshMs: 120_000,
    });
    expect(parseSettings({ autoRefreshMs: 1_000 })).toEqual({
      autoRefreshMs: MIN_REFRESH_MS,
    });
    expect(parseSettings({ autoRefreshMs: null })).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores unknown fields', () => {
    expect(
      parseSettings({ autoRefreshMs: 60_000, theme: 'dark' }),
    ).toEqual({ autoRefreshMs: 60_000 });
  });
});

describe('parseSettingsJson', () => {
  it('resets missing, corrupt, or primitive JSON', () => {
    for (const raw of [
      null,
      '',
      '{',
      'null',
      '42',
      '"60 s"',
      'true',
      '[]',
    ]) {
      expect(parseSettingsJson(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('parses a valid stored object', () => {
    expect(
      parseSettingsJson(JSON.stringify({ autoRefreshMs: 300_000 })),
    ).toEqual({ autoRefreshMs: 300_000 });
  });
});

describe('loadSettings / saveSettings', () => {
  it('uses the versioned storage key', () => {
    expect(SETTINGS_STORAGE_KEY).toBe('window-seat:settings:v1');
  });

  it('round-trips normalized settings', () => {
    const storage = new MemoryStorage();

    expect(saveSettings({ autoRefreshMs: 60_000 }, storage)).toBe(true);
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({ autoRefreshMs: 60_000 }),
    );
    expect(loadSettings(storage)).toEqual({ autoRefreshMs: 60_000 });
  });

  it('persists clamped values rather than raw input', () => {
    const storage = new MemoryStorage();

    saveSettings({ autoRefreshMs: 1_000 }, storage);

    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({
      autoRefreshMs: MIN_REFRESH_MS,
    });
  });

  it('falls back to defaults without storage', () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, null)).toBe(false);
  });

  it('survives storage access failures', () => {
    expect(loadSettings(throwingStorage)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, throwingStorage)).toBe(false);
  });

  it('falls back to defaults when stored JSON is corrupt', () => {
    const storage = new MemoryStorage();
    storage.setItem(SETTINGS_STORAGE_KEY, '{not json');

    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadSettings(new MemoryStorage())).toEqual(DEFAULT_SETTINGS);
  });
});

describe('settings constants', () => {
  it('offers the documented refresh options', () => {
    expect(REFRESH_OPTIONS_MS).toEqual([
      15_000,
      30_000,
      60_000,
      120_000,
      300_000,
    ]);
  });

  it('defaults to the configured cadence and no secrets', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      autoRefreshMs: config.defaultRefreshMs,
    });
  });

  it('formats intervals for the settings UI', () => {
    expect(formatInterval(15_000)).toBe('15 s');
    expect(formatInterval(30_000)).toBe('30 s');
    expect(formatInterval(60_000)).toBe('1 min');
    expect(formatInterval(90_000)).toBe('1.5 min');
    expect(formatInterval(120_000)).toBe('2 min');
    expect(formatInterval(300_000)).toBe('5 min');
  });
});
