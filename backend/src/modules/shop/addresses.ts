/**
 * The shopper's address book.
 *
 * `Customer.address` is one free-text line — enough for a counter record,
 * useless for despatch — so shipping addresses live in their own table with
 * the fields a courier actually needs.
 */
import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { shopConfig } from '../../config/shop';

export interface AddressInput {
  name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
}

/**
 * Pincode serviceability. An empty prefix list means "every valid Indian
 * pincode"; add prefixes to SHOP_PINCODE_PREFIXES to restrict delivery.
 */
export function checkPincode(pincode: string) {
  const clean = (pincode || '').trim();
  if (!/^[1-9]\d{5}$/.test(clean)) {
    return { serviceable: false, reason: 'Enter a valid 6-digit pincode' as string | null };
  }

  const prefixes = shopConfig.delivery.servicablePincodePrefixes;
  const serviceable =
    prefixes.length === 0 || prefixes.some((p) => clean.startsWith(p));

  return {
    serviceable,
    reason: serviceable ? null : 'We do not deliver to this pincode yet',
    dispatchDays: shopConfig.delivery.dispatchDays,
    deliveryDaysMin: shopConfig.delivery.deliveryDaysMin,
    deliveryDaysMax: shopConfig.delivery.deliveryDaysMax,
  };
}

export async function listAddresses(customerId: number) {
  return prisma.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function createAddress(customerId: number, input: AddressInput) {
  const check = checkPincode(input.pincode);
  if (!check.serviceable) throw new AppError(check.reason || 'Pincode not serviceable', 400);

  return prisma.$transaction(async (tx) => {
    const count = await tx.address.count({ where: { customerId } });
    // The first address is always the default, whatever the caller says.
    const isDefault = count === 0 ? true : Boolean(input.isDefault);

    if (isDefault) {
      await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
    }

    return tx.address.create({
      data: {
        customerId,
        name: input.name.trim(),
        phone: input.phone.trim(),
        line1: input.line1.trim(),
        line2: input.line2?.trim() || null,
        landmark: input.landmark?.trim() || null,
        city: input.city.trim(),
        state: input.state.trim(),
        pincode: input.pincode.trim(),
        isDefault,
      },
    });
  });
}

export async function updateAddress(customerId: number, id: number, input: AddressInput) {
  const existing = await prisma.address.findFirst({ where: { id, customerId } });
  if (!existing) throw new AppError('Address not found', 404);

  const check = checkPincode(input.pincode);
  if (!check.serviceable) throw new AppError(check.reason || 'Pincode not serviceable', 400);

  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
    }
    return tx.address.update({
      where: { id },
      data: {
        name: input.name.trim(),
        phone: input.phone.trim(),
        line1: input.line1.trim(),
        line2: input.line2?.trim() || null,
        landmark: input.landmark?.trim() || null,
        city: input.city.trim(),
        state: input.state.trim(),
        pincode: input.pincode.trim(),
        isDefault: input.isDefault ?? existing.isDefault,
      },
    });
  });
}

export async function deleteAddress(customerId: number, id: number) {
  const existing = await prisma.address.findFirst({ where: { id, customerId } });
  if (!existing) throw new AppError('Address not found', 404);

  await prisma.address.delete({ where: { id } });

  // Never leave a customer with addresses but no default.
  if (existing.isDefault) {
    const next = await prisma.address.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    if (next) {
      await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }
}
