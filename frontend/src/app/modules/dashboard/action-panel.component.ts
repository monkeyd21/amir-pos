import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { isValidPhone } from '../../shared/validation/phone';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { OfflineService } from '../../core/services/offline.service';
import { DdMmYyyyPipe, InrPipe, paymentLabel, timeIst } from './dash-ui';
import { SidePanelComponent } from './side-panel.component';

export type ActionKind = 'attendance' | 'expenses' | 'pending-sales' | 'upi' | 'loyalty';

const TITLES: Record<ActionKind, string> = {
  attendance: 'Mark attendance',
  expenses: 'Today’s expenses',
  'pending-sales': 'Pending sales to bill',
  upi: 'Unmatched UPI credits',
  loyalty: 'Points expiring soon',
};

type AttendanceStatus = 'present' | 'half_day' | 'late' | 'absent' | 'paid_weekly_off';

interface PendingSale {
  id: number;
  number: string;
  businessDate: string;
  createdAt: string;
  paymentMode: 'cash' | 'upi';
  amountReceived: string | number;
  notes: string | null;
  creator: { firstName: string; lastName: string | null };
  items: { id: number; quantity: number; tagPrice: string | number; variant: { barcode: string; size: string; color: string; product: { name: string } } }[];
}

interface UpiCredit {
  id: number;
  receivedAt: string;
  amount: string | number;
  reference: string;
  payerName: string | null;
  payerVpa: string | null;
}

/**
 * Dashboard spec §1.6: the Daily Actionable widget's quick actions, saved in
 * place through the source modules' own APIs (Attendance, Payables, Pending
 * Sales, UPI credits), never a private copy. On save the dashboard refetches
 * and the item clears.
 */
@Component({
  selector: 'app-action-panel',
  standalone: true,
  imports: [NgClass, FormsModule, InrPipe, DdMmYyyyPipe, SidePanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './action-panel.component.html',
})
export class ActionPanelComponent implements OnChanges {
  @Input({ required: true }) kind!: ActionKind;
  @Output() closed = new EventEmitter<void>();
  @Output() changed = new EventEmitter<void>();

  private readonly api = inject(ApiService);
  private readonly notify = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly offline = inject(OfflineService);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly paymentLabel = paymentLabel;
  readonly timeIst = timeIst;

  // Attendance
  readonly attendanceDate = signal('');
  readonly staff = signal<{ userId: number; name: string; role: string; status: AttendanceStatus | null }[]>([]);
  readonly statuses: { id: AttendanceStatus; label: string }[] = [
    { id: 'present', label: 'Present' },
    { id: 'half_day', label: 'Half day' },
    { id: 'late', label: 'Late' },
    { id: 'absent', label: 'Absent' },
    { id: 'paid_weekly_off', label: 'Weekly off' },
  ];

  // Expenses
  readonly categories = signal<{ id: number; name: string }[]>([]);
  expense = { categoryId: null as number | null, amount: null as number | null, method: 'cash', note: '' };
  readonly payMethods = ['cash', 'upi', 'card', 'bank', 'cheque'];

  // Pending sales
  readonly pending = signal<PendingSale[]>([]);
  readonly openId = signal<number | null>(null);
  readonly mode = signal<'finalize' | 'void' | null>(null);
  finalize = { phone: '', firstName: '', discount: null as number | null, method: 'cash' };
  readonly foundCustomer = signal<{ id: number; name: string } | null>(null);
  readonly lookedUp = signal(false);
  voidReason = '';

  // UPI credits
  readonly credits = signal<UpiCredit[]>([]);
  readonly candidates = signal<{ payments: any[]; pendingSales: any[] } | null>(null);
  readonly upiMode = signal<'match' | 'pending' | 'nonsale' | null>(null);
  nonSaleReason = '';
  scanCode = '';
  readonly scanned = signal<string[]>([]);

  // Loyalty
  readonly loyalty = signal<{ days: number; customers: { id: number; name: string; phone: string; balance: number; expiring: number; expiresOn: string }[] } | null>(null);

  title(): string {
    return TITLES[this.kind];
  }

  ngOnChanges(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    const fail = (err: any) => {
      this.error.set(err?.error?.error || 'Could not load this.');
      this.loading.set(false);
    };
    switch (this.kind) {
      case 'attendance':
        this.api.get<any>('/dashboard/drill/attendance').subscribe({
          next: (res) => {
            this.attendanceDate.set(res.data.date);
            this.staff.set(res.data.staff);
            this.loading.set(false);
          },
          error: fail,
        });
        break;
      case 'expenses':
        this.api.get<any>('/payables/categories').subscribe({
          next: (res) => {
            const cats = (res.data ?? []).filter((c: any) => !c.isSystem && c.isActive !== false);
            this.categories.set(cats.map((c: any) => ({ id: c.id, name: c.name })));
            this.loading.set(false);
          },
          error: fail,
        });
        break;
      case 'pending-sales':
        this.api.get<any>('/pending-sales').subscribe({
          next: (res) => {
            this.pending.set(res.data ?? []);
            this.loading.set(false);
          },
          error: fail,
        });
        break;
      case 'upi':
        this.api.get<any>('/upi-credits', { status: 'unmatched' }).subscribe({
          next: (res) => {
            this.credits.set(res.data ?? []);
            this.loading.set(false);
          },
          error: fail,
        });
        break;
      case 'loyalty':
        this.api.get<any>('/dashboard/drill/loyalty').subscribe({
          next: (res) => {
            this.loyalty.set(res.data);
            this.loading.set(false);
          },
          error: fail,
        });
        break;
    }
  }

  private done(message: string): void {
    this.busy.set(false);
    this.notify.success(message);
    this.changed.emit();
  }

  private failed(err: any, fallback: string): void {
    this.busy.set(false);
    this.notify.error(err?.error?.error || fallback);
  }

  // ─── Attendance (writes through POST /employees/attendance/bulk) ───

  setStatus(userId: number, status: AttendanceStatus): void {
    this.staff.update((list) => list.map((s) => (s.userId === userId ? { ...s, status } : s)));
  }

  markRest(status: AttendanceStatus): void {
    this.staff.update((list) => list.map((s) => (s.status ? s : { ...s, status })));
  }

  unmarkedCount(): number {
    return this.staff().filter((s) => !s.status).length;
  }

  saveAttendance(): void {
    const entries = this.staff()
      .filter((s) => s.status)
      .map((s) => ({ userId: s.userId, status: s.status }));
    if (!entries.length) return;
    this.busy.set(true);
    this.api.post('/employees/attendance/bulk', { date: this.attendanceDate(), entries }).subscribe({
      next: () => {
        this.done('Attendance saved');
        if (this.unmarkedCount() === 0) this.closed.emit();
      },
      error: (err) => this.failed(err, 'Could not save attendance'),
    });
  }

  // ─── Expenses (through the Payables module) ───

  addExpense(): void {
    const e = this.expense;
    if (!e.categoryId || !e.amount || e.amount <= 0) {
      this.notify.error('Pick a category and enter the amount');
      return;
    }
    this.busy.set(true);
    this.api
      .post('/dashboard/actions/expense', { categoryId: e.categoryId, amount: e.amount, method: e.method, note: e.note.trim() || null })
      .subscribe({
        next: () => {
          this.expense = { categoryId: null, amount: null, method: 'cash', note: '' };
          this.done('Expense recorded');
          this.closed.emit();
        },
        error: (err) => this.failed(err, 'Could not record the expense'),
      });
  }

  noExpenseToday(): void {
    this.busy.set(true);
    this.api.post('/dashboard/actions/no-expense', {}).subscribe({
      next: () => {
        this.done('Marked: no expense today');
        this.closed.emit();
      },
      error: (err) => this.failed(err, 'Could not mark it'),
    });
  }

  // ─── Pending sales (finalize into a bill, or void) ───

  pendingValue(p: PendingSale): number {
    return p.items.reduce((t, i) => t + Number(i.tagPrice) * i.quantity, 0);
  }

  openPending(p: PendingSale, mode: 'finalize' | 'void'): void {
    this.openId.set(p.id);
    this.mode.set(mode);
    this.finalize = { phone: '', firstName: '', discount: null, method: p.paymentMode };
    this.foundCustomer.set(null);
    this.lookedUp.set(false);
    this.voidReason = '';
  }

  lookupPhone(): void {
    const phone = this.finalize.phone.replace(/\D/g, '');
    if (!isValidPhone(phone)) {
      this.notify.error('Enter a 10-digit mobile number');
      return;
    }
    this.api.get<any>('/customers/search', { search: phone, limit: 1 }).subscribe({
      next: (res) => {
        const c = (res.data ?? []).find((x: any) => x.phone === phone);
        this.foundCustomer.set(c ? { id: c.id, name: `${c.firstName} ${c.lastName ?? ''}`.trim() } : null);
        this.lookedUp.set(true);
      },
      error: (err) => this.failed(err, 'Could not look the number up'),
    });
  }

  confirmFinalize(p: PendingSale): void {
    this.busy.set(true);
    const send = (customerId: number | null): void => {
      this.api
        .post<any>(`/pending-sales/${p.id}/finalize`, {
          customerId,
          discountAmount: this.finalize.discount ?? 0,
          payments: [
            {
              method: this.finalize.method,
              amount: Math.max(0, this.pendingValue(p) - (this.finalize.discount ?? 0)),
            },
          ],
        })
        .subscribe({
          next: (res) => {
            this.done(`Billed as ${res.data?.sale?.saleNumber ?? 'a new bill'}`);
            this.openId.set(null);
            this.load();
          },
          error: (err) => this.failed(err, 'Could not finalise it'),
        });
    };

    const phone = this.finalize.phone.replace(/\D/g, '');
    if (this.foundCustomer()) {
      send(this.foundCustomer()!.id);
      return;
    }
    if (phone && this.finalize.firstName.trim()) {
      // A new customer: create them through the Customers module first.
      this.api.post<any>('/customers', { firstName: this.finalize.firstName.trim(), phone }).subscribe({
        next: (res) => send(res.data.id),
        error: (err) => this.failed(err, 'Could not add the customer'),
      });
      return;
    }
    send(null);
  }

  confirmVoid(p: PendingSale): void {
    if (this.voidReason.trim().length < 3) {
      this.notify.error('Say why it is being voided');
      return;
    }
    this.busy.set(true);
    this.api.post(`/pending-sales/${p.id}/void`, { reason: this.voidReason.trim() }).subscribe({
      next: () => {
        this.done(`${p.number} voided. Its pieces are back in stock.`);
        this.openId.set(null);
        this.load();
      },
      error: (err) => this.failed(err, 'Could not void it'),
    });
  }

  // ─── UPI credits (match, create a pending sale, or not a sale) ───

  openCredit(c: UpiCredit, mode: 'match' | 'pending' | 'nonsale'): void {
    this.openId.set(c.id);
    this.upiMode.set(mode);
    this.candidates.set(null);
    this.nonSaleReason = '';
    this.scanned.set([]);
    this.scanCode = '';
    if (mode === 'match') {
      this.api.get<any>(`/upi-credits/${c.id}/candidates`).subscribe({
        next: (res) => this.candidates.set(res.data),
        error: (err) => this.failed(err, 'Could not find candidates'),
      });
    }
  }

  matchTo(c: UpiCredit, target: { paymentId?: number; pendingSaleId?: number }): void {
    this.busy.set(true);
    this.api.post(`/upi-credits/${c.id}/match`, target).subscribe({
      next: () => {
        this.done('Matched');
        this.openId.set(null);
        this.load();
      },
      error: (err) => this.failed(err, 'Could not match it'),
    });
  }

  addScan(): void {
    const code = this.scanCode.trim();
    if (!code) return;
    this.scanned.update((l) => [...l, code]);
    this.scanCode = '';
  }

  removeScan(i: number): void {
    this.scanned.update((l) => l.filter((_, j) => j !== i));
  }

  /** The credit paid for pieces nobody billed: capture them as a pending sale and match it. */
  createPendingFromCredit(c: UpiCredit): void {
    if (!this.scanned().length) {
      this.notify.error('Scan the pieces this payment was for');
      return;
    }
    const counts = new Map<string, number>();
    for (const code of this.scanned()) counts.set(code, (counts.get(code) ?? 0) + 1);
    this.busy.set(true);
    this.api
      .post<any>('/pending-sales', {
        items: [...counts.entries()].map(([barcode, quantity]) => ({ barcode, quantity })),
        paymentMode: 'upi',
        amountReceived: Number(c.amount),
        notes: `From UPI credit ${c.reference}`,
        clientRef: this.offline.newClientRef(),
      })
      .subscribe({
        next: (res) => this.matchTo(c, { pendingSaleId: res.data.id }),
        error: (err) => this.failed(err, 'Could not create the pending sale'),
      });
  }

  markNonSale(c: UpiCredit): void {
    if (this.nonSaleReason.trim().length < 3) {
      this.notify.error('Say what this money was');
      return;
    }
    this.busy.set(true);
    this.api.post(`/upi-credits/${c.id}/non-sale`, { reason: this.nonSaleReason.trim() }).subscribe({
      next: () => {
        this.done('Marked as not a sale');
        this.openId.set(null);
        this.load();
      },
      error: (err) => this.failed(err, 'Could not mark it'),
    });
  }

  goTo(path: string): void {
    this.closed.emit();
    this.router.navigateByUrl(path);
  }
}

