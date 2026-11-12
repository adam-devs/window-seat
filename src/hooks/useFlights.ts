import { useState, useEffect, useCallback, useRef } from 'react';
import type { StateVector, BoundingBox } from '../types';
import { fetchFlights } from '../utils/opensky';

const REFRESH_INTERVAL_MS = 15_000; // OpenSky free tier: max 1 req / 10s, we use 15s to be safe

interface UseFlightsResult {
  flights: StateVector[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => void;
}

export function useFlights(bbox: BoundingBox | null): UseFlightsResult {
  const [flights, setFlights] = useState<StateVector[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (box: BoundingBox) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFlights(box);
      setFlights(data);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!bbox) {
      setFlights([]);
      return;
    }

    load(bbox);

    timerRef.current = setInterval(() => load(bbox), REFRESH_INTERVAL_MS);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [bbox, load]);

  const refresh = useCallback(() => {
    if (!bbox) return;
    if (timerRef.current) clearInterval(timerRef.current);
    load(bbox);
    timerRef.current = setInterval(() => load(bbox), REFRESH_INTERVAL_MS);
  }, [bbox, load]);

  return { flights, loading, error, lastUpdated, refresh };
}
