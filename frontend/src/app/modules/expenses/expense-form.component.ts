import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface ExpenseCategory {
  id: number;
  name: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-expense-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './expense-form.component.html',
})
export class ExpenseFormComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  form!: FormGroup;
  categories: ExpenseCategory[] = [];
  saving = false;
  loading = false;

  expenseId: number | null = null;

  get isEdit(): boolean {
    return !!this.expenseId;
  }

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private notify: NotificationService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      description: ['', [Validators.required]],
      amount: [null, [Validators.required, Validators.min(0.01)]],
      categoryId: [null],
      date: [new Date().toISOString().split('T')[0], [Validators.required]],
      notes: [''],
    });

    this.loadCategories();

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.expenseId = parseInt(idParam, 10);
      this.loadExpense();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadCategories(): void {
    this.api
      .get<ApiResponse<ExpenseCategory[]>>('/expenses/categories')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.categories = res.data || [];
        },
        error: () => {},
      });
  }

  private loadExpense(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<any>>(`/expenses/${this.expenseId}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const expense = res.data;
          if (expense) {
            this.form.patchValue({
              description: expense.description,
              amount: expense.amount,
              categoryId: expense.categoryId || expense.category?.id || null,
              date: expense.date
                ? new Date(expense.date).toISOString().split('T')[0]
                : '',
              notes: expense.notes || '',
            });
          }
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load expense');
          this.router.navigate(['/expenses']);
        },
      });
  }

  onSubmit(): void {
    if (this.form.invalid || this.saving) return;

    this.saving = true;
    const body = { ...this.form.value };
    if (body.categoryId) body.categoryId = parseInt(body.categoryId, 10);

    const request$ = this.isEdit
      ? this.api.put<ApiResponse<any>>(`/expenses/${this.expenseId}`, body)
      : this.api.post<ApiResponse<any>>('/expenses', body);

    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success(
          this.isEdit ? 'Expense updated' : 'Expense added'
        );
        this.router.navigate(['/expenses']);
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err.error?.error || 'Failed to save expense');
      },
    });
  }
}
