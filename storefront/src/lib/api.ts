/**
 * Server-side API access.
 *
 * Catalogue reads are cached briefly and revalidated, because a product page
 * has to be fast for a crawler and for a parent on a phone. Anything involving
 * a cart, a shopper or stock is always fetched fresh — a cached availability
 * number is a wrong availability number.
 */
import { cookies } from 'next/headers';
import { API_BASE, COOKIE } from './config';

export interface ApiResult<T> {
  success: boolean;
  data: T;
  meta?: any;
  error?: string;
}

async function request<T>(
  path: string,
  init: RequestInit & { revalidate?: number | false } = {}
): Promise<ApiResult<T>> {
  const { revalidate, ...rest } = init;

  const jar = cookies();
  const access = jar.get(COOKIE.access)?.value;
  const cart = jar.get(COOKIE.cart)?.value;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((rest.headers as Record<string, string>) || {}),
  };
  if (access) headers.Authorization = `Bearer ${access}`;
  if (cart) headers['X-Cart-Token'] = cart;

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
    ...(revalidate === undefined
      ? { cache: 'no-store' as const }
      : revalidate === false
      ? { cache: 'no-store' as const }
      : { next: { revalidate } }),
  });

  const body = await res.json().catch(() => ({ success: false, error: 'Bad response' }));
  if (!res.ok) {
    return { success: false, data: null as T, error: body.error || 'Something went wrong' };
  }
  return body as ApiResult<T>;
}

// ─── Catalogue (cacheable) ─────────────────────────────────────────────────

export const getShopConfig = () => request<any>('/config', { revalidate: 300 });
export const getFacets = () => request<any>('/catalog/facets', { revalidate: 300 });
export const getSizes = () => request<any[]>('/catalog/sizes', { revalidate: 3600 });

export const listProducts = (params: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
  ).toString();
  // 60s: fresh enough that a sold-out size disappears quickly, cached enough
  // that a burst of traffic does not hammer the database.
  return request<any[]>(`/catalog/products${qs ? `?${qs}` : ''}`, { revalidate: 60 });
};

export const getProduct = (slug: string) =>
  request<any>(`/catalog/products/${encodeURIComponent(slug)}`, { revalidate: 60 });

// ─── Shopper state (never cached) ──────────────────────────────────────────

export const getCart = () => request<any>('/cart');
export const getMe = () => request<any>('/auth/me');
export const listAddresses = () => request<any[]>('/addresses');
export const listOrders = () => request<any[]>('/orders');
export const getOrder = (orderNumber: string) =>
  request<any>(`/orders/${encodeURIComponent(orderNumber)}`);
