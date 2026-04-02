import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class CustomerService {
  private api = inject(ApiService);

  getAll(params?: any): Observable<any> {
    return this.api.get('/customers', params);
  }

  search(query: string): Observable<any> {
    return this.api.get('/customers/search', { query });
  }

  getById(id: number): Observable<any> {
    return this.api.get(`/customers/${id}`);
  }

  create(data: any): Observable<any> {
    return this.api.post('/customers', data);
  }

  update(id: number, data: any): Observable<any> {
    return this.api.put(`/customers/${id}`, data);
  }

  delete(id: number): Observable<any> {
    return this.api.delete(`/customers/${id}`);
  }

  getPurchaseHistory(id: number): Observable<any> {
    return this.api.get(`/customers/${id}/purchases`);
  }

  getLoyaltyTransactions(id: number): Observable<any> {
    return this.api.get(`/customers/${id}/loyalty-transactions`);
  }
}
