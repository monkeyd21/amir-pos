import {
  PaymentGatewayProvider,
  CreateQRPaymentRequest,
  CreateQRPaymentResponse,
  PaymentStatusResponse,
  WebhookVerificationResult,
} from './types';

/**
 * Mock payment provider for local development/testing.
 * Generates a fake UPI QR code and auto-completes payment after a configurable delay.
 * No merchant account required.
 *
 * Set PAYMENT_PROVIDER=mock and optionally MOCK_PAYMENT_DELAY_MS (default 8000).
 */

// Track mock payment state in memory
const mockPayments = new Map<
  string,
  { orderId: string; amount: number; createdAt: number; delayMs: number }
>();

export class MockProvider implements PaymentGatewayProvider {
  readonly name = 'mock';
  private delayMs: number;

  constructor(delayMs = 8000) {
    this.delayMs = delayMs;
  }

  async createQRPayment(req: CreateQRPaymentRequest): Promise<CreateQRPaymentResponse> {
    const providerOrderId = `mock_${req.orderId}`;
    const expiresIn = req.expiresInSeconds || 300;

    mockPayments.set(providerOrderId, {
      orderId: req.orderId,
      amount: req.amount,
      createdAt: Date.now(),
      delayMs: this.delayMs,
    });

    // Generate a UPI link (fake but valid format)
    const upiLink = `upi://pay?pa=merchant@mock&pn=ClothingERP&am=${req.amount}&cu=INR&tr=${req.orderId}&tn=${encodeURIComponent(req.description || 'Payment')}`;

    // Generate a QR code SVG inline as a data URI — no external dependencies needed
    const qrCodeUrl = generateMockQrSvgDataUri(upiLink, req.amount);

    return {
      providerOrderId,
      qrCodeUrl,
      upiLink,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  async getPaymentStatus(providerOrderId: string): Promise<PaymentStatusResponse> {
    const payment = mockPayments.get(providerOrderId);

    if (!payment) {
      return {
        orderId: '',
        providerOrderId,
        status: 'failed',
        amount: 0,
      };
    }

    const elapsed = Date.now() - payment.createdAt;
    const isComplete = elapsed >= payment.delayMs;

    if (isComplete) {
      mockPayments.delete(providerOrderId);
    }

    return {
      orderId: payment.orderId,
      providerOrderId,
      status: isComplete ? 'completed' : 'pending',
      amount: payment.amount,
      utrNumber: isComplete ? `MOCK${Date.now()}` : undefined,
      paidAt: isComplete ? new Date() : undefined,
    };
  }

  verifyWebhook(
    _headers: Record<string, string>,
    _rawBody: string
  ): WebhookVerificationResult {
    // Mock provider doesn't use webhooks
    return { isValid: false };
  }
}

/**
 * Generates a simple SVG "QR code" placeholder as a data URI.
 * It's not a real QR — just a visual placeholder with the amount shown.
 */
function generateMockQrSvgDataUri(upiLink: string, amount: number): string {
  // Create a deterministic grid pattern from the UPI link string
  const cells = 21;
  const cellSize = 10;
  const size = cells * cellSize;
  let rects = '';

  // Simple hash-based pattern to make it look like a QR code
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const charCode = upiLink.charCodeAt((row * cells + col) % upiLink.length) || 0;
      const isFilled =
        // Finder patterns (top-left, top-right, bottom-left corners)
        isFinderPattern(row, col, cells) ||
        // Data area — pseudo-random from the link string
        ((charCode * (row + 1) * (col + 1)) % 3 === 0 && !isFinderExclusion(row, col, cells));

      if (isFilled) {
        rects += `<rect x="${col * cellSize}" y="${row * cellSize}" width="${cellSize}" height="${cellSize}" fill="#000"/>`;
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="#fff"/>
    ${rects}
  </svg>`;

  const encoded = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${encoded}`;
}

function isFinderPattern(row: number, col: number, cells: number): boolean {
  // Top-left 7x7
  if (row < 7 && col < 7) return isFinderCell(row, col);
  // Top-right 7x7
  if (row < 7 && col >= cells - 7) return isFinderCell(row, col - (cells - 7));
  // Bottom-left 7x7
  if (row >= cells - 7 && col < 7) return isFinderCell(row - (cells - 7), col);
  return false;
}

function isFinderCell(r: number, c: number): boolean {
  // Outer border or center dot of finder pattern
  if (r === 0 || r === 6 || c === 0 || c === 6) return true;
  if (r >= 2 && r <= 4 && c >= 2 && c <= 4) return true;
  return false;
}

function isFinderExclusion(row: number, col: number, cells: number): boolean {
  // Keep separator zones around finder patterns empty
  if (row < 8 && col < 8) return true;
  if (row < 8 && col >= cells - 8) return true;
  if (row >= cells - 8 && col < 8) return true;
  return false;
}
