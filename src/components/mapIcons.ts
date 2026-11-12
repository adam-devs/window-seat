import L from 'leaflet';

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
export const PLANE_ICON_SIZE = 28;

/**
 * Aircraft silhouette in a 0 0 24 24 viewBox, nose pointing north (up).
 * Rotating this path by the reported track therefore points the nose along the
 * direction of travel.
 */
export const PLANE_ICON_PATH =
  'M12 2L13.7 8.2L22 12.4V14.6L13.5 12.2L13 18.8L15.8 20.8V22.5L12 21.2L8.2 22.5V20.8L11 18.8L10.5 12.2L2 14.6V12.4L10.3 8.2Z';

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
    html: `<div class="plane-glyph" style="transform: rotate(${bucket}deg); width: ${PLANE_ICON_SIZE}px; height: ${PLANE_ICON_SIZE}px; display: flex; align-items: center; justify-content: center; transform-origin: 50% 50%; color: ${color}; filter: drop-shadow(0 0 1.5px rgba(255,255,255,.95)) drop-shadow(0 1px 2px rgba(0,0,0,.9)); will-change: transform; transition: color 150ms, opacity 250ms"><svg width="${PLANE_ICON_SIZE}" height="${PLANE_ICON_SIZE}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" style="display:block"><path d="${PLANE_ICON_PATH}" fill="currentColor" stroke="#0b1220" stroke-width="1.3" stroke-linejoin="round" paint-order="stroke"/></svg></div>`,
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
