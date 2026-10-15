import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, Pipe, PipeTransform } from '@angular/core';
import { NgClass } from '@angular/common';
import { Comparison, formatDdMmYyyy, formatInr, formatInrCompact, formatIndianNumber } from '@clothing-erp/shared';
import type { Tier } from './dashboard.models';

/** ₹1,20,000 (checklist #31). `compact` gives ₹1.2L for tight spaces. */
@Pipe({ name: 'inr', standalone: true })
export class InrPipe implements PipeTransform {
  transform(value: number | string | null | undefined, mode: 'full' | 'compact' | 'paise' = 'full'): string {
    if (value == null) return '—';
    if (mode === 'compact') return formatInrCompact(value);
    return formatInr(value, mode === 'paise' ? 2 : 0);
  }
}

/** 1,20,000 without the symbol, for counts. */
@Pipe({ name: 'indian', standalone: true })
export class IndianNumberPipe implements PipeTransform {
  transform(value: number | string | null | undefined, decimals = 0): string {
    return value == null ? '—' : formatIndianNumber(value, decimals);
  }
}

/** DD-MM-YYYY (checklist #16). */
@Pipe({ name: 'ddmmyyyy', standalone: true })
export class DdMmYyyyPipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    return formatDdMmYyyy(value);
  }
}

/**
 * One comparison line: "▲ 12% vs yesterday". Green when it is good for the
 * shop, red when it is not, grey within ±2% (§2.2). With no baseline it says
 * so in muted grey instead of inventing a number.
 */
@Component({
  selector: 'dash-compare',
  standalone: true,
  imports: [NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (c && !c.noData) {
      <span class="inline-flex items-center gap-1 whitespace-nowrap" [ngClass]="tone()">
        <span aria-hidden="true" class="text-[10px] leading-none">{{ arrow() }}</span>
        <span class="tabular-nums font-medium">{{ amount() }}</span>
        <span class="text-on-surface-variant font-normal">{{ label }}</span>
      </span>
    } @else {
      <span class="whitespace-nowrap text-on-surface-variant/60">{{ emptyText }}</span>
    }
  `,
})
export class CompareLineComponent {
  @Input() c: Comparison | null | undefined;
  @Input() label = 'vs yesterday';
  /** How the change is written: a percentage, percentage points, or a count. */
  @Input() as: 'pct' | 'points' | 'count' = 'pct';
  @Input() emptyText = 'No earlier data';

  arrow(): string {
    return this.c?.direction === 'up' ? '▲' : this.c?.direction === 'down' ? '▼' : '—';
  }

  amount(): string {
    const c = this.c!;
    if (this.as === 'points') return `${Math.abs(c.delta ?? 0).toFixed(1)} pts`;
    if (this.as === 'count') return `${Math.abs(c.delta ?? 0)}`;
    return `${Math.abs(c.pct ?? 0).toFixed(Math.abs(c.pct ?? 0) < 10 ? 1 : 0)}%`;
  }

  tone(): string {
    if (!this.c || this.c.direction === 'flat' || this.c.good == null) return 'text-on-surface-variant';
    return this.c.good ? 'text-emerald-300' : 'text-rose-300';
  }
}

/** §1.3a: tier → the card's accent. */
export function tierClasses(tier: Tier | null | undefined): string {
  switch (tier) {
    case 'critical':
      return 'border-rose-400/40 bg-rose-500/[0.06]';
    case 'attention':
      return 'border-amber-400/35 bg-amber-500/[0.05]';
    default:
      return 'border-outline-variant/15 bg-surface-container-low';
  }
}

/**
 * A KPI card: label, big number, up to two comparison lines. The whole card
 * is a button that opens its drill-down (§1.6). Extra content (the margin
 * figure, reason badges) projects in below the value.
 */
@Component({
  selector: 'dash-kpi',
  standalone: true,
  imports: [NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="kpi-card h-full w-full text-left rounded-[0.875rem] border px-5 pt-4 pb-4 flex flex-col transition-colors hover:border-primary/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      [ngClass]="tierClass()"
      (click)="open.emit()"
    >
      <span class="flex items-center gap-1.5 pr-7 text-[13px] text-on-surface-variant">
        @if (tier === 'critical') {
          <span class="material-symbols-outlined text-[16px] text-rose-300" aria-hidden="true">error</span>
        } @else if (tier === 'attention') {
          <span class="material-symbols-outlined text-[16px] text-amber-300" aria-hidden="true">warning</span>
        }
        {{ label }}
      </span>
      <span class="mt-1.5 font-headline font-bold tabular-nums leading-tight text-on-surface" [ngClass]="valueSize">
        <ng-content select="[kpi-value]"></ng-content>
      </span>
      <span class="mt-auto pt-2 flex flex-col gap-0.5 text-[12px]">
        <ng-content></ng-content>
      </span>
    </button>
  `,
})
export class KpiCardComponent {
  @Input({ required: true }) label!: string;
  @Input() tier: Tier = 'good';
  @Input() valueSize = 'text-[28px]';
  @Output() open = new EventEmitter<void>();

  tierClass(): string {
    return tierClasses(this.tier);
  }
}

/** Section heading inside a box, leaving room for the move handle. */
@Component({
  selector: 'dash-box-title',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-baseline justify-between gap-3 pr-8">
      <h2 class="font-headline text-[15px] font-bold text-on-surface">{{ title }}</h2>
      <ng-content></ng-content>
    </div>
  `,
})
export class BoxTitleComponent {
  @Input({ required: true }) title!: string;
}

export const PAYMENT_LABELS: Record<string, string> = {
  upi: 'UPI',
  cash: 'Cash',
  card: 'Card',
  voucher: 'Gift voucher',
  split: 'Split',
};

export function paymentLabel(mode: string | null | undefined): string {
  return mode ? PAYMENT_LABELS[mode] ?? mode : '';
}

export function timeIst(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}

/** "Free" is free size, not free of charge: say so wherever it sits beside a price. */
export function sizeLabel(size: string | null | undefined): string {
  if (!size) return '';
  return /^free$/i.test(size.trim()) ? 'Free size' : size;
}
