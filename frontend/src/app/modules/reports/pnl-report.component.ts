import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

interface PnlRow {
  sno: number;
  billNo: string;
  itemName: string;
  quantity: number;
  purchaseRate: number;
  saleRate: number;
  grossAmount: number;
  netAmount: number;
  totalPurchaseValue: number;
  totalSaleValue: number;
  gst: number;
  profitLoss: number;
  profitLossPct: number;
  landingCost: number;
  isReturn: boolean;
  /** Show the bill number only on the first row of each bill group. */
  showBill?: boolean;
}

interface PnlTotals {
  quantity: number;
  grossAmount: number;
  netAmount: number;
  totalPurchaseValue: number;
  totalSaleValue: number;
  gst: number;
  profitLoss: number;
  profitLossPct: number;
}

interface PnlData {
  period: { startDate: string; endDate: string };
  rows: PnlRow[];
  totals: PnlTotals;
  /** GST column is shown only when the account's "Show GST" switch is on. */
  showGst: boolean;
}

type Preset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

/**
 * Profit & Loss report. Defaults to today; quick presets set the range to the
 * current week / month / quarter / year (to-date), and a custom start/end range
 * is always available. Figures come from the accounting P&L endpoint (posted
 * journal entries) for the selected period.
 */
@Component({
  selector: 'app-pnl-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  templateUrl: './pnl-report.component.html',
})
export class PnlReportComponent implements OnInit {
  startDate = '';
  endDate = '';
  preset: Preset = 'today';
  loading = false;
  data: PnlData | null = null;

  readonly presets: { id: Preset; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This Week' },
    { id: 'month', label: 'This Month' },
    { id: 'quarter', label: 'This Quarter' },
    { id: 'year', label: 'This Year' },
  ];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.applyPreset('today');
  }

  /** Local YYYY-MM-DD (avoids the UTC off-by-one that toISOString causes). */
  private iso(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  applyPreset(p: Preset): void {
    this.preset = p;
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = new Date(end);

    switch (p) {
      case 'today':
        start = new Date(end);
        break;
      case 'week': {
        // Week = Monday to today (matches the dashboard's week definition).
        const dow = (end.getDay() + 6) % 7; // 0 = Monday
        start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - dow);
        break;
      }
      case 'month':
        start = new Date(end.getFullYear(), end.getMonth(), 1);
        break;
      case 'quarter': {
        const qStartMonth = Math.floor(end.getMonth() / 3) * 3;
        start = new Date(end.getFullYear(), qStartMonth, 1);
        break;
      }
      case 'year':
        start = new Date(end.getFullYear(), 0, 1);
        break;
      case 'custom':
        return; // keep the user's dates; just reload
    }

    this.startDate = this.iso(start);
    this.endDate = this.iso(end);
    this.load();
  }

  /** Called when the user edits the date inputs directly. */
  onCustomRange(): void {
    this.preset = 'custom';
    this.load();
  }

  load(): void {
    if (!this.startDate || !this.endDate) return;
    this.loading = true;
    this.data = null;
    this.api
      .get<{ success: boolean; data: PnlData }>('/reports/pnl', {
        startDate: this.startDate,
        endDate: this.endDate,
      })
      .subscribe({
        next: (res) => {
          const data = res.data;
          // Show the bill number only on the first row of each bill group.
          let prev = '';
          for (const r of data.rows) {
            r.showBill = r.billNo !== prev;
            prev = r.billNo;
          }
          this.data = data;
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  num(v: number | null | undefined): number {
    return Number(v || 0);
  }

  /** Plain number with fixed decimals + thousands separators (no currency symbol). */
  n(v: number | null | undefined, decimals = 2): string {
    return this.num(v).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}
