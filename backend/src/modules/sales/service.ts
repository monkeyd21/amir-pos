import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { generateNumber, getPagination, buildPaginationMeta, fullName } from '../../utils/helpers';
import { recordAudit } from '../../services/audit';
import { reconcileCommissionsForSale } from '../../services/commission-reconcile';
import { creditBackVouchers, redeemVouchers } from '../vouchers/service';
import { evaluateCart as evaluateCartEngine } from '../offers/engine';
import { MovementType, PaymentMethod, Prisma, SaleStatus } from '@prisma/client';

export class SalesService {
  async listSales(query: {
    branchId?: string;
    status?: string;
    customerId?: string;
    startDate?: string;
    endDate?: string;
    page?: string;
    limit?: string;
  }, userBranchId: number) {
    const { page, limit, skip } = getPagination(query);

    const where: Prisma.SaleWhereInput = {};

    where.branchId = query.branchId ? parseInt(query.branchId) : userBranchId;

    if (query.status) {
      where.status = query.status as SaleStatus;
    }

    if (query.customerId) {
      where.customerId = parseInt(query.customerId);
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        include: {
          customer: true,
          user: { select: { id: true, firstName: true, lastName: true } },
          items: { include: { variant: { include: { product: true } } } },
          payments: true,
          _count: { select: { returns: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.sale.count({ where }),
    ]);

    return {
      data: sales,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  /**
   * Find the bills that contain a still-returnable unit of the scanned
   * barcode's variant. Powers "scan the returned item to start an exchange":
   * the cashier scans the physical product, we surface which past sale(s) it
   * came from so they can pick the right one.
   */
  async getReturnableByBarcode(barcode: string, branchId: number) {
    const variant = await prisma.productVariant.findFirst({
      where: { barcode },
      include: { product: { include: { brand: true } } },
    });
    if (!variant) {
      throw new AppError(`Barcode not found: ${barcode}`, 404);
    }

    const saleItems = await prisma.saleItem.findMany({
      where: {
        variantId: variant.id,
        sale: {
          branchId,
          status: { in: ['completed', 'partially_returned'] },
        },
      },
      include: {
        sale: {
          select: {
            id: true,
            saleNumber: true,
            createdAt: true,
            customer: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { sale: { createdAt: 'desc' } },
      take: 50,
    });

    // Column-to-column (returnedQuantity < quantity) can't be expressed in the
    // where clause, so filter the still-returnable lines here.
    const candidates = saleItems
      .filter((si) => si.quantity - si.returnedQuantity > 0)
      .slice(0, 20)
      .map((si) => ({
        saleId: si.sale.id,
        saleNumber: si.sale.saleNumber,
        saleDate: si.sale.createdAt,
        customerName: si.sale.customer ? fullName(si.sale.customer) : null,
        saleItemId: si.id,
        productName: variant.product.name,
        size: variant.size,
        color: variant.color,
        available: si.quantity - si.returnedQuantity,
        unitPrice: Number(si.effectiveUnitPrice ?? si.unitPrice),
      }));

    return {
      variant: {
        productName: variant.product.name,
        size: variant.size,
        color: variant.color,
      },
      candidates,
    };
  }

  /** Attach the originating Return (original bill + returned items) when this
   *  sale settled part of its value with an exchange credit. exchangeReturnId
   *  is a plain scalar (no relation), so we resolve it here. */
  private async attachExchangeReturn(sale: any) {
    if (!sale?.exchangeReturnId) return sale;
    const exchangeReturn = await prisma.return.findUnique({
      where: { id: sale.exchangeReturnId },
      include: {
        originalSale: { select: { id: true, saleNumber: true } },
        items: {
          include: {
            variant: { include: { product: { include: { brand: true } } } },
          },
        },
      },
    });
    return { ...sale, exchangeReturn };
  }

  async getSaleById(id: number) {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        branch: true,
        customer: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            variant: {
              include: {
                product: { include: { brand: true, category: true } },
              },
            },
            agent: { select: { id: true, firstName: true, lastName: true } },
            returnItems: true,
          },
        },
        payments: true,
        returns: {
          include: {
            items: {
              include: {
                variant: { include: { product: true } },
              },
            },
          },
        },
      },
    });

    if (!sale) {
      throw new AppError('Sale not found', 404);
    }

    return this.attachExchangeReturn(sale);
  }

  async getSaleBySaleNumber(saleNumber: string) {
    const sale = await prisma.sale.findFirst({
      where: { saleNumber },
      include: {
        branch: true,
        customer: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            variant: {
              include: {
                product: { include: { brand: true, category: true } },
              },
            },
            agent: { select: { id: true, firstName: true, lastName: true } },
            returnItems: true,
          },
        },
        payments: true,
        returns: {
          include: {
            items: {
              include: {
                variant: { include: { product: true } },
              },
            },
          },
        },
      },
    });

    if (!sale) {
      throw new AppError('Sale not found', 404);
    }

    return this.attachExchangeReturn(sale);
  }

  async getReceiptData(id: number) {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        branch: true,
        customer: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        items: {
          include: {
            variant: {
              include: { product: true },
            },
          },
        },
        payments: true,
      },
    });

    if (!sale) {
      throw new AppError('Sale not found', 404);
    }

    // Exchange: goods returned at the counter, credited against this bill.
    const exchangeCredit = Number(sale.exchangeCreditAmount || 0);
    let exchangeOriginalSaleNumber: string | null = null;
    if (sale.exchangeReturnId) {
      const ret = await prisma.return.findUnique({
        where: { id: sale.exchangeReturnId },
        select: { originalSale: { select: { saleNumber: true } } },
      });
      exchangeOriginalSaleNumber = ret?.originalSale?.saleNumber ?? null;
    }
    const exchangeRefund =
      exchangeCredit > Number(sale.total)
        ? Math.round((exchangeCredit - Number(sale.total)) * 100) / 100
        : 0;

    return {
      receiptHeader: sale.branch.receiptHeader,
      receiptFooter: sale.branch.receiptFooter,
      branchName: sale.branch.name,
      branchAddress: sale.branch.address,
      branchPhone: sale.branch.phone,
      saleNumber: sale.saleNumber,
      date: sale.createdAt,
      cashier: `${sale.user.firstName} ${sale.user.lastName}`,
      customer: sale.customer
        ? { name: fullName(sale.customer), phone: sale.customer.phone }
        : null,
      items: sale.items.map((item) => ({
        name: item.variant.product.name,
        variant: `${item.variant.size} / ${item.variant.color}`,
        sku: item.variant.sku,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
        taxAmount: Number(item.taxAmount),
        total: Number(item.total),
      })),
      subtotal: Number(sale.subtotal),
      taxAmount: Number(sale.taxAmount),
      discountAmount: Number(sale.discountAmount),
      total: Number(sale.total),
      payments: sale.payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        referenceNumber: p.referenceNumber,
      })),
      loyaltyPointsEarned: sale.loyaltyPointsEarned,
      loyaltyPointsRedeemed: sale.loyaltyPointsRedeemed,
      exchangeCredit,
      exchangeRefund,
      exchangeOriginalSaleNumber,
    };
  }

  async processReturn(
    saleId: number,
    data: {
      items: { saleItemId: number; quantity: number; condition: 'resellable' | 'damaged' }[];
      reason: string;
      // Optional override of how the refund is settled. Default 'proportional'
      // mirrors the original payment split. Forcing a single method requires
      // manager/owner role (checked below) and is recorded in the audit log.
      refundMode?: 'proportional' | 'cash' | 'card' | 'upi';
    },
    userId: number,
    branchId: number,
    role?: string
  ) {
    return prisma.$transaction(async (tx) => {
      // Get the original sale + how it was paid (needed to refund to the
      // original sources rather than blindly handing back cash).
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: {
          items: { include: { variant: { include: { product: true } } } },
          payments: true,
        },
      });

      if (!sale) {
        throw new AppError('Sale not found', 404);
      }

      if (sale.status === 'void') {
        throw new AppError('Cannot return a voided sale', 400);
      }

      const refundMode = data.refundMode ?? 'proportional';
      if (refundMode !== 'proportional' && !(role === 'owner' || role === 'manager')) {
        throw new AppError('Only a manager or owner can override the refund method', 403);
      }

      const saleItemsMap = new Map(sale.items.map((i) => [i.id, i]));

      let returnSubtotal = 0;
      let returnTax = 0;
      const returnItemsData: Array<{
        saleItemId: number;
        variantId: number;
        quantity: number;
        unitPrice: number;
        condition: 'resellable' | 'damaged';
      }> = [];

      // Validate return quantities
      for (const item of data.items) {
        const saleItem = saleItemsMap.get(item.saleItemId);

        if (!saleItem) {
          throw new AppError(`Sale item ${item.saleItemId} not found in this sale`, 400);
        }

        // Enforce sale policy: non-returnable goods can't come back at all —
        // either the product is flagged, or the cashier marked this specific
        // line non-returnable at checkout (clearance/defective sold as-is).
        // Exchange-only goods can't be refund-returned (use an exchange).
        const product = (saleItem as any).variant?.product;
        const productName = product?.name ?? `item ${item.saleItemId}`;
        if ((saleItem as any).nonReturnable || product?.nonReturnable) {
          throw new AppError(`${productName} is marked non-returnable and cannot be returned`, 400);
        }
        if (product?.exchangeOnly) {
          throw new AppError(`${productName} is exchange-only — process an exchange, not a refund`, 400);
        }

        const availableForReturn = saleItem.quantity - saleItem.returnedQuantity;

        if (item.quantity > availableForReturn) {
          throw new AppError(
            `Cannot return ${item.quantity} of sale item ${item.saleItemId}. Max returnable: ${availableForReturn}`,
            400
          );
        }

        // Refund what the customer ACTUALLY paid for this line, not the shelf
        // price. SaleItem.total already nets out every discount — the offer,
        // the apportioned bill-level manual discount, AND the apportioned
        // loyalty redemption — so (total / quantity) is the true per-unit paid
        // amount. (effectiveUnitPrice only reflected offers, so it over-refunded
        // whenever a manual or loyalty discount was applied — the ₹2780 bug.)
        // Prices are tax-inclusive (MRP), so the refund IS the line total; the
        // extracted GST is recorded separately for the GSTR-1 credit-note trail.
        const paidPerUnit = Number(saleItem.total) / saleItem.quantity;
        const unitPrice = Math.round(paidPerUnit * 100) / 100;
        const itemSubtotal = paidPerUnit * item.quantity;
        const itemTax = (Number(saleItem.taxAmount) / saleItem.quantity) * item.quantity;

        returnSubtotal += itemSubtotal;
        returnTax += itemTax;

        returnItemsData.push({
          saleItemId: item.saleItemId,
          variantId: saleItem.variantId,
          quantity: item.quantity,
          unitPrice,
          condition: item.condition,
        });
      }

      returnSubtotal = Math.round(returnSubtotal * 100) / 100;
      returnTax = Math.round(returnTax * 100) / 100;
      // Tax-inclusive: returnSubtotal already contains the GST the customer
      // paid. The refund amount = returnSubtotal, not returnSubtotal + tax.
      const returnTotal = returnSubtotal;

      const returnNumber = generateNumber('RT');

      // ─── Refund settlement ────────────────────────────────────────────
      // sum(SaleItem.total) == sale.total == the cash/card/UPI the customer
      // actually tendered (loyalty was already netted out of the line totals).
      // So `returnTotal` is the cash-side amount to give back; the loyalty
      // portion is restored as points separately. Apportion both by the share
      // of the sale's settled value being returned.
      const settledCash = Number(sale.total); // cash/card/upi tendered
      const fraction =
        settledCash > 0 ? Math.min(1, returnTotal / settledCash) : (returnTotal > 0 ? 1 : 0);

      // Split the cash refund across the original tenders.
      const cashTenders = sale.payments.filter((p) => p.status !== 'refunded');
      const tenderTotal = cashTenders.reduce((s, p) => s + Number(p.amount), 0);
      let refundBreakup: { method: string; amount: number }[] = [];
      if (refundMode === 'proportional') {
        if (tenderTotal > 0) {
          const byMethod = new Map<string, number>();
          for (const p of cashTenders) {
            const share = (Number(p.amount) / tenderTotal) * returnTotal;
            byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + share);
          }
          refundBreakup = [...byMethod].map(([method, amount]) => ({
            method,
            amount: Math.round(amount * 100) / 100,
          }));
        } else if (returnTotal > 0) {
          // No recorded tender (e.g. fully points/exchange-settled) — give cash.
          refundBreakup = [{ method: 'cash', amount: returnTotal }];
        }
      } else {
        // Manager override — single forced method (already role-gated above).
        refundBreakup = [{ method: refundMode, amount: returnTotal }];
      }
      // Fix any rounding drift so the breakup sums exactly to returnTotal.
      if (refundBreakup.length > 0) {
        const drift =
          Math.round((returnTotal - refundBreakup.reduce((s, r) => s + r.amount, 0)) * 100) / 100;
        if (drift !== 0) refundBreakup[0].amount = Math.round((refundBreakup[0].amount + drift) * 100) / 100;
      }

      // Loyalty: restore the redeemed points consumed by the returned items, and
      // claw back the points earned on them, proportional to the returned share.
      const pointsRestored = Math.round((sale.loyaltyPointsRedeemed || 0) * fraction);
      const pointsReversed = Math.round((sale.loyaltyPointsEarned || 0) * fraction);

      // Create Return record
      const returnRecord = await tx.return.create({
        data: {
          originalSaleId: saleId,
          branchId,
          userId,
          returnNumber,
          type: 'return',
          reason: data.reason,
          subtotal: returnSubtotal,
          taxAmount: returnTax,
          total: returnTotal,
          status: 'completed',
          refundMode,
          refundBreakup,
          loyaltyPointsRestored: pointsRestored,
          loyaltyPointsReversed: pointsReversed,
          approvedBy: refundMode !== 'proportional' ? userId : null,
          items: {
            create: returnItemsData.map((item) => ({
              saleItemId: item.saleItemId,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              condition: item.condition,
            })),
          },
        },
        include: {
          items: {
            include: {
              variant: { include: { product: true } },
            },
          },
        },
      });

      // Update SaleItem.returnedQuantity and restock if resellable
      for (const item of returnItemsData) {
        await tx.saleItem.update({
          where: { id: item.saleItemId },
          data: { returnedQuantity: { increment: item.quantity } },
        });

        if (item.condition === 'resellable') {
          await tx.inventory.upsert({
            where: {
              variantId_branchId: {
                variantId: item.variantId,
                branchId,
              },
            },
            update: { quantity: { increment: item.quantity } },
            create: {
              variantId: item.variantId,
              branchId,
              quantity: item.quantity,
            },
          });

          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              branchId,
              type: MovementType.return,
              quantity: item.quantity,
              referenceId: returnRecord.id,
              referenceType: 'return',
              createdBy: userId,
            },
          });
        }
      }

      // Determine new sale status
      const updatedSaleItems = await tx.saleItem.findMany({
        where: { saleId },
      });

      const allReturned = updatedSaleItems.every(
        (item) => item.returnedQuantity >= item.quantity
      );
      const someReturned = updatedSaleItems.some(
        (item) => item.returnedQuantity > 0
      );

      let newStatus: SaleStatus = sale.status;
      if (allReturned) {
        newStatus = 'returned';
      } else if (someReturned) {
        newStatus = 'partially_returned';
      }

      await tx.sale.update({
        where: { id: saleId },
        data: { status: newStatus },
      });

      // ─── Customer-side effects: loyalty wallet + lifetime spend ──────────
      if (sale.customerId && (pointsRestored !== 0 || pointsReversed !== 0 || returnTotal > 0)) {
        const pointsDelta = pointsRestored - pointsReversed;
        await tx.customer.update({
          where: { id: sale.customerId },
          data: {
            loyaltyPoints: { increment: pointsDelta },
            totalSpent: { decrement: returnTotal },
          },
        });
        if (pointsRestored > 0) {
          await tx.loyaltyTransaction.create({
            data: {
              customerId: sale.customerId,
              saleId,
              points: pointsRestored,
              type: 'adjusted',
              description: `Points restored on return ${returnNumber}`,
            },
          });
        }
        if (pointsReversed > 0) {
          await tx.loyaltyTransaction.create({
            data: {
              customerId: sale.customerId,
              saleId,
              points: -pointsReversed,
              type: 'adjusted',
              description: `Earned points reversed on return ${returnNumber}`,
            },
          });
        }
      }

      // Any voucher-tendered portion of the refund goes back onto the voucher,
      // not the cash drawer — re-credit the balance.
      const voucherRefund = refundBreakup
        .filter((r) => r.method === 'voucher')
        .reduce((s, r) => s + r.amount, 0);
      if (voucherRefund > 0) {
        await creditBackVouchers(tx, saleId, voucherRefund, userId, branchId);
      }

      // Re-settle the salesman/cashier commission for the returned value.
      await reconcileCommissionsForSale(tx, saleId, userId, branchId);

      // Audit trail — who refunded what, how, and (if overridden) why.
      await recordAudit(tx, {
        action: refundMode === 'proportional' ? 'return.created' : 'refund.method_overridden',
        entityType: 'return',
        entityId: returnRecord.id,
        userId,
        branchId,
        reason: data.reason,
        data: {
          saleNumber: sale.saleNumber,
          returnTotal,
          refundMode,
          refundBreakup,
          loyaltyPointsRestored: pointsRestored,
          loyaltyPointsReversed: pointsReversed,
        },
      });

      return { returnRecord, refundAmount: returnTotal, refundBreakup, refundMode };
    });
  }

  async processExchange(
    saleId: number,
    data: {
      returnItems: { saleItemId: number; quantity: number; condition: 'resellable' | 'damaged' }[];
      newItems: { barcode: string; quantity: number }[];
      reason?: string;
    },
    userId: number,
    branchId: number
  ) {
    return prisma.$transaction(async (tx) => {
      // Get original sale
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { items: true },
      });

      if (!sale) {
        throw new AppError('Sale not found', 404);
      }

      if (sale.status === 'void') {
        throw new AppError('Cannot exchange on a voided sale', 400);
      }

      const saleItemsMap = new Map(sale.items.map((i) => [i.id, i]));

      // Calculate return value
      let returnSubtotal = 0;
      let returnTax = 0;
      const returnItemsData: Array<{
        saleItemId: number;
        variantId: number;
        quantity: number;
        unitPrice: number;
        condition: 'resellable' | 'damaged';
      }> = [];

      for (const item of data.returnItems) {
        const saleItem = saleItemsMap.get(item.saleItemId);

        if (!saleItem) {
          throw new AppError(`Sale item ${item.saleItemId} not found in this sale`, 400);
        }

        const availableForReturn = saleItem.quantity - saleItem.returnedQuantity;

        if (item.quantity > availableForReturn) {
          throw new AppError(
            `Cannot return ${item.quantity} of sale item ${item.saleItemId}. Max returnable: ${availableForReturn}`,
            400
          );
        }

        // See comment in `processReturn` — refund at effectiveUnitPrice when offer applied.
        const unitPrice = Number(saleItem.effectiveUnitPrice ?? saleItem.unitPrice);
        const itemSubtotal = unitPrice * item.quantity;
        const itemTax = (Number(saleItem.taxAmount) / saleItem.quantity) * item.quantity;

        returnSubtotal += itemSubtotal;
        returnTax += itemTax;

        returnItemsData.push({
          saleItemId: item.saleItemId,
          variantId: saleItem.variantId,
          quantity: item.quantity,
          unitPrice,
          condition: item.condition,
        });
      }

      // Tax-inclusive: the return value IS the returnSubtotal — GST is
      // already baked into the MRP the customer originally paid.
      const returnTotal = Math.round(returnSubtotal * 100) / 100;

      // Resolve new items
      const barcodes = data.newItems.map((i) => i.barcode);
      const variants = await tx.productVariant.findMany({
        where: { barcode: { in: barcodes }, isActive: true },
        include: { product: true },
      });

      const variantByBarcode = new Map(variants.map((v) => [v.barcode, v]));

      let newSubtotal = 0;
      let newTax = 0;
      const newItemsValidated: Array<{
        variantId: number;
        quantity: number;
        unitPrice: number;
        taxRate: number;
      }> = [];

      for (const item of data.newItems) {
        const variant = variantByBarcode.get(item.barcode);

        if (!variant) {
          throw new AppError(`Barcode not found: ${item.barcode}`, 400);
        }

        // Check stock
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
            `Insufficient stock for ${variant.product.name} (${variant.size}/${variant.color}). Available: ${inventory?.quantity ?? 0}`,
            400
          );
        }

        const rawPrice = Number(variant.priceOverride ?? variant.product.basePrice);
        const taxRate =
          Number(variant.product.cgstRate) + Number(variant.product.sgstRate);
        const unitPrice = variant.product.priceIncludesTax
          ? rawPrice
          : Math.round(rawPrice * (1 + taxRate / 100) * 100) / 100;
        const lineSubtotal = unitPrice * item.quantity;
        // Tax-inclusive extraction — MRP already contains GST.
        const lineTax = lineSubtotal * (taxRate / (100 + taxRate));

        newSubtotal += lineSubtotal;
        newTax += lineTax;

        newItemsValidated.push({
          variantId: variant.id,
          quantity: item.quantity,
          unitPrice,
          taxRate,
        });
      }

      // Exchange "charge" side is also tax-inclusive — the customer pays
      // the MRP of the new items, no tax added on top.
      const newTotal = Math.round(newSubtotal * 100) / 100;
      const priceDifference = Math.round((newTotal - returnTotal) * 100) / 100;

      // Create return record
      const returnNumber = generateNumber('RT');

      const returnRecord = await tx.return.create({
        data: {
          originalSaleId: saleId,
          branchId,
          userId,
          returnNumber,
          type: 'exchange',
          reason: data.reason || 'Exchange',
          subtotal: Math.round(returnSubtotal * 100) / 100,
          taxAmount: Math.round(returnTax * 100) / 100,
          total: returnTotal,
          status: 'completed',
          items: {
            create: returnItemsData.map((item) => ({
              saleItemId: item.saleItemId,
              variantId: item.variantId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              condition: item.condition,
            })),
          },
        },
        include: { items: true },
      });

      // Update return quantities and restock
      for (const item of returnItemsData) {
        await tx.saleItem.update({
          where: { id: item.saleItemId },
          data: { returnedQuantity: { increment: item.quantity } },
        });

        if (item.condition === 'resellable') {
          await tx.inventory.upsert({
            where: {
              variantId_branchId: {
                variantId: item.variantId,
                branchId,
              },
            },
            update: { quantity: { increment: item.quantity } },
            create: {
              variantId: item.variantId,
              branchId,
              quantity: item.quantity,
            },
          });

          await tx.inventoryMovement.create({
            data: {
              variantId: item.variantId,
              branchId,
              type: MovementType.return,
              quantity: item.quantity,
              referenceId: returnRecord.id,
              referenceType: 'return',
              createdBy: userId,
            },
          });
        }
      }

      // Deduct new items from inventory
      for (const item of newItemsValidated) {
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
            referenceId: returnRecord.id,
            referenceType: 'exchange',
            createdBy: userId,
          },
        });
      }

      // Update sale status
      const updatedSaleItems = await tx.saleItem.findMany({
        where: { saleId },
      });

      const allReturned = updatedSaleItems.every(
        (item) => item.returnedQuantity >= item.quantity
      );
      const someReturned = updatedSaleItems.some(
        (item) => item.returnedQuantity > 0
      );

      let newStatus: SaleStatus = sale.status;
      if (allReturned) {
        newStatus = 'returned';
      } else if (someReturned) {
        newStatus = 'partially_returned';
      }

      await tx.sale.update({
        where: { id: saleId },
        data: { status: newStatus },
      });

      // Returned goods reduce the original sale's value — re-settle commission.
      await reconcileCommissionsForSale(tx, saleId, userId, branchId);
      await recordAudit(tx, {
        action: 'exchange.created',
        entityType: 'return',
        entityId: returnRecord.id,
        userId,
        branchId,
        reason: data.reason,
        data: { originalSaleId: saleId, returnTotal, newItemsTotal: newTotal, priceDifference },
      });

      return {
        returnRecord,
        returnTotal,
        newItemsTotal: newTotal,
        priceDifference,
        message:
          priceDifference > 0
            ? `Customer owes ${priceDifference}`
            : priceDifference < 0
            ? `Refund ${Math.abs(priceDifference)} to customer`
            : 'Even exchange - no payment needed',
      };
    });
  }
  /**
   * Bulk-assign agent to sale items. Supports both:
   * - All items in a sale (agentId on body, no items array)
   * - Specific items (items: [{ saleItemId, agentId }])
   */
  /**
   * Edit a completed bill (manager/owner). The caller sends the DESIRED final
   * item set — existing lines carry their saleItemId, new lines a barcode, and
   * any omitted line is removed. The whole bill is repriced (offers + the same
   * tax-inclusive discount apportionment as checkout), then inventory, loyalty,
   * commission and the payment difference are reconciled. A price rise is
   * collected via `payments`/`vouchers`; a drop is refunded proportionally to
   * the original tenders. Every edit is audited with a before/after snapshot.
   */
  async editSale(
    saleId: number,
    data: {
      items: { saleItemId?: number; barcode?: string; quantity: number; agentId?: number | null }[];
      discountAmount?: number;
      reason: string;
      settlementMethod?: 'cash' | 'card' | 'upi';
      settlementIdentifier?: string;
      payments?: { method: string; amount: number; referenceNumber?: string; identifier?: string }[];
      vouchers?: { code: string; amount: number }[];
    },
    userId: number,
    branchId: number,
    role?: string
  ) {
    if (role !== 'owner' && role !== 'manager') {
      throw new AppError('Only a manager or owner can edit a bill', 403);
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { items: true, payments: true },
      });
      if (!sale) throw new AppError('Sale not found', 404);
      if (sale.status === 'void') throw new AppError('Cannot edit a voided sale', 400);

      const existingById = new Map(sale.items.map((i) => [i.id, i]));

      // ── Resolve desired lines. Existing lines keep their original unit price
      //    (fair — don't re-price already-sold goods); new lines use shelf price.
      const newBarcodes = data.items.filter((i) => !i.saleItemId && i.barcode).map((i) => i.barcode!);
      const newVariants = newBarcodes.length
        ? await tx.productVariant.findMany({
            where: { barcode: { in: newBarcodes }, isActive: true },
            include: { product: true },
          })
        : [];
      const variantByBarcode = new Map(newVariants.map((v) => [v.barcode, v]));

      interface DLine {
        saleItemId?: number;
        variantId: number;
        quantity: number;
        unitPrice: number;
        taxRate: number;
        agentId: number | null;
      }
      const desired: DLine[] = [];
      for (const it of data.items) {
        if (it.saleItemId != null) {
          const ex = existingById.get(it.saleItemId);
          if (!ex) throw new AppError(`Sale item ${it.saleItemId} is not part of this sale`, 400);
          if (it.quantity < ex.returnedQuantity) {
            throw new AppError(
              `Sale item ${it.saleItemId}: quantity can't drop below the ${ex.returnedQuantity} already returned`,
              400
            );
          }
          const variant = await tx.productVariant.findUnique({
            where: { id: ex.variantId },
            include: { product: true },
          });
          if (!variant) throw new AppError(`Variant for sale item ${it.saleItemId} not found`, 400);
          const taxRate = Number(variant.product.cgstRate) + Number(variant.product.sgstRate);
          desired.push({
            saleItemId: ex.id,
            variantId: ex.variantId,
            quantity: it.quantity,
            unitPrice: Number(ex.unitPrice),
            taxRate,
            agentId: it.agentId ?? ex.agentId,
          });
        } else {
          if (!it.barcode) throw new AppError('A new line needs a barcode', 400);
          const variant = variantByBarcode.get(it.barcode);
          if (!variant) throw new AppError(`Barcode not found: ${it.barcode}`, 400);
          const taxRate = Number(variant.product.cgstRate) + Number(variant.product.sgstRate);
          const raw = Number(variant.priceOverride ?? variant.product.basePrice);
          const unitPrice = variant.product.priceIncludesTax ? raw : round2(raw * (1 + taxRate / 100));
          desired.push({ variantId: variant.id, quantity: it.quantity, unitPrice, taxRate, agentId: it.agentId ?? userId });
        }
      }

      // ── Inventory diff, by SOLD quantity (returns are tracked separately). ──
      const oldQty = new Map<number, number>();
      for (const i of sale.items) oldQty.set(i.variantId, (oldQty.get(i.variantId) ?? 0) + i.quantity);
      const newQty = new Map<number, number>();
      for (const d of desired) newQty.set(d.variantId, (newQty.get(d.variantId) ?? 0) + d.quantity);

      for (const vId of new Set<number>([...oldQty.keys(), ...newQty.keys()])) {
        const delta = (newQty.get(vId) ?? 0) - (oldQty.get(vId) ?? 0);
        if (delta === 0) continue;
        if (delta > 0) {
          const inv = await tx.inventory.findUnique({
            where: { variantId_branchId: { variantId: vId, branchId } },
          });
          if (!inv || inv.quantity < delta) {
            throw new AppError(`Insufficient stock to add ${delta} of variant ${vId} (available ${inv?.quantity ?? 0})`, 400);
          }
        }
        await tx.inventory.upsert({
          where: { variantId_branchId: { variantId: vId, branchId } },
          update: { quantity: { decrement: delta } }, // delta>0 takes stock, delta<0 restocks
          create: { variantId: vId, branchId, quantity: -delta },
        });
        await tx.inventoryMovement.create({
          data: {
            variantId: vId,
            branchId,
            type: delta > 0 ? MovementType.sale : MovementType.return,
            quantity: -delta,
            referenceId: saleId,
            referenceType: 'edit',
            createdBy: userId,
          },
        });
      }

      // ── Reprice: offers + apportioned manual & (preserved) loyalty discount. ──
      const manualDiscount = data.discountAmount ?? 0;
      let loyaltyDiscount = 0;
      if (sale.loyaltyPointsRedeemed > 0) {
        const cfg = await tx.loyaltyConfig.findFirst();
        loyaltyDiscount = round2(sale.loyaltyPointsRedeemed * (cfg ? Number(cfg.redemptionValue) : 1));
      }

      const evaluated = await evaluateCartEngine(
        desired.map((d) => ({ variantId: d.variantId, quantity: d.quantity, unitPrice: d.unitPrice }))
      );
      const offerByVariant = new Map<number, { offerId: number; discount: number; effectiveUnitPrice: number }>();
      for (const e of evaluated) {
        if (e.offer && e.result?.qualified) {
          offerByVariant.set(e.line.variantId, {
            offerId: e.offer.id,
            discount: e.result.discountAmount,
            effectiveUnitPrice: e.result.effectiveUnitPrice,
          });
        }
      }

      let subtotal = 0;
      let totalOfferDiscount = 0;
      const acc = desired.map((d) => {
        const lineGross = d.unitPrice * d.quantity;
        const offerInfo = offerByVariant.get(d.variantId);
        const offerDiscount = offerInfo?.discount ?? 0;
        subtotal += lineGross;
        totalOfferDiscount += offerDiscount;
        return {
          ...d,
          lineGross,
          offerDiscount,
          offerId: offerInfo?.offerId ?? null,
          effectiveUnitPrice: offerInfo?.effectiveUnitPrice ?? null,
        };
      });
      subtotal = round2(subtotal);
      totalOfferDiscount = round2(totalOfferDiscount);

      const nonOfferDiscount = manualDiscount + loyaltyDiscount;
      const postOfferTaxable = subtotal - totalOfferDiscount;
      const apportionRatio = postOfferTaxable > 0 ? Math.min(1, nonOfferDiscount / postOfferTaxable) : 0;

      let totalTax = 0;
      const computed = acc.map((line) => {
        const postOffer = line.lineGross - line.offerDiscount;
        const apportioned = round2(postOffer * apportionRatio);
        const lineTaxable = postOffer - apportioned;
        const lineTax = lineTaxable * (line.taxRate / (100 + line.taxRate));
        totalTax += lineTax;
        return {
          saleItemId: line.saleItemId,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: round2(line.offerDiscount + apportioned),
          taxAmount: round2(lineTax),
          total: round2(lineTaxable),
          offerId: line.offerId,
          effectiveUnitPrice: line.effectiveUnitPrice,
          agentId: line.agentId,
        };
      });
      totalTax = round2(totalTax);
      const totalDiscount = round2(manualDiscount + loyaltyDiscount + totalOfferDiscount);
      const newSaleTotal = round2(subtotal - totalDiscount);
      if (newSaleTotal < 0) throw new AppError('Discount exceeds the bill total', 400);

      // ── Apply item changes (update kept, create new, delete dropped). ──
      const keptIds = new Set<number>();
      for (const c of computed) {
        const payload = {
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          discount: c.discount,
          taxAmount: c.taxAmount,
          total: c.total,
          offerId: c.offerId,
          effectiveUnitPrice: c.effectiveUnitPrice,
          agentId: c.agentId,
        };
        if (c.saleItemId) {
          keptIds.add(c.saleItemId);
          await tx.saleItem.update({ where: { id: c.saleItemId }, data: payload });
        } else {
          await tx.saleItem.create({ data: { saleId, variantId: c.variantId, ...payload } });
        }
      }
      for (const ex of sale.items) {
        if (keptIds.has(ex.id)) continue;
        if (ex.returnedQuantity > 0) {
          throw new AppError(`Cannot remove sale item ${ex.id} — it has returned units`, 400);
        }
        await tx.saleItem.delete({ where: { id: ex.id } });
      }

      // ── Settle the difference between the new total and what was paid. ──
      const oldTotal = Number(sale.total);
      const diff = round2(newSaleTotal - oldTotal);
      let refundBreakup: { method: string; amount: number }[] = [];

      if (diff > 0.0001) {
        // Simple path: collect the EXACT difference via one named method.
        if (data.settlementMethod) {
          await tx.payment.create({
            data: {
              saleId,
              method: data.settlementMethod as PaymentMethod,
              amount: diff,
              identifier: data.settlementIdentifier,
            },
          });
          // Skip the explicit-tender path below.
          data = { ...data, payments: undefined, vouchers: undefined };
        }
        const provided = data.payments ?? [];
        const voucherReqs = (data.vouchers ?? []).filter((v) => v.amount > 0);
        const voucherTotal = round2(voucherReqs.reduce((s, v) => s + v.amount, 0));
        const settlement = round2(provided.reduce((s, p) => s + p.amount, 0) + voucherTotal);
        if (!data.settlementMethod && settlement + 0.01 < diff) {
          throw new AppError(`Extra ₹${diff} is due — settlement provided only ₹${settlement}`, 400);
        }
        for (const p of provided) {
          await tx.payment.create({
            data: {
              saleId,
              method: p.method as PaymentMethod,
              amount: p.amount,
              referenceNumber: p.referenceNumber,
              identifier: p.identifier,
            },
          });
        }
        if (voucherReqs.length) {
          const { applied } = await redeemVouchers(tx, voucherReqs, saleId, userId, branchId);
          for (const v of applied) {
            await tx.payment.create({
              data: { saleId, method: 'voucher' as PaymentMethod, amount: v.amount, referenceNumber: v.code },
            });
          }
        }
      } else if (diff < -0.0001) {
        const refundAmt = round2(-diff);
        const tenders = sale.payments.filter((p) => p.status !== 'refunded');
        const tenderTotal = tenders.reduce((s, p) => s + Number(p.amount), 0);
        if (tenderTotal > 0) {
          const byMethod = new Map<string, number>();
          for (const p of tenders) {
            byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + (Number(p.amount) / tenderTotal) * refundAmt);
          }
          refundBreakup = [...byMethod].map(([method, amount]) => ({ method, amount: round2(amount) }));
          const drift = round2(refundAmt - refundBreakup.reduce((s, r) => s + r.amount, 0));
          if (drift !== 0 && refundBreakup.length) refundBreakup[0].amount = round2(refundBreakup[0].amount + drift);
        } else {
          refundBreakup = [{ method: 'cash', amount: refundAmt }];
        }
        // Record each refund as a 'refunded' Payment row (positive amount) so the
        // sale's tenders net out to the new total and cash-drawer reconciliation
        // subtracts cash given back. Voucher value is additionally re-credited.
        for (const r of refundBreakup) {
          if (r.amount <= 0) continue;
          await tx.payment.create({
            data: { saleId, method: r.method as PaymentMethod, amount: r.amount, status: 'refunded' },
          });
        }
        const voucherRefund = refundBreakup
          .filter((r) => r.method === 'voucher')
          .reduce((s, r) => s + r.amount, 0);
        if (voucherRefund > 0) await creditBackVouchers(tx, saleId, voucherRefund, userId, branchId);
      }

      // ── Loyalty earned recompute + lifetime spend. (Redemption is preserved.) ──
      let newEarned = sale.loyaltyPointsEarned;
      if (sale.customerId) {
        const cfg = await tx.loyaltyConfig.findFirst();
        if (cfg) {
          const customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
          const multipliers = cfg.earningMultipliers as Record<string, number>;
          const multiplier = customer ? multipliers[customer.loyaltyTier] || 1 : 1;
          newEarned = Math.floor((Math.max(0, newSaleTotal) / cfg.amountPerPoint) * cfg.pointsPerAmount * multiplier);
        }
        const earnedDelta = newEarned - sale.loyaltyPointsEarned;
        const spendDelta = round2(newSaleTotal - oldTotal);
        if (earnedDelta !== 0 || spendDelta !== 0) {
          await tx.customer.update({
            where: { id: sale.customerId },
            data: { loyaltyPoints: { increment: earnedDelta }, totalSpent: { increment: spendDelta } },
          });
        }
        if (earnedDelta !== 0) {
          await tx.loyaltyTransaction.create({
            data: {
              customerId: sale.customerId,
              saleId,
              points: earnedDelta,
              type: 'adjusted',
              description: `Points adjusted on bill edit ${sale.saleNumber}`,
            },
          });
        }
      }

      await tx.sale.update({
        where: { id: saleId },
        data: {
          subtotal,
          taxAmount: totalTax,
          discountAmount: totalDiscount,
          total: newSaleTotal,
          loyaltyPointsEarned: newEarned,
        },
      });

      // Re-settle commission against the edited line totals.
      await reconcileCommissionsForSale(tx, saleId, userId, branchId);

      await recordAudit(tx, {
        action: 'sale.edited',
        entityType: 'sale',
        entityId: saleId,
        userId,
        branchId,
        reason: data.reason,
        data: {
          saleNumber: sale.saleNumber,
          original: {
            total: oldTotal,
            items: sale.items.map((i) => ({ variantId: i.variantId, qty: i.quantity, total: Number(i.total) })),
          },
          updated: {
            total: newSaleTotal,
            items: computed.map((c) => ({ variantId: c.variantId, qty: c.quantity, total: c.total })),
          },
          diff,
          refundBreakup,
        },
      });

      const updated = await tx.sale.findUnique({
        where: { id: saleId },
        include: {
          items: { include: { variant: { include: { product: true } } } },
          payments: true,
        },
      });
      return { sale: updated, oldTotal, newTotal: newSaleTotal, diff, refundBreakup };
    });
  }

  async assignAgents(
    saleId: number,
    data: {
      agentId?: number;
      items?: Array<{ saleItemId: number; agentId: number | null }>;
    }
  ) {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: { select: { id: true } } },
    });
    if (!sale) throw new AppError('Sale not found', 404);

    if (data.items && data.items.length > 0) {
      // Per-item assignment
      const itemIds = new Set(sale.items.map((i) => i.id));
      for (const entry of data.items) {
        if (!itemIds.has(entry.saleItemId)) {
          throw new AppError(`Sale item ${entry.saleItemId} not found in sale ${saleId}`, 400);
        }
      }
      await prisma.$transaction(
        data.items.map((entry) =>
          prisma.saleItem.update({
            where: { id: entry.saleItemId },
            data: { agentId: entry.agentId },
          })
        )
      );
    } else if (data.agentId !== undefined) {
      // Bulk: set same agent on all items
      await prisma.saleItem.updateMany({
        where: { saleId },
        data: { agentId: data.agentId },
      });
    } else {
      throw new AppError('Provide agentId (for all items) or items array (per item)', 400);
    }

    return prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        items: {
          include: {
            variant: { include: { product: true } },
            agent: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });
  }
}

export const salesService = new SalesService();
