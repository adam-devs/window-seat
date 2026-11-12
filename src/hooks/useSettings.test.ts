// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_REFRESH_MS, MIN_REFRESH_MS } from '../config';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
} from '../settings';
import { useSettings } from './useSettings';

function stored(): unknown {
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function dispatchStorage(newValue: string | null, key = SETTINGS_STORAGE_KEY) {
  act(() => {
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue }),
    );
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useSettings', () => {
  it('loads persisted settings on mount', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ autoRefreshMs: 120_000 }),
    );

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings.autoRefreshMs).toBe(120_000);
  });

  it('falls back to defaults when stored settings are corrupt', () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{not json');

    const { result } = renderHook(() => useSettings());

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('persists a new interval immediately', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.setAutoRefreshMs(60_000);
    });

    expect(result.current.settings.autoRefreshMs).toBe(60_000);
    expect(stored()).toEqual({ autoRefreshMs: 60_000 });
  });

  it('clamps intervals to the supported range before persisting', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.setAutoRefreshMs(1_000);
    });
    expect(result.current.settings.autoRefreshMs).toBe(MIN_REFRESH_MS);
    expect(stored()).toEqual({ autoRefreshMs: MIN_REFRESH_MS });

    act(() => {
      result.current.setAutoRefreshMs(999_999);
    });
    expect(result.current.settings.autoRefreshMs).toBe(MAX_REFRESH_MS);
    expect(stored()).toEqual({ autoRefreshMs: MAX_REFRESH_MS });
  });

  it('uses the previous value for rapid successive updates', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.setAutoRefreshMs(60_000);
      result.current.setAutoRefreshMs(120_000);
    });

    expect(result.current.settings.autoRefreshMs).toBe(120_000);
    expect(stored()).toEqual({ autoRefreshMs: 120_000 });
  });

  it('resets to the default interval and persists it', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ autoRefreshMs: 300_000 }),
    );
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.resetSettings();
    });

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
    expect(stored()).toEqual(DEFAULT_SETTINGS);
  });

  it('adopts settings written by another tab', () => {
    const { result } = renderHook(() => useSettings());

    dispatchStorage(JSON.stringify({ autoRefreshMs: 60_000 }));
    expect(result.current.settings.autoRefreshMs).toBe(60_000);

    dispatchStorage(JSON.stringify({ autoRefreshMs: '180000' }));
    expect(result.current.settings.autoRefreshMs).toBe(180_000);
  });

  it('resets when another tab removes or corrupts the stored value', () => {
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.setAutoRefreshMs(60_000);
    });

    dispatchStorage(null);
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);

    act(() => {
      result.current.setAutoRefreshMs(120_000);
    });
    dispatchStorage('{broken');
    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores storage events for other keys', () => {
    const { result } = renderHook(() => useSettings());

    dispatchStorage(
      JSON.stringify({ autoRefreshMs: 60_000 }),
      'window-seat:other',
    );

    expect(result.current.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps in-memory state when persistence fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const { result } = renderHook(() => useSettings());

    act(() => {
      result.current.setAutoRefreshMs(60_000);
    });

    expect(result.current.settings.autoRefreshMs).toBe(60_000);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });
});
