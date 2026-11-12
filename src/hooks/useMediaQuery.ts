import { useEffect, useState } from 'react';

/** Breakpoint shared by the CSS layout and the mobile-only sheet behavior. */
export const MOBILE_LAYOUT_QUERY = '(max-width: 700px)';

type MediaQuery = {
  matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

function getMediaQuery(query: string): MediaQuery | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia(query);
}

/**
 * Tracks a CSS media query from JavaScript.
 *
 * Rendering-only differences stay in CSS; this hook is for behavior that must
 * not exist on desktop, such as the mobile-only panel collapse control.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => getMediaQuery(query)?.matches ?? false,
  );

  useEffect(() => {
    const mediaQuery = getMediaQuery(query);
    if (!mediaQuery) return;

    const update = (): void => setMatches(mediaQuery.matches);
    update();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener?.('change', update);
    }
    mediaQuery.addListener?.(update);
    return () => mediaQuery.removeListener?.(update);
  }, [query]);

  return matches;
}
