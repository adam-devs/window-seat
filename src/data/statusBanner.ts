import type { FlightStatus } from './flightStatus';

/**
 * Presentation model for the non-destructive status banner.
 *
 * The banner never replaces the flight list or the selected flight card; it
 * only explains why the data may be old or why a refresh failed. The model is
 * pure so its priority and copy can be tested without rendering React.
 */
export type StatusBannerTone = 'info' | 'warning' | 'error';

export interface StatusBannerInput {
  status: FlightStatus;
  /** False while the browser reports no network connection. */
  online: boolean;
  /** True when a snapshot (even an empty one) exists for the active area. */
  hasData: boolean;
  error: string | null;
  dataAgeMs: number | null;
  /** Epoch ms of the next scheduled retry, when one is known. */
  nextRetryAt: number | null;
  /** Provider name used in rate-limit copy. */
  providerName?: string;
}

export interface StatusBannerModel {
  tone: StatusBannerTone;
  title: string;
  detail: string | null;
  /** Whether a manual "Retry now" action can help in this state. */
  showRefresh: boolean;
}

/** Human-readable age such as "just now", "42s ago", or "3m ago". */
export function formatDataAge(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'unknown';

  const seconds = Math.floor(ms / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

/** Local wall-clock time as HH:MM, or null when no timestamp is available. */
export function formatClockTime(epochMs: number | null): string | null {
  if (epochMs === null || !Number.isFinite(epochMs)) return null;
  const date = new Date(epochMs);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Resolve the banner to show, if any.
 *
 * Priority: offline → rate-limited → error → stale. Idle, first-load, and
 * refresh states show no banner because the normal header already communicates
 * them.
 */
export function deriveStatusBanner(
  input: StatusBannerInput,
): StatusBannerModel | null {
  if (input.status === 'idle') return null;

  if (!input.online) {
    return {
      tone: 'error',
      title: "You're offline",
      detail: input.hasData
        ? `Showing the last data received ${formatDataAge(input.dataAgeMs)}. Reconnecting automatically.`
        : 'Connect to the internet to load nearby aircraft.',
      showRefresh: false,
    };
  }

  if (input.status === 'rate-limited') {
    const retryAt = formatClockTime(input.nextRetryAt);
    const provider = input.providerName ?? 'Flight data provider';
    return {
      tone: 'warning',
      title: `${provider} rate limit reached`,
      detail: retryAt
        ? `Showing the last data received. Automatic refresh resumes around ${retryAt}.`
        : 'Showing the last data received. Automatic refresh is paused until the limit resets.',
      showRefresh: false,
    };
  }

  if (input.status === 'error') {
    const message = input.error ?? 'The flight data provider is unavailable.';
    return {
      tone: 'error',
      title: "Couldn't update flight data",
      detail: input.hasData
        ? `${message} Showing the last data received.`
        : message,
      showRefresh: true,
    };
  }

  if (input.status === 'stale') {
    return {
      tone: 'warning',
      title: 'Flight data is out of date',
      detail: `Last update ${formatDataAge(input.dataAgeMs)}. Retrying automatically.`,
      showRefresh: true,
    };
  }

  return null;
}
