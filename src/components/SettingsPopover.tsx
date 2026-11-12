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
import {
  DEFAULT_SETTINGS,
  REFRESH_OPTIONS_MS,
  formatInterval,
} from '../settings';
import { unitsLabel } from '../data/units';
import type { UnitSystem } from '../workspace';

interface SettingsPopoverProps {
  autoRefreshMs: number;
  units: UnitSystem;
  cadence: Cadence | null;
  budget: BudgetStatus;
  onChange: (ms: number) => void;
  onUnitsChange: (units: UnitSystem) => void;
  onReset: () => void;
}

function credits(value: number): string {
  return value.toLocaleString();
}

/**
 * Toolbar popover for the automatic refresh interval.
 *
 * Changes apply and persist immediately (the hook reschedules the pending poll
 * without reloading). The popover also explains the effective interval when
 * the provider floor or budget lengthens it, and shows today's credit usage.
 */
export function SettingsPopover({
  autoRefreshMs,
  units,
  cadence,
  budget,
  onChange,
  onUnitsChange,
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

  return (
    <div className="settings-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn settings-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Refresh settings"
        title="Refresh settings"
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⚙</span> Settings
      </button>

      {open && (
        <div
          ref={dialogRef}
          id={panelId}
          className="settings-popover"
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
        >
          <div className="settings-heading">
            <h3 id={headingId}>Refresh settings</h3>
            <p>Changes apply immediately and are remembered in this browser.</p>
          </div>

          <fieldset className="settings-group">
            <legend>Automatic refresh</legend>
            {REFRESH_OPTIONS_MS.map((ms) => (
              <label className="settings-option" key={ms}>
                <input
                  type="radio"
                  name="refresh-interval"
                  value={ms}
                  checked={autoRefreshMs === ms}
                  onChange={() => onChange(ms)}
                />
                <span>{formatInterval(ms)}</span>
                {ms === DEFAULT_SETTINGS.autoRefreshMs && (
                  <span className="settings-default">Default</span>
                )}
              </label>
            ))}
          </fieldset>

          <fieldset className="settings-group">
            <legend>Units</legend>
            {(['aviation', 'metric'] as const).map((option) => (
              <label className="settings-option" key={option}>
                <input
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

          <div
            className={`settings-status ${paused ? 'settings-status--paused' : ''}`}
            aria-live="polite"
          >
            {describeEffectiveCadence(cadence)}
          </div>

          <div className="settings-budget">
            <p>
              Credits today{' '}
              <strong>
                {credits(budget.spent)} / {credits(budget.dailyBudget)}
              </strong>
            </p>
            <p>
              Remaining <strong>{credits(budget.remaining)}</strong>
            </p>
            <p>
              Auto-pause at{' '}
              <strong>{credits(autoPauseThreshold(budget))}</strong>
            </p>
          </div>

          <button
            type="button"
            className="settings-reset"
            onClick={onReset}
          >
            Reset to default
          </button>
        </div>
      )}
    </div>
  );
}
