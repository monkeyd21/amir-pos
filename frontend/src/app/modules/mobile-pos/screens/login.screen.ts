import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-mobile-login-screen',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="mobile-pos-root">
      <div class="mp-screen mp-screen--no-nav login-screen">
        <div class="login-inner">
          <div class="brand">
            <div class="brand__logo">
              <span class="brand__logo-icon material-icons">point_of_sale</span>
            </div>
            <h1 class="brand__name">Atelier POS</h1>
            <p class="brand__tagline">Sign in to start selling</p>
          </div>

          <form class="login-form" (ngSubmit)="submit()" autocomplete="on">
            <label class="field">
              <span class="field__label">Email</span>
              <input
                class="mp-input"
                type="email"
                name="email"
                inputmode="email"
                autocomplete="email"
                autocapitalize="off"
                autocorrect="off"
                spellcheck="false"
                placeholder="you@example.com"
                [(ngModel)]="email"
                [disabled]="loading"
                required
              />
            </label>

            <label class="field">
              <span class="field__label">Password</span>
              <input
                class="mp-input"
                type="password"
                name="password"
                autocomplete="current-password"
                placeholder="Your password"
                [(ngModel)]="password"
                [disabled]="loading"
                required
              />
            </label>

            <button
              type="submit"
              class="mp-btn mp-btn--primary mp-btn--block mp-btn--lg"
              [disabled]="loading || !email || !password"
            >
              @if (loading) {
                <span class="spinner" aria-hidden="true"></span>
                <span>Signing in&hellip;</span>
              } @else {
                <span>Sign In</span>
              }
            </button>

            @if (error) {
              <div class="error-card" role="alert">
                <span class="error-card__icon material-icons">error_outline</span>
                <span>{{ error }}</span>
              </div>
            }
          </form>

          <p class="hint">Default: admin&#64;clothingerp.com / admin123</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .login-screen {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 20px;
    }

    .login-inner {
      width: 100%;
      max-width: 420px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }

    .brand {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 12px;
      margin-top: 24px;
    }

    .brand__logo {
      width: 96px;
      height: 96px;
      border-radius: 28px;
      background: var(--mp-primary-soft);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--mp-primary);
      box-shadow: 0 8px 32px -8px rgba(107, 138, 253, 0.45);
    }

    .brand__logo-icon {
      font-size: 52px;
      width: 52px;
      height: 52px;
      line-height: 52px;
    }

    .brand__name {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin: 0;
      color: var(--mp-on-bg);
    }

    .brand__tagline {
      margin: 0;
      color: var(--mp-on-bg-muted);
      font-size: 15px;
    }

    .login-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .field__label {
      font-size: 13px;
      font-weight: 600;
      color: var(--mp-on-bg-muted);
      padding-left: 4px;
      letter-spacing: 0.01em;
    }

    .error-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 14px;
      background: var(--mp-error-soft);
      color: var(--mp-error);
      font-size: 14px;
      font-weight: 500;
      border: 1px solid rgba(248, 113, 113, 0.25);
    }

    .error-card__icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      line-height: 20px;
      flex-shrink: 0;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border: 2.5px solid rgba(255, 255, 255, 0.35);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: mp-spin 0.7s linear infinite;
    }

    @keyframes mp-spin {
      to { transform: rotate(360deg); }
    }

    .hint {
      text-align: center;
      color: var(--mp-on-bg-faint);
      font-size: 12px;
      margin: 0;
      font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    }
  `],
})
export class MobileLoginScreen {
  private auth = inject(AuthService);
  private router = inject(Router);

  email = '';
  password = '';
  loading = false;
  error = '';

  submit(): void {
    if (this.loading || !this.email || !this.password) {
      return;
    }

    this.error = '';
    this.loading = true;

    this.auth.login(this.email.trim(), this.password).subscribe({
      next: () => {
        this.loading = false;
        this.router.navigate(['/mobile-pos/home']);
      },
      error: (err) => {
        this.loading = false;
        this.error =
          err?.error?.error ||
          err?.error?.message ||
          err?.message ||
          'Sign in failed. Check your credentials and try again.';
      },
    });
  }
}
