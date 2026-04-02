import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { EmptyStateComponent } from '../shared/empty-state/empty-state.component';

@Component({
  selector: 'app-placeholder',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent, EmptyStateComponent],
  template: `
    <app-page-header [title]="title" subtitle="This module is under development."></app-page-header>
    <app-empty-state [icon]="icon" title="Coming Soon" message="This module will be available in a future update."></app-empty-state>
  `,
})
export class PlaceholderComponent {
  title = 'Module';
  icon = 'construction';

  constructor(private route: ActivatedRoute) {
    this.title = this.route.snapshot.data['title'] || 'Module';
    this.icon = this.route.snapshot.data['icon'] || 'construction';
  }
}
