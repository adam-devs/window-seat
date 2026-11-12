import { describe, expect, it } from 'vitest';
import {
  SAVED_SELECTIONS_LIMIT,
  SAVED_SELECTION_NAME_MAX,
  addSavedSelection,
  createSavedDirection,
  createSavedPerimeter,
  createSavedSelectionId,
  defaultSavedSelectionName,
  deleteSavedSelection,
  findMatchingSavedSelection,
  isSavedSelectionLibraryFull,
  parseSavedSelection,
  parseSavedSelections,
  renameSavedSelection,
  savedSelectionMatches,
  touchSavedSelection,
  uniqueSavedSelectionName,
  updateSavedSelection,
  type SavedDirection,
  type SavedPerimeter,
  type SavedSelection,
} from './savedSelections';

const timestamps = { createdAt: 1_000, updatedAt: 2_000 };

function perimeter(overrides: Partial<SavedPerimeter> = {}): SavedPerimeter {
  return {
    id: 'perimeter-1',
    name: 'Home',
    kind: 'perimeter',
    perimeter: { lamin: 50, lomin: -1, lamax: 51, lomax: 0 },
    ...timestamps,
    ...overrides,
  };
}

describe('parseSavedSelection', () => {
  it('parses a perimeter entry and normalizes its box', () => {
    expect(
      parseSavedSelection({
        id: '  p1  ',
        name: '  Home field  ',
        kind: 'perimeter',
        perimeter: { lamin: 51, lamax: 50, lomin: 0, lomax: -1 },
        createdAt: 10,
        updatedAt: 20,
      }),
    ).toEqual({
      id: 'p1',
      name: 'Home field',
      kind: 'perimeter',
      perimeter: { lamin: 50, lomin: -1, lamax: 51, lomax: 0 },
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it('parses and clamps a direction entry', () => {
    expect(
      parseSavedSelection({
        id: 'v1',
        name: 'Look east',
        kind: 'direction',
        direction: {
          origin: { latitude: 51.5, longitude: -0.1 },
          bearingDeg: 725,
          angleDeg: 500,
          visibilityKm: 900,
        },
        createdAt: 10,
        updatedAt: 20,
      }),
    ).toEqual({
      id: 'v1',
      name: 'Look east',
      kind: 'direction',
      direction: {
        origin: { latitude: 51.5, longitude: -0.1 },
        bearingDeg: 5,
        angleDeg: 180,
        visibilityKm: 500,
      },
      createdAt: 10,
      updatedAt: 20,
    });
  });

  it('caps the name and keeps updatedAt >= createdAt', () => {
    const parsed = parseSavedSelection({
      ...perimeter(),
      name: 'x'.repeat(SAVED_SELECTION_NAME_MAX + 20),
      createdAt: 500,
      updatedAt: 100,
    });

    expect(parsed?.name).toHaveLength(SAVED_SELECTION_NAME_MAX);
    expect(parsed?.updatedAt).toBe(500);
  });

  it('rejects malformed entries', () => {
    const valid = perimeter();
    for (const value of [
      null,
      {},
      { ...valid, id: '' },
      { ...valid, name: '   ' },
      { ...valid, name: 42 },
      { ...valid, createdAt: -1 },
      { ...valid, updatedAt: Number.NaN },
      { ...valid, kind: 'circle' },
      { ...valid, perimeter: null },
      {
        ...valid,
        kind: 'direction',
        direction: { origin: { latitude: 91, longitude: 0 }, bearingDeg: 0 },
      },
    ]) {
      expect(parseSavedSelection(value)).toBeNull();
    }
  });
});

describe('parseSavedSelections', () => {
  it('drops invalid and duplicate IDs while preserving order', () => {
    const first = perimeter({ id: 'a', name: 'First' });
    const second = perimeter({
      id: 'b',
      name: 'Second',
      perimeter: { lamin: 40, lomin: -2, lamax: 41, lomax: -1 },
    });

    expect(
      parseSavedSelections([
        first,
        { ...first, name: 'Duplicate' },
        null,
        { ...second, id: '' },
        second,
      ]),
    ).toEqual([first, second]);
  });

  it('returns an empty library for non-array values', () => {
    for (const value of [null, undefined, {}, 'saved', 42]) {
      expect(parseSavedSelections(value)).toEqual([]);
    }
  });

  it('caps the library at the supported size', () => {
    const many = Array.from({ length: SAVED_SELECTIONS_LIMIT + 10 }, (_, index) =>
      perimeter({ id: `id-${index}`, name: `Area ${index}` }),
    );

    expect(parseSavedSelections(many)).toHaveLength(SAVED_SELECTIONS_LIMIT);
  });
});

function direction(
  overrides: Partial<SavedDirection> = {},
): SavedDirection {
  return {
    id: 'view-1',
    name: 'Look east',
    kind: 'direction',
    direction: {
      origin: { latitude: 51.5, longitude: -0.1 },
      bearingDeg: 90,
      angleDeg: 60,
      visibilityKm: 100,
    },
    ...timestamps,
    ...overrides,
  };
}

describe('createSavedSelectionId', () => {
  it('generates distinct non-empty local IDs', () => {
    const first = createSavedSelectionId();
    const second = createSavedSelectionId();

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(first).not.toBe(second);
  });
});

describe('saved selection names', () => {
  it('uses the next available default name per kind', () => {
    const first = perimeter({ id: 'p1', name: 'Perimeter 1' });
    const third = perimeter({ id: 'p3', name: 'Perimeter 3' });
    const view = direction({ id: 'v1', name: 'View 1' });

    expect(defaultSavedSelectionName('perimeter', [])).toBe('Perimeter 1');
    expect(defaultSavedSelectionName('perimeter', [first])).toBe('Perimeter 2');
    expect(defaultSavedSelectionName('perimeter', [first, third])).toBe(
      'Perimeter 2',
    );
    expect(defaultSavedSelectionName('direction', [first, view])).toBe(
      'View 2',
    );
    // Excluding the edited entry lets it keep its own default name.
    expect(defaultSavedSelectionName('perimeter', [first], 'p1')).toBe(
      'Perimeter 1',
    );
  });

  it('deduplicates names case-insensitively and caps their length', () => {
    const selections = [
      perimeter({ id: 'a', name: 'Home' }),
      perimeter({ id: 'b', name: 'home' }),
      perimeter({ id: 'c', name: 'Home (2)' }),
    ];

    expect(uniqueSavedSelectionName('Home', 'perimeter', selections)).toBe(
      'Home (3)',
    );
    expect(uniqueSavedSelectionName('home', 'perimeter', selections)).toBe(
      'home (3)',
    );
    expect(uniqueSavedSelectionName('', 'perimeter', selections)).toBe(
      'Perimeter 1',
    );
    expect(
      uniqueSavedSelectionName(
        'x'.repeat(SAVED_SELECTION_NAME_MAX + 10),
        'perimeter',
        [],
      ),
    ).toHaveLength(SAVED_SELECTION_NAME_MAX);
  });
});

describe('createSavedPerimeter / createSavedDirection', () => {
  it('creates normalized entries with default names and timestamps', () => {
    expect(
      createSavedPerimeter(
        { lamin: 51, lamax: 50, lomin: 0, lomax: -1 },
        [],
        { id: 'p1', now: 1_000 },
      ),
    ).toEqual({
      id: 'p1',
      name: 'Perimeter 1',
      kind: 'perimeter',
      perimeter: { lamin: 50, lomin: -1, lamax: 51, lomax: 0 },
      createdAt: 1_000,
      updatedAt: 1_000,
    });

    expect(
      createSavedDirection(
        {
          origin: { latitude: 51.5, longitude: -0.1 },
          bearingDeg: 725,
          angleDeg: 500,
          visibilityKm: 900,
        },
        [perimeter({ name: 'Home' })],
        { id: 'v1', name: 'Home', now: 2_000 },
      ),
    ).toEqual({
      id: 'v1',
      name: 'Home (2)',
      kind: 'direction',
      direction: {
        origin: { latitude: 51.5, longitude: -0.1 },
        bearingDeg: 5,
        angleDeg: 180,
        visibilityKm: 500,
      },
      createdAt: 2_000,
      updatedAt: 2_000,
    });
  });

  it('rejects invalid geometry', () => {
    expect(
      createSavedPerimeter(
        { lamin: 50, lamax: 50, lomin: 0, lomax: 1 },
        [],
      ),
    ).toBeNull();
    expect(
      createSavedDirection(
        {
          origin: { latitude: 91, longitude: 0 },
          bearingDeg: 0,
          angleDeg: 60,
          visibilityKm: 100,
        },
        [],
      ),
    ).toBeNull();
  });
});

describe('addSavedSelection', () => {
  it('appends a valid entry with a unique name', () => {
    const first = perimeter({ id: 'a', name: 'Home' });
    const second = perimeter({ id: 'b', name: 'Home' });
    const next = addSavedSelection([first], second);

    expect(next).toHaveLength(2);
    expect(next[1].name).toBe('Home (2)');
    expect(first.name).toBe('Home');
  });

  it('rejects duplicates, invalid entries, and a full library', () => {
    const first = perimeter({ id: 'a', name: 'Home' });
    const selections = [first];

    expect(addSavedSelection(selections, { ...first, name: 'Other' })).toBe(
      selections,
    );
    expect(addSavedSelection(selections, { ...first, id: 'b', name: '' })).toBe(
      selections,
    );

    const full = Array.from({ length: SAVED_SELECTIONS_LIMIT }, (_, index) =>
      perimeter({ id: `id-${index}`, name: `Area ${index}` }),
    );
    expect(isSavedSelectionLibraryFull(full)).toBe(true);
    expect(
      addSavedSelection(full, perimeter({ id: 'extra', name: 'Extra' })),
    ).toBe(full);
  });
});

describe('renameSavedSelection', () => {
  it('renames, deduplicates, and bumps updatedAt without mutating', () => {
    const selections = [
      perimeter({ id: 'a', name: 'Home', createdAt: 1_000, updatedAt: 2_000 }),
      perimeter({ id: 'b', name: 'Field' }),
    ];

    const renamed = renameSavedSelection(selections, 'a', '  Field  ', 3_000);

    expect(renamed[0]).toMatchObject({
      id: 'a',
      name: 'Field (2)',
      createdAt: 1_000,
      updatedAt: 3_000,
    });
    expect(selections[0].name).toBe('Home');
  });

  it('falls back to a default name and ignores unknown IDs', () => {
    const selections = [perimeter({ id: 'a', name: 'Home' })];

    expect(renameSavedSelection(selections, 'a', '   ', 2_000)[0].name).toBe(
      'Perimeter 1',
    );
    expect(renameSavedSelection(selections, 'missing', 'Field')).toBe(
      selections,
    );
  });
});

describe('deleteSavedSelection', () => {
  it('removes an entry and is a no-op for unknown IDs', () => {
    const selections = [
      perimeter({ id: 'a', name: 'Home' }),
      perimeter({ id: 'b', name: 'Field' }),
    ];

    expect(deleteSavedSelection(selections, 'a')).toEqual([selections[1]]);
    expect(deleteSavedSelection(selections, 'missing')).toBe(selections);
  });
});

describe('touchSavedSelection', () => {
  it('raises updatedAt without changing geometry or createdAt', () => {
    const selections = [
      perimeter({ id: 'a', name: 'Home', createdAt: 1_000, updatedAt: 2_000 }),
    ];

    const touched = touchSavedSelection(selections, 'a', 3_000);

    expect(touched[0]).toMatchObject({
      id: 'a',
      name: 'Home',
      createdAt: 1_000,
      updatedAt: 3_000,
    });
    expect(selections[0].updatedAt).toBe(2_000);
    expect(touchSavedSelection(selections, 'missing', 3_000)).toBe(selections);
    expect(touchSavedSelection(selections, 'a', 1_500)).toBe(selections);
  });
});

describe('updateSavedSelection', () => {
  it('replaces geometry and name while preserving ID and createdAt', () => {
    const selections = [
      perimeter({ id: 'a', name: 'Home', createdAt: 1_000, updatedAt: 2_000 }),
    ];
    const nextBox = { lamin: 40, lomin: -2, lamax: 41, lomax: -1 };

    const updated = updateSavedSelection(
      selections,
      'a',
      perimeter({
        id: 'a',
        name: 'Home',
        perimeter: nextBox,
        createdAt: 9_000,
        updatedAt: 9_000,
      }),
      3_000,
    );

    expect(updated[0]).toMatchObject({
      id: 'a',
      name: 'Home',
      kind: 'perimeter',
      perimeter: nextBox,
      createdAt: 1_000,
      updatedAt: 3_000,
    });
  });

  it('rejects kind changes, malformed updates, and unknown IDs', () => {
    const selections = [perimeter({ id: 'a', name: 'Home' })];

    expect(
      updateSavedSelection(selections, 'a', direction({ id: 'a' })),
    ).toBe(selections);
    expect(
      updateSavedSelection(selections, 'a', {
        ...perimeter({ id: 'a' }),
        perimeter: null as never,
      }),
    ).toBe(selections);
    expect(updateSavedSelection(selections, 'missing', perimeter())).toBe(
      selections,
    );
  });
});

describe('savedSelectionMatches / findMatchingSavedSelection', () => {
  const box = { lamin: 50, lomin: -1, lamax: 51, lomax: 0 };
  const savedBox = perimeter({ id: 'p', perimeter: box });
  const savedView = direction({ id: 'v' });

  it('matches a perimeter by exact box', () => {
    const active = {
      mode: 'perimeter' as const,
      perimeter: { ...box },
      direction: null,
    };

    expect(savedSelectionMatches(savedBox, active)).toBe(true);
    expect(savedSelectionMatches(savedView, active)).toBe(false);
    expect(findMatchingSavedSelection([savedView, savedBox], active)).toBe(
      savedBox,
    );
    expect(
      findMatchingSavedSelection(
        [savedBox],
        { ...active, perimeter: { ...box, lamax: 52 } },
      ),
    ).toBeNull();
  });

  it('matches a direction by origin, bearing, angle, and distance', () => {
    const active = {
      mode: 'direction' as const,
      perimeter: null,
      direction: savedView.direction,
    };

    expect(savedSelectionMatches(savedView, active)).toBe(true);
    expect(
      savedSelectionMatches(savedView, {
        ...active,
        direction: { ...active.direction, visibilityKm: 25 },
      }),
    ).toBe(false);
    expect(findMatchingSavedSelection([savedBox, savedView], active)).toBe(
      savedView,
    );
  });
});

describe('SavedSelection type', () => {
  it('keeps perimeter and direction entries distinguishable', () => {
    const selections: SavedSelection[] = [
      perimeter(),
      direction(),
    ];

    expect(selections.map((selection) => selection.kind)).toEqual([
      'perimeter',
      'direction',
    ]);
  });
});
