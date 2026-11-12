// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_STORAGE_KEY } from '../settings';
import {
  DEFAULT_WORKSPACE,
  WORKSPACE_STORAGE_KEY,
} from '../workspace';
import { useWorkspace } from './useWorkspace';

function stored(): any {
  const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

function dispatchStorage(newValue: string | null, key = WORKSPACE_STORAGE_KEY) {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useWorkspace', () => {
  it('loads defaults and migrates the legacy refresh interval', () => {
    const empty = renderHook(() => useWorkspace());
    expect(empty.result.current.workspace).toEqual(DEFAULT_WORKSPACE);
    cleanup();
    localStorage.clear();

    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ autoRefreshMs: 60_000 }),
    );
    const migrated = renderHook(() => useWorkspace());
    expect(migrated.result.current.workspace).toEqual({
      ...DEFAULT_WORKSPACE,
      autoRefreshMs: 60_000,
    });
    // The first read establishes the new versioned store.
    expect(stored()).toEqual({
      version: 1,
      ...DEFAULT_WORKSPACE,
      autoRefreshMs: 60_000,
    });
  });

  it('persists the refresh interval in the workspace envelope', () => {
    const { result } = renderHook(() => useWorkspace());

    act(() => {
      result.current.setAutoRefreshMs(60_000);
    });

    expect(result.current.workspace.autoRefreshMs).toBe(60_000);
    expect(stored()).toEqual({
      version: 1,
      ...DEFAULT_WORKSPACE,
      autoRefreshMs: 60_000,
    });
  });

  it('persists a perimeter and uses the latest state for rapid updates', () => {
    const { result } = renderHook(() => useWorkspace());

    act(() => {
      result.current.setPerimeter({
        lamin: 50,
        lomin: -1,
        lamax: 51,
        lomax: 0,
      });
      result.current.setTheme('light');
    });

    expect(result.current.workspace.perimeter).toEqual({
      lamin: 50,
      lomin: -1,
      lamax: 51,
      lomax: 0,
    });
    expect(result.current.workspace.theme).toBe('light');
    expect(stored().perimeter).toEqual({
      lamin: 50,
      lomin: -1,
      lamax: 51,
      lomax: 0,
    });
    expect(stored().theme).toBe('light');
  });

  it('switches to View when a direction is set and keeps the mode when cleared', () => {
    const { result } = renderHook(() => useWorkspace());
    const direction = {
      origin: { latitude: 51, longitude: 0 },
      bearingDeg: 90,
      angleDeg: 60,
      visibilityKm: 100,
    };

    act(() => {
      result.current.setDirection(direction);
    });
    expect(result.current.workspace.mode).toBe('direction');
    expect(result.current.workspace.direction).toEqual(direction);
    expect(stored().mode).toBe('direction');

    act(() => {
      result.current.setDirection(null);
    });
    expect(result.current.workspace.mode).toBe('direction');
    expect(result.current.workspace.direction).toBeNull();
  });

  it('persists units, theme, and provider', () => {
    const { result } = renderHook(() => useWorkspace());

    act(() => {
      result.current.setUnits('metric');
      result.current.setTheme('dark');
      result.current.setProviderId('opensky');
    });

    expect(result.current.workspace.units).toBe('metric');
    expect(result.current.workspace.theme).toBe('dark');
    expect(result.current.workspace.providerId).toBe('opensky');
    expect(stored()).toMatchObject({
      units: 'metric',
      theme: 'dark',
      providerId: 'opensky',
    });
  });

  it('resets the workspace and persists defaults', () => {
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        units: 'metric',
        theme: 'dark',
        autoRefreshMs: 120_000,
      }),
    );
    const { result } = renderHook(() => useWorkspace());

    act(() => {
      result.current.resetWorkspace();
    });

    expect(result.current.workspace).toEqual(DEFAULT_WORKSPACE);
    expect(stored()).toEqual({ version: 1, ...DEFAULT_WORKSPACE });
  });

  it('adopts workspace changes from another tab', () => {
    const { result } = renderHook(() => useWorkspace());

    dispatchStorage(
      JSON.stringify({
        version: 1,
        units: 'metric',
        theme: 'light',
        autoRefreshMs: 60_000,
      }),
    );

    expect(result.current.workspace.units).toBe('metric');
    expect(result.current.workspace.theme).toBe('light');
    expect(result.current.workspace.autoRefreshMs).toBe(60_000);
  });

  it('resets when another tab removes or corrupts the workspace', () => {
    const { result } = renderHook(() => useWorkspace());
    act(() => {
      result.current.setUnits('metric');
    });

    dispatchStorage(null);
    expect(result.current.workspace).toEqual(DEFAULT_WORKSPACE);

    act(() => {
      result.current.setUnits('metric');
    });
    dispatchStorage('{broken');
    expect(result.current.workspace).toEqual(DEFAULT_WORKSPACE);
  });

  it('ignores storage events for other keys', () => {
    const { result } = renderHook(() => useWorkspace());

    dispatchStorage(
      JSON.stringify({ version: 1, units: 'metric' }),
      'window-seat:other',
    );

    expect(result.current.workspace).toEqual(DEFAULT_WORKSPACE);
  });

  it('keeps in-memory state when persistence fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const { result } = renderHook(() => useWorkspace());

    act(() => {
      result.current.setUnits('metric');
    });

    expect(result.current.workspace.units).toBe('metric');
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();
  });
});
