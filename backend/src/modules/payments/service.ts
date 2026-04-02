import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { PaymentMethod } from '@prisma/client';

export class PaymentsService {
  async recordPayment(data: {
    saleId: number;
    method: string;
    amount: number;
    referenceNumber?: string;
  }) {
    // Verify sale exists
    const sale = await prisma.sale.findUnique({
      where: { id: data.saleId },
      include: { payments: true },
    });

    if (!sale) {
      throw new AppError('Sale not found', 404);
    }

    if (sale.status === 'void') {
      throw new AppError('Cannot add payment to a voided sale', 400);
    }

    const payment = await prisma.payment.create({
      data: {
        saleId: data.saleId,
        method: data.method as PaymentMethod,
        amount: data.amount,
        referenceNumber: data.referenceNumber,
      },
      include: { sale: true },
    });

    return payment;
  }

  async refundPayment(paymentId: number) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { sale: true },
    });

    if (!payment) {
      throw new AppError('Payment not found', 404);
    }

    if (payment.status === 'refunded') {
      throw new AppError('Payment is already refunded', 400);
    }

    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'refunded' },
      include: { sale: true },
    });

    return updated;
  }

  async getDailySummary(branchId: number, date?: string) {
    const targetDate = date ? new Date(date) : new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all completed payments for the branch on the date
    const payments = await prisma.payment.findMany({
      where: {
        sale: {
          branchId,
          createdAt: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      },
      include: {
        sale: { select: { branchId: true } },
      },
    });

    // Summarize by method
    const summary: Record<string, { completed: number; refunded: number; net: number; count: number }> = {
      cash: { completed: 0, refunded: 0, net: 0, count: 0 },
      card: { completed: 0, refunded: 0, net: 0, count: 0 },
      upi: { completed: 0, refunded: 0, net: 0, count: 0 },
    };

    let totalCompleted = 0;
    let totalRefunded = 0;
    let totalTransactions = 0;

    for (const payment of payments) {
      const amount = Number(payment.amount);
      const method = payment.method;

      if (payment.status === 'completed') {
        summary[method].completed += amount;
        summary[method].count += 1;
        totalCompleted += amount;
        totalTransactions += 1;
      } else if (payment.status === 'refunded') {
        summary[method].refunded += amount;
        totalRefunded += amount;
      }
    }

    // Calculate net
    for (const method of Object.keys(summary)) {
      summary[method].net = Math.round((summary[method].completed - summary[method].refunded) * 100) / 100;
      summary[method].completed = Math.round(summary[method].completed * 100) / 100;
      summary[method].refunded = Math.round(summary[method].refunded * 100) / 100;
    }

    return {
      date: startOfDay.toISOString().split('T')[0],
      branchId,
      byMethod: summary,
      totals: {
        completed: Math.round(totalCompleted * 100) / 100,
        refunded: Math.round(totalRefunded * 100) / 100,
        net: Math.round((totalCompleted - totalRefunded) * 100) / 100,
        transactionCount: totalTransactions,
      },
    };
  }
}

export const paymentsService = new PaymentsService();
