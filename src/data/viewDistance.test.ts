import { describe, expect, it } from 'vitest';
import {
  VIEW_AREA_MAX_SQ_DEG,
  VIEW_AREA_WARN_SQ_DEG,
  VIEW_DISTANCE_OPTIONS_KM,
  describeViewArea,
  viewDistanceOption,
  viewDistanceOptions,
} from './viewDistance';
import type { DirectionalSelection } from './directionalView';

const normal: DirectionalSelection = {
  origin: { latitude: 51.5, longitude: -0.1 },
  bearingDeg: 90,
  angleDeg: 60,
  visibilityKm: 100,
};

// A cone crossing the antimeridian falls back to world-longitude coverage, so
// its area grows quickly and gives deterministic warning/limit cases.
const crossing: DirectionalSelection = {
  origin: { latitude: 0, longitude: 179.9 },
  bearingDeg: 90,
  angleDeg: 60,
  visibilityKm: 100,
};

describe('viewDistanceOption', () => {
  it('evaluates the four supported distances', () => {
    expect(VIEW_DISTANCE_OPTIONS_KM).toEqual([25, 50, 100, 200]);
    expect(viewDistanceOptions(normal).map((option) => option.km)).toEqual([
      25, 50, 100, 200,
    ]);
  });

  it('keeps a normal mid-latitude view in the cheapest bucket', () => {
    for (const km of VIEW_DISTANCE_OPTIONS_KM) {
      const option = viewDistanceOption(normal, km);
      expect(option.areaSqDeg).toBeLessThan(VIEW_AREA_WARN_SQ_DEG);
      expect(option.creditCost).toBe(1);
      expect(option.exceedsLimit).toBe(false);
    }
  });

  it('marks distances over the normal cost range', () => {
    const short = viewDistanceOption(crossing, 25);
    const long = viewDistanceOption(crossing, 200);

    expect(short.areaSqDeg).toBeLessThanOrEqual(VIEW_AREA_MAX_SQ_DEG);
    expect(short.exceedsLimit).toBe(false);
    expect(long.areaSqDeg).toBeGreaterThan(VIEW_AREA_MAX_SQ_DEG);
    expect(long.creditCost).toBe(4);
    expect(long.exceedsLimit).toBe(true);
  });
});

describe('describeViewArea', () => {
  it('shows the area and cost for a normal view', () => {
    const summary = describeViewArea(normal);

    expect(summary.level).toBe('ok');
    expect(summary.creditCost).toBe(1);
    expect(summary.text).toContain('View area');
    expect(summary.text).toContain('sq°');
    expect(summary.text).toContain('1 credit per request');
    expect(summary.warning).toBeNull();
  });

  it('warns when the request leaves the cheapest bucket', () => {
    const summary = describeViewArea(crossing, 100);

    expect(summary.level).toBe('warn');
    expect(summary.creditCost).toBeGreaterThan(1);
    expect(summary.warning).toContain('Large view');
  });

  it('explains when a distance exceeds the provider’s normal limit', () => {
    const summary = describeViewArea(crossing, 200);

    expect(summary.level).toBe('over-limit');
    expect(summary.creditCost).toBe(4);
    expect(summary.warning).toContain('shorter distance');
  });

  it('uses the selection’s distance by default', () => {
    expect(describeViewArea({ ...normal, visibilityKm: 50 }).areaSqDeg).toBe(
      viewDistanceOption(normal, 50).areaSqDeg,
    );
  });
});
