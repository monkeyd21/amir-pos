import { Component, Inject, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray } from '@angular/forms';
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
import { ApiService } from '../../core/services/api.service';

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
  private api = inject(ApiService);
  private snackBar = inject(MatSnackBar);

  form: FormGroup;
  sale: any;
  loading = false;
  newItems: Array<{ barcode: string; name: string; variantLabel: string; price: number; quantity: number }> = [];
  newItemBarcode = '';

  constructor(
    public dialogRef: MatDialogRef<ExchangeDialogComponent>,
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
          quantity: [returnable],
          unitPrice: [item.unitPrice],
        });
      });

    this.form = this.fb.group({
      returnItems: this.fb.array(returnableItems),
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
    const barcode = this.newItemBarcode.trim();
    if (!barcode) return;
    this.newItemBarcode = '';

    this.api.get<any>(`/pos/lookup/${barcode}`).subscribe({
      next: (res: any) => {
        const p = res.data;
        this.newItems.push({
          barcode: p.barcode,
          name: p.productName,
          variantLabel: `${p.size || ''} / ${p.color || ''}`,
          price: p.price,
          quantity: 1,
        });
      },
      error: () => {
        this.snackBar.open('Product not found for this barcode', 'Close', { duration: 3000 });
      },
    });
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
          this.loading = false;
        },
      });
  }
}
