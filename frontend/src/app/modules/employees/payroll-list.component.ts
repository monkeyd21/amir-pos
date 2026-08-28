import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { istThisMonth, monthLabel, money, shiftMonth } from './payroll-date.util';

export type PeriodStatus = 'open' | 'finalised' | 'paid';

export interface PayrollRow {
  userId: number;
  user?: { id: number; firstName: string; lastName?: string | null; role?: string };
  firstName?: string;
  lastName?: string | null;
  month: string;
  salaryType: 'fixed_monthly' | 'daily_wage';
  /** Decimal — arrives as a STRING over JSON. */
  baseAmount?: string | number | null;
  perDayRate?: string | number | null;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  lateDays: number;
  paidOffDays: number;
  unmarkedDays: number;
  manualDeductionTotal?: string | number | null;
  attendanceDeduction?: string | number | null;
  netAmount?: string | number | null;
  status: PeriodStatus;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total?: number };
}

@Component({
  selector: 'app-payroll-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="space-y-6 min-w-0">

      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <a routerLink="/employees" class="text-on-surface-variant hover:text-on-surface transition-colors">
              <span class="material-symbols-outlined text-xl">arrow_back</span>
            </a>
            <h1 class="text-3xl font-headline font-bold text-on-surface">Payroll</h1>
          </div>
          <p class="mt-1 text-sm text-on-surface-variant ml-9">{{ monthLabel(month) }} wage bill</p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <a routerLink="/employees/attendance"
            class="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold bg-surface-container-highest/60 text-on-surface-variant rounded-lg hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-lg">event_available</span> Attendance
          </a>
          <button (click)="stepMonth(-1)" class="w-10 h-10 flex items-center justify-center rounded-lg bg-surface-container-highest/60 text-on-surface-variant hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-lg">chevron_left</span>
          </button>
          <input type="month" [(ngModel)]="month" (change)="onMonthChange()"
            class="bg-surface-container border border-outline-variant/20 focus:border-primary text-on-surface px-3 py-2.5 rounded-lg outline-none text-sm" />
          <button (click)="stepMonth(1)" class="w-10 h-10 flex items-center justify-center rounded-lg bg-surface-container-highest/60 text-on-surface-variant hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-lg">chevron_right</span>
          </button>
        </div>
      </div>

      @if (totalUnmarked > 0 && !loading) {
        <div class="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 text-amber-300 rounded-xl px-4 py-3 text-sm">
          <span class="material-symbols-outlined text-lg">warning</span>
          <span>
            <span class="font-bold">{{ totalUnmarked }} days unmarked</span> across
            {{ rowsWithUnmarked }} employee(s) this month. Fixed-salary staff are not deducted for
            unmarked days and daily-wage staff are not paid for them —
            <a routerLink="/employees/attendance" class="underline hover:text-amber-200">fill the attendance grid</a>
            before finalising.
          </span>
        </div>
      }

      @if (loading) {
        <div class="flex items-center justify-center h-[40vh]">
          <div class="flex flex-col items-center gap-4">
            <div class="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
            <p class="text-sm text-on-surface-variant">Loading payroll...</p>
          </div>
        </div>
      } @else {
        <div class="bg-surface-container rounded-xl overflow-x-auto max-w-full">
          <table class="w-full min-w-[60rem] text-left">
            <thead>
              <tr class="bg-surface-container-low/50">
                <th class="th-label">Employee</th>
                <th class="th-label">Salary Type</th>
                <th class="th-label text-center">Present</th>
                <th class="th-label text-center">Absent</th>
                <th class="th-label text-center">Half</th>
                <th class="th-label text-center">Late</th>
                <th class="th-label text-center">Paid Off</th>
                <th class="th-label text-center">Unmarked</th>
                <th class="th-label text-right">Net Salary</th>
                <th class="th-label">Status</th>
                <th class="th-label"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-outline-variant/10">
              @for (row of rows; track row.userId) {
                <tr class="hover:bg-surface-container-high/40 transition-colors">
                  <td class="px-6 py-4">
                    <p class="text-sm font-medium text-on-surface whitespace-nowrap">{{ nameOf(row) }}</p>
                  </td>
                  <td class="px-6 py-4 text-sm text-on-surface-variant whitespace-nowrap">
                    {{ row.salaryType === 'daily_wage' ? 'Daily wage' : 'Fixed monthly' }}
                    <span class="block text-[10px] text-on-surface-variant/60">
                      {{ row.salaryType === 'daily_wage' ? money(row.perDayRate) + ' / day' : money(row.baseAmount) + ' / month' }}
                    </span>
                  </td>
                  <td class="px-6 py-4 text-center text-sm tabular-nums text-green-400">{{ row.presentDays }}</td>
                  <td class="px-6 py-4 text-center text-sm tabular-nums text-red-400">{{ row.absentDays }}</td>
                  <td class="px-6 py-4 text-center text-sm tabular-nums text-orange-400">{{ row.halfDays }}</td>
                  <td class="px-6 py-4 text-center text-sm tabular-nums text-yellow-400">{{ row.lateDays }}</td>
                  <td class="px-6 py-4 text-center text-sm tabular-nums text-sky-400">{{ row.paidOffDays }}</td>
                  <td class="px-6 py-4 text-center">
                    @if (row.unmarkedDays > 0) {
                      <span class="status-pill bg-amber-500/15 text-amber-300">{{ row.unmarkedDays }} unmarked</span>
                    } @else {
                      <span class="text-sm text-on-surface-variant/40">—</span>
                    }
                  </td>
                  <td class="px-6 py-4 text-right text-sm font-bold tabular-nums text-on-surface whitespace-nowrap">
                    {{ money(row.netAmount) }}
                  </td>
                  <td class="px-6 py-4">
                    <span class="status-pill" [class]="statusClass(row.status)">{{ row.status }}</span>
                  </td>
                  <td class="px-6 py-4 text-right">
                    <a [routerLink]="['/employees/payroll', row.userId, month]"
                      class="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline whitespace-nowrap">
                      Details <span class="material-symbols-outlined text-sm">chevron_right</span>
                    </a>
                  </td>
                </tr>
              }

              @if (rows.length === 0) {
                <tr>
                  <td colspan="11" class="px-8 py-16 text-center">
                    <span class="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-2 block">payments</span>
                    <p class="text-sm text-on-surface-variant">No payroll rows for {{ monthLabel(month) }}</p>
                  </td>
                </tr>
              }
            </tbody>
            @if (rows.length > 0) {
              <tfoot>
                <tr class="bg-surface-container-low/60 border-t border-outline-variant/20">
                  <td class="px-6 py-4 text-sm font-bold text-on-surface" colspan="8">
                    Total wage bill &mdash; {{ monthLabel(month) }} ({{ rows.length }} employees)
                  </td>
                  <td class="px-6 py-4 text-right text-base font-headline font-bold tabular-nums text-on-surface whitespace-nowrap">
                    {{ money(totalNet) }}
                  </td>
                  <td class="px-6 py-4 text-xs text-on-surface-variant whitespace-nowrap" colspan="2">
                    {{ paidCount }} paid &middot; {{ finalisedCount }} finalised &middot; {{ openCount }} open
                  </td>
                </tr>
              </tfoot>
            }
          </table>
        </div>
      }
    </div>
  `,
})
export class PayrollListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  loading = true;
  month = istThisMonth();
  rows: PayrollRow[] = [];

  monthLabel = monthLabel;
  money = money;

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  load(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<PayrollRow[]>>('/employees/payroll', { month: this.month })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows = res.data || [];
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.rows = [];
          this.notify.error(err.error?.error || 'Failed to load payroll');
        },
      });
  }

  onMonthChange(): void {
    if (!/^\d{4}-\d{2}$/.test(this.month)) return;
    this.load();
  }

  stepMonth(delta: number): void {
    this.month = shiftMonth(this.month, delta);
    this.onMonthChange();
  }

  nameOf(row: PayrollRow): string {
    const first = row.user?.firstName ?? row.firstName ?? '';
    const last = row.user?.lastName ?? row.lastName ?? '';
    return [first, last].filter(Boolean).join(' ') || `#${row.userId}`;
  }

  /** Decimal arrives as a string — Number() or the total string-concatenates. */
  get totalNet(): number {
    return this.rows.reduce((sum, r) => sum + Number(r.netAmount ?? 0), 0);
  }

  get totalUnmarked(): number {
    return this.rows.reduce((sum, r) => sum + Number(r.unmarkedDays ?? 0), 0);
  }

  get rowsWithUnmarked(): number {
    return this.rows.filter((r) => Number(r.unmarkedDays ?? 0) > 0).length;
  }

  get paidCount(): number {
    return this.rows.filter((r) => r.status === 'paid').length;
  }

  get finalisedCount(): number {
    return this.rows.filter((r) => r.status === 'finalised').length;
  }

  get openCount(): number {
    return this.rows.filter((r) => r.status === 'open').length;
  }

  statusClass(status: PeriodStatus): string {
    switch (status) {
      case 'paid':
        return 'bg-green-500/15 text-green-400';
      case 'finalised':
        return 'bg-sky-500/15 text-sky-400';
      default:
        return 'bg-surface-container-highest text-on-surface-variant';
    }
  }
}
