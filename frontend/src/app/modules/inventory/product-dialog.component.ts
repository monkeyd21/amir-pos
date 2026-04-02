import { Component, Inject, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ProductService } from './product.service';

@Component({
  selector: 'app-product-dialog',
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
    MatDividerModule,
    MatSnackBarModule,
  ],
  templateUrl: './product-dialog.component.html',
})
export class ProductDialogComponent implements OnInit {
  private fb = inject(FormBuilder);
  private productService = inject(ProductService);
  private snackBar = inject(MatSnackBar);

  form!: FormGroup;
  mode: 'add' | 'edit' = 'add';
  brands: any[] = [];
  categories: any[] = [];
  loading = false;

  sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40'];
  colors = ['Black', 'White', 'Navy', 'Grey', 'Red', 'Blue', 'Green', 'Beige', 'Brown', 'Pink'];

  constructor(
    public dialogRef: MatDialogRef<ProductDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit(): void {
    this.mode = this.data.mode;
    this.initForm();
    this.loadDropdowns();

    if (this.mode === 'edit' && this.data.product) {
      this.populateForm(this.data.product);
    }
  }

  private initForm(): void {
    this.form = this.fb.group({
      name: ['', Validators.required],
      sku: ['', Validators.required],
      brandId: [''],
      categoryId: [''],
      description: [''],
      basePrice: [0, [Validators.required, Validators.min(0)]],
      costPrice: [0, [Validators.required, Validators.min(0)]],
      taxRate: [18],
      variants: this.fb.array([]),
    });
  }

  get variants(): FormArray {
    return this.form.get('variants') as FormArray;
  }

  addVariant(): void {
    this.variants.push(
      this.fb.group({
        size: ['', Validators.required],
        color: ['', Validators.required],
        sku: [''],
        barcode: [''],
        priceAdjustment: [0],
      })
    );
  }

  removeVariant(index: number): void {
    this.variants.removeAt(index);
  }

  private populateForm(product: any): void {
    this.form.patchValue({
      name: product.name,
      sku: product.sku,
      brandId: product.brandId,
      categoryId: product.categoryId,
      description: product.description,
      basePrice: product.basePrice,
      costPrice: product.costPrice,
      taxRate: product.taxRate,
    });

    if (product.variants?.length) {
      product.variants.forEach((v: any) => {
        this.variants.push(
          this.fb.group({
            size: [v.size, Validators.required],
            color: [v.color, Validators.required],
            sku: [v.sku],
            barcode: [v.barcode],
            priceAdjustment: [v.priceAdjustment || 0],
          })
        );
      });
    }
  }

  private loadDropdowns(): void {
    this.productService.getBrands().subscribe({
      next: (res) => (this.brands = res.data || res || []),
    });
    this.productService.getCategories().subscribe({
      next: (res) => (this.categories = res.data || res || []),
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading = true;
    const payload = this.form.value;

    const request =
      this.mode === 'add'
        ? this.productService.create(payload)
        : this.productService.update(this.data.product.id, payload);

    request.subscribe({
      next: () => {
        this.snackBar.open(`Product ${this.mode === 'add' ? 'created' : 'updated'}`, 'Close', { duration: 2000 });
        this.dialogRef.close(true);
        this.loading = false;
      },
      error: () => {
        this.snackBar.open('Failed to save product', 'Close', { duration: 3000 });
        this.loading = false;
      },
    });
  }
}
