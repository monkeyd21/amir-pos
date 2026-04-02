import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl, FormGroup, FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SalesService } from './sales.service';

@Component({
  selector: 'app-sales-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  templateUrl: './sales-list.component.html',
})
export class SalesListComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  private salesService = inject(SalesService);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);

  displayedColumns = ['saleNumber', 'date', 'customer', 'items', 'total', 'paymentMethod', 'status', 'actions'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;

  filterForm = this.fb.group({
    dateFrom: [null as Date | null],
    dateTo: [null as Date | null],
    status: [''],
    branchId: [''],
  });

  branches: any[] = [];

  ngOnInit(): void {
    this.loadSales();
    this.loadBranches();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  loadSales(): void {
    this.loading = true;
    const params: any = {};
    const f = this.filterForm.value;
    if (f.dateFrom) params.dateFrom = f.dateFrom.toISOString();
    if (f.dateTo) params.dateTo = f.dateTo.toISOString();
    if (f.status) params.status = f.status;
    if (f.branchId) params.branchId = f.branchId;

    this.salesService.getAll(params).subscribe({
      next: (res) => {
        this.dataSource.data = res.data || res || [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load sales', 'Close', { duration: 3000 });
      },
    });
  }

  loadBranches(): void {
    this.salesService.getBranches().subscribe({
      next: (res) => (this.branches = res.data || res || []),
    });
  }

  applyFilters(): void {
    this.loadSales();
  }

  clearFilters(): void {
    this.filterForm.reset();
    this.loadSales();
  }

  viewSale(sale: any): void {
    this.router.navigate(['/sales', sale.id]);
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700';
      case 'refunded': return 'bg-red-100 text-red-700';
      case 'partial_refund': return 'bg-yellow-100 text-yellow-700';
      case 'exchanged': return 'bg-purple-100 text-purple-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  }
}
