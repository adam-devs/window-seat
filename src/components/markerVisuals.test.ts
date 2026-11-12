// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import type { Aircraft } from '../data/types';
import {
  ALTITUDE_COLORS,
  SELECTED_COLOR,
  altitudeBand,
  applyMarkerVisual,
  markerVisual,
} from './markerVisuals';

function aircraft(overrides: Partial<Aircraft> = {}): Aircraft {
  return {
    icao24: 'abc123',
    callsign: null,
    origin_country: null,
    lastContactMs: 1_000,
    lastPositionMs: 1_000,
    latitude: 0,
    longitude: 0,
    baro_altitude: 5_000,
    geo_altitude: null,
    on_ground: false,
    velocity: 100,
    true_track: 90,
    vertical_rate: null,
    squawk: null,
    spi: false,
    providerId: 'opensky',
    ...overrides,
  };
}

describe('altitudeBand', () => {
  it('uses ground, low, mid, high, and unknown bands', () => {
    expect(altitudeBand(aircraft({ on_ground: true }))).toBe('ground');
    expect(altitudeBand(aircraft({ baro_altitude: 0 }))).toBe('low');
    expect(altitudeBand(aircraft({ baro_altitude: 2_999 }))).toBe('low');
    expect(altitudeBand(aircraft({ baro_altitude: 3_000 }))).toBe('mid');
    expect(altitudeBand(aircraft({ baro_altitude: 7_999 }))).toBe('mid');
    expect(altitudeBand(aircraft({ baro_altitude: 8_000 }))).toBe('high');
    expect(altitudeBand(aircraft({ baro_altitude: null }))).toBe('unknown');
  });

  it('falls back to geometric altitude', () => {
    expect(
      altitudeBand(
        aircraft({ baro_altitude: null, geo_altitude: 9_000 }),
      ),
    ).toBe('high');
  });
});

describe('markerVisual', () => {
  it('uses the altitude colour and no dimming for a fresh contact', () => {
    const visual = markerVisual(aircraft(), 2_000, false, 60_000);

    expect(visual).toMatchObject({
      color: ALTITUDE_COLORS.mid,
      scale: 1,
      opacity: 1,
      stale: false,
      selected: false,
      band: 'mid',
    });
  });

  it('dims stale aircraft', () => {
    const visual = markerVisual(
      aircraft({ lastContactMs: 1_000 }),
      100_000,
      false,
      60_000,
    );

    expect(visual.stale).toBe(true);
    expect(visual.opacity).toBe(0.35);
  });

  it('keeps a selected aircraft orange and stronger when stale', () => {
    const visual = markerVisual(
      aircraft({ lastContactMs: 1_000 }),
      100_000,
      true,
      60_000,
    );

    expect(visual.color).toBe(SELECTED_COLOR);
    expect(visual.scale).toBe(1.3);
    expect(visual.opacity).toBe(0.6);
  });

  it('treats a missing contact timestamp as fresh', () => {
    expect(
      markerVisual(aircraft({ lastContactMs: 0 }), 100_000, false, 1)
        .stale,
    ).toBe(false);
  });
});

describe('applyMarkerVisual', () => {
  it('updates the glyph style without recreating it', () => {
    const glyph = document.createElement('div');
    const visual = markerVisual(aircraft(), 2_000, true, 60_000);

    applyMarkerVisual(glyph, 370, visual);

    expect(glyph.style.transform).toBe('rotate(10deg) scale(1.3)');
    expect(glyph.style.color).toBe('rgb(245, 158, 11)');
    expect(glyph.style.opacity).toBe('1');
    expect(glyph.style.filter).toContain('drop-shadow');
    expect(glyph.style.filter).toContain('rgba(255,255,255');
  });

  it('rotates the north-up glyph through cardinal directions', () => {
    const glyph = document.createElement('div');
    const visual = markerVisual(aircraft(), 2_000, false, 60_000);

    for (const heading of [0, 90, 180, 270]) {
      applyMarkerVisual(glyph, heading, visual);
      expect(glyph.style.transform).toBe(
        `rotate(${heading}deg) scale(1)`,
      );
    }
  });

  it('falls back to zero rotation for unknown headings', () => {
    const glyph = document.createElement('div');

    applyMarkerVisual(glyph, null, markerVisual(aircraft(), 2_000, false, 60_000));

    expect(glyph.style.transform).toBe('rotate(0deg) scale(1)');
  });
});
