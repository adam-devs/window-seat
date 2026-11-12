import type { StatusBannerModel } from '../data/statusBanner';
import {
  AlertTriangleIcon,
  InfoIcon,
  RefreshIcon,
  WifiOffIcon,
} from './icons';
import { cx } from './ui';

interface StatusBannerProps {
  model: StatusBannerModel | null;
  onRefresh: () => void;
  refreshing: boolean;
}

const TONE_CLASSES = {
  info: 'border-l-accent bg-accent-soft text-accent-ink',
  warning: 'border-l-warning bg-warning-soft text-warning-ink',
  error: 'border-l-danger bg-danger-soft text-danger-ink',
} as const;

const TONE_ICONS = {
  info: InfoIcon,
  warning: AlertTriangleIcon,
  error: AlertTriangleIcon,
} as const;

/**
 * Non-destructive status banner rendered above the map.
 *
 * It explains stale, error, rate-limited, and offline states without hiding
 * last-good aircraft. Errors use an alert role; recoverable states announce
 * politely through a status role.
 */
export function StatusBanner({
  model,
  onRefresh,
  refreshing,
}: StatusBannerProps) {
  if (!model) return null;

  const isAlert = model.tone === 'error';
  const Icon = model.title.includes('offline')
    ? WifiOffIcon
    : TONE_ICONS[model.tone];

  return (
    <div
      className={cx(
        'status-banner flex shrink-0 items-center gap-3 border-b border-l-4 border-b-border px-4 py-2 text-[13px]',
        `status-banner--${model.tone}`,
        TONE_CLASSES[model.tone],
      )}
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <div className="status-banner-text flex min-w-0 flex-wrap items-baseline gap-2">
        <strong className="font-semibold">{model.title}</strong>
        {model.detail && (
          <span className="status-banner-detail opacity-90">
            {model.detail}
          </span>
        )}
      </div>
      {model.showRefresh && (
        <button
          type="button"
          className="status-banner-action ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-xs font-medium transition hover:bg-white/20 disabled:opacity-50"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshIcon
            className={cx('h-3.5 w-3.5', refreshing && 'animate-spin')}
          />
          {refreshing ? 'Retrying…' : 'Retry now'}
        </button>
      )}
    </div>
  );
}
