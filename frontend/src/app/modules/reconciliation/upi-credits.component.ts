import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { parseDdMmYyyy } from '@clothing-erp/shared';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { ActionPanelComponent } from '../dashboard/action-panel.component';
import { DdMmYyyyPipe, InrPipe, timeIst } from '../dashboard/dash-ui';
import { ColumnMap, ParsedCredit, guessColumns, parseCsv, toCredits } from './upi-statement';

type Status = 'unmatched' | 'matched' | 'non_sale';

interface Credit {
  id: number;
  receivedAt: string;
  amount: string | number;
  reference: string;
  payerName: string | null;
  payerVpa: string | null;
  status: Status;
  matchMethod: string | null;
  nonSaleReason: string | null;
  matchedSale: { id: number; saleNumber: string } | null;
  matchedPendingSale: { id: number; number: string; status: string } | null;
  resolver: { firstName: string; lastName: string | null } | null;
}

const FIELDS: { key: keyof ColumnMap; label: string; required: boolean }[] = [
  { key: 'date', label: 'Date and time', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'reference', label: 'UTR / reference', required: true },
  { key: 'payerName', label: 'Payer name', required: false },
  { key: 'payerVpa', label: 'Payer UPI ID', required: false },
  { key: 'direction', label: 'Cr / Dr', required: false },
];

/**
 * Dashboard spec §15.2 / §15.5: the money that actually reached the shop's
 * UPI account, read from the bank or PSP statement and matched against bills.
 * Importing is idempotent (the UTR is unique), so overlapping statements are
 * harmless. What matches nothing shows on the dashboard until explained.
 */
@Component({
  selector: 'app-upi-credits',
  standalone: true,
  imports: [NgClass, FormsModule, RouterLink, InrPipe, DdMmYyyyPipe, ActionPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './upi-credits.component.html',
})
export class UpiCreditsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotificationService);

  readonly fields = FIELDS;
  readonly timeIst = timeIst;
  readonly tab = signal<Status>('unmatched');
  readonly credits = signal<Credit[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly resolving = signal(false);

  // Import
  readonly fileName = signal<string | null>(null);
  readonly header = signal<string[]>([]);
  readonly dataRows = signal<string[][]>([]);
  readonly map = signal<ColumnMap>({ date: null, amount: null, reference: null, payerName: null, payerVpa: null, direction: null });
  readonly parsed = computed(() => (this.header().length ? toCredits(this.dataRows(), this.map()) : null));

  // Manual entry
  manual = { date: '', time: '', amount: null as number | null, reference: '', payerName: '' };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.get<any>('/upi-credits', { status: this.tab() }).subscribe({
      next: (res) => {
        this.credits.set(res.data ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.credits.set([]);
        this.loading.set(false);
      },
    });
  }

  setTab(t: Status): void {
    this.tab.set(t);
    this.load();
  }

  // ─── Statement import ───

  async onFile(ev: Event): Promise<void> {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      this.notify.error('That file has no rows to read');
      return;
    }
    // Statements often open with account details: the header is the first row
    // that looks like one (has an amount-ish and a date-ish column).
    const headerAt = Math.max(
      0,
      rows.findIndex((r) => r.some((c) => /amount|credit/i.test(c)) && r.some((c) => /date|time/i.test(c)))
    );
    this.fileName.set(file.name);
    this.header.set(rows[headerAt]);
    this.dataRows.set(rows.slice(headerAt + 1));
    this.map.set(guessColumns(rows[headerAt]));
    (ev.target as HTMLInputElement).value = '';
  }

  setColumn(key: keyof ColumnMap, value: string): void {
    this.map.update((m) => ({ ...m, [key]: value === '' ? null : Number(value) }));
  }

  cancelImport(): void {
    this.fileName.set(null);
    this.header.set([]);
    this.dataRows.set([]);
  }

  runImport(): void {
    const rows = this.parsed()?.rows ?? [];
    if (!rows.length) return;
    this.busy.set(true);
    this.api.post<any>('/upi-credits/import', { rows }).subscribe({
      next: (res) => {
        this.busy.set(false);
        const d = res.data;
        this.notify.success(
          `${d.added} added${d.skipped ? `, ${d.skipped} already on file` : ''}, ${d.autoMatched} matched to bills automatically`
        );
        this.cancelImport();
        this.load();
      },
      error: (err) => {
        this.busy.set(false);
        this.notify.error(err?.error?.error || 'Import failed');
      },
    });
  }

  preview(): ParsedCredit[] {
    return (this.parsed()?.rows ?? []).slice(0, 5);
  }

  // ─── One credit by hand ───

  addManual(): void {
    const ymd = parseDdMmYyyy(this.manual.date);
    const time = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(this.manual.time.trim());
    if (!ymd || !time) {
      this.notify.error('Enter the date as DD-MM-YYYY and the time as HH:MM');
      return;
    }
    if (!this.manual.amount || this.manual.amount <= 0 || this.manual.reference.trim().length < 4) {
      this.notify.error('Enter the amount and the UTR');
      return;
    }
    const at = new Date(`${ymd}T${time[1].padStart(2, '0')}:${time[2]}:00+05:30`).toISOString();
    this.busy.set(true);
    this.api
      .post<any>('/upi-credits', {
        receivedAt: at,
        amount: this.manual.amount,
        reference: this.manual.reference.trim(),
        payerName: this.manual.payerName.trim() || null,
      })
      .subscribe({
        next: (res) => {
          this.busy.set(false);
          this.notify.success(res.data.autoMatched ? 'Added and matched to its bill' : res.data.added ? 'Added' : 'Already on file');
          this.manual = { date: '', time: '', amount: null, reference: '', payerName: '' };
          this.load();
        },
        error: (err) => {
          this.busy.set(false);
          this.notify.error(err?.error?.error || 'Could not add it');
        },
      });
  }

  reopen(c: Credit): void {
    this.api.post(`/upi-credits/${c.id}/reopen`, {}).subscribe({
      next: () => {
        this.notify.success('Back to unmatched');
        this.load();
      },
      error: (err) => this.notify.error(err?.error?.error || 'Could not reopen it'),
    });
  }

  methodLabel(c: Credit): string {
    return c.matchMethod === 'reference' ? 'by UTR' : c.matchMethod === 'amount_time' ? 'by amount and time' : 'by hand';
  }
}
