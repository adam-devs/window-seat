import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONE_ANGLE_DEG,
  DEFAULT_VISIBILITY_KM,
  SELECTION_MODE_LABELS,
  createDirectionalSelection,
  normalizeDirectionalSelection,
  selectionFromPoints,
  updateDirectionalSelection,
} from './directionalView';

const origin = { latitude: 51.5, longitude: -0.1 };

describe('directional defaults', () => {
  it('uses a 60-degree cone and 100 km visibility', () => {
    expect(DEFAULT_CONE_ANGLE_DEG).toBe(60);
    expect(DEFAULT_VISIBILITY_KM).toBe(100);
    expect(SELECTION_MODE_LABELS).toEqual({
      perimeter: 'Perimeter',
      direction: 'View',
    });
  });
});

describe('normalizeDirectionalSelection', () => {
  it('normalizes bearing and clamps angle/distance', () => {
    expect(
      normalizeDirectionalSelection({
        origin,
        bearingDeg: 725,
        angleDeg: 500,
        visibilityKm: 900,
      }),
    ).toEqual({
      origin,
      bearingDeg: 5,
      angleDeg: 180,
      visibilityKm: 500,
    });
  });

  it('fills missing optional values with defaults', () => {
    expect(
      normalizeDirectionalSelection({ origin, bearingDeg: 90 }),
    ).toEqual({
      origin,
      bearingDeg: 90,
      angleDeg: DEFAULT_CONE_ANGLE_DEG,
      visibilityKm: DEFAULT_VISIBILITY_KM,
    });
  });

  it('rejects invalid origins, bearings, and shapes', () => {
    for (const value of [
      null,
      {},
      { origin: {}, bearingDeg: 90 },
      { origin: { latitude: 91, longitude: 0 }, bearingDeg: 90 },
      { origin: { latitude: 0, longitude: 181 }, bearingDeg: 90 },
      { origin, bearingDeg: Number.NaN },
    ]) {
      expect(normalizeDirectionalSelection(value)).toBeNull();
    }
  });
});

describe('createDirectionalSelection', () => {
  it('creates a selection with optional overrides', () => {
    expect(createDirectionalSelection(origin, 90)).toEqual({
      origin,
      bearingDeg: 90,
      angleDeg: 60,
      visibilityKm: 100,
    });
    expect(
      createDirectionalSelection(origin, -90, {
        angleDeg: 120,
        visibilityKm: 200,
      }),
    ).toMatchObject({
      bearingDeg: 270,
      angleDeg: 120,
      visibilityKm: 200,
    });
  });

  it('returns null for invalid input', () => {
    expect(
      createDirectionalSelection({ latitude: 100, longitude: 0 }, 90),
    ).toBeNull();
  });
});

describe('updateDirectionalSelection', () => {
  it('applies partial updates without mutating the original', () => {
    const original = createDirectionalSelection(origin, 90)!;
    const updated = updateDirectionalSelection(original, {
      bearingDeg: 180,
      visibilityKm: 250,
    });

    expect(updated).toMatchObject({
      bearingDeg: 180,
      visibilityKm: 250,
      angleDeg: 60,
    });
    expect(original.bearingDeg).toBe(90);
  });
});

describe('selectionFromPoints', () => {
  it('derives the bearing from the second click', () => {
    expect(
      selectionFromPoints(origin, { latitude: 51.5, longitude: 0 })!.bearingDeg,
    ).toBeCloseTo(90, 1);
    expect(
      selectionFromPoints(origin, { latitude: 50.5, longitude: -0.1 })!
        .bearingDeg,
    ).toBeCloseTo(180, 5);
  });

  it('rejects a second click on the origin', () => {
    expect(selectionFromPoints(origin, origin)).toBeNull();
  });

  it('passes angle and distance options through', () => {
    expect(
      selectionFromPoints(origin, { latitude: 51.5, longitude: 0 }, {
        angleDeg: 120,
        visibilityKm: 200,
      }),
    ).toMatchObject({ angleDeg: 120, visibilityKm: 200 });
  });
});
