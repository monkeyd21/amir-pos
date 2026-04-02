import { Routes } from '@angular/router';
import { ProductListComponent } from './product-list.component';
import { StockLevelsComponent } from './stock-levels.component';
import { TransfersComponent } from './transfers.component';
import { TransferCreateComponent } from './transfer-create.component';
import { BarcodesComponent } from './barcodes.component';

export const INVENTORY_ROUTES: Routes = [
  { path: '', redirectTo: 'products', pathMatch: 'full' },
  { path: 'products', component: ProductListComponent },
  { path: 'stock', component: StockLevelsComponent },
  { path: 'transfers', component: TransfersComponent },
  { path: 'transfers/create', component: TransferCreateComponent },
  { path: 'barcodes', component: BarcodesComponent },
];
