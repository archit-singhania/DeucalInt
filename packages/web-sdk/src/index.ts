import { onCLS, onINP, onLCP, onTTFB } from 'web-vitals';
export interface Event {
  eventId: string;
  schemaVersion: 1;
  type: string;
  name: string;
  timestamp: string;
  anonymousId: string;
  sessionId: string;
  page?: Record<string, unknown>;
  context?: Record<string, unknown>;
  device?: Record<string, unknown>;
  properties: Record<string, unknown>;
}
export interface Options {
  projectToken: string;
  endpoint: string;
  consent?: boolean;
  respectDNT?: boolean;
  replay?: boolean;
  release?: string;
  batchSize?: number;
  flushInterval?: number;
  /** Resource metadata only: URLs omit query strings, fragments, and hostnames. */
  resourceTiming?: boolean;
}
const SESSION_TIMEOUT = 30 * 60 * 1000;
const sensitive =
  /password|secret|token|authorization|cookie|email|phone|credit|card|cvv|input|^value$|^text$|^html$|^stack$|^message$/i;
export function sanitize(input: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth limit]';
  if (Array.isArray(input)) return input.slice(0, 100).map((x) => sanitize(x, depth + 1));
  if (input && typeof input === 'object')
    return Object.fromEntries(
      Object.entries(input)
        .slice(0, 100)
        .map(([k, v]) => [k, sensitive.test(k) ? '[redacted]' : sanitize(v, depth + 1)]),
    );
  if (typeof input === 'string')
    return input
      .slice(0, 2000)
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
      .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[number]')
      .replace(/bearer\s+\S+/gi, '[credential]');
  return input;
}
export class DeucalInt {
  private options!: Options;
  private queue: Event[] = [];
  private anonymousId = '';
  private sessionId = '';
  private lastActivity = 0;
  private timer?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private cleanups: (() => void)[] = [];
  private allowed = false;
  private inFlight = false;
  private attempts = 0;
  private nativeFetch?: typeof fetch;
  private dropped = 0;
  private generation = 0;
  private get key() {
    return 'deucalint:' + this.options.projectToken;
  }
  private get queueKey() {
    return this.key + ':queue';
  }
  init(options: Options) {
    this.destroy();
    this.queue = [];
    this.options = options;
    this.allowed =
      options.consent === true && !(options.respectDNT !== false && navigator.doNotTrack === '1');
    if (!this.allowed) return this;
    this.nativeFetch = window.fetch.bind(window);
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) || '{}');
      this.anonymousId =
        typeof saved.anonymousId === 'string' ? saved.anonymousId : crypto.randomUUID();
      this.sessionId =
        typeof saved.sessionId === 'string' &&
        Date.now() - Number(saved.lastActivity) < SESSION_TIMEOUT
          ? saved.sessionId
          : crypto.randomUUID();
      // Each tab owns its queue so another tab cannot overwrite unacknowledged events.
      const queued = JSON.parse(
        sessionStorage.getItem(this.queueKey) || JSON.stringify(saved.queue || []),
      );
      this.queue = Array.isArray(queued)
        ? queued
            .filter(
              (event) =>
                event &&
                typeof event.eventId === 'string' &&
                event.schemaVersion === 1 &&
                event.anonymousId === this.anonymousId,
            )
            .slice(-500)
        : [];
    } catch {
      this.anonymousId = crypto.randomUUID();
      this.sessionId = crypto.randomUUID();
    }
    this.lastActivity = Date.now();
    this.page();
    this.instrument();
    this.timer = setInterval(() => void this.flush(), options.flushInterval || 5000);
    return this;
  }
  consent(granted: boolean) {
    if (granted && this.allowed) return;
    const opts = { ...this.options, consent: granted };
    if (!granted) {
      try {
        localStorage.removeItem(this.key);
        sessionStorage.removeItem(this.queueKey);
      } catch {}
      this.queue = [];
    }
    this.init(opts);
  }
  track(name: string, properties: Record<string, unknown> = {}, type = 'product') {
    if (!this.allowed) return;
    this.syncSession();
    this.lastActivity = Date.now();
    const ua = navigator.userAgent;
    const browser = /Firefox/.test(ua)
      ? 'Firefox'
      : /Edg/.test(ua)
        ? 'Edge'
        : /Chrome/.test(ua)
          ? 'Chrome'
          : 'Safari';
    const event: Event = {
      eventId: crypto.randomUUID(),
      schemaVersion: 1,
      type,
      name,
      timestamp: new Date().toISOString(),
      anonymousId: this.anonymousId,
      sessionId: this.sessionId,
      page: {
        path: sanitize(location.pathname),
        url: sanitize(location.origin + location.pathname),
        referrer: this.safeReferrer(),
      },
      device: {
        type: innerWidth < 768 ? 'mobile' : 'desktop',
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
      },
      context: {
        library: '@deucalint/web',
        libraryVersion: '0.1.0',
        browser,
        release: this.options.release || 'development',
      },
      properties: sanitize(properties) as Record<string, unknown>,
    };
    if (this.queue.length >= 500) {
      this.queue.shift();
      this.dropped++;
    }
    this.queue.push(event);
    this.persist();
    if (this.queue.length >= (this.options.batchSize || 20)) void this.flush();
  }
  page() {
    this.track('page_view', {}, 'page');
  }
  identify(pseudonymousId: string) {
    this.track('identify', { userId: pseudonymousId }, 'identity');
  }
  reset() {
    if (!this.allowed) return;
    this.queue = [];
    this.anonymousId = crypto.randomUUID();
    this.sessionId = crypto.randomUUID();
    this.lastActivity = Date.now();
    this.persist();
  }
  experiment(name: string, variant: string) {
    this.track(name, { variant }, 'experiment');
  }
  feature(name: string, enabled: boolean) {
    this.track('feature_exposure', { feature: name, enabled });
  }
  stats() {
    return { queued: this.queue.length, dropped: this.dropped, consent: this.allowed };
  }
  private persist() {
    if (!this.allowed) return;
    try {
      localStorage.setItem(
        this.key,
        JSON.stringify({
          anonymousId: this.anonymousId,
          sessionId: this.sessionId,
          lastActivity: this.lastActivity,
        }),
      );
    } catch {}
    try {
      sessionStorage.setItem(this.queueKey, JSON.stringify(this.queue));
    } catch {}
  }
  private syncSession() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) || '{}');
      if (typeof saved.anonymousId === 'string') this.anonymousId = saved.anonymousId;
      if (
        typeof saved.sessionId === 'string' &&
        Date.now() - Number(saved.lastActivity) < SESSION_TIMEOUT
      ) {
        this.sessionId = saved.sessionId;
        this.lastActivity = Number(saved.lastActivity);
      }
    } catch {}
    if (Date.now() - this.lastActivity > SESSION_TIMEOUT) this.sessionId = crypto.randomUUID();
  }
  private safeReferrer() {
    try {
      const url = new URL(document.referrer);
      return sanitize(url.origin + url.pathname);
    } catch {
      return '';
    }
  }
  async flush() {
    if (!this.allowed || this.inFlight || !this.queue.length || !navigator.onLine) return;
    this.inFlight = true;
    const generation = this.generation;
    const batch = this.queue.slice(0, Math.min(this.options.batchSize || 20, 100));
    try {
      const res = await this.nativeFetch!(this.options.endpoint.replace(/\/$/, '') + '/v1/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectToken: this.options.projectToken,
          deliveryId: crypto.randomUUID(),
          events: batch,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (generation !== this.generation) return;
      if (!res.ok) {
        if ([400, 413, 401, 403].includes(res.status)) {
          this.dropped += batch.length;
          this.queue = this.queue.filter((e) => !batch.some((b) => b.eventId === e.eventId));
          this.persist();
        }
        throw new Error('Delivery failed');
      }
      this.queue = this.queue.filter((e) => !batch.some((b) => b.eventId === e.eventId));
      this.attempts = 0;
      this.persist();
    } catch {
      if (generation === this.generation) {
        clearTimeout(this.retry);
        this.retry = setTimeout(
          () => void this.flush(),
          Math.min(60000, 1000 * 2 ** this.attempts++) + Math.random() * 1000,
        );
      }
    } finally {
      if (generation === this.generation) this.inFlight = false;
    }
  }
  private on(target: EventTarget, name: string, handler: EventListener) {
    target.addEventListener(name, handler, { passive: true });
    this.cleanups.push(() => target.removeEventListener(name, handler));
  }
  private snapshot() {
    if (!this.options.replay || !this.allowed) return;
    const nodes = Array.from(document.querySelectorAll('header,h1,h2,p,button,input,img,section'))
      .filter((el) => !el.closest('[data-analytics-ignore]'))
      .slice(0, 100)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          x: Math.max(0, r.x),
          y: Math.max(0, r.y),
          width: r.width,
          height: r.height,
          masked: true,
        };
      });
    this.track('snapshot', { nodes, width: innerWidth, height: innerHeight }, 'replay');
  }
  private instrument() {
    const instrumentationGeneration = this.generation;
    this.on(window, 'storage', (event) => {
      const update = event as StorageEvent;
      // Revocation in any tab immediately stops capture in every active tab.
      if ((update.key === this.key || update.key === null) && update.newValue === null) {
        this.queue = [];
        try {
          sessionStorage.removeItem(this.queueKey);
        } catch {}
        this.destroy();
      } else if (update.key === this.key && update.newValue) {
        try {
          const shared = JSON.parse(update.newValue);
          if (typeof shared.anonymousId === 'string' && shared.anonymousId !== this.anonymousId) {
            this.queue = [];
            sessionStorage.removeItem(this.queueKey);
            this.anonymousId = shared.anonymousId;
            this.sessionId = shared.sessionId;
            this.lastActivity = Number(shared.lastActivity);
          }
        } catch {}
      }
    });
    this.on(window, 'online', () => void this.flush());
    this.on(window, 'popstate', () => this.page());
    const push = history.pushState,
      replace = history.replaceState;
    const wrappedPush: History['pushState'] = (...args) => {
      push.apply(history, args);
      this.page();
    };
    const wrappedReplace: History['replaceState'] = (...args) => {
      replace.apply(history, args);
      this.page();
    };
    history.pushState = wrappedPush;
    history.replaceState = wrappedReplace;
    this.cleanups.push(() => {
      if (history.pushState === wrappedPush) history.pushState = push;
      if (history.replaceState === wrappedReplace) history.replaceState = replace;
    });
    this.on(document, 'click', (event) => {
      const el = event.target;
      if (!(el instanceof Element)) return;
      if (el.closest('[data-analytics-ignore],[data-analytics-mask]')) return;
      const action = el.closest('[data-deucalint-event]')?.getAttribute('data-deucalint-event');
      this.track(action?.slice(0, 100) || 'click', { tag: el.tagName.toLowerCase() });
    });
    this.on(document, 'submit', (event) => {
      if (
        event.target instanceof Element &&
        !event.target.closest('[data-analytics-ignore],[data-analytics-mask]')
      )
        this.track('form_submit');
    });
    let maxDepth = 0;
    this.on(window, 'scroll', () => {
      const depth = Math.min(
        100,
        Math.round(
          (((scrollY + innerHeight) / Math.max(document.documentElement.scrollHeight, 1)) * 100) /
            25,
        ) * 25,
      );
      if (depth > maxDepth) {
        maxDepth = depth;
        this.track('scroll_depth', { percent: depth });
      }
    });
    this.on(window, 'error', () =>
      this.track('JavaScriptError', { fingerprint: 'window-error' }, 'error'),
    );
    this.on(window, 'unhandledrejection', () =>
      this.track('UnhandledPromiseRejection', {}, 'error'),
    );
    const original = window.fetch;
    const wrapped: typeof fetch = async (...args) => {
      const start = performance.now();
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      const own = url.includes('/v1/batch');
      try {
        const response = await original(...args);
        if (!own && instrumentationGeneration === this.generation)
          this.track(
            'fetch',
            {
              path: new URL(url, location.href).pathname,
              status: response.status,
              duration: Math.round(performance.now() - start),
            },
            'network',
          );
        return response;
      } catch (error) {
        if (!own && instrumentationGeneration === this.generation)
          this.track(
            'fetch',
            {
              path: new URL(url, location.href).pathname,
              status: 0,
              duration: Math.round(performance.now() - start),
            },
            'network',
          );
        throw error;
      }
    };
    window.fetch = wrapped;
    this.cleanups.push(() => {
      if (window.fetch === wrapped) window.fetch = original;
    });
    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    const requests = new WeakMap<XMLHttpRequest, { path: string; method: string }>();
    const sdk = this;
    const wrappedOpen = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      requests.set(this, { path: new URL(String(url), location.href).pathname, method });
      return (xhrOpen as Function).apply(this, [method, url, ...rest]);
    };
    const wrappedSend = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const start = performance.now();
      const info = requests.get(this);
      this.addEventListener(
        'loadend',
        () => {
          if (
            info &&
            !info.path.includes('/v1/batch') &&
            instrumentationGeneration === sdk.generation
          )
            sdk.track(
              'xhr',
              { ...info, status: this.status, duration: Math.round(performance.now() - start) },
              'network',
            );
        },
        { once: true },
      );
      return xhrSend.call(this, body);
    };
    XMLHttpRequest.prototype.open = wrappedOpen as typeof xhrOpen;
    XMLHttpRequest.prototype.send = wrappedSend;
    this.cleanups.push(() => {
      if (XMLHttpRequest.prototype.open === wrappedOpen) XMLHttpRequest.prototype.open = xhrOpen;
      if (XMLHttpRequest.prototype.send === wrappedSend) XMLHttpRequest.prototype.send = xhrSend;
    });
    const vitalsGeneration = this.generation;
    if (this.options.resourceTiming !== false && typeof PerformanceObserver !== 'undefined') {
      try {
        let captured = 0;
        const resources = new PerformanceObserver((list) => {
          if (vitalsGeneration !== this.generation) return;
          for (const item of list.getEntries()) {
            const resource = item as PerformanceResourceTiming;
            if (
              captured >= 50 ||
              ['fetch', 'xmlhttprequest', 'beacon'].includes(resource.initiatorType)
            )
              continue;
            let path: string;
            try {
              path = new URL(resource.name, location.href).pathname;
            } catch {
              continue;
            }
            captured++;
            this.track(
              'resource_timing',
              {
                path,
                initiator: resource.initiatorType,
                duration: Math.round(resource.duration),
                transferSize: resource.transferSize,
                encodedSize: resource.encodedBodySize,
                decodedSize: resource.decodedBodySize,
              },
              'performance',
            );
          }
        });
        resources.observe({ type: 'resource', buffered: true });
        this.cleanups.push(() => resources.disconnect());
      } catch {
        /* Resource timing is optional in older browsers. */
      }
    }
    for (const observe of [onCLS, onINP, onLCP, onTTFB]) {
      try {
        observe((metric) => {
          if (vitalsGeneration !== this.generation) return;
          this.track(
            'web_vital',
            {
              [metric.name.toLowerCase()]: metric.value,
              rating: metric.rating,
              metricId: metric.id,
            },
            'performance',
          );
        });
      } catch {
        /* Older browsers may not expose the required performance entries. */
      }
    }
    this.on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.beacon();
    });
    this.on(window, 'pagehide', () => this.beacon());
    this.snapshot();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (this.options.replay) {
      const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = setTimeout(() => this.snapshot(), 1000);
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      this.cleanups.push(() => {
        observer.disconnect();
        clearTimeout(timeout);
      });
    }
  }
  private beacon() {
    if (!this.allowed || !this.queue.length) return;
    const body = JSON.stringify({
      projectToken: this.options.projectToken,
      events: this.queue.slice(0, 20),
    });
    if (new Blob([body]).size < 60000)
      navigator.sendBeacon(
        this.options.endpoint.replace(/\/$/, '') + '/v1/batch',
        new Blob([body], { type: 'application/json' }),
      ); /* Keep queue until acknowledged; server deduplicates. */
  }
  destroy() {
    this.generation++;
    this.inFlight = false;
    clearInterval(this.timer);
    clearTimeout(this.retry);
    this.cleanups.splice(0).forEach((fn) => fn());
    this.allowed = false;
  }
}
export const analytics = new DeucalInt();
