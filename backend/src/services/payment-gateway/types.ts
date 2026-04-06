export interface CreateQRPaymentRequest {
  orderId: string;
  amount: number; // INR
  customerPhone?: string;
  customerEmail?: string;
  description?: string;
  expiresInSeconds?: number; // default 300
}

export interface CreateQRPaymentResponse {
  providerOrderId: string;
  qrCodeUrl: string;
  upiLink: string;
  expiresAt: Date;
}

export interface PaymentStatusResponse {
  orderId: string;
  providerOrderId: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  amount: number;
  utrNumber?: string;
  paidAt?: Date;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  orderId?: string;
  status?: 'completed' | 'failed';
  utrNumber?: string;
  amount?: number;
}

export interface PaymentGatewayProvider {
  readonly name: string;
  createQRPayment(req: CreateQRPaymentRequest): Promise<CreateQRPaymentResponse>;
  getPaymentStatus(providerOrderId: string): Promise<PaymentStatusResponse>;
  verifyWebhook(headers: Record<string, string>, rawBody: string): WebhookVerificationResult;
}
