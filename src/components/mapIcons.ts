import L from 'leaflet';
import { PLANE_ICON_PATH } from './planePath';

export { PLANE_ICON_PATH } from './planePath';

/**
 * Shared Leaflet icon cache.
 *
 * Aircraft markers are re-rendered on every snapshot. Rebuilding a `divIcon`
 * for every aircraft each time allocates new HTML and icon objects and forces
 * Leaflet to replace marker DOM. Icons are therefore cached by the visual state
 * that affects their markup: quantized heading and selection.
 *
 * Heading is quantized to 5° so a cache stays bounded (72 headings × 2 selection
 * states) while rotation remains visually smooth. Altitude styling and other
 * visual states are applied imperatively to the stable glyph element.
 */

const HEADING_STEP_DEG = 5;

/** Size of the whole glyph box in CSS pixels. */
export const PLANE_ICON_SIZE = 32;

/**
 * Aircraft silhouette in a 0 0 24 24 viewBox, nose pointing north (up).
 * Rotating this path by the reported track therefore points the nose along the
 * direction of travel.
 */

const iconCache = new Map<string, L.DivIcon>();

/** Normalize a heading to a 0–355° bucket, or 0 when unknown. */
export function headingBucket(heading: number | null): number {
  if (heading === null || !Number.isFinite(heading)) return 0;
  const normalized = ((heading % 360) + 360) % 360;
  return (Math.round(normalized / HEADING_STEP_DEG) * HEADING_STEP_DEG) % 360;
}

export function getPlaneIcon(
  heading: number | null,
  selected: boolean,
): L.DivIcon {
  const bucket = headingBucket(heading);
  const key = `${selected ? 'selected' : 'default'}:${bucket}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const color = selected ? '#f59e0b' : '#3b82f6';
  const icon = L.divIcon({
    className: '',
    html: `<div class="plane-glyph${selected ? ' plane-glyph--selected' : ''}" style="transform: rotate(${bucket}deg); width: ${PLANE_ICON_SIZE}px; height: ${PLANE_ICON_SIZE}px; display: flex; align-items: center; justify-content: center; transform-origin: 50% 50%; color: ${color}; filter: drop-shadow(0 0 1.5px var(--marker-halo, rgba(255,255,255,.95))) drop-shadow(0 1px 2px var(--marker-shadow, rgba(0,0,0,.9))); will-change: transform; transition: color 150ms, opacity 250ms"><svg width="${PLANE_ICON_SIZE}" height="${PLANE_ICON_SIZE}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="display:block"><path d="${PLANE_ICON_PATH}" fill="currentColor" stroke="var(--marker-stroke, #ffffff)" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"/></svg></div>`,
    iconAnchor: [PLANE_ICON_SIZE / 2, PLANE_ICON_SIZE / 2],
    popupAnchor: [0, -18],
  });
  iconCache.set(key, icon);
  return icon;
}

/** Clear cached icons; intended for tests and future theme changes. */
export function clearPlaneIconCache(): void {
  iconCache.clear();
}

/** Number of distinct visual states currently cached. */
export function planeIconCacheSize(): number {
  return iconCache.size;
}
