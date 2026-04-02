import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

export interface Breadcrumb {
  label: string;
  route?: string;
}

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule, RouterModule, MatIconModule, MatButtonModule],
  template: `
    <div class="mb-6">
      <!-- Breadcrumbs -->
      <nav *ngIf="breadcrumbs.length > 0" class="flex items-center gap-1 text-sm text-slate-400 mb-2">
        <a routerLink="/dashboard" class="hover:text-slate-600 transition-colors">
          <mat-icon class="text-base">home</mat-icon>
        </a>
        <ng-container *ngFor="let crumb of breadcrumbs; let last = last">
          <mat-icon class="text-base">chevron_right</mat-icon>
          <a *ngIf="crumb.route && !last"
             [routerLink]="crumb.route"
             class="hover:text-slate-600 transition-colors">
            {{ crumb.label }}
          </a>
          <span *ngIf="!crumb.route || last" class="text-slate-600">{{ crumb.label }}</span>
        </ng-container>
      </nav>

      <!-- Title & Actions -->
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-slate-800">{{ title }}</h1>
          <p *ngIf="subtitle" class="text-sm text-slate-500 mt-1">{{ subtitle }}</p>
        </div>
        <div class="flex items-center gap-3">
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
})
export class PageHeaderComponent {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() breadcrumbs: Breadcrumb[] = [];
}
