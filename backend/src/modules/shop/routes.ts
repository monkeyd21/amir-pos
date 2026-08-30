import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { shopController } from './controller';
import { shopAuthOptional, shopAuthRequired, withCart } from './middleware';
import {
  listProductsSchema,
  productSlugSchema,
  addItemSchema,
  updateItemSchema,
  otpRequestSchema,
  otpVerifySchema,
  refreshSchema,
  createAddressSchema,
  updateAddressSchema,
  quoteSchema,
  placeOrderSchema,
  orderNumberSchema,
} from './validators';

const router = Router();

// Every shop route may see a signed-in shopper, but few require one.
router.use(shopAuthOptional);

// ─── Public catalogue ──────────────────────────────────────────────────────
router.get('/config', (q, s, n) => shopController.config(q, s, n));
router.get('/catalog/facets', (q, s, n) => shopController.facets(q, s, n));
router.get('/catalog/sizes', (q, s, n) => shopController.sizes(q, s, n));
// Static before parameterised — CLAUDE.md §7. `/catalog/products/:slug` must
// not swallow `/catalog/facets`.
router.get('/catalog/products', validate(listProductsSchema), (q, s, n) =>
  shopController.listProducts(q, s, n)
);
router.get('/catalog/products/:slug', validate(productSlugSchema), (q, s, n) =>
  shopController.getProduct(q, s, n)
);

// ─── Cart ──────────────────────────────────────────────────────────────────
router.get('/cart', withCart, (q, s, n) => shopController.getCart(q, s, n));
router.post('/cart/items', withCart, validate(addItemSchema), (q, s, n) =>
  shopController.addToCart(q, s, n)
);
router.post('/cart/extend', withCart, (q, s, n) => shopController.extendCart(q, s, n));
router.post('/cart/revalidate', withCart, (q, s, n) => shopController.revalidateCart(q, s, n));
router.patch('/cart/items/:itemId', withCart, validate(updateItemSchema), (q, s, n) =>
  shopController.updateCartItem(q, s, n)
);
router.delete('/cart/items/:itemId', withCart, (q, s, n) =>
  shopController.removeCartItem(q, s, n)
);

// ─── Shopper identity ──────────────────────────────────────────────────────
router.post('/auth/otp/request', validate(otpRequestSchema), (q, s, n) =>
  shopController.requestOtp(q, s, n)
);
router.post('/auth/otp/verify', validate(otpVerifySchema), (q, s, n) =>
  shopController.verifyOtp(q, s, n)
);
router.post('/auth/refresh', validate(refreshSchema), (q, s, n) =>
  shopController.refresh(q, s, n)
);
router.post('/auth/logout', (q, s, n) => shopController.logout(q, s, n));
router.get('/auth/me', shopAuthRequired, (q, s, n) => shopController.me(q, s, n));

// ─── Addresses ─────────────────────────────────────────────────────────────
router.get('/addresses/pincode', (q, s, n) => shopController.checkPincode(q, s, n));
router.get('/addresses', shopAuthRequired, (q, s, n) => shopController.listAddresses(q, s, n));
router.post('/addresses', shopAuthRequired, validate(createAddressSchema), (q, s, n) =>
  shopController.createAddress(q, s, n)
);
router.put('/addresses/:id', shopAuthRequired, validate(updateAddressSchema), (q, s, n) =>
  shopController.updateAddress(q, s, n)
);
router.delete('/addresses/:id', shopAuthRequired, (q, s, n) =>
  shopController.deleteAddress(q, s, n)
);

// ─── Checkout ──────────────────────────────────────────────────────────────
router.post('/checkout/quote', withCart, validate(quoteSchema), (q, s, n) =>
  shopController.quote(q, s, n)
);
router.post('/checkout/place', shopAuthRequired, withCart, validate(placeOrderSchema), (q, s, n) =>
  shopController.placeOrder(q, s, n)
);

// ─── Orders ────────────────────────────────────────────────────────────────
router.get('/orders', shopAuthRequired, (q, s, n) => shopController.listOrders(q, s, n));
router.get('/orders/:orderNumber/status', shopAuthRequired, validate(orderNumberSchema), (q, s, n) =>
  shopController.orderStatus(q, s, n)
);
router.get('/orders/:orderNumber', shopAuthRequired, validate(orderNumberSchema), (q, s, n) =>
  shopController.getOrder(q, s, n)
);
router.post('/orders/:id/cancel', shopAuthRequired, (q, s, n) =>
  shopController.cancelOrder(q, s, n)
);

export default router;
