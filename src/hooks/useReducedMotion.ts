import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

type MotionMediaQuery = {
  matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

function getMediaQuery(): MotionMediaQuery | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY);
}

/** Tracks the OS reduced-motion preference and updates when it changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => getMediaQuery()?.matches ?? false,
  );

  useEffect(() => {
    const query = getMediaQuery();
    if (!query) return;

    const update = (): void => setReduced(query.matches);
    update();

    if (query.addEventListener) {
      query.addEventListener('change', update);
      return () => query.removeEventListener?.('change', update);
    }
    query.addListener?.(update);
    return () => query.removeListener?.(update);
  }, []);

  return reduced;
}
