import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { generateNumber, getPagination, buildPaginationMeta } from '../../utils/helpers';
import { MovementType, Prisma, SaleStatus } from '@prisma/client';

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

    return sale;
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
        ? { name: `${sale.customer.firstName} ${sale.customer.lastName}`, phone: sale.customer.phone }
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
    };
  }

  async processReturn(
    saleId: number,
    data: {
      items: { saleItemId: number; quantity: number; condition: 'resellable' | 'damaged' }[];
      reason: string;
    },
    userId: number,
    branchId: number
  ) {
    return prisma.$transaction(async (tx) => {
      // Get the original sale
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { items: true },
      });

      if (!sale) {
        throw new AppError('Sale not found', 404);
      }

      if (sale.status === 'void') {
        throw new AppError('Cannot return a voided sale', 400);
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

        const availableForReturn = saleItem.quantity - saleItem.returnedQuantity;

        if (item.quantity > availableForReturn) {
          throw new AppError(
            `Cannot return ${item.quantity} of sale item ${item.saleItemId}. Max returnable: ${availableForReturn}`,
            400
          );
        }

        const unitPrice = Number(saleItem.unitPrice);
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

      returnSubtotal = Math.round(returnSubtotal * 100) / 100;
      returnTax = Math.round(returnTax * 100) / 100;
      const returnTotal = Math.round((returnSubtotal + returnTax) * 100) / 100;

      const returnNumber = generateNumber('RT');

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

      return { returnRecord, refundAmount: returnTotal };
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

        const unitPrice = Number(saleItem.unitPrice);
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

      const returnTotal = Math.round((returnSubtotal + returnTax) * 100) / 100;

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

        const unitPrice = Number(variant.priceOverride ?? variant.product.basePrice);
        const taxRate = Number(variant.product.taxRate);
        const lineSubtotal = unitPrice * item.quantity;
        const lineTax = lineSubtotal * (taxRate / 100);

        newSubtotal += lineSubtotal;
        newTax += lineTax;

        newItemsValidated.push({
          variantId: variant.id,
          quantity: item.quantity,
          unitPrice,
          taxRate,
        });
      }

      const newTotal = Math.round((newSubtotal + newTax) * 100) / 100;
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
}

export const salesService = new SalesService();
