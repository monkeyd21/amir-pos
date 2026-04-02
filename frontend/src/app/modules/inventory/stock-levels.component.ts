import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InventoryService } from './inventory.service';
import { StockAdjustmentDialogComponent } from './stock-adjustment-dialog.component';

@Component({
  selector: 'app-stock-levels',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatChipsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './stock-levels.component.html',
})
export class StockLevelsComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  private inventoryService = inject(InventoryService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  displayedColumns = ['product', 'variant', 'branch', 'quantity', 'minLevel', 'status', 'actions'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;
  branchFilter = '';
  lowStockOnly = false;
  branches: any[] = [];

  ngOnInit(): void {
    this.loadStock();
    this.loadBranches();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  loadStock(): void {
    this.loading = true;
    const params: any = {};
    if (this.branchFilter) params.branchId = this.branchFilter;
    if (this.lowStockOnly) params.lowStock = true;

    this.inventoryService.getStockLevels(params).subscribe({
      next: (res) => {
        this.dataSource.data = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load stock levels', 'Close', { duration: 3000 });
      },
    });
  }

  loadBranches(): void {
    this.inventoryService.getBranches().subscribe({
      next: (res) => (this.branches = Array.isArray(res) ? res : []),
    });
  }

  getStockStatus(item: any): string {
    if (item.quantity <= 0) return 'Out of Stock';
    if (item.quantity <= item.minLevel) return 'Low Stock';
    return 'In Stock';
  }

  getStockStatusClass(item: any): string {
    if (item.quantity <= 0) return 'bg-red-100 text-red-700';
    if (item.quantity <= item.minLevel) return 'bg-yellow-100 text-yellow-700';
    return 'bg-green-100 text-green-700';
  }

  openAdjustDialog(item: any): void {
    const dialogRef = this.dialog.open(StockAdjustmentDialogComponent, {
      width: '400px',
      data: { stockItem: item },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.loadStock();
    });
  }

  applyFilter(): void {
    this.loadStock();
  }
}
