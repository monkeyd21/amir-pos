import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { VendorPickerComponent } from '../vendors/vendor-picker.component';

interface Movement {
  id: number;
  type: string;
  quantity: number;
  notes: string | null;
  lotCode: string | null;
  createdAt: string;
  variant: {
    id: number;
    sku: string;
    size: string;
    color: string;
    product: { id: number; name: string; brand?: { id: number; name: string } };
  };
  user: { id: number; firstName: string; lastName: string };
  vendor: { id: number; name: string } | null;
}

interface EditState {
  lotCode: string;
  notes: string;
  vendorId: number | null;
}

@Component({
  selector: 'app-stock-history',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, VendorPickerComponent],
  templateUrl: './stock-history.component.html',
})
export class StockHistoryComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  movements: Movement[] = [];
  loading = true;

  // Filters — all server-side
  search = '';
  typeFilter = '';
  lotCodeFilter = '';
  vendorIdFilter: number | null = null;
  startDate = '';
  endDate = '';
  showFilters = false;

  page = 1;
  limit = 25;
  total = 0;

  // Inline editing
  editingId: number | null = null;
  editState: EditState = { lotCode: '', notes: '', vendorId: null };
  saving = false;

  private searchTimer: any = null;

  readonly typeOptions = [
    { value: '', label: 'All Types' },
    { value: 'purchase', label: 'Purchase / Restock' },
    { value: 'sale', label: 'Sale' },
    { value: 'return', label: 'Return' },
    { value: 'adjustment', label: 'Adjustment' },
    { value: 'transfer_in', label: 'Transfer In' },
    { value: 'transfer_out', label: 'Transfer Out' },
  ];

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
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  load(): void {
    this.loading = true;
    const params: Record<string, string> = {
      page: String(this.page),
      limit: String(this.limit),
    };
    if (this.typeFilter) params['type'] = this.typeFilter;
    if (this.search.trim()) params['search'] = this.search.trim();
    if (this.lotCodeFilter.trim()) params['lotCode'] = this.lotCodeFilter.trim();
    if (this.vendorIdFilter) params['vendorId'] = String(this.vendorIdFilter);
    if (this.startDate) params['startDate'] = this.startDate;
    if (this.endDate) params['endDate'] = this.endDate;

    this.api
      .get<any>('/inventory/movements', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.movements = res.data || [];
          this.total = res.meta?.total || 0;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  onFilterChange(): void {
    this.page = 1;
    this.load();
  }

  onSearchInput(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page = 1;
      this.load();
    }, 400);
  }

  onLotCodeInput(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page = 1;
      this.load();
    }, 400);
  }

  onVendorChange(id: number | null): void {
    this.vendorIdFilter = id;
    this.page = 1;
    this.load();
  }

  clearFilters(): void {
    this.search = '';
    this.typeFilter = '';
    this.lotCodeFilter = '';
    this.vendorIdFilter = null;
    this.startDate = '';
    this.endDate = '';
    this.page = 1;
    this.load();
  }

  get hasActiveFilters(): boolean {
    return !!(
      this.search.trim() ||
      this.typeFilter ||
      this.lotCodeFilter.trim() ||
      this.vendorIdFilter ||
      this.startDate ||
      this.endDate
    );
  }

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.load();
  }

  // ─── Inline editing ─────────────────────────────────────

  startEdit(m: Movement): void {
    this.editingId = m.id;
    this.editState = {
      lotCode: m.lotCode || '',
      notes: m.notes || '',
      vendorId: m.vendor?.id ?? null,
    };
  }

  cancelEdit(): void {
    this.editingId = null;
  }

  saveEdit(): void {
    if (this.editingId === null || this.saving) return;
    this.saving = true;

    this.api
      .put<any>(`/inventory/movements/${this.editingId}`, {
        lotCode: this.editState.lotCode.trim() || null,
        notes: this.editState.notes.trim() || null,
        vendorId: this.editState.vendorId,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const idx = this.movements.findIndex((m) => m.id === this.editingId);
          if (idx !== -1 && res.data) {
            this.movements[idx] = res.data;
          }
          this.notification.success('Movement updated');
          this.editingId = null;
          this.saving = false;
        },
        error: (err) => {
          this.saving = false;
          this.notification.error(
            err.error?.error || 'Failed to update movement'
          );
        },
      });
  }

  // ─── Helpers ────────────────────────────────────────────

  typeLabel(type: string): string {
    const map: Record<string, string> = {
      purchase: 'Purchase',
      sale: 'Sale',
      return: 'Return',
      adjustment: 'Adjustment',
      transfer_in: 'Transfer In',
      transfer_out: 'Transfer Out',
    };
    return map[type] || type;
  }

  typeBadgeClass(type: string): string {
    const map: Record<string, string> = {
      purchase: 'bg-green-500/10 text-green-700',
      sale: 'bg-blue-500/10 text-blue-700',
      return: 'bg-amber-500/10 text-amber-700',
      adjustment: 'bg-purple-500/10 text-purple-700',
      transfer_in: 'bg-teal-500/10 text-teal-700',
      transfer_out: 'bg-orange-500/10 text-orange-700',
    };
    return map[type] || 'bg-gray-100 text-gray-600';
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
