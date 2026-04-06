import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Subject, takeUntil, debounceTime, distinctUntilChanged, switchMap, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { BranchService, Branch } from '../../core/services/branch.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

interface TransferItem {
  variantId: number;
  quantity: number;
  productName: string;
  variantLabel: string;
  sku: string;
}

interface VariantSearchResult {
  id: number;
  sku: string;
  size?: string;
  color?: string;
  product?: { name: string };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: any;
}

@Component({
  selector: 'app-transfer-create',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PageHeaderComponent],
  templateUrl: './transfer-create.component.html',
})
export class TransferCreateComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private searchSubject = new Subject<string>();

  branches: Branch[] = [];
  fromBranchId: string | null = null;
  toBranchId: string | null = null;
  notes = '';
  items: TransferItem[] = [];
  saving = false;

  // Product search
  searchQuery = '';
  searchResults: VariantSearchResult[] = [];
  showResults = false;
  searching = false;

  constructor(
    private api: ApiService,
    private notification: NotificationService,
    private branchService: BranchService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.branchService.getBranches().pipe(takeUntil(this.destroy$)).subscribe({
      next: (branches) => (this.branches = branches),
    });

    this.searchSubject
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query || query.length < 2) {
            this.searchResults = [];
            this.showResults = false;
            return of(null);
          }
          this.searching = true;
          return this.api.get<ApiResponse<VariantSearchResult[]>>('/pos/products/search', { q: query });
        }),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (res) => {
          if (res) {
            this.searchResults = res.data ?? [];
            this.showResults = this.searchResults.length > 0;
          }
          this.searching = false;
        },
        error: () => {
          this.searching = false;
        },
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    this.searchSubject.next(value);
  }

  getVariantLabel(variant: VariantSearchResult): string {
    const parts: string[] = [];
    if (variant.size) parts.push(variant.size);
    if (variant.color) parts.push(variant.color);
    return parts.join(' / ') || '';
  }

  selectVariant(variant: VariantSearchResult): void {
    // Check if already added
    if (this.items.some((i) => i.variantId === variant.id)) {
      this.notification.warning('This variant is already added');
      this.closeSearch();
      return;
    }

    this.items.push({
      variantId: variant.id,
      quantity: 1,
      productName: variant.product?.name || 'Unknown',
      variantLabel: this.getVariantLabel(variant),
      sku: variant.sku,
    });

    this.closeSearch();
  }

  closeSearch(): void {
    this.searchQuery = '';
    this.searchResults = [];
    this.showResults = false;
  }

  removeItem(index: number): void {
    this.items.splice(index, 1);
  }

  updateQuantity(index: number, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (value > 0) {
      this.items[index].quantity = value;
    }
  }

  get isValid(): boolean {
    return (
      !!this.fromBranchId &&
      !!this.toBranchId &&
      this.fromBranchId !== this.toBranchId &&
      this.items.length > 0 &&
      this.items.every((i) => i.quantity > 0)
    );
  }

  onSubmit(): void {
    if (!this.isValid || this.saving) return;

    this.saving = true;
    const payload = {
      fromBranchId: Number(this.fromBranchId),
      toBranchId: Number(this.toBranchId),
      notes: this.notes.trim() || undefined,
      items: this.items.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
      })),
    };

    this.api.post('/inventory/transfer', payload).subscribe({
      next: () => {
        this.notification.success('Transfer created successfully');
        this.router.navigate(['/inventory/transfers']);
      },
      error: () => {
        this.saving = false;
        this.notification.error('Failed to create transfer');
      },
    });
  }
}
