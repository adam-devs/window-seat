import { useState, useEffect, useCallback, useRef } from 'react';
import type { StateVector, BoundingBox } from '../types';
import { fetchFlights } from '../utils/opensky';
import { isAbortError } from '../data/errors';
import {
  createRequestCoordinator,
  type RequestCoordinator,
} from '../data/requestCoordinator';

const REFRESH_INTERVAL_MS = 15_000; // OpenSky free tier: max 1 req / 10s, we use 15s to be safe

interface UseFlightsResult {
  flights: StateVector[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

function bboxKey(bbox: BoundingBox): string {
  return `${bbox.lamin},${bbox.lomin},${bbox.lamax},${bbox.lomax}`;
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function useFlights(bbox: BoundingBox | null): UseFlightsResult {
  const [flights, setFlights] = useState<StateVector[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  /** Incremented by manual refresh; restarts the polling effect immediately. */
  const [refreshNonce, setRefreshNonce] = useState(0);

  const bboxRef = useRef<BoundingBox | null>(bbox);
  bboxRef.current = bbox;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const coordinatorRef = useRef<RequestCoordinator<StateVector[]> | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createRequestCoordinator<StateVector[]>();
  }

  const load = useCallback(async (box: BoundingBox) => {
    const coordinator = coordinatorRef.current!;
    const key = bboxKey(box);
    setLoading(true);
    setError(null);

    try {
      const data = await coordinator.run({
        key,
        task: (signal) => fetchFlights(box, signal),
      });

      // Ignore a response that belonged to a previous area or an unmounted hook.
      if (!mountedRef.current || !bboxRef.current) return;
      if (bboxKey(bboxRef.current) !== key) return;

      setFlights(data);
      setLastUpdated(new Date());
    } catch (e) {
      // Area changes and unmounts abort the request; do not surface those.
      if (isAbortError(e)) return;
      if (!mountedRef.current || !bboxRef.current) return;
      if (bboxKey(bboxRef.current) !== key) return;
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      // A superseded request settles before its replacement starts, so only the
      // last one clears the loading state.
      if (mountedRef.current && coordinator.isIdle) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const coordinator = coordinatorRef.current!;
    const doc = typeof document === 'undefined' ? null : document;

    if (!bbox) {
      coordinator.cancel();
      setFlights([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const activeBox = bbox;

    function clearTimer(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function schedule(): void {
      clearTimer();
      // Hidden tabs do not poll. The next visible transition refreshes once.
      if (cancelled || isDocumentHidden()) return;

      timer = setTimeout(() => {
        timer = null;
        void cycle();
      }, REFRESH_INTERVAL_MS);
    }

    async function cycle(): Promise<void> {
      if (cancelled) return;
      await load(activeBox);
      if (!cancelled) schedule();
    }

    function handleVisibilityChange(): void {
      if (isDocumentHidden()) {
        clearTimer();
        return;
      }

      // Back from a hidden tab: refresh immediately, then resume the cadence.
      clearTimer();
      void cycle();
    }

    doc?.addEventListener('visibilitychange', handleVisibilityChange);

    // Do not spend a request while the tab starts out hidden.
    if (!isDocumentHidden()) void cycle();

    return () => {
      // Abort the in-flight request on area change, refresh, or unmount.
      cancelled = true;
      clearTimer();
      doc?.removeEventListener('visibilitychange', handleVisibilityChange);
      coordinator.cancel();
    };
  }, [bbox, load, refreshNonce]);

  const refresh = useCallback(() => {
    if (!bbox) return;
    setRefreshNonce((value) => value + 1);
  }, [bbox]);

  return { flights, loading, error, lastUpdated, refresh };
}
