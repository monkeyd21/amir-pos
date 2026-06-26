import {
  HttpInterceptorFn,
  HttpClient,
  HttpErrorResponse,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { ReplaySubject, throwError, take, switchMap, catchError } from 'rxjs';
import { environment } from '../../../environments/environment';

interface RefreshResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    user?: unknown;
  };
}

// Module-level state so concurrent 401s share ONE refresh round-trip. A
// ReplaySubject(1) replays the new token to late subscribers too, so a burst of
// parallel 401s (e.g. a dashboard's many requests when the token just expired)
// can't have some requests miss the emission and stall/log out. Reset to null
// once settled so the next expiry triggers a fresh refresh.
let refresh$: ReplaySubject<string> | null = null;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const http = inject(HttpClient);

  return next(attachAuth(req)).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) return throwError(() => err);
      // Don't try to refresh on auth endpoints themselves — login failures
      // and refresh-token rejections must surface to the user as 401s.
      if (req.url.includes('/auth/login') || req.url.includes('/auth/refresh')) {
        return throwError(() => err);
      }
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return throwError(() => err);

      if (!refresh$) {
        const subject = new ReplaySubject<string>(1);
        refresh$ = subject;
        http
          .post<RefreshResponse>(`${environment.apiUrl}/auth/refresh`, { refreshToken })
          .subscribe({
            next: (res) => {
              localStorage.setItem('accessToken', res.data.accessToken);
              localStorage.setItem('refreshToken', res.data.refreshToken);
              if (res.data.user) {
                localStorage.setItem('currentUser', JSON.stringify(res.data.user));
              }
              subject.next(res.data.accessToken);
              subject.complete();
              refresh$ = null;
            },
            error: (refreshErr) => {
              // Surface the failure to all waiters → errorInterceptor → /login.
              subject.error(refreshErr);
              refresh$ = null;
            },
          });
      }
      // Wait for the shared refresh, then retry the original request. If the
      // refresh failed, surface the original 401 (errorInterceptor logs out).
      return refresh$.pipe(
        take(1),
        switchMap(() => next(attachAuth(req))),
        catchError(() => throwError(() => err))
      );
    })
  );
};

function attachAuth(req: HttpRequest<unknown>): HttpRequest<unknown> {
  const token = localStorage.getItem('accessToken');
  const branchData = localStorage.getItem('currentBranch');

  let headers = req.headers;
  if (token) headers = headers.set('Authorization', `Bearer ${token}`);
  if (branchData) {
    try {
      const branch = JSON.parse(branchData);
      headers = headers.set('X-Branch-Id', String(branch.id));
    } catch {
      // ignore invalid branch data
    }
  }
  return req.clone({ headers });
}
