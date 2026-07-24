import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { NotificationService } from '../../core/services/notification.service';
import { ApiService } from '../../core/services/api.service';
import { BranchService } from '../../core/services/branch.service';

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
    { id: 'payments', label: 'Payments', icon: 'credit_card' },
    { id: 'users', label: 'Users', icon: 'group' },
    { id: 'integrations', label: 'Integrations', icon: 'extension' },
  ];

  // §2.1/2.2 — Card & UPI payment accounts (bank/gateway list + default).
  paymentAccounts: { card: { name: string; isDefault: boolean }[]; upi: { name: string; isDefault: boolean }[] } = { card: [], upi: [] };
  newAccountName: { card: string; upi: string } = { card: '', upi: '' };
  savingAccounts = false;

  loadPaymentAccounts(): void {
    this.api.get<any>('/settings/payment-accounts').subscribe({
      next: (res) => {
        if (res?.data) this.paymentAccounts = { card: res.data.card || [], upi: res.data.upi || [] };
      },
      error: () => {},
    });
  }

  addPaymentAccount(mode: 'card' | 'upi'): void {
    const name = this.newAccountName[mode].trim();
    if (!name) return;
    const list = this.paymentAccounts[mode];
    list.push({ name, isDefault: list.length === 0 });
    this.newAccountName[mode] = '';
    this.savePaymentAccounts();
  }

  removePaymentAccount(mode: 'card' | 'upi', i: number): void {
    this.paymentAccounts[mode].splice(i, 1);
    this.savePaymentAccounts();
  }

  setDefaultAccount(mode: 'card' | 'upi', i: number): void {
    this.paymentAccounts[mode].forEach((a, idx) => (a.isDefault = idx === i));
    this.savePaymentAccounts();
  }

  savePaymentAccounts(): void {
    this.savingAccounts = true;
    this.api.put<any>('/settings/payment-accounts', this.paymentAccounts).subscribe({
      next: (res) => {
        if (res?.data) this.paymentAccounts = { card: res.data.card || [], upi: res.data.upi || [] };
        this.savingAccounts = false;
      },
      error: () => (this.savingAccounts = false),
    });
  }

  // General settings — "Store Information" IS the branch record the printed
  // receipt reads (name / address / phone / receiptHeader / receiptFooter).
  // Loaded from and saved to the current branch via the branches API in
  // loadStoreInfo() / saveGeneral(). Blank until loaded so stale placeholders
  // never flash on screen or get saved over real data.
  storeName = '';
  storeAddress = '';
  storePhone = '';
  storeReceiptHeader = '';
  storeReceiptFooter = '';
  currentBranchId: number | null = null;
  savingGeneral = false;
  taxRate = 18;
  currency = 'INR';

  // §tax — account-level GST master switch. OFF = no tax charged or shown.
  taxEnabled = false;
  savingTaxEnabled = false;

  // Commission mode
  commissionMode: 'item_level' | 'bill_level' = 'item_level';

  // Bill numbering — per-channel prefixes for human-friendly sale numbers
  billNumbering = { walkin: 'W', online: 'O', pad: 4 };
  savingBillNumbering = false;

  // Bug#2 — refund/return window in days (default 15).
  returnWindowDays = 15;
  savingReturnWindow = false;

  // §8.3 — EOD variance threshold (₹). One value applied to Cash/UPI/Card alike.
  varianceThreshold = 50;
  savingVarianceThreshold = false;

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
    private api: ApiService,
    private branchService: BranchService
  ) {}

  ngOnInit(): void {
    this.loadStoreInfo();
    this.loadCommissionMode();
    this.loadLoyaltyConfig();
    this.loadMessagingConfig();
    this.loadBillNumbering();
    this.loadPaymentAccounts();
    this.loadReturnWindow();
    this.loadVarianceThreshold();
    this.loadTaxEnabled();
  }

  loadTaxEnabled(): void {
    this.api.get<any>('/settings/gst-compliance').subscribe({
      next: (res) => {
        if (res.data?.enabled != null) this.taxEnabled = res.data.enabled;
      },
      error: () => {},
    });
  }

  saveTaxEnabled(): void {
    if (this.savingTaxEnabled) return;
    this.savingTaxEnabled = true;
    this.api.put<any>('/settings/gst-compliance', { enabled: this.taxEnabled }).subscribe({
      next: () => {
        this.savingTaxEnabled = false;
        this.notification.success(`Taxes ${this.taxEnabled ? 'enabled' : 'disabled'}`);
      },
      error: (err) => {
        this.savingTaxEnabled = false;
        this.taxEnabled = !this.taxEnabled; // revert optimistic toggle on failure
        this.notification.error(err.error?.error || 'Failed to update tax setting');
      },
    });
  }

  loadReturnWindow(): void {
    this.api.get<any>('/settings/return-window').subscribe({
      next: (res) => {
        if (res.data?.returnWindowDays != null) this.returnWindowDays = res.data.returnWindowDays;
      },
      error: () => {},
    });
  }

  saveReturnWindow(): void {
    if (this.savingReturnWindow) return;
    this.savingReturnWindow = true;
    this.api.put<any>('/settings/return-window', { returnWindowDays: Number(this.returnWindowDays) }).subscribe({
      next: () => {
        this.savingReturnWindow = false;
        this.notification.success('Return window updated');
      },
      error: (err) => {
        this.savingReturnWindow = false;
        this.notification.error(err.error?.error || 'Failed to update return window');
      },
    });
  }

  loadVarianceThreshold(): void {
    this.api.get<any>('/settings/variance-threshold').subscribe({
      next: (res) => {
        if (res.data?.varianceThreshold != null) this.varianceThreshold = res.data.varianceThreshold;
      },
      error: () => {},
    });
  }

  saveVarianceThreshold(): void {
    if (this.savingVarianceThreshold) return;
    this.savingVarianceThreshold = true;
    this.api.put<any>('/settings/variance-threshold', { varianceThreshold: Number(this.varianceThreshold) }).subscribe({
      next: () => {
        this.savingVarianceThreshold = false;
        this.notification.success('Variance threshold updated');
      },
      error: (err) => {
        this.savingVarianceThreshold = false;
        this.notification.error(err.error?.error || 'Failed to update variance threshold');
      },
    });
  }

  loadBillNumbering(): void {
    this.api.get<any>('/settings/bill-numbering').subscribe({
      next: (res) => {
        if (res.data) this.billNumbering = { ...this.billNumbering, ...res.data };
      },
      error: () => {},
    });
  }

  saveBillNumbering(): void {
    this.savingBillNumbering = true;
    this.api.put<any>('/settings/bill-numbering', this.billNumbering).subscribe({
      next: (res) => {
        if (res.data) this.billNumbering = { ...this.billNumbering, ...res.data };
        this.savingBillNumbering = false;
        this.notification.success('Bill numbering saved');
      },
      error: (err) => {
        this.savingBillNumbering = false;
        this.notification.error(err.error?.error || 'Failed to save bill numbering');
      },
    });
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

  /** Load the current branch's store details into the General form. */
  loadStoreInfo(): void {
    this.api.get<any>('/branches').subscribe({
      next: (res) => {
        const list: any[] = res?.data || res || [];
        if (!list.length) return;
        // Prefer the branch the user is operating in; fall back to the first.
        const curId = this.branchService.getCurrentBranch()?.id;
        const b = list.find((x) => String(x.id) === String(curId)) || list[0];
        this.currentBranchId = b.id;
        this.storeName = b.name || '';
        this.storeAddress = b.address || '';
        this.storePhone = b.phone || '';
        this.storeReceiptHeader = b.receiptHeader || '';
        this.storeReceiptFooter = b.receiptFooter || '';
      },
      error: () => {},
    });
  }

  saveGeneral(): void {
    if (this.savingGeneral) return;
    if (this.currentBranchId == null) {
      this.notification.error('Store details are still loading — try again in a moment');
      return;
    }
    const name = this.storeName.trim();
    if (!name) {
      this.notification.error('Store name is required');
      return;
    }
    this.savingGeneral = true;
    // Persist to the branch record the receipt reads. Empty strings are sent as
    // null (the API accepts nullable) so a cleared field actually clears.
    const payload = {
      name,
      address: this.storeAddress.trim() || null,
      phone: this.storePhone.trim() || null,
      receiptHeader: this.storeReceiptHeader.trim() || null,
      receiptFooter: this.storeReceiptFooter.trim() || null,
    };
    this.api.put<any>(`/branches/${this.currentBranchId}`, payload).subscribe({
      next: () => {
        this.savingGeneral = false;
        this.notification.success('Store details saved');
      },
      error: (err) => {
        this.savingGeneral = false;
        this.notification.error(err.error?.error || 'Failed to save store details');
      },
    });
  }

  saveBranch(branch: Branch): void {
    this.notification.success(`Branch "${branch.name}" updated`);
  }

  toggleBranchStatus(branch: Branch): void {
    branch.isActive = !branch.isActive;
    this.notification.info(`Branch "${branch.name}" ${branch.isActive ? 'activated' : 'deactivated'}`);
  }
}
