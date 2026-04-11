import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { NotificationService } from '../../../core/services/notification.service';
import { PageHeaderComponent } from '../../../shared/page-header/page-header.component';
import { ApiResponse, PrinterProfile } from './types';

/**
 * List all printer profiles for the current branch, with quick actions for
 * test-print, set-default, edit, and delete. The "Find Printers" button
 * kicks off the discovery wizard.
 */
@Component({
  selector: 'app-printers-list',
  standalone: true,
  imports: [CommonModule, RouterLink, PageHeaderComponent],
  template: `
    <div class="p-6 lg:p-8">
      <app-page-header
        title="Printers & Labels"
        subtitle="Configure barcode label printers for this branch. Each printer can have its own label templates."
      >
        <div class="flex items-center gap-2">
          <a
            routerLink="/settings/printers/discover"
            class="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold font-body bg-surface-container-high text-on-surface rounded-lg hover:bg-surface-container-highest transition-all"
          >
            <span class="material-symbols-outlined text-lg">search</span>
            Find Printers
          </a>
          <a
            routerLink="/settings/printers/new"
            class="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold font-body bg-gradient-cta text-white rounded-lg hover:shadow-glow-sm transition-all"
          >
            <span class="material-symbols-outlined text-lg">add</span>
            Add Printer
          </a>
        </div>
      </app-page-header>

      @if (loading) {
        <div class="flex items-center justify-center py-16">
          <div class="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
        </div>
      } @else if (profiles.length === 0) {
        <div class="bg-surface-container rounded-xl p-12 text-center">
          <div class="flex items-center justify-center w-16 h-16 rounded-2xl bg-surface-container-high/50 mb-5 mx-auto">
            <span class="material-symbols-outlined text-3xl text-on-surface-variant/50">print_disabled</span>
          </div>
          <h3 class="text-lg font-headline font-semibold text-on-surface/70">No printers configured</h3>
          <p class="mt-2 text-sm font-body text-on-surface-variant/60 max-w-sm mx-auto">
            Click <strong>Find Printers</strong> to auto-detect printers on this machine or on your local network.
          </p>
        </div>
      } @else {
        <div class="space-y-3">
          @for (profile of profiles; track profile.id) {
            <div class="bg-surface-container rounded-xl p-5 flex items-start gap-4">
              <div class="flex items-center justify-center w-12 h-12 rounded-lg bg-primary-container/20 shrink-0">
                <span class="material-symbols-outlined text-2xl text-primary">print</span>
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <h3 class="text-base font-headline font-bold text-on-surface truncate">{{ profile.name }}</h3>
                  @if (profile.isDefault) {
                    <span class="px-2 py-0.5 text-[10px] font-bold font-mono bg-primary-container/30 text-primary rounded uppercase">Default</span>
                  }
                  @if (!profile.isActive) {
                    <span class="px-2 py-0.5 text-[10px] font-bold font-mono bg-red-500/10 text-red-400 rounded uppercase">Inactive</span>
                  }
                </div>
                <p class="text-sm font-body text-on-surface-variant">
                  <span class="font-semibold">{{ profile.vendor }}</span>
                  @if (profile.model) { {{ profile.model }} }
                  &middot; {{ profile.driver.toUpperCase() }} driver &middot; {{ profile.transport }}
                </p>
                <div class="mt-1 text-xs font-mono text-on-surface-variant/70 space-y-0.5">
                  <div>{{ profile.dpi }} DPI &middot; {{ profile.maxWidthMm }} mm max</div>
                  <div>
                    @if (profile.connection.host) { {{ profile.connection.host }}:{{ profile.connection.port ?? 9100 }} }
                    @if (profile.connection.devicePath) { {{ profile.connection.devicePath }} }
                    @if (profile.connection.queueName) { Queue: {{ profile.connection.queueName }} }
                  </div>
                </div>

                <!-- Templates -->
                @if (profile.templates && profile.templates.length > 0) {
                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <span class="text-[10px] font-body text-on-surface-variant uppercase tracking-wider">Templates:</span>
                    @for (t of profile.templates; track t.id) {
                      <a
                        [routerLink]="['/settings/printers', profile.id, 'designer', t.id]"
                        class="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-body bg-surface-container-high rounded hover:bg-primary-container/20 hover:text-primary transition-colors"
                      >
                        <span class="material-symbols-outlined text-sm">qr_code_2</span>
                        {{ t.name }}
                        <span class="text-on-surface-variant/60 font-mono">{{ t.widthMm }}×{{ t.heightMm }}mm</span>
                        @if (t.isDefault) { <span class="text-primary">&bull;</span> }
                      </a>
                    }
                  </div>
                }
              </div>

              <div class="flex items-center gap-1 shrink-0">
                <button
                  (click)="testPrint(profile)"
                  [disabled]="testingId === profile.id"
                  class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary-container/20 transition-all cursor-pointer disabled:opacity-40"
                  title="Send a test label"
                >
                  @if (testingId === profile.id) {
                    <div class="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                  } @else {
                    <span class="material-symbols-outlined text-lg">play_arrow</span>
                  }
                </button>
                @if (!profile.isDefault) {
                  <button
                    (click)="setDefault(profile)"
                    class="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-primary-container/20 transition-all cursor-pointer"
                    title="Set as default for this branch"
                  >
                    <span class="material-symbols-outlined text-lg">star</span>
                  </button>
                }
                <a
                  [routerLink]="['/settings/printers', profile.id, 'edit']"
                  class="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-all"
                  title="Edit"
                >
                  <span class="material-symbols-outlined text-lg">edit</span>
                </a>
                <button
                  (click)="deleteProfile(profile)"
                  class="p-2 rounded-lg text-on-surface-variant hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
                  title="Delete"
                >
                  <span class="material-symbols-outlined text-lg">delete</span>
                </button>
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PrintersListComponent implements OnInit {
  profiles: PrinterProfile[] = [];
  loading = false;
  testingId: number | null = null;

  constructor(
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.get<ApiResponse<PrinterProfile[]>>('/printing/profiles').subscribe({
      next: (res) => {
        this.profiles = res.data;
        this.loading = false;
      },
      error: () => (this.loading = false),
    });
  }

  testPrint(profile: PrinterProfile): void {
    this.testingId = profile.id;
    this.api.post<ApiResponse<unknown>>(`/printing/profiles/${profile.id}/test`, {}).subscribe({
      next: () => {
        this.notification.success(`Test label sent to ${profile.name}`);
        this.testingId = null;
      },
      error: () => (this.testingId = null),
    });
  }

  setDefault(profile: PrinterProfile): void {
    this.api
      .put<ApiResponse<PrinterProfile>>(`/printing/profiles/${profile.id}/default`, {})
      .subscribe({
        next: () => {
          this.notification.success(`${profile.name} set as default`);
          this.load();
        },
      });
  }

  deleteProfile(profile: PrinterProfile): void {
    if (!confirm(`Delete printer "${profile.name}"? Templates associated with it will also be deleted.`)) return;
    this.api.delete<ApiResponse<unknown>>(`/printing/profiles/${profile.id}`).subscribe({
      next: () => {
        this.notification.success('Printer deleted');
        this.load();
      },
    });
  }
}
