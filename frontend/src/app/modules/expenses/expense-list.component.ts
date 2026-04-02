import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ExpenseService } from './expense.service';

@Component({
  selector: 'app-expense-list',
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
    MatChipsModule,
    MatMenuModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './expense-list.component.html',
})
export class ExpenseListComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  private expenseService = inject(ExpenseService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);

  displayedColumns = ['date', 'category', 'description', 'amount', 'status', 'actions'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;
  searchCtrl = new FormControl('');
  statusFilter = '';
  categoryFilter = '';
  categories: any[] = [];

  ngOnInit(): void {
    this.loadExpenses();
    this.loadCategories();
    this.searchCtrl.valueChanges.subscribe((val) => {
      this.dataSource.filter = (val || '').trim().toLowerCase();
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  loadExpenses(): void {
    this.loading = true;
    const params: any = {};
    if (this.statusFilter) params.status = this.statusFilter;
    if (this.categoryFilter) params.categoryId = this.categoryFilter;

    this.expenseService.getAll(params).subscribe({
      next: (res) => {
        this.dataSource.data = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load expenses', 'Close', { duration: 3000 });
      },
    });
  }

  loadCategories(): void {
    this.expenseService.getCategories().subscribe({
      next: (res) => (this.categories = Array.isArray(res) ? res : []),
    });
  }

  applyFilter(): void {
    this.loadExpenses();
  }

  addExpense(): void {
    this.router.navigate(['/expenses/add']);
  }

  editExpense(expense: any): void {
    this.router.navigate(['/expenses/edit', expense.id]);
  }

  deleteExpense(expense: any): void {
    if (confirm('Delete this expense?')) {
      this.expenseService.delete(expense.id).subscribe({
        next: () => {
          this.snackBar.open('Expense deleted', 'Close', { duration: 2000 });
          this.loadExpenses();
        },
        error: () => {
          this.snackBar.open('Failed to delete expense', 'Close', { duration: 3000 });
        },
      });
    }
  }

  approveExpense(expense: any): void {
    this.expenseService.approve(expense.id).subscribe({
      next: () => {
        this.snackBar.open('Expense approved', 'Close', { duration: 2000 });
        this.loadExpenses();
      },
      error: () => {
        this.snackBar.open('Failed to approve expense', 'Close', { duration: 3000 });
      },
    });
  }

  rejectExpense(expense: any): void {
    this.expenseService.reject(expense.id).subscribe({
      next: () => {
        this.snackBar.open('Expense rejected', 'Close', { duration: 2000 });
        this.loadExpenses();
      },
      error: () => {
        this.snackBar.open('Failed to reject expense', 'Close', { duration: 3000 });
      },
    });
  }

  getStatusClass(status: string): string {
    switch (status?.toLowerCase()) {
      case 'approved': return 'bg-green-100 text-green-700';
      case 'rejected': return 'bg-red-100 text-red-700';
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  }
}
