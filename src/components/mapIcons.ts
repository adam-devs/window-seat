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
 * states) while rotation remains visually smooth. Altitude styling will join
 * the key in M2.5.
 */

const HEADING_STEP_DEG = 5;
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
    html: `<div style="transform: rotate(${bucket}deg); font-size: 20px; line-height: 1; color: ${color}; filter: drop-shadow(0 1px 2px rgba(0,0,0,.5))">✈</div>`,
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
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
