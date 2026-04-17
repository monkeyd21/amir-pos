import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';
import { MovementType, TransferStatus, Prisma } from '@prisma/client';

export class InventoryService {
  async listInventory(query: {
    branchId?: string;
    variantId?: string;
    lowStock?: string;
    search?: string;
    page?: string;
    limit?: string;
  }, userBranchId: number) {
    const { page, limit, skip } = getPagination(query);
    const branchId = query.branchId ? parseInt(query.branchId) : userBranchId;

    const where: Prisma.InventoryWhereInput = { branchId };

    if (query.variantId) {
      where.variantId = parseInt(query.variantId);
    }

    if (query.search) {
      where.variant = {
        OR: [
          { sku: { contains: query.search, mode: 'insensitive' } },
          { product: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      };
    }

    if (query.lowStock === 'true') {
      where.quantity = { lte: prisma.inventory.fields.minStockLevel as any };
      // Use raw filter for self-referencing column comparison
      // We'll handle this with a rawWhere approach below
    }

    // For low stock, we need a raw query approach since Prisma can't compare columns
    let inventoryItems;
    let total;

    if (query.lowStock === 'true') {
      const baseWhere: Prisma.InventoryWhereInput = {
        branchId,
        ...(query.variantId ? { variantId: parseInt(query.variantId) } : {}),
        ...(query.search ? {
          variant: {
            OR: [
              { sku: { contains: query.search, mode: 'insensitive' as const } },
              { product: { name: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          },
        } : {}),
      };

      const allItems = await prisma.inventory.findMany({
        where: baseWhere,
        include: {
          variant: {
            include: {
              product: {
                include: { brand: true, category: true },
              },
            },
          },
          branch: true,
        },
      });

      const lowStockItems = allItems.filter((item) => item.quantity <= item.minStockLevel);
      total = lowStockItems.length;
      inventoryItems = lowStockItems.slice(skip, skip + limit);
    } else {
      [inventoryItems, total] = await Promise.all([
        prisma.inventory.findMany({
          where,
          include: {
            variant: {
              include: {
                product: {
                  include: { brand: true, category: true },
                },
              },
            },
            branch: true,
          },
          skip,
          take: limit,
          orderBy: { updatedAt: 'desc' },
        }),
        prisma.inventory.count({ where }),
      ]);
    }

    return {
      data: inventoryItems,
      meta: buildPaginationMeta(page, limit, total),
    };
  }

  async getLowStock(branchId: number) {
    const allItems = await prisma.inventory.findMany({
      where: { branchId },
      include: {
        variant: {
          include: {
            product: {
              include: { brand: true, category: true },
            },
          },
        },
      },
    });

    return allItems.filter((item) => item.quantity <= item.minStockLevel);
  }

  async adjustStock(data: {
    variantId: number;
    branchId: number;
    quantity: number;
    reason: string;
    vendorId?: number | null;
    lotCode?: string | null;
  }, userId: number) {
    return prisma.$transaction(async (tx) => {
      // Upsert inventory record
      let inventory = await tx.inventory.findUnique({
        where: {
          variantId_branchId: {
            variantId: data.variantId,
            branchId: data.branchId,
          },
        },
      });

      const newQuantity = (inventory?.quantity ?? 0) + data.quantity;

      if (newQuantity < 0) {
        throw new AppError(
          `Insufficient stock. Current: ${inventory?.quantity ?? 0}, Adjustment: ${data.quantity}`,
          400
        );
      }

      inventory = await tx.inventory.upsert({
        where: {
          variantId_branchId: {
            variantId: data.variantId,
            branchId: data.branchId,
          },
        },
        update: { quantity: newQuantity },
        create: {
          variantId: data.variantId,
          branchId: data.branchId,
          quantity: newQuantity,
        },
      });

      // Create movement record
      const movement = await tx.inventoryMovement.create({
        data: {
          variantId: data.variantId,
          branchId: data.branchId,
          type: MovementType.adjustment,
          quantity: data.quantity,
          notes: data.reason,
          lotCode: data.lotCode ?? null,
          createdBy: userId,
          vendorId: data.vendorId ?? null,
        },
      });

      return { inventory, movement };
    });
  }

  async restock(data: {
    productId: number;
    vendorId: number;
    lotCode: string;
    notes?: string | null;
    items: { variantId: number; quantity: number }[];
  }, userId: number, branchId: number) {
    return prisma.$transaction(async (tx) => {
      // Verify product exists and all variants belong to it
      const product = await tx.product.findUnique({
        where: { id: data.productId },
        include: { variants: { select: { id: true } } },
      });
      if (!product) throw new AppError('Product not found', 404);

      const validVariantIds = new Set(product.variants.map((v) => v.id));
      for (const item of data.items) {
        if (!validVariantIds.has(item.variantId)) {
          throw new AppError(`Variant ${item.variantId} does not belong to this product`, 400);
        }
      }

      // Verify vendor exists
      const vendor = await tx.vendor.findUnique({ where: { id: data.vendorId } });
      if (!vendor) throw new AppError('Vendor not found', 404);

      const results: { variantId: number; previousQty: number; newQty: number }[] = [];

      for (const item of data.items) {
        const inventory = await tx.inventory.findUnique({
          where: { variantId_branchId: { variantId: item.variantId, branchId } },
        });

        const prevQty = inventory?.quantity ?? 0;
        const newQty = prevQty + item.quantity;

        await tx.inventory.upsert({
          where: { variantId_branchId: { variantId: item.variantId, branchId } },
          update: { quantity: newQty },
          create: { variantId: item.variantId, branchId, quantity: newQty },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            branchId,
            type: MovementType.purchase,
            quantity: item.quantity,
            lotCode: data.lotCode,
            notes: data.notes || `Restock from ${vendor.name}`,
            createdBy: userId,
            vendorId: data.vendorId,
          },
        });

        results.push({ variantId: item.variantId, previousQty: prevQty, newQty });
      }

      return {
        productId: data.productId,
        vendorId: data.vendorId,
        lotCode: data.lotCode,
        variantsRestocked: results.length,
        totalUnitsAdded: data.items.reduce((sum, i) => sum + i.quantity, 0),
        details: results,
      };
    }, { timeout: 30000 });
  }

  async updateMovement(id: number, data: {
    lotCode?: string | null;
    notes?: string | null;
    vendorId?: number | null;
  }) {
    const movement = await prisma.inventoryMovement.findUnique({ where: { id } });
    if (!movement) throw new AppError('Movement not found', 404);

    return prisma.inventoryMovement.update({
      where: { id },
      data: {
        ...(data.lotCode !== undefined ? { lotCode: data.lotCode } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.vendorId !== undefined ? { vendorId: data.vendorId } : {}),
      },
      include: {
        variant: { include: { product: true } },
        user: { select: { id: true, firstName: true, lastName: true } },
        vendor: { select: { id: true, name: true } },
      },
    });
  }

  async listTransfers(query: { page?: string; limit?: string }, userBranchId: number) {
    const { page, limit, skip } = getPagination(query);

    const where: Prisma.StockTransferWhereInput = {
      OR: [{ fromBranchId: userBranchId }, { toBranchId: userBranchId }],
    };

    const [transfers, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        where,
        include: {
          items: { include: { variant: { include: { product: true } } } },
          fromBranch: true,
          toBranch: true,
          creator: { select: { id: true, firstName: true, lastName: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockTransfer.count({ where }),
    ]);

    return { data: transfers, meta: buildPaginationMeta(page, limit, total) };
  }

  async createTransfer(data: {
    fromBranchId: number;
    toBranchId: number;
    items: { variantId: number; quantity: number }[];
  }, userId: number) {
    if (data.fromBranchId === data.toBranchId) {
      throw new AppError('Cannot transfer to the same branch', 400);
    }

    return prisma.$transaction(async (tx) => {
      // Validate stock availability for all items
      for (const item of data.items) {
        const inventory = await tx.inventory.findUnique({
          where: {
            variantId_branchId: {
              variantId: item.variantId,
              branchId: data.fromBranchId,
            },
          },
        });

        if (!inventory || inventory.quantity < item.quantity) {
          throw new AppError(
            `Insufficient stock for variant ${item.variantId}. Available: ${inventory?.quantity ?? 0}, Requested: ${item.quantity}`,
            400
          );
        }
      }

      const transfer = await tx.stockTransfer.create({
        data: {
          fromBranchId: data.fromBranchId,
          toBranchId: data.toBranchId,
          createdBy: userId,
          items: {
            create: data.items.map((item) => ({
              variantId: item.variantId,
              quantitySent: item.quantity,
            })),
          },
        },
        include: {
          items: { include: { variant: true } },
          fromBranch: true,
          toBranch: true,
        },
      });

      return transfer;
    });
  }

  async approveTransfer(transferId: number, userId: number) {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
        include: { items: true },
      });

      if (!transfer) {
        throw new AppError('Transfer not found', 404);
      }

      if (transfer.status !== TransferStatus.pending) {
        throw new AppError(`Transfer is already ${transfer.status}`, 400);
      }

      // Deduct stock from source branch
      for (const item of transfer.items) {
        const inventory = await tx.inventory.findUnique({
          where: {
            variantId_branchId: {
              variantId: item.variantId,
              branchId: transfer.fromBranchId,
            },
          },
        });

        if (!inventory || inventory.quantity < item.quantitySent) {
          throw new AppError(
            `Insufficient stock for variant ${item.variantId} at source branch`,
            400
          );
        }

        await tx.inventory.update({
          where: {
            variantId_branchId: {
              variantId: item.variantId,
              branchId: transfer.fromBranchId,
            },
          },
          data: { quantity: { decrement: item.quantitySent } },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            branchId: transfer.fromBranchId,
            type: MovementType.transfer_out,
            quantity: -item.quantitySent,
            referenceId: transfer.id,
            referenceType: 'stock_transfer',
            createdBy: userId,
          },
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.in_transit,
          approvedBy: userId,
        },
        include: {
          items: { include: { variant: true } },
          fromBranch: true,
          toBranch: true,
        },
      });

      return updated;
    });
  }

  async receiveTransfer(transferId: number, userId: number) {
    return prisma.$transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findUnique({
        where: { id: transferId },
        include: { items: true },
      });

      if (!transfer) {
        throw new AppError('Transfer not found', 404);
      }

      if (transfer.status !== TransferStatus.in_transit) {
        throw new AppError(
          `Transfer must be in_transit to receive. Current status: ${transfer.status}`,
          400
        );
      }

      // Add stock to destination branch
      for (const item of transfer.items) {
        await tx.inventory.upsert({
          where: {
            variantId_branchId: {
              variantId: item.variantId,
              branchId: transfer.toBranchId,
            },
          },
          update: { quantity: { increment: item.quantitySent } },
          create: {
            variantId: item.variantId,
            branchId: transfer.toBranchId,
            quantity: item.quantitySent,
          },
        });

        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { quantityReceived: item.quantitySent },
        });

        await tx.inventoryMovement.create({
          data: {
            variantId: item.variantId,
            branchId: transfer.toBranchId,
            type: MovementType.transfer_in,
            quantity: item.quantitySent,
            referenceId: transfer.id,
            referenceType: 'stock_transfer',
            createdBy: userId,
          },
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.completed,
          completedAt: new Date(),
        },
        include: {
          items: { include: { variant: true } },
          fromBranch: true,
          toBranch: true,
        },
      });

      return updated;
    });
  }

  async listMovements(query: {
    variantId?: string;
    branchId?: string;
    type?: string;
    lotCode?: string;
    vendorId?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: string;
    limit?: string;
  }, userBranchId: number) {
    const { page, limit, skip } = getPagination(query);

    const where: Prisma.InventoryMovementWhereInput = {};

    if (query.branchId) {
      where.branchId = parseInt(query.branchId);
    } else {
      where.branchId = userBranchId;
    }

    if (query.variantId) {
      where.variantId = parseInt(query.variantId);
    }

    if (query.type) {
      where.type = query.type as MovementType;
    }

    if (query.lotCode) {
      where.lotCode = { contains: query.lotCode, mode: 'insensitive' };
    }

    if (query.vendorId) {
      where.vendorId = parseInt(query.vendorId);
    }

    if (query.search) {
      where.variant = {
        OR: [
          { sku: { contains: query.search, mode: 'insensitive' } },
          { product: { name: { contains: query.search, mode: 'insensitive' } } },
          { product: { brand: { name: { contains: query.search, mode: 'insensitive' } } } },
        ],
      };
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        // End of day
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [movements, total] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where,
        include: {
          variant: {
            include: {
              product: {
                include: { brand: { select: { id: true, name: true } } },
              },
            },
          },
          branch: true,
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
          vendor: {
            select: { id: true, name: true },
          },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryMovement.count({ where }),
    ]);

    return {
      data: movements,
      meta: buildPaginationMeta(page, limit, total),
    };
  }
}

export const inventoryService = new InventoryService();
