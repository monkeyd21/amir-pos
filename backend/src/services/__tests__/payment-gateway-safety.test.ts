/**
 * §safety — the mock gateway must never be reachable in production.
 *
 * It marks payments COMPLETE without any money moving. Running it in production
 * would settle real orders, decrement real stock and write real Sale rows for
 * cash nobody ever paid. `PAYMENT_PROVIDER` being unset defaults to mock, which
 * is exactly how that would happen by accident.
 */
import { getPaymentGateway, resetPaymentGateway } from '../payment-gateway';

describe('payment gateway safety', () => {
  const env = process.env;

  beforeEach(() => {
    resetPaymentGateway();
    process.env = { ...env };
  });

  afterAll(() => {
    process.env = env;
    resetPaymentGateway();
  });

  it('refuses to hand back the mock provider in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.PAYMENT_PROVIDER = 'mock';
    expect(() => getPaymentGateway()).toThrow(/mock.*production/i);
  });

  it('refuses when PAYMENT_PROVIDER is simply unset in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PAYMENT_PROVIDER;
    // Unset defaults to mock — the most likely misconfiguration of the lot.
    expect(() => getPaymentGateway()).toThrow(/mock.*production/i);
  });

  it('allows the mock provider outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.PAYMENT_PROVIDER = 'mock';
    expect(getPaymentGateway().name).toBeDefined();
  });
});
