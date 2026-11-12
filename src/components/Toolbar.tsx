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
import { ConeIcon, RefreshIcon, TargetIcon } from './icons';
import { buttonBase, compactButtonBase, cx } from './ui';

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

const MODE_ICONS = {
  perimeter: TargetIcon,
  direction: ConeIcon,
} as const;

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
    <div className="toolbar relative z-[1000] flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2.5 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.625rem,env(safe-area-inset-top))] shadow-hairline max-[700px]:gap-2 max-[700px]:px-3 max-[700px]:pl-[max(0.75rem,env(safe-area-inset-left))] max-[700px]:pr-[max(0.75rem,env(safe-area-inset-right))]">
      <div
        className="mode-switch inline-flex items-center gap-0.5 rounded-xl border border-border bg-surface-2 p-0.5"
        role="group"
        aria-label="Selection mode"
      >
        {MODES.map((option) => {
          const Icon = MODE_ICONS[option];
          const active = mode === option;
          return (
            <button
              key={option}
              type="button"
              className={cx(
                'mode-btn inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface max-[700px]:min-h-9',
                active
                  ? 'mode-btn--active bg-accent-strong text-white shadow-sm'
                  : 'text-muted hover:bg-surface hover:text-ink',
              )}
              aria-pressed={active}
              onClick={() => onModeChange(option)}
            >
              <Icon className="h-3.5 w-3.5" />
              {SELECTION_MODE_LABELS[option]}
            </button>
          );
        })}
      </div>

      <div className="perimeter-instructions flex items-center gap-2.5 text-[13px] text-muted max-[700px]:order-10 max-[700px]:basis-full max-[700px]:justify-between max-[700px]:text-xs">
        <span aria-live="polite">{instruction}</span>
        <span className="keyboard-hint border-l border-border pl-2.5 text-[11px] text-muted max-[700px]:hidden">
          Arrows pan · Enter selects
        </span>
        <button
          type="button"
          className={cx(
            'clear-btn min-h-8 border-border bg-surface-2 text-ink',
            compactButtonBase,
          )}
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      {/* Refresh */}
      <button
        type="button"
        className={cx(
          'refresh-btn min-h-8 max-[700px]:min-h-9 max-[700px]:w-9 max-[700px]:px-0',
          buttonBase,
        )}
        onClick={onRefresh}
        disabled={loading}
        aria-busy={loading}
        aria-label="Refresh"
      >
        <RefreshIcon
          className={cx('h-4 w-4', loading && 'animate-spin')}
        />
        <span className="btn-label max-[700px]:hidden">Refresh</span>
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
