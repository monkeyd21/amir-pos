import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { generateNumber } from '../../utils/helpers';
import { MovementType, PaymentMethod } from '@prisma/client';

export class PosService {
  async openSession(userId: number, branchId: number, openingAmount: number, notes?: string) {
    // Check if user already has an open session
    const existing = await prisma.posSession.findFirst({
      where: { userId, status: 'open' },
    });

    if (existing) {
      throw new AppError('You already have an open session. Close it before opening a new one.', 400);
    }

    const session = await prisma.posSession.create({
      data: {
        branchId,
        userId,
        openingAmount,
        notes,
      },
    });

    return session;
  }

  async closeSession(userId: number) {
    const session = await prisma.posSession.findFirst({
      where: { userId, status: 'open' },
    });

    if (!session) {
      throw new AppError('No open session found', 404);
    }

    // Calculate expected amount: opening + cash payments during session
    const cashPayments = await prisma.payment.aggregate({
      where: {
        method: 'cash',
        status: 'completed',
        sale: {
          userId,
          createdAt: { gte: session.openedAt },
        },
      },
      _sum: { amount: true },
    });

    // Also subtract cash refunds
    const cashRefunds = await prisma.payment.aggregate({
      where: {
        method: 'cash',
        status: 'refunded',
        sale: {
          userId,
          createdAt: { gte: session.openedAt },
        },
      },
      _sum: { amount: true },
    });

    const cashIn = Number(cashPayments._sum.amount || 0);
    const cashOut = Number(cashRefunds._sum.amount || 0);
    const expectedAmount = Number(session.openingAmount) + cashIn - cashOut;

    return { session, expectedAmount };
  }

  async finalizeCloseSession(userId: number, closingAmount: number, notes?: string) {
    const { session, expectedAmount } = await this.closeSession(userId);

    const updated = await prisma.posSession.update({
      where: { id: session.id },
      data: {
        closingAmount,
        expectedAmount,
        status: 'closed',
        closedAt: new Date(),
        notes: notes || session.notes,
      },
    });

    return {
      ...updated,
      difference: closingAmount - expectedAmount,
    };
  }

  async getCurrentSession(userId: number) {
    const session = await prisma.posSession.findFirst({
      where: { userId, status: 'open' },
      include: { branch: true },
    });

    if (!session) {
      throw new AppError('No open session found', 404);
    }

    return session;
  }

  async checkout(
    data: {
      items: { barcode: string; quantity: number }[];
      customerId?: number;
      payments: { method: string; amount: number; referenceNumber?: string }[];
      discountAmount?: number;
      loyaltyPointsRedeem?: number;
      notes?: string;
    },
    userId: number,
    branchId: number
  ) {
    return prisma.$transaction(async (tx) => {
      // 1. Verify user has an open session
      const session = await tx.posSession.findFirst({
        where: { userId, status: 'open' },
      });

      if (!session) {
        throw new AppError('No open POS session. Open a session before checkout.', 400);
      }

      // 2. Resolve all barcodes to variants with product info
      const barcodes = data.items.map((i) => i.barcode);
      const variants = await tx.productVariant.findMany({
        where: { barcode: { in: barcodes }, isActive: true },
        include: {
          product: true,
        },
      });

      const variantByBarcode = new Map(variants.map((v) => [v.barcode, v]));

      // Validate all barcodes exist
      for (const item of data.items) {
        if (!variantByBarcode.has(item.barcode)) {
          throw new AppError(`Barcode not found: ${item.barcode}`, 400);
        }
      }

      // 3. Check stock availability for all items
      const saleItemsData: Array<{
        variantId: number;
        quantity: number;
        unitPrice: number;
        costPrice: number;
        taxRate: number;
      }> = [];

      for (const item of data.items) {
        const variant = variantByBarcode.get(item.barcode)!;

        const inventory = await tx.inventory.findUnique({
          where: {
            variantId_branchId: {
              variantId: variant.id,
              branchId,
            },
          },
        });

        if (!inventory || inventory.quantity < item.quantity) {
          throw new AppError(
            `Insufficient stock for ${variant.product.name} (${variant.size}/${variant.color}). Available: ${inventory?.quantity ?? 0}, Requested: ${item.quantity}`,
            400
          );
        }

        const unitPrice = Number(variant.priceOverride ?? variant.product.basePrice);
        const costPrice = Number(variant.costOverride ?? variant.product.costPrice);
        const taxRate = Number(variant.product.taxRate);

        saleItemsData.push({
          variantId: variant.id,
          quantity: item.quantity,
          unitPrice,
          costPrice,
          taxRate,
        });
      }

      // 4. Calculate totals
      const discountAmount = data.discountAmount || 0;
      let loyaltyDiscount = 0;

      // Handle loyalty points redemption
      if (data.loyaltyPointsRedeem && data.loyaltyPointsRedeem > 0) {
        if (!data.customerId) {
          throw new AppError('Customer is required to redeem loyalty points', 400);
        }

        const customer = await tx.customer.findUnique({
          where: { id: data.customerId },
        });

        if (!customer) {
          throw new AppError('Customer not found', 404);
        }

        if (customer.loyaltyPoints < data.loyaltyPointsRedeem) {
          throw new AppError(
            `Insufficient loyalty points. Available: ${customer.loyaltyPoints}, Requested: ${data.loyaltyPointsRedeem}`,
            400
          );
        }

        // Get loyalty config for redemption value
        const loyaltyConfig = await tx.loyaltyConfig.findFirst();
        const redemptionValue = loyaltyConfig ? Number(loyaltyConfig.redemptionValue) : 1;
        loyaltyDiscount = data.loyaltyPointsRedeem * redemptionValue;
      }

      let subtotal = 0;
      let totalTax = 0;
      const itemsForCreation: Array<{
        variantId: number;
        quantity: number;
        unitPrice: number;
        discount: number;
        taxAmount: number;
        total: number;
      }> = [];

      for (const item of saleItemsData) {
        const lineSubtotal = item.unitPrice * item.quantity;
        const lineTax = lineSubtotal * (item.taxRate / 100);
        const lineTotal = lineSubtotal + lineTax;

        subtotal += lineSubtotal;
        totalTax += lineTax;

        itemsForCreation.push({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: 0,
          taxAmount: Math.round(lineTax * 100) / 100,
          total: Math.round(lineTotal * 100) / 100,
        });
      }

      subtotal = Math.round(subtotal * 100) / 100;
      totalTax = Math.round(totalTax * 100) / 100;
      const totalBeforeDiscount = subtotal + totalTax;
      const totalDiscount = discountAmount + loyaltyDiscount;
      const saleTotal = Math.round((totalBeforeDiscount - totalDiscount) * 100) / 100;

      if (saleTotal < 0) {
        throw new AppError('Discount exceeds sale total', 400);
      }

      // 5. Validate payments cover the total
      const totalPayments = data.payments.reduce((sum, p) => sum + p.amount, 0);

      if (totalPayments < saleTotal) {
        throw new AppError(
          `Payment shortfall. Total: ${saleTotal}, Paid: ${totalPayments}`,
          400
        );
      }

      // 6. Validate customer exists if provided
      if (data.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: data.customerId },
        });
        if (!customer) {
          throw new AppError('Customer not found', 404);
        }
      }

      // 7. Create the sale
      const saleNumber = generateNumber('SL');

      const sale = await tx.sale.create({
        data: {
          branchId,
          userId,
          customerId: data.customerId || null,
          saleNumber,
          subtotal,
          taxAmount: totalTax,
          discountAmount: totalDiscount,
          total: saleTotal,
          loyaltyPointsRedeemed: data.loyaltyPointsRedeem || 0,
          notes: data.notes,
          items: {
            create: itemsForCreation,
          },
          payments: {
            create: data.payments.map((p) => ({
              method: p.method as PaymentMethod,
              amount: p.amount,
              referenceNumber: p.referenceNumber,
            })),
          },
        },
        include: {
          items: {
            include: {
              variant: {
                include: { product: true },
              },
            },
          },
          payments: true,
          customer: true,
        },
      });

      // 8. Deduct inventory and create movement records
      for (const item of saleItemsData) {
        await tx.inventory.update({
          where: {
            variantId_branchId: {
              variantId: item.variantId,
              branchId,
            },
          },
          data: { quantity: { decrement: item.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            branchId,
            type: MovementType.sale,
            quantity: -item.quantity,
            referenceId: sale.id,
            referenceType: 'sale',
            createdBy: userId,
          },
        });
      }

      // 9. Update customer if provided
      if (data.customerId) {
        // Calculate loyalty points earned
        const loyaltyConfig = await tx.loyaltyConfig.findFirst();
        let pointsEarned = 0;

        if (loyaltyConfig) {
          const customer = await tx.customer.findUnique({
            where: { id: data.customerId },
          });

          const multipliers = loyaltyConfig.earningMultipliers as Record<string, number>;
          const multiplier = customer ? (multipliers[customer.loyaltyTier] || 1) : 1;
          const pointsPer = loyaltyConfig.pointsPerAmount;
          const amountPer = loyaltyConfig.amountPerPoint;

          pointsEarned = Math.floor((saleTotal / amountPer) * pointsPer * multiplier);
        }

        // Deduct redeemed points and add earned points
        const pointsDelta = pointsEarned - (data.loyaltyPointsRedeem || 0);

        await tx.customer.update({
          where: { id: data.customerId },
          data: {
            visitCount: { increment: 1 },
            totalSpent: { increment: saleTotal },
            loyaltyPoints: { increment: pointsDelta },
          },
        });

        // Update sale with loyalty points earned
        await tx.sale.update({
          where: { id: sale.id },
          data: { loyaltyPointsEarned: pointsEarned },
        });

        // Create loyalty transactions
        if (pointsEarned > 0) {
          await tx.loyaltyTransaction.create({
            data: {
              customerId: data.customerId,
              saleId: sale.id,
              points: pointsEarned,
              type: 'earned',
              description: `Points earned from sale ${saleNumber}`,
            },
          });
        }

        if (data.loyaltyPointsRedeem && data.loyaltyPointsRedeem > 0) {
          await tx.loyaltyTransaction.create({
            data: {
              customerId: data.customerId,
              saleId: sale.id,
              points: -data.loyaltyPointsRedeem,
              type: 'redeemed',
              description: `Points redeemed on sale ${saleNumber}`,
            },
          });
        }

        sale.loyaltyPointsEarned = pointsEarned;
      }

      // 10. Calculate change for cash payments
      const change = Math.round((totalPayments - saleTotal) * 100) / 100;

      return { sale, change };
    });
  }

  async holdCart(
    userId: number,
    branchId: number,
    cartData: any,
    customerId?: number,
    notes?: string
  ) {
    const held = await prisma.heldTransaction.create({
      data: {
        branchId,
        userId,
        cartData,
        customerId: customerId || null,
        notes,
      },
      include: { customer: true },
    });

    return held;
  }

  async listHeld(branchId: number) {
    const held = await prisma.heldTransaction.findMany({
      where: { branchId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        customer: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return held;
  }

  async deleteHeld(id: number) {
    const held = await prisma.heldTransaction.findUnique({ where: { id } });

    if (!held) {
      throw new AppError('Held transaction not found', 404);
    }

    await prisma.heldTransaction.delete({ where: { id } });
  }

  async resumeHeld(id: number) {
    const held = await prisma.heldTransaction.findUnique({
      where: { id },
      include: { customer: true },
    });

    if (!held) {
      throw new AppError('Held transaction not found', 404);
    }

    await prisma.heldTransaction.delete({ where: { id } });

    return held;
  }
}

export const posService = new PosService();
