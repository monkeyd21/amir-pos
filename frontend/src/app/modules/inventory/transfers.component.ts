import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InventoryService } from './inventory.service';

@Component({
  selector: 'app-transfers',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatFormFieldModule,
    MatChipsModule,
    MatMenuModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './transfers.component.html',
})
export class TransfersComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  private inventoryService = inject(InventoryService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  displayedColumns = ['id', 'fromBranch', 'toBranch', 'items', 'status', 'createdAt', 'actions'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;
  statusFilter = '';

  ngOnInit(): void {
    this.loadTransfers();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  loadTransfers(): void {
    this.loading = true;
    const params: any = {};
    if (this.statusFilter) params.status = this.statusFilter;

    this.inventoryService.getTransfers(params).subscribe({
      next: (res) => {
        this.dataSource.data = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-700';
      case 'approved': return 'bg-blue-100 text-blue-700';
      case 'in_transit': return 'bg-purple-100 text-purple-700';
      case 'received': return 'bg-green-100 text-green-700';
      case 'cancelled': return 'bg-red-100 text-red-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  }

  createTransfer(): void {
    this.router.navigate(['/inventory/transfers/create']);
  }

  approveTransfer(transfer: any): void {
    this.inventoryService.approveTransfer(transfer.id).subscribe({
      next: () => {
        this.snackBar.open('Transfer approved', 'Close', { duration: 2000 });
        this.loadTransfers();
      },
      error: () => {
        this.snackBar.open('Failed to approve transfer', 'Close', { duration: 3000 });
      },
    });
  }

  receiveTransfer(transfer: any): void {
    this.inventoryService.receiveTransfer(transfer.id, {}).subscribe({
      next: () => {
        this.snackBar.open('Transfer received', 'Close', { duration: 2000 });
        this.loadTransfers();
      },
      error: () => {
        this.snackBar.open('Failed to receive transfer', 'Close', { duration: 3000 });
      },
    });
  }
}
