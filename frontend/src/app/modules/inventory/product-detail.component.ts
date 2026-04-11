import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { DialogService } from '../../shared/dialog/dialog.service';
import { StockAdjustmentDialogComponent } from './stock-adjustment-dialog.component';
import { BranchService } from '../../core/services/branch.service';
import { BulkVariantGeneratorComponent } from './bulk-variant-generator.component';

interface Variant {
  id: number;
  sku: string;
  size?: string;
  color?: string;
  barcode?: string;
  priceOverride: number | null;
  costOverride: number | null;
  isActive: boolean;
  inventory?: { quantity: number; branchId: number }[];
}

interface Product {
  id: number;
  name: string;
  slug?: string;
  description?: string;
  basePrice: number;
  costPrice?: number;
  taxRate?: number;
  isActive: boolean;
  brand?: { id: number; name: string };
  category?: { id: number; name: string };
  variants: Variant[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, LoadingSpinnerComponent, BulkVariantGeneratorComponent],
  styles: [`:host { display: block; }`],
  templateUrl: './product-detail.component.html',
})
export class ProductDetailComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  product: Product | null = null;
  loading = true;

  // Add variant form
  showAddVariant = false;
  newVariant = { size: '', color: '', priceOverride: null as number | null, costOverride: null as number | null };
  savingVariant = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notify: NotificationService,
    private dialog: DialogService,
    private branchService: BranchService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadProduct(id);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadProduct(id: string): void {
    this.loading = true;
    this.api
      .get<ApiResponse<Product>>(`/products/${id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.product = res.data;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.error('Failed to load product');
          this.router.navigate(['/inventory/products']);
        },
      });
  }

  getStock(variant: Variant): number {
    if (!variant.inventory || variant.inventory.length === 0) return 0;
    return variant.inventory.reduce((sum, inv) => sum + (inv.quantity || 0), 0);
  }

  getEffectivePrice(variant: Variant): number {
    return variant.priceOverride ?? Number(this.product?.basePrice || 0);
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  adjustStock(variant: Variant): void {
    const currentBranch = this.branchService.getCurrentBranch();
    const branchId = currentBranch ? Number(currentBranch.id) : 1;

    const ref = this.dialog.open(StockAdjustmentDialogComponent, {
      data: {
        inventoryItem: {
          variantId: variant.id,
          branchId,
          variant: {
            ...variant,
            product: { name: this.product?.name },
          },
          quantity: this.getStock(variant),
        },
      },
      width: '480px',
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.loadProduct(String(this.product!.id));
    });
  }

  toggleAddVariant(): void {
    this.showAddVariant = !this.showAddVariant;
    this.newVariant = { size: '', color: '', priceOverride: null, costOverride: null };
  }

  get canSaveVariant(): boolean {
    return !!this.newVariant.size.trim() && !!this.newVariant.color.trim();
  }

  saveVariant(): void {
    if (!this.canSaveVariant || this.savingVariant || !this.product) return;
    this.savingVariant = true;

    const body: any = {
      size: this.newVariant.size.trim(),
      color: this.newVariant.color.trim(),
    };
    if (this.newVariant.priceOverride) body.priceOverride = Number(this.newVariant.priceOverride);
    if (this.newVariant.costOverride) body.costOverride = Number(this.newVariant.costOverride);

    this.api
      .post<ApiResponse<any>>(`/products/${this.product.id}/variants`, body)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.notify.success('Variant added');
          this.savingVariant = false;
          this.showAddVariant = false;
          this.loadProduct(String(this.product!.id));
        },
        error: () => {
          this.savingVariant = false;
          this.notify.error('Failed to add variant');
        },
      });
  }

  onBulkGenerated(): void {
    if (this.product) {
      this.loadProduct(String(this.product.id));
    }
  }

  goBack(): void {
    this.router.navigate(['/inventory/products']);
  }
}
