import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '../../shared/dialog/dialog-ref';
import { DIALOG_DATA } from '../../shared/dialog/dialog.tokens';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { VendorPickerComponent } from '../vendors/vendor-picker.component';

interface AdjustmentDialogData {
  inventoryItem: {
    id: number;
    variantId: number;
    branchId: number;
    quantity: number;
    variant?: {
      id: number;
      sku: string;
      size?: string;
      color?: string;
      product?: { name: string };
    };
  };
}

@Component({
  selector: 'app-stock-adjustment-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, VendorPickerComponent],
  templateUrl: './stock-adjustment-dialog.component.html',
})
export class StockAdjustmentDialogComponent implements OnInit {
  adjustmentType: 'add' | 'remove' | 'set' = 'add';
  quantity: number | null = null;
  reason = '';
  saving = false;
  vendorId: number | null = null;

  productName = '';
  variantLabel = '';
  currentStock = 0;

  get isPurchase(): boolean {
    const r = (this.reason || '').toLowerCase();
    return r.includes('purchase') || r.includes('stock receipt') || r.includes('supplier');
  }

  constructor(
    public dialogRef: DialogRef<boolean>,
    @Inject(DIALOG_DATA) public data: AdjustmentDialogData,
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    const item = this.data.inventoryItem;
    this.productName = item.variant?.product?.name || 'Unknown Product';
    this.currentStock = item.quantity;

    const parts: string[] = [];
    if (item.variant?.size) parts.push(item.variant.size);
    if (item.variant?.color) parts.push(item.variant.color);
    this.variantLabel = parts.join(' / ') || item.variant?.sku || '';
  }

  get isValid(): boolean {
    return this.quantity !== null && this.quantity > 0 && !!this.reason.trim();
  }

  get previewStock(): number {
    const q = this.quantity || 0;
    switch (this.adjustmentType) {
      case 'add':
        return this.currentStock + q;
      case 'remove':
        return Math.max(0, this.currentStock - q);
      case 'set':
        return q;
    }
  }

  onSubmit(): void {
    if (!this.isValid || this.saving) return;

    this.saving = true;
    let qty = Number(this.quantity);
    if (this.adjustmentType === 'remove') qty = -qty;
    if (this.adjustmentType === 'set') qty = qty - this.currentStock;

    const branchId = this.data.inventoryItem.branchId || 1;

    const payload: Record<string, any> = {
      variantId: this.data.inventoryItem.variantId,
      branchId,
      quantity: qty,
      reason: this.reason.trim(),
    };
    if (this.vendorId && this.isPurchase) {
      payload['vendorId'] = this.vendorId;
    }

    this.api.post('/inventory/adjust', payload).subscribe({
      next: () => {
        this.notification.success('Stock adjusted successfully');
        this.dialogRef.close(true);
      },
      error: () => {
        this.saving = false;
        this.notification.error('Failed to adjust stock');
      },
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
