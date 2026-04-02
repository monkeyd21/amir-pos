import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private api = inject(ApiService);

  getAll(params?: any): Observable<any> {
    return this.api.get<any>('/expenses', params).pipe(map(res => res.data));
  }

  getById(id: number): Observable<any> {
    return this.api.get<any>(`/expenses/${id}`).pipe(map(res => res.data));
  }

  create(data: any): Observable<any> {
    return this.api.post<any>('/expenses', data).pipe(map(res => res.data));
  }

  update(id: number, data: any): Observable<any> {
    return this.api.put<any>(`/expenses/${id}`, data).pipe(map(res => res.data));
  }

  delete(id: number): Observable<any> {
    return this.api.delete<any>(`/expenses/${id}`).pipe(map(res => res.data));
  }

  getCategories(): Observable<any> {
    return this.api.get<any>('/expense-categories').pipe(map(res => res.data));
  }

  createCategory(data: any): Observable<any> {
    return this.api.post<any>('/expense-categories', data).pipe(map(res => res.data));
  }

  updateCategory(id: number, data: any): Observable<any> {
    return this.api.put<any>(`/expense-categories/${id}`, data).pipe(map(res => res.data));
  }

  deleteCategory(id: number): Observable<any> {
    return this.api.delete<any>(`/expense-categories/${id}`).pipe(map(res => res.data));
  }

  approve(id: number): Observable<any> {
    return this.api.patch<any>(`/expenses/${id}/approve`, {}).pipe(map(res => res.data));
  }

  reject(id: number): Observable<any> {
    return this.api.patch<any>(`/expenses/${id}/reject`, {}).pipe(map(res => res.data));
  }
}
