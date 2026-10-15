import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

export interface CatalogItem {
  variantId: number;
  barcode: string;
  sku: string;
  productName: string;
  size: string;
  color: string;
  price: number;
  taxRate: number;
  stock: number;
}

export interface QueuedSale {
  clientRef: string; // idempotency key — the backend dedups on this
  tempNumber: string; // shown locally until a permanent number is assigned
  createdAt: string;
  total: number;
  payload: any; // the /pos/checkout body (minus offline/clientRef, added at sync)
  // §11.6 — set when a replay was rejected by the server (e.g. validation /
  // stock conflict). Flagged for manager review rather than silently dropped.
  conflict?: boolean;
  conflictError?: string;
}

/**
 * A pending sale (dashboard spec §15.5) captured with no network: the pieces
 * scanned against the cached catalog, the money taken, the key it syncs under.
 */
export interface QueuedPendingSale {
  clientRef: string;
  createdAt: string;
  payload: {
    items: { barcode: string; quantity: number }[];
    paymentMode: 'cash' | 'upi';
    amountReceived: number;
    notes?: string | null;
  };
  conflict?: boolean;
  conflictError?: string;
}

/**
 * Keeps the POS working with no network. Caches the product catalog so the
 * cashier can still scan and price a bill, queues bills made offline with a
 * temporary number, and replays them when connectivity returns. Every queued
 * bill carries a clientRef (idempotency key), so syncing — even twice — can
 * never create a duplicate on the server.
 *
 * Storage is localStorage for simplicity (fine for a single-store catalog of a
 * few thousand variants). A very large catalog should move to IndexedDB.
 */
@Injectable({ providedIn: 'root' })
export class OfflineService {
  private readonly CATALOG_KEY = 'pos_catalog_v1';
  private readonly QUEUE_KEY = 'pos_offline_queue_v1';
  private readonly CUSTOMERS_KEY = 'pos_customers_v1';
  private readonly PENDING_SALES_KEY = 'pos_offline_pending_sales_v1';

  /** Best-effort connectivity signal (navigator + online/offline events). */
  online$ = new BehaviorSubject<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  /** Number of bills waiting to sync. */
  pending$ = new BehaviorSubject<number>(this.loadQueue().length);
  /** Number of pending sales (§15.5) captured offline and waiting to sync. */
  pendingSales$ = new BehaviorSubject<number>(this.loadPendingSales().length);
  /** When the catalog was last refreshed from the server. */
  catalogSyncedAt$ = new BehaviorSubject<string | null>(this.getCatalog().syncedAt ?? null);

  constructor(private api: ApiService) {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.online$.next(true);
        this.sync();
      });
      window.addEventListener('offline', () => this.online$.next(false));
    }
  }

  get isOnline(): boolean {
    return this.online$.value;
  }

  newClientRef(): string {
    const c: any = typeof crypto !== 'undefined' ? crypto : null;
    if (c?.randomUUID) return c.randomUUID();
    return `off-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // ── Catalog ──────────────────────────────────────────────────────
  async refreshCatalog(): Promise<number> {
    const res: any = await firstValueFrom(this.api.get<any>('/pos/catalog'));
    const data = res?.data ?? {};
    localStorage.setItem(
      this.CATALOG_KEY,
      JSON.stringify({ items: data.items ?? [], syncedAt: data.syncedAt ?? new Date().toISOString() })
    );
    this.catalogSyncedAt$.next(data.syncedAt ?? null);
    return data.count ?? (data.items?.length ?? 0);
  }

  getCatalog(): { items: CatalogItem[]; syncedAt?: string } {
    try {
      return JSON.parse(localStorage.getItem(this.CATALOG_KEY) || '{"items":[]}');
    } catch {
      return { items: [] };
    }
  }

  lookupBarcode(barcode: string): CatalogItem | null {
    const code = barcode.trim().toLowerCase();
    return (
      this.getCatalog().items.find(
        (i) => (i.barcode || '').toLowerCase() === code || (i.sku || '').toLowerCase() === code
      ) || null
    );
  }

  // ── Customers (§11.3 — read-only lookup offline) ──────────────────
  async refreshCustomers(): Promise<number> {
    const res: any = await firstValueFrom(this.api.get<any>('/customers', { limit: 2000 }));
    const items = res?.data ?? [];
    localStorage.setItem(
      this.CUSTOMERS_KEY,
      JSON.stringify({ items, syncedAt: new Date().toISOString() })
    );
    return items.length;
  }

  getCustomers(): any[] {
    try {
      return JSON.parse(localStorage.getItem(this.CUSTOMERS_KEY) || '{"items":[]}').items ?? [];
    } catch {
      return [];
    }
  }

  /** §11.3 — read-only customer search against the last synced data. */
  searchCustomers(query: string): any[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.getCustomers()
      .filter(
        (c) =>
          (c.firstName || '').toLowerCase().includes(q) ||
          (c.lastName || '').toLowerCase().includes(q) ||
          String(c.phone || '').includes(q)
      )
      .slice(0, 10);
  }

  // ── Offline sale queue ───────────────────────────────────────────
  loadQueue(): QueuedSale[] {
    try {
      return JSON.parse(localStorage.getItem(this.QUEUE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  private saveQueue(q: QueuedSale[]): void {
    localStorage.setItem(this.QUEUE_KEY, JSON.stringify(q));
    this.pending$.next(q.length);
  }

  queueSale(sale: QueuedSale): void {
    const q = this.loadQueue();
    q.push(sale);
    this.saveQueue(q);
  }

  get pendingCount(): number {
    return this.loadQueue().length;
  }

  /**
   * Replay queued bills to the server. Each goes through the normal checkout
   * with offline:true + its clientRef; the server dedups, so a partial-failure
   * retry is safe. Returns how many synced and how many remain.
   */
  async sync(): Promise<{ synced: number; remaining: number }> {
    if (!this.isOnline) return { synced: 0, remaining: this.pendingCount };
    await this.syncPendingSales();
    let synced = 0;
    for (const sale of [...this.loadQueue()]) {
      try {
        await firstValueFrom(
          this.api.post('/pos/checkout', { ...sale.payload, offline: true, clientRef: sale.clientRef })
        );
        // Success (created OR idempotent already-recorded) — drop it.
        this.saveQueue(this.loadQueue().filter((s) => s.clientRef !== sale.clientRef));
        synced++;
      } catch (err: any) {
        const status = err?.status ?? 0;
        // "No open session" is operational, not a data conflict — stop and retry
        // the whole queue once a session is open.
        const msg = err?.error?.error || err?.error?.message || err?.message || '';
        if (status === 404 || /session/i.test(msg)) break;
        // §11.6 — a genuine 4xx conflict (validation/stock): flag this bill for
        // manager review, keep it queued, and carry on with the rest.
        if (status >= 400 && status < 500) {
          this.saveQueue(
            this.loadQueue().map((s) =>
              s.clientRef === sale.clientRef ? { ...s, conflict: true, conflictError: msg } : s
            )
          );
          continue;
        }
        // transient/network — stop; we're probably offline again.
        break;
      }
    }
    return { synced, remaining: this.pendingCount };
  }

  /** §11.6 — bills that failed to sync and need manager review. */
  conflicts(): QueuedSale[] {
    return this.loadQueue().filter((s) => s.conflict);
  }

  // ── Offline pending sales (§15.5) ────────────────────────────────
  loadPendingSales(): QueuedPendingSale[] {
    try {
      return JSON.parse(localStorage.getItem(this.PENDING_SALES_KEY) || '[]');
    } catch {
      return [];
    }
  }

  private savePendingSales(q: QueuedPendingSale[]): void {
    localStorage.setItem(this.PENDING_SALES_KEY, JSON.stringify(q));
    this.pendingSales$.next(q.length);
  }

  queuePendingSale(entry: QueuedPendingSale): void {
    this.savePendingSales([...this.loadPendingSales(), entry]);
  }

  /**
   * Send queued pending sales. The server keys each on its clientRef, so a
   * retry after a dropped response records it once. A refusal (an unknown
   * barcode) is flagged for review rather than dropped: the piece did leave.
   */
  async syncPendingSales(): Promise<number> {
    if (!this.isOnline) return 0;
    let synced = 0;
    for (const entry of [...this.loadPendingSales()]) {
      if (entry.conflict) continue;
      try {
        await firstValueFrom(this.api.post('/pending-sales', { ...entry.payload, clientRef: entry.clientRef }));
        this.savePendingSales(this.loadPendingSales().filter((e) => e.clientRef !== entry.clientRef));
        synced++;
      } catch (err: any) {
        const status = err?.status ?? 0;
        if (status >= 400 && status < 500) {
          const msg = err?.error?.error || err?.message || 'Refused';
          this.savePendingSales(
            this.loadPendingSales().map((e) => (e.clientRef === entry.clientRef ? { ...e, conflict: true, conflictError: msg } : e))
          );
          continue;
        }
        break; // offline again, or the server is down: try on the next reconnect
      }
    }
    return synced;
  }
}
