import { Injectable, computed, signal } from '@angular/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

export interface MobileCartItem {
  variantId: number;
  barcode: string;
  sku: string;
  productName: string;
  size: string;
  color: string;
  quantity: number;
  unitPrice: number;
  maxStock: number;
  /** Agent (salesman) assigned to this line. Defaults to the cashier. */
  agentId?: number | null;
  /** Offer info after /pos/cart/evaluate — kept optional, lazily populated */
  offerDisplay?: string;
  offerDiscount?: number;
  offerQualified?: boolean;
}

export interface MobileCustomer {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  loyaltyPoints?: number;
  loyaltyTier?: string;
  totalSpent?: number;
  visitCount?: number;
}

/**
 * Singleton cart state for the mobile POS. Screens don't own cart data —
 * they read/write through this service. Uses Angular signals so every
 * consumer reacts to changes automatically (bottom-nav badge, totals, etc.).
 */
@Injectable({ providedIn: 'root' })
export class MobileCartService {
  // ─── Reactive state ────────────────────────────────────────
  readonly items = signal<MobileCartItem[]>([]);
  readonly customer = signal<MobileCustomer | null>(null);
  readonly paymentMethod = signal<'cash' | 'card' | 'upi'>('cash');
  readonly cashTendered = signal<number | null>(null);

  // ─── Default agent (cashier) ───────────────────────────────
  readonly defaultAgentId = signal<number | null>(null);

  // ─── Discount state ────────────────────────────────────────
  /** '%' or flat '₹' — how `manualDiscountValue` is interpreted */
  readonly manualDiscountMode = signal<'amount' | 'percent'>('percent');
  /** Raw user input */
  readonly manualDiscountValue = signal<number | null>(null);
  /** Customer-asked flat ₹ waiver ("bhaiya 50 chhod do") */
  readonly specialDiscount = signal<number | null>(null);
  /** Snap total to nearest ₹10 — down (waive) or up (surcharge) */
  readonly roundMode = signal<'none' | 'down' | 'up'>('none');

  // ─── Loyalty redemption ────────────────────────────────────
  readonly loyaltyPointsRedeem = signal<number | null>(null);
  readonly loyaltyRedemptionValue = signal<number>(1); // Rs. per point — from /loyalty/config
  readonly loyaltyMinRedeem = signal<number>(100);

  // ─── Derived signals ───────────────────────────────────────
  readonly count = computed(() => this.items().reduce((s, i) => s + i.quantity, 0));
  readonly subtotal = computed(() =>
    this.items().reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  );
  readonly offerDiscount = computed(() =>
    this.items().reduce((s, i) => s + (i.offerQualified ? i.offerDiscount ?? 0 : 0), 0)
  );

  /** Base for manual %-discount calculation — subtotal minus offer savings */
  readonly discountBase = computed(() => this.subtotal() - this.offerDiscount());

  /** Manual discount resolved to ₹ (from %/₹ mode) */
  readonly resolvedManualDiscount = computed(() => {
    const v = this.manualDiscountValue() ?? 0;
    if (v <= 0) return 0;
    if (this.manualDiscountMode() === 'percent') {
      return Math.round((this.discountBase() * v) / 100);
    }
    return Math.min(this.discountBase(), Math.round(v));
  });

  /** Loyalty points → ₹ discount (clamped to customer's balance) */
  readonly loyaltyDiscount = computed(() => {
    const pts = this.loyaltyPointsRedeem() ?? 0;
    if (pts <= 0) return 0;
    const available = this.customer()?.loyaltyPoints ?? 0;
    return Math.min(pts, available) * this.loyaltyRedemptionValue();
  });

  /** Total payable BEFORE round-off */
  readonly payableBeforeRound = computed(() =>
    Math.max(
      0,
      this.subtotal() -
        this.offerDiscount() -
        this.resolvedManualDiscount() -
        (this.specialDiscount() ?? 0) -
        this.loyaltyDiscount()
    )
  );

  readonly roundDownAmount = computed(() => {
    const p = Math.round(this.payableBeforeRound());
    return p % 10;
  });
  readonly roundUpAmount = computed(() => {
    const p = Math.round(this.payableBeforeRound());
    const tail = p % 10;
    return tail === 0 ? 0 : 10 - tail;
  });

  /** Positive = waived (round down), negative = surcharge (round up) */
  readonly roundOff = computed(() => {
    if (this.roundMode() === 'down') return this.roundDownAmount();
    if (this.roundMode() === 'up') return -this.roundUpAmount();
    return 0;
  });

  /** Manual-only discount total (excludes loyalty — sent as `discountAmount`) */
  readonly manualDiscount = computed(
    () => this.resolvedManualDiscount() + this.roundOff() + (this.specialDiscount() ?? 0)
  );

  /** Grand total customer pays */
  readonly total = computed(() =>
    Math.max(0, this.payableBeforeRound() - this.roundOff())
  );

  readonly changeDue = computed(() => {
    const paid = this.cashTendered() ?? 0;
    const total = this.total();
    return this.paymentMethod() === 'cash' && paid >= total ? paid - total : 0;
  });

  // ─── Operations ────────────────────────────────────────────

  async add(item: Omit<MobileCartItem, 'quantity'>): Promise<'added' | 'incremented' | 'full' | 'out-of-stock'> {
    const existing = this.items().find((c) => c.variantId === item.variantId);
    if (existing) {
      if (existing.quantity >= existing.maxStock) {
        await this.haptic('warn');
        return 'full';
      }
      this.items.update((items) =>
        items.map((c) =>
          c.variantId === item.variantId ? { ...c, quantity: c.quantity + 1 } : c
        )
      );
      await this.haptic('light');
      return 'incremented';
    }
    // New item — reject if out of stock
    if (item.maxStock <= 0) {
      await this.haptic('warn');
      return 'out-of-stock';
    }
    this.items.update((items) => [
      ...items,
      { ...item, quantity: 1, agentId: item.agentId ?? this.defaultAgentId() ?? null },
    ]);
    await this.haptic('success');
    return 'added';
  }

  increment(variantId: number): void {
    this.items.update((items) =>
      items.map((c) =>
        c.variantId === variantId && c.quantity < c.maxStock
          ? { ...c, quantity: c.quantity + 1 }
          : c
      )
    );
    this.haptic('light');
  }

  decrement(variantId: number): void {
    const item = this.items().find((c) => c.variantId === variantId);
    if (!item) return;
    if (item.quantity <= 1) {
      this.remove(variantId);
      return;
    }
    this.items.update((items) =>
      items.map((c) =>
        c.variantId === variantId ? { ...c, quantity: c.quantity - 1 } : c
      )
    );
    this.haptic('light');
  }

  remove(variantId: number): void {
    this.items.update((items) => items.filter((c) => c.variantId !== variantId));
    this.haptic('medium');
  }

  setAgent(variantId: number, agentId: number | null): void {
    this.items.update((items) =>
      items.map((c) => (c.variantId === variantId ? { ...c, agentId } : c))
    );
  }

  clear(): void {
    this.items.set([]);
    this.customer.set(null);
    this.cashTendered.set(null);
    this.paymentMethod.set('cash');
    this.manualDiscountValue.set(null);
    this.manualDiscountMode.set('percent');
    this.specialDiscount.set(null);
    this.roundMode.set('none');
    this.loyaltyPointsRedeem.set(null);
  }

  setCustomer(customer: MobileCustomer | null): void {
    this.customer.set(customer);
    // Reset loyalty redemption when customer changes
    this.loyaltyPointsRedeem.set(null);
    if (customer) this.haptic('light');
  }

  // ─── Haptics wrapper ───────────────────────────────────────

  private async haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'warn' | 'error'): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      if (kind === 'success') {
        await Haptics.notification({ type: NotificationType.Success });
      } else if (kind === 'warn') {
        await Haptics.notification({ type: NotificationType.Warning });
      } else if (kind === 'error') {
        await Haptics.notification({ type: NotificationType.Error });
      } else {
        const style =
          kind === 'light'
            ? ImpactStyle.Light
            : kind === 'medium'
            ? ImpactStyle.Medium
            : ImpactStyle.Heavy;
        await Haptics.impact({ style });
      }
    } catch {
      // Silent — not all devices support haptics
    }
  }
}
