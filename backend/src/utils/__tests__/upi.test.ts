import {
  buildUpiUri,
  defaultUpiAccount,
  ensureSingleDefault,
  normaliseUpiConfig,
  resolveUpiAccount,
  UpiAccount,
} from '../upi';

/**
 * bug3 — multiple UPI collection accounts.
 *
 * The riskiest part is the read path: prod already holds the legacy single
 * `{ vpa, merchantName }` blob under the `upiConfig` setting, with no migration
 * attached to it. If normalisation dropped that, the store would silently lose
 * its payment address the first time a receipt printed after deploy.
 */
const acc = (over: Partial<UpiAccount> = {}): UpiAccount => ({
  id: 'a',
  label: 'A',
  vpa: 'a@ybl',
  merchantName: '',
  isDefault: false,
  active: true,
  ...over,
});

describe('normaliseUpiConfig', () => {
  it('carries the legacy single-VPA blob forward as a default account', () => {
    const cfg = normaliseUpiConfig({ vpa: 'store@ybl', merchantName: "Sabiha's Ethnic" });

    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts[0].vpa).toBe('store@ybl');
    expect(cfg.accounts[0].merchantName).toBe("Sabiha's Ethnic");
    expect(cfg.accounts[0].isDefault).toBe(true);
    expect(cfg.accounts[0].active).toBe(true);
  });

  it('treats an empty legacy blob as no accounts, not a blank account', () => {
    expect(normaliseUpiConfig({ vpa: '', merchantName: '' }).accounts).toHaveLength(0);
    expect(normaliseUpiConfig({}).accounts).toHaveLength(0);
    expect(normaliseUpiConfig(null).accounts).toHaveLength(0);
    expect(normaliseUpiConfig(undefined).accounts).toHaveLength(0);
  });

  it('passes the new list shape through', () => {
    const cfg = normaliseUpiConfig({
      accounts: [
        { id: 'hdfc', label: 'Shop HDFC', vpa: 'shop@hdfcbank', merchantName: 'Shop', isDefault: true, active: true },
        { id: 'gpay', label: 'Owner GPay', vpa: 'owner@okhdfcbank', merchantName: '', isDefault: false, active: true },
      ],
    });

    expect(cfg.accounts.map((a) => a.id)).toEqual(['hdfc', 'gpay']);
    expect(defaultUpiAccount(cfg)?.id).toBe('hdfc');
  });

  it('drops entries with no VPA and derives a missing id from the label', () => {
    const cfg = normaliseUpiConfig({
      accounts: [{ label: 'Shop HDFC', vpa: 'shop@hdfcbank' }, { label: 'Blank', vpa: '  ' }],
    });

    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts[0].id).toBe('shop-hdfc');
  });
});

describe('ensureSingleDefault', () => {
  it('promotes the first active account when none is marked', () => {
    const out = ensureSingleDefault([acc({ id: 'x' }), acc({ id: 'y' })]);
    expect(out.filter((a) => a.isDefault).map((a) => a.id)).toEqual(['x']);
  });

  it('keeps exactly one when several are marked', () => {
    const out = ensureSingleDefault([
      acc({ id: 'x', isDefault: true }),
      acc({ id: 'y', isDefault: true }),
    ]);
    expect(out.filter((a) => a.isDefault)).toHaveLength(1);
  });

  it('never defaults to an inactive account', () => {
    const out = ensureSingleDefault([
      acc({ id: 'retired', isDefault: true, active: false }),
      acc({ id: 'live' }),
    ]);
    expect(out.find((a) => a.isDefault)?.id).toBe('live');
  });
});

describe('resolveUpiAccount', () => {
  const cfg = {
    accounts: [acc({ id: 'hdfc', isDefault: true }), acc({ id: 'gpay' }), acc({ id: 'old', active: false })],
  };

  it('returns the requested account', () => {
    expect(resolveUpiAccount(cfg, 'gpay')?.id).toBe('gpay');
  });

  it('falls back to the default for an unknown or inactive id', () => {
    expect(resolveUpiAccount(cfg, 'nope')?.id).toBe('hdfc');
    expect(resolveUpiAccount(cfg, 'old')?.id).toBe('hdfc');
    expect(resolveUpiAccount(cfg, null)?.id).toBe('hdfc');
  });

  it('returns null when nothing is configured', () => {
    expect(resolveUpiAccount({ accounts: [] }, 'x')).toBeNull();
  });
});

describe('buildUpiUri', () => {
  it('keeps the @ in the VPA raw and pre-fills the amount', () => {
    const uri = buildUpiUri({ vpa: 'shop@hdfcbank', name: "Sabiha's", amount: 1234.5, note: 'SL-1' });

    expect(uri).toContain('pa=shop@hdfcbank');
    expect(uri).toContain('am=1234.50');
    expect(uri).toContain('cu=INR');
    expect(uri).toContain('tn=SL-1');
    expect(uri).toContain(`pn=${encodeURIComponent("Sabiha's")}`);
  });

  it('omits the amount when it is zero', () => {
    expect(buildUpiUri({ vpa: 'a@b', amount: 0 })).not.toContain('am=');
  });
});
