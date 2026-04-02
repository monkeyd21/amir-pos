import { Component, Input, Output, EventEmitter, ViewChild, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatSortModule, MatSort } from '@angular/material/sort';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

export interface TableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  type?: 'text' | 'number' | 'currency' | 'date' | 'status' | 'custom';
  width?: string;
}

@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatSortModule,
    MatIconModule,
    MatButtonModule,
  ],
  template: `
    <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div class="overflow-x-auto">
        <table mat-table [dataSource]="dataSource" matSort class="w-full">
          <ng-container *ngFor="let col of columns" [matColumnDef]="col.key">
            <th mat-header-cell *matHeaderCellDef
                [mat-sort-header]="col.sortable !== false ? col.key : ''"
                [disabled]="col.sortable === false"
                class="text-slate-500 font-medium text-sm">
              {{ col.label }}
            </th>
            <td mat-cell *matCellDef="let row" class="text-sm">
              {{ row[col.key] }}
            </td>
          </ng-container>

          <!-- Actions column -->
          <ng-container matColumnDef="actions" *ngIf="showActions">
            <th mat-header-cell *matHeaderCellDef class="text-slate-500 font-medium text-sm w-24">Actions</th>
            <td mat-cell *matCellDef="let row">
              <button mat-icon-button (click)="rowAction.emit({ action: 'edit', row: row })" class="text-slate-400 hover:text-blue-600">
                <mat-icon class="text-lg">edit</mat-icon>
              </button>
              <button mat-icon-button (click)="rowAction.emit({ action: 'delete', row: row })" class="text-slate-400 hover:text-red-600">
                <mat-icon class="text-lg">delete</mat-icon>
              </button>
            </td>
          </ng-container>

          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"
              class="hover:bg-slate-50 cursor-pointer"
              (click)="rowClick.emit(row)"></tr>
        </table>
      </div>

      <mat-paginator
        [pageSizeOptions]="pageSizeOptions"
        [pageSize]="pageSize"
        showFirstLastButtons>
      </mat-paginator>
    </div>
  `,
  styles: [`
    :host { display: block; }
    table { width: 100%; }
  `]
})
export class DataTableComponent implements AfterViewInit, OnChanges {
  @Input() columns: TableColumn[] = [];
  @Input() data: any[] = [];
  @Input() pageSize = 10;
  @Input() pageSizeOptions = [5, 10, 25, 50];
  @Input() showActions = false;

  @Output() rowClick = new EventEmitter<any>();
  @Output() rowAction = new EventEmitter<{ action: string; row: any }>();
  @Output() pageChange = new EventEmitter<any>();
  @Output() sortChange = new EventEmitter<any>();

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  dataSource = new MatTableDataSource<any>();

  get displayedColumns(): string[] {
    const cols = this.columns.map(c => c.key);
    if (this.showActions) cols.push('actions');
    return cols;
  }

  ngAfterViewInit(): void {
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) {
      this.dataSource.data = this.data;
    }
  }

  applyFilter(filterValue: string): void {
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }
}
