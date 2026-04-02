import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CustomerService } from './customer.service';
import { CustomerDialogComponent } from './customer-dialog.component';

@Component({
  selector: 'app-customer-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatTableModule,
    MatChipsModule,
    MatProgressBarModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './customer-detail.component.html',
})
export class CustomerDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private customerService = inject(CustomerService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  customer: any = null;
  purchases: any[] = [];
  loyaltyTransactions: any[] = [];
  loading = true;

  purchaseColumns = ['saleNumber', 'date', 'items', 'total', 'status'];
  loyaltyColumns = ['date', 'type', 'points', 'description'];

  tierThresholds: Record<string, number> = {
    Bronze: 0,
    Silver: 5000,
    Gold: 15000,
    Platinum: 50000,
  };

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      this.loadCustomer(id);
      this.loadPurchaseHistory(id);
      this.loadLoyaltyTransactions(id);
    }
  }

  loadCustomer(id: number): void {
    this.customerService.getById(id).subscribe({
      next: (res) => {
        this.customer = res.data || res;
        this.loading = false;
      },
      error: () => {
        this.snackBar.open('Failed to load customer', 'Close', { duration: 3000 });
        this.loading = false;
      },
    });
  }

  loadPurchaseHistory(id: number): void {
    this.customerService.getPurchaseHistory(id).subscribe({
      next: (res) => (this.purchases = res.data || res || []),
    });
  }

  loadLoyaltyTransactions(id: number): void {
    this.customerService.getLoyaltyTransactions(id).subscribe({
      next: (res) => (this.loyaltyTransactions = res.data || res || []),
    });
  }

  goBack(): void {
    this.router.navigate(['/customers']);
  }

  editCustomer(): void {
    const dialogRef = this.dialog.open(CustomerDialogComponent, {
      width: '500px',
      data: { mode: 'edit', customer: this.customer },
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result) this.loadCustomer(this.customer.id);
    });
  }

  getTierClass(tier: string): string {
    switch (tier?.toLowerCase()) {
      case 'gold': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'silver': return 'bg-slate-200 text-slate-700 border-slate-400';
      case 'platinum': return 'bg-purple-100 text-purple-700 border-purple-300';
      default: return 'bg-orange-100 text-orange-700 border-orange-300';
    }
  }

  getTierProgress(): number {
    if (!this.customer) return 0;
    const tier = this.customer.loyaltyTier || 'Bronze';
    const spent = this.customer.totalSpent || 0;
    const tiers = ['Bronze', 'Silver', 'Gold', 'Platinum'];
    const idx = tiers.indexOf(tier);
    if (idx >= tiers.length - 1) return 100;
    const nextThreshold = this.tierThresholds[tiers[idx + 1]];
    const currentThreshold = this.tierThresholds[tier];
    return Math.min(100, ((spent - currentThreshold) / (nextThreshold - currentThreshold)) * 100);
  }

  getNextTier(): string {
    const tier = this.customer?.loyaltyTier || 'Bronze';
    const tiers = ['Bronze', 'Silver', 'Gold', 'Platinum'];
    const idx = tiers.indexOf(tier);
    return idx < tiers.length - 1 ? tiers[idx + 1] : 'Max';
  }
}
