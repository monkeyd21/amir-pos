import { gstRateForPrice, hsnForCategory, APPAREL_GST_THRESHOLD } from '../tax';

describe('GST rate by price (₹2,500 apparel threshold)', () => {
  it('applies 5% at or below ₹2,500', () => {
    expect(gstRateForPrice(1)).toBe(5);
    expect(gstRateForPrice(1510)).toBe(5);
    expect(gstRateForPrice(2500)).toBe(5); // boundary inclusive
    expect(APPAREL_GST_THRESHOLD).toBe(2500);
  });
  it('applies 18% above ₹2,500', () => {
    expect(gstRateForPrice(2500.01)).toBe(18);
    expect(gstRateForPrice(2600)).toBe(18);
    expect(gstRateForPrice(9999)).toBe(18);
  });
});

describe('HSN routing by category', () => {
  it('Dress → 6211', () => {
    expect(hsnForCategory('Dress')).toBe('6211');
    expect(hsnForCategory('DRESS')).toBe('6211');
  });
  it('CORDSET / Frocks / One Piece → 6204', () => {
    expect(hsnForCategory('CORDSET')).toBe('6204');
    expect(hsnForCategory('Frocks')).toBe('6204');
    expect(hsnForCategory('FROCK')).toBe('6204');
    expect(hsnForCategory('One Piece')).toBe('6204');
  });
  it('unknown / TUNICS / blank → 6204 (default)', () => {
    expect(hsnForCategory('TUNICS')).toBe('6204');
    expect(hsnForCategory('')).toBe('6204');
    expect(hsnForCategory(null)).toBe('6204');
  });
});
