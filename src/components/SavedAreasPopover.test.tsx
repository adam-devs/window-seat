// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SavedAreasPopover } from './SavedAreasPopover';
import type { SavedSelection } from '../data/savedSelections';
import type { DirectionalSelection } from '../data/directionalView';
import type { BoundingBox, SelectionMode } from '../types';

const box: BoundingBox = { lamin: 50, lomin: -1, lamax: 51, lomax: 0 };
const direction: DirectionalSelection = {
  origin: { latitude: 51.5, longitude: -0.1 },
  bearingDeg: 90,
  angleDeg: 60,
  visibilityKm: 100,
};

const perimeterEntry: SavedSelection = {
  id: 'p1',
  name: 'Home',
  kind: 'perimeter',
  perimeter: box,
  createdAt: 1_000,
  updatedAt: 2_000,
};

const viewEntry: SavedSelection = {
  id: 'v1',
  name: 'Look east',
  kind: 'direction',
  direction,
  createdAt: 3_000,
  updatedAt: 4_000,
};

interface RenderOptions {
  selections?: SavedSelection[];
  mode?: SelectionMode;
  perimeter?: BoundingBox | null;
  direction?: DirectionalSelection | null;
  onSave?: (name: string) => void;
  onUpdate?: (id: string) => void;
  onRestore?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string) => void;
}

function renderPopover(options: RenderOptions = {}) {
  const onSave = options.onSave ?? vi.fn();
  const onUpdate = options.onUpdate ?? vi.fn();
  const onRestore = options.onRestore ?? vi.fn();
  const onRename = options.onRename ?? vi.fn();
  const onDelete = options.onDelete ?? vi.fn();

  render(
    <SavedAreasPopover
      selections={options.selections ?? []}
      mode={options.mode ?? 'perimeter'}
      perimeter={options.perimeter === undefined ? box : options.perimeter}
      direction={options.direction ?? null}
      onSave={onSave}
      onUpdate={onUpdate}
      onRestore={onRestore}
      onRename={onRename}
      onDelete={onDelete}
    />,
  );

  return { onSave, onUpdate, onRestore, onRename, onDelete };
}

function openPopover(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Saved areas' }));
  return screen.getByRole('dialog');
}

afterEach(cleanup);

describe('SavedAreasPopover', () => {
  it('opens with an empty library and a save form', () => {
    renderPopover();
    expect(screen.queryByRole('dialog')).toBeNull();

    const dialog = openPopover();

    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.activeElement).toBe(dialog);
    expect(screen.getByText('No saved areas yet.')).toBeTruthy();
    expect(
      (screen.getByRole('button', {
        name: 'Save current area',
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('lists saved entries with type, name, time, and active state', () => {
    renderPopover({ selections: [perimeterEntry, viewEntry] });
    openPopover();

    expect(screen.getByText('Perimeter')).toBeTruthy();
    expect(screen.getByText('View')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load Home' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Load Look east' }),
    ).toBeTruthy();
    expect(screen.getAllByText(/Used /)).toHaveLength(2);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('saves the active selection with an editable name', () => {
    const { onSave } = renderPopover();
    openPopover();

    const input = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.change(input, { target: { value: 'My area' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save current area' }));

    expect(onSave).toHaveBeenCalledWith('My area');
  });

  it('falls back to the default name when the field is empty', () => {
    const { onSave } = renderPopover();
    openPopover();

    fireEvent.click(screen.getByRole('button', { name: 'Save current area' }));

    expect(onSave).toHaveBeenCalledWith('Perimeter 1');
  });

  it('labels a View save and offers Update when it matches', () => {
    const { onUpdate } = renderPopover({
      mode: 'direction',
      perimeter: null,
      direction,
      selections: [viewEntry],
    });
    openPopover();

    expect(
      screen.getByRole('button', { name: 'Save as new' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(onUpdate).toHaveBeenCalledWith('v1');
  });

  it('disables saving without an active selection', () => {
    renderPopover({ perimeter: null });
    openPopover();

    expect(
      (screen.getByRole('button', {
        name: 'Save current area',
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText('Draw a perimeter or pin a View to save it.'),
    ).toBeTruthy();
  });

  it('disables new saves when the library is full but still allows Update', () => {
    const full = Array.from({ length: 30 }, (_, index) => ({
      ...perimeterEntry,
      id: `p-${index}`,
      name: `Area ${index}`,
    }));
    full[0] = { ...perimeterEntry, id: 'p-0', name: 'Area 0' };

    renderPopover({ selections: full });
    openPopover();

    expect(
      (screen.getByRole('button', {
        name: 'Save as new',
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Saved library is full \(30\)/),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Update' }),
    ).toBeTruthy();
  });

  it('restores an entry and closes the popover', () => {
    const { onRestore } = renderPopover({ selections: [perimeterEntry] });
    openPopover();

    fireEvent.click(screen.getByRole('button', { name: 'Load Home' }));

    expect(onRestore).toHaveBeenCalledWith('p1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renames an entry', () => {
    const { onRename } = renderPopover({ selections: [perimeterEntry] });
    openPopover();

    fireEvent.click(screen.getByRole('button', { name: 'Rename Home' }));
    const input = screen.getByRole('textbox', { name: 'Rename Home' });
    fireEvent.change(input, { target: { value: 'Field' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onRename).toHaveBeenCalledWith('p1', 'Field');
  });

  it('deletes an entry', () => {
    const { onDelete } = renderPopover({ selections: [perimeterEntry] });
    openPopover();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Home' }));

    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  it('closes on Escape and restores focus to the trigger', () => {
    renderPopover();
    openPopover();
    const trigger = screen.getByRole('button', { name: 'Saved areas' });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on outside clicks but stays open for inside clicks', () => {
    renderPopover();
    const dialog = openPopover();

    fireEvent.mouseDown(dialog);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
