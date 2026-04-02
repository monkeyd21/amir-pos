import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatStepperModule } from '@angular/material/stepper';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { InventoryService } from './inventory.service';
import { ApiService } from '../../core/services/api.service';
import { Subject, debounceTime, switchMap, of } from 'rxjs';

@Component({
  selector: 'app-transfer-create',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatStepperModule,
    MatSnackBarModule,
    MatDividerModule,
    MatAutocompleteModule,
  ],
  templateUrl: './transfer-create.component.html',
})
export class TransferCreateComponent implements OnInit {
  private fb = inject(FormBuilder);
  private inventoryService = inject(InventoryService);
  private api = inject(ApiService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  branchForm!: FormGroup;
  itemsForm!: FormGroup;
  branches: any[] = [];
  loading = false;
  productResults: any[] = [];
  private searchSubject = new Subject<string>();

  ngOnInit(): void {
    this.branchForm = this.fb.group({
      fromBranchId: ['', Validators.required],
      toBranchId: ['', Validators.required],
      notes: [''],
    });

    this.itemsForm = this.fb.group({
      items: this.fb.array([]),
    });

    this.loadBranches();
    this.searchSubject.pipe(
      debounceTime(300),
      switchMap((q) => q.length < 2 ? of([]) : this.api.get<any>('/pos/products/search', { q }))
    ).subscribe((res: any) => {
      this.productResults = res?.data || [];
    });
  }

  onProductSearch(query: string): void {
    this.searchSubject.next(query);
  }

  selectProduct(product: any, index: number): void {
    const item = this.items.at(index);
    item.patchValue({
      variantId: product.variantId,
      productName: `${product.productName} - ${product.size}/${product.color}`,
    });
    this.productResults = [];
  }

  get items(): FormArray {
    return this.itemsForm.get('items') as FormArray;
  }

  loadBranches(): void {
    this.inventoryService.getBranches().subscribe({
      next: (res) => (this.branches = Array.isArray(res) ? res : []),
    });
  }

  addItem(): void {
    this.items.push(
      this.fb.group({
        variantId: ['', Validators.required],
        productName: [''],
        variantName: [''],
        quantity: [1, [Validators.required, Validators.min(1)]],
      })
    );
  }

  removeItem(index: number): void {
    this.items.removeAt(index);
  }

  submit(): void {
    if (this.branchForm.invalid || this.items.length === 0) return;

    this.loading = true;
    const payload = {
      ...this.branchForm.value,
      items: this.items.value,
    };

    this.inventoryService.createTransfer(payload).subscribe({
      next: () => {
        this.snackBar.open('Transfer created successfully', 'Close', { duration: 2000 });
        this.router.navigate(['/inventory/transfers']);
      },
      error: () => {
        this.snackBar.open('Failed to create transfer', 'Close', { duration: 3000 });
        this.loading = false;
      },
    });
  }

  cancel(): void {
    this.router.navigate(['/inventory/transfers']);
  }
}
