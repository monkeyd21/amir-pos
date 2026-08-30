/**
 * Request plumbing for the public shop API.
 *
 * The API is deliberately HEADER-based, not cookie-based: the Next.js
 * storefront owns the browser cookies and calls this API server-to-server,
 * passing the shopper's token and cart token as headers. That keeps session
 * handling in one place and means the Express app needs no cookie middleware.
 *
 *   Authorization: Bearer <customer access token>
 *   X-Cart-Token:  <opaque cart token>
 */
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/errorHandler';
import { verifyAccessToken } from './auth';
import { getOrCreateCart } from './cart';

export interface ShopRequest extends Request {
  customerId?: number;
  cartId?: number;
  cartToken?: string;
}

/** Attaches `customerId` when a valid shopper token is present. Never throws. */
export const shopAuthOptional = (req: ShopRequest, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const claims = verifyAccessToken(header.slice(7));
    if (claims) req.customerId = claims.customerId;
  }
  next();
};

/** Requires a signed-in shopper. */
export const shopAuthRequired = (req: ShopRequest, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError('Please sign in to continue', 401));
  }
  const claims = verifyAccessToken(header.slice(7));
  if (!claims) return next(new AppError('Your session has expired. Please sign in again.', 401));
  req.customerId = claims.customerId;
  next();
};

/**
 * Resolves (or creates) the shopper's cart. Runs after `shopAuthOptional`, so a
 * shopper who signs in mid-session has their anonymous cart claimed rather than
 * abandoned.
 */
export const withCart = async (req: ShopRequest, _res: Response, next: NextFunction) => {
  try {
    const raw = req.headers['x-cart-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    const cart = await getOrCreateCart(token, req.customerId ?? null);
    req.cartId = cart.id;
    req.cartToken = cart.token;
    next();
  } catch (err) {
    next(err);
  }
};
