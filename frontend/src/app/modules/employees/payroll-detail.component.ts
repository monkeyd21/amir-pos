import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';
import { AttendanceStatus } from './attendance.component';
import { PeriodStatus } from './payroll-list.component';
import { dayLabel, istToday, monthLabel, money, weekdayShort, ymd } from './payroll-date.util';

interface PayrollDay {
  date: string;
  status: AttendanceStatus | null;
  manualDeduction?: string | number | null;
  note?: string | null;
}

/** Day counts arrive NESTED under `counts` — they are not flattened. */
interface PayrollCounts {
  presentDays: number;
  absentDays: number;
  halfDays: number;
  lateDays: number;
  paidOffDays: number;
  unmarkedDays: number;
}

interface PayrollDetail {
  month: string;
  status: PeriodStatus;
  /** The employee block is `employee`, and the name is already joined. */
  employee: {
    id: number;
    name: string;
    role?: string;
    branchId?: number;
    joiningDate?: string | null;
    salaryType: 'fixed_monthly' | 'daily_wage' | null;
    monthlySalary?: string | number | null;
    perDayRate?: string | number | null;
    weeklyOffDay?: number | null;
    configured: boolean;
  };
  counts: PayrollCounts;
  salaryType: 'fixed_monthly' | 'daily_wage' | null;
  /** Decimals — STRINGS over JSON. */
  baseAmount?: string | number | null;
  perDayRate?: string | number | null;
  earnedDays?: number;
  grossAmount?: string | number | null;
  manualDeductionTotal?: string | number | null;
  attendanceDeduction?: string | number | null;
  netAmount?: string | number | null;
  unrecoveredExcess?: string | number | null;
  preJoiningDays?: number;
  futureDays?: number;
  finalisedAt?: string | null;
  paidAt?: string | null;
  salaryPeriodId?: number | null;
  payableId?: number | null;
  days?: PayrollDay[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-payroll-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="space-y-6 min-w-0">

      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <a [routerLink]="['/employees/payroll']" class="text-on-surface-variant hover:text-on-surface transition-colors">
              <span class="material-symbols-outlined text-xl">arrow_back</span>
            </a>
            <h1 class="text-3xl font-headline font-bold text-on-surface">{{ employeeName }}</h1>
          </div>
          <p class="mt-1 text-sm text-on-surface-variant ml-9">Salary for {{ monthLabel(month) }}</p>
        </div>
        @if (detail) {
          <span class="status-pill text-xs px-3 py-1" [class]="statusClass(detail.status)">{{ detail.status }}</span>
        }
      </div>

      @if (loading) {
        <div class="flex items-center justify-center h-[40vh]">
          <div class="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
        </div>
      } @else if (!detail) {
        <div class="bg-surface-container rounded-xl px-8 py-16 text-center">
          <span class="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-2 block">error</span>
          <p class="text-sm text-on-surface-variant">No salary period found for this employee and month.</p>
        </div>
      } @else {

        @if (detail.counts.unmarkedDays > 0) {
          <div class="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 text-amber-300 rounded-xl px-4 py-3 text-sm">
            <span class="material-symbols-outlined text-lg">warning</span>
            <span>
              <span class="font-bold">{{ detail.counts.unmarkedDays }} days unmarked.</span>
              {{ detail.salaryType === 'daily_wage'
                  ? 'Nothing is paid for those days.'
                  : 'Nothing is deducted for those days.' }}
              <a routerLink="/employees/attendance" class="underline hover:text-amber-200">Open the attendance grid</a>
              to fill them in before finalising.
            </span>
          </div>
        }

        <div class="flex flex-col xl:flex-row gap-6 min-w-0">

          <!-- Day-by-day -->
          <div class="flex-1 min-w-0">
            <div class="bg-surface-container rounded-xl overflow-x-auto max-w-full">
              <table class="w-full min-w-[34rem] text-left">
                <thead>
                  <tr class="bg-surface-container-low/50">
                    <th class="th-label">Day</th>
                    <th class="th-label">Status</th>
                    <th class="th-label text-right">Deduction</th>
                    <th class="th-label">Note</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-outline-variant/10">
                  @for (day of days; track day.date) {
                    <tr class="hover:bg-surface-container-high/30 transition-colors">
                      <td class="px-6 py-2.5 text-sm text-on-surface whitespace-nowrap tabular-nums">
                        {{ day.date.slice(8, 10) }}
                        <span class="text-on-surface-variant/60 text-xs ml-1">{{ weekdayShort(day.date) }}</span>
                      </td>
                      <td class="px-6 py-2.5">
                        <span class="status-pill" [class]="dayStatusClass(day.status)">{{ formatStatus(day.status) }}</span>
                      </td>
                      <td class="px-6 py-2.5 text-right text-sm tabular-nums text-on-surface-variant whitespace-nowrap">
                        {{ num(day.manualDeduction) > 0 ? '−' + money(day.manualDeduction) : '—' }}
                      </td>
                      <td class="px-6 py-2.5 text-sm text-on-surface-variant">{{ day.note || '—' }}</td>
                    </tr>
                  }
                  @if (days.length === 0) {
                    <tr>
                      <td colspan="4" class="px-8 py-12 text-center text-sm text-on-surface-variant">No days recorded.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <!-- Arithmetic + actions -->
          <div class="w-full xl:w-96 shrink-0 space-y-6">

            <div class="bg-surface-container/60 border border-outline-variant/10 rounded-2xl p-5">
              <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-4">How this figure was reached</p>

              <dl class="space-y-2.5 text-sm">
                @if (detail.salaryType === 'fixed_monthly') {
                  <div class="flex items-baseline justify-between gap-4">
                    <dt class="text-on-surface-variant">Monthly salary</dt>
                    <dd class="tabular-nums text-on-surface font-medium whitespace-nowrap">{{ money(base) }}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-4">
                    <dt class="text-on-surface-variant">
                      Absent &mdash; {{ detail.counts.absentDays }} &times; {{ money(perDay) }}
                    </dt>
                    <dd class="tabular-nums text-red-400 whitespace-nowrap">−{{ money(absentDeduction) }}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-4">
                    <dt class="text-on-surface-variant">
                      Half days &mdash; {{ detail.counts.halfDays }} &times; &frac12; &times; {{ money(perDay) }}
                    </dt>
                    <dd class="tabular-nums text-red-400 whitespace-nowrap">−{{ money(halfDeduction) }}</dd>
                  </div>
                } @else {
                  <div class="flex items-baseline justify-between gap-4">
                    <dt class="text-on-surface-variant">
                      Payable days &mdash; {{ detail.counts.presentDays }} present + {{ detail.counts.lateDays }} late
                      + {{ detail.counts.halfDays }} half (&frac12;) + {{ detail.counts.paidOffDays }} paid off
                    </dt>
                    <dd class="tabular-nums text-on-surface font-medium whitespace-nowrap">{{ payableDays }}</dd>
                  </div>
                  <div class="flex items-baseline justify-between gap-4">
                    <dt class="text-on-surface-variant">{{ payableDays }} &times; {{ money(perDay) }} per day</dt>
                    <dd class="tabular-nums text-on-surface font-medium whitespace-nowrap">{{ money(grossWage) }}</dd>
                  </div>
                }

                <div class="flex items-baseline justify-between gap-4">
                  <dt class="text-on-surface-variant">Manual deductions</dt>
                  <dd class="tabular-nums text-red-400 whitespace-nowrap">−{{ money(manualDeduction) }}</dd>
                </div>

                <div class="flex items-baseline justify-between gap-4 pt-3 mt-1 border-t border-outline-variant/15">
                  <dt class="text-on-surface font-semibold">Net salary</dt>
                  <dd class="text-xl font-headline font-bold tabular-nums text-on-surface whitespace-nowrap">{{ money(net) }}</dd>
                </div>
              </dl>

              <p class="mt-3 text-[11px] text-on-surface-variant/60">
                Late days are paid in full &mdash; counted for the record only, never auto-deducted.
              </p>

              @if (clampExcess > 0) {
                <div class="mt-3 flex items-start gap-2 bg-red-500/10 border border-red-500/25 text-red-300 rounded-lg px-3 py-2.5 text-xs">
                  <span class="material-symbols-outlined text-base">block</span>
                  <span>
                    Deductions exceeded the salary. Net is clamped at ₹0 and
                    <span class="font-bold">{{ money(clampExcess) }}</span> was not recovered.
                    It is <span class="font-bold">not</span> carried forward to next month.
                  </span>
                </div>
              }
            </div>

            <!-- Actions -->
            <div class="bg-surface-container/60 border border-outline-variant/10 rounded-2xl p-5 space-y-4">
              <p class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Actions</p>

              @if (detail.status === 'open') {
                <p class="text-xs text-on-surface-variant/70">
                  Finalising snapshots the salary rates onto this month and raises a pending payable.
                  A later pay rise will not rewrite it. Settle it with Pay afterwards.
                </p>
                <button (click)="finalise()" [disabled]="acting"
                  class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-gradient-cta text-white rounded-lg hover:shadow-glow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  @if (acting) {
                    <div class="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                  } @else {
                    <span class="material-symbols-outlined text-lg">lock</span>
                  }
                  Finalise {{ monthLabel(month) }}
                </button>
              }

              @if (detail.status === 'finalised') {
                <p class="text-xs text-on-surface-variant/70">
                  Finalised{{ detail.finalisedAt ? ' on ' + dayLabel(ymd(detail.finalisedAt)) : '' }}.
                  A pending payable of {{ money(net) }} is waiting to be settled.
                </p>

                <label class="flex flex-col gap-1.5">
                  <span class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Payment Method</span>
                  <select [(ngModel)]="payMethod"
                    class="px-3 py-2.5 text-sm bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none cursor-pointer">
                    @for (m of methods; track m.value) {
                      <option [value]="m.value">{{ m.label }}</option>
                    }
                  </select>
                </label>

                <label class="flex flex-col gap-1.5">
                  <span class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Paid On</span>
                  <input type="date" [(ngModel)]="paidAt"
                    class="px-3 py-2.5 text-sm bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none" />
                </label>

                <button (click)="pay()" [disabled]="acting || !paidAt"
                  class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-green-500/15 text-green-400 rounded-lg hover:bg-green-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  @if (acting) {
                    <div class="w-4 h-4 border-2 border-green-400/40 border-t-green-400 rounded-full animate-spin"></div>
                  } @else {
                    <span class="material-symbols-outlined text-lg">payments</span>
                  }
                  Pay {{ money(net) }}
                </button>
              }

              @if (detail.status === 'paid') {
                <div class="flex items-start gap-2 bg-green-500/10 border border-green-500/25 text-green-300 rounded-lg px-3 py-2.5 text-xs">
                  <span class="material-symbols-outlined text-base">check_circle</span>
                  <span>
                    Paid{{ detail.paidAt ? ' on ' + dayLabel(ymd(detail.paidAt)) : '' }}.
                    @if (detail.payableId) { Payable #{{ detail.payableId }} is settled. }
                  </span>
                </div>
              }

              @if (isOwner && detail.status !== 'open') {
                <button (click)="reopen()" [disabled]="acting"
                  class="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-surface-container-highest/60 text-on-surface-variant rounded-lg hover:bg-surface-container-highest transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                  <span class="material-symbols-outlined text-lg">lock_open</span>
                  Reopen month
                </button>
                <p class="text-[10px] text-on-surface-variant/50">
                  Owner only. Reopening voids the salary payable and lets attendance be edited again.
                </p>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class PayrollDetailComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  loading = true;
  acting = false;
  userId = 0;
  month = '';
  detail: PayrollDetail | null = null;

  payMethod: 'cash' | 'upi' | 'card' | 'bank' | 'cheque' = 'cash';
  paidAt = istToday();

  readonly methods = [
    { value: 'cash', label: 'Cash' },
    { value: 'upi', label: 'UPI' },
    { value: 'card', label: 'Card' },
    { value: 'bank', label: 'Bank Transfer' },
    { value: 'cheque', label: 'Cheque' },
  ];

  monthLabel = monthLabel;
  dayLabel = dayLabel;
  weekdayShort = weekdayShort;
  money = money;
  ymd = ymd;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private auth: AuthService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      this.userId = Number(params.get('id') ?? 0);
      this.month = params.get('month') ?? '';
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get isOwner(): boolean {
    return this.auth.getCurrentUser()?.role === 'owner';
  }

  get employeeName(): string {
    return this.detail?.employee?.name?.trim() || 'Salary';
  }

  get days(): PayrollDay[] {
    return (this.detail?.days ?? []).map((d) => ({ ...d, date: ymd(d.date) }));
  }

  load(): void {
    if (!this.userId || !this.month) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.api
      .get<ApiResponse<PayrollDetail>>(`/employees/payroll/${this.userId}/${this.month}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.detail = res.data ?? null;
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.detail = null;
          this.notify.error(err.error?.error || 'Failed to load salary period');
        },
      });
  }

  // ── arithmetic (Decimals arrive as strings — Number() everything) ─────────
  num(value: unknown): number {
    const n = Number(value ?? 0);
    return isNaN(n) ? 0 : n;
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  get base(): number {
    return this.num(this.detail?.baseAmount);
  }

  get perDay(): number {
    return this.num(this.detail?.perDayRate);
  }

  get manualDeduction(): number {
    return this.num(this.detail?.manualDeductionTotal);
  }

  get absentDeduction(): number {
    return this.round2(this.num(this.detail?.counts?.absentDays) * this.perDay);
  }

  get halfDeduction(): number {
    return this.round2(this.num(this.detail?.counts?.halfDays) * 0.5 * this.perDay);
  }

  /** Late counts as a full paid day (D5). */
  get payableDays(): number {
    if (!this.detail) return 0;
    return (
      this.num(this.detail.counts.presentDays) +
      this.num(this.detail.counts.lateDays) +
      this.num(this.detail.counts.halfDays) * 0.5 +
      this.num(this.detail.counts.paidOffDays)
    );
  }

  get grossWage(): number {
    return this.round2(this.payableDays * this.perDay);
  }

  /** Unclamped net — used only to name the un-recovered excess (D8). */
  get rawNet(): number {
    if (!this.detail) return 0;
    const gross =
      this.detail.salaryType === 'fixed_monthly'
        ? this.base - this.absentDeduction - this.halfDeduction
        : this.grossWage;
    return this.round2(gross - this.manualDeduction);
  }

  /** Server figure wins once it exists; otherwise clamp locally at 0 (D8). */
  get net(): number {
    const server = this.detail?.netAmount;
    if (server !== undefined && server !== null) return this.num(server);
    return Math.max(0, this.rawNet);
  }

  get clampExcess(): number {
    return this.rawNet < 0 ? this.round2(-this.rawNet) : 0;
  }

  // ── presentation ─────────────────────────────────────────────────────────
  formatStatus(status: AttendanceStatus | null): string {
    if (!status) return 'Unmarked';
    return status
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  dayStatusClass(status: AttendanceStatus | null): string {
    switch (status) {
      case 'present': return 'bg-green-500/15 text-green-400';
      case 'absent': return 'bg-red-500/15 text-red-400';
      case 'half_day': return 'bg-orange-500/15 text-orange-400';
      case 'late': return 'bg-yellow-500/15 text-yellow-400';
      case 'paid_weekly_off': return 'bg-sky-500/15 text-sky-400';
      default: return 'bg-amber-500/15 text-amber-300';
    }
  }

  statusClass(status: PeriodStatus): string {
    switch (status) {
      case 'paid': return 'bg-green-500/15 text-green-400';
      case 'finalised': return 'bg-sky-500/15 text-sky-400';
      default: return 'bg-surface-container-highest text-on-surface-variant';
    }
  }

  // ── actions ──────────────────────────────────────────────────────────────
  private act(path: string, body: unknown, successMsg: string): void {
    if (this.acting) return;
    this.acting = true;
    this.api
      .post<ApiResponse<PayrollDetail>>(
        `/employees/payroll/${this.userId}/${this.month}/${path}`,
        body
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.acting = false;
          this.notify.success(successMsg);
          this.load();
        },
        error: (err) => {
          this.acting = false;
          this.notify.error(err.error?.error || `Failed to ${path} this month`);
        },
      });
  }

  finalise(): void {
    this.act('finalise', {}, `${monthLabel(this.month)} finalised — payable raised`);
  }

  pay(): void {
    this.act('pay', { method: this.payMethod, paidAt: this.paidAt }, 'Salary paid');
  }

  reopen(): void {
    this.act('reopen', {}, `${monthLabel(this.month)} reopened`);
  }
}
