import type { Aircraft } from '../data/types';
import { normalizeHeading } from '../data/motion';

/** Altitude bands used for marker colour; thresholds are metres. */
export type AltitudeBand = 'ground' | 'low' | 'mid' | 'high' | 'unknown';

export const ALTITUDE_COLORS: Record<AltitudeBand, string> = {
  ground: '#9ca3af',
  low: '#22c55e',
  mid: '#3b82f6',
  high: '#a855f7',
  unknown: '#94a3b8',
};

export const SELECTED_COLOR = '#f59e0b';

const BASE_FILTER =
  'drop-shadow(0 0 1.5px var(--marker-halo, rgba(255,255,255,.95))) drop-shadow(0 1px 2px var(--marker-shadow, rgba(0,0,0,.9)))';
const SELECTED_FILTER = `${BASE_FILTER} drop-shadow(0 0 6px currentColor)`;

export interface MarkerVisual {
  color: string;
  scale: number;
  opacity: number;
  stale: boolean;
  selected: boolean;
  band: AltitudeBand;
}

export function altitudeBand(flight: Aircraft): AltitudeBand {
  if (flight.on_ground) return 'ground';

  const altitude = flight.baro_altitude ?? flight.geo_altitude;
  if (altitude === null || !Number.isFinite(altitude)) return 'unknown';
  if (altitude < 3_000) return 'low';
  if (altitude < 8_000) return 'mid';
  return 'high';
}

/**
 * Resolve colour, emphasis, and dimming for one marker.
 *
 * Staleness is based on the provider contact age, not the snapshot age, so one
 * silent aircraft dims even when the rest of the feed is fresh. Selection wins
 * over altitude colour and keeps a stronger opacity when stale.
 */
export function markerVisual(
  flight: Aircraft,
  nowMs: number,
  selected: boolean,
  staleAfterMs: number,
): MarkerVisual {
  const band = altitudeBand(flight);
  const hasContact = Number.isFinite(flight.lastContactMs) && flight.lastContactMs > 0;
  const ageMs = hasContact ? Math.max(0, nowMs - flight.lastContactMs) : 0;
  const stale = ageMs > staleAfterMs;

  return {
    color: selected ? SELECTED_COLOR : ALTITUDE_COLORS[band],
    scale: selected ? 1.3 : 1,
    opacity: stale ? (selected ? 0.7 : 0.5) : 1,
    stale,
    selected,
    band,
  };
}

/**
 * Zoom-aware marker scale.
 *
 * Markers stay readable at city zoom without covering the map when zoomed out.
 * The selected marker's own 1.3× scale is applied on top of this.
 */
export function markerZoomScale(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  if (zoom >= 12) return 1.15;
  if (zoom >= 10) return 1.05;
  if (zoom >= 8) return 1;
  return 0.85;
}

/** Apply visual state to the cached glyph element without replacing marker DOM. */
export function applyMarkerVisual(
  glyph: HTMLElement,
  heading: number | null,
  visual: MarkerVisual,
  zoomScale = 1,
): void {
  const rotation =
    heading !== null && Number.isFinite(heading) ? normalizeHeading(heading) : 0;
  const scale =
    Math.round(
      visual.scale * (Number.isFinite(zoomScale) ? zoomScale : 1) * 1000,
    ) / 1000;
  glyph.style.transform = `rotate(${rotation}deg) scale(${scale})`;
  glyph.style.color = visual.color;
  glyph.style.opacity = String(visual.opacity);
  glyph.style.filter = visual.selected ? SELECTED_FILTER : BASE_FILTER;
  glyph.classList.toggle('plane-glyph--selected', visual.selected);
}
