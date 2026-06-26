import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';

interface AuditRow {
  id: number;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  data: any;
  createdAt: string;
  user?: { firstName: string; lastName: string | null } | null;
}

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-6 max-w-5xl mx-auto">
      <div class="flex items-center gap-3 mb-6">
        <span class="material-symbols-outlined text-2xl text-primary">history</span>
        <div>
          <h1 class="text-xl font-headline font-bold text-on-surface">Audit Log</h1>
          <p class="text-xs font-body text-on-surface-variant">Sensitive operations — refunds, refund-method overrides, commission adjustments.</p>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 mb-4">
        <select [(ngModel)]="entityType" (ngModelChange)="load()"
          class="px-3 py-2 text-sm bg-surface-container-high rounded-lg border border-outline-variant/20 outline-none">
          <option value="">All types</option>
          <option value="return">Return</option>
          <option value="commission">Commission</option>
          <option value="sale">Sale</option>
          <option value="loyalty">Loyalty</option>
        </select>
        <input [(ngModel)]="action" (ngModelChange)="load()" placeholder="Filter action…"
          class="px-3 py-2 text-sm bg-surface-container-high rounded-lg border border-outline-variant/20 outline-none" />
      </div>

      @if (loading) {
        <p class="text-sm text-on-surface-variant py-8 text-center">Loading…</p>
      } @else if (rows.length === 0) {
        <p class="text-sm text-on-surface-variant py-8 text-center">No audit entries.</p>
      } @else {
        <div class="space-y-2">
          @for (r of rows; track r.id) {
            <div class="p-4 rounded-xl bg-surface-container border border-outline-variant/15">
              <div class="flex items-center justify-between gap-3">
                <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  [class]="r.action.includes('override') ? 'bg-amber-500/15 text-amber-500' : 'bg-primary-container/20 text-primary'">
                  {{ r.action }}
                </span>
                <span class="text-[11px] text-on-surface-variant/70">{{ r.createdAt | date: 'dd MMM yyyy, HH:mm' }}</span>
              </div>
              <div class="mt-2 text-xs text-on-surface-variant">
                {{ r.entityType }}<span *ngIf="r.entityId">#{{ r.entityId }}</span>
                <span *ngIf="r.user"> · by {{ r.user.firstName }} {{ r.user.lastName || '' }}</span>
                <span *ngIf="r.reason"> · "{{ r.reason }}"</span>
              </div>
              @if (r.data) {
                <pre class="mt-2 text-[11px] font-mono text-on-surface-variant/80 whitespace-pre-wrap break-all bg-surface-container-lowest/60 rounded-lg p-2">{{ r.data | json }}</pre>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class AuditLogComponent implements OnInit {
  rows: AuditRow[] = [];
  loading = false;
  entityType = '';
  action = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    const params: any = { limit: 50 };
    if (this.entityType) params.entityType = this.entityType;
    if (this.action) params.action = this.action;
    this.api.get<AuditRow[]>('/audit', params).subscribe({
      next: (res: any) => {
        this.rows = res.data || [];
        this.loading = false;
      },
      error: () => {
        this.rows = [];
        this.loading = false;
      },
    });
  }
}
