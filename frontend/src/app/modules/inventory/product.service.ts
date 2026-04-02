import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class ProductService {
  private api = inject(ApiService);

  getAll(params?: any): Observable<any> {
    return this.api.get('/products', params);
  }

  getById(id: number): Observable<any> {
    return this.api.get(`/products/${id}`);
  }

  create(data: any): Observable<any> {
    return this.api.post('/products', data);
  }

  update(id: number, data: any): Observable<any> {
    return this.api.put(`/products/${id}`, data);
  }

  delete(id: number): Observable<any> {
    return this.api.delete(`/products/${id}`);
  }

  getVariants(productId: number): Observable<any> {
    return this.api.get(`/products/${productId}/variants`);
  }

  createVariant(productId: number, data: any): Observable<any> {
    return this.api.post(`/products/${productId}/variants`, data);
  }

  updateVariant(productId: number, variantId: number, data: any): Observable<any> {
    return this.api.put(`/products/${productId}/variants/${variantId}`, data);
  }

  deleteVariant(productId: number, variantId: number): Observable<any> {
    return this.api.delete(`/products/${productId}/variants/${variantId}`);
  }

  getBrands(): Observable<any> {
    return this.api.get('/brands');
  }

  getCategories(): Observable<any> {
    return this.api.get('/categories');
  }
}
