import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { SearchInputComponent } from '../../shared/search-input/search-input.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';

interface Product {
  id: number;
  name: string;
  slug?: string;
  basePrice: number;
  description?: string;
  brand?: { id: number; name: string };
  category?: { id: number; name: string };
  variants?: any[];
  _count?: { variants: number };
}

interface Brand {
  id: number;
  name: string;
}

interface Category {
  id: number;
  name: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    SearchInputComponent,
    LoadingSpinnerComponent,
    EmptyStateComponent,
  ],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  products: Product[] = [];
  brands: Brand[] = [];
  categories: Category[] = [];
  loading = true;

  // Filters
  search = '';
  selectedBrandId: number | null = null;
  selectedCategoryId: number | null = null;

  // Pagination
  page = 1;
  limit = 10;
  total = 0;

  // Stats
  totalInventoryValue = 0;
  lowStockAlerts = 0;
  activeVariants = 0;

  // Action menu
  activeMenuId: number | null = null;

  constructor(
    private api: ApiService,
    private notification: NotificationService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadFilters();
    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadFilters(): void {
    forkJoin({
      brands: this.api.get<ApiResponse<Brand[]>>('/brands'),
      categories: this.api.get<ApiResponse<Category[]>>('/categories'),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ brands, categories }) => {
          this.brands = brands.data ?? [];
          this.categories = categories.data ?? [];
        },
      });
  }

  loadProducts(): void {
    this.loading = true;
    const params: Record<string, string | number | boolean> = {
      page: this.page,
      limit: this.limit,
    };
    if (this.search) params['search'] = this.search;
    if (this.selectedBrandId) params['brandId'] = this.selectedBrandId;
    if (this.selectedCategoryId) params['categoryId'] = this.selectedCategoryId;

    this.api
      .get<ApiResponse<Product[]>>('/products', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.products = res.data ?? [];
          this.total = res.meta?.total ?? 0;
          this.computeStats();
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load products');
        },
      });
  }

  private computeStats(): void {
    this.totalInventoryValue = this.products.reduce(
      (sum, p) => sum + (p.basePrice || 0) * (p._count?.variants || 0),
      0
    );
    this.activeVariants = this.products.reduce(
      (sum, p) => sum + (p._count?.variants || p.variants?.length || 0),
      0
    );
  }

  onSearch(term: string): void {
    this.search = term;
    this.page = 1;
    this.loadProducts();
  }

  onBrandChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedBrandId = value ? Number(value) : null;
    this.page = 1;
    this.loadProducts();
  }

  onCategoryChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.selectedCategoryId = value ? Number(value) : null;
    this.page = 1;
    this.loadProducts();
  }

  clearFilters(): void {
    this.search = '';
    this.selectedBrandId = null;
    this.selectedCategoryId = null;
    this.page = 1;
    this.loadProducts();
  }

  get hasFilters(): boolean {
    return !!this.search || !!this.selectedBrandId || !!this.selectedCategoryId;
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
    this.loadProducts();
  }

  viewProduct(product: Product): void {
    this.router.navigate(['/inventory/products', product.id]);
  }

  openAddProduct(): void {
    this.router.navigate(['/inventory/products/new']);
  }

  editProduct(product: Product): void {
    this.activeMenuId = null;
    this.router.navigate(['/inventory/products', product.id, 'edit']);
  }

  deleteProduct(product: Product): void {
    this.activeMenuId = null;
    if (!confirm(`Delete "${product.name}"? This action cannot be undone.`)) return;
    this.api
      .delete(`/products/${product.id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notification.success('Product deleted');
          this.loadProducts();
        },
        error: () => this.notification.error('Failed to delete product'),
      });
  }

  toggleMenu(id: number): void {
    this.activeMenuId = this.activeMenuId === id ? null : id;
  }

  closeMenu(): void {
    this.activeMenuId = null;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
}
