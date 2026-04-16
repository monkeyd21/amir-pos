import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService, User } from '../../../core/services/auth.service';

interface PosSession {
  id: number;
  openedAt?: string;
  openingAmount?: number;
  status?: string;
  [key: string]: unknown;
}

interface SessionResponse {
  success: boolean;
  data: PosSession | null;
}

interface CloseResponse {
  success: boolean;
  data?: unknown;
}

@Component({
  selector: 'app-mobile-profile-screen',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen">
        <header class="mp-header">
          <div class="mp-header__title">Profile</div>
        </header>

        <div class="content">
          @if (user(); as u) {
            <div class="mp-card user-card">
              <div class="avatar avatar--lg">{{ initialsOf(u) }}</div>
              <div class="user-card__name">
                {{ u.firstName }} {{ u.lastName }}
              </div>
              <div class="user-card__role">{{ capitalize(u.role) }}</div>
              <div class="user-card__email">{{ u.email }}</div>
            </div>
          }

          <section class="section">
            <h2 class="section__title">POS Session</h2>
            <div class="mp-card session-card">
              @if (sessionLoading()) {
                <div class="session-loading">
                  <span class="spinner"></span>
                  <span>Checking session&hellip;</span>
                </div>
              } @else if (session()) {
                <div class="session-top">
                  <div class="session-info">
                    <div class="session-row">
                      <span class="mp-chip chip-active">Active</span>
                      <span class="session-id">Session #{{ session()?.id }}</span>
                    </div>
                    @if (session()?.openedAt) {
                      <div class="session-sub">
                        Opened {{ formatDateTime(session()?.openedAt || '') }}
                      </div>
                    }
                  </div>
                </div>

                <button
                  type="button"
                  class="mp-btn mp-btn--danger mp-btn--block"
                  [disabled]="closing()"
                  (click)="closeSession()"
                >
                  @if (closing()) {
                    <span class="spinner"></span>
                    <span>Closing&hellip;</span>
                  } @else {
                    <span class="material-icons">lock</span>
                    <span>Close Session</span>
                  }
                </button>

                @if (closeError()) {
                  <div class="inline-error">{{ closeError() }}</div>
                }
              } @else {
                <div class="session-empty">
                  <span class="material-icons">lock_open</span>
                  <span>No active session</span>
                </div>
              }
            </div>
          </section>

          <section class="section">
            <h2 class="section__title">Account</h2>
            <div class="mp-card list-card">
              <div class="row-item">
                <span class="row-link__icon-wrap">
                  <span class="material-icons">info</span>
                </span>
                <div class="row-link__body">
                  <div class="row-link__label">About</div>
                  <div class="row-link__hint">Atelier POS v1.0</div>
                </div>
              </div>
            </div>
            <button
              type="button"
              class="mp-btn mp-btn--danger mp-btn--block"
              (click)="logout()"
            >
              <span class="material-icons">logout</span>
              <span>Log Out</span>
            </button>
          </section>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .content {
      padding: 16px 20px 32px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .user-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 6px;
      padding: 28px 20px;
    }

    .user-card__name {
      font-size: 22px;
      font-weight: 700;
      color: var(--mp-on-bg);
      margin-top: 6px;
      letter-spacing: -0.01em;
    }

    .user-card__role {
      color: var(--mp-primary);
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .user-card__email {
      color: var(--mp-on-bg-muted);
      font-size: 14px;
    }

    .avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--mp-primary-soft);
      color: var(--mp-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 15px;
      flex-shrink: 0;
      letter-spacing: 0.02em;
    }

    .avatar--lg {
      width: 84px;
      height: 84px;
      font-size: 30px;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .section__title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--mp-on-bg-muted);
      margin: 0 4px 2px;
    }

    .session-card {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .session-top {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .session-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .session-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .session-id {
      font-weight: 600;
      color: var(--mp-on-bg);
      font-size: 15px;
      font-variant-numeric: tabular-nums;
    }

    .session-sub {
      color: var(--mp-on-bg-muted);
      font-size: 13px;
    }

    .chip-active {
      background: var(--mp-success-soft);
      color: var(--mp-success);
    }

    .session-empty {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--mp-on-bg-muted);
      font-size: 14px;
      padding: 4px 2px;
    }

    .session-empty .material-icons {
      font-size: 20px;
    }

    .session-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--mp-on-bg-muted);
      font-size: 14px;
    }

    .inline-error {
      color: var(--mp-error);
      font-size: 13px;
      padding: 0 4px;
    }

    .list-card {
      padding: 4px;
    }

    .row-link, .row-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 14px;
      border-radius: 14px;
      color: var(--mp-on-bg);
      text-decoration: none;
    }

    .row-link {
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .row-link:active {
      background: var(--mp-surface-2);
    }

    .row-link__icon-wrap {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: var(--mp-surface-2);
      color: var(--mp-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .row-link__icon-wrap .material-icons {
      font-size: 22px;
    }

    .row-link__body {
      flex: 1;
      min-width: 0;
    }

    .row-link__label {
      font-size: 15px;
      font-weight: 600;
      color: var(--mp-on-bg);
    }

    .row-link__hint {
      font-size: 12px;
      color: var(--mp-on-bg-muted);
      margin-top: 2px;
    }

    .row-link__chevron {
      color: var(--mp-on-bg-faint);
      font-size: 22px;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2.5px solid rgba(255, 255, 255, 0.15);
      border-top-color: var(--mp-error);
      border-radius: 50%;
      animation: mp-spin 0.7s linear infinite;
    }

    @keyframes mp-spin { to { transform: rotate(360deg); } }
  `],
})
export class MobileProfileScreen implements OnInit {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly user = signal<User | null>(null);
  readonly session = signal<PosSession | null>(null);
  readonly sessionLoading = signal(true);
  readonly closing = signal(false);
  readonly closeError = signal('');

  ngOnInit(): void {
    this.user.set(this.auth.getCurrentUser());
    this.loadSession();
  }

  private loadSession(): void {
    this.sessionLoading.set(true);
    this.api.get<SessionResponse>('/pos/sessions/current').subscribe({
      next: (response) => {
        this.sessionLoading.set(false);
        this.session.set(response?.data ?? null);
      },
      error: () => {
        this.sessionLoading.set(false);
        this.session.set(null);
      },
    });
  }

  closeSession(): void {
    if (this.closing()) return;
    const ok = window.confirm(
      'Close the current POS session? You will need to open a new session to continue selling.'
    );
    if (!ok) return;

    this.closing.set(true);
    this.closeError.set('');

    this.api
      .post<CloseResponse>('/pos/sessions/close', { closingAmount: 0 })
      .subscribe({
        next: () => {
          this.closing.set(false);
          this.session.set(null);
          this.router.navigate(['/mobile-pos/home']);
        },
        error: (err) => {
          this.closing.set(false);
          this.closeError.set(
            err?.error?.error ||
              err?.error?.message ||
              err?.message ||
              'Failed to close session'
          );
        },
      });
  }

  logout(): void {
    const ok = window.confirm('Log out of Atelier POS?');
    if (!ok) return;
    this.auth.logout();
    this.router.navigate(['/mobile-pos/login']);
  }

  initialsOf(u: { firstName?: string; lastName?: string }): string {
    const f = (u.firstName || '').trim();
    const l = (u.lastName || '').trim();
    return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || '?';
  }

  capitalize(value: string): string {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  formatDateTime(iso: string): string {
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return '';
    }
  }
}
