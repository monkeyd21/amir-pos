import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';

interface ApiResponse<T> { success: boolean; data: T; }

@Component({
  selector: 'app-historical-sales-report',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './historical-sales-report.component.html',
})
export class HistoricalSalesReportComponent implements OnInit {
  loading = true;
  byFiscalYear: any[] = [];
  byMonth: any[] = [];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<ApiResponse<{ byFiscalYear: any[]; byMonth: any[] }>>('/historical/summary').subscribe({
      next: (res) => {
        this.byFiscalYear = (res.data?.byFiscalYear ?? []).map((r) => ({
          fiscalYear: r.fiscalYear,
          bills: r._count?._all ?? 0,
          total: Number(r._sum?.total ?? 0),
          cash: Number(r._sum?.cashAmount ?? 0),
          card: Number(r._sum?.cardAmount ?? 0),
          tax: Number(r._sum?.taxAmount ?? 0),
        }));
        this.byMonth = res.data?.byMonth ?? [];
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  fc(v: any): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v) || 0);
  }
}
