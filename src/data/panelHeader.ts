import type { FlightStatus } from './flightStatus';
import { formatDataAge } from './statusBanner';

/**
 * Header copy for the flight panel.
 *
 * The important distinction is first load versus background refresh: a first
 * load may say "Loading", but once data exists the last successful update is
 * shown as a relative age and the refresh is appended instead of replacing it.
 */
export interface PanelHeaderInput {
  hasArea: boolean;
  hasData: boolean;
  status: FlightStatus;
  /** Exact time of the last success; used for the tooltip and as a fallback. */
  lastUpdated: Date | null;
  /** Age of the current snapshot in ms, or null when there is no data. */
  dataAgeMs: number | null;
  /** Provider label shown under the subtitle. */
  providerName?: string | null;
}

export interface PanelHeaderModel {
  /** Complete subtitle text, e.g. "Updated 12s ago · Refreshing…". */
  text: string;
  /** "via OpenSky Network", or null when no provider label is available. */
  provider: string | null;
  /** Exact local HH:MM:SS for a title tooltip, or null. */
  exactTime: string | null;
  /** True only while the first snapshot is being fetched. */
  firstLoad: boolean;
  /** True while any request is in flight (first load or background). */
  busy: boolean;
  /** True when the subtitle includes a real last-updated age. */
  updated: boolean;
}

/** Deterministic local HH:MM:SS for the header tooltip. */
export function formatUpdatedTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function providerLabel(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed ? `via ${trimmed}` : null;
}

export function derivePanelHeader(
  input: PanelHeaderInput,
): PanelHeaderModel {
  const provider = providerLabel(input.providerName);

  if (!input.hasArea) {
    return {
      text: 'No area selected',
      provider,
      exactTime: null,
      firstLoad: false,
      busy: false,
      updated: false,
    };
  }

  const firstLoad = !input.hasData && input.status === 'loading';
  if (firstLoad) {
    return {
      text: 'Loading nearby flights…',
      provider,
      exactTime: null,
      firstLoad: true,
      busy: true,
      updated: false,
    };
  }

  if (!input.hasData || input.lastUpdated === null) {
    return {
      text: 'No data yet',
      provider,
      exactTime: null,
      firstLoad: false,
      busy: false,
      updated: false,
    };
  }

  const busy =
    input.status === 'refreshing' ||
    (input.status === 'loading' && input.lastUpdated !== null);
  const age = input.dataAgeMs === null
    ? `at ${formatUpdatedTime(input.lastUpdated)}`
    : formatDataAge(input.dataAgeMs);
  let text = `Updated ${age}`;

  if (input.status === 'error') {
    text += ' · Refresh failed';
  } else if (input.status === 'rate-limited') {
    text += ' · Rate limited';
  } else if (busy) {
    text += ' · Refreshing…';
  }

  return {
    text,
    provider,
    exactTime: formatUpdatedTime(input.lastUpdated),
    firstLoad: false,
    busy,
    updated: true,
  };
}
