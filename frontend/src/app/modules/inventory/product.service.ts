import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private api = inject(ApiService);

  getAll(params?: any): Observable<any> {
    return this.api.get<any>('/products', params).pipe(map(res => res.data));
  }

  getById(id: number): Observable<any> {
    return this.api.get<any>(`/products/${id}`).pipe(map(res => res.data));
  }

  create(data: any): Observable<any> {
    return this.api.post<any>('/products', data).pipe(map(res => res.data));
  }

  update(id: number, data: any): Observable<any> {
    return this.api.put<any>(`/products/${id}`, data).pipe(map(res => res.data));
  }

  delete(id: number): Observable<any> {
    return this.api.delete<any>(`/products/${id}`).pipe(map(res => res.data));
  }

  getVariants(productId: number): Observable<any> {
    return this.api.get<any>(`/products/${productId}/variants`).pipe(map(res => res.data));
  }

  createVariant(productId: number, data: any): Observable<any> {
    return this.api.post<any>(`/products/${productId}/variants`, data).pipe(map(res => res.data));
  }

  updateVariant(productId: number, variantId: number, data: any): Observable<any> {
    return this.api.put<any>(`/products/${productId}/variants/${variantId}`, data).pipe(map(res => res.data));
  }

  deleteVariant(productId: number, variantId: number): Observable<any> {
    return this.api.delete<any>(`/products/${productId}/variants/${variantId}`).pipe(map(res => res.data));
  }

  getBrands(): Observable<any> {
    return this.api.get<any>('/brands').pipe(map(res => res.data));
  }

  getCategories(): Observable<any> {
    return this.api.get<any>('/categories').pipe(map(res => res.data));
  }
}
