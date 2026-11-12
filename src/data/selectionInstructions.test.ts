import { describe, expect, it } from 'vitest';
import { selectionInstruction } from './selectionInstructions';

const base = {
  hasPerimeter: false,
  hasDirection: false,
  hasPendingOrigin: false,
};

describe('selectionInstruction', () => {
  it('describes the perimeter drawing steps', () => {
    expect(selectionInstruction({ ...base, mode: 'perimeter' })).toBe(
      'Click two corners on the map to draw your search box.',
    );
    expect(
      selectionInstruction({ ...base, mode: 'perimeter', hasPerimeter: true }),
    ).toBe('Perimeter set — click two new corners to redraw.');
  });

  it('describes pinning an origin for a view', () => {
    expect(selectionInstruction({ ...base, mode: 'direction' })).toBe(
      'Click the map to pin an origin, then click again to aim the view.',
    );
  });

  it('explains the second click once an origin is pinned', () => {
    expect(
      selectionInstruction({
        ...base,
        mode: 'direction',
        hasPendingOrigin: true,
        hasDirection: true,
      }),
    ).toBe('Origin pinned — click again to aim the view.');
  });

  it('describes an adjustable completed view', () => {
    expect(
      selectionInstruction({
        ...base,
        mode: 'direction',
        hasDirection: true,
      }),
    ).toBe(
      'View set — drag the pin to move the origin, or click the map to start a new view.',
    );
  });
});
