import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { BudgetStatus } from '../data/budget';
import type { Cadence } from '../data/policy';
import {
  autoPauseThreshold,
  describeEffectiveCadence,
} from '../data/settingsView';
import { DEFAULT_VISIBILITY_KM } from '../data/directionalView';
import {
  VIEW_DISTANCE_OPTIONS_KM,
  describeViewArea,
  viewDistanceOptions,
} from '../data/viewDistance';
import type { DirectionalSelection } from '../data/directionalView';
import type { SelectionMode } from '../types';
import {
  DEFAULT_SETTINGS,
  REFRESH_OPTIONS_MS,
  formatInterval,
} from '../settings';
import { unitsLabel } from '../data/units';
import type { UnitSystem } from '../workspace';
import { trapDialogFocus } from './dialogFocus';
import { SettingsIcon } from './icons';
import { buttonBase, cx, popoverBase } from './ui';

interface SettingsPopoverProps {
  autoRefreshMs: number;
  units: UnitSystem;
  mode: SelectionMode;
  direction: DirectionalSelection | null;
  cadence: Cadence | null;
  budget: BudgetStatus;
  onChange: (ms: number) => void;
  onUnitsChange: (units: UnitSystem) => void;
  onVisibilityChange: (km: number) => void;
  onReset: () => void;
}

function credits(value: number): string {
  return value.toLocaleString();
}

/**
 * Toolbar popover for display and refresh settings.
 *
 * Changes apply and persist immediately. In View mode it also exposes the
 * visibility distance and the effective provider cost for the cone's bounding
 * box; distances outside the normal credit range are disabled before choosing.
 */
export function SettingsPopover({
  autoRefreshMs,
  units,
  mode,
  direction,
  cadence,
  budget,
  onChange,
  onUnitsChange,
  onVisibilityChange,
  onReset,
}: SettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const panelId = useId();

  const close = useCallback(() => {
    const shouldRestoreFocus =
      dialogRef.current?.contains(document.activeElement) ?? false;
    setOpen(false);
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
  }, [open]);

  const paused = cadence?.paused ?? false;
  const visibilityKm = direction?.visibilityKm ?? DEFAULT_VISIBILITY_KM;
  const distanceOptions = direction ? viewDistanceOptions(direction) : null;
  const viewArea = direction ? describeViewArea(direction) : null;

  return (
    <div className="settings-wrap relative flex" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(
          'icon-btn settings-trigger min-h-8 max-[700px]:min-h-9 max-[700px]:w-9 max-[700px]:px-0',
          buttonBase,
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen((value) => !value)}
      >
        <SettingsIcon className="h-4 w-4" />
        <span className="btn-label max-[700px]:hidden">Settings</span>
      </button>

      {open && (
        <div
          ref={dialogRef}
          id={panelId}
          className={cx(
            'settings-popover w-[320px] max-[700px]:w-auto',
            popoverBase,
          )}
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
        >
          <div className="settings-heading">
            <h3
              id={headingId}
              className="font-display text-lg font-semibold text-ink"
            >
              Display settings
            </h3>
            <p className="mt-1 text-[11px] text-muted">
              Changes apply immediately and are remembered in this browser.
            </p>
          </div>

          <fieldset className="settings-group mt-3 border-0">
            <legend className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              Automatic refresh
            </legend>
            {REFRESH_OPTIONS_MS.map((ms) => (
              <label
                className="settings-option flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink transition hover:bg-surface-2"
                key={ms}
              >
                <input
                  className="accent-accent-strong"
                  type="radio"
                  name="refresh-interval"
                  value={ms}
                  checked={autoRefreshMs === ms}
                  onChange={() => onChange(ms)}
                />
                <span>{formatInterval(ms)}</span>
                {ms === DEFAULT_SETTINGS.autoRefreshMs && (
                  <span className="settings-default ml-auto text-[10px] uppercase tracking-wide text-muted">
                    Default
                  </span>
                )}
              </label>
            ))}
          </fieldset>

          <fieldset className="settings-group mt-3 border-0">
            <legend className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
              Units
            </legend>
            {(['aviation', 'metric'] as const).map((option) => (
              <label
                className="settings-option flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink transition hover:bg-surface-2"
                key={option}
              >
                <input
                  className="accent-accent-strong"
                  type="radio"
                  name="units"
                  value={option}
                  checked={units === option}
                  onChange={() => onUnitsChange(option)}
                />
                <span>{unitsLabel(option)}</span>
              </label>
            ))}
          </fieldset>

          {mode === 'direction' && (
            <fieldset className="settings-group mt-3 border-0">
              <legend className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted">
                View distance
              </legend>
              {!direction && (
                <p className="settings-note mb-1 text-[11px] text-muted">
                  Pin a view on the map to set its distance.
                </p>
              )}
              {VIEW_DISTANCE_OPTIONS_KM.map((km) => {
                const option = distanceOptions?.find(
                  (candidate) => candidate.km === km,
                );
                const disabled =
                  !direction || (option?.exceedsLimit ?? false);
                return (
                  <label
                    className={cx(
                      'settings-option flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink transition hover:bg-surface-2',
                      disabled &&
                        'settings-option--disabled cursor-default opacity-50 hover:bg-transparent',
                    )}
                    key={km}
                  >
                    <input
                      className="accent-accent-strong"
                      type="radio"
                      name="view-distance"
                      value={km}
                      checked={visibilityKm === km}
                      disabled={disabled}
                      onChange={() => onVisibilityChange(km)}
                    />
                    <span>{km} km</span>
                    {option?.exceedsLimit && (
                      <span className="settings-option-note ml-auto text-[10px] uppercase tracking-wide text-warning-ink">
                        Too large
                      </span>
                    )}
                  </label>
                );
              })}
              {viewArea && (
                <p
                  className={cx(
                    'settings-view-area mt-1 grid gap-0.5 border-t border-border pt-2 text-[11px] text-muted',
                    `settings-view-area--${viewArea.level}`,
                    viewArea.level === 'warn' && 'text-warning-ink',
                    viewArea.level === 'over-limit' && 'text-danger-ink',
                  )}
                  aria-live="polite"
                >
                  <span>{viewArea.text}</span>
                  {viewArea.warning && (
                    <span className="settings-view-warning font-semibold">
                      {viewArea.warning}
                    </span>
                  )}
                </p>
              )}
            </fieldset>
          )}

          <div
            className={cx(
              'settings-status mt-3 border-t border-border pt-2 text-xs text-muted',
              paused && 'settings-status--paused text-warning-ink',
            )}
            aria-live="polite"
          >
            {describeEffectiveCadence(cadence)}
          </div>

          <div className="settings-budget mt-2 grid gap-1 text-xs text-muted">
            <p>
              Credits today{' '}
              <strong className="font-semibold text-ink">
                {credits(budget.spent)} / {credits(budget.dailyBudget)}
              </strong>
            </p>
            <p>
              Remaining{' '}
              <strong className="font-semibold text-ink">
                {credits(budget.remaining)}
              </strong>
            </p>
            <p>
              Auto-pause at{' '}
              <strong className="font-semibold text-ink">
                {credits(autoPauseThreshold(budget))}
              </strong>
            </p>
          </div>

          <button
            type="button"
            className={cx('settings-reset mt-3 w-full', buttonBase)}
            onClick={onReset}
          >
            Reset to default
          </button>
        </div>
      )}
    </div>
  );
}
