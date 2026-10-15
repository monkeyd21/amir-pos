import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, Subscription, debounceTime, finalize } from 'rxjs';
import { DashboardPeriod, isDashboardSenior, parseDdMmYyyy, formatDdMmYyyy } from '@clothing-erp/shared';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { DashboardLiveService } from './dashboard-live.service';
import { DashboardGridComponent, DashBoxDirective } from './dashboard-grid.component';
import { BoxId, LAYOUT_VERSION, LayoutBox, SavedLayout, defaultLayout, mergeLayout } from './dashboard-layout';
import {
  BoxTitleComponent,
  CompareLineComponent,
  DdMmYyyyPipe,
  IndianNumberPipe,
  InrPipe,
  KpiCardComponent,
  paymentLabel,
  timeIst,
} from './dash-ui';
import { DashboardAlert, DashboardData, PeriodSelection, RecentTransaction, StaffLine, Tier } from './dashboard.models';
import { DrillPanelComponent, DrillRequest } from './drill-panel.component';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

const PERIODS: { id: DashboardPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'custom', label: 'Custom' },
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    NgClass,
    FormsModule,
    DashboardGridComponent,
    DashBoxDirective,
    KpiCardComponent,
    CompareLineComponent,
    BoxTitleComponent,
    InrPipe,
    IndianNumberPipe,
    DdMmYyyyPipe,
    DrillPanelComponent,
  ],
  providers: [DashboardLiveService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly live = inject(DashboardLiveService);

  readonly periods = PERIODS;
  readonly data = signal<DashboardData | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly selection = signal<PeriodSelection>({ period: 'today' });
  readonly customFrom = signal('');
  readonly customTo = signal('');
  readonly customOpen = signal(false);
  readonly customError = signal<string | null>(null);
  readonly layout = signal<LayoutBox[]>(defaultLayout());
  readonly mobile = signal(false);
  readonly menuOpen = signal(false);
  readonly drill = signal<DrillRequest | null>(null);
  /** Re-evaluated every 30 s so "2 min ago" keeps moving. */
  readonly now = signal(Date.now());

  readonly role = this.auth.getCurrentUser()?.role ?? '';
  readonly senior = isDashboardSenior(this.role);

  private readonly refetch$ = new Subject<void>();
  private readonly saveLayout$ = new Subject<LayoutBox[]>();
  private inFlight: Subscription | null = null;
  private queued = false;
  private clock: ReturnType<typeof setInterval> | null = null;
  private media: MediaQueryList | null = null;
  private readonly onMedia = (e: MediaQueryListEvent) => this.setMobile(e.matches);
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.live.reconnectNow();
  };

  /** Which boxes have something to show for this viewer, right now. */
  readonly visible = computed<ReadonlySet<BoxId>>(() => {
    const d = this.data();
    const ids = new Set<BoxId>();
    if (!d) return ids;
    if (d.sales) ids.add('total-sales').add('bills').add('avg-bill');
    if (d.profit) ids.add('profit');
    if (d.basket) ids.add('basket');
    if (d.returns) ids.add('returns');
    if (d.customers) ids.add('customers');
    if (d.discount) ids.add('discount');
    if (d.paymentSplit) ids.add('payment-split');
    if (d.recentTransactions) ids.add('recent');
    if (d.staff) ids.add('staff');
    if (d.alerts) ids.add('alerts');
    if (d.inventorySold) ids.add('inventory-sold');
    if (d.insight) ids.add('insight');
    if (d.eod) ids.add('eod');
    return ids;
  });

  readonly compareLabel = computed(() => {
    switch (this.data()?.meta.period ?? this.selection().period) {
      case 'today':
        return 'vs yesterday';
      case 'week':
        return 'vs last week';
      case 'month':
        return 'vs last month';
      default:
        return 'vs previous period';
    }
  });

  readonly lastUpdated = computed(() => {
    const at = this.data()?.meta.generatedAt;
    if (!at) return '';
    const mins = Math.floor((this.now() - new Date(at).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    if (mins < 60) return `${mins} mins ago`;
    return new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  });

  ngOnInit(): void {
    this.media = window.matchMedia('(max-width: 767px)');
    this.setMobile(this.media.matches);
    this.media.addEventListener('change', this.onMedia);
    document.addEventListener('visibilitychange', this.onVisible);
    this.clock = setInterval(() => this.now.set(Date.now()), 30_000);

    this.refetch$.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.load());
    this.live.changes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refetch$.next());
    this.live.authExpired$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      // An ordinary call refreshes the token on its way through the interceptor.
      this.load(() => this.live.reconnectNow());
    });
    this.saveLayout$.pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef)).subscribe((boxes) => {
      const body: SavedLayout = { version: LAYOUT_VERSION, boxes };
      this.api.put(`/dashboard/layout/${this.device()}`, body).subscribe({
        error: () => this.notify.error('Could not save the dashboard layout'),
      });
    });

    this.load();
    this.live.start();
  }

  ngOnDestroy(): void {
    this.media?.removeEventListener('change', this.onMedia);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.clock) clearInterval(this.clock);
    this.live.stop();
  }

  // ─── Data ───

  load(after?: () => void): void {
    if (this.inFlight) {
      this.queued = true;
      return;
    }
    const sel = this.selection();
    const params: Record<string, string> = { period: sel.period };
    if (sel.period === 'custom' && sel.from && sel.to) {
      params['from'] = sel.from;
      params['to'] = sel.to;
    }
    this.inFlight = this.api
      .get<ApiResponse<DashboardData>>('/dashboard', params)
      .pipe(
        finalize(() => {
          this.inFlight = null;
          this.loading.set(false);
          if (this.queued) {
            this.queued = false;
            this.load();
          }
        })
      )
      .subscribe({
        next: (res) => {
          this.data.set(res.data);
          this.error.set(null);
          this.now.set(Date.now());
          after?.();
        },
        error: (err) => this.error.set(err?.error?.error || 'The dashboard could not be loaded.'),
      });
  }

  pickPeriod(p: DashboardPeriod): void {
    if (p === 'custom') {
      this.customOpen.set(!this.customOpen() || this.selection().period !== 'custom');
      if (!this.customFrom()) {
        const bd = this.data()?.meta.businessDate;
        if (bd) {
          this.customTo.set(formatDdMmYyyy(bd));
          this.customFrom.set(formatDdMmYyyy(`${bd.slice(0, 8)}01`));
        }
      }
      return;
    }
    this.customOpen.set(false);
    if (this.selection().period === p) return;
    this.selection.set({ period: p });
    this.loading.set(true);
    this.load();
  }

  applyCustom(): void {
    const from = parseDdMmYyyy(this.customFrom());
    const to = parseDdMmYyyy(this.customTo());
    if (!from || !to) {
      this.customError.set('Enter both dates as DD-MM-YYYY');
      return;
    }
    if (from > to) {
      this.customError.set('The start date is after the end date');
      return;
    }
    this.customError.set(null);
    this.customOpen.set(false);
    this.selection.set({ period: 'custom', from, to });
    this.loading.set(true);
    this.load();
  }

  // ─── Layout ───

  private device(): 'desktop' | 'mobile' {
    return this.mobile() ? 'mobile' : 'desktop';
  }

  private setMobile(m: boolean): void {
    this.mobile.set(m);
    this.api.get<ApiResponse<{ layout: SavedLayout | null }>>(`/dashboard/layout/${m ? 'mobile' : 'desktop'}`).subscribe({
      next: (res) => this.layout.set(mergeLayout(res.data.layout)),
      error: () => this.layout.set(defaultLayout()),
    });
  }

  onLayout(boxes: LayoutBox[]): void {
    this.layout.set(boxes);
    this.saveLayout$.next(boxes);
  }

  resetLayout(): void {
    this.menuOpen.set(false);
    this.api.delete(`/dashboard/layout/${this.device()}`).subscribe({
      next: () => {
        this.layout.set(defaultLayout());
        this.notify.success('Layout reset to the default');
      },
      error: () => this.notify.error('Could not reset the layout'),
    });
  }

  // ─── Actions ───

  open(req: DrillRequest): void {
    this.drill.set(req);
  }

  dismiss(key: string, ev?: Event): void {
    ev?.stopPropagation();
    this.api.post('/dashboard/dismissals', { key }).subscribe({
      next: () => this.load(),
      error: (err) => this.notify.error(err?.error?.error || 'Could not dismiss'),
    });
  }

  onPanelChanged(): void {
    this.load();
  }

  // ─── View helpers ───

  readonly paymentLabel = paymentLabel;
  readonly timeIst = timeIst;

  marginTier(): Tier {
    const lvl = this.data()?.profit?.coverageLevel;
    return lvl === 'red' ? 'critical' : lvl === 'amber' ? 'attention' : 'good';
  }

  initials(name: string): string {
    const parts = name.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  badgeLabel(t: RecentTransaction): string {
    return { paid: 'Paid', exchange: 'Exchange', return: 'Return', hold: 'Hold', high_discount: 'High Discount' }[t.badge];
  }

  badgeClass(t: RecentTransaction): string {
    return {
      paid: 'bg-emerald-500/12 text-emerald-300 ring-emerald-400/25',
      exchange: 'bg-amber-500/12 text-amber-300 ring-amber-400/25',
      return: 'bg-rose-500/12 text-rose-300 ring-rose-400/25',
      hold: 'bg-slate-400/12 text-slate-300 ring-slate-300/20',
      high_discount: 'bg-orange-500/15 text-orange-300 ring-orange-400/30',
    }[t.badge];
  }

  openTransaction(t: RecentTransaction): void {
    if (t.kind === 'hold') this.open({ kind: 'held', id: t.id });
    else this.open({ kind: 'bill', id: t.id });
  }

  alertBar(a: DashboardAlert): string {
    return { red: 'bg-rose-400', amber: 'bg-amber-400', blue: 'bg-sky-400', purple: 'bg-violet-400' }[a.severity];
  }

  openAlert(a: DashboardAlert): void {
    if (!a.subject) return;
    switch (a.subject.kind) {
      case 'held':
        this.open({ kind: 'held', id: a.subject.id });
        break;
      case 'product':
        this.open({ kind: 'product', id: a.subject.id });
        break;
      case 'user':
        this.open({ kind: 'staff', id: a.subject.id });
        break;
      default:
        break;
    }
  }

  staffBarPct(s: StaffLine): number {
    const top = this.data()?.staff?.lines[0]?.value ?? 0;
    return top > 0 ? Math.max(4, (s.value / top) * 100) : 0;
  }

  eodBadge(): string {
    const e = this.data()?.eod;
    if (!e) return '';
    return e.status === 'balanced' ? 'Balanced' : e.status === 'short' ? 'Short' : 'Over';
  }

  goToPos(): void {
    this.router.navigate(['/pos']);
  }
}
