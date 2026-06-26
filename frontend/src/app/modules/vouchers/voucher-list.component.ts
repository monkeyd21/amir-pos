import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';

interface Voucher {
  id: number;
  code: string;
  initialValue: string | number;
  balance: string | number;
  status: string;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
  customer?: { firstName: string; lastName: string | null; phone: string } | null;
}

@Component({
  selector: 'app-voucher-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-6 max-w-5xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <span class="material-symbols-outlined text-2xl text-primary">redeem</span>
        <div>
          <h1 class="text-xl font-headline font-bold text-on-surface">Gift Vouchers</h1>
          <p class="text-xs font-body text-on-surface-variant">Issue stored-value vouchers; redeem them as a tender at the POS.</p>
        </div>
      </div>

      <!-- Create (managers/owners) -->
      @if (canManage) {
        <div class="bg-surface-container rounded-xl p-5 mb-5 border border-outline-variant/15">
          <h2 class="text-sm font-headline font-bold text-on-surface mb-3">New Voucher</h2>
          <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label class="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Value (₹)</label>
              <input type="number" min="1" [(ngModel)]="newValue"
                class="w-full px-3 py-2 text-sm bg-surface-container-high rounded-lg border border-outline-variant/20 outline-none" />
            </div>
            <div>
              <label class="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Expires (optional)</label>
              <input type="date" [(ngModel)]="newExpiry"
                class="w-full px-3 py-2 text-sm bg-surface-container-high rounded-lg border border-outline-variant/20 outline-none" />
            </div>
            <div class="sm:col-span-1">
              <label class="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Note (optional)</label>
              <input type="text" [(ngModel)]="newNotes" placeholder="e.g. Diwali gift"
                class="w-full px-3 py-2 text-sm bg-surface-container-high rounded-lg border border-outline-variant/20 outline-none" />
            </div>
            <button (click)="create()" [disabled]="creating || !((newValue ?? 0) > 0)"
              class="px-5 py-2 text-sm font-semibold bg-gradient-cta text-white rounded-lg disabled:opacity-50">
              {{ creating ? 'Creating…' : 'Create' }}
            </button>
          </div>
        </div>
      }

      <!-- Filter -->
      <div class="flex gap-2 mb-4">
        <select [(ngModel)]="statusFilter" (ngModelChange)="load()"
          class="px-3 py-2 text-sm bg-surface-container-high rounded-lg border border-outline-variant/20 outline-none">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="redeemed">Redeemed</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input [(ngModel)]="codeFilter" (keyup.enter)="load()" placeholder="Search code…"
          class="px-3 py-2 text-sm bg-surface-container-high rounded-lg border border-outline-variant/20 outline-none" />
      </div>

      @if (loading) {
        <p class="text-sm text-on-surface-variant py-8 text-center">Loading…</p>
      } @else if (vouchers.length === 0) {
        <p class="text-sm text-on-surface-variant py-8 text-center">No vouchers.</p>
      } @else {
        <div class="space-y-2">
          @for (v of vouchers; track v.id) {
            <div class="flex items-center gap-4 p-4 rounded-xl bg-surface-container border border-outline-variant/15">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-mono font-bold text-on-surface">{{ v.code }}</span>
                  <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                    [class]="badgeClass(v.status)">{{ v.status }}</span>
                </div>
                <div class="text-[11px] text-on-surface-variant mt-0.5">
                  <span *ngIf="v.customer">{{ v.customer.firstName }} {{ v.customer.lastName || '' }} · </span>
                  <span *ngIf="v.expiresAt">expires {{ v.expiresAt | date: 'dd MMM yyyy' }} · </span>
                  <span *ngIf="v.notes">{{ v.notes }}</span>
                </div>
              </div>
              <div class="text-right">
                <div class="text-sm font-headline font-bold text-on-surface">{{ formatCurrency(v.balance) }}</div>
                <div class="text-[10px] text-on-surface-variant/70">of {{ formatCurrency(v.initialValue) }}</div>
              </div>
              @if (canManage && v.status === 'active') {
                <button (click)="cancel(v)" class="text-xs text-error/80 hover:text-error px-2 py-1">Cancel</button>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class VoucherListComponent implements OnInit {
  vouchers: Voucher[] = [];
  loading = false;
  creating = false;
  statusFilter = '';
  codeFilter = '';
  newValue: number | null = null;
  newExpiry = '';
  newNotes = '';

  constructor(
    private api: ApiService,
    private notify: NotificationService,
    private auth: AuthService
  ) {}

  get canManage(): boolean {
    return this.auth.hasRole(['owner', 'manager']);
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    const params: any = { limit: 50 };
    if (this.statusFilter) params.status = this.statusFilter;
    if (this.codeFilter) params.code = this.codeFilter;
    this.api.get<Voucher[]>('/vouchers', params).subscribe({
      next: (res: any) => {
        this.vouchers = res.data || [];
        this.loading = false;
      },
      error: () => {
        this.vouchers = [];
        this.loading = false;
      },
    });
  }

  create(): void {
    if (!(this.newValue && this.newValue > 0)) return;
    this.creating = true;
    const body: any = { value: this.newValue };
    if (this.newExpiry) body.expiresAt = this.newExpiry;
    if (this.newNotes.trim()) body.notes = this.newNotes.trim();
    this.api.post('/vouchers', body).subscribe({
      next: (res: any) => {
        this.creating = false;
        this.notify.success(`Voucher ${res.data?.code} created`);
        this.newValue = null;
        this.newExpiry = '';
        this.newNotes = '';
        this.load();
      },
      error: (err) => {
        this.creating = false;
        this.notify.error(err.error?.error || 'Failed to create voucher');
      },
    });
  }

  cancel(v: Voucher): void {
    if (!confirm(`Cancel voucher ${v.code}? Its remaining ${this.formatCurrency(v.balance)} will be forfeited.`)) return;
    this.api.post(`/vouchers/${v.id}/cancel`, {}).subscribe({
      next: () => {
        this.notify.success('Voucher cancelled');
        this.load();
      },
      error: (err) => this.notify.error(err.error?.error || 'Failed to cancel'),
    });
  }

  badgeClass(status: string): string {
    switch (status) {
      case 'active':
        return 'bg-green-500/15 text-green-500';
      case 'redeemed':
        return 'bg-primary-container/20 text-primary';
      case 'expired':
      case 'cancelled':
        return 'bg-error/15 text-error';
      default:
        return 'bg-surface-container-highest text-on-surface-variant';
    }
  }

  formatCurrency(amount: string | number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(Number(amount) || 0);
  }
}
