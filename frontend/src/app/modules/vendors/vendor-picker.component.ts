import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Vendor, VendorDialogComponent } from './vendor-dialog.component';

interface VendorResponse {
  success: boolean;
  data: Vendor[];
}

@Component({
  selector: 'app-vendor-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="relative">
      <button
        type="button"
        (click)="toggleOpen()"
        class="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-body text-left bg-surface-container-lowest text-on-surface border border-outline-variant/15 rounded-lg focus:border-primary focus:outline-none transition-colors cursor-pointer"
      >
        <span class="flex items-center gap-2 truncate">
          <span class="material-symbols-outlined text-[16px] text-on-surface-variant/60">store</span>
          @if (selected) {
            <span class="truncate">{{ selected.name }}</span>
          } @else {
            <span class="text-on-surface-variant/40">{{ placeholder }}</span>
          }
        </span>
        <span class="material-symbols-outlined text-[18px] text-on-surface-variant/60">
          {{ open ? 'expand_less' : 'expand_more' }}
        </span>
      </button>

      @if (open) {
        <div
          class="absolute z-30 left-0 right-0 mt-1 max-h-64 overflow-auto bg-surface-container border border-outline-variant/20 rounded-lg shadow-ambient"
        >
          <div class="p-2 sticky top-0 bg-surface-container border-b border-outline-variant/10">
            <input
              type="text"
              [(ngModel)]="search"
              (input)="onSearchInput()"
              placeholder="Search vendors..."
              class="w-full px-3 py-2 text-xs font-body bg-surface-container-lowest text-on-surface placeholder:text-on-surface-variant/40 border border-outline-variant/15 rounded-md focus:border-primary focus:outline-none"
            />
          </div>
          <button
            type="button"
            (click)="clearSelection()"
            class="w-full text-left px-3.5 py-2 text-xs text-on-surface-variant hover:bg-surface-container-high/60 transition-colors cursor-pointer italic"
          >
            — No vendor —
          </button>
          @for (v of filtered; track v.id) {
            <button
              type="button"
              (click)="select(v)"
              class="w-full text-left px-3.5 py-2 hover:bg-surface-container-high/60 transition-colors cursor-pointer border-t border-outline-variant/5"
              [class.bg-primary-container]="selectedId === v.id"
            >
              <div class="text-sm text-on-surface">{{ v.name }}</div>
              @if (v.contactPerson || v.phone) {
                <div class="text-[11px] text-on-surface-variant/60">
                  {{ v.contactPerson }}{{ v.contactPerson && v.phone ? ' • ' : '' }}{{ v.phone }}
                </div>
              }
            </button>
          }
          @if (filtered.length === 0) {
            <div class="px-3.5 py-3 text-xs text-on-surface-variant/50 text-center">
              No vendors found
            </div>
          }
          <button
            type="button"
            (click)="addVendor()"
            class="w-full sticky bottom-0 flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-primary bg-surface-container border-t border-outline-variant/15 hover:bg-surface-container-high/60 transition-colors cursor-pointer"
          >
            <span class="material-symbols-outlined text-[18px]">add</span>
            Add new vendor
          </button>
        </div>
      }
    </div>
  `,
})
export class VendorPickerComponent implements OnInit {
  @Input() selectedId: number | null = null;
  @Input() placeholder = 'Select vendor (optional)';
  @Output() selectedIdChange = new EventEmitter<number | null>();

  vendors: Vendor[] = [];
  filtered: Vendor[] = [];
  search = '';
  open = false;
  selected: Vendor | null = null;

  constructor(private api: ApiService, private dialog: DialogService) {}

  ngOnInit(): void {
    this.api.get<VendorResponse>('/vendors', { isActive: 'true', limit: 100 }).subscribe({
      next: (res) => {
        this.vendors = res.data || [];
        this.filtered = this.vendors;
        if (this.selectedId) {
          this.selected = this.vendors.find((v) => v.id === this.selectedId) || null;
        }
      },
    });
  }

  toggleOpen(): void {
    this.open = !this.open;
  }

  onSearchInput(): void {
    const q = this.search.trim().toLowerCase();
    if (!q) {
      this.filtered = this.vendors;
    } else {
      this.filtered = this.vendors.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          (v.contactPerson || '').toLowerCase().includes(q) ||
          (v.phone || '').toLowerCase().includes(q)
      );
    }
  }

  select(v: Vendor): void {
    this.selected = v;
    this.selectedId = v.id;
    this.selectedIdChange.emit(v.id);
    this.open = false;
  }

  addVendor(): void {
    this.open = false;
    const ref = this.dialog.open<VendorDialogComponent, any, boolean | Vendor>(
      VendorDialogComponent,
      { data: { vendor: null }, width: '32rem' }
    );
    ref.afterClosed().subscribe((result) => {
      // On create the dialog returns the new vendor object — add it to the
      // list and auto-select it so the user doesn't have to reopen.
      if (result && typeof result === 'object') {
        const vendor = result as Vendor;
        this.vendors = [vendor, ...this.vendors];
        this.onSearchInput();
        this.select(vendor);
      }
    });
  }

  clearSelection(): void {
    this.selected = null;
    this.selectedId = null;
    this.selectedIdChange.emit(null);
    this.open = false;
  }
}
