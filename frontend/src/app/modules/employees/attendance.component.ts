import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import {
  dayLabel,
  dayNumber,
  dayOfWeek,
  istThisMonth,
  istToday,
  monthDays,
  monthLabel,
  shiftMonth,
  weekdayInitial,
  ymd,
} from './payroll-date.util';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'half_day'
  | 'late'
  | 'paid_weekly_off';

/** Click order for a cell. `null` = clear the mark back to unmarked. */
const CYCLE: (AttendanceStatus | null)[] = [
  'present',
  'absent',
  'half_day',
  'late',
  'paid_weekly_off',
  null,
];

interface Employee {
  id: number;
  firstName: string;
  lastName?: string | null;
  role: string;
  /** IST calendar date; days before it are never markable (D9). */
  joiningDate?: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  weeklyOffDay?: number | null;
  salaryType?: 'fixed_monthly' | 'daily_wage' | null;
}

interface AttendanceRow {
  id?: number;
  userId: number;
  date: string;
  status: AttendanceStatus;
  manualDeduction?: string | number | null;
  note?: string | null;
}

interface Totals {
  present: number;
  absent: number;
  half: number;
  late: number;
  paidOff: number;
  unmarked: number;
  deduction: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total?: number; page?: number; limit?: number };
}

@Component({
  selector: 'app-attendance',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './attendance.component.html',
})
export class AttendanceComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  loading = true;
  saving = false;
  bulkSaving = false;

  month = istThisMonth();
  today = istToday();
  days: string[] = [];

  employees: Employee[] = [];
  /** keyed `${userId}|${YYYY-MM-DD}` */
  marks = new Map<string, AttendanceRow>();

  /** Day used by "mark all present". */
  bulkDate = '';

  // ── inline side panel (NOT a modal — the layout makes overlays unreachable)
  panelUserId: number | null = null;
  panelDate = '';
  panelStatus: AttendanceStatus | null = null;
  panelDeduction: number | null = null;
  panelNote = '';

  readonly statusOptions: { value: AttendanceStatus; label: string; glyph: string }[] = [
    { value: 'present', label: 'Present', glyph: 'P' },
    { value: 'absent', label: 'Absent', glyph: 'A' },
    { value: 'half_day', label: 'Half Day', glyph: 'H' },
    { value: 'late', label: 'Late', glyph: 'L' },
    { value: 'paid_weekly_off', label: 'Paid Weekly Off', glyph: 'W' },
  ];

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.rebuildDays();
    this.loadEmployees();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── template helpers ──────────────────────────────────────────────────────
  monthLabel = monthLabel;
  dayLabel = dayLabel;
  dayNumber = dayNumber;
  weekdayInitial = weekdayInitial;

  employeeName(e: Employee): string {
    return [e.firstName, e.lastName].filter(Boolean).join(' ');
  }

  // ── loading ───────────────────────────────────────────────────────────────
  private rebuildDays(): void {
    this.days = monthDays(this.month);
    const last = this.days[this.days.length - 1];
    this.bulkDate = this.today <= last && this.today >= this.days[0] ? this.today : last;
  }

  loadEmployees(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<Employee[]>>('/employees', { status: 'active', limit: 500 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.employees = (res.data || []).map((e) => ({
            ...e,
            joiningDate: ymd(e.joiningDate),
          }));
          this.loadAttendance();
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load employees');
        },
      });
  }

  loadAttendance(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<AttendanceRow[]>>('/employees/attendance', { month: this.month })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.marks.clear();
          for (const row of res.data || []) {
            const day = ymd(row.date);
            this.marks.set(this.key(row.userId, day), { ...row, date: day });
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load attendance');
        },
      });
  }

  onMonthChange(): void {
    if (!/^\d{4}-\d{2}$/.test(this.month)) return;
    this.closePanel();
    this.rebuildDays();
    this.loadAttendance();
  }

  stepMonth(delta: number): void {
    this.month = shiftMonth(this.month, delta);
    this.onMonthChange();
  }

  // ── grid state ────────────────────────────────────────────────────────────
  key(userId: number, day: string): string {
    return `${userId}|${day}`;
  }

  markOf(userId: number, day: string): AttendanceRow | undefined {
    return this.marks.get(this.key(userId, day));
  }

  statusOf(userId: number, day: string): AttendanceStatus | null {
    return this.markOf(userId, day)?.status ?? null;
  }

  glyph(userId: number, day: string): string {
    const status = this.statusOf(userId, day);
    if (!status) return this.isMarkable(this.employeeById(userId), day) ? '·' : '';
    return this.statusOptions.find((s) => s.value === status)?.glyph ?? '?';
  }

  employeeById(userId: number): Employee | undefined {
    return this.employees.find((e) => e.id === userId);
  }

  /** Future days and days before joining are not markable (D9). */
  isMarkable(emp: Employee | undefined, day: string): boolean {
    if (!emp) return false;
    if (day > this.today) return false;
    if (emp.joiningDate && day < emp.joiningDate) return false;
    return true;
  }

  isWeeklyOff(emp: Employee, day: string): boolean {
    return emp.weeklyOffDay != null && dayOfWeek(day) === emp.weeklyOffDay;
  }

  hasNote(userId: number, day: string): boolean {
    const m = this.markOf(userId, day);
    return !!(m && (m.note || Number(m.manualDeduction ?? 0) > 0));
  }

  isSelected(userId: number, day: string): boolean {
    return this.panelUserId === userId && this.panelDate === day;
  }

  /**
   * Full class string — Angular's template parser breaks on a "/" inside a
   * [class.x] binding, so cell styling is computed here and bound wholesale.
   */
  cellClass(emp: Employee, day: string): string {
    const base =
      'relative w-9 h-9 text-[11px] font-bold rounded-md transition-colors flex items-center justify-center';
    if (!this.isMarkable(emp, day)) {
      return `${base} text-on-surface-variant/20 cursor-not-allowed bg-surface-container-lowest/40`;
    }
    const ring = this.isSelected(emp.id, day) ? ' ring-2 ring-primary' : '';
    const off = this.isWeeklyOff(emp, day) ? ' outline outline-1 outline-sky-400/40' : '';
    const status = this.statusOf(emp.id, day);
    const tone =
      status === 'present'
        ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
        : status === 'absent'
          ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
          : status === 'half_day'
            ? 'bg-orange-500/15 text-orange-400 hover:bg-orange-500/25'
            : status === 'late'
              ? 'bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25'
              : status === 'paid_weekly_off'
                ? 'bg-sky-500/15 text-sky-400 hover:bg-sky-500/25'
                : 'bg-surface-container-lowest text-on-surface-variant/40 hover:bg-surface-container-high';
    return `${base} ${tone} cursor-pointer${ring}${off}`;
  }

  dayHeaderClass(day: string): string {
    const weekend = dayOfWeek(day) === 0;
    const isToday = day === this.today;
    if (isToday) return 'text-primary font-bold';
    return weekend ? 'text-sky-400/70' : 'text-on-surface-variant';
  }

  // ── totals ────────────────────────────────────────────────────────────────
  totalsFor(emp: Employee): Totals {
    const t: Totals = {
      present: 0, absent: 0, half: 0, late: 0, paidOff: 0, unmarked: 0, deduction: 0,
    };
    for (const day of this.days) {
      if (!this.isMarkable(emp, day)) continue;
      const mark = this.markOf(emp.id, day);
      if (!mark) {
        t.unmarked++;
        continue;
      }
      // Decimal arrives over JSON as a string — Number() before adding.
      t.deduction += Number(mark.manualDeduction ?? 0);
      switch (mark.status) {
        case 'present': t.present++; break;
        case 'absent': t.absent++; break;
        case 'half_day': t.half++; break;
        case 'late': t.late++; break;
        case 'paid_weekly_off': t.paidOff++; break;
      }
    }
    return t;
  }

  /** Employees still carrying an unmarked day this month (D2). */
  get unmarkedEmployeeCount(): number {
    return this.employees.filter((e) => this.totalsFor(e).unmarked > 0).length;
  }

  // ── marking ───────────────────────────────────────────────────────────────
  cycle(emp: Employee, day: string): void {
    if (!this.isMarkable(emp, day) || this.saving) return;
    const current = this.statusOf(emp.id, day);
    const idx = CYCLE.indexOf(current);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    this.select(emp.id, day);
    this.persist(emp.id, day, next, this.markOf(emp.id, day));
  }

  private persist(
    userId: number,
    day: string,
    status: AttendanceStatus | null,
    existing?: AttendanceRow,
    deduction?: number | null,
    note?: string | null
  ): void {
    const previous = existing ? { ...existing } : undefined;

    // optimistic
    if (status === null) this.marks.delete(this.key(userId, day));
    else {
      this.marks.set(this.key(userId, day), {
        ...(existing ?? { userId, date: day, status }),
        userId,
        date: day,
        status,
        manualDeduction: deduction !== undefined ? deduction : (existing?.manualDeduction ?? null),
        note: note !== undefined ? note : (existing?.note ?? null),
      });
    }
    this.syncPanelFromMarks();

    this.saving = true;
    const body: Record<string, unknown> = { userId, date: day, status };
    if (deduction !== undefined) body['manualDeduction'] = deduction ?? 0;
    if (note !== undefined) body['note'] = note || null;

    this.api
      .put<ApiResponse<AttendanceRow>>('/employees/attendance', body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.saving = false;
          if (res?.data && status !== null) {
            this.marks.set(this.key(userId, day), { ...res.data, date: ymd(res.data.date) });
            this.syncPanelFromMarks();
          }
        },
        error: (err) => {
          this.saving = false;
          // roll the optimistic change back
          if (previous) this.marks.set(this.key(userId, day), previous);
          else this.marks.delete(this.key(userId, day));
          this.syncPanelFromMarks();
          this.notify.error(err.error?.error || 'Failed to save attendance');
        },
      });
  }

  markAllPresent(): void {
    if (this.bulkSaving || !this.bulkDate) return;
    const day = this.bulkDate;
    const entries = this.employees
      .filter((e) => this.isMarkable(e, day))
      .map((e) => ({ userId: e.id, status: 'present' as const }));

    if (!entries.length) {
      this.notify.warning('No employees can be marked on that day');
      return;
    }

    this.bulkSaving = true;
    this.api
      .post<ApiResponse<AttendanceRow[]>>('/employees/attendance/bulk', { date: day, entries })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.bulkSaving = false;
          this.notify.success(`${entries.length} marked present on ${dayLabel(day)}`);
          this.loadAttendance();
        },
        error: (err) => {
          this.bulkSaving = false;
          this.notify.error(err.error?.error || 'Failed to mark the day');
        },
      });
  }

  // ── side panel ────────────────────────────────────────────────────────────
  select(userId: number, day: string): void {
    this.panelUserId = userId;
    this.panelDate = day;
    this.syncPanelFromMarks();
  }

  private syncPanelFromMarks(): void {
    if (this.panelUserId == null) return;
    const mark = this.markOf(this.panelUserId, this.panelDate);
    this.panelStatus = mark?.status ?? null;
    const ded = Number(mark?.manualDeduction ?? 0);
    this.panelDeduction = ded > 0 ? ded : null;
    this.panelNote = mark?.note ?? '';
  }

  closePanel(): void {
    this.panelUserId = null;
    this.panelDate = '';
    this.panelStatus = null;
    this.panelDeduction = null;
    this.panelNote = '';
  }

  get panelEmployee(): Employee | undefined {
    return this.panelUserId == null ? undefined : this.employeeById(this.panelUserId);
  }

  setPanelStatus(status: AttendanceStatus | null): void {
    this.panelStatus = status;
  }

  savePanel(): void {
    if (this.panelUserId == null || this.saving) return;
    const emp = this.panelEmployee;
    if (!emp || !this.isMarkable(emp, this.panelDate)) return;
    this.persist(
      this.panelUserId,
      this.panelDate,
      this.panelStatus,
      this.markOf(this.panelUserId, this.panelDate),
      this.panelDeduction ?? 0,
      this.panelNote
    );
  }
}
