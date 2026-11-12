// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReducedMotion } from './useReducedMotion';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useReducedMotion', () => {
  it('reads the preference and follows changes', () => {
    let matches = false;
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
      media: '(prefers-reduced-motion: reduce)',
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

    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => {
      matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(result.current).toBe(true);

    unmount();
    expect(removeEventListener).toHaveBeenCalled();
  });

  it('defaults to false when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});
