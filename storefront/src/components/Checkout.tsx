'use client';

/**
 * Checkout: sign in → address → review → pay.
 *
 * One page, three steps, no page loads between them. The hold countdown stays
 * visible throughout, because the whole point of the reservation is that the
 * shopper knows the stock is theirs while they type.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import HoldTimer from './HoldTimer';
import { rupees, sizeWithAge } from '@/lib/format';
import { CUSTOMER_AUTH } from '@clothing-erp/shared';

type Step = 'identify' | 'address' | 'review';

interface Address {
  id: number;
  name: string; phone: string; line1: string; line2?: string | null;
  landmark?: string | null; city: string; state: string; pincode: string;
  isDefault: boolean;
}

const emptyAddress = {
  name: '', phone: '', line1: '', line2: '', landmark: '',
  city: '', state: '', pincode: '',
};

export default function Checkout({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(signedIn ? 'address' : 'identify');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // identify
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [code, setCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  // address
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressId, setAddressId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyAddress });
  const [adding, setAdding] = useState(false);

  // review
  const [quote, setQuote] = useState<any>(null);
  const [payment, setPayment] = useState<any>(null);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);

  const loadAddresses = useCallback(async () => {
    const res = await fetch('/api/shop/addresses');
    const body = await res.json();
    if (body.success) {
      setAddresses(body.data);
      const preferred = body.data.find((a: Address) => a.isDefault) ?? body.data[0];
      if (preferred) setAddressId(preferred.id);
      setAdding(body.data.length === 0);
    }
  }, []);

  const loadQuote = useCallback(async () => {
    const res = await fetch('/api/shop/checkout/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMode: 'prepaid' }),
    });
    const body = await res.json();
    if (body.success) setQuote(body.data);
    else setError(body.error);
  }, []);

  useEffect(() => {
    if (step === 'address') void loadAddresses();
    if (step === 'review') void loadQuote();
  }, [step, loadAddresses, loadQuote]);

  useEffect(() => {
    void loadQuote();
  }, [loadQuote]);

  async function post(url: string, payload: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!body.success) {
        setError(body.error || 'Something went wrong.');
        return null;
      }
      return body.data;
    } catch {
      setError('We could not reach the shop. Please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  // ── Steps ────────────────────────────────────────────────────────────────

  async function sendOtp() {
    const data = await post('/api/shop/auth/otp/request', { phone });
    if (data) {
      setOtpSent(true);
      setDevCode(data.devCode ?? null);
    }
  }

  async function verifyOtp() {
    const data = await post('/api/shop/auth/otp/verify', { phone, code, firstName });
    if (data) setStep('address');
  }

  async function saveAddress() {
    const data = await post('/api/shop/addresses', { ...form, isDefault: addresses.length === 0 });
    if (data) {
      setAdding(false);
      setForm({ ...emptyAddress });
      await loadAddresses();
      setAddressId(data.id);
    }
  }

  async function placeOrder() {
    if (!addressId) {
      setError('Please choose a delivery address.');
      return;
    }
    const data = await post('/api/shop/checkout/place', {
      addressId,
      paymentMode: 'prepaid',
    });
    if (data) {
      setOrderNumber(data.order.orderNumber);
      setPayment(data.payment);
      window.dispatchEvent(new Event('cart:changed'));
    }
  }

  /** Poll while the shopper pays; the webhook usually wins the race. */
  useEffect(() => {
    if (!orderNumber || !payment) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/shop/orders/${orderNumber}/status`);
      const body = await res.json();
      if (body.success && body.data.status === 'paid') {
        clearInterval(t);
        router.push(`/order/${orderNumber}`);
      }
      if (body.success && body.data.status === 'failed') {
        clearInterval(t);
        setError(
          body.data.reason === 'sold_out'
            ? 'That item sold in the shop while your payment was going through. You have not been charged — if any amount was taken it will be refunded.'
            : 'The payment did not go through. Nothing has been charged.'
        );
        setPayment(null);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [orderNumber, payment, router]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-7">
        <h1 className="text-[30px]">Checkout</h1>

        {quote?.holdExpiresAt && !payment && (
          <HoldTimer expiresAt={quote.holdExpiresAt} label="Your bag is held while you check out" />
        )}

        {error && (
          <p role="alert" className="border border-brand bg-[#fdf2f5] px-4 py-3.5 text-[14px] text-brand">
            {error}
          </p>
        )}

        {/* ── Pay ── */}
        {payment ? (
          <section className="border border-rule p-6">
            <h2 className="mb-1.5 font-display text-[21px]">Pay {rupees(payment.amount)}</h2>
            <p className="mb-5 text-[14px] text-body">
              Scan with any UPI app — GPay, PhonePe, Paytm. This page will move on by itself
              once the payment lands.
            </p>
            {payment.qrCodeUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={payment.qrCodeUrl} alt="UPI QR code" className="mx-auto w-56" />
            )}
            {payment.upiLink && (
              <a href={payment.upiLink} className="btn-primary mt-5 block text-center">
                Open a UPI app
              </a>
            )}
            <p className="mt-4 text-center text-[12.5px] text-muted">
              Order {orderNumber} · do not close this page
            </p>
          </section>
        ) : (
          <>
            {/* ── Identify ── */}
            <StepBlock n={1} title="Your phone number" active={step === 'identify'} done={step !== 'identify'}>
              {step === 'identify' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[14px] text-body">
                    We send a code on WhatsApp — no password to remember.
                  </p>
                  <input
                    className="field" inputMode="numeric" placeholder="10-digit mobile number"
                    aria-label="Mobile number"
                    value={phone} onChange={(e) => setPhone(e.target.value)} disabled={otpSent}
                  />
                  {!otpSent ? (
                    <button type="button" className="btn-primary" disabled={busy || phone.length < 10} onClick={sendOtp}>
                      {busy ? 'Sending…' : 'Send code'}
                    </button>
                  ) : (
                    <>
                      <input
                        className="field" inputMode="numeric"
                        placeholder={`${CUSTOMER_AUTH.otpLength}-digit code`}
                        aria-label="Verification code"
                        value={code} onChange={(e) => setCode(e.target.value)}
                      />
                      <input
                        className="field" placeholder="Your name (optional)"
                        aria-label="Your name"
                        value={firstName} onChange={(e) => setFirstName(e.target.value)}
                      />
                      {devCode && (
                        <p className="text-[13px] text-muted">Development code: {devCode}</p>
                      )}
                      <button type="button" className="btn-primary" disabled={busy || code.length < 4} onClick={verifyOtp}>
                        {busy ? 'Checking…' : 'Verify'}
                      </button>
                      <button type="button" className="text-[13px] underline" onClick={() => setOtpSent(false)}>
                        Change number
                      </button>
                    </>
                  )}
                </div>
              )}
            </StepBlock>

            {/* ── Address ── */}
            <StepBlock n={2} title="Delivery address" active={step === 'address'} done={step === 'review'}>
              {step === 'address' && (
                <div className="flex flex-col gap-4">
                  {addresses.length > 0 && !adding && (
                    <div className="flex flex-col gap-2.5">
                      {addresses.map((a) => (
                        <label
                          key={a.id}
                          className={`flex cursor-pointer gap-3 border p-4 ${
                            addressId === a.id ? 'border-ink' : 'border-rule'
                          }`}
                        >
                          <input
                            type="radio" name="address" className="mt-1"
                            checked={addressId === a.id} onChange={() => setAddressId(a.id)}
                          />
                          <span className="text-[14px] leading-relaxed">
                            <strong className="font-medium">{a.name}</strong> · {a.phone}
                            <br />
                            {a.line1}{a.line2 ? `, ${a.line2}` : ''}
                            <br />
                            {a.city}, {a.state} {a.pincode}
                          </span>
                        </label>
                      ))}
                      <button type="button" className="self-start text-[13.5px] underline" onClick={() => setAdding(true)}>
                        Add another address
                      </button>
                    </div>
                  )}

                  {adding && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                      <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                      <Field label="Flat, house, building" value={form.line1} onChange={(v) => setForm({ ...form, line1: v })} span />
                      <Field label="Area, street (optional)" value={form.line2} onChange={(v) => setForm({ ...form, line2: v })} span />
                      <Field label="Landmark (optional)" value={form.landmark} onChange={(v) => setForm({ ...form, landmark: v })} span />
                      <Field label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
                      <Field label="State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} />
                      <Field label="Pincode" value={form.pincode} onChange={(v) => setForm({ ...form, pincode: v })} />
                      <div className="sm:col-span-2">
                        <button type="button" className="btn-primary" disabled={busy} onClick={saveAddress}>
                          {busy ? 'Saving…' : 'Save address'}
                        </button>
                      </div>
                    </div>
                  )}

                  {!adding && addressId && (
                    <button type="button" className="btn-primary" onClick={() => setStep('review')}>
                      Continue
                    </button>
                  )}
                </div>
              )}
            </StepBlock>

            {/* ── Review ── */}
            <StepBlock n={3} title="Review and pay" active={step === 'review'} done={false}>
              {step === 'review' && quote && (
                <div className="flex flex-col gap-4">
                  <ul className="flex flex-col divide-y divide-line border-y border-line">
                    {quote.lines.map((l: any) => (
                      <li key={l.variantId} className="flex justify-between gap-4 py-3 text-[14px]">
                        <span>
                          {l.productName}
                          <span className="ml-2 text-muted">
                            Size {sizeWithAge(l.size, l.ageLabel)} × {l.quantity}
                          </span>
                        </span>
                        <span className="tnum shrink-0">{rupees(l.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="btn-brand" disabled={busy} onClick={placeOrder}>
                    {busy ? 'Placing order…' : `Pay ${rupees(quote.total)}`}
                  </button>
                  <p className="text-center text-[12.5px] text-muted">
                    You will pay by UPI on the next screen.
                  </p>
                </div>
              )}
            </StepBlock>
          </>
        )}
      </div>

      {/* Summary */}
      <aside className="h-fit border border-rule p-6 lg:sticky lg:top-6">
        <h2 className="mb-4 font-display text-[21px]">Order summary</h2>
        {quote ? (
          <>
            <dl className="flex flex-col gap-2.5 text-[14.5px]">
              <Row label="Items" value={rupees(quote.mrpTotal)} />
              {quote.offerDiscount > 0 && <Row label="Offers" value={`− ${rupees(quote.offerDiscount)}`} accent />}
              {quote.mrpTotal - quote.subtotal > 0 && (
                <Row label="Discount" value={`− ${rupees(quote.mrpTotal - quote.subtotal)}`} accent />
              )}
              {quote.loyaltyDiscount > 0 && <Row label="Loyalty points" value={`− ${rupees(quote.loyaltyDiscount)}`} accent />}
              {quote.prepaidDiscount > 0 && <Row label="Prepaid discount" value={`− ${rupees(quote.prepaidDiscount)}`} accent />}
              <Row label="Delivery" value={quote.shipping === 0 ? 'Free' : rupees(quote.shipping)} accent={quote.shipping === 0} />
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="text-[16px] font-medium">Total</span>
              <span className="tnum text-[20px] font-medium">{rupees(quote.total)}</span>
            </div>
            {quote.totalSavings > 0 && (
              <p className="mt-2 text-[13px] text-ok">You save {rupees(quote.totalSavings)}</p>
            )}
            <p className="mt-1.5 text-[12.5px] text-muted">Inclusive of all taxes.</p>
          </>
        ) : (
          <p className="text-[14px] text-muted">Working out your total…</p>
        )}
      </aside>
    </div>
  );
}

function StepBlock({
  n, title, active, done, children,
}: { n: number; title: string; active: boolean; done: boolean; children: React.ReactNode }) {
  return (
    <section className={`border p-6 ${active ? 'border-ink' : 'border-line'}`}>
      <h2 className="mb-4 flex items-center gap-3 text-[17px]">
        <span
          className={`tnum flex h-6 w-6 shrink-0 items-center justify-center border text-[12px] ${
            done ? 'border-ok bg-ok text-white' : active ? 'border-ink' : 'border-rule text-muted'
          }`}
        >
          {done ? '✓' : n}
        </span>
        <span className={active || done ? '' : 'text-muted'}>{title}</span>
      </h2>
      {children}
    </section>
  );
}

function Field({
  label, value, onChange, span,
}: { label: string; value: string; onChange: (v: string) => void; span?: boolean }) {
  return (
    <label className={`flex flex-col gap-1.5 ${span ? 'sm:col-span-2' : ''}`}>
      <span className="text-[12.5px] text-muted">{label}</span>
      <input className="field" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-body">{label}</dt>
      <dd className={`tnum ${accent ? 'text-ok' : ''}`}>{value}</dd>
    </div>
  );
}
