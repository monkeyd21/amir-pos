import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { Subject, takeUntil, catchError, of } from 'rxjs';
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
                  (click)="onBranchSwitch(branch)"
                  [class.bg-blue-50]="currentBranch?.id === branch.id">
            <mat-icon>{{ currentBranch?.id === branch.id ? 'check_circle' : 'store' }}</mat-icon>
            <span>{{ branch.name }}</span>
          </button>
          <button mat-menu-item *ngIf="branchLoadError" (click)="loadBranches()" class="text-slate-400">
            <mat-icon>refresh</mat-icon>
            <span>Retry loading branches</span>
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
    .mat-mdc-icon-button.mat-mdc-button-base {
      width: 40px;
      height: 40px;
      padding: 8px;
    }
  `]
})
export class HeaderComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  currentBranch: Branch | null = null;
  branches: Branch[] = [];
  branchLoadError = false;
  private destroy$ = new Subject<void>();

  constructor(
    private authService: AuthService,
    private branchService: BranchService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.pipe(
      takeUntil(this.destroy$)
    ).subscribe((user) => {
      this.currentUser = user;
    });

    this.branchService.currentBranch$.pipe(
      takeUntil(this.destroy$)
    ).subscribe((branch) => {
      this.currentBranch = branch;
    });

    this.branchService.branches$.pipe(
      takeUntil(this.destroy$)
    ).subscribe((branches) => {
      this.branches = branches;
      // Auto-select first branch if none selected
      if (!this.currentBranch && branches.length > 0) {
        this.branchService.switchBranch(branches[0]);
      }
    });

    this.loadBranches();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadBranches(): void {
    this.branchLoadError = false;
    this.branchService.getBranches().pipe(
      catchError(() => {
        this.branchLoadError = true;
        // Provide fallback branches when API is unavailable
        const fallback: Branch[] = [
          { id: '1', name: 'Main Store', code: 'MAIN', isActive: true },
        ];
        return of(fallback);
      }),
      takeUntil(this.destroy$)
    ).subscribe((branches) => {
      if (this.branchLoadError && branches.length > 0) {
        // Manually update subjects with fallback data if API failed
        // The BranchService tap handler won't fire on our fallback `of()`,
        // so we set branches directly here
        this.branches = branches;
        if (!this.currentBranch) {
          this.branchService.switchBranch(branches[0]);
        }
      }
    });
  }

  onBranchSwitch(branch: Branch): void {
    this.branchService.switchBranch(branch);
  }

  onLogout(): void {
    this.authService.logout();
  }
}
