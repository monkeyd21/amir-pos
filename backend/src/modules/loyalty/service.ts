import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { Decimal } from '@prisma/client/runtime/library';

export class LoyaltyService {
  async getConfig() {
    let config = await prisma.loyaltyConfig.findFirst();
    if (!config) {
      config = await prisma.loyaltyConfig.create({ data: {} });
    }
    return config;
  }

  async updateConfig(data: {
    pointsPerAmount?: number;
    amountPerPoint?: number;
    redemptionValue?: number;
    tierThresholds?: Record<string, number>;
    earningMultipliers?: Record<string, number>;
  }) {
    let config = await prisma.loyaltyConfig.findFirst();
    if (!config) {
      config = await prisma.loyaltyConfig.create({ data: {} });
    }

    return prisma.loyaltyConfig.update({
      where: { id: config.id },
      data: {
        ...(data.pointsPerAmount !== undefined && { pointsPerAmount: data.pointsPerAmount }),
        ...(data.amountPerPoint !== undefined && { amountPerPoint: data.amountPerPoint }),
        ...(data.redemptionValue !== undefined && { redemptionValue: data.redemptionValue }),
        ...(data.tierThresholds !== undefined && { tierThresholds: data.tierThresholds }),
        ...(data.earningMultipliers !== undefined && { earningMultipliers: data.earningMultipliers }),
      },
    });
  }

  async earnPoints(data: {
    customerId: number;
    saleId?: number;
    saleTotal: number;
  }) {
    const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    const config = await this.getConfig();
    const multipliers = config.earningMultipliers as Record<string, number>;
    const tierMultiplier = multipliers[customer.loyaltyTier] || 1;

    const pointsEarned = Math.floor(
      (data.saleTotal / config.amountPerPoint) * config.pointsPerAmount * tierMultiplier
    );

    if (pointsEarned <= 0) {
      return { pointsEarned: 0, customer };
    }

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.loyaltyTransaction.create({
        data: {
          customerId: data.customerId,
          saleId: data.saleId || null,
          points: pointsEarned,
          type: 'earned',
          description: `Earned ${pointsEarned} points from purchase of ${data.saleTotal}`,
        },
      });

      const updatedCustomer = await tx.customer.update({
        where: { id: data.customerId },
        data: {
          loyaltyPoints: { increment: pointsEarned },
        },
      });

      // Auto-upgrade tier
      const upgraded = await this.checkAndUpgradeTier(tx, updatedCustomer.id, config);

      return {
        transaction,
        customer: upgraded || updatedCustomer,
        pointsEarned,
      };
    });

    return result;
  }

  async redeemPoints(data: {
    customerId: number;
    saleId?: number;
    points: number;
  }) {
    const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    if (customer.loyaltyPoints < data.points) {
      throw new AppError(
        `Insufficient loyalty points. Available: ${customer.loyaltyPoints}, Requested: ${data.points}`,
        400
      );
    }

    const config = await this.getConfig();
    const discountValue = data.points * Number(config.redemptionValue);

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.loyaltyTransaction.create({
        data: {
          customerId: data.customerId,
          saleId: data.saleId || null,
          points: -data.points,
          type: 'redeemed',
          description: `Redeemed ${data.points} points for discount of ${discountValue}`,
        },
      });

      const updatedCustomer = await tx.customer.update({
        where: { id: data.customerId },
        data: {
          loyaltyPoints: { decrement: data.points },
        },
      });

      return {
        transaction,
        customer: updatedCustomer,
        pointsRedeemed: data.points,
        discountValue,
      };
    });

    return result;
  }

  async adjustPoints(data: {
    customerId: number;
    points: number;
    reason: string;
  }) {
    const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) {
      throw new AppError('Customer not found', 404);
    }

    if (customer.loyaltyPoints + data.points < 0) {
      throw new AppError('Adjustment would result in negative points balance', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const transaction = await tx.loyaltyTransaction.create({
        data: {
          customerId: data.customerId,
          points: data.points,
          type: 'adjusted',
          description: data.reason,
        },
      });

      const updatedCustomer = await tx.customer.update({
        where: { id: data.customerId },
        data: {
          loyaltyPoints: { increment: data.points },
        },
      });

      return { transaction, customer: updatedCustomer };
    });

    return result;
  }

  private async checkAndUpgradeTier(
    tx: any,
    customerId: number,
    config: any
  ) {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) return null;

    const thresholds = config.tierThresholds as Record<string, number>;
    const totalPoints = customer.loyaltyPoints;

    let newTier = 'bronze';
    if (totalPoints >= (thresholds.platinum || 20000)) {
      newTier = 'platinum';
    } else if (totalPoints >= (thresholds.gold || 5000)) {
      newTier = 'gold';
    } else if (totalPoints >= (thresholds.silver || 1000)) {
      newTier = 'silver';
    }

    if (newTier !== customer.loyaltyTier) {
      return tx.customer.update({
        where: { id: customerId },
        data: { loyaltyTier: newTier as any },
      });
    }

    return null;
  }
}

export const loyaltyService = new LoyaltyService();
