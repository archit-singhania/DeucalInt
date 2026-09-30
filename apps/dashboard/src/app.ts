import { Component, OnInit, OnDestroy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeucalInt } from '../../../packages/web-sdk/src/index';
import template from './app.html?raw';

@Component({ selector: 'di-root', standalone: true, imports: [CommonModule], template })
export class AppComponent implements OnInit, OnDestroy {
  private cdr = inject(ChangeDetectorRef);
  private hashChanged = () => {
    const next = location.hash.slice(1) || 'overview';
    if (next !== 'demo') this.stopDemoCapture();
    this.view = next;
    void this.refresh();
  };
  nav = [
    {
      group: 'WORKSPACE',
      items: [
        ['overview', 'Overview', '◫'],
        ['live', 'Live activity', '◉'],
        ['investigate', 'Investigations', '✧'],
      ],
    },
    {
      group: 'PRODUCT ANALYTICS',
      items: [
        ['funnels', 'Funnels', '▽'],
        ['retention', 'Retention', '▦'],
        ['journeys', 'Journeys', '⑂'],
        ['experiments', 'Experiments', '⚗'],
      ],
    },
    {
      group: 'OBSERVABILITY',
      items: [
        ['sessions', 'Sessions & replay', '▣'],
        ['observability', 'Errors & performance', '⌁'],
        ['alerts', 'Alerts', '♧'],
      ],
    },
    {
      group: 'MANAGE',
      items: [
        ['settings', 'Project settings', '⚙'],
        ['demo', 'Demo commerce', '↗'],
      ],
    },
  ];
  view = location.hash.slice(1) || 'overview';
  project = 'demo';
  days = 7;
  browser = 'All browsers';
  projects: any[] = [];
  data: any = null;
  detail: any = null;
  live: any = { active: 0, events: [] };
  loading = true;
  error = '';
  toast = '';
  loggedIn = false;
  authChecked = false;
  role = 'owner';
  password = 'deucalint-local';
  source?: EventSource;
  connected = false;
  requestId = 0;
  question = 'Why did checkout conversion drop?';
  investigation: any = null;
  investigating = false;
  evidence: any = null;
  selectedSession: any = null;
  replayIndex = 0;
  playing = false;
  playback?: ReturnType<typeof setInterval>;
  alertMetric = 'errors';
  threshold = 5;
  retentionDays = 90;
  deletionKind = 'visitor';
  deletionValue = '';
  rotatedToken = '';
  demoToken = 'pk_demo_deucalint';
  sdk?: DeucalInt;
  consent = false;
  fault = false;
  cart = 0;
  orderStatus = '';
  search = '';
  reportName = '';
  reports: any[] = [];
  funnelSteps = 'page_view, product_viewed, checkout_started, purchase_completed';
  funnelOrdered = true;
  funnelWindow = 1800;
  get title() {
    return this.nav.flatMap((g) => g.items).find((x) => x[0] === this.view)?.[1] || 'Overview';
  }
  get subtitle() {
    return (
      {
        overview: 'Every signal. One clear picture.',
        live: 'Your product, as it happens.',
        investigate: 'Go from a change in metrics to a story backed by evidence.',
        funnels: 'Find the moments that move people forward.',
        retention: 'Understand what brings your users back.',
        journeys: 'See the paths behind the numbers.',
        experiments: 'Measure the impact of every idea.',
        sessions: 'The human story behind every session.',
        observability: 'Connect product behavior to technical performance.',
        alerts: 'Know when the metrics that matter change.',
        settings: 'A little control goes a long way.',
        demo: 'Create real events. Watch the story unfold.',
      } as Record<string, string>
    )[this.view];
  }
  get segment() {
    return this.browser === 'All browsers'
      ? null
      : { dimension: 'browser', operator: 'eq', value: this.browser };
  }
  get query() {
    return (
      `project=${this.project}&days=${this.days}` +
      (this.segment ? '&segment=' + encodeURIComponent(JSON.stringify(this.segment)) : '')
    );
  }
  async ngOnInit() {
    try {
      const me = await this.api('/api/me');
      this.role = me.role;
      this.loggedIn = true;
      await this.start();
    } catch {
    } finally {
      this.authChecked = true;
      this.loading = false;
      this.cdr.markForCheck();
    }
  }
  ngOnDestroy() {
    window.removeEventListener('hashchange', this.hashChanged);
    this.source?.close();
    this.sdk?.destroy();
    clearInterval(this.playback);
  }
  async api(path: string, options: RequestInit = {}) {
    try {
      const response = await fetch(path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Request failed');
      return body;
    } finally {
      setTimeout(() => this.cdr.markForCheck(), 0);
    }
  }
  value(event: Event) {
    return (event.target as HTMLInputElement).value;
  }
  async login() {
    this.error = '';
    try {
      const me = await this.api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password: this.password, role: this.role }),
      });
      this.role = me.role;
      this.loggedIn = true;
      await this.start();
    } catch (e) {
      this.error = String(e);
    }
  }
  async start() {
    this.projects = await this.api('/api/projects');
    await this.refresh();
    this.connectLive();
    window.removeEventListener('hashchange', this.hashChanged);
    window.addEventListener('hashchange', this.hashChanged);
  }
  async logout() {
    await this.api('/api/logout', { method: 'POST', body: '{}' });
    this.source?.close();
    this.sdk?.destroy();
    this.loggedIn = false;
  }
  navigate(view: string) {
    if (this.view === view) return;
    if (view !== 'demo') this.stopDemoCapture();
    this.view = view;
    location.hash = view;
    this.selectedSession = null;
    this.evidence = null;
    this.investigation = null;
    this.search = '';
  }
  async changeProject(event: Event) {
    this.project = this.value(event);
    this.demoToken = this.project === 'demo' ? 'pk_demo_deucalint' : 'pk_sandbox_deucalint';
    this.sdk?.destroy();
    this.consent = false;
    this.investigation = null;
    this.selectedSession = null;
    this.connectLive();
    await this.refresh();
  }
  async filter() {
    this.investigation = null;
    this.selectedSession = null;
    await this.refresh();
  }
  connectLive() {
    this.source?.close();
    this.connected = false;
    this.live = { active: 0, events: [] };
    this.source = new EventSource('/api/live?project=' + this.project);
    this.source.onmessage = (e) => {
      this.live = JSON.parse(e.data);
      this.connected = true;
      this.cdr.markForCheck();
    };
    this.source.onerror = () => {
      this.connected = false;
      this.cdr.markForCheck();
    };
  }
  async refresh() {
    const id = ++this.requestId;
    this.loading = true;
    this.error = '';
    this.detail = null;
    try {
      const result = await this.api('/api/overview?' + this.query);
      if (id !== this.requestId) return;
      this.data = result;
      const endpoint = (
        {
          live: '',
          overview: '',
          investigate: 'anomalies',
          funnels: 'funnels',
          retention: 'retention',
          journeys: 'journeys',
          experiments: 'experiments',
          sessions: 'sessions',
          observability: 'observability',
          alerts: 'alerts',
          settings: 'settings',
          demo: '',
        } as Record<string, string>
      )[this.view];
      if (endpoint) {
        const suffix =
          endpoint === 'funnels'
            ? '&steps=' +
              encodeURIComponent(JSON.stringify(this.funnelSteps.split(',').map((s) => s.trim()))) +
              '&ordered=' +
              this.funnelOrdered +
              '&window=' +
              this.funnelWindow
            : '';
        const detail = await this.api('/api/' + endpoint + '?' + this.query + suffix);
        if (id !== this.requestId) return;
        this.detail = detail;
        if (endpoint === 'settings') this.retentionDays = this.detail.retention;
      }
      this.reports = await this.api('/api/reports?' + this.query);
    } catch (e) {
      if (id === this.requestId) this.error = String(e);
    } finally {
      if (id === this.requestId) this.loading = false;
    }
  }
  number(n: number) {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 1,
      notation: n >= 10000 ? 'compact' : 'standard',
    }).format(n || 0);
  }
  delta(key: string) {
    const current = this.data?.metrics[key] || 0,
      prev = this.data?.previous[key] || 0;
    return prev ? (((current - prev) / prev) * 100).toFixed(1) : '—';
  }
  get chartMax() {
    return Math.max(1, ...(this.data?.series || []).flatMap((x: any) => [x.sessions, x.pageviews]));
  }
  line(key: string, shared = false) {
    const values = (this.data?.series || []).map((x: any) => x[key] || 0);
    const max = shared ? this.chartMax : Math.max(...values, 1);
    return values
      .map(
        (v: number, i: number) =>
          `${i === 0 ? 'M' : 'L'} ${(i * 780) / Math.max(values.length - 1, 1)} ${190 - (v / max) * 155}`,
      )
      .join(' ');
  }
  area() {
    return this.line('sessions', true) + ' L 780 210 L 0 210 Z';
  }
  get liveBars() {
    const bins = Array(22).fill(0);
    for (const e of this.live.events) {
      const bin = Math.floor(((Date.now() - Date.parse(e.timestamp)) / 300000) * 22);
      if (bin >= 0 && bin < 22) bins[21 - bin]++;
    }
    const max = Math.max(1, ...bins);
    return bins.map((n) => 3 + (n / max) * 67);
  }
  get donutFill() {
    const rows = this.data?.distributions.browser || [];
    const total = rows.reduce((sum: number, r: any) => sum + r.count, 0);
    if (!total) return '#f0edf6';
    let sum = 0;
    return (
      'conic-gradient(' +
      rows
        .map((r: any, i: number) => {
          const start = (sum / total) * 100;
          sum += r.count;
          return (
            ['#7c66e9', '#b1a3f5', '#51b6a4', '#dce1ef'][i % 4] +
            ' ' +
            start +
            '% ' +
            (sum / total) * 100 +
            '%'
          );
        })
        .join(',') +
      ')'
    );
  }
  chartLabels() {
    const s = this.data?.series || [];
    return s
      .filter((_: any, i: number) => i % Math.max(1, Math.floor(s.length / 6)) === 0)
      .slice(0, 7);
  }
  async investigate() {
    this.investigating = true;
    this.error = '';
    try {
      this.investigation = await this.api('/api/investigate?' + this.query, {
        method: 'POST',
        body: JSON.stringify({ question: this.question }),
      });
    } catch (e) {
      this.error = String(e);
    } finally {
      this.investigating = false;
    }
  }
  investigateNow() {
    this.navigate('investigate');
    setTimeout(() => void this.investigate(), 100);
  }
  async openSession(session: any) {
    this.selectedSession = {
      ...session,
      events: await this.api(
        '/api/session?' + this.query + '&id=' + encodeURIComponent(session.id),
      ),
    };
    this.replayIndex = 0;
    this.playing = false;
    clearInterval(this.playback);
  }
  get replayFrame() {
    if (!this.selectedSession) return null;
    const es = this.selectedSession.events.slice(0, this.replayIndex + 1);
    return [...es].reverse().find((e: any) => e.type === 'replay')?.properties;
  }
  get replayNodes() {
    return this.replayFrame?.nodes || [];
  }
  get replayWidth() {
    return this.replayFrame?.width || 1440;
  }
  get replayHeight() {
    return this.replayFrame?.height || 900;
  }
  toggleReplay() {
    this.playing = !this.playing;
    clearInterval(this.playback);
    if (this.playing)
      this.playback = setInterval(() => {
        if (!this.selectedSession || this.replayIndex >= this.selectedSession.events.length - 1) {
          this.playing = false;
          clearInterval(this.playback);
        } else this.replayIndex++;
        this.cdr.markForCheck();
      }, 650);
  }
  get sessionRows() {
    return (this.detail || []).filter((s: any) =>
      JSON.stringify(s).toLowerCase().includes(this.search.toLowerCase()),
    );
  }
  async saveAlert() {
    try {
      this.detail = await this.api('/api/alerts?' + this.query, {
        method: 'POST',
        body: JSON.stringify({ metric: this.alertMetric, threshold: this.threshold }),
      });
      this.notify('Alert rule saved.');
    } catch (e) {
      this.error = String(e);
    }
  }
  async removeAlert(id: string) {
    this.detail = await this.api('/api/alerts?' + this.query, {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    });
  }
  async saveSettings() {
    try {
      await this.api('/api/settings?' + this.query, {
        method: 'POST',
        body: JSON.stringify({ retention: this.retentionDays }),
      });
      this.notify('Retention policy saved. Cleanup runs every minute.');
    } catch (e) {
      this.error = String(e);
    }
  }
  async rotate() {
    if (
      !confirm(
        'Rotate this project’s public ingestion token? Existing SDK installations must be updated.',
      )
    )
      return;
    const data = await this.api('/api/token?' + this.query, { method: 'POST', body: '{}' });
    this.rotatedToken = data.token;
    this.demoToken = data.token;
    this.notify('Token rotated. Copy it now.');
  }
  async deleteData() {
    if (
      !this.deletionValue ||
      !confirm('Permanently delete matching events and block repeated delivery for this ID?')
    )
      return;
    try {
      const r = await this.api('/api/lifecycle?' + this.query, {
        method: 'DELETE',
        body: JSON.stringify({ kind: this.deletionKind, value: this.deletionValue }),
      });
      this.notify(`${r.deleted} events deleted.`);
      this.deletionValue = '';
      await this.refresh();
    } catch (e) {
      this.error = String(e);
    }
  }
  export() {
    window.open('/api/export?' + this.query, '_blank', 'noopener');
  }
  async saveReport() {
    try {
      await this.api('/api/reports?' + this.query, {
        method: 'POST',
        body: JSON.stringify({
          name: this.reportName || 'My segment',
          segment: this.segment || { and: [] },
        }),
      });
      this.notify('Report saved.');
      this.reports = await this.api('/api/reports?' + this.query);
    } catch (e) {
      this.error = String(e);
    }
  }
  useReport(event: Event) {
    const r = this.reports.find((x) => x.id === this.value(event));
    if (r) {
      this.browser = r.segment.value || 'All browsers';
      void this.filter();
    }
  }
  enableDemo() {
    this.consent = !this.consent;
    if (!this.consent) {
      this.sdk?.consent(false);
      this.sdk = undefined;
      this.notify('Tracking disabled and the queued demo events cleared.');
      return;
    }
    this.sdk?.destroy();
    this.sdk = new DeucalInt();
    this.sdk.init({
      projectToken: this.demoToken,
      endpoint: location.origin,
      consent: this.consent,
      replay: true,
      release: this.fault ? 'demo-regression' : 'demo-stable',
    });
    if (this.consent) {
      this.sdk.experiment('pricing_redesign', 'B');
      this.notify('Tracking enabled for this demo.');
    }
  }
  private stopDemoCapture() {
    const sdk = this.sdk;
    this.sdk = undefined;
    this.consent = false;
    if (sdk) void sdk.flush().finally(() => sdk.destroy());
  }
  addCart() {
    this.cart++;
    this.sdk?.track('product_viewed', { product: 'Orbit headphones', amount: 129 });
    this.orderStatus = 'Added to your bag.';
  }
  async checkout() {
    this.sdk?.track('checkout_started', { items: this.cart });
    if (this.fault) {
      this.sdk?.track('release_published', { environment: 'demo' }, 'deployment');
      this.sdk?.track('POST /payments', { duration: 1450, status: 500 }, 'network');
      this.sdk?.track('PaymentFormError', { fingerprint: 'payment-form-v1' }, 'error');
      this.orderStatus = 'Payment failed — simulated regression captured.';
    } else {
      this.sdk?.track('POST /payments', { duration: 240, status: 200 }, 'network');
      this.sdk?.track('purchase_completed', { amount: this.cart * 129 });
      this.orderStatus = 'Order placed. Thank you for exploring DeucalInt.';
      this.cart = 0;
    }
    await this.sdk?.flush();
  }
  notify(message: string) {
    this.toast = message;
    setTimeout(() => (this.toast = ''), 4500);
  }
}
