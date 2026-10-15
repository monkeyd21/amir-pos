import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { DdMmYyyyPipe, IndianNumberPipe, InrPipe } from './dash-ui';

interface StockRow {
  variantId: number;
  productId: number;
  name: string;
  sku: string;
  size: string;
  color: string;
  quantity: number;
  reorderLevel: number | null;
  unitCost: number | null;
  costValue: number | null;
  lastSoldOn: string | null;
  daysIdle: number | null;
}

/**
 * Dashboard spec §15.6: where the weekly reminder's "View report →" lands
 * until the Inventory Movement Report ships. The same query as the strip, so
 * the count on the dashboard is the number of rows here. When the report
 * module exists, the strip's link moves there and this page retires.
 */
@Component({
  selector: 'app-stock-list',
  standalone: true,
  imports: [NgClass, RouterLink, InrPipe, IndianNumberPipe, DdMmYyyyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-[1200px] space-y-5">
      <a routerLink="/dashboard" class="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-on-surface">
        <span class="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span> Dashboard
      </a>

      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="font-headline text-2xl font-bold text-on-surface">
            {{ view() === 'low' ? 'Low stock' : 'Stagnant stock' }}
          </h1>
          <p class="mt-1 text-sm text-on-surface-variant">
            @if (view() === 'low') {
              Variants below their reorder level. One-off pieces with no reorder level are never counted.
            } @else {
              Pieces on the shelf with no sale in {{ days() }}+ days. A piece that never sold counts from when it arrived.
            }
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex rounded-xl bg-surface-container-low p-1 ring-1 ring-outline-variant/15" role="tablist">
            <button type="button" role="tab" class="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold"
              [ngClass]="view() === 'low' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'"
              (click)="go('low', days())">Low stock</button>
            <button type="button" role="tab" class="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold"
              [ngClass]="view() === 'stagnant' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'"
              (click)="go('stagnant', days())">Stagnant</button>
          </div>
          @if (view() === 'stagnant') {
            <div class="flex rounded-xl bg-surface-container-low p-1 ring-1 ring-outline-variant/15" role="tablist" aria-label="Days without a sale">
              @for (d of buckets; track d) {
                <button type="button" role="tab" class="rounded-lg px-3 py-1.5 text-[13px] font-semibold tabular-nums"
                  [ngClass]="days() === d ? 'bg-surface-container-highest text-on-surface' : 'text-on-surface-variant hover:text-on-surface'"
                  (click)="go('stagnant', d)">{{ d }}+</button>
              }
            </div>
          }
        </div>
      </header>

      @if (!loading()) {
        <div class="flex flex-wrap gap-3">
          <div class="rounded-xl bg-surface-container-low px-4 py-3 ring-1 ring-outline-variant/15">
            <p class="text-[12px] text-on-surface-variant">SKUs</p>
            <p class="font-headline text-xl font-bold tabular-nums">{{ totals().skus | indian }}</p>
          </div>
          <div class="rounded-xl bg-surface-container-low px-4 py-3 ring-1 ring-outline-variant/15">
            <p class="text-[12px] text-on-surface-variant">Pieces</p>
            <p class="font-headline text-xl font-bold tabular-nums">{{ totals().pieces | indian }}</p>
          </div>
          <div class="rounded-xl bg-surface-container-low px-4 py-3 ring-1 ring-outline-variant/15">
            <p class="text-[12px] text-on-surface-variant">{{ view() === 'stagnant' ? 'Frozen at cost' : 'Value at cost' }}</p>
            <p class="font-headline text-xl font-bold tabular-nums">{{ totals().value | inr }}</p>
          </div>
        </div>
      }

      <div class="overflow-x-auto rounded-xl ring-1 ring-outline-variant/15">
        <table class="w-full min-w-[720px] text-[13px]">
          <thead class="bg-surface-container-low text-left text-[11px] uppercase tracking-wider text-on-surface-variant">
            <tr>
              <th class="px-4 py-2.5 font-semibold">Article</th>
              <th class="px-4 py-2.5 font-semibold">SKU</th>
              <th class="px-4 py-2.5 font-semibold">Variant</th>
              <th class="px-4 py-2.5 text-right font-semibold">Qty</th>
              @if (view() === 'low') {
                <th class="px-4 py-2.5 text-right font-semibold">Reorder at</th>
              }
              <th class="px-4 py-2.5 text-right font-semibold">Cost value</th>
              <th class="px-4 py-2.5 text-right font-semibold">Last sold</th>
              <th class="px-4 py-2.5 text-right font-semibold">Days without a sale</th>
            </tr>
          </thead>
          <tbody>
            @if (loading()) {
              @for (i of [1, 2, 3, 4, 5, 6]; track i) {
                <tr><td colspan="8" class="px-4 py-2"><div class="h-6 animate-pulse rounded bg-surface-container-high/60"></div></td></tr>
              }
            } @else if (rows().length === 0) {
              <tr><td colspan="8" class="px-4 py-10 text-center text-on-surface-variant">Nothing here.</td></tr>
            }
            @for (r of rows(); track r.variantId) {
              <tr class="border-t border-outline-variant/10 hover:bg-surface-container-low/60">
                <td class="px-4 py-2">
                  <a class="text-on-surface hover:text-primary hover:underline" [routerLink]="['/inventory/products', r.productId, 'edit']">{{ r.name }}</a>
                </td>
                <td class="px-4 py-2 font-mono text-[12px] text-on-surface-variant">{{ r.sku }}</td>
                <td class="px-4 py-2 text-on-surface-variant">{{ r.size }}@if (r.color) { · {{ r.color }} }</td>
                <td class="px-4 py-2 text-right tabular-nums">{{ r.quantity }}</td>
                @if (view() === 'low') {
                  <td class="px-4 py-2 text-right tabular-nums">{{ r.reorderLevel }}</td>
                }
                <td class="px-4 py-2 text-right tabular-nums">
                  @if (r.costValue != null) { {{ r.costValue | inr }} } @else { <span class="text-amber-300/80">no cost</span> }
                </td>
                <td class="px-4 py-2 text-right tabular-nums text-on-surface-variant">{{ r.lastSoldOn ? (r.lastSoldOn | ddmmyyyy) : 'Never' }}</td>
                <td class="px-4 py-2 text-right tabular-nums">{{ r.daysIdle ?? '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (totals().skus > rows().length) {
        <p class="text-[12px] text-on-surface-variant">Showing the {{ rows().length | indian }} highest by value of {{ totals().skus | indian }}.</p>
      }
    </div>
  `,
})
export class StockListComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly buckets = [30, 45, 60, 90];
  readonly view = signal<'low' | 'stagnant'>('low');
  readonly days = signal(60);
  readonly rows = signal<StockRow[]>([]);
  readonly loading = signal(true);
  /** Over the whole list, from the server: the table itself is capped. */
  readonly totals = signal({ skus: 0, pieces: 0, value: 0 });

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((q) => {
      this.view.set(q.get('view') === 'stagnant' ? 'stagnant' : 'low');
      const d = Number(q.get('days'));
      this.days.set(this.buckets.includes(d) ? d : 60);
      this.load();
    });
  }

  go(view: 'low' | 'stagnant', days: number): void {
    this.router.navigate([], { queryParams: { view, ...(view === 'stagnant' ? { days } : {}) } });
  }

  private load(): void {
    this.loading.set(true);
    const params: Record<string, string> = { view: this.view() };
    if (this.view() === 'stagnant') params['days'] = String(this.days());
    this.api.get<any>('/dashboard/stock', params).subscribe({
      next: (res) => {
        this.rows.set(res.data.rows);
        this.totals.set(res.data.totals);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }
}
