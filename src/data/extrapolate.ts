import type { Aircraft } from './types';

/**
 * Dead-reckoning core.
 *
 * Positions are projected from the latest observed fix using reported ground
 * speed and track. No React, timers, or map objects live here, so the animation
 * loop in M2.3 can call this once per frame and tests can cover the geometry
 * directly.
 *
 * Extrapolation is deliberately capped: aircraft should drift only far enough
 * to cover missed snapshot frames, then hold. A fresh observation corrects the
 * position with a short eased transition (M2.3) rather than an endless guess.
 */

/** Hard cap on dead reckoning, independent of refresh cadence. */
export const MAX_EXTRAPOLATION_MS = 30_000;

const EARTH_RADIUS_M = 6_371_000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface ExtrapolationOptions {
  /** Hard ceiling; defaults to 30 s. */
  maxExtrapolationMs?: number;
  /** When provided, the cap becomes `min(max, 2 * interval)`. */
  refreshIntervalMs?: number;
}

export interface ProjectedPosition extends GeoPoint {
  /** Full age of the source fix (uncapped), in ms. */
  ageMs: number;
  /** Extrapolation actually applied after capping, in ms. */
  extrapolatedMs: number;
  /** Distance moved from the observed fix, in metres. */
  distanceM: number;
  /** True when the output is a projection rather than the observed point. */
  estimated: boolean;
  /** True when the source fix is older than the extrapolation cap. */
  capped: boolean;
}

/** Resolve the effective cap from a hard ceiling and optional cadence. */
export function resolveExtrapolationCap(
  options: ExtrapolationOptions = {},
): number {
  const hardCap =
    Number.isFinite(options.maxExtrapolationMs) &&
    (options.maxExtrapolationMs ?? -1) >= 0
      ? (options.maxExtrapolationMs as number)
      : MAX_EXTRAPOLATION_MS;

  if (
    !Number.isFinite(options.refreshIntervalMs) ||
    (options.refreshIntervalMs ?? -1) <= 0
  ) {
    return hardCap;
  }

  return Math.min(hardCap, (options.refreshIntervalMs as number) * 2);
}

/** True when the aircraft reports enough valid motion to project. */
export function canExtrapolate(aircraft: Aircraft): boolean {
  return (
    !aircraft.on_ground &&
    aircraft.velocity !== null &&
    Number.isFinite(aircraft.velocity) &&
    aircraft.velocity > 0 &&
    aircraft.true_track !== null &&
    Number.isFinite(aircraft.true_track)
  );
}

function normalizeLongitude(longitude: number): number {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/**
 * Destination point from `start` after travelling `distanceM` on `trackDeg`.
 * Uses the spherical direct-geodesic formula so antimeridian and high-latitude
 * cases stay stable.
 */
export function destinationPoint(
  start: GeoPoint,
  trackDeg: number,
  distanceM: number,
): GeoPoint {
  if (!Number.isFinite(distanceM) || distanceM === 0) {
    return {
      latitude: start.latitude,
      longitude: normalizeLongitude(start.longitude),
    };
  }

  const angularDistance = distanceM / EARTH_RADIUS_M;
  const bearing = (trackDeg * Math.PI) / 180;
  const lat1 = (start.latitude * Math.PI) / 180;
  const lon1 = (start.longitude * Math.PI) / 180;

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing);
  const lat2 = Math.asin(Math.min(1, Math.max(-1, sinLat2)));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: normalizeLongitude((lon2 * 180) / Math.PI),
  };
}

/**
 * Project an aircraft to `atMs`.
 *
 * The fix timestamp prefers `lastPositionMs`, falling back to `lastContactMs`.
 * If motion or a valid timestamp is missing, the observed position is returned
 * unchanged. Age is capped before projection and reported separately.
 */
export function projectAircraftPosition(
  aircraft: Aircraft,
  atMs: number,
  options: ExtrapolationOptions = {},
): ProjectedPosition {
  const observed: GeoPoint = {
    latitude: aircraft.latitude,
    longitude: aircraft.longitude,
  };
  const fixMs = aircraft.lastPositionMs ?? aircraft.lastContactMs;
  const ageMs =
    Number.isFinite(atMs) && Number.isFinite(fixMs)
      ? Math.max(0, atMs - fixMs)
      : 0;
  const cap = resolveExtrapolationCap(options);
  const extrapolatedMs = Math.min(ageMs, cap);

  if (!canExtrapolate(aircraft) || extrapolatedMs <= 0) {
    return {
      ...observed,
      longitude: normalizeLongitude(observed.longitude),
      ageMs,
      extrapolatedMs: 0,
      distanceM: 0,
      estimated: false,
      capped: ageMs > cap,
    };
  }

  const distanceM =
    (aircraft.velocity as number) * (extrapolatedMs / 1000);
  const projected = destinationPoint(
    observed,
    aircraft.true_track as number,
    distanceM,
  );

  return {
    ...projected,
    ageMs,
    extrapolatedMs,
    distanceM,
    estimated: distanceM > 0,
    capped: ageMs > cap,
  };
}
