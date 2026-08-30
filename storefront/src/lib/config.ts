/**
 * Where the storefront talks to.
 *
 * Server components and the proxy route call the Express API directly over
 * localhost — same box, no public hop. The browser NEVER calls the API
 * directly: it goes through `/api/shop/*` in this app, so the shopper's tokens
 * can stay in httpOnly cookies.
 */
export const API_BASE =
  process.env.SHOP_API_BASE || 'http://127.0.0.1:3000/api/shop/v1';

export const SITE_URL =
  process.env.SHOP_SITE_URL || 'https://shop.sabihasethnic.com';

/** Cookie names. Cart is not sensitive; the tokens are httpOnly. */
export const COOKIE = {
  cart: 'se_cart',
  access: 'se_at',
  refresh: 'se_rt',
} as const;
