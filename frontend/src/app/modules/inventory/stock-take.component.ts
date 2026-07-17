import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface InvRow {
  variantId: number;
  sku: string;
  barcode?: string;
  size?: string;
  color?: string;
  productName: string;
  system: number;
  counted: number | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
}

/**
 * Stock-take / reconciliation: enter (or scan) physical counts per variant.
 * The variance (counted − system) is logged per line as an adjustment movement
 * — positive = found stock, negative = shrinkage. Rows left blank are untouched,
 * so a partial count only reconciles what was actually counted.
 */
@Component({
  selector: 'app-stock-take',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './stock-take.component.html',
})
export class StockTakeComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  rows: InvRow[] = [];
  loading = false;
  submitting = false;

  search = '';
  scanCode = '';
  reason = 'Stock-take reconciliation';
  onlyCounted = false;

  lastSummary: { adjusted: number; unitsFound: number; unitsShrinkage: number } | null = null;

  constructor(
    private api: ApiService,
    private notification: NotificationService
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
    const params: Record<string, string | number> = { limit: 1000 };
    if (this.search.trim()) params['search'] = this.search.trim();
    this.api
      .get<ApiResponse<any[]>>('/inventory', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.rows = (res.data ?? []).map((it) => ({
            variantId: it.variantId,
            sku: it.variant?.sku ?? '',
            barcode: it.variant?.barcode ?? '',
            size: it.variant?.size ?? '',
            color: it.variant?.color ?? '',
            productName: it.variant?.product?.name ?? 'Unknown',
            system: it.quantity ?? 0,
            counted: null,
          }));
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load stock');
        },
      });
  }

  get visibleRows(): InvRow[] {
    return this.onlyCounted ? this.rows.filter((r) => r.counted !== null) : this.rows;
  }

  variance(row: InvRow): number | null {
    return row.counted === null ? null : row.counted - row.system;
  }

  /** Scan a barcode/SKU → +1 to that row's physical count. */
  onScan(): void {
    const code = this.scanCode.trim();
    if (!code) return;
    const row = this.rows.find(
      (r) => r.barcode === code || r.sku.toLowerCase() === code.toLowerCase()
    );
    if (!row) {
      this.notification.warning(`Not in list: ${code}`);
    } else {
      row.counted = (row.counted ?? 0) + 1;
    }
    this.scanCode = '';
  }

  get countedRows(): number {
    return this.rows.filter((r) => r.counted !== null).length;
  }

  get unitsFound(): number {
    return this.rows.reduce((s, r) => {
      const v = this.variance(r);
      return v && v > 0 ? s + v : s;
    }, 0);
  }

  get unitsShrinkage(): number {
    return this.rows.reduce((s, r) => {
      const v = this.variance(r);
      return v && v < 0 ? s - v : s;
    }, 0);
  }

  clearCounts(): void {
    this.rows.forEach((r) => (r.counted = null));
    this.lastSummary = null;
  }

  submit(): void {
    const counts = this.rows
      .filter((r) => r.counted !== null)
      .map((r) => ({ variantId: r.variantId, physicalCount: Math.max(0, Math.floor(r.counted!)) }));

    if (counts.length === 0) {
      this.notification.warning('Enter or scan at least one physical count');
      return;
    }

    this.submitting = true;
    this.api
      .post<ApiResponse<{ adjusted: number; unitsFound: number; unitsShrinkage: number }>>(
        '/inventory/reconcile',
        { reason: this.reason.trim() || 'Stock-take reconciliation', counts }
      )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.submitting = false;
          this.lastSummary = res.data;
          this.notification.success(
            `Reconciled ${res.data.adjusted} line(s): +${res.data.unitsFound} found, −${res.data.unitsShrinkage} shrinkage`
          );
          this.load();
        },
        error: (err) => {
          this.submitting = false;
          this.notification.error(err.error?.error || 'Reconciliation failed');
        },
      });
  }
}
