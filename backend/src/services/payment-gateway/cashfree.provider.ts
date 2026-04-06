import * as crypto from 'crypto';
import {
  PaymentGatewayProvider,
  CreateQRPaymentRequest,
  CreateQRPaymentResponse,
  PaymentStatusResponse,
  WebhookVerificationResult,
} from './types';

interface CashfreeConfig {
  appId: string;
  secretKey: string;
  webhookSecret: string;
  environment: 'sandbox' | 'production';
}

export class CashfreeProvider implements PaymentGatewayProvider {
  readonly name = 'cashfree';
  private baseUrl: string;
  private config: CashfreeConfig;

  constructor(config: CashfreeConfig) {
    this.config = config;
    this.baseUrl =
      config.environment === 'production'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg';
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-client-id': this.config.appId,
      'x-client-secret': this.config.secretKey,
      'x-api-version': '2023-08-01',
    };
  }

  async createQRPayment(req: CreateQRPaymentRequest): Promise<CreateQRPaymentResponse> {
    // Step 1: Create order
    const orderRes = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        order_id: req.orderId,
        order_amount: req.amount,
        order_currency: 'INR',
        customer_details: {
          customer_id: req.orderId,
          customer_phone: req.customerPhone || '9999999999',
          customer_email: req.customerEmail || undefined,
        },
        order_meta: {
          notify_url: process.env.WEBHOOK_BASE_URL
            ? `${process.env.WEBHOOK_BASE_URL}/api/v1/webhooks/payment`
            : undefined,
        },
        order_expiry_time: new Date(
          Date.now() + (req.expiresInSeconds || 300) * 1000
        ).toISOString(),
        order_note: req.description || undefined,
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.json().catch(() => ({}));
      throw new Error(`Cashfree create order failed: ${JSON.stringify(err)}`);
    }

    const order: any = await orderRes.json();
    const paymentSessionId = order.payment_session_id;
    const cfOrderId = order.cf_order_id;

    // Step 2: Create UPI QR payment via sessions endpoint
    const payRes = await fetch(`${this.baseUrl}/orders/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        payment_session_id: paymentSessionId,
        payment_method: {
          upi: {
            channel: 'qrcode',
          },
        },
      }),
    });

    if (!payRes.ok) {
      const err = await payRes.json().catch(() => ({}));
      throw new Error(`Cashfree QR generation failed: ${JSON.stringify(err)}`);
    }

    const payData: any = await payRes.json();

    // payData.data.payload should have qrcode and bhim_upi_link
    const payload = payData?.data?.payload || payData?.data || {};

    return {
      providerOrderId: String(cfOrderId),
      qrCodeUrl: payload.qrcode || '', // base64 QR image or URL
      upiLink: payload.bhim_upi_link || payload.upi_link || '',
      expiresAt: new Date(Date.now() + (req.expiresInSeconds || 300) * 1000),
    };
  }

  async getPaymentStatus(providerOrderId: string): Promise<PaymentStatusResponse> {
    const res = await fetch(`${this.baseUrl}/orders/${providerOrderId}`, {
      method: 'GET',
      headers: this.headers(),
    });

    if (!res.ok) {
      throw new Error(`Cashfree status check failed: ${res.status}`);
    }

    const order: any = await res.json();

    const statusMap: Record<string, PaymentStatusResponse['status']> = {
      PAID: 'completed',
      ACTIVE: 'pending',
      EXPIRED: 'expired',
      TERMINATED: 'failed',
      PARTIALLY_PAID: 'pending',
    };

    return {
      orderId: order.order_id,
      providerOrderId: String(order.cf_order_id),
      status: statusMap[order.order_status] || 'pending',
      amount: order.order_amount,
      utrNumber: order.payment?.utr || undefined,
      paidAt: order.order_status === 'PAID' ? new Date(order.order_expiry_time) : undefined,
    };
  }

  verifyWebhook(
    headers: Record<string, string>,
    rawBody: string
  ): WebhookVerificationResult {
    const timestamp = headers['x-cashfree-timestamp'] || '';
    const signature = headers['x-cashfree-signature'] || '';

    if (!timestamp || !signature || !this.config.webhookSecret) {
      return { isValid: false };
    }

    const expectedSig = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(timestamp + rawBody)
      .digest('base64');

    // Guard against length mismatch before timingSafeEqual
    if (Buffer.byteLength(signature) !== Buffer.byteLength(expectedSig)) {
      return { isValid: false };
    }

    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSig)
    );

    if (!isValid) return { isValid: false };

    try {
      const body = JSON.parse(rawBody);
      const data = body.data || {};
      const order = data.order || {};
      const payment = data.payment || {};

      const statusMap: Record<string, 'completed' | 'failed'> = {
        SUCCESS: 'completed',
        FAILED: 'failed',
        CANCELLED: 'failed',
      };

      return {
        isValid: true,
        orderId: order.order_id,
        status: statusMap[payment.payment_status] || 'failed',
        utrNumber: payment.payment_utr || undefined,
        amount: order.order_amount,
      };
    } catch {
      return { isValid: false };
    }
  }
}
