import type { BudgetStatus } from '../data/budget';
import type { Cadence } from '../data/policy';
import {
  SELECTION_MODE_LABELS,
  type DirectionalSelection,
} from '../data/directionalView';
import { selectionInstruction } from '../data/selectionInstructions';
import type { SavedSelection } from '../data/savedSelections';
import type { BoundingBox, SelectionMode } from '../types';
import type { UnitSystem } from '../workspace';
import { SavedAreasPopover } from './SavedAreasPopover';
import { SettingsPopover } from './SettingsPopover';

interface ToolbarProps {
  onRefresh: () => void;
  onClear: () => void;
  mode: SelectionMode;
  onModeChange: (mode: SelectionMode) => void;
  perimeter: BoundingBox | null;
  hasDirection: boolean;
  hasPendingOrigin: boolean;
  direction: DirectionalSelection | null;
  savedSelections: SavedSelection[];
  loading: boolean;
  autoRefreshMs: number;
  units: UnitSystem;
  cadence: Cadence | null;
  budget: BudgetStatus;
  onAutoRefreshChange: (ms: number) => void;
  onUnitsChange: (units: UnitSystem) => void;
  onVisibilityChange: (km: number) => void;
  onSaveSelection: (name: string) => void;
  onUpdateSelection: (id: string) => void;
  onRestoreSelection: (id: string) => void;
  onRenameSelection: (id: string, name: string) => void;
  onDeleteSelection: (id: string) => void;
  onResetSettings: () => void;
}

const MODES: SelectionMode[] = ['perimeter', 'direction'];

export function Toolbar({
  onRefresh,
  onClear,
  mode,
  onModeChange,
  perimeter,
  hasDirection,
  hasPendingOrigin,
  direction,
  savedSelections,
  loading,
  autoRefreshMs,
  units,
  cadence,
  budget,
  onAutoRefreshChange,
  onUnitsChange,
  onVisibilityChange,
  onSaveSelection,
  onUpdateSelection,
  onRestoreSelection,
  onRenameSelection,
  onDeleteSelection,
  onResetSettings,
}: ToolbarProps) {
  const instruction = selectionInstruction({
    mode,
    hasPerimeter: perimeter !== null,
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
        <span className="keyboard-hint" aria-hidden="true">
          Arrows pan · Enter selects
        </span>
        <button type="button" className="clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>

      {/* Refresh */}
      <button
        type="button"
        className="refresh-btn"
        onClick={onRefresh}
        disabled={loading}
        aria-busy={loading}
        aria-label="Refresh"
      >
        <span aria-hidden="true">{loading ? '⏳' : '🔄'}</span>
        <span className="btn-label">Refresh</span>
      </button>

      <SavedAreasPopover
        selections={savedSelections}

        mode={mode}
        perimeter={perimeter}
        direction={direction}
        onSave={onSaveSelection}
        onUpdate={onUpdateSelection}
        onRestore={onRestoreSelection}
        onRename={onRenameSelection}
        onDelete={onDeleteSelection}
      />

      <SettingsPopover
        autoRefreshMs={autoRefreshMs}
        units={units}
        mode={mode}
        direction={direction}
        cadence={cadence}
        budget={budget}
        onChange={onAutoRefreshChange}
        onUnitsChange={onUnitsChange}
        onVisibilityChange={onVisibilityChange}
        onReset={onResetSettings}
      />
    </div>
  );
}
