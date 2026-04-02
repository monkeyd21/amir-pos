import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
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
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProductService } from './product.service';
import { ProductDialogComponent } from './product-dialog.component';

@Component({
  selector: 'app-product-list',
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
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  private productService = inject(ProductService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  displayedColumns = ['name', 'sku', 'brand', 'category', 'price', 'variants', 'actions'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;
  searchCtrl = new FormControl('');
  brandFilter = '';
  categoryFilter = '';
  brands: any[] = [];
  categories: any[] = [];

  ngOnInit(): void {
    this.loadProducts();
    this.loadFilters();

    this.searchCtrl.valueChanges.subscribe(() => {
      this.dataSource.filter = (this.searchCtrl.value || '').trim().toLowerCase();
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  loadProducts(): void {
    this.loading = true;
    const params: any = {};
    if (this.brandFilter) params.brand = this.brandFilter;
    if (this.categoryFilter) params.category = this.categoryFilter;

    this.productService.getAll(params).subscribe({
      next: (res) => {
        this.dataSource.data = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load products', 'Close', { duration: 3000 });
      },
    });
  }

  loadFilters(): void {
    this.productService.getBrands().subscribe({
      next: (res) => (this.brands = Array.isArray(res) ? res : []),
    });
    this.productService.getCategories().subscribe({
      next: (res) => (this.categories = Array.isArray(res) ? res : []),
    });
  }

  applyFilter(): void {
    this.loadProducts();
  }

  clearFilters(): void {
    this.brandFilter = '';
    this.categoryFilter = '';
    this.searchCtrl.setValue('');
    this.loadProducts();
  }

  openAddDialog(): void {
    const dialogRef = this.dialog.open(ProductDialogComponent, {
      width: '700px',
      maxHeight: '90vh',
      data: { mode: 'add' },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.loadProducts();
    });
  }

  openEditDialog(product: any): void {
    const dialogRef = this.dialog.open(ProductDialogComponent, {
      width: '700px',
      maxHeight: '90vh',
      data: { mode: 'edit', product },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.loadProducts();
    });
  }

  deleteProduct(product: any): void {
    if (confirm(`Delete product "${product.name}"?`)) {
      this.productService.delete(product.id).subscribe({
        next: () => {
          this.snackBar.open('Product deleted', 'Close', { duration: 2000 });
          this.loadProducts();
        },
        error: () => {
          this.snackBar.open('Failed to delete product', 'Close', { duration: 3000 });
        },
      });
    }
  }
}
