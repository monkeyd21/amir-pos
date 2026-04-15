import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { generateNumber } from '../../utils/helpers';
import { MovementType, PaymentMethod } from '@prisma/client';
import { getPaymentGateway } from '../../services/payment-gateway';
import { evaluateCart as evaluateCartEngine, CartLine } from '../offers/engine';

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

    return session || null;
  }

  async checkout(
    data: {
      items: { barcode: string; quantity: number; agentId?: number }[];
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
        agentId: number | null;
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
          agentId: item.agentId ?? userId, // default to cashier if no agent specified
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

        // Get loyalty config for redemption value + minimum threshold
        const loyaltyConfig = await tx.loyaltyConfig.findFirst();
        const minRedeem = loyaltyConfig?.minRedeemPoints ?? 100;
        if (customer.loyaltyPoints < minRedeem) {
          throw new AppError(
            `Minimum ${minRedeem} points required to redeem. Customer has ${customer.loyaltyPoints}.`,
            400
          );
        }
        const redemptionValue = loyaltyConfig ? Number(loyaltyConfig.redemptionValue) : 1;
        loyaltyDiscount = data.loyaltyPointsRedeem * redemptionValue;
      }

      // 3b. Resolve offers server-side (never trust the client)
      const cartLines: CartLine[] = saleItemsData.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      }));
      const evaluated = await evaluateCartEngine(cartLines);
      const offerByVariantId = new Map<
        number,
        { offerId: number; discount: number; effectiveUnitPrice: number }
      >();
      for (const e of evaluated) {
        if (e.offer && e.result?.qualified) {
          offerByVariantId.set(e.line.variantId, {
            offerId: e.offer.id,
            discount: e.result.discountAmount,
            effectiveUnitPrice: e.result.effectiveUnitPrice,
          });
        }
      }

      // ─── Tax-inclusive pricing (Indian clothing retail MRP convention) ───
      //
      // Product prices on hang-tags and in the database are the MRP — the
      // tax is ALREADY baked into the price the customer sees. When we
      // compute line totals we must NOT add tax on top; we must EXTRACT the
      // tax component from within the inclusive amount.
      //
      //   net  = inclusive / (1 + rate/100)
      //   tax  = inclusive - net  =  inclusive × rate / (100 + rate)
      //
      // Example: ₹1180 shelf price at 18% GST → ₹1000 net + ₹180 tax,
      //          and the customer still pays ₹1180 (not ₹1180 + 180).
      //
      // Sale.subtotal is kept as the "gross sum of shelf prices" (pre-
      // discount, tax-inclusive) to preserve reporting semantics —
      // dashboards and the sale detail page show it as the list-price
      // total that the customer saw. Sale.taxAmount stores the extracted
      // GST component for GSTR-1 filings. Sale.total = what the customer
      // actually paid = subtotal − discounts (no tax added on top).
      // Pass 1: gather per-line gross + offer discount. We can't compute tax
      // yet because manual/loyalty discounts still need to be apportioned.
      interface LineAccumulator {
        variantId: number;
        quantity: number;
        unitPrice: number;
        taxRate: number;
        lineGross: number;
        offerDiscount: number;
        offerId: number | null;
        effectiveUnitPrice: number | null;
        agentId: number | null;
      }
      const lines: LineAccumulator[] = [];
      let subtotal = 0;
      let totalOfferDiscount = 0;

      for (const item of saleItemsData) {
        const lineGross = item.unitPrice * item.quantity;
        const offerInfo = offerByVariantId.get(item.variantId);
        const offerDiscount = offerInfo?.discount ?? 0;
        lines.push({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          lineGross,
          offerDiscount,
          offerId: offerInfo?.offerId ?? null,
          effectiveUnitPrice: offerInfo?.effectiveUnitPrice ?? null,
          agentId: item.agentId,
        });
        subtotal += lineGross;
        totalOfferDiscount += offerDiscount;
      }

      subtotal = Math.round(subtotal * 100) / 100;
      totalOfferDiscount = Math.round(totalOfferDiscount * 100) / 100;

      // Apportion manual + loyalty discounts proportionally across lines,
      // weighted by each line's post-offer taxable value. This way the
      // extracted GST reflects what the customer ACTUALLY paid per line
      // after all discount stacking — critical for GSTR-1 accuracy when
      // tax is inclusive. If the non-offer discount exceeds the post-offer
      // taxable base, we clamp per-line adjustments to zero.
      const nonOfferDiscount = discountAmount + loyaltyDiscount;
      const postOfferTaxableTotal = subtotal - totalOfferDiscount;
      const apportionRatio =
        postOfferTaxableTotal > 0
          ? Math.min(1, nonOfferDiscount / postOfferTaxableTotal)
          : 0;

      // Pass 2: compute per-line taxable + tax with the apportioned discount.
      let totalTax = 0;
      const itemsForCreation: Array<{
        variantId: number;
        quantity: number;
        unitPrice: number;
        discount: number;
        taxAmount: number;
        total: number;
        offerId?: number | null;
        effectiveUnitPrice?: number | null;
        agentId?: number | null;
      }> = [];

      for (const line of lines) {
        const postOffer = line.lineGross - line.offerDiscount;
        const apportioned = Math.round(postOffer * apportionRatio * 100) / 100;
        const lineTaxable = postOffer - apportioned;
        // Extract GST from within the inclusive post-discount amount.
        const lineTax = lineTaxable * (line.taxRate / (100 + line.taxRate));
        // Customer pays the inclusive taxable — no tax added on top.
        const lineTotal = lineTaxable;
        const lineDiscountTotal = line.offerDiscount + apportioned;

        totalTax += lineTax;

        itemsForCreation.push({
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: Math.round(lineDiscountTotal * 100) / 100,
          taxAmount: Math.round(lineTax * 100) / 100,
          total: Math.round(lineTotal * 100) / 100,
          offerId: line.offerId,
          effectiveUnitPrice: line.effectiveUnitPrice,
          agentId: line.agentId,
        });
      }

      totalTax = Math.round(totalTax * 100) / 100;
      // Sale.subtotal stays as the "gross shelf total" for reporting so the
      // receipt can show "MRP total / less discount / you pay".
      // Sale.total is what the customer actually pays — tax is already inside
      // subtotal, so we just subtract all discounts.
      const totalDiscount = discountAmount + loyaltyDiscount + totalOfferDiscount;
      const saleTotal = Math.round((subtotal - totalDiscount) * 100) / 100;

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

  /**
   * Evaluate a cart against the offers engine. For each line, returns:
   *   - the resolved offer (variant-level preferred over product-level)
   *   - computed discount + effective unit price + qualification hint
   *   - the base unit price that was used
   */
  async evaluateCart(items: { variantId: number; quantity: number }[]) {
    const variantIds = items.map((i) => i.variantId);
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: { select: { basePrice: true } } },
    });
    const variantMap = new Map(variants.map((v) => [v.id, v]));

    const lines: CartLine[] = items.map((i) => {
      const v = variantMap.get(i.variantId);
      if (!v) {
        throw new AppError(`Variant ${i.variantId} not found`, 404);
      }
      const unitPrice = Number(v.priceOverride ?? v.product.basePrice);
      return { variantId: i.variantId, quantity: i.quantity, unitPrice };
    });

    const evaluated = await evaluateCartEngine(lines);

    return evaluated.map(({ line, offer, result }) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      offer: offer
        ? {
            id: offer.id,
            name: offer.name,
            type: offer.type,
            displayText: result?.displayText ?? '',
          }
        : null,
      qualified: result?.qualified ?? false,
      discountAmount: result?.discountAmount ?? 0,
      effectiveUnitPrice: result?.effectiveUnitPrice ?? 0,
      lineTotal: result?.lineTotal ?? line.unitPrice * line.quantity,
      hint: result?.hint,
    }));
  }

  async lookupBarcode(barcode: string, branchId: number) {
    const variant = await prisma.productVariant.findFirst({
      where: { barcode, isActive: true },
      include: {
        product: {
          include: {
            brand: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!variant) {
      throw new AppError('Product not found for this barcode', 404);
    }

    // Get stock for this branch
    const inventory = await prisma.inventory.findUnique({
      where: {
        variantId_branchId: {
          variantId: variant.id,
          branchId,
        },
      },
    });

    return {
      variantId: variant.id,
      barcode: variant.barcode,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      productName: variant.product.name,
      brand: variant.product.brand?.name,
      category: variant.product.category?.name,
      price: Number(variant.priceOverride ?? variant.product.basePrice),
      costPrice: Number(variant.costOverride ?? variant.product.costPrice),
      taxRate: Number(variant.product.taxRate),
      stock: inventory?.quantity ?? 0,
    };
  }

  async searchProducts(query: string, branchId: number) {
    const variants = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        OR: [
          { product: { name: { contains: query, mode: 'insensitive' } } },
          { product: { brand: { name: { contains: query, mode: 'insensitive' } } } },
          { sku: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query } },
        ],
      },
      include: {
        product: {
          include: {
            brand: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
          },
        },
      },
      take: 20,
    });

    const variantIds = variants.map((v) => v.id);
    const inventories = await prisma.inventory.findMany({
      where: { variantId: { in: variantIds }, branchId },
    });
    const stockMap = new Map(inventories.map((i) => [i.variantId, i.quantity]));

    return variants.map((v) => ({
      variantId: v.id,
      barcode: v.barcode,
      sku: v.sku,
      size: v.size,
      color: v.color,
      productName: v.product.name,
      brand: v.product.brand?.name,
      category: v.product.category?.name,
      price: Number(v.priceOverride ?? v.product.basePrice),
      stock: stockMap.get(v.id) ?? 0,
    }));
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

  async createUpiPayment(
    data: {
      items: { barcode: string; quantity: number }[];
      customerId?: number;
      discountAmount?: number;
      notes?: string;
    },
    userId: number,
    branchId: number
  ) {
    // 1. Verify user has an open session
    const session = await prisma.posSession.findFirst({
      where: { userId, status: 'open' },
    });

    if (!session) {
      throw new AppError('No open POS session. Open a session before checkout.', 400);
    }

    // 2. Resolve barcodes to variants
    const barcodes = data.items.map((i) => i.barcode);
    const variants = await prisma.productVariant.findMany({
      where: { barcode: { in: barcodes }, isActive: true },
      include: { product: true },
    });

    const variantByBarcode = new Map(variants.map((v) => [v.barcode, v]));

    for (const item of data.items) {
      if (!variantByBarcode.has(item.barcode)) {
        throw new AppError(`Barcode not found: ${item.barcode}`, 400);
      }
    }

    // 3. Check stock and calculate totals
    const cartItems: Array<{
      variantId: number;
      quantity: number;
      unitPrice: number;
      costPrice: number;
      taxRate: number;
    }> = [];

    for (const item of data.items) {
      const variant = variantByBarcode.get(item.barcode)!;

      const inventory = await prisma.inventory.findUnique({
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

      cartItems.push({
        variantId: variant.id,
        quantity: item.quantity,
        unitPrice,
        costPrice,
        taxRate,
      });
    }

    // 4. Calculate totals — tax-inclusive (see `checkout` above for the
    //    rationale). Line prices are MRPs with GST already baked in; we
    //    extract the tax component for reporting and never add it on top.
    const discountAmount = data.discountAmount || 0;
    let subtotal = 0;
    let totalTax = 0;

    for (const item of cartItems) {
      const lineSubtotal = item.unitPrice * item.quantity;
      const lineTax = lineSubtotal * (item.taxRate / (100 + item.taxRate));
      subtotal += lineSubtotal;
      totalTax += lineTax;
    }

    subtotal = Math.round(subtotal * 100) / 100;
    totalTax = Math.round(totalTax * 100) / 100;
    const saleTotal = Math.round((subtotal - discountAmount) * 100) / 100;

    if (saleTotal < 0) {
      throw new AppError('Discount exceeds sale total', 400);
    }

    // 5. Validate customer exists if provided
    if (data.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId },
      });
      if (!customer) {
        throw new AppError('Customer not found', 404);
      }
    }

    // 6. Create QR payment via gateway
    const intentId = `UPI-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const gatewayResponse = await getPaymentGateway().createQRPayment({
      orderId: intentId,
      amount: saleTotal,
      expiresInSeconds: 300,
    });

    // 7. Persist intent
    await prisma.upiPaymentIntent.create({
      data: {
        intentId,
        providerOrderId: gatewayResponse.providerOrderId,
        branchId,
        userId,
        amount: saleTotal,
        qrCodeUrl: gatewayResponse.qrCodeUrl,
        upiLink: gatewayResponse.upiLink,
        cartSnapshot: cartItems as any,
        customerId: data.customerId || null,
        discountAmount,
        expiresAt: gatewayResponse.expiresAt,
      },
    });

    return {
      intentId,
      qrCodeUrl: gatewayResponse.qrCodeUrl,
      upiLink: gatewayResponse.upiLink,
      amount: saleTotal,
      expiresAt: gatewayResponse.expiresAt,
    };
  }

  async checkUpiPaymentStatus(intentId: string, userId: number) {
    const intent = await prisma.upiPaymentIntent.findUnique({
      where: { intentId },
    });

    if (!intent) {
      throw new AppError('Payment intent not found', 404);
    }

    if (intent.userId !== userId) {
      throw new AppError('Unauthorized', 403);
    }

    // Already completed
    if (intent.status === 'completed' && intent.saleId) {
      const sale = await prisma.sale.findUnique({
        where: { id: intent.saleId },
        select: { id: true, saleNumber: true },
      });
      return { status: 'completed', saleId: sale?.id, saleNumber: sale?.saleNumber };
    }

    // Already failed/expired
    if (intent.status === 'failed' || intent.status === 'expired') {
      return { status: intent.status };
    }

    // Check with provider
    const providerStatus = await getPaymentGateway().getPaymentStatus(intent.providerOrderId);

    if (providerStatus.status === 'completed') {
      const sale = await this._completeUpiSale(intent, providerStatus.utrNumber);
      return { status: 'completed', saleId: sale.id, saleNumber: sale.saleNumber };
    }

    if (providerStatus.status === 'failed' || providerStatus.status === 'expired') {
      await prisma.upiPaymentIntent.update({
        where: { id: intent.id },
        data: { status: providerStatus.status },
      });
      return { status: providerStatus.status };
    }

    return { status: 'pending' };
  }

  async handleUpiWebhook(headers: Record<string, string>, rawBody: string) {
    const result = getPaymentGateway().verifyWebhook(headers, rawBody);

    if (!result.isValid) {
      throw new AppError('Invalid webhook signature', 400);
    }

    const intent = await prisma.upiPaymentIntent.findUnique({
      where: { intentId: result.orderId },
    });

    if (intent && intent.status === 'pending') {
      if (result.status === 'completed') {
        await this._completeUpiSale(intent, result.utrNumber);
      } else if (result.status === 'failed') {
        await prisma.upiPaymentIntent.update({
          where: { id: intent.id },
          data: { status: 'failed' },
        });
      }
    }
  }

  private async _completeUpiSale(
    intent: {
      id: number;
      intentId: string;
      branchId: number;
      userId: number;
      amount: any;
      saleId: number | null;
      cartSnapshot: any;
      customerId: number | null;
      discountAmount: any;
    },
    utrNumber?: string
  ) {
    // Idempotency guard
    if (intent.saleId) {
      const existing = await prisma.sale.findUnique({ where: { id: intent.saleId } });
      if (existing) return existing;
    }

    const cartItems = intent.cartSnapshot as Array<{
      variantId: number;
      quantity: number;
      unitPrice: number;
      costPrice: number;
      taxRate: number;
    }>;

    const saleTotal = Number(intent.amount);
    const discountAmount = Number(intent.discountAmount);

    return prisma.$transaction(async (tx) => {
      // Calculate line items
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

      for (const item of cartItems) {
        const lineSubtotal = item.unitPrice * item.quantity;
        // Tax-inclusive: extract GST component from the MRP, don't add it.
        const lineTax = lineSubtotal * (item.taxRate / (100 + item.taxRate));
        const lineTotal = lineSubtotal;

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

      // Create the sale
      const saleNumber = generateNumber('SL');

      const sale = await tx.sale.create({
        data: {
          branchId: intent.branchId,
          userId: intent.userId,
          customerId: intent.customerId,
          saleNumber,
          subtotal,
          taxAmount: totalTax,
          discountAmount,
          total: saleTotal,
          notes: `UPI payment - Intent: ${intent.intentId}`,
          items: {
            create: itemsForCreation,
          },
          payments: {
            create: [{
              method: 'upi' as PaymentMethod,
              amount: saleTotal,
              referenceNumber: utrNumber || intent.intentId,
            }],
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

      // Deduct inventory and create movement records
      for (const item of cartItems) {
        await tx.inventory.update({
          where: {
            variantId_branchId: {
              variantId: item.variantId,
              branchId: intent.branchId,
            },
          },
          data: { quantity: { decrement: item.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            branchId: intent.branchId,
            type: MovementType.sale,
            quantity: -item.quantity,
            referenceId: sale.id,
            referenceType: 'sale',
            createdBy: intent.userId,
          },
        });
      }

      // Update customer visit/spend if provided
      if (intent.customerId) {
        await tx.customer.update({
          where: { id: intent.customerId },
          data: {
            visitCount: { increment: 1 },
            totalSpent: { increment: saleTotal },
          },
        });
      }

      // Update UPI intent
      await tx.upiPaymentIntent.update({
        where: { id: intent.id },
        data: {
          saleId: sale.id,
          status: 'completed',
          utrNumber: utrNumber || null,
          completedAt: new Date(),
        },
      });

      return sale;
    });
  }
}

export const posService = new PosService();
