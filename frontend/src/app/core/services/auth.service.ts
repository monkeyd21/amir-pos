import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap, map } from 'rxjs';
import { ApiService } from './api.service';

export interface User {
  id: number;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  branchId?: number;
  phone?: string;
}

export interface ApiAuthResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
    user: User;
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private currentUserSubject = new BehaviorSubject<User | null>(this.getStoredUser());
  currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private api: ApiService,
    private router: Router
  ) {}

  login(email: string, password: string, rememberMe = false): Observable<ApiAuthResponse> {
    return this.api.post<ApiAuthResponse>('/auth/login', { email, password }).pipe(
      tap((response) => {
        const { accessToken, refreshToken, user } = response.data;
        this.storeTokens(accessToken, refreshToken);
        this.storeUser(user);
        this.currentUserSubject.next(user);
        if (rememberMe) {
          localStorage.setItem('rememberMe', 'true');
        }
      })
    );
  }

  logout(): void {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('rememberMe');
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  refreshToken(): Observable<ApiAuthResponse> {
    const refreshToken = localStorage.getItem('refreshToken');
    return this.api.post<ApiAuthResponse>('/auth/refresh', { refreshToken }).pipe(
      tap((response) => {
        const { accessToken, refreshToken: newToken, user } = response.data;
        this.storeTokens(accessToken, newToken);
        this.storeUser(user);
        this.currentUserSubject.next(user);
      })
    );
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  isAuthenticated(): boolean {
    const token = localStorage.getItem('accessToken');
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  getToken(): string | null {
    return localStorage.getItem('accessToken');
  }

  hasRole(roles: string[]): boolean {
    const user = this.getCurrentUser();
    return user ? roles.includes(user.role) : false;
  }

  isLoggedIn$(): Observable<boolean> {
    return this.currentUser$.pipe(map((user) => !!user));
  }

  private storeTokens(accessToken: string, refreshToken: string): void {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  }

  private storeUser(user: User): void {
    localStorage.setItem('currentUser', JSON.stringify(user));
  }

  private getStoredUser(): User | null {
    const stored = localStorage.getItem('currentUser');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  }
}
