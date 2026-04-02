import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { BarcodeService } from './barcode.service';

@Component({
  selector: 'app-barcodes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatTableModule,
    MatCheckboxModule,
    MatSnackBarModule,
    MatDividerModule,
  ],
  templateUrl: './barcodes.component.html',
})
export class BarcodesComponent {
  private barcodeService = inject(BarcodeService);
  private snackBar = inject(MatSnackBar);

  lookupValue = '';
  lookupResult: any = null;
  lookupLoading = false;

  selectedVariants: Set<number> = new Set();
  printItems: any[] = [];

  lookup(): void {
    if (!this.lookupValue.trim()) return;

    this.lookupLoading = true;
    this.barcodeService.lookup(this.lookupValue.trim()).subscribe({
      next: (res) => {
        this.lookupResult = res;
        this.lookupLoading = false;
      },
      error: () => {
        this.lookupResult = null;
        this.snackBar.open('Barcode not found', 'Close', { duration: 3000 });
        this.lookupLoading = false;
      },
    });
  }

  toggleSelect(variantId: number): void {
    if (this.selectedVariants.has(variantId)) {
      this.selectedVariants.delete(variantId);
    } else {
      this.selectedVariants.add(variantId);
    }
  }

  printBarcodes(): void {
    if (this.selectedVariants.size === 0) {
      this.snackBar.open('Select variants to print', 'Close', { duration: 3000 });
      return;
    }

    this.barcodeService.bulkGenerate([...this.selectedVariants]).subscribe({
      next: (res) => {
        this.printItems = Array.isArray(res) ? res : [];
        setTimeout(() => window.print(), 500);
      },
      error: () => {
        this.snackBar.open('Failed to generate barcodes', 'Close', { duration: 3000 });
      },
    });
  }
}
