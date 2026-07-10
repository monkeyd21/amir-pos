import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

/**
 * §8.4 — Daily & Monthly Variance Report. Reads the pre-computed variance log
 * (never recalculates). Per-mode first (Cash/UPI/Card shown separately, never
 * combined — §8.2). Both net and absolute monthly figures are shown, since a
 * month that nets to ₹0 from offsetting shorts/overs is not a clean month.
 */
interface DailyRow {
  date: string;
  mode: string;
  expected: number;
  actual: number;
  variance: number;
  direction: string;
  approval: 'pin' | 'auto';
  reason: string | null;
  pinApprovedAt: string | null;
}

interface MonthlyMode {
  mode: string;
  netVariance: number;
  absVariance: number;
  daysPinApproved: number;
  daysAutoApproved: number;
  largest: { date: string; variance: number; reason: string | null } | null;
}

@Component({
  selector: 'app-variance-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  templateUrl: './variance-report.component.html',
})
export class VarianceReportComponent implements OnInit {
  view: 'daily' | 'monthly' = 'daily';
  loading = false;

  // Daily
  startDate = '';
  endDate = '';
  dailyRows: DailyRow[] = [];

  // Monthly
  month = '';
  monthlyModes: MonthlyMode[] = [];

  readonly modes = ['cash', 'upi', 'card'];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    this.startDate = iso;
    this.endDate = iso;
    this.month = iso.slice(0, 7);
    this.loadDaily();
  }

  setView(v: 'daily' | 'monthly'): void {
    this.view = v;
    if (v === 'daily') this.loadDaily();
    else this.loadMonthly();
  }

  loadDaily(): void {
    this.loading = true;
    this.api
      .get<any>('/reports/variance/daily', { startDate: this.startDate, endDate: this.endDate })
      .subscribe({
        next: (res) => {
          this.dailyRows = res?.data?.rows ?? [];
          this.loading = false;
        },
        error: () => (this.loading = false),
      });
  }

  loadMonthly(): void {
    this.loading = true;
    this.api.get<any>('/reports/variance/monthly', { month: this.month }).subscribe({
      next: (res) => {
        this.monthlyModes = res?.data?.modes ?? [];
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  /** Filter daily rows for a given mode (per-mode, three separable columns). */
  rowsForMode(mode: string): DailyRow[] {
    return this.dailyRows.filter((r) => r.mode === mode);
  }

  modeLabel(mode: string): string {
    return mode === 'cash' ? 'Cash' : mode === 'upi' ? 'UPI' : 'Card';
  }

  monthlyFor(mode: string): MonthlyMode | undefined {
    return this.monthlyModes.find((m) => m.mode === mode);
  }

  fmt(n: number | null | undefined): string {
    const v = Number(n || 0);
    return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  varianceClass(v: number): string {
    return Math.abs(v) === 0 ? 'text-green-500' : 'text-error';
  }
}
