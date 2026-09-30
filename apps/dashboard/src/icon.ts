import { Component, Input } from '@angular/core';
@Component({
  selector: 'di-icon',
  standalone: true,
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path [attr.d]="paths[name] || paths.overview" />
  </svg>`,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }
      svg {
        width: 100%;
        height: 100%;
      }
    `,
  ],
})
export class IconComponent {
  @Input() name = 'overview';
  paths: Record<string, string> = {
    overview: 'M3 3h7v7H3z M14 3h7v4h-7z M14 11h7v10h-7z M3 14h7v7H3z',
    live: 'M3 12h4l3-8 4 16 3-8h4',
    investigate: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z',
    funnels: 'M3 4h18l-7 8v7l-4 2v-9z',
    retention: 'M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18 M8 14h1 M15 14h1 M8 18h1 M15 18h1',
    journeys: 'M5 3v18 M5 8h8a5 5 0 015 5v8 M2 18l3 3 3-3 M15 18l3 3 3-3',
    experiments: 'M9 3h6 M10 3v6l-6 10a1 1 0 001 2h14a1 1 0 001-2L14 9V3 M8 14h8',
    sessions: 'M3 4h18v16H3z M10 8l6 4-6 4z',
    observability: 'M3 12h4l3-6 4 12 3-6h4 M3 3v18h18',
    alerts: 'M18 8a6 6 0 00-12 0v5l-2 4h16l-2-4z M10 21h4',
    settings:
      'M12 8a4 4 0 100 8 4 4 0 000-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
    demo: 'M4 8h16v13H4z M8 8V6a4 4 0 018 0v2',
    search: 'M10 3a7 7 0 110 14 7 7 0 010-14 M15 15l6 6',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    close: 'M6 6l12 12 M18 6L6 18',
    check: 'M4 12l5 5L20 6',
    download: 'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
    filter: 'M3 6h18 M6 12h12 M10 18h4',
    moon: 'M20 15a9 9 0 01-11-11A9 9 0 1020 15',
    sun: 'M12 8a4 4 0 110 8 4 4 0 010-8 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1',
    help: 'M12 3a9 9 0 110 18 9 9 0 010-18 M9 9a3 3 0 116 0c0 2-3 2-3 4 M12 17h.01',
    users:
      'M9 3a4 4 0 110 8 4 4 0 010-8 M2 21v-3a7 7 0 0114 0v3 M17 4a4 4 0 010 8 M18 15a5 5 0 014 5v1',
    refresh: 'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0113-3l2 2 M19 16a8 8 0 01-13 3l-2-2',
  };
}
