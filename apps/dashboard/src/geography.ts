import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  ChangeDetectorRef,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'di-geography',
  standalone: true,
  imports: [CommonModule],
  template: `<section class="panel geo-panel">
    <div class="panel-header">
      <div>
        <span class="eyebrow">A WORLD OF SIGNALS</span>
        <h3>Your audience, everywhere</h3>
        <p>Sessions by recorded country · select a country to explore</p>
      </div>
      <span class="tag">{{ known.length }} countries</span>
    </div>
    <div class="geo-layout">
      <div class="map-surface">
        <svg
          viewBox="0 0 720 300"
          role="img"
          aria-label="World map of sessions by recorded country. Use the country list for keyboard access."
        >
          <defs>
            <pattern id="map-dots" width="12" height="12" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".7" fill="currentColor" opacity=".10" />
            </pattern>
          </defs>
          <rect width="720" height="300" fill="url(#map-dots)" />
          @for (country of countries; track country.id) {
            <path
              [attr.d]="country.path"
              [attr.fill]="fill(country.id)"
              stroke="var(--surface)"
              stroke-width=".65"
              (mouseenter)="hover = country.id"
              (mouseleave)="hover = ''"
              (click)="select(country.id)"
            >
              <title>{{ country.name }}: {{ count(country.id) }} sessions</title>
            </path>
          }
        </svg>
        <div class="map-caption">
          <span>{{
            hover
              ? name(hover) + ' · ' + count(hover) + ' sessions'
              : 'Country-level activity, never precise location'
          }}</span
          ><span class="map-scale">Less <i></i> More</span>
        </div>
        @if (failed) {
          <p class="muted">Map unavailable. Country totals remain available.</p>
        }
      </div>
      <div class="country-list">
        <div class="country-heading"><span>Country</span><span>Sessions</span></div>
        @for (row of rows; track row.name) {
          <button
            (click)="select(row.name)"
            [disabled]="!valid(row.name)"
            [attr.aria-label]="'Filter country ' + name(row.name)"
          >
            <span class="country-code">{{ row.name === 'Unknown' ? '—' : row.name }}</span
            ><span class="country-name"
              >{{ name(row.name) }}<i [style.width.%]="(row.count / maximum) * 100"></i></span
            ><b>{{ row.count | number }}</b>
          </button>
        } @empty {
          <p class="empty">Country data appears when a trusted collector adds a country code.</p>
        }
      </div>
    </div>
    <div class="panel-footer geo-note">
      Country is supplied with events; missing locations are shown as Unknown. Map: Natural Earth.
    </div>
  </section>`,
})
export class GeographyComponent implements OnInit {
  @Input() rows: { name: string; count: number }[] = [];
  @Output() countrySelected = new EventEmitter<string>();
  countries: { id: string; name: string; path: string }[] = [];
  hover = '';
  failed = false;
  private cdr = inject(ChangeDetectorRef);
  get known() {
    return this.rows.filter((r) => this.valid(r.name));
  }
  get maximum() {
    return Math.max(1, ...this.rows.map((r) => r.count));
  }
  valid(id: string) {
    return /^[A-Z]{2}$/.test(id);
  }
  count(id: string) {
    return this.rows.find((r) => r.name === id)?.count || 0;
  }
  name(id: string) {
    return this.countries.find((c) => c.id === id)?.name || id;
  }
  fill(id: string) {
    const value = this.count(id);
    return value
      ? `color-mix(in srgb, var(--accent) ${30 + (value / this.maximum) * 60}%, var(--surface))`
      : 'var(--map-land)';
  }
  select(id: string) {
    if (this.count(id) && this.valid(id)) this.countrySelected.emit(id);
  }
  async ngOnInit() {
    try {
      const r = await fetch('/world-map.json');
      if (!r.ok) throw new Error();
      this.countries = await r.json();
    } catch {
      this.failed = true;
    } finally {
      this.cdr.markForCheck();
    }
  }
}
