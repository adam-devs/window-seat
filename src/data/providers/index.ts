import { config } from '../../config';
import type { FlightProvider, ProviderId } from '../types';
import { createOpenSkyProvider } from './opensky';

/**
 * Provider registry.
 *
 * Construction is lazy and cached so the rest of the app never imports a
 * concrete adapter. Adding a provider means extending `ProviderId` and adding a
 * factory here; no UI or hook changes.
 */
const factories: Record<ProviderId, () => FlightProvider> = {
  opensky: () => createOpenSkyProvider(),
};

const instances = new Map<ProviderId, FlightProvider>();

/** Return the cached provider, creating it on first use. */
export function getProvider(id: ProviderId = config.providerId): FlightProvider {
  const existing = instances.get(id);
  if (existing) return existing;

  const factory = factories[id];
  if (!factory) throw new Error(`Unknown flight provider: ${String(id)}`);

  const provider = factory();
  instances.set(id, provider);
  return provider;
}

/** IDs registered in the app, for settings/debug surfaces. */
export function listProviderIds(): ProviderId[] {
  return Object.keys(factories) as ProviderId[];
}

/** Test-only hook: drop cached instances so factories run again. */
export function resetProviderRegistry(): void {
  instances.clear();
}
