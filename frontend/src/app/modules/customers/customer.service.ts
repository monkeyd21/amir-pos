import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class CustomerService {
  private api = inject(ApiService);

  getAll(params?: any): Observable<any> {
    return this.api.get<any>('/customers', params).pipe(map(res => res.data));
  }

  search(query: string): Observable<any> {
    return this.api.get<any>('/customers/search', { query }).pipe(map(res => res.data));
  }

  getById(id: number): Observable<any> {
    return this.api.get<any>(`/customers/${id}`).pipe(map(res => res.data));
  }

  create(data: any): Observable<any> {
    return this.api.post<any>('/customers', data).pipe(map(res => res.data));
  }

  update(id: number, data: any): Observable<any> {
    return this.api.put<any>(`/customers/${id}`, data).pipe(map(res => res.data));
  }

  delete(id: number): Observable<any> {
    return this.api.delete<any>(`/customers/${id}`).pipe(map(res => res.data));
  }

  getPurchaseHistory(id: number): Observable<any> {
    return this.api.get<any>(`/customers/${id}/purchases`).pipe(map(res => res.data));
  }

  getLoyaltyTransactions(id: number): Observable<any> {
    return this.api.get<any>(`/customers/${id}/loyalty-transactions`).pipe(map(res => res.data));
  }
}
