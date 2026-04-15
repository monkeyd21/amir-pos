import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { NotificationService } from '../../core/services/notification.service';
import { ApiService } from '../../core/services/api.service';

interface Branch {
  id: number;
  name: string;
  code: string;
  address?: string;
  isActive: boolean;
}

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, PageHeaderComponent],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnInit {
  activeTab = 'general';

  tabs = [
    { id: 'general', label: 'General', icon: 'settings' },
    { id: 'branches', label: 'Branches', icon: 'store' },
    { id: 'users', label: 'Users', icon: 'group' },
    { id: 'integrations', label: 'Integrations', icon: 'extension' },
  ];

  // General settings
  storeName = 'Atelier Fashion';
  storeAddress = '123 Fashion Street, Mumbai, India';
  storePhone = '+91 98765 43210';
  taxRate = 18;
  currency = 'INR';

  // Commission mode
  commissionMode: 'item_level' | 'bill_level' = 'item_level';

  // Loyalty config
  loyalty = {
    amountPerPoint: 100,    // Rs. spent per 1 point earned
    pointsPerAmount: 1,     // points earned per amountPerPoint
    redemptionValue: 1,     // Rs. discount per 1 point redeemed
    minRedeemPoints: 100,   // minimum points balance to be eligible for redemption
    tierThresholds: { silver: 1000, gold: 5000, platinum: 20000 } as Record<string, number>,
    earningMultipliers: { bronze: 1, silver: 1.5, gold: 2, platinum: 3 } as Record<string, number>,
  };
  savingLoyalty = false;

  // Messaging config
  messaging = {
    whatsappEnabled: false,
    whatsappPhoneNumberId: '',
    whatsappAccessToken: '',
    smsEnabled: false,
    smsProvider: 'none',
    smsApiKey: '',
    smsSenderId: '',
  };
  savingMessaging = false;

  // Branches
  branches: Branch[] = [
    { id: 1, name: 'Main Store', code: 'MAIN', address: '123 Fashion Street, Mumbai', isActive: true },
    { id: 2, name: 'Mall Outlet', code: 'MALL', address: '456 Mall Road, Pune', isActive: true },
    { id: 3, name: 'Warehouse', code: 'WH01', address: '789 Industrial Area, Navi Mumbai', isActive: false },
  ];

  constructor(
    private notification: NotificationService,
    private api: ApiService
  ) {}

  ngOnInit(): void {
    this.loadCommissionMode();
    this.loadLoyaltyConfig();
    this.loadMessagingConfig();
  }

  loadLoyaltyConfig(): void {
    this.api.get<any>('/loyalty/config').subscribe({
      next: (res: any) => {
        const c = res.data;
        if (c) {
          this.loyalty = {
            amountPerPoint: Number(c.amountPerPoint ?? 100),
            pointsPerAmount: Number(c.pointsPerAmount ?? 1),
            redemptionValue: Number(c.redemptionValue ?? 1),
            minRedeemPoints: Number(c.minRedeemPoints ?? 100),
            tierThresholds: c.tierThresholds ?? this.loyalty.tierThresholds,
            earningMultipliers: c.earningMultipliers ?? this.loyalty.earningMultipliers,
          };
        }
      },
    });
  }

  saveLoyaltyConfig(): void {
    if (this.savingLoyalty) return;
    this.savingLoyalty = true;
    this.api.put<any>('/loyalty/config', this.loyalty).subscribe({
      next: () => {
        this.savingLoyalty = false;
        this.notification.success('Loyalty config saved');
      },
      error: () => { this.savingLoyalty = false; },
    });
  }

  loadMessagingConfig(): void {
    this.api.get<any>('/settings/messaging').subscribe({
      next: (res: any) => {
        if (res.data) this.messaging = { ...this.messaging, ...res.data };
      },
    });
  }

  saveMessagingConfig(): void {
    if (this.savingMessaging) return;
    this.savingMessaging = true;
    this.api.put<any>('/settings/messaging', this.messaging).subscribe({
      next: () => {
        this.savingMessaging = false;
        this.notification.success('Messaging config saved');
      },
      error: () => {
        this.savingMessaging = false;
      },
    });
  }

  loadCommissionMode(): void {
    this.api.get<any>('/settings/commission-mode').subscribe({
      next: (res: any) => {
        this.commissionMode = res.data?.commissionMode ?? 'item_level';
      },
    });
  }

  setCommissionMode(mode: 'item_level' | 'bill_level'): void {
    this.api.put<any>('/settings/commission-mode', { commissionMode: mode }).subscribe({
      next: () => {
        this.commissionMode = mode;
        this.notification.success(`Commission mode set to ${mode === 'item_level' ? 'Item Level' : 'Bill Level'}`);
      },
    });
  }

  setActiveTab(tabId: string): void {
    this.activeTab = tabId;
  }

  saveGeneral(): void {
    this.notification.success('General settings saved');
  }

  saveBranch(branch: Branch): void {
    this.notification.success(`Branch "${branch.name}" updated`);
  }

  toggleBranchStatus(branch: Branch): void {
    branch.isActive = !branch.isActive;
    this.notification.info(`Branch "${branch.name}" ${branch.isActive ? 'activated' : 'deactivated'}`);
  }
}
