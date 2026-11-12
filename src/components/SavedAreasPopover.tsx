import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import type { BoundingBox, SelectionMode } from '../types';
import type { DirectionalSelection } from '../data/directionalView';
import {
  SAVED_SELECTIONS_LIMIT,
  defaultSavedSelectionName,
  findMatchingSavedSelection,
  type SavedSelection,
  type SavedSelectionKind,
} from '../data/savedSelections';
import { formatClockTime, formatDataAge } from '../data/statusBanner';
import { trapDialogFocus } from './dialogFocus';
import { BookmarkIcon } from './icons';
import {
  buttonBase,
  compactButtonBase,
  cx,
  focusRing,
  inputBase,
  popoverBase,
} from './ui';

interface SavedAreasPopoverProps {
  selections: SavedSelection[];
  mode: SelectionMode;
  perimeter: BoundingBox | null;
  direction: DirectionalSelection | null;
  onSave: (name: string) => void;
  onUpdate: (id: string) => void;
  onRestore: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function kindLabel(kind: SavedSelectionKind): string {
  return kind === 'perimeter' ? 'Perimeter' : 'View';
}

function relativeTime(updatedAt: number): string {
  return formatDataAge(Math.max(0, Date.now() - updatedAt));
}

/**
 * Toolbar library of saved perimeters and directional views.
 *
 * Restoring applies the saved selection through App, which triggers the normal
 * fetch/auto-fit path. Update/Save as appear only when the active selection is
 * representable, and deleting the active entry leaves the selection unsaved.
 */
export function SavedAreasPopover({
  selections,
  mode,
  perimeter,
  direction,
  onSave,
  onUpdate,
  onRestore,
  onRename,
  onDelete,
}: SavedAreasPopoverProps) {
  const [open, setOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const panelId = useId();
  const nameInputId = useId();

  const close = useCallback(() => {
    const shouldRestoreFocus =
      dialogRef.current?.contains(document.activeElement) ?? false;
    setOpen(false);
    setEditingId(null);
    if (shouldRestoreFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      if (!wrapRef.current?.contains(event.target as Node)) close();
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Tab') {
        trapDialogFocus(event, dialogRef.current);
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
    else {
      setNameInput('');
      setEditingId(null);
    }
  }, [open]);

  const activeKind: SavedSelectionKind | null =
    mode === 'direction'
      ? direction
        ? 'direction'
        : null
      : perimeter
        ? 'perimeter'
        : null;
  const activeEntry = findMatchingSavedSelection(selections, {
    mode,
    perimeter,
    direction,
  });
  const full = selections.length >= SAVED_SELECTIONS_LIMIT;
  const canSave = activeKind !== null && !full;
  const defaultName =
    activeKind === null
      ? ''
      : defaultSavedSelectionName(activeKind, selections);
  const saveLabel = activeEntry
    ? 'Save as new'
    : activeKind === 'direction'
      ? 'Save current view'
      : 'Save current area';

  function handleSave(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSave) return;
    onSave(nameInput.trim() || defaultName);
    setNameInput('');
  }

  function startRename(entry: SavedSelection): void {
    setEditingId(entry.id);
    setEditingName(entry.name);
  }

  function handleRename(
    event: FormEvent<HTMLFormElement>,
    entry: SavedSelection,
  ): void {
    event.preventDefault();
    onRename(entry.id, editingName);
    setEditingId(null);
  }

  return (
    <div className="saved-wrap relative flex" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(
          'icon-btn saved-trigger min-h-8 max-[700px]:min-h-9 max-[700px]:w-9 max-[700px]:px-0',
          buttonBase,
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Saved areas"
        title="Saved areas"
        onClick={() => setOpen((value) => !value)}
      >
        <BookmarkIcon className="h-4 w-4" />
        <span className="btn-label max-[700px]:hidden">Saved areas</span>
        {selections.length > 0 && (
          <span className="saved-trigger-count rounded-full bg-accent-strong px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
            {selections.length}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={dialogRef}
          id={panelId}
          className={cx(
            'saved-popover w-[360px] max-[700px]:w-auto',
            popoverBase,
          )}
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
        >
          <div className="saved-heading">
            <h3
              id={headingId}
              className="font-display text-lg font-semibold text-ink"
            >
              Saved areas
            </h3>
            <p className="mt-1 text-[11px] text-muted">
              Named perimeters and directional views are stored in this browser.
            </p>
          </div>

          <form className="saved-save mt-3 grid gap-1" onSubmit={handleSave}>
            <label
              className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted"
              htmlFor={nameInputId}
            >
              Name
            </label>
            <div className="saved-save-row flex gap-1.5">
              <input
                id={nameInputId}
                className={cx('saved-name-input min-w-0 flex-1', inputBase)}
                type="text"
                maxLength={60}
                placeholder={defaultName || 'Name'}
                value={nameInput}
                disabled={!canSave}
                onChange={(event) => setNameInput(event.target.value)}
              />
              <button
                type="submit"
                className={cx('saved-save-btn shrink-0', compactButtonBase)}
                disabled={!canSave}
              >
                {saveLabel}
              </button>
            </div>
          </form>

          {activeEntry && (
            <div className="saved-update mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning-soft/60 px-2.5 py-2 text-[11px] text-muted">
              <p>
                Matches <strong className="text-ink">{activeEntry.name}</strong>.
              </p>
              <button
                type="button"
                className={cx('saved-action-btn shrink-0', compactButtonBase)}
                onClick={() => onUpdate(activeEntry.id)}
              >
                Update
              </button>
            </div>
          )}

          {activeKind === null && (
            <p className="saved-note mt-2 text-[11px] text-warning-ink">
              Draw a perimeter or pin a View to save it.
            </p>
          )}
          {activeKind !== null && full && !activeEntry && (
            <p className="saved-note mt-2 text-[11px] text-warning-ink">
              Saved library is full ({SAVED_SELECTIONS_LIMIT}). Delete an entry
              to save another.
            </p>
          )}
          {activeKind !== null && full && activeEntry && (
            <p className="saved-note mt-2 text-[11px] text-warning-ink">
              Saved library is full ({SAVED_SELECTIONS_LIMIT}). Update this entry
              or delete another before saving a new one.
            </p>
          )}

          {selections.length === 0 ? (
            <p className="saved-empty mt-3 py-3 text-center text-xs text-muted">
              No saved areas yet.
            </p>
          ) : (
            <ul
              className="saved-list scroll-thin mt-3 grid max-h-80 list-none gap-1.5 overflow-y-auto"
              aria-label="Saved areas"
            >
              {selections.map((entry) => {
                const active = activeEntry?.id === entry.id;
                const exactTime = formatClockTime(entry.updatedAt);
                const editing = editingId === entry.id;

                return (
                  <li
                    key={entry.id}
                    className={cx(
                      'saved-item grid gap-1.5 rounded-lg border border-border bg-surface-2 p-2 transition duration-200 hover:scale-[1.01]',
                      active &&
                        'saved-item--active border-warning bg-warning-soft/50',
                    )}
                  >
                    <button
                      type="button"
                      className={cx(
                        'saved-item-main flex flex-wrap items-baseline gap-1.5 bg-transparent p-0 text-left text-inherit',
                        focusRing,
                      )}
                      aria-label={`Load ${entry.name}`}
                      onClick={() => {
                        onRestore(entry.id);
                        close();
                      }}
                    >
                      <span className="saved-kind rounded-full border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-ink">
                        {kindLabel(entry.kind)}
                      </span>
                      <span className="saved-name text-[13px] font-semibold text-ink">
                        {entry.name}
                      </span>
                      {active && (
                        <span className="saved-active text-[9px] font-medium uppercase tracking-wide text-warning-ink">
                          Active
                        </span>
                      )}
                      <span
                        className="saved-time ml-auto text-[10px] text-muted"
                        title={
                          exactTime
                            ? `Last saved or used at ${exactTime}`
                            : undefined
                        }
                      >
                        Used {relativeTime(entry.updatedAt)}
                      </span>
                    </button>

                    <div className="saved-actions flex justify-end gap-1.5">
                      {editing ? (
                        <form
                          className="saved-rename flex w-full gap-1"
                          onSubmit={(event) => handleRename(event, entry)}
                        >
                          <input
                            className={cx('min-w-0 flex-1', inputBase)}
                            type="text"
                            maxLength={60}
                            aria-label={`Rename ${entry.name}`}
                            value={editingName}
                            autoFocus
                            onChange={(event) =>
                              setEditingName(event.target.value)
                            }
                          />
                          <button
                            type="submit"
                            className={compactButtonBase}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className={compactButtonBase}
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={compactButtonBase}
                            onClick={() => startRename(entry)}
                            aria-label={`Rename ${entry.name}`}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            className={cx(
                              'text-danger-ink hover:border-danger/60',
                              compactButtonBase,
                            )}
                            onClick={() => onDelete(entry.id)}
                            aria-label={`Delete ${entry.name}`}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
