// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  PLANE_ICON_PATH,
  PLANE_ICON_SIZE,
  clearPlaneIconCache,
  getPlaneIcon,
  headingBucket,
  planeIconCacheSize,
} from './mapIcons';

beforeEach(() => {
  clearPlaneIconCache();
});

describe('headingBucket', () => {
  it('normalizes to 5-degree buckets', () => {
    expect(headingBucket(0)).toBe(0);
    expect(headingBucket(2)).toBe(0);
    expect(headingBucket(3)).toBe(5);
    expect(headingBucket(87)).toBe(85);
    expect(headingBucket(88)).toBe(90);
    expect(headingBucket(90)).toBe(90);
  });

  it('wraps and handles unknown headings', () => {
    expect(headingBucket(359)).toBe(0);
    expect(headingBucket(360)).toBe(0);
    expect(headingBucket(725)).toBe(5);
    expect(headingBucket(-10)).toBe(350);
    expect(headingBucket(null)).toBe(0);
    expect(headingBucket(Number.NaN)).toBe(0);
  });
});

describe('getPlaneIcon', () => {
  it('reuses one icon for the same visual state', () => {
    const first = getPlaneIcon(91, false);
    const second = getPlaneIcon(89, false);

    expect(second).toBe(first);
    expect(planeIconCacheSize()).toBe(1);
  });

  it('keeps selected and unselected icons distinct', () => {
    const normal = getPlaneIcon(90, false);
    const selected = getPlaneIcon(90, true);

    expect(selected).not.toBe(normal);
    expect(planeIconCacheSize()).toBe(2);
  });

  it('encodes rotation and selection colour in the markup', () => {
    const normal = getPlaneIcon(90, false);
    const selected = getPlaneIcon(90, true);

    expect(normal.options.html).toContain('rotate(90deg)');
    expect(normal.options.html).toContain('#3b82f6');
    expect(selected.options.html).toContain('#f59e0b');
  });

  it('uses a north-up SVG silhouette rather than an emoji', () => {
    const icon = getPlaneIcon(0, false);

    expect(icon.options.html).toContain('<svg');
    expect(icon.options.html).not.toContain('✈');
    expect(icon.options.html).toContain('currentColor');
    expect(PLANE_ICON_PATH.startsWith('M12 2')).toBe(true);
    expect(PLANE_ICON_SIZE).toBe(28);
    expect(icon.options.iconAnchor).toEqual([14, 14]);
  });

  it('rebuilds icons after an explicit cache clear', () => {
    const first = getPlaneIcon(180, false);
    clearPlaneIconCache();
    const second = getPlaneIcon(180, false);

    expect(second).not.toBe(first);
    expect(planeIconCacheSize()).toBe(1);
  });
});
