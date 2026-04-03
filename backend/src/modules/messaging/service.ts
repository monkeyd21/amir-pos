import prisma from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { config } from '../../config';
import { getPagination, buildPaginationMeta } from '../../utils/helpers';
import { sendWhatsAppTemplate, sendWhatsAppText } from './whatsapp';

export class MessagingService {
  async sendBill(data: { saleId: number; customerId: number; type: 'whatsapp' | 'sms' }) {
    const [sale, customer] = await Promise.all([
      prisma.sale.findUnique({
        where: { id: data.saleId },
        include: {
          items: {
            include: {
              variant: { include: { product: true } },
            },
          },
          branch: { select: { name: true } },
        },
      }),
      prisma.customer.findUnique({ where: { id: data.customerId } }),
    ]);

    if (!sale) throw new AppError('Sale not found', 404);
    if (!customer) throw new AppError('Customer not found', 404);
    if (!customer.phone) throw new AppError('Customer has no phone number', 400);

    const billSummary = this.formatBillSummary(sale, customer);

    // Create message log
    const messageLog = await prisma.messageLog.create({
      data: {
        customerId: data.customerId,
        type: data.type,
        template: 'bill_receipt',
        payload: {
          saleId: data.saleId,
          saleNumber: sale.saleNumber,
          total: sale.total.toString(),
          items: sale.items.length,
        },
        status: 'pending',
      },
    });

    let result: { success: boolean; error?: string; response?: any };

    if (data.type === 'whatsapp') {
      result = await sendWhatsAppTemplate({
        to: customer.phone,
        templateName: 'bill_receipt',
        templateParams: [
          `${customer.firstName} ${customer.lastName}`,
          sale.saleNumber,
          sale.total.toString(),
          sale.branch.name,
        ],
      });
    } else {
      // SMS
      result = await this.sendSMS(customer.phone, billSummary);
    }

    // Update message log with result
    await prisma.messageLog.update({
      where: { id: messageLog.id },
      data: {
        status: result.success ? 'sent' : 'failed',
        providerResponse: result.response || { error: result.error },
      },
    });

    return {
      messageId: messageLog.id,
      status: result.success ? 'sent' : 'failed',
      error: result.error,
    };
  }

  async sendCustomMessage(data: {
    customerId: number;
    type: 'whatsapp' | 'sms';
    message: string;
  }) {
    const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
    if (!customer) throw new AppError('Customer not found', 404);
    if (!customer.phone) throw new AppError('Customer has no phone number', 400);

    const messageLog = await prisma.messageLog.create({
      data: {
        customerId: data.customerId,
        type: data.type,
        template: 'custom',
        payload: { message: data.message },
        status: 'pending',
      },
    });

    let result: { success: boolean; error?: string; response?: any };

    if (data.type === 'whatsapp') {
      result = await sendWhatsAppText({
        to: customer.phone,
        text: data.message,
      });
    } else {
      result = await this.sendSMS(customer.phone, data.message);
    }

    await prisma.messageLog.update({
      where: { id: messageLog.id },
      data: {
        status: result.success ? 'sent' : 'failed',
        providerResponse: result.response || { error: result.error },
      },
    });

    return {
      messageId: messageLog.id,
      status: result.success ? 'sent' : 'failed',
      error: result.error,
    };
  }

  async listLogs(query: {
    page?: string;
    limit?: string;
    customerId?: string;
    type?: string;
    status?: string;
  }) {
    const { page, limit, skip } = getPagination(query);
    const where: any = {};

    if (query.customerId) where.customerId = parseInt(query.customerId);
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;

    const [logs, total] = await Promise.all([
      prisma.messageLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, phone: true } },
        },
      }),
      prisma.messageLog.count({ where }),
    ]);

    return { data: logs, meta: buildPaginationMeta(page, limit, total) };
  }

  private formatBillSummary(sale: any, customer: any): string {
    const appName = config.app.name;
    const currency = config.app.currency;
    return (
      `${appName} - Receipt\n` +
      `Sale: ${sale.saleNumber}\n` +
      `Customer: ${customer.firstName} ${customer.lastName}\n` +
      `Items: ${sale.items.length}\n` +
      `Subtotal: ${currency} ${sale.subtotal}\n` +
      `Tax: ${currency} ${sale.taxAmount}\n` +
      `Total: ${currency} ${sale.total}\n` +
      `Thank you for your purchase!`
    );
  }

  private async sendSMS(
    phone: string,
    message: string
  ): Promise<{ success: boolean; error?: string; response?: any }> {
    const { provider, apiKey, senderId } = config.sms;

    if (provider === 'none' || !apiKey) {
      return {
        success: false,
        error: 'SMS provider not configured',
      };
    }

    try {
      // Generic SMS API call - adapt based on provider
      const response = await fetch(`https://api.${provider}.com/sms/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: phone,
          from: senderId,
          message,
        }),
      });

      const data: any = await response.json();

      return {
        success: response.ok,
        error: response.ok ? undefined : data.error || 'SMS send failed',
        response: data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to send SMS',
      };
    }
  }
}

export const messagingService = new MessagingService();
