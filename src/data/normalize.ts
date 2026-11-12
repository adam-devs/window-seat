/** Defensive helpers shared by provider adapters. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accept only real finite numbers; numeric strings are rejected. */
export function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Trimmed non-empty string, or null. */
export function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Convert a provider timestamp in seconds to epoch milliseconds. */
export function secondsToMs(value: unknown): number | null {
  const seconds = asFiniteNumber(value);
  if (seconds === null) return null;
  const ms = seconds * 1000;
  return Number.isFinite(ms) ? ms : null;
}

export function isValidLatitude(value: number): boolean {
  return value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return value >= -180 && value <= 180;
}
