import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { environment } from '../../../environments/environment';

interface RowValidation {
  rowNum: number;
  productName: string;
  brand: string;
  category: string;
  size: string;
  color: string;
  sku: string;
  barcode: string;
  basePrice: number;
  costPrice: number;
  taxRate: number;
  priceOverride: number | null;
  costOverride: number | null;
  quantity: number;
  minStockLevel: number;
  errors: string[];
  warnings: string[];
}

interface ParseResult {
  rows: RowValidation[];
  totalRows: number;
  validRows: number;
  errorRows: number;
}

interface ImportResult {
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  inventoryUpdated: number;
  errors: Array<{ rowNum: number; error: string }>;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

type Step = 'upload' | 'preview' | 'done';

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent],
  templateUrl: './import.component.html',
})
export class ImportComponent {
  step: Step = 'upload';
  uploading = false;
  importing = false;
  dragOver = false;

  parseResult: ParseResult | null = null;
  importResult: ImportResult | null = null;
  selectedFile: File | null = null;
  uploadError = '';

  // Filter for preview table
  showOnlyErrors = false;

  constructor(
    private api: ApiService,
    private http: HttpClient,
    private notification: NotificationService
  ) {}

  // ─── Template download ───────────────────────────────────

  downloadTemplate(): void {
    const token = localStorage.getItem('accessToken') || '';
    this.http
      .get(`${environment.apiUrl}/inventory/import/template`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Branch-Id': String(localStorage.getItem('branchId') || '1'),
        },
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'inventory-import-template.xlsx';
          a.click();
          URL.revokeObjectURL(url);
        },
        error: () => this.notification.error('Failed to download template'),
      });
  }

  // ─── File selection ──────────────────────────────────────

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = true;
  }

  onDragLeave(): void {
    this.dragOver = false;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver = false;
    const file = event.dataTransfer?.files[0];
    if (file) this.selectFile(file);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.selectFile(file);
    input.value = ''; // allow re-selecting same file
  }

  private selectFile(file: File): void {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      this.notification.warning('Please select an Excel (.xlsx, .xls) or CSV file');
      return;
    }
    this.selectedFile = file;
    this.uploadError = '';
    this.uploadForPreview();
  }

  // ─── Upload → preview ────────────────────────────────────

  private uploadForPreview(): void {
    if (!this.selectedFile) return;
    this.uploading = true;
    this.uploadError = '';

    const formData = new FormData();
    formData.append('file', this.selectedFile);

    const token = localStorage.getItem('accessToken') || '';
    this.http
      .post<ApiResponse<ParseResult>>(
        `${environment.apiUrl}/inventory/import/preview`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Branch-Id': String(localStorage.getItem('branchId') || '1'),
          },
        }
      )
      .subscribe({
        next: (res) => {
          this.uploading = false;
          if (res.success) {
            this.parseResult = res.data;
            this.step = 'preview';
          } else {
            this.uploadError = res.error || 'Failed to parse file';
          }
        },
        error: (err) => {
          this.uploading = false;
          this.uploadError =
            err.error?.error || err.error?.message || 'Upload failed';
        },
      });
  }

  // ─── Execute import ──────────────────────────────────────

  executeImport(): void {
    if (!this.parseResult || this.importing) return;
    const validRows = this.parseResult.rows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      this.notification.warning('No valid rows to import');
      return;
    }

    this.importing = true;
    this.api
      .post<ApiResponse<ImportResult>>('/inventory/import/execute', {
        rows: validRows,
      })
      .subscribe({
        next: (res) => {
          this.importing = false;
          this.importResult = res.data;
          this.step = 'done';
          this.notification.success(res.message || 'Import complete');
        },
        error: () => {
          this.importing = false;
        },
      });
  }

  // ─── Reset ───────────────────────────────────────────────

  reset(): void {
    this.step = 'upload';
    this.parseResult = null;
    this.importResult = null;
    this.selectedFile = null;
    this.uploadError = '';
    this.showOnlyErrors = false;
  }

  // ─── Helpers ─────────────────────────────────────────────

  get filteredRows(): RowValidation[] {
    if (!this.parseResult) return [];
    if (this.showOnlyErrors) {
      return this.parseResult.rows.filter((r) => r.errors.length > 0);
    }
    return this.parseResult.rows;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }
}
