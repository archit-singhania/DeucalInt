import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
interface FlowNode {
  id: string;
  label: string;
  step: number;
  sessions: number;
  exits: number;
}
interface FlowLink {
  source: string;
  target: string;
  value: number;
}
@Component({
  selector: 'di-journey-flow',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flow-toolbar">
      <span>{{ graph?.sessions || 0 }} sessions in this journey</span
      ><button (click)="selected = ''" [disabled]="!selected">Reset focus</button>
    </div>
    <div class="flow-scroll">
      <svg
        [attr.viewBox]="'0 0 1000 ' + height"
        class="flow-canvas"
        role="group"
        aria-label="Session paths. Each column is an event step, and thicker links represent more sessions."
      >
        @for (step of steps; track step) {
          <text [attr.x]="x(step) + 8" y="24" class="flow-step">STEP {{ step + 1 }}</text>
        }
        @for (link of graph?.links || []; track $index) {
          <path
            [attr.d]="path(link)"
            fill="none"
            stroke="var(--accent)"
            [attr.stroke-width]="width(link)"
            [attr.opacity]="
              selected && link.source !== selected && link.target !== selected ? 0.05 : 0.22
            "
          >
            <title>
              {{ label(link.source) }} → {{ label(link.target) }}: {{ link.value }} sessions
            </title>
          </path>
        }
        @for (node of nodes; track node.id) {
          <g
            role="button"
            tabindex="0"
            [attr.aria-label]="
              node.label +
              ', step ' +
              (node.step + 1) +
              ', ' +
              node.sessions +
              ' sessions. Select to highlight links.'
            "
            (click)="selected = node.id"
            (keydown.enter)="selected = node.id"
            (keydown.space)="$event.preventDefault(); selected = node.id"
            [attr.transform]="'translate(' + x(node.step) + ',' + y(node.id) + ')'"
            [attr.opacity]="selected && !related(node.id) ? 0.35 : 1"
          >
            <rect width="154" height="54" rx="9" fill="var(--surface)" stroke="var(--border)" />
            <rect width="4" height="36" y="9" rx="2" fill="var(--accent)" />
            <text x="13" y="22" class="flow-label">{{ short(node.label) }}</text>
            <text x="13" y="40" class="flow-count">{{ node.sessions }} sessions</text>
            <title>{{ node.label }} · {{ node.exits }} exits</title>
          </g>
        }
      </svg>
    </div>
    @if (selectedNode) {
      <div class="flow-detail">
        <b>{{ selectedNode.label }}</b
        ><span
          >{{ selectedNode.sessions }} sessions · {{ selectedNode.exits }} ended at this observed
          step</span
        ><button (click)="selected = ''">Clear selection</button>
      </div>
    }
    @if (!nodes.length) {
      <p class="empty">Capture a session with several events to see its path.</p>
    }
    @if (graph?.truncated) {
      <p class="muted">Showing the most frequent paths. Some nodes or later steps are omitted.</p>
    }
    <details class="flow-table">
      <summary>View accessible journey data</summary>
      <table>
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>Sessions</th>
          </tr>
        </thead>
        <tbody>
          @for (link of graph?.links || []; track $index) {
            <tr>
              <td>{{ label(link.source) }}</td>
              <td>{{ label(link.target) }}</td>
              <td>{{ link.value }}</td>
            </tr>
          }
        </tbody>
      </table>
    </details>
  `,
})
export class JourneyFlowComponent {
  @Input() graph: any = null;
  selected = '';
  get nodes(): FlowNode[] {
    return this.graph?.nodes || [];
  }
  get steps() {
    return [...new Set(this.nodes.map((n) => n.step))].sort((a, b) => a - b);
  }
  get height() {
    return Math.max(
      200,
      80 +
        Math.max(0, ...this.steps.map((step) => this.nodes.filter((n) => n.step === step).length)) *
          72,
    );
  }
  get selectedNode() {
    return this.nodes.find((n) => n.id === this.selected);
  }
  x(step: number) {
    return 18 + step * 200;
  }
  y(id: string) {
    const n = this.nodes.find((n) => n.id === id);
    if (!n) return 40;
    const peers = this.nodes.filter((p) => p.step === n.step);
    return 52 + peers.findIndex((p) => p.id === id) * 72;
  }
  path(l: FlowLink) {
    const a = this.nodes.find((n) => n.id === l.source),
      b = this.nodes.find((n) => n.id === l.target);
    if (!a || !b) return '';
    const x = this.x(a.step) + 154,
      y = this.y(a.id) + 27,
      tx = this.x(b.step),
      ty = this.y(b.id) + 27;
    return `M${x},${y} C${x + 24},${y} ${tx - 24},${ty} ${tx},${ty}`;
  }
  width(l: FlowLink) {
    return (
      2 +
      Math.sqrt(l.value / Math.max(1, ...(this.graph?.links || []).map((x: FlowLink) => x.value))) *
        25
    );
  }
  label(id: string) {
    return this.nodes.find((n) => n.id === id)?.label || id;
  }
  short(label: string) {
    return label.length > 20 ? label.slice(0, 18) + '…' : label;
  }
  related(id: string) {
    return (
      id === this.selected ||
      (this.graph?.links || []).some(
        (l: FlowLink) =>
          (l.source === this.selected && l.target === id) ||
          (l.target === this.selected && l.source === id),
      )
    );
  }
}
