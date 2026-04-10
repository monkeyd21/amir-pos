export type OfferType =
  | 'percentage'
  | 'flat'
  | 'buy_x_get_y_free'
  | 'buy_x_get_y_percent'
  | 'bundle';

export interface Offer {
  id: number;
  name: string;
  description?: string | null;
  type: OfferType;
  percentValue?: number | string | null;
  flatValue?: number | string | null;
  buyQty?: number | null;
  getQty?: number | null;
  priority?: number;
  isActive: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  _count?: { products: number; variants: number };
}

export interface OfferDetail extends Offer {
  products: Array<{
    offerId: number;
    productId: number;
    product: {
      id: number;
      name: string;
      brand: { id: number; name: string };
      category: { id: number; name: string };
      variants: Array<{ id: number; sku: string; size: string; color: string }>;
    };
  }>;
  variants: Array<{
    offerId: number;
    variantId: number;
    variant: {
      id: number;
      sku: string;
      size: string;
      color: string;
      product: { id: number; name: string; brand: { id: number; name: string } };
    };
  }>;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  percentage: 'Percentage Off',
  flat: 'Flat Rs. Off',
  buy_x_get_y_free: 'Buy X Get Y Free',
  buy_x_get_y_percent: 'Buy X Get Y% Off',
  bundle: 'Bundle Price',
};

export function describeOffer(o: Offer): string {
  const n = (v: unknown) => Number(v ?? 0);
  switch (o.type) {
    case 'percentage':
      return `${n(o.percentValue)}% OFF`;
    case 'flat':
      return `Rs. ${n(o.flatValue)} OFF`;
    case 'buy_x_get_y_free':
      return `Buy ${o.buyQty} Get ${o.getQty} Free`;
    case 'buy_x_get_y_percent':
      return `Buy ${o.buyQty} Get ${n(o.percentValue)}% Off`;
    case 'bundle':
      return `${o.buyQty} for Rs. ${n(o.flatValue)}`;
    default:
      return o.name;
  }
}
