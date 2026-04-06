import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface ReturnItem {
  saleItemId: number;
  productName: string;
  size: string;
  color: string;
  maxQuantity: number;
  quantity: number;
  reason: string;
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

  reasons = [
    { value: 'defective', label: 'Defective' },
    { value: 'wrong_size', label: 'Wrong Size' },
    { value: 'not_as_described', label: 'Not as Described' },
    { value: 'changed_mind', label: 'Changed Mind' },
    { value: 'other', label: 'Other' },
  ];

  conditions = [
    { value: 'new', label: 'New / Unused' },
    { value: 'worn', label: 'Worn' },
    { value: 'damaged', label: 'Damaged' },
  ];

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.items = this.returnableItems.map((item) => ({
      saleItemId: item.id,
      productName: item.variant?.product?.name || item.productName || item.name || 'Unknown',
      size: item.variant?.size || '-',
      color: item.variant?.color || '-',
      maxQuantity: item.quantity - (item.returnedQuantity || 0),
      quantity: 1,
      reason: 'changed_mind',
      condition: 'new',
      selected: false,
      unitPrice: item.unitPrice || 0,
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

    const body = {
      items: this.selectedItems.map((item) => ({
        saleItemId: item.saleItemId,
        quantity: item.quantity,
        reason: item.reason,
        condition: item.condition,
      })),
    };

    this.api.post(`/sales/${this.sale.id}/return`, body).subscribe({
      next: () => {
        this.submitting = false;
        this.returnComplete.emit();
      },
      error: () => {
        this.notify.error('Failed to process return');
        this.submitting = false;
      },
    });
  }
}
