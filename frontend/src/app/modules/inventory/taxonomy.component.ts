import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, forkJoin, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { AutoCapsDirective } from '../../shared/directives/auto-caps.directive';

interface TaxonomyItem {
  id: number;
  name: string;
  isActive?: boolean;
  productCount?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface ListResponse<T> {
  success: boolean;
  data: T[];
  meta?: { total?: number };
}

@Component({
  selector: 'app-taxonomy',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, AutoCapsDirective],
  templateUrl: './taxonomy.component.html',
})
export class TaxonomyComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  brands: TaxonomyItem[] = [];
  categories: TaxonomyItem[] = [];
  loading = true;

  brandSearch = '';
  categorySearch = '';

  // Inline add
  newBrandName = '';
  newCategoryName = '';
  savingBrand = false;
  savingCategory = false;

  // Inline edit — only one item at a time per panel
  editingBrandId: number | null = null;
  editingCategoryId: number | null = null;
  editName = '';

  constructor(
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadAll();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadAll(): void {
    this.loading = true;
    forkJoin({
      brands: this.api.get<ListResponse<TaxonomyItem>>('/brands', { limit: '500' }),
      categories: this.api.get<ListResponse<TaxonomyItem>>('/categories', { limit: '500' }),
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.brands = res.brands.data ?? [];
          this.categories = res.categories.data ?? [];
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notification.error('Failed to load brands and categories');
        },
      });
  }

  get filteredBrands(): TaxonomyItem[] {
    const q = this.brandSearch.trim().toLowerCase();
    return q ? this.brands.filter((b) => b.name.toLowerCase().includes(q)) : this.brands;
  }

  get filteredCategories(): TaxonomyItem[] {
    const q = this.categorySearch.trim().toLowerCase();
    return q
      ? this.categories.filter((c) => c.name.toLowerCase().includes(q))
      : this.categories;
  }

  // ─── Brand actions ─────────────────────────────────────
  addBrand(): void {
    const name = this.newBrandName.trim();
    if (!name || this.savingBrand) return;
    this.savingBrand = true;
    this.api
      .post<ApiResponse<TaxonomyItem>>('/brands', { name })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.brands = [...this.brands, res.data].sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          this.newBrandName = '';
          this.savingBrand = false;
          this.notification.success(`Brand "${res.data.name}" added`);
        },
        error: () => {
          this.savingBrand = false;
        },
      });
  }

  startEditBrand(b: TaxonomyItem): void {
    this.editingBrandId = b.id;
    this.editName = b.name;
  }

  cancelEditBrand(): void {
    this.editingBrandId = null;
    this.editName = '';
  }

  saveEditBrand(b: TaxonomyItem): void {
    const name = this.editName.trim();
    if (!name || name === b.name) {
      this.cancelEditBrand();
      return;
    }
    this.api
      .put<ApiResponse<TaxonomyItem>>(`/brands/${b.id}`, { name })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const idx = this.brands.findIndex((x) => x.id === b.id);
          if (idx >= 0) this.brands[idx] = { ...this.brands[idx], name: res.data.name };
          this.brands.sort((a, b) => a.name.localeCompare(b.name));
          this.cancelEditBrand();
          this.notification.success('Brand renamed');
        },
        error: () => {},
      });
  }

  deactivateBrand(b: TaxonomyItem): void {
    if (!confirm(`Deactivate brand "${b.name}"? Existing products keep this brand but it won't be selectable for new products.`)) return;
    this.api
      .delete<ApiResponse<unknown>>(`/brands/${b.id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.brands = this.brands.filter((x) => x.id !== b.id);
          this.notification.success(`Brand "${b.name}" deactivated`);
        },
        error: () => {},
      });
  }

  // ─── Category actions ──────────────────────────────────
  addCategory(): void {
    const name = this.newCategoryName.trim();
    if (!name || this.savingCategory) return;
    this.savingCategory = true;
    this.api
      .post<ApiResponse<TaxonomyItem>>('/categories', { name })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.categories = [...this.categories, res.data].sort((a, b) =>
            a.name.localeCompare(b.name)
          );
          this.newCategoryName = '';
          this.savingCategory = false;
          this.notification.success(`Category "${res.data.name}" added`);
        },
        error: () => {
          this.savingCategory = false;
        },
      });
  }

  startEditCategory(c: TaxonomyItem): void {
    this.editingCategoryId = c.id;
    this.editName = c.name;
  }

  cancelEditCategory(): void {
    this.editingCategoryId = null;
    this.editName = '';
  }

  saveEditCategory(c: TaxonomyItem): void {
    const name = this.editName.trim();
    if (!name || name === c.name) {
      this.cancelEditCategory();
      return;
    }
    this.api
      .put<ApiResponse<TaxonomyItem>>(`/categories/${c.id}`, { name })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const idx = this.categories.findIndex((x) => x.id === c.id);
          if (idx >= 0)
            this.categories[idx] = { ...this.categories[idx], name: res.data.name };
          this.categories.sort((a, b) => a.name.localeCompare(b.name));
          this.cancelEditCategory();
          this.notification.success('Category renamed');
        },
        error: () => {},
      });
  }

  deactivateCategory(c: TaxonomyItem): void {
    if (!confirm(`Deactivate category "${c.name}"?`)) return;
    this.api
      .delete<ApiResponse<unknown>>(`/categories/${c.id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.categories = this.categories.filter((x) => x.id !== c.id);
          this.notification.success(`Category "${c.name}" deactivated`);
        },
        error: () => {},
      });
  }
}
