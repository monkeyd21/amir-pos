import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';
import { ApiService } from '../../core/services/api.service';

interface PnlLineItem {
  name: string;
  amount: number;
  items?: PnlLineItem[];
}

interface PnlData {
  revenue: PnlLineItem[];
  totalRevenue: number;
  expenses: PnlLineItem[];
  totalExpenses: number;
  netProfit: number;
  period: string;
  startDate: string;
  endDate: string;
}

interface PnlResponse {
  success: boolean;
  data: PnlData;
}

@Component({
  selector: 'app-pnl-statement',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent, LoadingSpinnerComponent],
  templateUrl: './pnl-statement.component.html',
})
export class PnlStatementComponent implements OnInit {
  pnl: PnlData | null = null;
  loading = false;
  period: 'monthly' | 'quarterly' | 'yearly' = 'monthly';
  startDate = '';
  endDate = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    const now = new Date();
    this.endDate = now.toISOString().split('T')[0];
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    this.startDate = start.toISOString().split('T')[0];
    this.loadPnl();
  }

  loadPnl(): void {
    this.loading = true;
    this.api
      .get<PnlResponse>('/accounting/pnl', {
        period: this.period,
        startDate: this.startDate,
        endDate: this.endDate,
      })
      .subscribe({
        next: (res) => {
          this.pnl = res.data || null;
          this.loading = false;
        },
        error: () => {
          this.pnl = null;
          this.loading = false;
        },
      });
  }

  setPeriod(period: 'monthly' | 'quarterly' | 'yearly'): void {
    this.period = period;
    this.loadPnl();
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(amount || 0);
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  get profitMargin(): number {
    if (!this.pnl || !this.pnl.totalRevenue) return 0;
    return (this.pnl.netProfit / this.pnl.totalRevenue) * 100;
  }
}
