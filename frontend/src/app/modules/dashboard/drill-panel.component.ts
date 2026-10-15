import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { isDashboardSenior } from '@clothing-erp/shared';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { DdMmYyyyPipe, InrPipe, paymentLabel, timeIst } from './dash-ui';
import { PeriodSelection } from './dashboard.models';
import { SidePanelComponent } from './side-panel.component';

export type DrillRequest =
  | { kind: 'sales' | 'bills' | 'discount' | 'profit' | 'returns' | 'customers' | 'eod' }
  | { kind: 'payments'; mode: string }
  | { kind: 'staff' | 'product' | 'held' | 'bill'; id: number };

const TITLES: Record<DrillRequest['kind'], string> = {
  sales: 'Sales breakdown',
  bills: 'Bills',
  discount: 'Discounted bills',
  payments: 'Payments',
  profit: 'Profit and cost coverage',
  returns: 'Returns and exchanges',
  customers: 'Customers served',
  eod: 'Cash in drawer',
  staff: 'Salesperson',
  product: 'Repeat returns',
  held: 'Held bill',
  bill: 'Bill',
};

/**
 * Dashboard spec §1.6: the side panel. Detail opens here instead of a new
 * page, and the quick actions (void a held bill, mark an article for a quality
 * check) save in place through the owning module's own API, then tell the
 * dashboard to refresh. Only full workflows (resume billing at the till, the
 * full bill) navigate away.
 *
 * The frame (overlay, Esc, focus) is `dash-side-panel`.
 */
@Component({
  selector: 'app-drill-panel',
  standalone: true,
  imports: [NgClass, NgTemplateOutlet, FormsModule, InrPipe, DdMmYyyyPipe, SidePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './drill-panel.component.html',
})
export class DrillPanelComponent implements OnChanges {
  @Input({ required: true }) request!: DrillRequest;
  @Input({ required: true }) period!: PeriodSelection;
  @Output() closed = new EventEmitter<void>();
  /** Something was changed from inside the panel: the dashboard refetches. */
  @Output() changed = new EventEmitter<void>();

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);

  readonly data = signal<any>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly confirmVoid = signal(false);
  qualityNote = '';

  readonly senior = isDashboardSenior(this.auth.getCurrentUser()?.role ?? '');
  readonly paymentLabel = paymentLabel;
  readonly timeIst = timeIst;

  ngOnChanges(): void {
    this.fetch();
  }

  close(): void {
    this.closed.emit();
  }

  title(): string {
    const r = this.request;
    if (r.kind === 'payments') return `${paymentLabel(r.mode)} payments`;
    return TITLES[r.kind];
  }

  fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.confirmVoid.set(false);
    const r = this.request;
    const req$ =
      r.kind === 'bill'
        ? this.api.get<any>(`/sales/${r.id}`)
        : this.api.get<any>(`/dashboard/drill/${r.kind}`, {
            period: this.period.period,
            ...(this.period.from ? { from: this.period.from } : {}),
            ...(this.period.to ? { to: this.period.to } : {}),
            ...('id' in r ? { id: r.id } : {}),
            ...('mode' in r ? { mode: r.mode } : {}),
          });
    req$.subscribe({
      next: (res) => {
        this.data.set(res.data);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.error || 'Could not load this detail.');
        this.loading.set(false);
      },
    });
  }

  // ─── Navigation (full workflows only) ───

  openBill(id: number): void {
    this.closed.emit();
    this.router.navigate(['/sales', id]);
  }

  showBill(id: number): void {
    this.request = { kind: 'bill', id };
    this.fetch();
  }

  resumeHeld(id: number): void {
    this.closed.emit();
    this.router.navigate(['/pos'], { queryParams: { resumeHeld: id } });
  }

  // ─── Quick actions, saved in place ───

  voidHeld(id: number): void {
    this.busy.set(true);
    this.api.delete(`/pos/held/${id}`).subscribe({
      next: () => {
        this.busy.set(false);
        this.notify.success('Held bill voided. Its pieces are back on sale.');
        this.changed.emit();
        this.closed.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.notify.error(err?.error?.error || 'Could not void the held bill');
      },
    });
  }

  markQualityCheck(productId: number): void {
    this.busy.set(true);
    this.api.post(`/dashboard/products/${productId}/quality-check`, { note: this.qualityNote.trim() || null }).subscribe({
      next: () => {
        this.busy.set(false);
        this.qualityNote = '';
        this.notify.success('Marked for a quality check');
        this.fetch();
        this.changed.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.notify.error(err?.error?.error || 'Could not mark it');
      },
    });
  }

  clearQualityCheck(productId: number): void {
    this.busy.set(true);
    this.api.delete(`/dashboard/products/${productId}/quality-check`).subscribe({
      next: () => {
        this.busy.set(false);
        this.notify.success('Quality check cleared');
        this.fetch();
        this.changed.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.notify.error(err?.error?.error || 'Could not clear it');
      },
    });
  }

  // ─── View helpers ───

  hourLabel(h: number): string {
    const f = (x: number) => `${((x + 11) % 12) + 1}${x < 12 || x === 24 ? 'am' : 'pm'}`;
    return `${f(h)}–${f(h + 1)}`;
  }

  maxOf(rows: any[], key: string): number {
    return rows.reduce((m, r) => Math.max(m, Number(r[key]) || 0), 0);
  }

  pct(v: number, max: number): number {
    return max > 0 ? Math.max(2, (v / max) * 100) : 0;
  }

  billLine(i: any): string {
    const v = i.variant;
    return [v?.product?.name, [v?.size, v?.color].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
  }

  person(u: any): string {
    return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : '';
  }

  ageText(iso: string): string {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    return `${h} hr${h === 1 ? '' : 's'} ${mins % 60} min`;
  }
}
