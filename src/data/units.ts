import type { UnitSystem } from '../workspace';
import { mToFeet, msToKnots } from '../utils/opensky';

/**
 * Display formatting for aviation and metric units.
 *
 * The internal model stays SI (metres, m/s); conversion happens only at the
 * presentation edge so filtering, sorting, and motion remain unit-independent.
 */

export function formatAltitude(
  metres: number | null,
  units: UnitSystem,
): string {
  if (metres === null) return '—';
  if (units === 'metric') return `${Math.round(metres).toLocaleString()} m`;
  return `${mToFeet(metres).toLocaleString()} ft`;
}

export function formatSpeed(
  metresPerSecond: number | null,
  units: UnitSystem,
): string {
  if (metresPerSecond === null) return '—';
  if (units === 'metric') {
    return `${Math.round(metresPerSecond * 3.6).toLocaleString()} km/h`;
  }
  return `${msToKnots(metresPerSecond)} kts`;
}

export function formatVerticalRate(
  metresPerSecond: number | null,
  units: UnitSystem,
): string {
  if (metresPerSecond === null) return '—';
  if (units === 'metric') {
    const sign = metresPerSecond >= 0 ? '+' : '';
    return `${sign}${metresPerSecond.toFixed(1)} m/s`;
  }
  const feetPerMinute = Math.round(metresPerSecond * 196.85);
  return feetPerMinute >= 0
    ? `+${feetPerMinute} fpm`
    : `${feetPerMinute} fpm`;
}

/** Short labels for settings copy. */
export function unitsLabel(units: UnitSystem): string {
  return units === 'metric' ? 'Metric (m, km/h)' : 'Aviation (ft, kts)';
}
