import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { VendorDialogComponent, Vendor } from './vendor-dialog.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { SearchInputComponent } from '../../shared/search-input/search-input.component';

interface VendorResponse {
  success: boolean;
  data: Vendor[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

@Component({
  selector: 'app-vendor-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LoadingSpinnerComponent,
    EmptyStateComponent,
    SearchInputComponent,
  ],
  templateUrl: './vendor-list.component.html',
})
export class VendorListComponent implements OnInit {
  vendors: Vendor[] = [];
  loading = true;
  searchQuery = '';
  page = 1;
  limit = 20;
  total = 0;

  totalVendors = 0;
  activeVendors = 0;
  inactiveVendors = 0;

  constructor(
    private api: ApiService,
    private notification: NotificationService,
    private dialog: DialogService
  ) {}

  ngOnInit(): void {
    this.loadVendors();
  }

  loadVendors(): void {
    this.loading = true;
    const params: Record<string, string | number | boolean> = {
      page: this.page,
      limit: this.limit,
    };
    if (this.searchQuery) params['search'] = this.searchQuery;

    this.api.get<VendorResponse>('/vendors', params).subscribe({
      next: (res) => {
        this.vendors = res.data || [];
        this.total = res.meta?.total || this.vendors.length;
        this.computeKpis();
        this.loading = false;
      },
      error: () => {
        this.notification.error('Failed to load vendors');
        this.loading = false;
      },
    });
  }

  private computeKpis(): void {
    this.totalVendors = this.total;
    this.activeVendors = this.vendors.filter((v) => v.isActive).length;
    this.inactiveVendors = this.vendors.filter((v) => !v.isActive).length;
  }

  onSearch(query: string): void {
    this.searchQuery = query;
    this.page = 1;
    this.loadVendors();
  }

  addVendor(): void {
    const ref = this.dialog.open(VendorDialogComponent, {
      data: { vendor: null },
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.loadVendors();
    });
  }

  editVendor(vendor: Vendor, event: Event): void {
    event.stopPropagation();
    const ref = this.dialog.open(VendorDialogComponent, {
      data: { vendor },
    });
    ref.afterClosed().subscribe((result) => {
      if (result) this.loadVendors();
    });
  }

  toggleActive(vendor: Vendor, event: Event): void {
    event.stopPropagation();
    const newStatus = !vendor.isActive;
    this.api
      .put(`/vendors/${vendor.id}`, { isActive: newStatus })
      .subscribe({
        next: () => {
          vendor.isActive = newStatus;
          this.computeKpis();
          this.notification.info(
            `Vendor "${vendor.name}" ${newStatus ? 'activated' : 'deactivated'}`
          );
        },
        error: () => {
          this.notification.error('Failed to update vendor status');
        },
      });
  }

  get totalPages(): number {
    return Math.ceil(this.total / this.limit);
  }

  get pages(): number[] {
    const arr: number[] = [];
    const start = Math.max(1, this.page - 2);
    const end = Math.min(this.totalPages, this.page + 2);
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages) return;
    this.page = p;
    this.loadVendors();
  }
}
