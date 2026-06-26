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

  /** Best-effort connectivity signal (navigator + online/offline events). */
  online$ = new BehaviorSubject<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);
  /** Number of bills waiting to sync. */
  pending$ = new BehaviorSubject<number>(this.loadQueue().length);
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
    const code = barcode.trim();
    return this.getCatalog().items.find((i) => i.barcode === code) || null;
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
        // 4xx (e.g. no open session) — stop and keep the rest queued for later.
        if (err?.status && err.status >= 400 && err.status < 500) break;
        // transient/network — stop; we're probably offline again.
        break;
      }
    }
    return { synced, remaining: this.pendingCount };
  }
}
