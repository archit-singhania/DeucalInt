import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  inject,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DeucalInt } from '../../../packages/web-sdk/src/index';
import { IconComponent } from './icon';
import { GeographyComponent } from './geography';
import { JourneyFlowComponent } from './journey-flow';

@Component({
  selector: 'di-root',
  standalone: true,
  imports: [CommonModule, IconComponent, GeographyComponent, JourneyFlowComponent],
  templateUrl: './app.html',
})
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
        ['events', 'Auto-captured events', 'live'],
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
        ['onboarding', 'Connect a source', 'settings'],
        ['team', 'Team & access', 'users'],
        ['settings', 'Project settings', '⚙'],
        ['demo', 'Demo commerce', '↗'],
      ],
    },
  ];
  skipToContent() {
    document.getElementById('main-content')?.focus();
  }
  currentPassword = '';
  changedPassword = '';
  accountBusy = false;
  deliveries: any[] = [];
  async changePassword() {
    this.accountBusy = true;
    try {
      await this.api('/api/account/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: this.currentPassword,
          newPassword: this.changedPassword,
        }),
      });
      this.currentPassword = '';
      this.changedPassword = '';
      this.notify('Password updated. Other sessions were signed out.');
    } catch (e) {
      this.error = String(e);
    } finally {
      this.accountBusy = false;
    }
  }
  async retryDelivery(id: string) {
    try {
      this.deliveries = (
        await this.api('/api/deliveries?project=' + this.project, {
          method: 'POST',
          body: JSON.stringify({ id }),
        })
      ).deliveries;
      this.notify('Delivery queued for retry.');
    } catch (e) {
      this.error = String(e);
    }
  }
  setupStep = 1;
  setupStatus: any = null;
  setupBusy = false;
  websiteUrl = '';
  installMethod = 'HTML';
  hasConsent = false;
  installToken = '';
  collectorBase = location.origin;
  catalogue: any = null;
  eventSearch = '';
  graph: any = null;
  journeyAnchor = '';
  journeyDirection = 'forward';
  get journeyNames() {
    return [...new Set<string>((this.detail || []).flatMap((e: any) => [e.from, e.to]))].sort();
  }
  retentionMode = 'exact';
  chartTable = false;
  showAdvanced = false;
  get projectName() {
    return this.projects.find((p) => p.id === this.project)?.name || 'Your product';
  }
  get setupToken() {
    return (
      this.installToken ||
      (this.project === 'demo'
        ? 'pk_demo_deucalint'
        : this.project === 'sandbox'
          ? 'pk_sandbox_deucalint'
          : '')
    );
  }
  get installSnippet() {
    const safe = (s: string) =>
      s.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
      );
    return (
      '<script defer src="' +
      safe(this.collectorBase) +
      '/ingest.js"\n  data-token="' +
      safe(this.setupToken || 'YOUR_PUBLIC_TOKEN') +
      '"\n  data-endpoint="' +
      safe(this.collectorBase) +
      '"' +
      (this.hasConsent ? '\n  data-consent="granted"' : '') +
      '></script>'
    );
  }
  get eventRows() {
    return (this.catalogue?.events || []).filter((e: any) =>
      (e.name + ' ' + e.type).toLowerCase().includes(this.eventSearch.toLowerCase()),
    );
  }
  async copySnippet() {
    try {
      await navigator.clipboard.writeText(this.installSnippet);
      this.notify('Installation snippet copied.');
    } catch {
      this.notify('Select and copy the snippet below. Clipboard access is unavailable.');
    }
  }
  async checkConnection() {
    this.setupBusy = true;
    try {
      this.setupStatus = await this.api('/api/setup?project=' + this.project);
      if (this.setupStatus.websiteUrl) this.websiteUrl = this.setupStatus.websiteUrl;
      this.notify(
        this.setupStatus.connected
          ? 'Events are arriving. Your connection is working.'
          : 'No events yet. Open your site after installing the snippet and granting consent.',
      );
    } catch (e) {
      this.error = String(e);
    } finally {
      this.setupBusy = false;
    }
  }
  async saveWebsite() {
    try {
      await this.api('/api/settings?project=' + this.project, {
        method: 'POST',
        body: JSON.stringify({ websiteUrl: this.websiteUrl }),
      });
      this.setupStep = 2;
      this.notify('Site saved. Next, add your installation snippet.');
    } catch (e) {
      this.error = String(e);
    }
  }
  selectCountry(code: string) {
    this.rules = this.rules.filter((r) => r.dimension !== 'country');
    this.rules.push({ dimension: 'country', operator: 'eq', value: code });
    void this.filter();
  }
  eventFunnel(name: string) {
    this.funnelSteps = 'page_view, ' + name;
    this.navigate('funnels');
  }
  get overviewHeadline() {
    const d = this.delta('conversion');
    return d === '—'
      ? 'Your product story starts with the first signal.'
      : 'Conversion is ' +
          (Number(d) >= 0 ? 'up ' : 'down ') +
          Math.abs(Number(d)) +
          '% from the previous period.';
  }
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
  username = 'owner';
  profile = 'local';
  commandOpen = false;
  commandQuery = '';
  dark = localStorage.getItem('deucalint-theme') === 'dark';
  showSegments = false;
  rules: { dimension: string; operator: string; value: string }[] = [];
  draftRules: { dimension: string; operator: string; value: string }[] = [];
  comparePrevious = false;
  chartSessions = true;
  chartPageviews = true;
  hoverIndex = -1;
  selectedBucket: any = null;
  insights: any = null;
  history: any[] = [];
  notifications: any[] = [];
  retentionCell: any = null;
  journeyFocus = '';
  replayFilter = 'all';
  newUsername = '';
  newPassword = '';
  newRole = 'viewer';
  newProjectName = '';
  alertMinimum = 20;
  alertCooldown = 60;
  slowApi = false;
  highLcp = false;
  private modalReturnFocus: HTMLElement | null = null;
  get canManage() {
    return ['owner', 'admin'].includes(this.role);
  }
  get canEditReports() {
    return ['owner', 'admin', 'analyst'].includes(this.role);
  }
  get commands() {
    return this.nav
      .flatMap((g) => g.items)
      .filter((i) => i[1].toLowerCase().includes(this.commandQuery.toLowerCase()));
  }
  get stale() {
    return !!this.data && Date.now() - Date.parse(this.data.updatedAt) > 120000;
  }
  get steps() {
    return this.funnelSteps.split(',').map((s) => s.trim());
  }
  get hoverBucket() {
    return this.data?.series[this.hoverIndex];
  }
  get timelineEvents() {
    return (this.selectedSession?.events || [])
      .map((e: any, index: number) => ({ ...e, index }))
      .filter((e: any) => this.replayFilter === 'all' || e.type === this.replayFilter);
  }
  get focusedJourneys() {
    return this.detail || [];
  }
  @HostListener('document:keydown', ['$event']) keyboard(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openCommand();
      return;
    }
    if (event.key === 'Escape') {
      this.closeDialogs();
      this.showSegments = false;
      return;
    }
    if (event.key === 'Tab') {
      const modals = Array.from(document.querySelectorAll<HTMLElement>('.modal[role="dialog"]'));
      const modal = modals.at(-1);
      if (!modal) return;
      const items = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
        ),
      ).filter((e) => e.getClientRects().length);
      if (!items.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !modal.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !modal.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  focusModal() {
    this.modalReturnFocus = document.activeElement as HTMLElement;
    setTimeout(() => document.querySelector<HTMLElement>('.modal input,.modal button')?.focus(), 0);
  }
  openCommand() {
    this.commandOpen = true;
    this.commandQuery = '';
    this.focusModal();
  }
  closeDialogs() {
    this.commandOpen = false;
    this.evidence = null;
    this.selectedSession = null;
    this.selectedBucket = null;
    this.playing = false;
    clearInterval(this.playback);
    this.modalReturnFocus?.focus();
  }
  chooseCommand(view: string) {
    this.closeDialogs();
    this.navigate(view);
  }
  toggleTheme() {
    this.dark = !this.dark;
    localStorage.setItem('deucalint-theme', this.dark ? 'dark' : 'light');
    document.documentElement.dataset['theme'] = this.dark ? 'dark' : 'light';
  }
  openSegments() {
    this.draftRules = this.rules.map((r) => ({ ...r }));
    this.showSegments = !this.showSegments;
  }
  addRule() {
    if (this.draftRules.length < 6)
      this.draftRules.push({ dimension: 'device', operator: 'eq', value: 'mobile' });
  }
  applySegments() {
    this.rules = this.draftRules
      .filter((r) => r.value.trim())
      .map((r) => ({ ...r, value: r.value.trim() }));
    this.showSegments = false;
    void this.filter();
  }
  removeRule(index: number) {
    this.rules.splice(index, 1);
    void this.filter();
  }
  updateStep(index: number, event: Event) {
    const steps = this.steps;
    steps[index] = this.value(event);
    this.funnelSteps = steps.join(', ');
  }
  moveStep(index: number, delta: number) {
    const steps = this.steps;
    const to = index + delta;
    if (to < 0 || to >= steps.length) return;
    [steps[index], steps[to]] = [steps[to], steps[index]];
    this.funnelSteps = steps.join(', ');
  }
  removeStep(index: number) {
    if (this.steps.length <= 2) return;
    this.funnelSteps = this.steps.filter((_, i) => i !== index).join(', ');
  }
  addStep() {
    if (this.steps.length < 8) this.funnelSteps += ', custom_event';
  }
  chartMove(event: MouseEvent) {
    const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
    this.hoverIndex = Math.max(
      0,
      Math.min(
        (this.data?.series.length || 1) - 1,
        Math.round(
          ((event.clientX - rect.left) / rect.width) * ((this.data?.series.length || 1) - 1),
        ),
      ),
    );
  }
  chartKey(event: KeyboardEvent) {
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      this.hoverIndex = Math.max(
        0,
        Math.min(
          (this.data?.series.length || 1) - 1,
          this.hoverIndex + (event.key === 'ArrowRight' ? 1 : -1),
        ),
      );
    }
    if (event.key === 'Enter') this.openBucket();
  }
  openBucket() {
    if (this.hoverBucket) {
      this.selectedBucket = this.hoverBucket;
      this.focusModal();
    }
  }
  previousLine() {
    const values = this.data?.previousSeries || [];
    return values
      .map(
        (v: any, i: number) =>
          `${i ? 'L' : 'M'} ${(i * 780) / Math.max(values.length - 1, 1)} ${190 - (v.sessions / this.chartMax) * 155}`,
      )
      .join(' ');
  }
  openEvidence(e: any) {
    this.evidence = e;
    this.focusModal();
  }
  restoreInvestigation(item: any) {
    this.investigation = item.result;
    this.question = item.question;
  }
  async createMember() {
    try {
      this.detail = await this.api('/api/members?' + this.query, {
        method: 'POST',
        body: JSON.stringify({
          username: this.newUsername,
          password: this.newPassword,
          role: this.newRole,
        }),
      });
      this.newUsername = '';
      this.newPassword = '';
      this.notify('Member added to this project.');
    } catch (e) {
      this.error = String(e);
    }
  }
  async removeMember(id: string) {
    if (!confirm('Remove this member’s access to the selected project?')) return;
    try {
      this.detail = await this.api('/api/members?' + this.query, {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      });
    } catch (e) {
      this.error = String(e);
    }
  }
  async createProject() {
    try {
      const p = await this.api('/api/projects?' + this.query, {
        method: 'POST',
        body: JSON.stringify({ name: this.newProjectName }),
      });
      this.projects = await this.api('/api/projects');
      this.project = p.id;
      this.role = 'owner';
      this.demoToken = p.token;
      this.rotatedToken = p.token;
      this.installToken = p.token;
      this.setupStep = 1;
      this.websiteUrl = '';
      this.newProjectName = '';
      this.rules = [];
      this.browser = 'All browsers';
      this.connectLive();
      await this.refresh();
      this.notify('Project created. Copy the public token before leaving this page.');
    } catch (e) {
      this.error = String(e);
    }
  }
  async acknowledgeAlert(id: string) {
    try {
      await this.api('/api/notifications?' + this.query, {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      this.notify('Notification acknowledged.');
      await this.refresh();
    } catch (e) {
      this.error = String(e);
    }
  }
  get title() {
    return this.nav.flatMap((g) => g.items).find((x) => x[0] === this.view)?.[1] || 'Overview';
  }
  get subtitle() {
    return (
      {
        overview: 'A clear view of your product. A confident next move.',
        events: 'Useful signals, captured automatically. No event definitions required.',
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
        onboarding: 'From first event to first insight, in a few minutes.',
        team: 'The right access for everyone building your product.',
      } as Record<string, string>
    )[this.view];
  }
  get segment() {
    const parts: any[] = this.rules.map((r) => ({ ...r }));
    if (this.browser !== 'All browsers')
      parts.unshift({ dimension: 'browser', operator: 'eq', value: this.browser });
    return parts.length ? { and: parts } : null;
  }
  get query() {
    return (
      `project=${this.project}&days=${this.days}` +
      (this.segment ? '&segment=' + encodeURIComponent(JSON.stringify(this.segment)) : '')
    );
  }
  async ngOnInit() {
    document.documentElement.dataset['theme'] = this.dark ? 'dark' : 'light';
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
        body: JSON.stringify({ password: this.password, role: this.role, username: this.username }),
      });
      this.role = me.role;
      this.loggedIn = true;
      await this.start();
    } catch (e) {
      this.error = String(e);
    }
  }
  async start() {
    this.profile = (await this.api('/health')).profile;
    this.projects = await this.api('/api/projects');
    if (!this.projects.some((p) => p.id === this.project))
      this.project = this.projects[0]?.id || '';
    this.role = this.projects.find((p) => p.id === this.project)?.role || this.role;
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
    this.installToken = '';
    this.rotatedToken = '';
    this.setupStatus = null;
    this.websiteUrl = '';
    this.setupStep = 1;
    this.role = this.projects.find((p) => p.id === this.project)?.role || this.role;
    this.rules = [];
    this.demoToken =
      this.project === 'demo'
        ? 'pk_demo_deucalint'
        : this.project === 'sandbox'
          ? 'pk_sandbox_deucalint'
          : '';
    this.browser = 'All browsers';
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
          onboarding: '',
          events: '',
          team: 'members',
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
            : endpoint === 'retention'
              ? '&mode=' + this.retentionMode
              : '';
        const detail = await this.api('/api/' + endpoint + '?' + this.query + suffix);
        if (id !== this.requestId) return;
        this.detail = detail;
        if (endpoint === 'settings') this.retentionDays = this.detail.retention;
      }
      if (this.view === 'onboarding') {
        this.setupStatus = await this.api('/api/setup?project=' + this.project);
        this.websiteUrl = this.setupStatus.websiteUrl || '';
        this.collectorBase = this.setupStatus.collectorEndpoint || location.origin;
      }
      if (this.view === 'events')
        this.catalogue = await this.api('/api/events/catalog?' + this.query);
      if (this.view === 'journeys')
        this.graph = await this.api(
          '/api/journey-graph?' +
            this.query +
            '&direction=' +
            this.journeyDirection +
            (this.journeyAnchor ? '&anchor=' + encodeURIComponent(this.journeyAnchor) : ''),
        );
      if (this.view === 'alerts') {
        this.notifications = await this.api('/api/notifications?' + this.query);
        this.deliveries = this.canManage
          ? (await this.api('/api/deliveries?project=' + this.project)).deliveries
          : [];
      }
      this.reports = await this.api('/api/reports?' + this.query);
      if (this.view === 'overview' || this.view === 'investigate') {
        const insights = await this.api('/api/insights?' + this.query);
        if (id !== this.requestId) return;
        this.insights = insights;
      }
      if (this.view === 'investigate')
        this.history = await this.api('/api/investigations?' + this.query);
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
    return Math.max(
      1,
      ...(this.data?.series || []).flatMap((x: any) => [
        this.chartSessions ? x.sessions : 0,
        this.chartPageviews ? x.pageviews : 0,
      ]),
      ...(this.comparePrevious ? this.data?.previousSeries || [] : []).map((x: any) => x.sessions),
    );
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
            ['#147d78', '#8cb8aa', '#a2b4e7', '#dce1ef'][i % 4] +
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
      this.history = await this.api('/api/investigations?' + this.query);
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
    this.replayFilter = 'all';
    this.focusModal();
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
        body: JSON.stringify({
          metric: this.alertMetric,
          threshold: this.threshold,
          minimumSessions: this.alertMinimum,
          cooldownMinutes: this.alertCooldown,
        }),
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
    this.installToken = data.token;
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
      if (this.view === 'alerts') {
        this.notifications = await this.api('/api/notifications?' + this.query);
        this.deliveries = this.canManage
          ? (await this.api('/api/deliveries?project=' + this.project)).deliveries
          : [];
      }
      this.reports = await this.api('/api/reports?' + this.query);
    } catch (e) {
      this.error = String(e);
    }
  }
  useReport(event: Event) {
    const r = this.reports.find((x) => x.id === this.value(event));
    if (r) {
      this.browser = 'All browsers';
      this.rules = (r.segment.and || [r.segment])
        .filter((x: any) => x.dimension)
        .map((x: any) => ({ ...x }));
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
    if (this.slowApi) await new Promise((r) => setTimeout(r, 1200));
    if (this.highLcp) this.sdk?.track('web_vital', { lcp: 4600 }, 'performance');
    if (this.fault) {
      this.sdk?.track('release_published', { environment: 'demo' }, 'deployment');
      this.sdk?.track('POST /payments', { duration: 1450, status: 500 }, 'network');
      this.sdk?.track('PaymentFormError', { fingerprint: 'payment-form-v1' }, 'error');
      this.orderStatus = 'Payment failed — simulated regression captured.';
    } else {
      this.sdk?.track(
        'POST /payments',
        { duration: this.slowApi ? 1450 : 240, status: 200 },
        'network',
      );
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
