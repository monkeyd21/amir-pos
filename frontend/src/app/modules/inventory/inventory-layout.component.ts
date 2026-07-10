import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-inventory-layout',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './inventory-layout.component.html',
})
export class InventoryLayoutComponent {
  // §2.4 — Clearance is owner-only (matches the backend authorize('owner')).
  private readonly allTabs = [
    { label: 'Products', path: 'products', icon: 'checkroom' },
    { label: 'Stock Levels', path: 'stock', icon: 'inventory_2' },
    { label: 'Transfers', path: 'transfers', icon: 'local_shipping' },
    { label: 'Barcodes', path: 'barcodes', icon: 'barcode' },
    { label: 'Brands & Categories', path: 'taxonomy', icon: 'sell' },
    { label: 'Clearance', path: 'clearance', icon: 'price_check', ownerOnly: true },
    { label: 'History', path: 'history', icon: 'history' },
    { label: 'Import', path: 'import', icon: 'upload_file' },
  ];

  constructor(private auth: AuthService) {}

  get tabs() {
    const isOwner = this.auth.hasRole(['owner']);
    return this.allTabs.filter((t) => !(t as any).ownerOnly || isOwner);
  }
}
