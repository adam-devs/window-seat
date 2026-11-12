// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useMediaQuery', () => {
  it('reads the query and follows changes', () => {
    let matches = true;
    const listeners = new Set<() => void>();
    const removeEventListener = vi.fn(
      (_type: 'change', listener: () => void) => {
        listeners.delete(listener);
      },
    );
    const mediaQuery = {
      get matches() {
        return matches;
      },
      media: '(max-width: 700px)',
      addEventListener: (_type: 'change', listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener,
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn(() => mediaQuery),
    });

    const { result, unmount } = renderHook(() =>
      useMediaQuery('(max-width: 700px)'),
    );
    expect(result.current).toBe(true);

    act(() => {
      matches = false;
      listeners.forEach((listener) => listener());
    });
    expect(result.current).toBe(false);

    unmount();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it('defaults to false when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useMediaQuery('(max-width: 700px)'));
    expect(result.current).toBe(false);
  });
});
