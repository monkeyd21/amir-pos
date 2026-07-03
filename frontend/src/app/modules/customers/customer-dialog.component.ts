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
import { AutoCapsDirective } from '../../shared/directives/auto-caps.directive';

interface CustomerDialogData {
  customer: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address?: string;
    dateOfBirth?: string | null;
    gender?: string | null;
  } | null;
  // §5.2 — pre-fill the phone the cashier just searched, so it's never re-typed.
  phone?: string;
}

@Component({
  selector: 'app-customer-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, AutoCapsDirective],
  templateUrl: './customer-dialog.component.html',
})
export class CustomerDialogComponent implements OnInit {
  form!: FormGroup;
  saving = false;
  isEdit = false;

  constructor(
    public dialogRef: DialogRef<boolean | any>,
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
      // Last name is optional — a first name + phone is enough to create a
      // customer (the common walk-in POS case).
      lastName: [this.data?.customer?.lastName || ''],
      email: [
        this.data?.customer?.email || '',
        [Validators.email],
      ],
      phone: [
        this.data?.customer?.phone || this.data?.phone || '',
        [Validators.required, Validators.minLength(10)],
      ],
      address: [this.data?.customer?.address || ''],
      // §1.6 — DOB + Gender are OPTIONAL when adding a customer (deliberate,
      // final decision; supersedes the earlier §5.3 "mandatory" rule). Still
      // captured when provided for category/size suggestions. yyyy-MM-dd.
      dateOfBirth: [
        this.data?.customer?.dateOfBirth ? this.data.customer.dateOfBirth.substring(0, 10) : '',
      ],
      gender: [this.data?.customer?.gender || ''],
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
    const raw = this.form.value;
    // Clean empty strings to undefined — the backend rejects email: '' with
    // "Invalid email" (z.string().email()), so a name+phone-only customer
    // (the common POS case) would fail to save otherwise.
    const body: Record<string, any> = {
      firstName: raw.firstName?.trim(),
      lastName: raw.lastName?.trim() || undefined,
      email: raw.email?.trim() || undefined,
      phone: raw.phone?.trim() || undefined,
      address: raw.address?.trim() || undefined,
      dateOfBirth: raw.dateOfBirth || undefined,
      gender: raw.gender || undefined,
    };

    const request$ = this.isEdit
      ? this.api.put(`/customers/${this.data.customer!.id}`, body)
      : this.api.post('/customers', body);

    request$.subscribe({
      next: (res: any) => {
        this.notification.success(
          this.isEdit
            ? 'Customer updated successfully'
            : 'Customer created successfully'
        );
        this.saving = false;
        // Return the saved customer object so callers (POS terminal) can
        // auto-select / refresh it — on both create and edit.
        this.dialogRef.close(res?.data ?? true);
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
