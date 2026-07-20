import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

interface ApiResponse<T> { success: boolean; data: T; meta?: any; }

@Component({
  selector: 'app-historical-bills',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './historical-bills.component.html',
})
export class HistoricalBillsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  bills: any[] = [];
  loading = false;
  page = 1;
  limit = 20;
  total = 0;
  search = '';
  fiscalYear = '';

  expandedId: number | null = null;
  expandedItems: any[] = [];
  itemsLoading = false;

  constructor(private api: ApiService) {}

  ngOnInit(): void { this.load(); }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  load(): void {
    this.loading = true;
    const params: Record<string, string | number> = { page: this.page, limit: this.limit };
    if (this.search.trim()) params['search'] = this.search.trim();
    if (this.fiscalYear) params['fiscalYear'] = this.fiscalYear;
    this.api.get<ApiResponse<any[]>>('/historical/bills', params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { this.bills = res.data ?? []; this.total = res.meta?.total ?? 0; this.loading = false; },
        error: () => { this.loading = false; },
      });
  }

  onSearch(): void { this.page = 1; this.load(); }
  setFy(fy: string): void { this.fiscalYear = fy; this.page = 1; this.load(); }

  get totalPages(): number { return Math.max(1, Math.ceil(this.total / this.limit)); }
  goTo(p: number): void { if (p < 1 || p > this.totalPages) return; this.page = p; this.expandedId = null; this.load(); }

  toggle(bill: any): void {
    if (this.expandedId === bill.id) { this.expandedId = null; return; }
    this.expandedId = bill.id;
    this.expandedItems = [];
    this.itemsLoading = true;
    this.api.get<ApiResponse<any>>(`/historical/bills/${bill.id}`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { this.expandedItems = res.data?.items ?? []; this.itemsLoading = false; },
        error: () => { this.itemsLoading = false; },
      });
  }

  custName(b: any): string {
    if (b.customer) return `${b.customer.firstName || ''} ${b.customer.lastName || ''}`.trim() || b.customer.phone;
    return b.customerNameRaw || b.customerMobile || '—';
  }

  formatCurrency(v: any): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v) || 0);
  }
}
