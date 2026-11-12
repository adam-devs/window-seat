import { useEffect, useState } from 'react';

function readOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
}

/**
 * Track the browser's network status.
 *
 * The browser only reports link-level connectivity, so this is a hint rather
 * than proof that OpenSky is reachable; request failures remain the source of
 * truth for the error state.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(readOnline);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = (): void => setOnline(readOnline());
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    // Re-sync in case the status changed between render and effect.
    update();

    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
