import { AfterViewInit, Component, ElementRef, Inject, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '../../shared/dialog/dialog-ref';
import { DIALOG_DATA } from '../../shared/dialog/dialog.tokens';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { AutoCapsDirective } from '../../shared/directives/auto-caps.directive';

interface Category {
  id: number;
  name: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface QuickProductData {
  /** Prefill for the name (when the cashier typed a text search). */
  name?: string;
}

/**
 * Case B "ghost product" quick-add: an item is physically in hand but has no
 * record. Create it from the hang-tag (name, category → auto HSN/GST, MRP, qty)
 * and return the ready-to-sell variant so the POS drops it into the cart.
 */
@Component({
  selector: 'app-quick-product-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, AutoCapsDirective],
  templateUrl: './quick-product-dialog.component.html',
})
export class QuickProductDialogComponent implements OnInit, AfterViewInit {
  @ViewChild('nameInput') nameInput?: ElementRef<HTMLInputElement>;

  name = '';
  categoryId: number | null = null;
  mrp: number | null = null;
  size = '';
  color = '';
  quantity = 1;
  saving = false;

  categories: Category[] = [];

  constructor(
    public dialogRef: DialogRef<any>,
    @Inject(DIALOG_DATA) public data: QuickProductData,
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.name = (this.data?.name || '').trim();
    this.api.get<ApiResponse<Category[]>>('/categories').subscribe({
      next: (res) => (this.categories = res.data ?? []),
      error: () => (this.categories = []),
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.nameInput?.nativeElement.focus());
  }

  /** §13.3 — Sale Price = MRP − 10% (display only; POS charges the MRP). */
  get salePrice(): number {
    return this.mrp && this.mrp > 0 ? Math.round(this.mrp * 0.9) : 0;
  }

  /** Category-wise HSN (mirrors backend): Dress → 6211, else → 6204. */
  get hsnPreview(): string {
    const cat = this.categories.find((c) => c.id === this.categoryId);
    return (cat?.name || '').trim().toUpperCase() === 'DRESS' ? '6211' : '6204';
  }

  /** Dynamic apparel GST: ≤ ₹2,500 → 5%, above → 18%. */
  get gstPreview(): number {
    return (this.mrp || 0) > 2500 ? 18 : 5;
  }

  get isValid(): boolean {
    return !!this.name.trim() && !!this.mrp && this.mrp > 0 && this.quantity > 0;
  }

  onSubmit(): void {
    if (!this.isValid || this.saving) return;
    this.saving = true;
    const payload = {
      name: this.name.trim(),
      categoryId: this.categoryId ?? undefined,
      mrp: Number(this.mrp),
      size: this.size.trim() || undefined,
      color: this.color.trim() || undefined,
      quantity: Math.max(1, Math.floor(this.quantity || 1)),
    };
    this.api.post<ApiResponse<any>>('/pos/quick-product', payload).subscribe({
      next: (res) => {
        this.notification.success(`"${payload.name}" created and stocked`);
        this.dialogRef.close(res.data);
      },
      error: (err) => {
        this.saving = false;
        this.notification.error(err.error?.error || 'Failed to create product');
      },
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
