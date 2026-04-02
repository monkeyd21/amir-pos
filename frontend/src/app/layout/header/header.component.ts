import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { AuthService, User } from '../../core/services/auth.service';
import { BranchService, Branch } from '../../core/services/branch.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    MatIconModule,
    MatMenuModule,
    MatButtonModule,
    MatSelectModule,
    MatFormFieldModule,
    MatBadgeModule,
    MatDividerModule,
  ],
  template: `
    <header class="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6">
      <!-- Search -->
      <div class="flex items-center gap-4 flex-1">
        <div class="relative max-w-md w-full">
          <mat-icon class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xl">search</mat-icon>
          <input
            type="text"
            placeholder="Search products, customers, sales..."
            class="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all" />
        </div>
      </div>

      <!-- Right side -->
      <div class="flex items-center gap-3">
        <!-- Branch Selector -->
        <div class="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-lg border border-slate-200 cursor-pointer"
             [matMenuTriggerFor]="branchMenu">
          <mat-icon class="text-slate-500 text-xl">store</mat-icon>
          <span class="text-sm font-medium text-slate-700">
            {{ currentBranch?.name || 'Select Branch' }}
          </span>
          <mat-icon class="text-slate-400 text-lg">arrow_drop_down</mat-icon>
        </div>
        <mat-menu #branchMenu="matMenu">
          <button mat-menu-item *ngFor="let branch of branches"
                  (click)="onBranchSwitch(branch)">
            <mat-icon>store</mat-icon>
            <span>{{ branch.name }}</span>
          </button>
        </mat-menu>

        <!-- Notifications -->
        <button mat-icon-button class="text-slate-500" matBadge="3" matBadgeColor="warn" matBadgeSize="small">
          <mat-icon>notifications_none</mat-icon>
        </button>

        <!-- User Menu -->
        <div class="flex items-center gap-2 cursor-pointer pl-3 border-l border-slate-200"
             [matMenuTriggerFor]="userMenu">
          <div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span class="text-white text-sm font-medium">
              {{ currentUser?.firstName?.charAt(0)?.toUpperCase() || 'U' }}
            </span>
          </div>
          <div class="hidden md:block">
            <p class="text-sm font-medium text-slate-700 leading-tight">{{ (currentUser?.firstName || '') + ' ' + (currentUser?.lastName || '') }}</p>
            <p class="text-xs text-slate-400 leading-tight">{{ currentUser?.role || 'Staff' }}</p>
          </div>
          <mat-icon class="text-slate-400">arrow_drop_down</mat-icon>
        </div>
        <mat-menu #userMenu="matMenu">
          <button mat-menu-item routerLink="/settings/profile">
            <mat-icon>person</mat-icon>
            <span>Profile</span>
          </button>
          <button mat-menu-item routerLink="/settings">
            <mat-icon>settings</mat-icon>
            <span>Settings</span>
          </button>
          <mat-divider></mat-divider>
          <button mat-menu-item (click)="onLogout()">
            <mat-icon>logout</mat-icon>
            <span>Logout</span>
          </button>
        </mat-menu>
      </div>
    </header>
  `,
  styles: [`
    :host {
      display: block;
    }
  `]
})
export class HeaderComponent implements OnInit {
  currentUser: User | null = null;
  currentBranch: Branch | null = null;
  branches: Branch[] = [];

  constructor(
    private authService: AuthService,
    private branchService: BranchService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe((user) => {
      this.currentUser = user;
    });

    this.branchService.currentBranch$.subscribe((branch) => {
      this.currentBranch = branch;
    });

    this.branchService.branches$.subscribe((branches) => {
      this.branches = branches;
    });

    this.branchService.getBranches().subscribe();
  }

  onBranchSwitch(branch: Branch): void {
    this.branchService.switchBranch(branch);
  }

  onLogout(): void {
    this.authService.logout();
  }
}
