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
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CustomerService } from './customer.service';
import { CustomerDialogComponent } from './customer-dialog.component';

@Component({
  selector: 'app-customer-list',
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
    MatChipsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './customer-list.component.html',
})
export class CustomerListComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  private customerService = inject(CustomerService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  displayedColumns = ['name', 'phone', 'email', 'tier', 'points', 'totalSpent', 'actions'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;
  searchCtrl = new FormControl('');

  ngOnInit(): void {
    this.loadCustomers();
    this.searchCtrl.valueChanges.subscribe((value) => {
      this.dataSource.filter = (value || '').trim().toLowerCase();
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  loadCustomers(): void {
    this.loading = true;
    this.customerService.getAll().subscribe({
      next: (res) => {
        this.dataSource.data = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load customers', 'Close', { duration: 3000 });
      },
    });
  }

  viewCustomer(customer: any): void {
    this.router.navigate(['/customers', customer.id]);
  }

  openAddDialog(): void {
    const dialogRef = this.dialog.open(CustomerDialogComponent, {
      width: '500px',
      data: { mode: 'add' },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.loadCustomers();
    });
  }

  openEditDialog(customer: any, event: Event): void {
    event.stopPropagation();
    const dialogRef = this.dialog.open(CustomerDialogComponent, {
      width: '500px',
      data: { mode: 'edit', customer },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.loadCustomers();
    });
  }

  getTierClass(tier: string): string {
    switch (tier?.toLowerCase()) {
      case 'gold': return 'bg-yellow-100 text-yellow-700';
      case 'silver': return 'bg-slate-200 text-slate-700';
      case 'platinum': return 'bg-purple-100 text-purple-700';
      default: return 'bg-blue-100 text-blue-700';
    }
  }
}
