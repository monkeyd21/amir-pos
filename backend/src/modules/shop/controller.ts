/**
 * HTTP surface for the public storefront.
 *
 * House convention (CLAUDE.md): `{ success, data, meta }` on success,
 * `{ success: false, error }` on failure — the error handler owns the latter.
 */
import { Response, NextFunction } from 'express';
import { ShopRequest } from './middleware';
import { shopConfig } from '../../config/shop';
import * as catalog from './catalog';
import * as cart from './cart';
import * as auth from './auth';
import * as addresses from './addresses';
import * as orders from './orders';
import { buildQuote } from './quote';

const ok = (res: Response, data: unknown, meta?: unknown) =>
  res.json({ success: true, data, ...(meta ? { meta } : {}) });

export const shopController = {
  // ─── Catalogue ─────────────────────────────────────────────────────────
  async listProducts(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const { items, meta } = await catalog.listProducts(req.query as catalog.ListQuery);
      ok(res, items, meta);
    } catch (e) {
      next(e);
    }
  },

  async getProduct(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const product = await catalog.getProductBySlug(req.params.slug);
      const related = await catalog.getRelated(product.id);
      ok(res, { ...product, related });
    } catch (e) {
      next(e);
    }
  },

  async facets(_req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, await catalog.getFacets());
    } catch (e) {
      next(e);
    }
  },

  async sizes(_req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, await catalog.listSizes());
    } catch (e) {
      next(e);
    }
  },

  /**
   * The storefront's own configuration — free-delivery threshold, COD
   * availability, hold duration, contact details. Served rather than
   * duplicated so the site can never disagree with the server about the rules.
   */
  async config(_req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, {
        identity: shopConfig.identity,
        freeDeliveryAbove: shopConfig.commerce.freeDeliveryAbove,
        flatShippingFee: shopConfig.commerce.flatShippingFee,
        prepaidDiscountPercent: shopConfig.commerce.prepaidDiscountPercent,
        codEnabled: shopConfig.commerce.codEnabled,
        exchangeWindowDays: shopConfig.commerce.exchangeWindowDays,
        cartHoldMinutes: shopConfig.reservation.cartHoldMinutes,
        dispatchDays: shopConfig.delivery.dispatchDays,
        deliveryDaysMin: shopConfig.delivery.deliveryDaysMin,
        deliveryDaysMax: shopConfig.delivery.deliveryDaysMax,
        originCity: shopConfig.delivery.originCity,
        loyaltyRedeemableOnline: shopConfig.commerce.loyaltyRedeemableOnline,
      });
    } catch (e) {
      next(e);
    }
  },

  // ─── Cart ──────────────────────────────────────────────────────────────
  async getCart(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const view = await cart.getCartView(req.cartId!);
      ok(res, view, { cartToken: req.cartToken });
    } catch (e) {
      next(e);
    }
  },

  async addToCart(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const view = await cart.addItem(req.cartId!, req.body.variantId, req.body.quantity ?? 1);
      ok(res, view, { cartToken: req.cartToken });
    } catch (e) {
      next(e);
    }
  },

  async updateCartItem(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const view = await cart.updateItem(
        req.cartId!,
        parseInt(req.params.itemId, 10),
        req.body.quantity
      );
      ok(res, view, { cartToken: req.cartToken });
    } catch (e) {
      next(e);
    }
  },

  async removeCartItem(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const view = await cart.removeItem(req.cartId!, parseInt(req.params.itemId, 10));
      ok(res, view, { cartToken: req.cartToken });
    } catch (e) {
      next(e);
    }
  },

  async extendCart(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, await cart.extendHolds(req.cartId!), { cartToken: req.cartToken });
    } catch (e) {
      next(e);
    }
  },

  async revalidateCart(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, await cart.revalidate(req.cartId!), { cartToken: req.cartToken });
    } catch (e) {
      next(e);
    }
  },

  // ─── Auth ──────────────────────────────────────────────────────────────
  async requestOtp(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, await auth.requestOtp(req.body.phone));
    } catch (e) {
      next(e);
    }
  },

  async verifyOtp(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const tokens = await auth.verifyOtp(req.body.phone, req.body.code, {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        firstName: req.body.firstName ?? undefined,
      });
      ok(res, tokens);
    } catch (e) {
      next(e);
    }
  },

  async refresh(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(
        res,
        await auth.refreshSession(req.body.refreshToken, {
          userAgent: req.headers['user-agent'],
          ipAddress: req.ip,
        })
      );
    } catch (e) {
      next(e);
    }
  },

  async logout(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      if (req.body?.refreshToken) await auth.logout(req.body.refreshToken);
      ok(res, { loggedOut: true });
    } catch (e) {
      next(e);
    }
  },

  async me(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const prisma = (await import('../../config/database')).default;
      const customer = await prisma.customer.findUnique({
        where: { id: req.customerId! },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phone: true,
          email: true,
          loyaltyPoints: true,
          loyaltyTier: true,
        },
      });
      ok(res, customer);
    } catch (e) {
      next(e);
    }
  },

  // ─── Addresses ─────────────────────────────────────────────────────────
  async listAddresses(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, await addresses.listAddresses(req.customerId!));
    } catch (e) {
      next(e);
    }
  },

  async createAddress(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      res.status(201);
      ok(res, await addresses.createAddress(req.customerId!, req.body));
    } catch (e) {
      next(e);
    }
  },

  async updateAddress(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(
        res,
        await addresses.updateAddress(req.customerId!, parseInt(req.params.id, 10), req.body)
      );
    } catch (e) {
      next(e);
    }
  },

  async deleteAddress(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      await addresses.deleteAddress(req.customerId!, parseInt(req.params.id, 10));
      ok(res, { deleted: true });
    } catch (e) {
      next(e);
    }
  },

  async checkPincode(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, addresses.checkPincode(String(req.query.pincode || '')));
    } catch (e) {
      next(e);
    }
  },

  // ─── Checkout ──────────────────────────────────────────────────────────
  async quote(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(
        res,
        await buildQuote({
          cartId: req.cartId!,
          customerId: req.customerId ?? null,
          paymentMode: req.body.paymentMode,
          loyaltyPointsRedeem: req.body.loyaltyPointsRedeem ?? undefined,
        })
      );
    } catch (e) {
      next(e);
    }
  },

  async placeOrder(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const { order, quote } = await orders.placeOrder({
        cartId: req.cartId!,
        customerId: req.customerId!,
        addressId: req.body.addressId,
        paymentMode: req.body.paymentMode,
        loyaltyPointsRedeem: req.body.loyaltyPointsRedeem ?? undefined,
        notes: req.body.notes ?? undefined,
      });

      const payment =
        order.paymentMode === 'prepaid' ? await orders.createPaymentIntent(order.id) : null;

      res.status(201);
      ok(res, { order, quote, payment });
    } catch (e) {
      next(e);
    }
  },

  async orderStatus(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, await orders.pollPaymentStatus(req.customerId!, req.params.orderNumber));
    } catch (e) {
      next(e);
    }
  },

  async listOrders(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, await orders.listOrders(req.customerId!));
    } catch (e) {
      next(e);
    }
  },

  async getOrder(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(res, await orders.getOrder(req.customerId!, req.params.orderNumber));
    } catch (e) {
      next(e);
    }
  },

  async cancelOrder(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      ok(
        res,
        await orders.cancelOrder(
          req.customerId!,
          parseInt(req.params.id, 10),
          req.body?.reason
        )
      );
    } catch (e) {
      next(e);
    }
  },

  // ─── Webhook ───────────────────────────────────────────────────────────
  async paymentWebhook(req: ShopRequest, res: Response, next: NextFunction) {
    try {
      const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body);
      const result = await orders.handleShopPaymentWebhook(
        req.headers as Record<string, string>,
        raw
      );
      res.json({ success: true, data: result });
    } catch (e) {
      next(e);
    }
  },
};
