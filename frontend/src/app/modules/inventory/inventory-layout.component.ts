import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-inventory-layout',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './inventory-layout.component.html',
})
export class InventoryLayoutComponent {
  tabs = [
    { label: 'Products', path: 'products', icon: 'checkroom' },
    { label: 'Stock Levels', path: 'stock', icon: 'inventory_2' },
    { label: 'Transfers', path: 'transfers', icon: 'local_shipping' },
    { label: 'Barcodes', path: 'barcodes', icon: 'barcode' },
    { label: 'History', path: 'history', icon: 'history' },
    { label: 'Import', path: 'import', icon: 'upload_file' },
  ];
}
