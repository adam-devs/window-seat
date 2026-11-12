// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Toolbar } from './Toolbar';
import type { BudgetStatus } from '../data/budget';

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
  perimeterInstructions?: boolean;
  loading?: boolean;
  onRefresh?: () => void;
  onClear?: () => void;
}

function renderToolbar(options: RenderToolbarOptions = {}) {
  const onRefresh = options.onRefresh ?? vi.fn();
  const onClear = options.onClear ?? vi.fn();

  const view = render(
    <Toolbar
      onRefresh={onRefresh}
      onClear={onClear}
      perimeterInstructions={options.perimeterInstructions ?? true}
      loading={options.loading ?? false}
      autoRefreshMs={30_000}
      cadence={null}
      budget={budget}
      onAutoRefreshChange={vi.fn()}
      onResetSettings={vi.fn()}
    />,
  );

  return { ...view, onRefresh, onClear };
}

afterEach(cleanup);

describe('Toolbar', () => {
  it('shows perimeter-only drawing instructions', () => {
    const { rerender } = renderToolbar({ perimeterInstructions: true });

    expect(
      screen.getByText(
        'Click two corners on the map to draw your search box.',
      ),
    ).toBeTruthy();

    rerender(
      <Toolbar
        onRefresh={vi.fn()}
        onClear={vi.fn()}
        perimeterInstructions={false}
        loading={false}
        autoRefreshMs={30_000}
        cadence={null}
        budget={budget}
        onAutoRefreshChange={vi.fn()}
        onResetSettings={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'Perimeter set — click two new corners to redraw.',
      ),
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
