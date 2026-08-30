import { PaymentGatewayProvider } from './types';
import { CashfreeProvider } from './cashfree.provider';
import { MockProvider } from './mock.provider';

let instance: PaymentGatewayProvider | null = null;

export function getPaymentGateway(): PaymentGatewayProvider {
  if (instance) return instance;

  const provider = process.env.PAYMENT_PROVIDER || 'mock';

  switch (provider) {
    case 'cashfree':
      instance = new CashfreeProvider({
        appId: process.env.CASHFREE_APP_ID || '',
        secretKey: process.env.CASHFREE_SECRET_KEY || '',
        webhookSecret: process.env.CASHFREE_WEBHOOK_SECRET || '',
        environment: (process.env.CASHFREE_ENVIRONMENT || 'sandbox') as
          | 'sandbox'
          | 'production',
      });
      break;
    case 'mock':
      // §safety — the mock provider marks payments COMPLETE without any money
      // moving. In production that would settle real orders, decrement real
      // stock and write real Sale rows for cash nobody ever paid. It must never
      // run there, and defaulting to it (PAYMENT_PROVIDER unset) is the most
      // likely way that happens by accident.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'Refusing to start: PAYMENT_PROVIDER is "mock" in production. ' +
            'The mock gateway completes payments without collecting money. ' +
            'Set PAYMENT_PROVIDER=cashfree with real credentials.'
        );
      }
      instance = new MockProvider(
        parseInt(process.env.MOCK_PAYMENT_DELAY_MS || '8000', 10)
      );
      break;
    default:
      throw new Error(`Unknown payment provider: ${provider}`);
  }

  return instance;
}

// For testing - reset the singleton
export function resetPaymentGateway(): void {
  instance = null;
}

export * from './types';
