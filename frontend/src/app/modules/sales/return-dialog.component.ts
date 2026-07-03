import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { AuthService } from '../../core/services/auth.service';
import { ReceiptPrintService } from '../../shared/receipt-print.service';

interface ReturnItem {
  saleItemId: number;
  productName: string;
  size: string;
  color: string;
  maxQuantity: number;
  quantity: number;
  condition: string;
  selected: boolean;
  unitPrice: number;
}

@Component({
  selector: 'app-return-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './return-dialog.component.html',
})
export class ReturnDialogComponent implements OnInit {
  @Input() sale: any;
  @Input() returnableItems: any[] = [];
  @Output() close = new EventEmitter<void>();
  @Output() returnComplete = new EventEmitter<void>();

  items: ReturnItem[] = [];
  submitting = false;
  // §1.2 — fixed Return Reason dropdown (final for V1). 'other' reveals a
  // mandatory free-text box.
  reason = 'size_issue';
  otherReason = '';

  // Refund method. 'proportional' (default) mirrors the original payment split;
  // forcing a single method is a manager/owner action and is audited server-side.
  refundMode: 'proportional' | 'cash' | 'card' | 'upi' = 'proportional';
  refundModes = [
    { value: 'proportional', label: 'Same as original payment' },
    { value: 'cash', label: 'Cash' },
    { value: 'card', label: 'Card' },
    { value: 'upi', label: 'UPI' },
  ];
  get canOverrideRefund(): boolean {
    return this.auth.hasRole(['owner', 'manager']);
  }

  // §1.2 — fixed dropdown, final for V1. Do not add/remove options ad hoc.
  reasons = [
    { value: 'size_issue', label: 'Size Issue' },
    { value: 'defective_damaged', label: 'Defective / Damaged Item' },
    { value: 'wrong_item', label: 'Wrong Item Delivered / Scanned' },
    { value: 'changed_mind', label: 'Customer Changed Mind' },
    { value: 'quality_not_expected', label: 'Quality Not as Expected' },
    { value: 'duplicate_purchase', label: 'Duplicate Purchase' },
    { value: 'other', label: 'Other' },
  ];

  conditions = [
    { value: 'resellable', label: 'Resellable / Like New' },
    { value: 'damaged', label: 'Damaged' },
  ];

  constructor(
    private api: ApiService,
    private notify: NotificationService,
    private receiptPrint: ReceiptPrintService,
    private auth: AuthService
  ) {}

  ngOnInit(): void {
    this.items = this.returnableItems.map((item) => ({
      saleItemId: item.id,
      productName: item.variant?.product?.name || item.productName || item.name || 'Unknown',
      size: item.variant?.size || '-',
      color: item.variant?.color || '-',
      maxQuantity: item.quantity - (item.returnedQuantity || 0),
      quantity: 1,
      condition: 'resellable',
      selected: false,
      // The refund is what the customer actually paid per unit, i.e. the line
      // total (net of every discount) ÷ quantity — NOT the shelf MRP. Fall back
      // to unitPrice only if the line total isn't present.
      unitPrice:
        item.total != null && item.quantity
          ? Number(item.total) / item.quantity
          : item.unitPrice || 0,
    }));
  }

  get selectedItems(): ReturnItem[] {
    return this.items.filter((i) => i.selected);
  }

  get refundAmount(): number {
    return this.selectedItems.reduce(
      (sum, item) => sum + item.unitPrice * item.quantity,
      0
    );
  }

  get canSubmit(): boolean {
    // §1.2 — 'Other' requires the free-text reason to be filled in.
    if (this.reason === 'other' && !this.otherReason.trim()) return false;
    return this.selectedItems.length > 0 && !this.submitting;
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0);
  }

  onClose(): void {
    this.close.emit();
  }

  onBackdropClick(event: Event): void {
    if (event.target === event.currentTarget) {
      this.onClose();
    }
  }

  submit(): void {
    if (!this.canSubmit) return;
    this.submitting = true;

    const body: any = {
      // 'Other' sends the free-text; fixed options send their code.
      reason: this.reason === 'other' ? this.otherReason.trim() : this.reason,
      items: this.selectedItems.map((item) => ({
        saleItemId: item.saleItemId,
        quantity: item.quantity,
        condition: item.condition,
      })),
    };
    if (this.canOverrideRefund && this.refundMode !== 'proportional') {
      body.refundMode = this.refundMode;
    }

    this.api.post(`/sales/${this.sale.id}/return`, body).subscribe({
      next: (res: any) => {
        this.submitting = false;
        const breakup: { method: string; amount: number }[] = res?.refundBreakup || [];
        const summary = breakup
          .map((b) => `${this.formatCurrency(b.amount)} to ${b.method}`)
          .join(' + ');
        this.notify.success(summary ? `Refund: ${summary}` : 'Return processed');
        // §1.3a — hand the customer a printed refund breakup receipt.
        if (res?.data?.id) {
          this.receiptPrint.printRefundReceipt(res.data.id).catch(() => {});
        }
        this.returnComplete.emit();
      },
      error: (err) => {
        this.notify.error(err.error?.error || 'Failed to process return');
        this.submitting = false;
      },
    });
  }

  /**
   * §1.2a — the item failed inspection: record the refused attempt (no return,
   * no refund, no stock movement) and close. Requires the same reason field.
   */
  reject(): void {
    if (this.submitting) return;
    const reason = this.reason === 'other' ? this.otherReason.trim() : this.reason;
    if (!reason) {
      this.notify.error('Select a reason before recording a rejection');
      return;
    }
    this.submitting = true;
    const body = {
      reason,
      saleItemIds: this.selectedItems.map((i) => i.saleItemId),
    };
    this.api.post(`/sales/${this.sale.id}/reject`, body).subscribe({
      next: () => {
        this.submitting = false;
        this.notify.success('Rejection recorded — no return processed');
        this.returnComplete.emit();
      },
      error: (err) => {
        this.notify.error(err.error?.error || 'Failed to record rejection');
        this.submitting = false;
      },
    });
  }
}
