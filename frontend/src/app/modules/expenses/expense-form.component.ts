import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ExpenseService } from './expense.service';

@Component({
  selector: 'app-expense-form',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './expense-form.component.html',
})
export class ExpenseFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private expenseService = inject(ExpenseService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  form!: FormGroup;
  mode: 'add' | 'edit' = 'add';
  expenseId: number | null = null;
  loading = false;
  categories: any[] = [];

  ngOnInit(): void {
    this.initForm();
    this.loadCategories();

    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.mode = 'edit';
      this.expenseId = Number(id);
      this.loadExpense(this.expenseId);
    }
  }

  private initForm(): void {
    this.form = this.fb.group({
      date: [new Date(), Validators.required],
      categoryId: ['', Validators.required],
      amount: [0, [Validators.required, Validators.min(0.01)]],
      description: ['', Validators.required],
      vendor: [''],
      receiptNumber: [''],
      notes: [''],
    });
  }

  private loadCategories(): void {
    this.expenseService.getCategories().subscribe({
      next: (res) => (this.categories = Array.isArray(res) ? res : []),
    });
  }

  private loadExpense(id: number): void {
    this.loading = true;
    this.expenseService.getById(id).subscribe({
      next: (res) => {
        const expense = res;
        this.form.patchValue({
          date: expense.date ? new Date(expense.date) : new Date(),
          categoryId: expense.categoryId,
          amount: expense.amount,
          description: expense.description,
          vendor: expense.vendor,
          receiptNumber: expense.receiptNumber,
          notes: expense.notes,
        });
        this.loading = false;
      },
      error: () => {
        this.snackBar.open('Failed to load expense', 'Close', { duration: 3000 });
        this.loading = false;
        this.router.navigate(['/expenses']);
      },
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    const payload = { ...this.form.value };
    if (payload.date instanceof Date) {
      payload.date = payload.date.toISOString().split('T')[0];
    }

    const request =
      this.mode === 'add'
        ? this.expenseService.create(payload)
        : this.expenseService.update(this.expenseId!, payload);

    request.subscribe({
      next: () => {
        this.snackBar.open(`Expense ${this.mode === 'add' ? 'created' : 'updated'}`, 'Close', { duration: 2000 });
        this.router.navigate(['/expenses']);
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Failed to save expense', 'Close', { duration: 3000 });
        this.loading = false;
      },
    });
  }

  cancel(): void {
    this.router.navigate(['/expenses']);
  }
}
