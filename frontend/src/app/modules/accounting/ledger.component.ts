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
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountingService } from './accounting.service';

@Component({
  selector: 'app-ledger',
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
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './ledger.component.html',
})
export class LedgerComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  private accountingService = inject(AccountingService);
  private snackBar = inject(MatSnackBar);

  displayedColumns = ['date', 'account', 'description', 'debit', 'credit', 'balance'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;
  searchCtrl = new FormControl('');
  accountFilter = '';
  accounts: any[] = [];

  ngOnInit(): void {
    this.loadLedger();
    this.loadAccounts();
    this.searchCtrl.valueChanges.subscribe((val) => {
      this.dataSource.filter = (val || '').trim().toLowerCase();
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  loadLedger(): void {
    this.loading = true;
    const params: any = {};
    if (this.accountFilter) params.accountId = this.accountFilter;

    this.accountingService.getLedger(params).subscribe({
      next: (res) => {
        this.dataSource.data = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load ledger', 'Close', { duration: 3000 });
      },
    });
  }

  loadAccounts(): void {
    this.accountingService.getAccounts().subscribe({
      next: (res) => (this.accounts = Array.isArray(res) ? res : []),
    });
  }

  applyFilter(): void {
    this.loadLedger();
  }
}
