import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface EditLine {
  saleItemId?: number; // existing line
  barcode?: string; // new line
  name: string;
  size: string;
  color: string;
  unitPrice: number;
  quantity: number;
  minQty: number; // returnedQuantity for existing lines (can't go below)
  isNew: boolean;
}

@Component({
  selector: 'app-bill-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="p-6 max-w-3xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <a [routerLink]="['/sales', saleId]" class="material-symbols-outlined text-on-surface-variant hover:text-on-surface">arrow_back</a>
        <div>
          <h1 class="text-xl font-headline font-bold text-on-surface">Edit Bill {{ sale?.saleNumber }}</h1>
          <p class="text-xs font-body text-on-surface-variant">Adjust items or discount; the difference is collected or refunded automatically.</p>
        </div>
      </div>

      @if (loading) {
        <p class="text-sm text-on-surface-variant py-8 text-center">Loading…</p>
      } @else if (sale) {
        <!-- Items -->
        <div class="space-y-2 mb-5">
          @for (line of lines; track $index) {
            <div class="flex items-center gap-3 p-3 rounded-xl bg-surface-container border border-outline-variant/15">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-on-surface truncate">{{ line.name }}</p>
                <p class="text-[11px] text-on-surface-variant">{{ line.size }}/{{ line.color }} · {{ formatCurrency(line.unitPrice) }}
                  @if (line.minQty > 0) { <span class="text-amber-500">· {{ line.minQty }} returned</span> }
                  @if (line.isNew) { <span class="text-green-500">· new</span> }
                </p>
              </div>
              <div class="flex items-center gap-1">
                <button (click)="dec(line)" [disabled]="line.quantity <= line.minQty || line.quantity <= 1"
                  class="w-7 h-7 rounded-lg bg-surface-container-high text-on-surface-variant disabled:opacity-30">−</button>
                <span class="w-8 text-center text-sm font-bold">{{ line.quantity }}</span>
                <button (click)="inc(line)" class="w-7 h-7 rounded-lg bg-surface-container-high text-on-surface-variant">+</button>
              </div>
              <div class="w-20 text-right text-sm font-headline font-bold text-on-surface">{{ formatCurrency(line.unitPrice * line.quantity) }}</div>
              <button (click)="remove(line)" [disabled]="line.minQty > 0"
                [title]="line.minQty > 0 ? 'Has returned units — cannot remove' : 'Remove'"
                class="p-1 rounded text-on-surface-variant/60 hover:text-red-400 disabled:opacity-20 disabled:hover:text-on-surface-variant/60">
                <span class="material-symbols-outlined text-base">delete</span>
              </button>
            </div>
          }
        </div>

        <!-- Add item -->
        <div class="flex gap-2 mb-5">
          <input [(ngModel)]="addBarcode" (keyup.enter)="addItem()" placeholder="Scan / type barcode to add an item"
            class="flex-1 bg-surface-container border border-outline-variant/20 text-on-surface text-sm px-3 py-2 rounded-lg outline-none" />
          <button (click)="addItem()" [disabled]="addLoading || !addBarcode.trim()"
            class="px-4 py-2 rounded-lg bg-primary-container/20 text-primary text-xs font-bold uppercase tracking-wider disabled:opacity-40">
            {{ addLoading ? '…' : 'Add' }}
          </button>
        </div>

        <!-- Discount + reason -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Manual Discount (₹)</label>
            <input type="number" min="0" [(ngModel)]="discount"
              class="w-full bg-surface-container border border-outline-variant/20 text-on-surface text-sm px-3 py-2 rounded-lg outline-none" />
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Reason (required)</label>
            <input type="text" [(ngModel)]="reason" placeholder="e.g. added item, family & friends discount"
              class="w-full bg-surface-container border border-outline-variant/20 text-on-surface text-sm px-3 py-2 rounded-lg outline-none" />
          </div>
        </div>

        <!-- Summary -->
        <div class="p-4 rounded-xl bg-surface-container-high/40 border border-outline-variant/15 mb-5 space-y-1.5 text-sm">
          <div class="flex justify-between text-on-surface-variant"><span>Original total</span><span>{{ formatCurrency(originalTotal) }}</span></div>
          <div class="flex justify-between text-on-surface"><span>Estimated new total</span><span class="font-bold">{{ formatCurrency(estimatedTotal) }}</span></div>
          <div class="flex justify-between" [class.text-green-500]="estimatedDiff < 0" [class.text-primary]="estimatedDiff > 0">
            <span>{{ estimatedDiff >= 0 ? 'To collect' : 'To refund' }}</span>
            <span class="font-bold">{{ formatCurrency(absDiff) }}</span>
          </div>
          <p class="text-[10px] text-on-surface-variant/60 pt-1">Estimate excludes offers; the exact total is computed on save.</p>
        </div>

        <!-- Settlement method (only when collecting more) -->
        @if (estimatedDiff > 0.5) {
          <div class="mb-5">
            <label class="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Collect extra via</label>
            <div class="grid grid-cols-3 gap-2">
              @for (m of ['cash','card','upi']; track m) {
                <button (click)="settlementMethod = m"
                  class="py-2 rounded-lg border-2 text-xs font-bold uppercase tracking-wider"
                  [class]="settlementMethod === m ? 'border-primary-container bg-primary-container/10 text-primary' : 'border-outline-variant/20 text-on-surface-variant'">
                  {{ m }}
                </button>
              }
            </div>
          </div>
        }

        <div class="flex gap-3">
          <a [routerLink]="['/sales', saleId]" class="px-5 py-3 rounded-xl bg-surface-container-high text-on-surface-variant text-sm font-semibold">Cancel</a>
          <button (click)="save()" [disabled]="saving || !reason.trim() || lines.length === 0"
            class="flex-1 py-3 rounded-xl bg-gradient-cta text-white font-bold disabled:opacity-50">
            {{ saving ? 'Saving…' : 'Save Changes' }}
          </button>
        </div>
      }
    </div>
  `,
})
export class BillEditComponent implements OnInit {
  saleId = '';
  sale: any = null;
  lines: EditLine[] = [];
  loading = false;
  saving = false;
  addBarcode = '';
  addLoading = false;
  discount = 0;
  reason = '';
  settlementMethod = 'cash';
  originalTotal = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.saleId = this.route.snapshot.paramMap.get('id') || '';
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.get<any>(`/sales/${this.saleId}`).subscribe({
      next: (res: any) => {
        this.sale = res.data;
        this.originalTotal = Number(this.sale.total);
        // Seed the manual-discount field with the non-offer, non-loyalty portion
        // isn't reliably separable, so start from 0 — the cashier sets the new
        // discount explicitly.
        this.lines = (this.sale.items || []).map((it: any) => ({
          saleItemId: it.id,
          name: it.variant?.product?.name || it.productName || 'Item',
          size: it.variant?.size || '-',
          color: it.variant?.color || '-',
          unitPrice: Number(it.unitPrice),
          quantity: it.quantity,
          minQty: it.returnedQuantity || 0,
          isNew: false,
        }));
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.error('Failed to load sale');
      },
    });
  }

  inc(line: EditLine): void {
    line.quantity++;
  }
  dec(line: EditLine): void {
    if (line.quantity > line.minQty && line.quantity > 1) line.quantity--;
  }
  remove(line: EditLine): void {
    if (line.minQty > 0) return;
    this.lines = this.lines.filter((l) => l !== line);
  }

  addItem(): void {
    const code = this.addBarcode.trim();
    if (!code) return;
    this.addLoading = true;
    this.api.get<any>(`/pos/lookup/${encodeURIComponent(code)}`).subscribe({
      next: (res: any) => {
        this.addLoading = false;
        const v = res.data;
        if (!v) {
          this.notify.error(`No product for ${code}`);
          return;
        }
        const existing = this.lines.find((l) => l.isNew && l.barcode === (v.barcode || code));
        if (existing) {
          existing.quantity++;
        } else {
          this.lines.push({
            barcode: v.barcode || code,
            name: v.productName || v.product?.name || 'Item',
            size: v.size || '-',
            color: v.color || '-',
            unitPrice: Number(v.price),
            quantity: 1,
            minQty: 0,
            isNew: true,
          });
        }
        this.addBarcode = '';
      },
      error: (err) => {
        this.addLoading = false;
        this.notify.error(err.error?.error || `No product for ${code}`);
      },
    });
  }

  get estimatedTotal(): number {
    const sub = this.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    return Math.max(0, Math.round((sub - (this.discount || 0)) * 100) / 100);
  }
  get estimatedDiff(): number {
    return Math.round((this.estimatedTotal - this.originalTotal) * 100) / 100;
  }
  get absDiff(): number {
    return Math.abs(this.estimatedDiff);
  }

  save(): void {
    if (!this.reason.trim() || this.lines.length === 0) return;
    this.saving = true;
    const body: any = {
      reason: this.reason.trim(),
      discountAmount: this.discount || 0,
      items: this.lines.map((l) =>
        l.isNew
          ? { barcode: l.barcode, quantity: l.quantity }
          : { saleItemId: l.saleItemId, quantity: l.quantity }
      ),
    };
    if (this.estimatedDiff > 0.5) body.settlementMethod = this.settlementMethod;

    this.api.put<any>(`/sales/${this.saleId}/edit`, body).subscribe({
      next: (res: any) => {
        this.saving = false;
        const d = res.data || {};
        if (d.diff < 0 && d.refundBreakup?.length) {
          const summary = d.refundBreakup.map((b: any) => `${this.formatCurrency(b.amount)} to ${b.method}`).join(' + ');
          this.notify.success(`Bill updated · refund ${summary}`);
        } else if (d.diff > 0) {
          this.notify.success(`Bill updated · collected ${this.formatCurrency(d.diff)}`);
        } else {
          this.notify.success('Bill updated');
        }
        this.router.navigate(['/sales', this.saleId]);
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err.error?.error || 'Failed to update bill');
      },
    });
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0);
  }
}
