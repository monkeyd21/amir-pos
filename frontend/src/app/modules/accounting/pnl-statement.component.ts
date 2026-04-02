import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountingService } from './accounting.service';

@Component({
  selector: 'app-pnl-statement',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatCardModule,
    MatDividerModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './pnl-statement.component.html',
})
export class PnlStatementComponent implements OnInit {
  private accountingService = inject(AccountingService);
  private snackBar = inject(MatSnackBar);

  loading = false;
  pnlData: any = null;
  selectedPeriod = '';
  periods = ['2026-01', '2026-02', '2026-03', '2026-04'];

  revenue: any[] = [];
  expenses: any[] = [];
  totalRevenue = 0;
  totalExpenses = 0;
  netIncome = 0;

  ngOnInit(): void {
    this.loadPnl();
  }

  loadPnl(): void {
    this.loading = true;
    const params: any = {};
    if (this.selectedPeriod) params.period = this.selectedPeriod;

    this.accountingService.getProfitAndLoss(params).subscribe({
      next: (res) => {
        this.pnlData = res;
        if (res) {
          this.revenue = res.revenue || [];
          this.expenses = res.expenses || [];
          this.totalRevenue = res.totalRevenue || this.revenue.reduce((s: number, r: any) => s + (r.amount || 0), 0);
          this.totalExpenses = res.totalExpenses || this.expenses.reduce((s: number, e: any) => s + (e.amount || 0), 0);
          this.netIncome = res.netIncome || (this.totalRevenue - this.totalExpenses);
        }
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load P&L statement', 'Close', { duration: 3000 });
      },
    });
  }

  applyFilter(): void {
    this.loadPnl();
  }
}
