import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SalesService } from './sales.service';

@Component({
  selector: 'app-return-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCheckboxModule,
    MatDividerModule,
    MatSnackBarModule,
  ],
  templateUrl: './return-dialog.component.html',
})
export class ReturnDialogComponent {
  private fb = inject(FormBuilder);
  private salesService = inject(SalesService);
  private snackBar = inject(MatSnackBar);

  form: FormGroup;
  sale: any;
  loading = false;

  constructor(
    public dialogRef: MatDialogRef<ReturnDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    this.sale = data.sale;

    const returnableItems = (this.sale.items || [])
      .filter((item: any) => (item.quantity - (item.returnedQuantity || 0)) > 0)
      .map((item: any) => {
        const returnable = item.quantity - (item.returnedQuantity || 0);
        return this.fb.group({
          saleItemId: [item.id],
          productName: [item.variant?.product?.name || item.productName || item.name || 'Unknown'],
          variantLabel: [`${item.variant?.size || item.size || ''} / ${item.variant?.color || item.color || ''}`],
          selected: [false],
          quantity: [{ value: 0, disabled: true }],
          maxQuantity: [returnable],
          originalQty: [item.quantity],
          returnedQty: [item.returnedQuantity || 0],
          condition: ['resellable'],
          unitPrice: [item.unitPrice],
        });
      });

    this.form = this.fb.group({
      reason: ['', Validators.required],
      items: this.fb.array(returnableItems),
    });
  }

  get items(): FormArray {
    return this.form.get('items') as FormArray;
  }

  get refundAmount(): number {
    return this.items.controls.reduce((sum, ctrl) => {
      const val = ctrl.value;
      if (val.selected) {
        return sum + (ctrl.get('quantity')?.value || 0) * val.unitPrice;
      }
      return sum;
    }, 0);
  }

  toggleItem(index: number): void {
    const ctrl = this.items.at(index);
    const selected = ctrl.get('selected')?.value;
    if (selected) {
      ctrl.get('quantity')?.enable();
      ctrl.get('quantity')?.setValue(ctrl.get('maxQuantity')?.value);
    } else {
      ctrl.get('quantity')?.disable();
      ctrl.get('quantity')?.setValue(0);
    }
  }

  submit(): void {
    if (this.form.invalid) return;

    const selectedItems = this.items.controls
      .filter((ctrl) => ctrl.value.selected)
      .map((ctrl) => ({
        saleItemId: ctrl.value.saleItemId,
        quantity: ctrl.get('quantity')?.value,
        condition: ctrl.value.condition,
      }));

    if (selectedItems.length === 0) {
      this.snackBar.open('Select at least one item to return', 'Close', { duration: 3000 });
      return;
    }

    this.loading = true;
    this.salesService
      .processReturn(this.sale.id, {
        reason: this.form.value.reason,
        items: selectedItems,
        refundAmount: this.refundAmount,
      })
      .subscribe({
        next: () => {
          this.snackBar.open('Return processed successfully', 'Close', { duration: 2000 });
          this.dialogRef.close(true);
        },
        error: () => {
          this.loading = false;
        },
      });
  }
}
