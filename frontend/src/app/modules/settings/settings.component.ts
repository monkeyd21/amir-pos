import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { NotificationService } from '../../core/services/notification.service';

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

  // Branches
  branches: Branch[] = [
    { id: 1, name: 'Main Store', code: 'MAIN', address: '123 Fashion Street, Mumbai', isActive: true },
    { id: 2, name: 'Mall Outlet', code: 'MALL', address: '456 Mall Road, Pune', isActive: true },
    { id: 3, name: 'Warehouse', code: 'WH01', address: '789 Industrial Area, Navi Mumbai', isActive: false },
  ];

  constructor(private notification: NotificationService) {}

  ngOnInit(): void {}

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
