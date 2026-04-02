import { Routes } from '@angular/router';
import { LedgerComponent } from './ledger.component';
import { JournalEntriesComponent } from './journal-entries.component';
import { PnlStatementComponent } from './pnl-statement.component';

export const ACCOUNTING_ROUTES: Routes = [
  { path: '', redirectTo: 'ledger', pathMatch: 'full' },
  { path: 'ledger', component: LedgerComponent },
  { path: 'journal-entries', component: JournalEntriesComponent },
  { path: 'pnl', component: PnlStatementComponent },
];
