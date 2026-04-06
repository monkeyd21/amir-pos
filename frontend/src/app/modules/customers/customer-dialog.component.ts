import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { DialogRef } from '../../shared/dialog/dialog-ref';
import { DIALOG_DATA } from '../../shared/dialog/dialog.tokens';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface CustomerDialogData {
  customer: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address?: string;
  } | null;
}

@Component({
  selector: 'app-customer-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './customer-dialog.component.html',
})
export class CustomerDialogComponent implements OnInit {
  form!: FormGroup;
  saving = false;
  isEdit = false;

  constructor(
    public dialogRef: DialogRef<boolean>,
    @Inject(DIALOG_DATA) public data: CustomerDialogData,
    private fb: FormBuilder,
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.isEdit = !!this.data?.customer;
    this.form = this.fb.group({
      firstName: [
        this.data?.customer?.firstName || '',
        [Validators.required, Validators.minLength(2)],
      ],
      lastName: [
        this.data?.customer?.lastName || '',
        [Validators.required, Validators.minLength(1)],
      ],
      email: [
        this.data?.customer?.email || '',
        [Validators.email],
      ],
      phone: [this.data?.customer?.phone || ''],
      address: [this.data?.customer?.address || ''],
    });
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    if (this.form.invalid) {
      Object.values(this.form.controls).forEach((c) => c.markAsTouched());
      return;
    }

    this.saving = true;
    const body = this.form.value;

    const request$ = this.isEdit
      ? this.api.put(`/customers/${this.data.customer!.id}`, body)
      : this.api.post('/customers', body);

    request$.subscribe({
      next: () => {
        this.notification.success(
          this.isEdit
            ? 'Customer updated successfully'
            : 'Customer created successfully'
        );
        this.saving = false;
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.notification.error(
          err.error?.error || err.error?.message || 'Failed to save customer'
        );
        this.saving = false;
      },
    });
  }

  hasError(field: string, error: string): boolean {
    const control = this.form.get(field);
    return !!control && control.hasError(error) && control.touched;
  }
}
