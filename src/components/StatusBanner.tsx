import type { StatusBannerModel } from '../data/statusBanner';

interface StatusBannerProps {
  model: StatusBannerModel | null;
  onRefresh: () => void;
  refreshing: boolean;
}

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

  return (
    <div
      className={`status-banner status-banner--${model.tone}`}
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
    >
      <div className="status-banner-text">
        <strong>{model.title}</strong>
        {model.detail && (
          <span className="status-banner-detail">{model.detail}</span>
        )}
      </div>
      {model.showRefresh && (
        <button
          type="button"
          className="status-banner-action"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Retrying…' : 'Retry now'}
        </button>
      )}
    </div>
  );
}
