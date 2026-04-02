import { Component } from '@angular/core';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';

@Component({
  selector: 'app-inventory-placeholder',
  standalone: true,
  imports: [PageHeaderComponent, EmptyStateComponent],
  template: `
    <app-page-header title="Inventory" subtitle="Manage your products and stock levels."></app-page-header>
    <app-empty-state icon="inventory_2" title="Coming Soon" message="The inventory module is under development."></app-empty-state>
  `,
})
export class InventoryPlaceholderComponent {}
