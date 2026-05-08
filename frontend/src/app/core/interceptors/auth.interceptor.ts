import {
  HttpInterceptorFn,
  HttpClient,
  HttpErrorResponse,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Subject, throwError, take, switchMap, catchError, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

interface RefreshResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    user?: unknown;
  };
}

// Module-level state so concurrent 401s share a single refresh round-trip.
// Subject (not BehaviorSubject) so we can both .next() on success and .error()
// on failure — queued requests propagate the failure instead of stalling.
let refreshing = false;
let refresh$: Subject<string> | null = null;

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

      if (!refreshing) {
        refreshing = true;
        refresh$ = new Subject<string>();
        const subject = refresh$;
        return http
          .post<RefreshResponse>(`${environment.apiUrl}/auth/refresh`, { refreshToken })
          .pipe(
            tap((res) => {
              localStorage.setItem('accessToken', res.data.accessToken);
              localStorage.setItem('refreshToken', res.data.refreshToken);
              if (res.data.user) {
                localStorage.setItem('currentUser', JSON.stringify(res.data.user));
              }
              refreshing = false;
              subject.next(res.data.accessToken);
              subject.complete();
            }),
            switchMap(() => next(attachAuth(req))),
            catchError((refreshErr) => {
              refreshing = false;
              // Push the failure to queued waiters so they unstall and surface
              // the 401 through errorInterceptor (which routes to /login).
              subject.error(refreshErr);
              return throwError(() => err);
            })
          );
      }
      // Another request is already refreshing — wait for it, then retry.
      // If the in-flight refresh errors, this subscription errors too.
      return refresh$!.pipe(
        take(1),
        switchMap(() => next(attachAuth(req)))
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
