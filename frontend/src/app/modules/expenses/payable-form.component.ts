import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { BranchService } from '../../core/services/branch.service';

interface PayableCategory {
  id: number;
  name: string;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
}

interface Payable {
  id: number;
  branchId: number;
  source: string;
  categoryId?: number | null;
  periodMonth?: string | null;
  title: string;
  description?: string | null;
  amount: string | number;
  paidAmount: string | number;
  dueDate?: string | null;
  status: string;
  isSystem: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { total: number; page: number; limit: number };
}

@Component({
  selector: 'app-payable-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './payable-form.component.html',
})
export class PayableFormComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  form!: FormGroup;
  categories: PayableCategory[] = [];
  saving = false;
  loading = false;

  payableId: number | null = null;
  existing: Payable | null = null;

  get isEdit(): boolean {
    return this.payableId !== null;
  }

  get branchName(): string {
    return this.branchService.getCurrentBranch()?.name || 'active branch';
  }

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private notify: NotificationService,
    private branchService: BranchService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      title: ['', [Validators.required, Validators.maxLength(200)]],
      description: [''],
      amount: [null, [Validators.required, Validators.min(0.01)]],
      // Category is optional — an ad-hoc expense is a first-class entry, not a
      // thing that needs a category invented for it.
      categoryId: [null],
      dueDate: [this.istToday()],
      periodMonth: [this.istMonth()],
    });

    this.loadCategories();

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      this.payableId = parseInt(idParam, 10);
      this.loadPayable();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // IST calendar dates — the server runs UTC, never use local getters.
  private istYmd(d: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  istToday(): string {
    return this.istYmd();
  }

  istMonth(): string {
    return this.istYmd().slice(0, 7);
  }

  private loadCategories(): void {
    this.api
      .get<ApiResponse<PayableCategory[]>>('/payables/categories')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.categories = (res.data || []).filter((c) => c.isActive);
        },
        error: () => {},
      });
  }

  private loadPayable(): void {
    this.loading = true;
    this.api
      .get<ApiResponse<Payable>>(`/payables/${this.payableId}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => this.applyPayable(res.data),
        // Fall back to the list endpoint if a single-row GET isn't served.
        error: () => this.loadPayableFromList(),
      });
  }

  private loadPayableFromList(): void {
    this.api
      .get<ApiResponse<Payable[]>>('/payables', { limit: 500, page: 1 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const found = (res.data || []).find((p) => p.id === this.payableId);
          if (!found) {
            this.loading = false;
            this.notify.error('Expense not found');
            this.router.navigate(['/expenses']);
            return;
          }
          this.applyPayable(found);
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load expense');
          this.router.navigate(['/expenses']);
        },
      });
  }

  private applyPayable(p: Payable | null): void {
    this.loading = false;
    if (!p) {
      this.notify.error('Expense not found');
      this.router.navigate(['/expenses']);
      return;
    }
    this.existing = p;

    if (p.isSystem) {
      // Payroll/commission rows are corrected at their source screen (§6).
      this.notify.warning('Salary and commission rows are managed in Payroll');
      this.router.navigate(['/expenses']);
      return;
    }

    this.form.patchValue({
      title: p.title,
      description: p.description || '',
      // Prisma Decimal arrives as a string — coerce before it hits a number input.
      amount: Number(p.amount),
      categoryId: p.categoryId ?? null,
      dueDate: p.dueDate ? this.istYmd(new Date(p.dueDate)) : '',
      periodMonth: p.periodMonth || this.istMonth(),
    });
  }

  onSubmit(): void {
    if (this.form.invalid || this.saving) return;

    const v = this.form.value;
    const branch = this.branchService.getCurrentBranch();

    const body: Record<string, unknown> = {
      title: String(v.title).trim(),
      description: String(v.description || '').trim() || undefined,
      amount: Math.round(Number(v.amount) * 100) / 100,
      categoryId: v.categoryId ? Number(v.categoryId) : undefined,
      dueDate: v.dueDate || undefined,
      periodMonth: v.periodMonth || undefined,
    };
    // D11 — every payable carries a branch; default to the active one.
    if (!this.isEdit && branch) body['branchId'] = Number(branch.id);

    const request$ = this.isEdit
      ? this.api.put<ApiResponse<Payable>>(`/payables/${this.payableId}`, body)
      : this.api.post<ApiResponse<Payable>>('/payables', body);

    this.saving = true;
    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success(this.isEdit ? 'Expense updated' : 'Expense added');
        this.router.navigate(['/expenses']);
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(err.error?.error || 'Failed to save expense');
      },
    });
  }

  formatCurrency(value: string | number | null | undefined): string {
    const n = Number(value ?? 0);
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(n) ? n : 0);
  }

  get paidSoFar(): number {
    return this.existing ? Number(this.existing.paidAmount) || 0 : 0;
  }
}
