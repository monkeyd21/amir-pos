import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { NotificationService } from '../../core/services/notification.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import {
  Offer,
  OfferType,
  ApiResponse,
  OFFER_TYPE_LABELS,
  describeOffer,
} from './offer.types';

@Component({
  selector: 'app-offers-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PageHeaderComponent],
  templateUrl: './offers-list.component.html',
})
export class OffersListComponent implements OnInit {
  offers: Offer[] = [];
  loading = false;

  // Filters
  search = '';
  typeFilter: OfferType | '' = '';
  activeFilter: 'all' | 'active' | 'inactive' = 'all';

  readonly typeLabels = OFFER_TYPE_LABELS;
  readonly typeOptions: Array<{ value: OfferType; label: string }> = [
    { value: 'percentage', label: 'Percentage Off' },
    { value: 'flat', label: 'Flat Rs. Off' },
    { value: 'buy_x_get_y_free', label: 'Buy X Get Y Free' },
    { value: 'buy_x_get_y_percent', label: 'Buy X Get Y% Off' },
    { value: 'bundle', label: 'Bundle Price' },
  ];

  constructor(
    private api: ApiService,
    private notification: NotificationService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    const params: Record<string, string> = {};
    if (this.search) params['search'] = this.search;
    if (this.typeFilter) params['type'] = this.typeFilter;
    if (this.activeFilter === 'active') params['isActive'] = 'true';
    if (this.activeFilter === 'inactive') params['isActive'] = 'false';

    this.api.get<ApiResponse<Offer[]>>('/offers', params).subscribe({
      next: (res) => {
        this.offers = res.data ?? [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  describe(offer: Offer): string {
    return describeOffer(offer);
  }

  deleteOffer(offer: Offer, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const msg = offer._count && offer._count.products + offer._count.variants > 0
      ? `Delete "${offer.name}"? It will be deactivated if used in past sales.`
      : `Delete "${offer.name}"?`;
    if (!confirm(msg)) return;

    this.api.delete<ApiResponse<unknown>>(`/offers/${offer.id}`).subscribe({
      next: () => {
        this.notification.success('Offer removed');
        this.load();
      },
    });
  }
}
