import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { BranchService, Branch } from '../../core/services/branch.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { StockAdjustmentDialogComponent } from './stock-adjustment-dialog.component';

interface InventoryItem {
  id: number;
  variantId: number;
  branchId: number;
  quantity: number;
  minStockLevel: number;
  variant?: {
    id: number;
    sku: string;
    size?: string;
    color?: string;
    product?: {
      name: string;
      category?: { name: string };
    };
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-stock-levels',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    LoadingSpinnerComponent,
    EmptyStateComponent,
  ],
  templateUrl: './stock-levels.component.html',
})
export class StockLevelsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  items: InventoryItem[] = [];
  branches: Branch[] = [];
  loading = true;

  // Filters
  selectedBranchId: string | null = null;
  lowStockOnly = false;
  search = '';

  // Pagination
  page = 1;
  limit = 15;
  total = 0;

  // KPIs
  healthyCount = 0;
  lowAlertCount = 0;
  outOfStockCount = 0;
  inTransitCount = 0;

  constructor(
    private api: ApiService,
    private notification: NotificationService,
    private branchService: BranchService,
    private dialog: DialogService
  ) {}

  ngOnInit(): void {
    this.branchService.getBranches().pipe(takeUntil(this.destroy$)).subscribe({
      next: (branches) => (this.branches = branches),
    });
    this.loadStock();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadStock(): void {
    this.loading = true;
    const params: Record<string, string | number | boolean> = {
      page: this.page,
      limit: this.limit,
    };
    if (this.lowStockOnly) params['lowStock'] = true;
    if (this.selectedBranchId) params['branchId'] = this.selectedBranchId;
    if (this.search) params['search'] = this.search;

    this.api
      .get<ApiResponse<InventoryItem[]>>('/inventory', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.items = res.data ?? [];
          this.total = res.meta?.total ?? 0;
          this.computeKpis();
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load inventory');
        },
      });
  }

  private computeKpis(): void {
    this.healthyCount = 0;
    this.lowAlertCount = 0;
    this.outOfStockCount = 0;

    for (const item of this.items) {
      if (item.quantity <= 0) {
        this.outOfStockCount++;
      } else if (item.quantity <= item.minStockLevel) {
        this.lowAlertCount++;
      } else {
        this.healthyCount++;
      }
    }
  }

  getProductName(item: InventoryItem): string {
    return item.variant?.product?.name || 'Unknown Product';
  }

  getCategoryName(item: InventoryItem): string {
    return item.variant?.product?.category?.name || '';
  }

  getVariantLabel(item: InventoryItem): string {
    const parts: string[] = [];
    if (item.variant?.size) parts.push(item.variant.size);
    if (item.variant?.color) parts.push(item.variant.color);
    return parts.join(' / ') || '—';
  }

  getSku(item: InventoryItem): string {
    return item.variant?.sku || '—';
  }

  getStockStatus(item: InventoryItem): string {
    if (item.quantity <= 0) return 'Out of Stock';
    if (item.quantity <= item.minStockLevel) return 'Low Stock';
    return 'OK';
  }

  getStockStatusClass(item: InventoryItem): string {
    if (item.quantity <= 0) return 'bg-error-container/40 text-on-error-container';
    if (item.quantity <= item.minStockLevel) return 'bg-tertiary/20 text-tertiary';
    return 'bg-primary/20 text-primary';
  }

  getQuantityClass(item: InventoryItem): string {
    if (item.quantity <= 0) return 'text-error';
    if (item.quantity <= item.minStockLevel) return 'text-tertiary';
    return 'text-on-surface';
  }

  onBranchChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedBranchId = value || null;
    this.page = 1;
    this.loadStock();
  }

  onSearch(term: string): void {
    this.search = term;
    this.page = 1;
    this.loadStock();
  }

  clearFilters(): void {
    this.search = '';
    this.selectedBranchId = null;
    this.lowStockOnly = false;
    this.page = 1;
    this.loadStock();
  }

  get hasFilters(): boolean {
    return !!this.search || !!this.selectedBranchId || this.lowStockOnly;
  }

  toggleLowStock(): void {
    this.lowStockOnly = !this.lowStockOnly;
    this.page = 1;
    this.loadStock();
  }

  openAdjust(item: InventoryItem): void {
    const ref = this.dialog.open(StockAdjustmentDialogComponent, {
      data: { inventoryItem: item },
      width: '480px',
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.loadStock();
    });
  }

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  get pages(): number[] {
    const total = this.totalPages;
    const current = this.page;
    const pages: number[] = [];
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.loadStock();
  }
}
