import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { CustomerService } from './customer.service';

@Component({
  selector: 'app-customer-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSnackBarModule,
  ],
  templateUrl: './customer-dialog.component.html',
})
export class CustomerDialogComponent {
  private fb = inject(FormBuilder);
  private customerService = inject(CustomerService);
  private snackBar = inject(MatSnackBar);

  form: FormGroup;
  mode: 'add' | 'edit';
  loading = false;

  constructor(
    public dialogRef: MatDialogRef<CustomerDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    this.mode = data.mode;
    this.form = this.fb.group({
      name: [data.customer?.name || '', Validators.required],
      phone: [data.customer?.phone || '', [Validators.required, Validators.pattern(/^\d{10}$/)]],
      email: [data.customer?.email || '', Validators.email],
      address: [data.customer?.address || ''],
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
        ? this.customerService.create(this.form.value)
        : this.customerService.update(this.data.customer.id, this.form.value);

    request.subscribe({
      next: () => {
        this.snackBar.open(`Customer ${this.mode === 'add' ? 'created' : 'updated'}`, 'Close', { duration: 2000 });
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Failed to save customer', 'Close', { duration: 3000 });
        this.loading = false;
      },
    });
  }
}
