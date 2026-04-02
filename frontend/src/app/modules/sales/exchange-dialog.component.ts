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
  selector: 'app-exchange-dialog',
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
  templateUrl: './exchange-dialog.component.html',
})
export class ExchangeDialogComponent {
  private fb = inject(FormBuilder);
  private salesService = inject(SalesService);
  private snackBar = inject(MatSnackBar);

  form: FormGroup;
  sale: any;
  loading = false;
  newItems: Array<{ barcode: string; name: string; price: number; quantity: number }> = [];
  newItemBarcode = '';

  constructor(
    public dialogRef: MatDialogRef<ExchangeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    this.sale = data.sale;
    this.form = this.fb.group({
      returnItems: this.fb.array(
        (this.sale.items || []).map((item: any) =>
          this.fb.group({
            saleItemId: [item.id],
            productName: [item.productName || item.name],
            selected: [false],
            quantity: [item.quantity],
            unitPrice: [item.unitPrice],
          })
        )
      ),
    });
  }

  get returnItems(): FormArray {
    return this.form.get('returnItems') as FormArray;
  }

  get returnTotal(): number {
    return this.returnItems.controls.reduce((sum, ctrl) => {
      if (ctrl.value.selected) {
        return sum + ctrl.value.quantity * ctrl.value.unitPrice;
      }
      return sum;
    }, 0);
  }

  get newTotal(): number {
    return this.newItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  get priceDifference(): number {
    return this.newTotal - this.returnTotal;
  }

  addNewItem(): void {
    if (!this.newItemBarcode.trim()) return;
    this.newItems.push({
      barcode: this.newItemBarcode.trim(),
      name: 'Scanned Item',
      price: 0,
      quantity: 1,
    });
    this.newItemBarcode = '';
  }

  removeNewItem(index: number): void {
    this.newItems.splice(index, 1);
  }

  submit(): void {
    const selectedReturnItems = this.returnItems.controls
      .filter((ctrl) => ctrl.value.selected)
      .map((ctrl) => ({
        saleItemId: ctrl.value.saleItemId,
        quantity: ctrl.value.quantity,
      }));

    if (selectedReturnItems.length === 0) {
      this.snackBar.open('Select items to exchange', 'Close', { duration: 3000 });
      return;
    }
    if (this.newItems.length === 0) {
      this.snackBar.open('Add new items for exchange', 'Close', { duration: 3000 });
      return;
    }

    this.loading = true;
    this.salesService
      .processExchange(this.sale.id, {
        returnItems: selectedReturnItems,
        newItems: this.newItems,
        priceDifference: this.priceDifference,
      })
      .subscribe({
        next: () => {
          this.snackBar.open('Exchange processed successfully', 'Close', { duration: 2000 });
          this.dialogRef.close(true);
        },
        error: () => {
          this.snackBar.open('Failed to process exchange', 'Close', { duration: 3000 });
          this.loading = false;
        },
      });
  }
}
