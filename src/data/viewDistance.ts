import { coneBoundingBox } from './direction';
import { bboxAreaSqDeg, estimateCreditCost } from './policy';
import type { DirectionalSelection } from './directionalView';

/**
 * Visibility-distance controls and area-cost estimates for View mode.
 *
 * OpenSky bills by bounding-box area, so a larger cone can cost more credits per
 * request (and a cone that crosses the antimeridian falls back to world
 * longitude coverage). The UI shows the effective cost and disables distances
 * that would exceed the provider's largest normal cost bucket.
 */

export const VIEW_DISTANCE_OPTIONS_KM = [25, 50, 100, 200] as const;

/** Above this area a request costs more than the cheapest bucket. */
export const VIEW_AREA_WARN_SQ_DEG = 100;

/** Largest area for the 1–3 credit buckets; larger boxes cost 4 credits. */
export const VIEW_AREA_MAX_SQ_DEG = 400;

export type ViewAreaLevel = 'ok' | 'warn' | 'over-limit';

export interface ViewDistanceOption {
  km: number;
  areaSqDeg: number;
  creditCost: number;
  /** True when choosing this distance would leave the normal cost range. */
  exceedsLimit: boolean;
}

export interface ViewAreaSummary {
  areaSqDeg: number;
  creditCost: number;
  level: ViewAreaLevel;
  /** e.g. "View area 3.2 sq° · 1 credit per request". */
  text: string;
  warning: string | null;
}

function formatArea(value: number): string {
  const rounded =
    value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} sq°`;
}

function formatCredits(value: number): string {
  return `${value} ${value === 1 ? 'credit' : 'credits'}`;
}

function levelForArea(areaSqDeg: number): ViewAreaLevel {
  if (areaSqDeg > VIEW_AREA_MAX_SQ_DEG) return 'over-limit';
  if (areaSqDeg > VIEW_AREA_WARN_SQ_DEG) return 'warn';
  return 'ok';
}

/** Evaluate one distance option for the current origin/bearing/angle. */
export function viewDistanceOption(
  direction: DirectionalSelection,
  km: number,
): ViewDistanceOption {
  const bbox = coneBoundingBox(
    direction.origin,
    direction.bearingDeg,
    direction.angleDeg,
    km,
  );
  const areaSqDeg = bboxAreaSqDeg(bbox);
  return {
    km,
    areaSqDeg,
    creditCost: estimateCreditCost(bbox),
    exceedsLimit: areaSqDeg > VIEW_AREA_MAX_SQ_DEG,
  };
}

/** All distance options evaluated for the current view. */
export function viewDistanceOptions(
  direction: DirectionalSelection,
): ViewDistanceOption[] {
  return VIEW_DISTANCE_OPTIONS_KM.map((km) =>
    viewDistanceOption(direction, km),
  );
}

/** Cost and warning copy for the active (or prospective) distance. */
export function describeViewArea(
  direction: DirectionalSelection,
  km: number = direction.visibilityKm,
): ViewAreaSummary {
  const option = viewDistanceOption(direction, km);
  const level = levelForArea(option.areaSqDeg);

  let warning: string | null = null;
  if (level === 'warn') {
    warning = `Large view: requests cost ${formatCredits(option.creditCost)}.`;
  } else if (level === 'over-limit') {
    warning =
      'Very large view: the provider may reject it. Choose a shorter distance.';
  }

  return {
    areaSqDeg: option.areaSqDeg,
    creditCost: option.creditCost,
    level,
    text: `View area ${formatArea(option.areaSqDeg)} · ${formatCredits(
      option.creditCost,
    )} per request`,
    warning,
  };
}
