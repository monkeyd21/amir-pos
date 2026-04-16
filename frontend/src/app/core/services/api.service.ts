import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, retry, throwError, timer } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Retry transient network errors (tunnel drops, 502/503/504) up to 3 times
 * with exponential backoff. Don't retry 4xx responses — those are legitimate
 * errors (validation failures, auth, etc) and should surface immediately.
 */
const retryOnTransient = <T>() =>
  retry<T>({
    count: 3,
    delay: (err: HttpErrorResponse, attempt: number) => {
      const status = err?.status ?? 0;
      const isTransient = status === 0 || status === 502 || status === 503 || status === 504;
      if (!isTransient) return throwError(() => err);
      // 300ms, 900ms, 2.7s exponential backoff
      return timer(300 * Math.pow(3, attempt - 1));
    },
  });

@Injectable({ providedIn: 'root' })
export class ApiService {
  private baseUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  get<T>(path: string, params?: Record<string, string | number | boolean>): Observable<T> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          httpParams = httpParams.set(key, String(value));
        }
      });
    }
    return this.http.get<T>(`${this.baseUrl}${path}`, { params: httpParams }).pipe(retryOnTransient());
  }

  post<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, body).pipe(retryOnTransient());
  }

  put<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.put<T>(`${this.baseUrl}${path}`, body).pipe(retryOnTransient());
  }

  patch<T>(path: string, body: unknown = {}): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${path}`, body).pipe(retryOnTransient());
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${path}`).pipe(retryOnTransient());
  }
}
