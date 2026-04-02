import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

@Injectable({ providedIn: 'root' })
export class BarcodeService {
  private api = inject(ApiService);

  lookup(barcode: string): Observable<any> {
    return this.api.get(`/barcodes/lookup/${barcode}`);
  }

  generate(variantId: number): Observable<any> {
    return this.api.post('/barcodes/generate', { variantId });
  }

  bulkGenerate(variantIds: number[]): Observable<any> {
    return this.api.post('/barcodes/bulk-generate', { variantIds });
  }

  getByProduct(productId: number): Observable<any> {
    return this.api.get(`/barcodes/product/${productId}`);
  }
}
