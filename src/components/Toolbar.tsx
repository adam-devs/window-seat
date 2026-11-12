import type { BudgetStatus } from '../data/budget';
import type { Cadence } from '../data/policy';
import { SELECTION_MODE_LABELS } from '../data/directionalView';
import { selectionInstruction } from '../data/selectionInstructions';
import type { SelectionMode } from '../types';
import type { UnitSystem } from '../workspace';
import { SettingsPopover } from './SettingsPopover';

interface ToolbarProps {
  onRefresh: () => void;
  onClear: () => void;
  mode: SelectionMode;
  onModeChange: (mode: SelectionMode) => void;
  hasPerimeter: boolean;
  hasDirection: boolean;
  hasPendingOrigin: boolean;
  loading: boolean;
  autoRefreshMs: number;
  units: UnitSystem;
  cadence: Cadence | null;
  budget: BudgetStatus;
  onAutoRefreshChange: (ms: number) => void;
  onUnitsChange: (units: UnitSystem) => void;
  onResetSettings: () => void;
}

const MODES: SelectionMode[] = ['perimeter', 'direction'];

export function Toolbar({
  onRefresh,
  onClear,
  mode,
  onModeChange,
  hasPerimeter,
  hasDirection,
  hasPendingOrigin,
  loading,
  autoRefreshMs,
  units,
  cadence,
  budget,
  onAutoRefreshChange,
  onUnitsChange,
  onResetSettings,
}: ToolbarProps) {
  const instruction = selectionInstruction({
    mode,
    hasPerimeter,
    hasDirection,
    hasPendingOrigin,
  });

  return (
    <div className="toolbar">
      <div className="mode-switch" role="group" aria-label="Selection mode">
        {MODES.map((option) => (
          <button
            key={option}
            type="button"
            className={`mode-btn${mode === option ? ' mode-btn--active' : ''}`}
            aria-pressed={mode === option}
            onClick={() => onModeChange(option)}
          >
            {SELECTION_MODE_LABELS[option]}
          </button>
        ))}
      </div>

      <div className="perimeter-instructions">
        <span aria-live="polite">{instruction}</span>
        <button className="clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>

      {/* Refresh */}
      <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
        {loading ? '⏳' : '🔄'} Refresh
      </button>

      <SettingsPopover
        autoRefreshMs={autoRefreshMs}
        units={units}
        cadence={cadence}
        budget={budget}
        onChange={onAutoRefreshChange}
        onUnitsChange={onUnitsChange}
        onReset={onResetSettings}
      />
    </div>
  );
}
