import { useState } from 'react';
import type { SelectionMode } from '../types';
import type { BudgetStatus } from '../data/budget';
import type { Cadence } from '../data/policy';
import { SettingsPopover } from './SettingsPopover';

interface ToolbarProps {
  mode: SelectionMode;
  onModeChange: (mode: SelectionMode) => void;
  radiusKm: number;
  onRadiusChange: (r: number) => void;
  onLocationSearch: (query: string) => void;
  onUseMyLocation: () => void;
  onRefresh: () => void;
  onClear: () => void;
  perimeterInstructions: boolean;
  loading: boolean;
  autoRefreshMs: number;
  cadence: Cadence | null;
  budget: BudgetStatus;
  onAutoRefreshChange: (ms: number) => void;
  onResetSettings: () => void;
}

export function Toolbar({
  mode,
  onModeChange,
  radiusKm,
  onRadiusChange,
  onLocationSearch,
  onUseMyLocation,
  onRefresh,
  onClear,
  perimeterInstructions,
  loading,
  autoRefreshMs,
  cadence,
  budget,
  onAutoRefreshChange,
  onResetSettings,
}: ToolbarProps) {
  const [query, setQuery] = useState('');

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) onLocationSearch(query.trim());
  }

  return (
    <div className="toolbar">
      {/* Mode tabs */}
      <div className="mode-tabs">
        <button
          className={`tab-btn ${mode === 'location' ? 'active' : ''}`}
          onClick={() => onModeChange('location')}
        >
          📍 Location
        </button>
        <button
          className={`tab-btn ${mode === 'perimeter' ? 'active' : ''}`}
          onClick={() => onModeChange('perimeter')}
        >
          ⬜ Draw Perimeter
        </button>
      </div>

      {/* Location mode controls */}
      {mode === 'location' && (
        <div className="location-controls">
          <form className="search-form" onSubmit={handleSearch}>
            <input
              className="search-input"
              type="text"
              placeholder="Search city or place…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="search-btn" type="submit">Go</button>
          </form>
          <button className="icon-btn" onClick={onUseMyLocation} title="Use my location">
            🎯 My Location
          </button>
          <label className="radius-label">
            Radius: {radiusKm} km
            <input
              type="range"
              min={50}
              max={500}
              step={25}
              value={radiusKm}
              onChange={(e) => onRadiusChange(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      {/* Perimeter mode instructions */}
      {mode === 'perimeter' && (
        <div className="perimeter-instructions">
          {perimeterInstructions
            ? '🖱 Click two corners on the map to draw your search box'
            : '✅ Perimeter set — click two new corners to redraw'}
          <button className="clear-btn" onClick={onClear}>Clear</button>
        </div>
      )}

      {/* Refresh */}
      <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
        {loading ? '⏳' : '🔄'} Refresh
      </button>

      <SettingsPopover
        autoRefreshMs={autoRefreshMs}
        cadence={cadence}
        budget={budget}
        onChange={onAutoRefreshChange}
        onReset={onResetSettings}
      />
    </div>
  );
}
