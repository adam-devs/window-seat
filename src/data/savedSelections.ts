import type { BoundingBox, SelectionMode } from '../types';
import {
  normalizeDirectionalSelection,
  type DirectionalSelection,
} from './directionalView';
import { parseBoundingBox } from './geometry';

/**
 * Saved perimeter and View library.
 *
 * Entries are validated independently so one corrupt record cannot reset the
 * whole workspace. The library is bounded, IDs are stable local strings, and
 * timestamps are stored for ordering.
 */

export const SAVED_SELECTIONS_LIMIT = 30;
export const SAVED_SELECTION_NAME_MAX = 60;
const SAVED_SELECTION_ID_MAX = 120;

export type SavedSelectionKind = 'perimeter' | 'direction';

interface SavedSelectionBase {
  /** Stable local identifier, unique within the library. */
  id: string;
  name: string;
  /** Epoch ms when the entry was first saved. */
  createdAt: number;
  /** Epoch ms of the last save/rename. */
  updatedAt: number;
}

export interface SavedPerimeter extends SavedSelectionBase {
  kind: 'perimeter';
  perimeter: BoundingBox;
}

export interface SavedDirection extends SavedSelectionBase {
  kind: 'direction';
  direction: DirectionalSelection;
}

export type SavedSelection = SavedPerimeter | SavedDirection;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function parseId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0
    ? null
    : trimmed.slice(0, SAVED_SELECTION_ID_MAX);
}

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0
    ? null
    : trimmed.slice(0, SAVED_SELECTION_NAME_MAX);
}

/** Validate one saved entry, dropping malformed records. */
export function parseSavedSelection(value: unknown): SavedSelection | null {
  if (!isRecord(value)) return null;

  const id = parseId(value.id);
  const name = parseName(value.name);
  const createdAt = parseTimestamp(value.createdAt);
  const updatedAt = parseTimestamp(value.updatedAt);
  if (id === null || name === null || createdAt === null || updatedAt === null) {
    return null;
  }

  const timestamps = {
    createdAt,
    updatedAt: Math.max(createdAt, updatedAt),
  };

  if (value.kind === 'perimeter') {
    const perimeter = parseBoundingBox(value.perimeter);
    if (!perimeter) return null;
    return { id, name, kind: 'perimeter', perimeter, ...timestamps };
  }

  if (value.kind === 'direction') {
    const direction = normalizeDirectionalSelection(value.direction);
    if (!direction) return null;
    return { id, name, kind: 'direction', direction, ...timestamps };
  }

  return null;
}

/**
 * Validate a persisted library.
 *
 * Invalid or duplicate IDs are skipped, valid entries keep their order, and the
 * result is capped so a corrupt/oversized value cannot grow without bound.
 */
export function parseSavedSelections(value: unknown): SavedSelection[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: SavedSelection[] = [];
  for (const entry of value) {
    if (result.length >= SAVED_SELECTIONS_LIMIT) break;
    const parsed = parseSavedSelection(entry);
    if (!parsed || seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    result.push(parsed);
  }
  return result;
}

/** Generate a stable local ID, with a fallback for older browsers. */
export function createSavedSelectionId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `saved-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function defaultNameBase(kind: SavedSelectionKind): string {
  return kind === 'perimeter' ? 'Perimeter' : 'View';
}

/** Smallest unused default name, e.g. `Perimeter 1` or `View 2`. */
export function defaultSavedSelectionName(
  kind: SavedSelectionKind,
  selections: SavedSelection[],
  excludeId?: string,
): string {
  const base = defaultNameBase(kind);
  const used = new Set(
    selections
      .filter((selection) => selection.id !== excludeId)
      .map((selection) => nameKey(selection.name)),
  );

  let index = 1;
  while (used.has(nameKey(`${base} ${index}`))) index += 1;
  return `${base} ${index}`;
}

/**
 * Normalize a desired name and make it unique.
 *
 * Empty names fall back to the next default. Duplicates get a ` (2)`-style
 * suffix; the result never exceeds the stored name limit.
 */
export function uniqueSavedSelectionName(
  desired: string,
  kind: SavedSelectionKind,
  selections: SavedSelection[],
  excludeId?: string,
): string {
  const trimmed = desired.trim().slice(0, SAVED_SELECTION_NAME_MAX);
  if (trimmed.length === 0) {
    return defaultSavedSelectionName(kind, selections, excludeId);
  }

  const used = new Set(
    selections
      .filter((selection) => selection.id !== excludeId)
      .map((selection) => nameKey(selection.name)),
  );
  if (!used.has(nameKey(trimmed))) return trimmed;

  let suffixNumber = 2;
  while (true) {
    const suffix = ` (${suffixNumber})`;
    const candidate = `${trimmed.slice(
      0,
      SAVED_SELECTION_NAME_MAX - suffix.length,
    )}${suffix}`;
    if (!used.has(nameKey(candidate))) return candidate;
    suffixNumber += 1;
  }
}

function safeNow(now: number): number {
  return Number.isFinite(now) && now >= 0 ? Math.floor(now) : Date.now();
}

function freshId(selections: SavedSelection[], requested?: string): string {
  const candidate = requested?.trim();
  if (candidate && !selections.some((selection) => selection.id === candidate)) {
    return candidate.slice(0, SAVED_SELECTION_ID_MAX);
  }

  let id = createSavedSelectionId();
  while (selections.some((selection) => selection.id === id)) {
    id = createSavedSelectionId();
  }
  return id;
}

export interface CreateSavedSelectionOptions {
  id?: string;
  name?: string;
  now?: number;
}

/** Build a saved perimeter with a normalized box and unique name. */
export function createSavedPerimeter(
  perimeter: BoundingBox,
  selections: SavedSelection[],
  options: CreateSavedSelectionOptions = {},
): SavedPerimeter | null {
  const box = parseBoundingBox(perimeter);
  if (!box) return null;

  const now = safeNow(options.now ?? Date.now());
  const name = uniqueSavedSelectionName(
    options.name ?? '',
    'perimeter',
    selections,
  );

  return {
    id: freshId(selections, options.id),
    name,
    kind: 'perimeter',
    perimeter: box,
    createdAt: now,
    updatedAt: now,
  };
}

/** Build a saved directional view with normalized geometry and unique name. */
export function createSavedDirection(
  direction: DirectionalSelection,
  selections: SavedSelection[],
  options: CreateSavedSelectionOptions = {},
): SavedDirection | null {
  const parsed = normalizeDirectionalSelection(direction);
  if (!parsed) return null;

  const now = safeNow(options.now ?? Date.now());
  const name = uniqueSavedSelectionName(
    options.name ?? '',
    'direction',
    selections,
  );

  return {
    id: freshId(selections, options.id),
    name,
    kind: 'direction',
    direction: parsed,
    createdAt: now,
    updatedAt: now,
  };
}

export function isSavedSelectionLibraryFull(
  selections: SavedSelection[],
): boolean {
  return selections.length >= SAVED_SELECTIONS_LIMIT;
}

/**
 * Append a valid, uniquely named entry.
 *
 * Returns the original array when the library is full, the entry is malformed,
 * or its ID already exists.
 */
export function addSavedSelection(
  selections: SavedSelection[],
  entry: SavedSelection,
): SavedSelection[] {
  if (isSavedSelectionLibraryFull(selections)) return selections;

  const parsed = parseSavedSelection(entry);
  if (!parsed) return selections;
  if (selections.some((selection) => selection.id === parsed.id)) {
    return selections;
  }

  const name = uniqueSavedSelectionName(parsed.name, parsed.kind, selections);
  return [...selections, { ...parsed, name }];
}

/** Rename an entry and bump `updatedAt`; unknown IDs are a no-op. */
export function renameSavedSelection(
  selections: SavedSelection[],
  id: string,
  name: string,
  now: number = Date.now(),
): SavedSelection[] {
  const index = selections.findIndex((selection) => selection.id === id);
  if (index < 0) return selections;

  const existing = selections[index];
  const nextName = uniqueSavedSelectionName(
    name,
    existing.kind,
    selections,
    id,
  );
  if (nextName === existing.name) return selections;

  const updated = parseSavedSelection({
    ...existing,
    name: nextName,
    updatedAt: Math.max(existing.createdAt, safeNow(now)),
  });
  if (!updated) return selections;

  const next = [...selections];
  next[index] = updated;
  return next;
}

/**
 * Mark an entry as used by raising `updatedAt` to at least `now`.
 *
 * Restoring a saved selection calls this so the popover can show a last-used
 * time without adding a separate timestamp field.
 */
export function touchSavedSelection(
  selections: SavedSelection[],
  id: string,
  now: number = Date.now(),
): SavedSelection[] {
  const index = selections.findIndex((selection) => selection.id === id);
  if (index < 0) return selections;

  const existing = selections[index];
  const updatedAt = Math.max(existing.updatedAt, safeNow(now));
  if (updatedAt === existing.updatedAt) return selections;

  const next = [...selections];
  next[index] = { ...existing, updatedAt };
  return next;
}

/** Remove an entry by ID; unknown IDs are a no-op. */
export function deleteSavedSelection(
  selections: SavedSelection[],
  id: string,
): SavedSelection[] {
  const next = selections.filter((selection) => selection.id !== id);
  return next.length === selections.length ? selections : next;
}

/**
 * Replace an entry's geometry/name while preserving its ID and creation time.
 *
 * The kind cannot change; mismatched or malformed updates are a no-op.
 */
export function updateSavedSelection(
  selections: SavedSelection[],
  id: string,
  entry: SavedSelection,
  now: number = Date.now(),
): SavedSelection[] {
  const index = selections.findIndex((selection) => selection.id === id);
  if (index < 0) return selections;

  const existing = selections[index];
  const parsed = parseSavedSelection(entry);
  if (!parsed || parsed.kind !== existing.kind) return selections;

  const name = uniqueSavedSelectionName(
    parsed.name,
    existing.kind,
    selections,
    id,
  );
  const updated = parseSavedSelection({
    ...parsed,
    id,
    name,
    createdAt: existing.createdAt,
    updatedAt: Math.max(existing.createdAt, safeNow(now)),
  });
  if (!updated) return selections;

  const next = [...selections];
  next[index] = updated;
  return next;
}

export interface ActiveSavedSelection {
  mode: SelectionMode;
  perimeter: BoundingBox | null;
  direction: DirectionalSelection | null;
}

function boxesEqual(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.lamin === b.lamin &&
    a.lomin === b.lomin &&
    a.lamax === b.lamax &&
    a.lomax === b.lomax
  );
}

function directionsEqual(
  a: DirectionalSelection,
  b: DirectionalSelection,
): boolean {
  return (
    a.origin.latitude === b.origin.latitude &&
    a.origin.longitude === b.origin.longitude &&
    a.bearingDeg === b.bearingDeg &&
    a.angleDeg === b.angleDeg &&
    a.visibilityKm === b.visibilityKm
  );
}

/** True when a saved entry exactly represents the active selection. */
export function savedSelectionMatches(
  entry: SavedSelection,
  active: ActiveSavedSelection,
): boolean {
  if (active.mode === 'direction') {
    return (
      entry.kind === 'direction' &&
      active.direction !== null &&
      directionsEqual(entry.direction, active.direction)
    );
  }

  return (
    entry.kind === 'perimeter' &&
    active.perimeter !== null &&
    boxesEqual(entry.perimeter, active.perimeter)
  );
}

/** First saved entry matching the active perimeter or View, if any. */
export function findMatchingSavedSelection(
  selections: SavedSelection[],
  active: ActiveSavedSelection,
): SavedSelection | null {
  return (
    selections.find((entry) => savedSelectionMatches(entry, active)) ?? null
  );
}
