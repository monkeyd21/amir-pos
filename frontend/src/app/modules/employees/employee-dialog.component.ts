import { Component, Inject, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { EmployeeService } from './employee.service';

@Component({
  selector: 'app-employee-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSnackBarModule,
  ],
  templateUrl: './employee-dialog.component.html',
})
export class EmployeeDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private employeeService = inject(EmployeeService);
  private snackBar = inject(MatSnackBar);

  form: FormGroup;
  mode: 'add' | 'edit';
  loading = false;
  branches: any[] = [];
  roles: string[] = ['admin', 'manager', 'cashier', 'sales_associate', 'inventory_clerk'];

  constructor(
    public dialogRef: MatDialogRef<EmployeeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    this.mode = data.mode;
    const emp = data.employee;
    const formConfig: any = {
      firstName: [emp?.firstName || '', Validators.required],
      lastName: [emp?.lastName || '', Validators.required],
      email: [emp?.email || '', [Validators.required, Validators.email]],
      phone: [emp?.phone || ''],
      role: [emp?.role || '', Validators.required],
      branchId: [emp?.branchId || ''],
      commissionRate: [emp?.commissionRate || 0, [Validators.min(0), Validators.max(100)]],
      isActive: [emp?.isActive !== false],
    };
    if (this.mode === 'add') {
      formConfig['password'] = ['', [Validators.required, Validators.minLength(6)]];
    }
    this.form = this.fb.group(formConfig);
  }

  ngOnInit(): void {
    this.employeeService.getBranches().subscribe({
      next: (res) => (this.branches = Array.isArray(res) ? res : []),
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    const request =
      this.mode === 'add'
        ? this.employeeService.create(this.form.value)
        : this.employeeService.update(this.data.employee.id, this.form.value);

    request.subscribe({
      next: () => {
        this.snackBar.open(`Employee ${this.mode === 'add' ? 'created' : 'updated'}`, 'Close', { duration: 2000 });
        this.dialogRef.close(true);
      },
      error: () => {
        this.snackBar.open('Failed to save employee', 'Close', { duration: 3000 });
        this.loading = false;
      },
    });
  }
}
