import { Component, EventEmitter, Input, OnInit, OnDestroy, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface Branch {
  id: number;
  name: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-employee-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './employee-dialog.component.html',
})
export class EmployeeDialogComponent implements OnInit, OnDestroy {
  @Input() employee: any | null = null;
  @Output() close = new EventEmitter<boolean>();

  private destroy$ = new Subject<void>();

  form!: FormGroup;
  saving = false;
  branches: Branch[] = [];

  roles = [
    { value: 'admin', label: 'Admin' },
    { value: 'manager', label: 'Manager' },
    { value: 'cashier', label: 'Cashier' },
    { value: 'staff', label: 'Staff' },
  ];

  get isEdit(): boolean {
    return !!this.employee;
  }

  constructor(
    private fb: FormBuilder,
    private api: ApiService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.form = this.fb.group({
      firstName: [this.employee?.firstName || '', [Validators.required]],
      lastName: [this.employee?.lastName || '', [Validators.required]],
      email: [this.employee?.email || '', [Validators.required, Validators.email]],
      phone: [this.employee?.phone || ''],
      role: [this.employee?.role || 'staff', [Validators.required]],
      branchId: [this.employee?.branch?.id || this.employee?.branchId || null],
    });

    this.loadBranches();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadBranches(): void {
    this.api
      .get<ApiResponse<Branch[]>>('/branches')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.branches = res.data || [];
        },
        error: () => {},
      });
  }

  onSubmit(): void {
    if (this.form.invalid || this.saving) return;

    this.saving = true;
    const body = this.form.value;

    const request$ = this.isEdit
      ? this.api.put<ApiResponse<any>>(`/employees/${this.employee.id}`, body)
      : this.api.post<ApiResponse<any>>('/employees', body);

    request$.pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.saving = false;
        this.notify.success(
          this.isEdit ? 'Employee updated' : 'Employee added'
        );
        this.close.emit(true);
      },
      error: (err) => {
        this.saving = false;
        this.notify.error(
          err.error?.error || 'Failed to save employee'
        );
      },
    });
  }

  onCancel(): void {
    this.close.emit(false);
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('dialog-backdrop')) {
      this.onCancel();
    }
  }
}
