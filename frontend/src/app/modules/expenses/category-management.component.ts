import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface ExpenseCategory {
  id: number;
  name: string;
  description?: string;
  _count?: { expenses: number };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-category-management',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './category-management.component.html',
})
export class CategoryManagementComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  categories: ExpenseCategory[] = [];
  loading = true;

  showDialog = false;
  editingCategory: ExpenseCategory | null = null;
  categoryName = '';
  categoryDescription = '';
  saving = false;

  constructor(
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadCategories();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadCategories(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<ExpenseCategory[]>>('/expenses/categories')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.categories = res.data || [];
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load categories');
        },
      });
  }

  openAddDialog(): void {
    this.editingCategory = null;
    this.categoryName = '';
    this.categoryDescription = '';
    this.showDialog = true;
  }

  openEditDialog(cat: ExpenseCategory): void {
    this.editingCategory = cat;
    this.categoryName = cat.name;
    this.categoryDescription = cat.description || '';
    this.showDialog = true;
  }

  closeDialog(): void {
    this.showDialog = false;
    this.editingCategory = null;
    this.categoryName = '';
    this.categoryDescription = '';
  }

  saveCategory(): void {
    if (!this.categoryName.trim() || this.saving) return;

    this.saving = true;
    const body = {
      name: this.categoryName.trim(),
      description: this.categoryDescription.trim() || undefined,
    };

    const request$ = this.editingCategory
      ? this.api.put<ApiResponse<any>>(
          `/expenses/categories/${this.editingCategory.id}`,
          body
        )
      : this.api.post<ApiResponse<any>>('/expenses/categories', body);

    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success(
          this.editingCategory ? 'Category updated' : 'Category created'
        );
        this.closeDialog();
        this.loadCategories();
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err.error?.error || 'Failed to save category');
      },
    });
  }

  deleteCategory(cat: ExpenseCategory): void {
    if (!confirm(`Delete category "${cat.name}"?`)) return;

    this.api
      .delete<ApiResponse<any>>(`/expenses/categories/${cat.id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notify.success('Category deleted');
          this.loadCategories();
        },
        error: (err) => {
          this.notify.error(err.error?.error || 'Failed to delete category');
        },
      });
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dialog-backdrop')) {
      this.closeDialog();
    }
  }
}
