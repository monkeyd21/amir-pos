import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class SalesService {
  private api = inject(ApiService);

  getAll(params?: any): Observable<any> {
    return this.api.get<any>('/sales', params).pipe(map(res => res.data));
  }

  getById(id: number): Observable<any> {
    return this.api.get<any>(`/sales/${id}`).pipe(map(res => res.data));
  }

  processReturn(saleId: number, data: any): Observable<any> {
    return this.api.post<any>(`/sales/${saleId}/returns`, data).pipe(map(res => res.data));
  }

  processExchange(saleId: number, data: any): Observable<any> {
    return this.api.post<any>(`/sales/${saleId}/exchanges`, data).pipe(map(res => res.data));
  }

  getReturns(params?: any): Observable<any> {
    return this.api.get<any>('/sales/returns', params).pipe(map(res => res.data));
  }

  getBranches(): Observable<any> {
    return this.api.get<any>('/branches').pipe(map(res => res.data));
  }
}
