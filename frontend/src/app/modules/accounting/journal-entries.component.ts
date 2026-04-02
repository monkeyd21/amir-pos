import { Component, OnInit, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
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
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountingService } from './accounting.service';

@Component({
  selector: 'app-journal-entries',
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
    MatDividerModule,
    MatExpansionModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './journal-entries.component.html',
})
export class JournalEntriesComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  private fb = inject(FormBuilder);
  private accountingService = inject(AccountingService);
  private snackBar = inject(MatSnackBar);

  displayedColumns = ['date', 'reference', 'description', 'totalDebit', 'totalCredit', 'status'];
  dataSource = new MatTableDataSource<any>([]);
  loading = false;
  accounts: any[] = [];
  showForm = false;

  form!: FormGroup;

  ngOnInit(): void {
    this.loadEntries();
    this.loadAccounts();
    this.initForm();
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  private initForm(): void {
    this.form = this.fb.group({
      date: [new Date(), Validators.required],
      reference: [''],
      description: ['', Validators.required],
      lines: this.fb.array([]),
    });
    this.addLine();
    this.addLine();
  }

  get lines(): FormArray {
    return this.form.get('lines') as FormArray;
  }

  get totalDebit(): number {
    return this.lines.controls.reduce((sum, line) => sum + (Number(line.value.debit) || 0), 0);
  }

  get totalCredit(): number {
    return this.lines.controls.reduce((sum, line) => sum + (Number(line.value.credit) || 0), 0);
  }

  get isBalanced(): boolean {
    return Math.abs(this.totalDebit - this.totalCredit) < 0.01 && this.totalDebit > 0;
  }

  addLine(): void {
    this.lines.push(
      this.fb.group({
        accountId: ['', Validators.required],
        debit: [0],
        credit: [0],
        description: [''],
      })
    );
  }

  removeLine(index: number): void {
    if (this.lines.length > 2) {
      this.lines.removeAt(index);
    }
  }

  loadEntries(): void {
    this.loading = true;
    this.accountingService.getJournalEntries().subscribe({
      next: (res) => {
        this.dataSource.data = Array.isArray(res) ? res : [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.snackBar.open('Failed to load journal entries', 'Close', { duration: 3000 });
      },
    });
  }

  loadAccounts(): void {
    this.accountingService.getAccounts().subscribe({
      next: (res) => (this.accounts = Array.isArray(res) ? res : []),
    });
  }

  toggleForm(): void {
    this.showForm = !this.showForm;
    if (this.showForm) {
      this.initForm();
    }
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (!this.isBalanced) {
      this.snackBar.open('Debits must equal credits', 'Close', { duration: 3000 });
      return;
    }

    this.loading = true;
    const payload = { ...this.form.value };
    if (payload.date instanceof Date) {
      payload.date = payload.date.toISOString().split('T')[0];
    }

    this.accountingService.createJournalEntry(payload).subscribe({
      next: () => {
        this.snackBar.open('Journal entry created', 'Close', { duration: 2000 });
        this.showForm = false;
        this.loadEntries();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Failed to create entry', 'Close', { duration: 3000 });
        this.loading = false;
      },
    });
  }
}
