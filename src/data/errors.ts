/** Error taxonomy shared by providers and the request policy. */
export type ProviderErrorKind =
  | 'aborted'
  | 'unauthorized'
  | 'rate-limited'
  | 'server'
  | 'http'
  | 'network'
  | 'bad-response';

export interface ProviderErrorInit {
  status?: number;
  /** Suggested wait before retrying, in ms (from `Retry-After` headers). */
  retryAfterMs?: number;
  originalError?: unknown;
}

/**
 * Normalises transport and HTTP failures so the hook/policy can branch on
 * `kind` instead of parsing messages or provider-specific responses.
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly originalError?: unknown;

  constructor(kind: ProviderErrorKind, message: string, init: ProviderErrorInit = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
    this.originalError = init.originalError;
  }
}

export function isProviderError(
  error: unknown,
  kind?: ProviderErrorKind,
): error is ProviderError {
  return error instanceof ProviderError && (kind === undefined || error.kind === kind);
}

/** True for our abort kind and for native `AbortError`s. */
export function isAbortError(error: unknown): boolean {
  if (error instanceof ProviderError) return error.kind === 'aborted';
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  return error instanceof Error && error.name === 'AbortError';
}
