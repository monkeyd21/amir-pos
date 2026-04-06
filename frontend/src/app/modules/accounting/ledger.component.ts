import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { ApiService } from '../../core/services/api.service';

interface LedgerEntry {
  id: number;
  date: string;
  account: string;
  accountCode: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

interface LedgerResponse {
  success: boolean;
  data: LedgerEntry[];
}

@Component({
  selector: 'app-ledger',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, LoadingSpinnerComponent, EmptyStateComponent],
  templateUrl: './ledger.component.html',
})
export class LedgerComponent implements OnInit {
  entries: LedgerEntry[] = [];
  loading = false;
  startDate = '';
  endDate = '';
  accountFilter = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    const now = new Date();
    this.endDate = now.toISOString().split('T')[0];
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    this.startDate = start.toISOString().split('T')[0];
    this.loadLedger();
  }

  loadLedger(): void {
    this.loading = true;
    const params: Record<string, string> = {
      startDate: this.startDate,
      endDate: this.endDate,
    };
    if (this.accountFilter) {
      params['accountId'] = this.accountFilter;
    }
    this.api.get<LedgerResponse>('/accounting/ledger', params).subscribe({
      next: (res) => {
        this.entries = res.data || [];
        this.loading = false;
      },
      error: () => {
        this.entries = [];
        this.loading = false;
      },
    });
  }

  applyFilter(): void {
    this.loadLedger();
  }

  get totalDebit(): number {
    return this.entries.reduce((sum, e) => sum + (e.debit || 0), 0);
  }

  get totalCredit(): number {
    return this.entries.reduce((sum, e) => sum + (e.credit || 0), 0);
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount);
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
