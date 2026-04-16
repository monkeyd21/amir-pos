import { Component, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { MobileCartService } from './services/mobile-cart.service';
import { MobileScannerService } from './services/mobile-scanner.service';
import { AuthService } from '../../core/services/auth.service';
import { filter } from 'rxjs';

@Component({
  selector: 'app-mobile-pos-shell',
  standalone: true,
  imports: [CommonModule, RouterModule],
  // Styles live in global styles.scss so child screen components inherit them
  template: `
    <div class="mobile-pos-root">
      <router-outlet></router-outlet>

      <!-- Bottom navigation: hidden on auth/scanner screens -->
      @if (showNav) {
        <nav class="mp-bottom-nav">
          <button
            type="button"
            class="mp-bottom-nav__item"
            [class.is-active]="activeTab === 'home'"
            (click)="go('home')"
          >
            <span class="material-symbols-outlined">home</span>
            <span>Home</span>
          </button>
          <button
            type="button"
            class="mp-bottom-nav__item"
            [class.is-active]="activeTab === 'cart'"
            (click)="go('cart')"
          >
            <span class="material-symbols-outlined">shopping_bag</span>
            <span>Cart</span>
            @if (cartCount() > 0) {
              <span class="mp-bottom-nav__badge">{{ cartCount() }}</span>
            }
          </button>
          <button
            type="button"
            class="mp-bottom-nav__item"
            [class.is-active]="activeTab === 'sales'"
            (click)="go('sales')"
          >
            <span class="material-symbols-outlined">receipt_long</span>
            <span>Sales</span>
          </button>
          <button
            type="button"
            class="mp-bottom-nav__item"
            [class.is-active]="activeTab === 'profile'"
            (click)="go('profile')"
          >
            <span class="material-symbols-outlined">settings</span>
            <span>Profile</span>
          </button>
        </nav>
      }
    </div>
  `,
})
export class MobilePosShellComponent implements OnInit {
  activeTab: 'home' | 'cart' | 'sales' | 'profile' | 'other' = 'home';
  showNav = true;

  readonly cartCount = computed(() => this.cart.count());

  constructor(
    public cart: MobileCartService,
    private scanner: MobileScannerService,
    private router: Router,
    private auth: AuthService
  ) {}

  async ngOnInit(): Promise<void> {
    // Immersive status bar — matches the app's dark palette
    if (Capacitor.isNativePlatform()) {
      try {
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: '#0a0e1a' });
      } catch {
        // Non-fatal
      }
      // Warm up the ML Kit scanner module in the background
      this.scanner.prepare();
    }

    // Redirect to login if unauthenticated
    if (!this.auth.getCurrentUser()) {
      this.router.navigate(['/mobile-pos/login']);
    }

    // Track active tab from URL
    this.updateActiveFromUrl(this.router.url);
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.updateActiveFromUrl(e.urlAfterRedirects));
  }

  private updateActiveFromUrl(url: string): void {
    const segments = url.split('?')[0].split('/').filter(Boolean);
    // segments like ['mobile-pos','sales','42'] or ['mobile-pos','home']
    // or ['mobile-pos','sales','42','return']
    const first = segments[1] ?? '';
    const third = segments[3] ?? '';
    if (first === 'login' || first === 'bill' || first === 'checkout' || first === 'success') {
      this.showNav = false;
      this.activeTab = 'other';
      return;
    }
    if (third === 'return' || third === 'exchange') {
      this.showNav = false;
      this.activeTab = 'other';
      return;
    }
    this.showNav = true;
    if (first === 'cart') this.activeTab = 'cart';
    else if (first === 'sales') this.activeTab = 'sales';
    else if (first === 'profile') this.activeTab = 'profile';
    else this.activeTab = 'home';
  }

  go(tab: 'home' | 'cart' | 'sales' | 'profile'): void {
    this.router.navigate(['/mobile-pos', tab]);
  }
}
