/**
 * `Sale.userId` is non-null — every sale has an actor. At the counter that is
 * the cashier; online there is nobody, so sales are attributed to a system user
 * created on demand here rather than depending on seed order.
 *
 * The account carries no usable password hash, so it can never be signed into.
 */
import prisma from '../../config/database';
import { shopConfig } from '../../config/shop';

let cachedId: number | null = null;

export async function getShopSystemUserId(): Promise<number> {
  if (cachedId !== null) return cachedId;

  const email = shopConfig.systemUserEmail;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    cachedId = existing.id;
    return cachedId;
  }

  const created = await prisma.user.create({
    data: {
      branchId: shopConfig.branchId,
      email,
      // Not a bcrypt hash, so no password can ever match it.
      passwordHash: 'SYSTEM-ACCOUNT-NO-LOGIN',
      firstName: 'Online',
      lastName: 'Store',
      role: 'staff',
      // Online sales earn nobody a commission (PLAN.md Q5).
      commissionRate: 0,
      isActive: true,
    },
  });

  cachedId = created.id;
  return cachedId;
}

/** Test seam. */
export function resetShopSystemUserCache(): void {
  cachedId = null;
}
