import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { idbGet, idbSet } from './offline-store';

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
 * The catalog lives in IndexedDB (localStorage caps at ~5 MB and a large
 * catalog overflowed it silently), held in memory as an index so a scan is a
 * synchronous lookup. The bill queues stay in localStorage: they are small,
 * and a write that must not be lost should not wait on an async store.
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
  catalogSyncedAt$ = new BehaviorSubject<string | null>(null);
  /** Variants in the cached catalog (0 until it has loaded or been fetched). */
  catalogSize$ = new BehaviorSubject<number>(0);

  private catalog: { items: CatalogItem[]; syncedAt?: string } = { items: [] };
  private byCode = new Map<string, CatalogItem>();

  constructor(private api: ApiService) {
    void this.loadCatalog();
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
    const catalog = { items: (data.items ?? []) as CatalogItem[], syncedAt: data.syncedAt ?? new Date().toISOString() };
    this.setCatalog(catalog);
    await idbSet(this.CATALOG_KEY, catalog);
    return data.count ?? catalog.items.length;
  }

  /** Load the device's cached catalog into memory (and move an old localStorage copy across). */
  private async loadCatalog(): Promise<void> {
    let catalog = await idbGet<{ items: CatalogItem[]; syncedAt?: string }>(this.CATALOG_KEY);
    if (!catalog) {
      try {
        const legacy = localStorage.getItem(this.CATALOG_KEY);
        if (legacy) {
          catalog = JSON.parse(legacy);
          if (await idbSet(this.CATALOG_KEY, catalog)) localStorage.removeItem(this.CATALOG_KEY);
        }
      } catch {
        catalog = null;
      }
    }
    // A fetch that finished first is newer than what the device had stored.
    if (catalog && this.catalog.items.length === 0) this.setCatalog(catalog);
  }

  private setCatalog(catalog: { items: CatalogItem[]; syncedAt?: string }): void {
    this.catalog = catalog;
    this.byCode = new Map();
    for (const i of catalog.items) {
      if (i.barcode) this.byCode.set(i.barcode.toLowerCase(), i);
      if (i.sku && !this.byCode.has(i.sku.toLowerCase())) this.byCode.set(i.sku.toLowerCase(), i);
    }
    this.catalogSyncedAt$.next(catalog.syncedAt ?? null);
    this.catalogSize$.next(catalog.items.length);
  }

  getCatalog(): { items: CatalogItem[]; syncedAt?: string } {
    return this.catalog;
  }

  lookupBarcode(barcode: string): CatalogItem | null {
    return this.byCode.get(barcode.trim().toLowerCase()) ?? null;
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
