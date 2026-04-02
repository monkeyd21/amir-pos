import { Component, inject, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { BarcodeService } from './barcode.service';
import { Subject, debounceTime, switchMap, of } from 'rxjs';
import JsBarcode from 'jsbarcode';

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
    MatAutocompleteModule,
    MatSnackBarModule,
    MatDividerModule,
  ],
  templateUrl: './barcodes.component.html',
})
export class BarcodesComponent implements AfterViewChecked {
  private barcodeService = inject(BarcodeService);
  private snackBar = inject(MatSnackBar);
  Math = Math;
  private barcodesRendered = new Set<string>();

  // Product Lookup
  searchValue = '';
  searchResults: any[] = [];
  lookupResult: any = null;
  lookupLoading = false;
  private searchSubject = new Subject<string>();

  // Barcode Print Queue
  printQueue: any[] = [];

  constructor() {
    this.searchSubject.pipe(
      debounceTime(300),
      switchMap((q) => {
        if (!q || q.length < 2) return of([]);
        if (/^\d+$/.test(q)) return of([]);
        return this.barcodeService.searchProducts(q);
      })
    ).subscribe((results: any) => {
      this.searchResults = Array.isArray(results) ? results : [];
    });
  }

  ngAfterViewChecked(): void {
    this.renderBarcodes();
  }

  private renderBarcodes(): void {
    this.printQueue.forEach((item) => {
      const el = document.querySelector(`svg.barcode-${item.barcode}`);
      if (el && !this.barcodesRendered.has(item.barcode)) {
        try {
          JsBarcode(el, item.barcode, {
            format: 'CODE128',
            width: 1.5,
            height: 40,
            displayValue: false,
            margin: 0,
          });
          this.barcodesRendered.add(item.barcode);
        } catch { /* ignore */ }
      }
    });
  }

  onSearchInput(): void {
    this.searchSubject.next(this.searchValue);
  }

  onSearchEnter(): void {
    const val = this.searchValue.trim();
    if (!val) return;
    if (/^\d+$/.test(val)) {
      this.lookupLoading = true;
      this.barcodeService.lookupBarcode(val).subscribe({
        next: (res) => {
          this.lookupResult = res;
          this.lookupLoading = false;
          this.searchResults = [];
        },
        error: () => {
          this.lookupResult = null;
          this.lookupLoading = false;
          this.snackBar.open('Product not found', 'Close', { duration: 3000 });
        },
      });
    }
  }

  selectProduct(product: any): void {
    this.lookupResult = product;
    this.searchValue = product.productName;
    this.searchResults = [];
  }

  clearLookup(): void {
    this.lookupResult = null;
    this.searchValue = '';
    this.searchResults = [];
  }

  addToPrintQueue(item: any): void {
    const exists = this.printQueue.find(p => p.barcode === item.barcode);
    if (exists) {
      exists.copies = (exists.copies || 1) + 1;
      this.snackBar.open('Increased copy count', 'Close', { duration: 1500 });
    } else {
      this.printQueue.push({ ...item, copies: 1 });
      this.snackBar.open('Added to print queue', 'Close', { duration: 1500 });
    }
  }

  removeFromQueue(index: number): void {
    const item = this.printQueue[index];
    this.barcodesRendered.delete(item.barcode);
    this.printQueue.splice(index, 1);
  }

  clearQueue(): void {
    this.barcodesRendered.clear();
    this.printQueue = [];
  }

  get totalLabels(): number {
    return this.printQueue.reduce((sum, item) => sum + (item.copies || 1), 0);
  }

  expandedQueue(): any[] {
    const result: any[] = [];
    this.printQueue.forEach(item => {
      for (let i = 0; i < (item.copies || 1); i++) {
        result.push(item);
      }
    });
    return result;
  }

  printBarcodes(): void {
    if (this.printQueue.length === 0) {
      this.snackBar.open('Add items to print queue first', 'Close', { duration: 3000 });
      return;
    }
    // Re-render all barcodes in the print area before printing
    this.barcodesRendered.clear();
    setTimeout(() => {
      document.querySelectorAll('.print-label-barcode').forEach((el) => {
        const code = el.getAttribute('data-barcode');
        if (code) {
          try {
            JsBarcode(el, code, {
              format: 'CODE128',
              width: 1.5,
              height: 45,
              displayValue: false,
              margin: 0,
            });
          } catch { /* ignore */ }
        }
      });
      setTimeout(() => window.print(), 200);
    }, 100);
  }
}
