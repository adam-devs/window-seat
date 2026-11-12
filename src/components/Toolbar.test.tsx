// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toolbar } from './Toolbar';
import type { BudgetStatus } from '../data/budget';
import type { SelectionMode } from '../types';

const budget: BudgetStatus = {
  providerId: 'opensky',
  day: '2026-11-12',
  configuredBudget: 4_000,
  dailyBudget: 4_000,
  budgetPauseRatio: 0.9,
  usableBudget: 3_600,
  spent: 100,
  requests: 100,
  providerRemaining: null,
  observedBudget: null,
  remaining: 3_900,
  autoRemaining: 3_500,
  autoPaused: false,
  manualAvailable: true,
  resetAt: Date.now() + 43_200_000,
  msUntilReset: 43_200_000,
  updatedAt: Date.now(),
};

interface RenderToolbarOptions {
  mode?: SelectionMode;
  hasPerimeter?: boolean;
  hasDirection?: boolean;
  hasPendingOrigin?: boolean;
  loading?: boolean;
  onRefresh?: () => void;
  onClear?: () => void;
  onModeChange?: (mode: SelectionMode) => void;
}

function renderToolbar(options: RenderToolbarOptions = {}) {
  const onRefresh = options.onRefresh ?? vi.fn();
  const onClear = options.onClear ?? vi.fn();
  const onModeChange = options.onModeChange ?? vi.fn();
  const onUnitsChange = vi.fn();

  const view = render(
    <Toolbar
      onRefresh={onRefresh}
      onClear={onClear}
      mode={options.mode ?? 'perimeter'}
      onModeChange={onModeChange}
      hasPerimeter={options.hasPerimeter ?? false}
      hasDirection={options.hasDirection ?? false}
      hasPendingOrigin={options.hasPendingOrigin ?? false}
      loading={options.loading ?? false}
      autoRefreshMs={30_000}
      units="aviation"
      cadence={null}
      budget={budget}
      onAutoRefreshChange={vi.fn()}
      onUnitsChange={onUnitsChange}
      onResetSettings={vi.fn()}
    />,
  );

  return { ...view, onRefresh, onClear, onModeChange, onUnitsChange };
}

afterEach(cleanup);

describe('Toolbar', () => {
  it('shows perimeter drawing instructions', () => {
    renderToolbar({ mode: 'perimeter', hasPerimeter: true });

    expect(
      screen.getByText('Perimeter set — click two new corners to redraw.'),
    ).toBeTruthy();
  });

  it('offers Perimeter and View modes and reports mode changes', () => {
    const { onModeChange } = renderToolbar();

    const perimeter = screen.getByRole('button', { name: 'Perimeter' });
    const view = screen.getByRole('button', { name: 'View' });

    expect(perimeter.getAttribute('aria-pressed')).toBe('true');
    expect(view.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(view);
    expect(onModeChange).toHaveBeenCalledWith('direction');

    fireEvent.click(perimeter);
    expect(onModeChange).toHaveBeenCalledWith('perimeter');
  });

  it('shows the View pin and bearing instructions', () => {
    const { rerender } = renderToolbar({ mode: 'direction' });

    expect(
      screen.getByText(
        'Click the map to pin an origin, then click again to aim the view.',
      ),
    ).toBeTruthy();

    rerender(
      <Toolbar
        onRefresh={vi.fn()}
        onClear={vi.fn()}
        mode="direction"
        onModeChange={vi.fn()}
        hasPerimeter={false}
        hasDirection={false}
        hasPendingOrigin
        loading={false}
        autoRefreshMs={30_000}
        units="aviation"
        cadence={null}
        budget={budget}
        onAutoRefreshChange={vi.fn()}
        onUnitsChange={vi.fn()}
        onResetSettings={vi.fn()}
      />,
    );
    expect(
      screen.getByText('Origin pinned — click again to aim the view.'),
    ).toBeTruthy();
  });

  it('does not render location, search, or radius controls', () => {
    renderToolbar();

    expect(screen.queryByText(/Location/)).toBeNull();
    expect(screen.queryByText(/My Location/)).toBeNull();
    expect(screen.queryByText(/Radius/)).toBeNull();
    expect(document.querySelector('.search-input')).toBeNull();
    expect(document.querySelector('.radius-label')).toBeNull();
  });

  it('wires Clear and Refresh', () => {
    const { onClear, onRefresh } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: /Refresh$/ }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables Refresh while a request is in flight', () => {
    renderToolbar({ loading: true });

    const refresh = screen.getByRole('button', { name: /Refresh$/ });
    expect((refresh as HTMLButtonElement).disabled).toBe(true);
  });
});
