import type { BudgetStatus } from '../data/budget';
import type { Cadence } from '../data/policy';
import type { UnitSystem } from '../workspace';
import { SettingsPopover } from './SettingsPopover';

interface ToolbarProps {
  onRefresh: () => void;
  onClear: () => void;
  perimeterInstructions: boolean;
  loading: boolean;
  autoRefreshMs: number;
  units: UnitSystem;
  cadence: Cadence | null;
  budget: BudgetStatus;
  onAutoRefreshChange: (ms: number) => void;
  onUnitsChange: (units: UnitSystem) => void;
  onResetSettings: () => void;
}

export function Toolbar({
  onRefresh,
  onClear,
  perimeterInstructions,
  loading,
  autoRefreshMs,
  units,
  cadence,
  budget,
  onAutoRefreshChange,
  onUnitsChange,
  onResetSettings,
}: ToolbarProps) {
  return (
    <div className="toolbar">
      {/* Perimeter is the only selection mode. */}
      <div className="perimeter-instructions">
        {perimeterInstructions
          ? 'Click two corners on the map to draw your search box.'
          : 'Perimeter set — click two new corners to redraw.'}
        <button className="clear-btn" onClick={onClear}>Clear</button>
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
