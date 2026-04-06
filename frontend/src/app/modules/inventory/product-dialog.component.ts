import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '../../shared/dialog/dialog-ref';
import { DIALOG_DATA } from '../../shared/dialog/dialog.tokens';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';

interface ProductDialogData {
  product: any | null;
  brands: { id: number; name: string }[];
  categories: { id: number; name: string }[];
}

@Component({
  selector: 'app-product-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './product-dialog.component.html',
})
export class ProductDialogComponent implements OnInit {
  name = '';
  brandId: number | null = null;
  categoryId: number | null = null;
  basePrice: number | null = null;
  costPrice: number | null = null;
  description = '';

  saving = false;
  isEdit = false;

  // Variants (for create mode)
  variants: { size: string; color: string; priceOverride: number | null; costOverride: number | null }[] = [];

  // Inline add brand
  addingBrand = false;
  newBrandName = '';
  savingBrand = false;

  // Inline add category
  addingCategory = false;
  newCategoryName = '';
  savingCategory = false;

  constructor(
    public dialogRef: DialogRef<boolean>,
    @Inject(DIALOG_DATA) public data: ProductDialogData,
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    if (this.data.product) {
      this.isEdit = true;
      const p = this.data.product;
      this.name = p.name || '';
      this.brandId = p.brand?.id || p.brandId || null;
      this.categoryId = p.category?.id || p.categoryId || null;
      this.basePrice = p.basePrice ?? null;
      this.costPrice = p.costPrice ?? null;
      this.description = p.description || '';
    }
  }

  get isValid(): boolean {
    return (
      !!this.name.trim() &&
      this.brandId !== null &&
      this.categoryId !== null &&
      this.basePrice !== null &&
      this.basePrice > 0 &&
      this.costPrice !== null &&
      this.costPrice > 0
    );
  }

  // --- Inline Brand ---
  showAddBrand(): void {
    this.addingBrand = true;
    this.newBrandName = '';
  }

  cancelAddBrand(): void {
    this.addingBrand = false;
    this.newBrandName = '';
  }

  saveNewBrand(): void {
    if (!this.newBrandName.trim() || this.savingBrand) return;
    this.savingBrand = true;
    this.api.post<any>('/brands', { name: this.newBrandName.trim() }).subscribe({
      next: (res) => {
        const brand = res.data;
        this.data.brands.push({ id: brand.id, name: brand.name });
        this.brandId = brand.id;
        this.addingBrand = false;
        this.newBrandName = '';
        this.savingBrand = false;
        this.notification.success(`Brand "${brand.name}" created`);
      },
      error: () => {
        this.savingBrand = false;
        this.notification.error('Failed to create brand');
      },
    });
  }

  // --- Inline Category ---
  showAddCategory(): void {
    this.addingCategory = true;
    this.newCategoryName = '';
  }

  cancelAddCategory(): void {
    this.addingCategory = false;
    this.newCategoryName = '';
  }

  saveNewCategory(): void {
    if (!this.newCategoryName.trim() || this.savingCategory) return;
    this.savingCategory = true;
    this.api.post<any>('/categories', { name: this.newCategoryName.trim() }).subscribe({
      next: (res) => {
        const cat = res.data;
        this.data.categories.push({ id: cat.id, name: cat.name });
        this.categoryId = cat.id;
        this.addingCategory = false;
        this.newCategoryName = '';
        this.savingCategory = false;
        this.notification.success(`Category "${cat.name}" created`);
      },
      error: () => {
        this.savingCategory = false;
        this.notification.error('Failed to create category');
      },
    });
  }

  onSubmit(): void {
    if (!this.isValid || this.saving) return;

    this.saving = true;
    const payload: Record<string, any> = {
      name: this.name.trim(),
      brandId: this.brandId,
      categoryId: this.categoryId,
      basePrice: Number(this.basePrice),
      costPrice: Number(this.costPrice),
      description: this.description.trim() || undefined,
    };

    if (!this.isEdit && this.variants.length > 0) {
      payload['variants'] = this.variants
        .filter((v) => v.size.trim() && v.color.trim())
        .map((v) => ({
          size: v.size.trim(),
          color: v.color.trim(),
          ...(v.priceOverride ? { priceOverride: Number(v.priceOverride) } : {}),
          ...(v.costOverride ? { costOverride: Number(v.costOverride) } : {}),
        }));
    }

    const request = this.isEdit
      ? this.api.put(`/products/${this.data.product.id}`, payload)
      : this.api.post('/products', payload);

    request.subscribe({
      next: () => {
        this.notification.success(this.isEdit ? 'Product updated' : 'Product created');
        this.dialogRef.close(true);
      },
      error: () => {
        this.saving = false;
        this.notification.error('Failed to save product');
      },
    });
  }

  addVariantRow(): void {
    this.variants.push({ size: '', color: '', priceOverride: null, costOverride: null });
  }

  removeVariantRow(index: number): void {
    this.variants.splice(index, 1);
  }

  onCancel(): void {
    this.dialogRef.close();
  }
}
