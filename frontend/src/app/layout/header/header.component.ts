import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
})
export class HeaderComponent implements OnInit, OnDestroy {
  userName = '';
  userRole = '';
  initials = '';
  showUserMenu = false;

  private destroy$ = new Subject<void>();
  private themeService = inject(ThemeService);
  readonly themeMode = this.themeService.mode;

  constructor(private authService: AuthService) {}

  ngOnInit(): void {
    this.authService.currentUser$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      if (user) {
        this.userName = `${user.firstName} ${user.lastName}`;
        this.userRole = this.formatRole(user.role);
        this.initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
      }
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleUserMenu(): void {
    this.showUserMenu = !this.showUserMenu;
  }

  closeUserMenu(): void {
    this.showUserMenu = false;
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  logout(): void {
    this.authService.logout();
  }

  private formatRole(role: string): string {
    return role
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}
