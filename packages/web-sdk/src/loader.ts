import { DeucalInt } from './index';

/** A classic, deferred script entry. The API is available before consent is granted. */
export interface BrowserAPI {
  consent(granted: boolean): void;
  track(name: string, properties?: Record<string, unknown>): void;
  identify(pseudonymousId: string): void;
  reset(): void;
  flush(): Promise<void>;
  stats(): ReturnType<DeucalInt['stats']>;
  destroy(): void;
}

declare global {
  interface Window {
    deucalint?: BrowserAPI;
  }
}

export function install(
  script: HTMLScriptElement | null = document.currentScript as HTMLScriptElement | null,
): BrowserAPI | undefined {
  // A duplicate embed never instruments the page twice or replaces active consent.
  if (window.deucalint) return window.deucalint;
  if (!script) return;
  const token = script.getAttribute('data-token')?.trim();
  if (!token) return;
  let endpoint: URL;
  try {
    endpoint = new URL(script.getAttribute('data-endpoint') || '.', script.src || location.href);
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      return;
    endpoint.search = '';
    endpoint.hash = '';
  } catch {
    return;
  }
  const sdk = new DeucalInt().init({
    projectToken: token,
    endpoint: endpoint.href.replace(/\/$/, ''),
    consent: script.getAttribute('data-consent') === 'granted',
    respectDNT: true,
    replay: script.getAttribute('data-replay') === 'true',
    release: script.getAttribute('data-release') || undefined,
  });
  const api: BrowserAPI = Object.freeze({
    consent: (granted: boolean) => sdk.consent(granted === true),
    track: (name: string, properties?: Record<string, unknown>) => sdk.track(name, properties),
    identify: (id: string) => sdk.identify(id),
    reset: () => sdk.reset(),
    flush: () => sdk.flush(),
    stats: () => sdk.stats(),
    destroy: () => {
      sdk.destroy();
      delete window.deucalint;
    },
  });
  window.deucalint = api;
  window.dispatchEvent(new CustomEvent('deucalint:ready'));
  return api;
}

install();
