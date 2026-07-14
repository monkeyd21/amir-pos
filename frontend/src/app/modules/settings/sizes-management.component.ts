import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface SizeRow {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  // Client-only edit buffer for inline rename.
  editName?: string;
}

/**
 * §bug4 (follow-up) — Size master management. The user curates the list of sizes
 * here — points ("1Y"), adjacent bands ("3-6M"), or overlapping bands ("3-9M") —
 * and orders them manually (up/down) for counter convenience, since string sort
 * can't order "3-6M" vs "12-18M". These sizes then appear as selectable options
 * when building inventory (variant editor + bulk generator).
 */
@Component({
  selector: 'app-sizes-management',
  standalone: true,
  imports: [CommonModule, FormsModule, PageHeaderComponent],
  template: `
    <div class="p-6 lg:p-8 max-w-3xl">
      <app-page-header
        title="Sizes"
        subtitle="Your reusable size list — used when creating variants and bulk stock"
      ></app-page-header>

      <!-- Add new size -->
      <div class="bg-surface-container rounded-xl p-4 mb-6">
        <label class="block text-sm font-semibold font-body text-on-surface mb-2">Add a size</label>
        <div class="flex items-center gap-2">
          <input
            type="text"
            [(ngModel)]="newName"
            (keyup.enter)="add()"
            placeholder="e.g. 6-9M, 3-9M, 1Y, S, 32"
            class="flex-1 px-3 py-2.5 text-sm bg-surface border border-outline-variant rounded-lg text-on-surface focus:outline-none focus:border-primary"
          />
          <button
            (click)="add()"
            [disabled]="!newName.trim() || saving"
            class="px-4 py-2.5 text-sm font-semibold font-body bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-all"
          >
            <span class="material-symbols-outlined text-lg align-middle">add</span>
            Add
          </button>
        </div>
        <p class="text-xs text-on-surface-variant mt-2">
          Overlapping bands are fine (e.g. 3-6M and 3-9M). New sizes land at the bottom — reorder them below.
        </p>
      </div>

      <!-- List -->
      @if (loading) {
        <p class="text-sm text-on-surface-variant">Loading…</p>
      } @else if (sizes.length === 0) {
        <p class="text-sm text-on-surface-variant">No sizes yet. Add your first one above.</p>
      } @else {
        <div class="bg-surface-container rounded-xl divide-y divide-outline-variant/20">
          @for (s of sizes; track s.id; let i = $index) {
            <div class="flex items-center gap-2 px-4 py-2.5" [class.opacity-50]="!s.isActive">
              <!-- Reorder -->
              <div class="flex flex-col">
                <button (click)="move(i, -1)" [disabled]="i === 0"
                  class="text-on-surface-variant hover:text-on-surface disabled:opacity-30 leading-none">
                  <span class="material-symbols-outlined text-base">keyboard_arrow_up</span>
                </button>
                <button (click)="move(i, 1)" [disabled]="i === sizes.length - 1"
                  class="text-on-surface-variant hover:text-on-surface disabled:opacity-30 leading-none">
                  <span class="material-symbols-outlined text-base">keyboard_arrow_down</span>
                </button>
              </div>

              <!-- Name (inline editable) -->
              <input
                type="text"
                [(ngModel)]="s.editName"
                (blur)="rename(s)"
                (keyup.enter)="rename(s)"
                class="flex-1 px-2 py-1.5 text-sm bg-surface border border-transparent hover:border-outline-variant rounded-lg text-on-surface focus:outline-none focus:border-primary"
              />

              <!-- Active toggle -->
              <button (click)="toggleActive(s)"
                [class]="s.isActive
                  ? 'px-2.5 py-1 text-xs font-semibold rounded-full bg-primary-container text-white'
                  : 'px-2.5 py-1 text-xs font-semibold rounded-full bg-surface-container-high text-on-surface-variant'">
                {{ s.isActive ? 'Active' : 'Hidden' }}
              </button>

              <!-- Delete -->
              <button (click)="remove(s)"
                class="text-on-surface-variant hover:text-error">
                <span class="material-symbols-outlined text-lg align-middle">delete</span>
              </button>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class SizesManagementComponent implements OnInit {
  sizes: SizeRow[] = [];
  newName = '';
  loading = true;
  saving = false;

  constructor(
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.api.get<ApiResponse<SizeRow[]>>('/sizes', { all: 1 }).subscribe({
      next: (res) => {
        this.sizes = (res.data ?? []).map((s) => ({ ...s, editName: s.name }));
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  add(): void {
    const name = this.newName.trim();
    if (!name || this.saving) return;
    this.saving = true;
    this.api.post<ApiResponse<SizeRow>>('/sizes', { name }).subscribe({
      next: (res) => {
        this.sizes.push({ ...res.data, editName: res.data.name });
        this.newName = '';
        this.saving = false;
        this.notification.success(`Size "${res.data.name}" added`);
      },
      error: (err) => {
        this.saving = false;
        this.notification.error(err.error?.error || 'Failed to add size');
      },
    });
  }

  rename(s: SizeRow): void {
    const name = (s.editName ?? '').trim();
    if (!name || name === s.name) {
      s.editName = s.name; // reset empty edit
      return;
    }
    this.api.put<ApiResponse<SizeRow>>(`/sizes/${s.id}`, { name }).subscribe({
      next: (res) => {
        s.name = res.data.name;
        s.editName = res.data.name;
      },
      error: (err) => {
        s.editName = s.name;
        this.notification.error(err.error?.error || 'Failed to rename size');
      },
    });
  }

  toggleActive(s: SizeRow): void {
    const isActive = !s.isActive;
    this.api.put<ApiResponse<SizeRow>>(`/sizes/${s.id}`, { isActive }).subscribe({
      next: (res) => (s.isActive = res.data.isActive),
      error: (err) => this.notification.error(err.error?.error || 'Failed to update size'),
    });
  }

  move(index: number, dir: -1 | 1): void {
    const target = index + dir;
    if (target < 0 || target >= this.sizes.length) return;
    // Optimistic swap, then persist the whole order.
    const arr = this.sizes;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    this.persistOrder();
  }

  private persistOrder(): void {
    const ids = this.sizes.map((s) => s.id);
    this.api.put<ApiResponse<SizeRow[]>>('/sizes/reorder', { ids }).subscribe({
      error: (err) => {
        this.notification.error(err.error?.error || 'Failed to save order');
        this.load(); // resync on failure
      },
    });
  }

  remove(s: SizeRow): void {
    if (!confirm(`Delete size "${s.name}"? Existing stock keeps its label; it just leaves the picker.`)) return;
    this.api.delete<ApiResponse<{ id: number }>>(`/sizes/${s.id}`).subscribe({
      next: () => {
        this.sizes = this.sizes.filter((x) => x.id !== s.id);
        this.notification.success(`Size "${s.name}" deleted`);
      },
      error: (err) => this.notification.error(err.error?.error || 'Failed to delete size'),
    });
  }
}
