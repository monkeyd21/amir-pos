import { Routes } from '@angular/router';
import { InventoryLayoutComponent } from './inventory-layout.component';
import { ProductListComponent } from './product-list.component';
import { ProductDetailComponent } from './product-detail.component';
import { ProductFormComponent } from './product-form.component';
import { StockLevelsComponent } from './stock-levels.component';
import { TransfersComponent } from './transfers.component';
import { TransferCreateComponent } from './transfer-create.component';
import { BarcodesComponent } from './barcodes.component';

export const INVENTORY_ROUTES: Routes = [
  {
    path: '',
    component: InventoryLayoutComponent,
    children: [
      { path: '', redirectTo: 'products', pathMatch: 'full' },
      { path: 'products', component: ProductListComponent },
      // Order matters: `new` and `:id/edit` must be declared before `:id`
      // so the router doesn't treat "new" as a product ID.
      { path: 'products/new', component: ProductFormComponent },
      { path: 'products/:id/edit', component: ProductFormComponent },
      { path: 'products/:id', component: ProductDetailComponent },
      { path: 'stock', component: StockLevelsComponent },
      { path: 'transfers', component: TransfersComponent },
      { path: 'transfers/create', component: TransferCreateComponent },
      { path: 'barcodes', component: BarcodesComponent },
    ],
  },
];
