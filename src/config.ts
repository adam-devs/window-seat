/**
 * Browser-safe application config.
 *
 * Only `VITE_`-prefixed variables are exposed to the client by Vite. OpenSky
 * credentials must NOT be added here: they are read by the Vite dev server from
 * `.env.local` and injected into proxied requests (see `vite.config.ts`).
 */

export const MIN_REFRESH_MS = 15_000;
export const MAX_REFRESH_MS = 300_000;

/** OpenSky standard account quota, in credits per day. */
export const DAILY_BUDGET = 4_000;

/** Keep a slice of the daily budget for manual refreshes and retries. */
export const BUDGET_RESERVE_RATIO = 0.1;

/** Stop auto-refresh once this share of the budget has been spent. */
export const BUDGET_PAUSE_RATIO = 0.9;

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface AppConfig {
  providerId: 'opensky';
  providerName: string;
  /** Path prefix of the Vite dev proxy that adds OAuth2 credentials. */
  proxyBaseUrl: string;
  defaultRefreshMs: number;
  minRefreshMs: number;
  maxRefreshMs: number;
  /** Manual refresh cannot be triggered more often than this. */
  minManualRefreshMs: number;
  /** Data older than this is considered stale (3 missed defaults). */
  staleAfterMs: number;
  requestTimeoutMs: number;
  dailyBudget: number;
  budgetReserveRatio: number;
  budgetPauseRatio: number;
}

export const config: AppConfig = {
  providerId: 'opensky',
  providerName: 'OpenSky Network',
  proxyBaseUrl: import.meta.env.VITE_OPENSKY_PROXY_URL?.trim() || '/opensky',
  defaultRefreshMs: clamp(
    readNumber(import.meta.env.VITE_DEFAULT_REFRESH_MS, 30_000),
    MIN_REFRESH_MS,
    MAX_REFRESH_MS,
  ),
  minRefreshMs: MIN_REFRESH_MS,
  maxRefreshMs: MAX_REFRESH_MS,
  minManualRefreshMs: 10_000,
  staleAfterMs: 90_000,
  requestTimeoutMs: 15_000,
  dailyBudget: DAILY_BUDGET,
  budgetReserveRatio: BUDGET_RESERVE_RATIO,
  budgetPauseRatio: BUDGET_PAUSE_RATIO,
};

/** Requests per 24 h at a fixed interval. */
export function requestsPerDay(intervalMs: number): number {
  return Math.floor(86_400_000 / Math.max(1, intervalMs));
}
