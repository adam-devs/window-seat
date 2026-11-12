// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsPopover } from './SettingsPopover';
import type { BudgetStatus } from '../data/budget';
import type { Cadence } from '../data/policy';
import type { DirectionalSelection } from '../data/directionalView';
import type { SelectionMode } from '../types';

const view: DirectionalSelection = {
  origin: { latitude: 51.5, longitude: -0.1 },
  bearingDeg: 90,
  angleDeg: 60,
  visibilityKm: 100,
};

const crossingView: DirectionalSelection = {
  origin: { latitude: 0, longitude: 179.9 },
  bearingDeg: 90,
  angleDeg: 60,
  visibilityKm: 100,
};

const cadence: Cadence = {
  intervalMs: 30_000,
  reason: 'user',
  paused: false,
  throttled: false,
  userIntervalMs: 30_000,
  providerMinIntervalMs: 10_000,
  costPerRequest: 1,
  dailyBudget: 4_000,
  budgetPauseRatio: 0.9,
  usableBudget: 3_600,
  spentToday: 1_234,
  remainingBudget: 2_766,
  budgetSafeIntervalMs: 30_000,
  dailyCost: 2_880,
  msUntilReset: 43_200_000,
};

const budget: BudgetStatus = {
  providerId: 'opensky',
  day: '2026-11-12',
  configuredBudget: 4_000,
  dailyBudget: 4_000,
  budgetPauseRatio: 0.9,
  usableBudget: 3_600,
  spent: 1_234,
  requests: 1_234,
  providerRemaining: null,
  observedBudget: null,
  remaining: 2_766,
  autoRemaining: 2_366,
  autoPaused: false,
  manualAvailable: true,
  resetAt: Date.now() + 43_200_000,
  msUntilReset: 43_200_000,
  updatedAt: Date.now(),
};

function renderPopover(overrides: Partial<{
  autoRefreshMs: number;
  units: 'aviation' | 'metric';
  cadence: Cadence | null;
  budget: BudgetStatus;
  mode: SelectionMode;
  direction: DirectionalSelection | null;
  onChange: (ms: number) => void;
  onUnitsChange: (units: 'aviation' | 'metric') => void;
  onVisibilityChange: (km: number) => void;
  onReset: () => void;
}> = {}) {
  const onChange = overrides.onChange ?? vi.fn();
  const onUnitsChange = overrides.onUnitsChange ?? vi.fn();
  const onVisibilityChange = overrides.onVisibilityChange ?? vi.fn();
  const onReset = overrides.onReset ?? vi.fn();

  render(
    <SettingsPopover
      autoRefreshMs={overrides.autoRefreshMs ?? 30_000}
      units={overrides.units ?? 'aviation'}
      mode={overrides.mode ?? 'perimeter'}
      direction={overrides.direction ?? null}
      cadence={overrides.cadence === undefined ? cadence : overrides.cadence}
      budget={overrides.budget ?? budget}
      onChange={onChange}
      onUnitsChange={onUnitsChange}
      onVisibilityChange={onVisibilityChange}
      onReset={onReset}
    />,
  );

  return { onChange, onUnitsChange, onVisibilityChange, onReset };
}

function openPopover(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  return screen.getByRole('dialog');
}

afterEach(cleanup);

describe('SettingsPopover', () => {
  it('opens a labelled dialog with all refresh options', () => {
    renderPopover();
    expect(screen.queryByRole('dialog')).toBeNull();

    const dialog = openPopover();

    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByText('Display settings')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /15 s/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /1 min/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /2 min/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /5 min/ })).toBeTruthy();
  });

  it('marks the persisted interval and the default option', () => {
    renderPopover({ autoRefreshMs: 60_000 });
    openPopover();

    const selected = screen.getByRole('radio', {
      name: /1 min/,
    }) as HTMLInputElement;
    expect(selected.checked).toBe(true);

    const defaultValue = screen.getByRole('radio', {
      name: /30 s/,
    }) as HTMLInputElement;
    expect(defaultValue.checked).toBe(false);
    expect(screen.getByText('Default')).toBeTruthy();
  });

  it('applies a new interval immediately through the callback', () => {
    const { onChange } = renderPopover();
    openPopover();

    fireEvent.click(screen.getByRole('radio', { name: /1 min/ }));

    expect(onChange).toHaveBeenCalledWith(60_000);
  });

  it('changes the display units', () => {
    const { onUnitsChange } = renderPopover({ units: 'aviation' });
    openPopover();

    const metric = screen.getByRole('radio', {
      name: /Metric/,
    }) as HTMLInputElement;
    expect(metric.checked).toBe(false);
    fireEvent.click(metric);

    expect(onUnitsChange).toHaveBeenCalledWith('metric');
  });

  it('resets to the default interval', () => {
    const { onReset } = renderPopover({ autoRefreshMs: 300_000 });
    openPopover();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('shows the effective interval when the budget lengthens it', () => {
    renderPopover({
      cadence: {
        ...cadence,
        intervalMs: 180_000,
        reason: 'budget',
        throttled: true,
      },
    });
    openPopover();

    expect(
      screen.getByText(
        'Effective interval: 3 min (limited by today’s budget)',
      ),
    ).toBeTruthy();
  });

  it('announces a paused cadence', () => {
    renderPopover({
      cadence: {
        ...cadence,
        intervalMs: Infinity,
        reason: 'budget',
        paused: true,
      },
    });
    openPopover();

    expect(
      screen.getByText(/paused because today’s budget is used/),
    ).toBeTruthy();
    expect(
      document.querySelector('.settings-status')!.className,
    ).toContain('settings-status--paused');
  });

  it('shows today’s credits, remaining credits, and the pause threshold', () => {
    renderPopover();
    openPopover();

    expect(screen.getByText('1,234 / 4,000')).toBeTruthy();
    expect(screen.getByText('2,766')).toBeTruthy();
    expect(screen.getByText('3,600')).toBeTruthy();
    expect(screen.getByText(/Credits today/)).toBeTruthy();
    expect(screen.getByText(/Auto-pause at/)).toBeTruthy();
  });

  it('closes on Escape and restores focus to the trigger', () => {
    renderPopover();
    openPopover();
    const trigger = screen.getByRole('button', { name: 'Settings' });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when clicking outside but stays open for inside clicks', () => {
    renderPopover();
    const dialog = openPopover();

    fireEvent.mouseDown(dialog);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toggles closed from the trigger', () => {
    renderPopover();
    openPopover();

    fireEvent.click(
      screen.getByRole('button', { name: 'Settings' }),
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows disabled View distances until a view is pinned', () => {
    renderPopover({ mode: 'direction' });
    openPopover();

    for (const km of [25, 50, 100, 200]) {
      const radio = screen.getByRole('radio', {
        name: `${km} km`,
      }) as HTMLInputElement;
      expect(radio.disabled).toBe(true);
    }
    expect(
      (screen.getByRole('radio', { name: '100 km' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      screen.getByText('Pin a view on the map to set its distance.'),
    ).toBeTruthy();
  });

  it('does not show View distance in Perimeter mode', () => {
    renderPopover({ mode: 'perimeter' });
    openPopover();

    expect(screen.queryByText('View distance')).toBeNull();
    expect(screen.queryByRole('radio', { name: '50 km' })).toBeNull();
  });

  it('changes the View distance', () => {
    const { onVisibilityChange } = renderPopover({
      mode: 'direction',
      direction: view,
    });
    openPopover();

    fireEvent.click(screen.getByRole('radio', { name: '50 km' }));

    expect(onVisibilityChange).toHaveBeenCalledWith(50);
  });

  it('shows the effective area cost and warns about a large view', () => {
    renderPopover({ mode: 'direction', direction: crossingView });
    openPopover();

    const area = document.querySelector('.settings-view-area');
    expect(area?.textContent).toContain('View area');
    expect(area?.textContent).toContain('sq°');
    expect(area?.textContent).toContain('credits per request');
    expect(
      document.querySelector('.settings-view-warning')?.textContent,
    ).toContain('Large view');
  });

  it('disables distances beyond the normal provider limit', () => {
    renderPopover({ mode: 'direction', direction: crossingView });
    openPopover();

    expect(
      (screen.getByRole('radio', { name: /200 km/ }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('radio', { name: /25 km/ }) as HTMLInputElement)
        .disabled,
    ).toBe(false);
    expect(screen.getByText('Too large')).toBeTruthy();
  });
});
