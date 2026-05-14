import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { LoadingSpinnerComponent } from '../../shared/loading-spinner/loading-spinner.component';

interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: string;
  loyaltyPoints: number;
  loyaltyTier: string;
  totalSpent: number;
  visitCount: number;
  createdAt: string;
}

interface CustomerStats {
  totalSpent: number;
  visitCount: number;
  avgOrderValue: number;
  lastPurchaseDate: string | null;
  loyaltyPoints: number;
  loyaltyTier: string;
}

interface SaleItem {
  id: number;
  quantity: number;
  unitPrice: number;
  total: number;
  variant?: {
    product?: { name?: string; brand?: { name?: string } };
    size?: string;
    color?: string;
  };
  agent?: { firstName?: string; lastName?: string };
  productName?: string;
}

interface Sale {
  id: number;
  saleNumber: string;
  total: number;
  createdAt: string;
  user?: { firstName?: string; lastName?: string };
  items?: SaleItem[];
  payments?: { method: string; amount: number }[];
}

interface LoyaltyTransaction {
  id: number;
  type: 'earned' | 'redeemed' | 'adjusted' | 'expired';
  points: number;
  description: string;
  createdAt: string;
}

const TIER_THRESHOLDS: Record<string, { next: string | null; pointsNeeded: number; currentMin: number }> = {
  bronze: { next: 'silver', pointsNeeded: 5000, currentMin: 0 },
  silver: { next: 'gold', pointsNeeded: 15000, currentMin: 5000 },
  gold: { next: 'platinum', pointsNeeded: 30000, currentMin: 15000 },
  platinum: { next: null, pointsNeeded: 30000, currentMin: 30000 },
};

@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent, LoadingSpinnerComponent],
  templateUrl: './customer-detail.component.html',
})
export class CustomerDetailComponent implements OnInit {
  customer: Customer | null = null;
  stats: CustomerStats | null = null;
  sales: Sale[] = [];
  loyaltyTransactions: LoyaltyTransaction[] = [];
  loading = true;
  activeTab: 'purchases' | 'loyalty' | 'messages' = 'purchases';

  private currencyFormatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.loadCustomer(+id);
    }
  }

  private loadCustomer(id: number): void {
    this.loading = true;
    this.api
      .get<{ success: boolean; data: { customer: Customer; stats: CustomerStats; sales: Sale[]; loyaltyTransactions: LoyaltyTransaction[] } }>(`/customers/${id}`)
      .subscribe({
        next: (res) => {
          const data = res.data as any;
          this.customer = data;
          this.stats = data.stats || {
            totalSpent: Number(data.totalSpent || 0),
            visitCount: data.visitCount || 0,
            avgOrderValue: 0,
            lastPurchaseDate: null,
            loyaltyPoints: data.loyaltyPoints || 0,
            loyaltyTier: data.loyaltyTier || 'bronze',
          };
          this.sales = data.sales || [];
          this.loyaltyTransactions = data.loyaltyTransactions || [];
          // Ensure numeric fields from Prisma Decimal strings
          this.sales = this.sales.map((s: any) => ({ ...s, total: Number(s.total) }));
          this.loading = false;
        },
        error: () => {
          this.notification.error('Failed to load customer');
          this.loading = false;
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/customers']);
  }

  setTab(tab: 'purchases' | 'loyalty' | 'messages'): void {
    this.activeTab = tab;
  }

  getInitials(): string {
    if (!this.customer) return '';
    return (
      (this.customer.firstName?.charAt(0) || '') +
      (this.customer.lastName?.charAt(0) || '')
    ).toUpperCase();
  }

  getTierLabel(tier: string): string {
    if (!tier) return 'Bronze';
    return tier.charAt(0).toUpperCase() + tier.slice(1).toLowerCase();
  }

  getTierColorClass(tier: string): string {
    const t = (tier || '').toLowerCase();
    switch (t) {
      case 'silver':
        return 'tier-silver';
      case 'gold':
        return 'tier-gold';
      case 'platinum':
        return 'tier-platinum';
      default:
        return 'tier-bronze';
    }
  }

  getTierBgClass(tier: string): string {
    const t = (tier || '').toLowerCase();
    switch (t) {
      case 'silver':
        return 'bg-gray-100 text-gray-700 border border-gray-300';
      case 'gold':
        return 'bg-yellow-50 text-yellow-700 border border-yellow-300';
      case 'platinum':
        return 'bg-purple-50 text-purple-700 border border-purple-300';
      default:
        return 'bg-amber-50 text-amber-700 border border-amber-300';
    }
  }

  getTierProgressBarClass(tier: string): string {
    const t = (tier || '').toLowerCase();
    switch (t) {
      case 'silver':
        return 'bg-gray-500';
      case 'gold':
        return 'bg-yellow-500';
      case 'platinum':
        return 'bg-purple-500';
      default:
        return 'bg-amber-500';
    }
  }

  getTierProgress(): number {
    if (!this.stats) return 0;
    const tier = (this.stats.loyaltyTier || 'bronze').toLowerCase();
    const info = TIER_THRESHOLDS[tier];
    if (!info || !info.next) return 100; // platinum = maxed
    const points = this.stats.loyaltyPoints || 0;
    const range = info.pointsNeeded - info.currentMin;
    if (range <= 0) return 100;
    const progress = ((points - info.currentMin) / range) * 100;
    return Math.min(100, Math.max(0, progress));
  }

  getNextTier(): string | null {
    if (!this.stats) return null;
    const tier = (this.stats.loyaltyTier || 'bronze').toLowerCase();
    const info = TIER_THRESHOLDS[tier];
    return info?.next || null;
  }

  getPointsToNextTier(): number {
    if (!this.stats) return 0;
    const tier = (this.stats.loyaltyTier || 'bronze').toLowerCase();
    const info = TIER_THRESHOLDS[tier];
    if (!info || !info.next) return 0;
    return Math.max(0, info.pointsNeeded - (this.stats.loyaltyPoints || 0));
  }

  formatCurrency(value: number): string {
    return this.currencyFormatter.format(value || 0);
  }

  formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  formatDateTime(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  getItemsSummary(sale: Sale): string {
    if (!sale.items || sale.items.length === 0) return '-';
    const names = sale.items.map(
      (item) => item.variant?.product?.name || item.productName || 'Item'
    );
    if (names.length <= 2) return names.join(', ');
    return `${names[0]}, ${names[1]} +${names.length - 2} more`;
  }

  getCashier(sale: Sale): string {
    if (sale.user?.firstName) {
      return `${sale.user.firstName} ${sale.user.lastName || ''}`.trim();
    }
    return '-';
  }

  getPaymentMethod(sale: Sale): string {
    if (!sale.payments || sale.payments.length === 0) return '-';
    return sale.payments.map((p) => this.formatPaymentMethod(p.method)).join(', ');
  }

  private formatPaymentMethod(method: string): string {
    if (!method) return '-';
    switch (method.toLowerCase()) {
      case 'cash': return 'Cash';
      case 'card': return 'Card';
      case 'upi': return 'UPI';
      case 'credit': return 'Credit';
      default: return method.charAt(0).toUpperCase() + method.slice(1);
    }
  }

  getLoyaltyTypeIcon(type: string): string {
    switch (type) {
      case 'earned': return 'add_circle';
      case 'redeemed': return 'redeem';
      case 'adjusted': return 'tune';
      case 'expired': return 'timer_off';
      default: return 'circle';
    }
  }

  getLoyaltyTypeClass(type: string): string {
    switch (type) {
      case 'earned': return 'text-green-600';
      case 'redeemed': return 'text-blue-600';
      case 'adjusted': return 'text-orange-600';
      case 'expired': return 'text-red-500';
      default: return 'text-on-surface-variant';
    }
  }

  getLoyaltyPointsDisplay(tx: LoyaltyTransaction): string {
    const sign = tx.type === 'earned' || (tx.type === 'adjusted' && tx.points > 0) ? '+' : '';
    return `${sign}${tx.points}`;
  }
}
