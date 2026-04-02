import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class BarcodeService {
  private api = inject(ApiService);

  lookup(barcode: string): Observable<any> {
    return this.api.get<any>(`/barcodes/lookup/${barcode}`).pipe(map(res => res.data));
  }

  generate(variantId: number): Observable<any> {
    return this.api.post<any>('/barcodes/generate', { variantId }).pipe(map(res => res.data));
  }

  bulkGenerate(variantIds: number[]): Observable<any> {
    return this.api.post<any>('/barcodes/bulk-generate', { variantIds }).pipe(map(res => res.data));
  }

  getByProduct(productId: number): Observable<any> {
    return this.api.get<any>(`/barcodes/product/${productId}`).pipe(map(res => res.data));
  }
}
