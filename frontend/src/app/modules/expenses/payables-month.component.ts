import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { BranchService } from '../../core/services/branch.service';

export type PayableStatus = 'pending' | 'part_paid' | 'paid' | 'void';
export type PayableSource = 'recurring_expense' | 'adhoc_expense' | 'payroll' | 'commission';
export type PayMethod = 'cash' | 'upi' | 'card' | 'bank' | 'cheque';

interface PayableCategory {
  id: number;
  name: string;
  isSystem?: boolean;
}

interface PayablePayment {
  id: number;
  amount: string | number;
  method: PayMethod;
  paidAt: string;
  reference?: string | null;
  notes?: string | null;
}

interface Payable {
  id: number;
  branchId: number;
  source: PayableSource;
  categoryId?: number | null;
  userId?: number | null;
  periodMonth?: string | null;
  title: string;
  description?: string | null;
  amount: string | number;
  paidAmount: string | number;
  dueDate?: string | null;
  status: PayableStatus;
  isSystem: boolean;
  sourceRefType?: string | null;
  sourceRefId?: number | null;
  createdAt: string;
  category?: PayableCategory | null;
  subject?: { id: number; firstName: string; lastName: string } | null;
  creator?: { id: number; firstName: string; lastName: string } | null;
  payments?: PayablePayment[];
}

interface CategoryBreakdownRow {
  key: string;
  name: string;
  due: number;
  paid: number;
  total: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-payables-month',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './payables-month.component.html',
})
export class PayablesMonthComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  payables: Payable[] = [];
  categories: PayableCategory[] = [];

  loading = true;
  ensuring = false;

  month = '';
  selectedCategory = '';
  selectedSource = '';
  showVoid = false;

  /** id -> amount currently typed into the inline amount box */
  amountEdits: Record<number, string> = {};
  savingAmountId: number | null = null;

  /** id of the payable whose inline pay panel is open (no modals — house rule) */
  payOpenId: number | null = null;
  payAmount = '';
  payMethod: PayMethod = 'cash';
  payDate = '';
  payReference = '';
  payNotes = '';
  paying = false;

  readonly methods: { value: PayMethod; label: string }[] = [
    { value: 'cash', label: 'Cash' },
    { value: 'upi', label: 'UPI' },
    { value: 'card', label: 'Card' },
    { value: 'bank', label: 'Bank transfer' },
    { value: 'cheque', label: 'Cheque' },
  ];

  readonly sources: { value: PayableSource; label: string }[] = [
    { value: 'recurring_expense', label: 'Recurring' },
    { value: 'adhoc_expense', label: 'Ad-hoc' },
    { value: 'payroll', label: 'Payroll' },
    { value: 'commission', label: 'Commission' },
  ];

  constructor(
    private api: ApiService,
    private notify: NotificationService,
    private branchService: BranchService
  ) {}

  ngOnInit(): void {
    this.month = this.istMonth();
    this.payDate = this.istToday();
    this.loadCategories();
    this.bootstrapMonth();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─────────────────────────── IST date helpers ───────────────────────────
  // The server runs UTC. Every payable date is an Asia/Kolkata calendar date,
  // so never use local-time getters here either.

  private istYmd(d: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  istToday(): string {
    return this.istYmd();
  }

  istMonth(): string {
    return this.istYmd().slice(0, 7);
  }

  /** 'YYYY-MM-DD' for an ISO timestamp, evaluated in IST */
  private ymdOf(iso: string): string {
    return this.istYmd(new Date(iso));
  }

  // ─────────────────────────── loading ───────────────────────────

  private loadCategories(): void {
    this.api
      .get<ApiResponse<PayableCategory[]>>('/payables/categories')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.categories = res.data || [];
        },
        error: () => {},
      });
  }

  /**
   * ensure-month materialises the recurring rows for the month. It is
   * idempotent, so calling it on every load is safe. If the user's role can't
   * run it we still want the list, so failures fall through to the load.
   */
  private bootstrapMonth(): void {
    this.loading = true;
    this.ensuring = true;
    this.api
      .post<ApiResponse<unknown>>('/payables/ensure-month', { month: this.month })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.ensuring = false;
          this.loadPayables();
        },
        error: () => {
          this.ensuring = false;
          this.loadPayables();
        },
      });
  }

  loadPayables(): void {
    this.loading = true;
    const params: Record<string, string | number | boolean> = {
      month: this.month,
      limit: 500,
      page: 1,
    };
    if (this.selectedCategory) params['categoryId'] = this.selectedCategory;
    if (this.selectedSource) params['source'] = this.selectedSource;

    this.api
      .get<ApiResponse<Payable[]>>('/payables', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.payables = res.data || [];
          this.amountEdits = {};
          this.payOpenId = null;
          this.loading = false;
        },
        error: (err) => {
          this.loading = false;
          this.notify.error(err.error?.error || 'Failed to load payables');
        },
      });
  }

  onMonthChange(): void {
    if (!/^\d{4}-\d{2}$/.test(this.month)) return;
    this.bootstrapMonth();
  }

  shiftMonth(delta: number): void {
    const year = Number(this.month.slice(0, 4));
    const mon = Number(this.month.slice(5, 7));
    const zero = year * 12 + (mon - 1) + delta;
    const y = Math.floor(zero / 12);
    const m = (zero % 12) + 1;
    this.month = `${y}-${String(m).padStart(2, '0')}`;
    this.bootstrapMonth();
  }

  onFilter(): void {
    this.loadPayables();
  }

  clearFilters(): void {
    this.selectedCategory = '';
    this.selectedSource = '';
    this.loadPayables();
  }

  // ─────────────────────────── grouping ───────────────────────────

  /** Decimals arrive from Prisma as strings — always Number() before math. */
  num(value: string | number | null | undefined): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }

  balanceOf(p: Payable): number {
    return Math.max(0, this.round2(this.num(p.amount) - this.num(p.paidAmount)));
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  isOverdue(p: Payable): boolean {
    if (!p.dueDate) return false;
    if (p.status === 'paid' || p.status === 'void') return false;
    return this.ymdOf(p.dueDate) < this.istToday();
  }

  get dueList(): Payable[] {
    return this.payables
      .filter((p) => p.status === 'pending' || p.status === 'part_paid')
      .sort((a, b) => {
        const ao = this.isOverdue(a) ? 0 : 1;
        const bo = this.isOverdue(b) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        const ad = a.dueDate ? this.ymdOf(a.dueDate) : '9999-12-31';
        const bd = b.dueDate ? this.ymdOf(b.dueDate) : '9999-12-31';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return b.id - a.id;
      });
  }

  get paidList(): Payable[] {
    return this.payables
      .filter((p) => p.status === 'paid')
      .sort((a, b) => {
        const ad = this.lastPaidAt(a) || '';
        const bd = this.lastPaidAt(b) || '';
        if (ad !== bd) return ad < bd ? 1 : -1;
        return b.id - a.id;
      });
  }

  get voidList(): Payable[] {
    return this.payables.filter((p) => p.status === 'void');
  }

  get dueTotal(): number {
    return this.round2(this.dueList.reduce((sum, p) => sum + this.balanceOf(p), 0));
  }

  get paidTotal(): number {
    return this.round2(
      this.payables
        .filter((p) => p.status !== 'void')
        .reduce((sum, p) => sum + this.num(p.paidAmount), 0)
    );
  }

  get monthTotal(): number {
    return this.round2(
      this.payables
        .filter((p) => p.status !== 'void')
        .reduce((sum, p) => sum + this.num(p.amount), 0)
    );
  }

  get overdueCount(): number {
    return this.dueList.filter((p) => this.isOverdue(p)).length;
  }

  get breakdown(): CategoryBreakdownRow[] {
    const map = new Map<string, CategoryBreakdownRow>();
    for (const p of this.payables) {
      if (p.status === 'void') continue;
      const key = p.category ? String(p.category.id) : `src:${p.source}`;
      const name = p.category ? p.category.name : this.sourceLabel(p.source);
      const row = map.get(key) || { key, name, due: 0, paid: 0, total: 0 };
      row.due = this.round2(row.due + this.balanceOf(p));
      row.paid = this.round2(row.paid + this.num(p.paidAmount));
      row.total = this.round2(row.total + this.num(p.amount));
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }

  // ─────────────────────────── inline amount edit ───────────────────────────

  amountValue(p: Payable): string {
    const edit = this.amountEdits[p.id];
    return edit !== undefined ? edit : String(this.num(p.amount));
  }

  onAmountInput(p: Payable, value: string): void {
    this.amountEdits[p.id] = value;
  }

  amountDirty(p: Payable): boolean {
    const edit = this.amountEdits[p.id];
    if (edit === undefined) return false;
    if (edit.trim() === '') return false;
    return this.round2(Number(edit)) !== this.round2(this.num(p.amount));
  }

  cancelAmount(p: Payable): void {
    delete this.amountEdits[p.id];
  }

  saveAmount(p: Payable): void {
    if (p.isSystem || !this.amountDirty(p) || this.savingAmountId !== null) return;
    const amount = this.round2(Number(this.amountEdits[p.id]));
    if (!Number.isFinite(amount) || amount <= 0) {
      this.notify.error('Amount must be greater than zero');
      return;
    }
    if (amount < this.num(p.paidAmount)) {
      this.notify.error('Amount cannot be less than what has already been paid');
      return;
    }

    this.savingAmountId = p.id;
    this.api
      .put<ApiResponse<Payable>>(`/payables/${p.id}`, { amount })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.savingAmountId = null;
          this.notify.success('Amount updated');
          this.loadPayables();
        },
        error: (err) => {
          this.savingAmountId = null;
          this.notify.error(err.error?.error || 'Failed to update amount');
        },
      });
  }

  // ─────────────────────────── pay ───────────────────────────

  togglePay(p: Payable): void {
    if (this.payOpenId === p.id) {
      this.payOpenId = null;
      return;
    }
    this.payOpenId = p.id;
    this.payAmount = String(this.balanceOf(p));
    this.payMethod = 'cash';
    this.payDate = this.istToday();
    this.payReference = '';
    this.payNotes = '';
  }

  closePay(): void {
    this.payOpenId = null;
  }

  payFull(p: Payable): void {
    this.payAmount = String(this.balanceOf(p));
  }

  get payAmountValid(): boolean {
    const n = Number(this.payAmount);
    return Number.isFinite(n) && n > 0;
  }

  submitPay(p: Payable): void {
    if (this.paying || !this.payAmountValid || !this.payDate) return;
    const amount = this.round2(Number(this.payAmount));
    if (amount > this.balanceOf(p) + 0.001) {
      this.notify.error('Payment is more than the outstanding balance');
      return;
    }

    this.paying = true;
    this.api
      .post<ApiResponse<Payable>>(`/payables/${p.id}/pay`, {
        amount,
        method: this.payMethod,
        paidAt: this.payDate,
        reference: this.payReference.trim() || undefined,
        notes: this.payNotes.trim() || undefined,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.paying = false;
          const settled = amount >= this.balanceOf(p) - 0.001;
          this.notify.success(settled ? 'Payment recorded — settled' : 'Part payment recorded');
          this.payOpenId = null;
          this.loadPayables();
        },
        error: (err) => {
          this.paying = false;
          this.notify.error(err.error?.error || 'Failed to record payment');
        },
      });
  }

  voidPayable(p: Payable): void {
    if (p.isSystem) return;
    if (!confirm(`Void "${p.title}"? It stays on record but stops counting.`)) return;

    this.api
      .delete<ApiResponse<unknown>>(`/payables/${p.id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notify.success('Payable voided');
          this.loadPayables();
        },
        error: (err) => {
          this.notify.error(err.error?.error || 'Failed to void payable');
        },
      });
  }

  // ─────────────────────────── display ───────────────────────────

  formatCurrency(value: string | number | null | undefined): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(this.num(value));
  }

  formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  monthLabel(month: string): string {
    if (!/^\d{4}-\d{2}$/.test(month)) return month;
    const d = new Date(`${month}-01T00:00:00Z`);
    return d.toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  }

  statusLabel(status: PayableStatus): string {
    switch (status) {
      case 'pending':
        return 'Pending';
      case 'part_paid':
        return 'Part paid';
      case 'paid':
        return 'Paid';
      case 'void':
        return 'Void';
      default:
        return status;
    }
  }

  statusClasses(status: PayableStatus): string {
    switch (status) {
      case 'paid':
        return 'bg-green-500/10 text-green-400';
      case 'part_paid':
        return 'bg-amber-500/10 text-amber-400';
      case 'pending':
        return 'bg-blue-500/10 text-blue-400';
      case 'void':
        return 'bg-surface-variant/30 text-on-surface-variant';
      default:
        return 'bg-surface-variant/30 text-on-surface-variant';
    }
  }

  sourceLabel(source: PayableSource): string {
    const found = this.sources.find((s) => s.value === source);
    return found ? found.label : source;
  }

  methodLabel(method: PayMethod): string {
    const found = this.methods.find((m) => m.value === method);
    return found ? found.label : method;
  }

  /** Distinct payment methods used to settle a payable, for the PAID table. */
  paidMethods(p: Payable): string {
    const list = p.payments || [];
    if (!list.length) return '—';
    const seen: PayMethod[] = [];
    for (const pay of list) {
      if (!seen.includes(pay.method)) seen.push(pay.method);
    }
    return seen.map((m) => this.methodLabel(m)).join(', ');
  }

  lastPaidAt(p: Payable): string | null {
    const list = p.payments || [];
    if (!list.length) return null;
    return list.map((x) => x.paidAt).sort()[list.length - 1];
  }

  /** Payroll rows are corrected on the payroll screen, never here (§6). */
  payrollLink(p: Payable): (string | number)[] {
    return ['/employees', 'payroll'];
  }

  payrollQueryParams(p: Payable): Record<string, string> {
    const params: Record<string, string> = {};
    if (p.periodMonth) params['month'] = p.periodMonth;
    if (p.userId) params['userId'] = String(p.userId);
    return params;
  }

  get branchName(): string {
    return this.branchService.getCurrentBranch()?.name || '';
  }

  trackById(_index: number, item: { id: number }): number {
    return item.id;
  }
}
