import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ExpenseService } from './expense.service';

@Component({
  selector: 'app-category-management',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatListModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './category-management.component.html',
})
export class CategoryManagementComponent implements OnInit {
  private fb = inject(FormBuilder);
  private expenseService = inject(ExpenseService);
  private snackBar = inject(MatSnackBar);

  categories: any[] = [];
  loading = false;
  form: FormGroup;
  editingId: number | null = null;

  constructor() {
    this.form = this.fb.group({
      name: ['', Validators.required],
      description: [''],
    });
  }

  ngOnInit(): void {
    this.loadCategories();
  }

  loadCategories(): void {
    this.loading = true;
    this.expenseService.getCategories().subscribe({
      next: (res) => {
        this.categories = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load categories', 'Close', { duration: 3000 });
      },
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const request = this.editingId
      ? this.expenseService.updateCategory(this.editingId, this.form.value)
      : this.expenseService.createCategory(this.form.value);

    request.subscribe({
      next: () => {
        this.snackBar.open(`Category ${this.editingId ? 'updated' : 'created'}`, 'Close', { duration: 2000 });
        this.resetForm();
        this.loadCategories();
      },
      error: () => {
        this.snackBar.open('Failed to save category', 'Close', { duration: 3000 });
      },
    });
  }

  editCategory(cat: any): void {
    this.editingId = cat.id;
    this.form.patchValue({ name: cat.name, description: cat.description });
  }

  deleteCategory(cat: any): void {
    if (confirm(`Delete category "${cat.name}"?`)) {
      this.expenseService.deleteCategory(cat.id).subscribe({
        next: () => {
          this.snackBar.open('Category deleted', 'Close', { duration: 2000 });
          this.loadCategories();
        },
        error: () => {
          this.snackBar.open('Failed to delete category', 'Close', { duration: 3000 });
        },
      });
    }
  }

  resetForm(): void {
    this.editingId = null;
    this.form.reset();
  }
}
