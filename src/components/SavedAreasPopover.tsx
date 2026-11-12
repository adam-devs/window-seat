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
    <div className="saved-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn saved-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Saved areas"
        title="Saved areas"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">🔖</span>
        <span className="btn-label">Saved areas</span>

        {selections.length > 0 && (
          <span className="saved-trigger-count">{selections.length}</span>
        )}
      </button>

      {open && (
        <div
          ref={dialogRef}
          id={panelId}
          className="saved-popover"
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
        >
          <div className="saved-heading">
            <h3 id={headingId}>Saved areas</h3>
            <p>Named perimeters and directional views are stored in this browser.</p>
          </div>

          <form className="saved-save" onSubmit={handleSave}>
            <label htmlFor={nameInputId}>Name</label>
            <div className="saved-save-row">
              <input
                id={nameInputId}
                className="saved-name-input"
                type="text"
                maxLength={60}
                placeholder={defaultName || 'Name'}
                value={nameInput}
                disabled={!canSave}
                onChange={(event) => setNameInput(event.target.value)}
              />
              <button
                type="submit"
                className="saved-save-btn"
                disabled={!canSave}
              >
                {saveLabel}
              </button>
            </div>
          </form>

          {activeEntry && (
            <div className="saved-update">
              <p>
                Matches <strong>{activeEntry.name}</strong>.
              </p>
              <button
                type="button"
                className="saved-action-btn"
                onClick={() => onUpdate(activeEntry.id)}
              >
                Update
              </button>
            </div>
          )}

          {activeKind === null && (
            <p className="saved-note">
              Draw a perimeter or pin a View to save it.
            </p>
          )}
          {activeKind !== null && full && !activeEntry && (
            <p className="saved-note">
              Saved library is full ({SAVED_SELECTIONS_LIMIT}). Delete an entry
              to save another.
            </p>
          )}
          {activeKind !== null && full && activeEntry && (
            <p className="saved-note">
              Saved library is full ({SAVED_SELECTIONS_LIMIT}). Update this entry
              or delete another before saving a new one.
            </p>
          )}

          {selections.length === 0 ? (
            <p className="saved-empty">No saved areas yet.</p>
          ) : (
            <ul className="saved-list" aria-label="Saved areas">
              {selections.map((entry) => {
                const active = activeEntry?.id === entry.id;
                const exactTime = formatClockTime(entry.updatedAt);
                const editing = editingId === entry.id;

                return (
                  <li
                    key={entry.id}
                    className={`saved-item${active ? ' saved-item--active' : ''}`}
                  >
                    <button
                      type="button"
                      className="saved-item-main"
                      aria-label={`Load ${entry.name}`}
                      onClick={() => {
                        onRestore(entry.id);
                        close();
                      }}
                    >
                      <span className="saved-kind">
                        {kindLabel(entry.kind)}
                      </span>
                      <span className="saved-name">{entry.name}</span>
                      {active && (
                        <span className="saved-active">Active</span>
                      )}
                      <span
                        className="saved-time"
                        title={
                          exactTime
                            ? `Last saved or used at ${exactTime}`
                            : undefined
                        }
                      >
                        Used {relativeTime(entry.updatedAt)}
                      </span>
                    </button>

                    <div className="saved-actions">
                      {editing ? (
                        <form
                          className="saved-rename"
                          onSubmit={(event) => handleRename(event, entry)}
                        >
                          <input
                            type="text"
                            maxLength={60}
                            aria-label={`Rename ${entry.name}`}
                            value={editingName}
                            autoFocus
                            onChange={(event) =>
                              setEditingName(event.target.value)
                            }
                          />
                          <button type="submit">Save</button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startRename(entry)}
                            aria-label={`Rename ${entry.name}`}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
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
