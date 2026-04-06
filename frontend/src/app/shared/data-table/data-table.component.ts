import {
  Component, Input, Output, EventEmitter, OnChanges, SimpleChanges,
  ContentChildren, QueryList, TemplateRef, Directive
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface TableColumn {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

@Directive({
  selector: '[appCellDef]',
  standalone: true,
})
export class CellDefDirective {
  @Input('appCellDef') columnKey = '';
  constructor(public templateRef: TemplateRef<any>) {}
}

@Component({
  selector: 'app-data-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './data-table.component.html',
})
export class DataTableComponent implements OnChanges {
  @Input() columns: TableColumn[] = [];
  @Input() rows: any[] = [];
  @Input() pageSize = 10;
  @Input() loading = false;
  @Input() emptyIcon = 'inbox';
  @Input() emptyTitle = 'No data found';
  @Input() emptyMessage = '';
  @Input() clickable = true;

  @Output() rowClick = new EventEmitter<any>();
  @Output() pageChange = new EventEmitter<number>();

  @ContentChildren(CellDefDirective) cellDefs!: QueryList<CellDefDirective>;

  sortKey = '';
  sortDirection: 'asc' | 'desc' = 'asc';
  currentPage = 1;

  displayedRows: any[] = [];
  totalPages = 1;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['rows'] || changes['pageSize']) {
      this.currentPage = 1;
      this.updateDisplay();
    }
  }

  getCellTemplate(key: string): TemplateRef<any> | null {
    if (!this.cellDefs) return null;
    const def = this.cellDefs.find(d => d.columnKey === key);
    return def ? def.templateRef : null;
  }

  onSort(column: TableColumn): void {
    if (!column.sortable) return;

    if (this.sortKey === column.key) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = column.key;
      this.sortDirection = 'asc';
    }
    this.updateDisplay();
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.updateDisplay();
    this.pageChange.emit(page);
  }

  onRowClick(row: any): void {
    if (this.clickable) {
      this.rowClick.emit(row);
    }
  }

  getCellValue(row: any, key: string): any {
    return key.split('.').reduce((obj, k) => obj?.[k], row);
  }

  get startIndex(): number {
    return (this.currentPage - 1) * this.pageSize;
  }

  get endIndex(): number {
    return Math.min(this.startIndex + this.pageSize, this.rows.length);
  }

  getAlignClass(align?: string): string {
    switch (align) {
      case 'center': return 'text-center';
      case 'right': return 'text-right';
      default: return 'text-left';
    }
  }

  shouldShowPage(page: number): boolean {
    if (this.totalPages <= 7) return true;
    if (page === 1 || page === this.totalPages) return true;
    if (Math.abs(page - this.currentPage) <= 1) return true;
    return false;
  }

  private updateDisplay(): void {
    let sorted = [...this.rows];

    if (this.sortKey) {
      sorted.sort((a, b) => {
        const aVal = this.getCellValue(a, this.sortKey);
        const bVal = this.getCellValue(b, this.sortKey);
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        let comparison = 0;
        if (typeof aVal === 'string') {
          comparison = aVal.localeCompare(bVal);
        } else {
          comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        }
        return this.sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    this.totalPages = Math.max(1, Math.ceil(sorted.length / this.pageSize));
    const start = (this.currentPage - 1) * this.pageSize;
    this.displayedRows = sorted.slice(start, start + this.pageSize);
  }
}
