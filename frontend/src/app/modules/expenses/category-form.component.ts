import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface PayableCategory {
  id: number;
  name: string;
  isActive: boolean;
  isRecurring: boolean;
  defaultAmount?: string | number | null;
  dueDay?: number | null;
  isSystem: boolean;
  sortOrder: number;
  accountId?: number | null;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-expense-category-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './category-form.component.html',
})
export class CategoryFormComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  form!: FormGroup;
  loading = false;
  saving = false;

  categoryId: number | null = null;
  existing: PayableCategory | null = null;

  readonly dueDays: number[] = Array.from({ length: 31 }, (_, i) => i + 1);

  get isEdit(): boolean {
    return this.categoryId !== null;
  }

  get isSystem(): boolean {
    return !!this.existing?.isSystem;
  }

  get isRecurring(): boolean {
    return !!this.form?.get('isRecurring')?.value;
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
      name: ['', [Validators.required, Validators.maxLength(100)]],
      isRecurring: [false],
      defaultAmount: [null],
      dueDay: [null],
      sortOrder: [0, [Validators.required, Validators.min(0)]],
      isActive: [true],
    });

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.categoryId = parseInt(idParam, 10);
      this.loadCategory();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** The categories endpoint is a list — pick our row out of it. */
  private loadCategory(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<PayableCategory[]>>('/payables/categories')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const found = (res.data || []).find((c) => c.id === this.categoryId);
          this.loading = false;
          if (!found) {
            this.notify.error('Category not found');
            this.router.navigate(['/expenses/categories']);
            return;
          }
          this.existing = found;
          this.form.patchValue({
            name: found.name,
            isRecurring: found.isRecurring,
            // Decimal arrives as a string; coerce before it reaches a number input.
            defaultAmount: found.defaultAmount != null ? Number(found.defaultAmount) : null,
            dueDay: found.dueDay ?? null,
            sortOrder: found.sortOrder ?? 0,
            isActive: found.isActive,
          });
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load category');
          this.router.navigate(['/expenses/categories']);
        },
      });
  }

  onSubmit(): void {
    if (this.form.invalid || this.saving) return;

    const v = this.form.value;
    const recurring = !!v.isRecurring;

    if (recurring && (v.defaultAmount === null || v.defaultAmount === '' || Number(v.defaultAmount) <= 0)) {
      this.notify.error('A recurring category needs a default amount');
      return;
    }
    if (recurring && !v.dueDay) {
      this.notify.error('A recurring category needs a due day');
      return;
    }

    // Turning recurring off clears its config so ensure-month stops raising it.
    const body: Record<string, unknown> = {
      name: String(v.name).trim(),
      isRecurring: recurring,
      defaultAmount: recurring ? Math.round(Number(v.defaultAmount) * 100) / 100 : null,
      dueDay: recurring ? Number(v.dueDay) : null,
      sortOrder: Number(v.sortOrder) || 0,
      isActive: !!v.isActive,
    };

    const request$ = this.isEdit
      ? this.api.put<ApiResponse<PayableCategory>>(`/payables/categories/${this.categoryId}`, body)
      : this.api.post<ApiResponse<PayableCategory>>('/payables/categories', body);

    this.saving = true;
    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success(this.isEdit ? 'Category updated' : 'Category created');
        this.router.navigate(['/expenses/categories']);
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err.error?.error || 'Failed to save category');
      },
    });
  }

  ordinal(day: number | null | undefined): string {
    if (!day) return '';
    const rem100 = day % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
    switch (day % 10) {
      case 1:
        return `${day}st`;
      case 2:
        return `${day}nd`;
      case 3:
        return `${day}rd`;
      default:
        return `${day}th`;
    }
  }
}
