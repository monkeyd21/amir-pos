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

export interface Vendor {
  id: number;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  gstNumber?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  isActive: boolean;
}

interface VendorDialogData {
  vendor: Vendor | null;
}

@Component({
  selector: 'app-vendor-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './vendor-dialog.component.html',
})
export class VendorDialogComponent implements OnInit {
  form!: FormGroup;
  saving = false;
  isEdit = false;

  constructor(
    public dialogRef: DialogRef<boolean>,
    @Inject(DIALOG_DATA) public data: VendorDialogData,
    private fb: FormBuilder,
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.isEdit = !!this.data?.vendor;
    const v = this.data?.vendor;
    this.form = this.fb.group({
      name: [v?.name || '', [Validators.required, Validators.minLength(2)]],
      contactPerson: [v?.contactPerson || ''],
      phone: [v?.phone || ''],
      email: [v?.email || '', [Validators.email]],
      gstNumber: [v?.gstNumber || ''],
      paymentTerms: [v?.paymentTerms || ''],
      address: [v?.address || ''],
      notes: [v?.notes || ''],
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
    // Clean empty strings to null for update/create
    const body: Record<string, any> = {
      name: raw.name?.trim(),
      contactPerson: raw.contactPerson?.trim() || undefined,
      phone: raw.phone?.trim() || undefined,
      email: raw.email?.trim() || undefined,
      gstNumber: raw.gstNumber?.trim() || undefined,
      paymentTerms: raw.paymentTerms?.trim() || undefined,
      address: raw.address?.trim() || undefined,
      notes: raw.notes?.trim() || undefined,
    };

    const request$ = this.isEdit
      ? this.api.put(`/vendors/${this.data.vendor!.id}`, body)
      : this.api.post('/vendors', body);

    request$.subscribe({
      next: () => {
        this.notification.success(
          this.isEdit ? 'Vendor updated successfully' : 'Vendor created successfully'
        );
        this.saving = false;
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.notification.error(
          err.error?.error || err.error?.message || 'Failed to save vendor'
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
