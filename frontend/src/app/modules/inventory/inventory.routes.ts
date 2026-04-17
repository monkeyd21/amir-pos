import { Routes } from '@angular/router';
import { InventoryLayoutComponent } from './inventory-layout.component';
import { ProductListComponent } from './product-list.component';
import { ProductDetailComponent } from './product-detail.component';
import { ProductFormComponent } from './product-form.component';
import { StockLevelsComponent } from './stock-levels.component';
import { TransfersComponent } from './transfers.component';
import { TransferCreateComponent } from './transfer-create.component';
import { BarcodesComponent } from './barcodes.component';
import { ImportComponent } from './import.component';
import { RestockComponent } from './restock.component';
import { StockHistoryComponent } from './stock-history.component';

export const INVENTORY_ROUTES: Routes = [
  {
    path: '',
    component: InventoryLayoutComponent,
    children: [
      { path: '', redirectTo: 'products', pathMatch: 'full' },
      { path: 'products', component: ProductListComponent },
      { path: 'products/new', component: ProductFormComponent },
      { path: 'products/:id/edit', component: ProductFormComponent },
      { path: 'products/:id/restock', component: RestockComponent },
      { path: 'products/:id', component: ProductDetailComponent },
      { path: 'stock', component: StockLevelsComponent },
      { path: 'transfers', component: TransfersComponent },
      { path: 'transfers/create', component: TransferCreateComponent },
      { path: 'barcodes', component: BarcodesComponent },
      { path: 'history', component: StockHistoryComponent },
      { path: 'import', component: ImportComponent },
    ],
  },
];
