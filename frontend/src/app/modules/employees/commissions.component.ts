import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { EmployeeService } from './employee.service';

@Component({
  selector: 'app-commissions',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatCardModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './commissions.component.html',
})
export class CommissionsComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  private employeeService = inject(EmployeeService);
  private snackBar = inject(MatSnackBar);

  displayedColumns = ['employee', 'period', 'salesAmount', 'commissionRate', 'commissionAmount', 'status', 'actions'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;

  summaryCards: any[] = [];
  selectedPeriod = '';
  periods = ['2026-01', '2026-02', '2026-03', '2026-04'];

  ngOnInit(): void {
    this.loadCommissions();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  loadCommissions(): void {
    this.loading = true;
    const params: any = {};
    if (this.selectedPeriod) params.period = this.selectedPeriod;

    this.employeeService.getCommissions(params).subscribe({
      next: (res) => {
        this.dataSource.data = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });

    this.employeeService.getCommissionSummary(params).subscribe({
      next: (res) => {
        this.summaryCards = Array.isArray(res) ? res : [];
      },
    });
  }

  calculateCommissions(): void {
    if (!this.selectedPeriod) {
      this.snackBar.open('Select a period first', 'Close', { duration: 3000 });
      return;
    }

    this.employeeService.calculateCommissions({ period: this.selectedPeriod }).subscribe({
      next: () => {
        this.snackBar.open('Commissions calculated', 'Close', { duration: 2000 });
        this.loadCommissions();
      },
      error: () => {
        this.snackBar.open('Failed to calculate commissions', 'Close', { duration: 3000 });
      },
    });
  }

  payCommission(commission: any): void {
    this.employeeService.payCommission(commission.id).subscribe({
      next: () => {
        this.snackBar.open('Commission marked as paid', 'Close', { duration: 2000 });
        this.loadCommissions();
      },
      error: () => {
        this.snackBar.open('Failed to pay commission', 'Close', { duration: 3000 });
      },
    });
  }
}
