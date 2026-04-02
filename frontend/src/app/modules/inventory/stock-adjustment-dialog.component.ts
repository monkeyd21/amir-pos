import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { InventoryService } from './inventory.service';

@Component({
  selector: 'app-stock-adjustment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSnackBarModule,
  ],
  templateUrl: './stock-adjustment-dialog.component.html',
})
export class StockAdjustmentDialogComponent {
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private snackBar = inject(MatSnackBar);

  form: FormGroup;
  loading = false;
  reasons = ['Received Shipment', 'Damaged', 'Lost', 'Returned', 'Count Correction', 'Other'];

  constructor(
    public dialogRef: MatDialogRef<StockAdjustmentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    this.form = this.fb.group({
      variantId: [data.stockItem.variantId],
      branchId: [data.stockItem.branchId],
      adjustmentType: ['add', Validators.required],
      quantity: [0, [Validators.required, Validators.min(1)]],
      reason: ['', Validators.required],
      notes: [''],
    });
  }

  get newQuantity(): number {
    const current = this.data.stockItem.quantity || 0;
    const adj = this.form.value.quantity || 0;
    return this.form.value.adjustmentType === 'add' ? current + adj : current - adj;
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    this.inventoryService.adjustStock(this.form.value).subscribe({
      next: () => {
        this.snackBar.open('Stock adjusted successfully', 'Close', { duration: 2000 });
        this.dialogRef.close(true);
      },
      error: () => {
        this.snackBar.open('Failed to adjust stock', 'Close', { duration: 3000 });
        this.loading = false;
      },
    });
  }
}
