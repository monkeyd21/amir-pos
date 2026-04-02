import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private api = inject(ApiService);

  getSettings(): Observable<any> {
    return this.api.get<any>('/settings').pipe(map(res => res.data));
  }

  updateSettings(data: any): Observable<any> {
    return this.api.put<any>('/settings', data).pipe(map(res => res.data));
  }

  getTaxSettings(): Observable<any> {
    return this.api.get<any>('/settings/tax').pipe(map(res => res.data));
  }

  updateTaxSettings(data: any): Observable<any> {
    return this.api.put<any>('/settings/tax', data).pipe(map(res => res.data));
  }

  getLoyaltySettings(): Observable<any> {
    return this.api.get<any>('/settings/loyalty').pipe(map(res => res.data));
  }

  updateLoyaltySettings(data: any): Observable<any> {
    return this.api.put<any>('/settings/loyalty', data).pipe(map(res => res.data));
  }

  getProfile(): Observable<any> {
    return this.api.get<any>('/settings/profile').pipe(map(res => res.data));
  }

  updateProfile(data: any): Observable<any> {
    return this.api.put<any>('/settings/profile', data).pipe(map(res => res.data));
  }
}
