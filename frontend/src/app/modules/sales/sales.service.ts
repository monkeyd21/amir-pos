import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class SalesService {
  private api = inject(ApiService);

  getAll(params?: any): Observable<any> {
    return this.api.get('/sales', params);
  }

  getById(id: number): Observable<any> {
    return this.api.get(`/sales/${id}`);
  }

  processReturn(saleId: number, data: any): Observable<any> {
    return this.api.post(`/sales/${saleId}/returns`, data);
  }

  processExchange(saleId: number, data: any): Observable<any> {
    return this.api.post(`/sales/${saleId}/exchanges`, data);
  }

  getReturns(params?: any): Observable<any> {
    return this.api.get('/sales/returns', params);
  }

  getBranches(): Observable<any> {
    return this.api.get('/branches');
  }
}
