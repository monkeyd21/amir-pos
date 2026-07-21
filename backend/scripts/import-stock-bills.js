/**
 * Full migration — Stock Import 26-27 workbook → amir-pos.
 * Three domains from the 5-tab workbook:
 *   1. "Previous Stock"                    → Brands / Categories / Products / Variants / Inventory
 *   2. "CUSTOMER POINT LEDGER 26-27/25-26" → Customers + loyalty balance
 *   3. "PREVIOUS BILLS 25-26/26-27"        → HistoricalBill / HistoricalBillItem (archive, linked to customer)
 *
 * Product model: product = ITEM NAME minus COLOUR; variant = COLOUR × PACK/SIZE.
 * PURCHASE RATE is EXTENDED → per-unit landed = PURCHASE / CLOSING STOCK.
 *
 * TWO-STAGE (prod has no xlsx):
 *   node scripts/import-stock-bills.js book.xlsx --dump payload.json   # parse locally (no DB)
 *   node scripts/import-stock-bills.js payload.json --commit           # load on prod (no xlsx)
 * Passing a .json without --commit just prints the tally.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const FILE = args.find((a) => a.endsWith('.xlsx') || a.endsWith('.json'));
const COMMIT = args.includes('--commit');
const DUMP = (() => { const i = args.indexOf('--dump'); return i >= 0 ? args[i + 1] : null; })();
const BRANCH_ID = 1;

const WIPE_TABLES = [
  'historical_bill_items', 'historical_bills',
  'sale_items', 'sales', 'payments', 'returns', 'return_items', 'commissions',
  'loyalty_transactions', 'voucher_redemptions', 'gift_vouchers', 'upi_payment_intents',
  'message_logs', 'held_transactions', 'pos_sessions', 'variance_logs',
  'inventory_movements', 'inventory', 'stock_transfer_items', 'stock_transfers',
  'offer_variants', 'offer_products', 'offers',
  'product_variants', 'products', 'brands', 'categories',
  'vendor_payments', 'vendors', 'expenses', 'journal_lines', 'journal_entries',
  'attendance', 'audit_logs', 'customers', 'bill_sequences',
];

const num = (x) => { const v = parseFloat(String(x == null ? '' : x).replace(/,/g, '').trim()); return isFinite(v) ? v : 0; };
const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const rnd = () => Math.random().toString(36).slice(2, 7);
const round2 = (n) => Math.round(n * 100) / 100;
function normPhone(v) { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; }
function hsnFor(cat) { return String(cat || '').trim().toUpperCase() === 'DRESS' ? '6211' : '6204'; }
function baseName(name, colour) {
  let nm = String(name || '').trim(); const c = String(colour || '').trim();
  if (c && nm.toUpperCase().endsWith(c.toUpperCase())) nm = nm.slice(0, nm.length - c.length).trim();
  return nm || String(name || '').trim();
}

// ───────────────────────── PARSE (xlsx → payload) ─────────────────────────
function parse(FILE) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(FILE);
  // BILL DATE cells are a MIX of true Excel serials (numbers) and TEXT strings
  // like "14/08/2025" (dd/mm/yyyy — Indian FY, header says "From 01/04/2025 …").
  // A number-only parse silently dropped ~57% of dates to null. Handle both.
  const excelDate = (raw) => {
    if (raw === '' || raw == null) return null;
    if (typeof raw === 'number' || /^\d+(\.\d+)?$/.test(String(raw).trim())) {
      const n = num(raw); if (!n || n < 1000) return null;
      const o = XLSX.SSF.parse_date_code(n);
      return o ? new Date(Date.UTC(o.y, o.m - 1, o.d, 6, 0, 0)).toISOString() : null;
    }
    const s = String(raw).trim();
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/); // dd/mm/yyyy
    if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (y < 100) y += 2000; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return new Date(Date.UTC(y, mo - 1, d, 6, 0, 0)).toISOString(); }
    const t = Date.parse(s); if (!isNaN(t)) { const dt = new Date(t); return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 6, 0, 0)).toISOString(); }
    return null;
  };
  // First parseable date across the bill's rows (some rows in a group are blank).
  const pickDate = (rs) => { for (const r of rs) { const d = excelDate(r[2]); if (d) return d; } return null; };

  // STOCK
  const srows = XLSX.utils.sheet_to_json(wb.Sheets['Previous Stock'], { defval: '' })
    .filter((r) => String(r['ITEM NAME'] || '').trim() && !/TOTAL/i.test(String(r['VENDOR'] || '')) && (num(r['MRP']) > 0 || num(r['SALE RATE']) > 0));
  const seenBc = new Set(), seenSku = new Set(), dupBc = [];
  const groups = new Map();
  for (const r of srows) {
    const bc = String(r['BARCODE NUMBER'] || '').trim(), sku = String(r['SKU'] || '').trim();
    if (bc && seenBc.has(bc)) { dupBc.push(bc); continue; }
    if (sku && seenSku.has(sku)) { dupBc.push('SKU:' + sku); continue; }
    if (bc) seenBc.add(bc); if (sku) seenSku.add(sku);
    const brand = String(r['VENDOR'] || '').trim() || 'General';
    let category = String(r['CATEGORY'] || '').trim(); if (!category || category.toUpperCase() === '(NIL)') category = 'Uncategorized';
    const key = brand + '||' + baseName(r['ITEM NAME'], r['COLOUR']);
    if (!groups.has(key)) groups.set(key, { name: baseName(r['ITEM NAME'], r['COLOUR']), brand, category, rows: [] });
    groups.get(key).rows.push(r);
  }
  const products = [];
  for (const [, g] of groups) {
    const f = g.rows[0];
    const pMrp = num(f['MRP']), pSale = num(f['SALE RATE']) || round2(pMrp * 0.9), pCost = num(f['BASIC RATE']);
    const pQ = Math.trunc(num(f['CLOSING STOCK'])), pLand = pQ > 0 ? round2(num(f['PURCHASE RATE']) / pQ) : pCost;
    const rate = pMrp > 2500 ? 18 : 5;
    const variants = g.rows.map((r) => {
      const q = Math.trunc(num(r['CLOSING STOCK']));
      const mrp = num(r['MRP']), sale = num(r['SALE RATE']) || round2(mrp * 0.9), cost = num(r['BASIC RATE']);
      const land = q > 0 ? round2(num(r['PURCHASE RATE']) / q) : cost;
      return {
        sku: String(r['SKU'] || '').trim(), barcode: String(r['BARCODE NUMBER'] || '').trim(),
        size: String(r['PACK/SIZE'] || '').trim(), color: String(r['COLOUR'] || '').trim(),
        lotCode: String(r['LOT CODE'] || '').trim() || null, qty: q,
        mrpOverride: mrp !== pMrp ? mrp : null, priceOverride: sale !== pSale ? sale : null,
        costOverride: cost !== pCost ? cost : null, landingOverride: land !== pLand ? land : null,
      };
    });
    products.push({ name: g.name, brand: g.brand, category: g.category, mrp: pMrp, basePrice: pSale || pMrp || 1, costPrice: pCost || 0, landingPrice: pLand, hsn: hsnFor(g.category), cgst: rate / 2, sgst: rate / 2, variants });
  }

  // CUSTOMERS
  const cust = new Map();
  const y27 = XLSX.utils.sheet_to_json(wb.Sheets['CUSTOMER POINT LEDGER 26-27'], { header: 1, defval: '' }).slice(2);
  const in27 = new Set();
  for (const r of y27) { const p = normPhone(r[6]); if (!p) continue; in27.add(p); const c = cust.get(p) || { name: '', points: 0, spent: 0 }; if (!c.name && String(r[1]).trim()) c.name = String(r[1]).trim(); c.points = Math.max(c.points, num(r[4])); c.spent = num(r[2]); cust.set(p, c); }
  const y26 = XLSX.utils.sheet_to_json(wb.Sheets['CUSTOMER POINT LEDGER 25-26'], { header: 1, defval: '' }).slice(2);
  for (const r of y26) { const p = normPhone(r[9]); if (!p || in27.has(p)) continue; const c = cust.get(p) || { name: '', points: 0, spent: 0 }; if (!c.name && String(r[1]).trim()) c.name = String(r[1]).trim(); c.points = Math.max(c.points, num(r[8])); c.spent += num(r[4]); cust.set(p, c); }

  // BILLS
  const parseBills = (tab, fy, prefix) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], { header: 1, defval: '' }).slice(2).filter((r) => r.length > 3 && String(r[1]).trim());
    const order = [], byBill = new Map();
    for (const r of rows) { const b = String(r[1]).trim(); if (!byBill.has(b)) { byBill.set(b, []); order.push(b); } byBill.get(b).push(r); }
    const out = []; let seq = 0;
    for (const b of order) {
      const rs = byBill.get(b); seq++;
      const pick = (idx) => { for (const r of rs) if (String(r[idx]).trim() !== '') return num(r[idx]); return 0; };
      const gross = pick(15), total = pick(18);
      let tax = 0; const items = rs.map((r) => { const sgst = num(r[24]), cgst = num(r[25]); tax += sgst + cgst; const qty = num(r[11]), rt = num(r[13]); return { barcode: String(r[7] || '').trim() || null, itemName: String(r[8] || '').trim() || null, colour: String(r[9] || '').trim() || null, size: String(r[10] || '').trim() || null, category: String(r[5] || '').trim() || null, brandName: String(r[6] || '').trim() || null, quantity: Math.trunc(qty), mrp: num(r[12]), rate: rt, cdPercent: num(r[14]), sgst, cgst, lineTotal: round2(rt * qty) }; });
      out.push({ billNumber: `${prefix}-${String(seq).padStart(4, '0')}`, fiscalYear: fy, originalBillNo: b, billDate: pickDate(rs), customerNameRaw: String(rs[0][3] || '').trim() || null, customerMobile: normPhone(rs[0][4]) || null, grossAmount: round2(gross), discountAmount: round2(gross - total), taxAmount: round2(tax), total: round2(total), cashAmount: round2(pick(20)), cardAmount: round2(pick(19)), items });
    }
    return out;
  };
  const bills = [...parseBills('PREVIOUS BILLS 25-26', '2025-26', 'H25'), ...parseBills('PREVIOUS BILLS 26-27', '2026-27', 'H26')];
  const visits = {};
  for (const b of bills) if (b.customerMobile) visits[b.customerMobile] = (visits[b.customerMobile] || 0) + 1;

  const customers = [...cust.entries()].map(([phone, c]) => { const parts = (c.name || '').trim().split(/\s+/).filter(Boolean); return { phone, firstName: parts[0] || phone, lastName: parts.length > 1 ? parts.slice(1).join(' ') : null, points: Math.max(0, Math.round(c.points)), spent: round2(c.spent), visits: visits[phone] || 0 }; });
  return { products, customers, bills, dupBc };
}

function tally(p) {
  let variants = 0, pieces = 0, mrpV = 0, saleV = 0, costV = 0, landV = 0;
  const brands = new Set(), cats = new Set();
  for (const pr of p.products) { brands.add(pr.brand); cats.add(pr.category); for (const v of pr.variants) { variants++; pieces += v.qty; const mrp = v.mrpOverride ?? pr.mrp, sale = v.priceOverride ?? pr.basePrice, cost = v.costOverride ?? pr.costPrice, land = v.landingOverride ?? pr.landingPrice; mrpV += mrp * v.qty; saleV += sale * v.qty; costV += cost * v.qty; landV += land * v.qty; } }
  const pts = p.customers.reduce((s, c) => s + c.points, 0), spent = p.customers.reduce((s, c) => s + c.spent, 0);
  const billTotal = p.bills.reduce((s, b) => s + b.total, 0), items = p.bills.reduce((s, b) => s + b.items.length, 0);
  const stockBc = new Set(p.products.flatMap((pr) => pr.variants.map((v) => v.barcode)));
  let matched = 0, missed = 0; for (const b of p.bills) for (const it of b.items) if (it.barcode) (stockBc.has(it.barcode) ? matched++ : missed++);
  console.log('\n── STOCK ──');
  console.log(`products ${p.products.length} | variants ${variants} | pieces ${pieces} | brands ${brands.size} | cats ${[...cats].join(', ')} | dup-skipped ${p.dupBc.length}`);
  console.log(`MRP Rs ${Math.round(mrpV).toLocaleString()} | Sale Rs ${Math.round(saleV).toLocaleString()} | Cost Rs ${Math.round(costV).toLocaleString()} | Landed Rs ${Math.round(landV).toLocaleString()}`);
  console.log('── CUSTOMERS ──');
  console.log(`customers ${p.customers.length} | points ${Math.round(pts).toLocaleString()} | totalSpent Rs ${Math.round(spent).toLocaleString()}`);
  console.log('── BILLS ──');
  console.log(`bills ${p.bills.length} | items ${items} | total Rs ${Math.round(billTotal).toLocaleString()} | barcode→variant ${matched}/${matched + missed}`);
}

async function commit(p) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    console.log('\nWiping…');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${WIPE_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
    const brandId = new Map(), catId = new Map();
    for (const name of new Set(p.products.map((x) => x.brand))) { const b = await prisma.brand.create({ data: { name, slug: slugify(name) + '-' + rnd() } }); brandId.set(name, b.id); }
    for (const name of new Set(p.products.map((x) => x.category))) { const c = await prisma.category.create({ data: { name, slug: slugify(name) + '-' + rnd() } }); catId.set(name, c.id); }
    const bcToVariant = new Map(); let pN = 0, vN = 0;
    for (const pr of p.products) {
      const prod = await prisma.product.create({ data: { name: pr.name, slug: slugify(pr.name + '-' + pr.brand) + '-' + rnd(), brandId: brandId.get(pr.brand), categoryId: catId.get(pr.category), mrp: pr.mrp, basePrice: pr.basePrice, costPrice: pr.costPrice, landingPrice: pr.landingPrice, hsnCode: pr.hsn, cgstRate: pr.cgst, sgstRate: pr.sgst, priceIncludesTax: true } });
      pN++;
      for (const v of pr.variants) {
        const vr = await prisma.productVariant.create({ data: { productId: prod.id, sku: v.sku || 'AUTO-' + rnd(), barcode: v.barcode || 'AUTO-' + rnd(), size: v.size, color: v.color, lotCode: v.lotCode, mrpOverride: v.mrpOverride, priceOverride: v.priceOverride, costOverride: v.costOverride, landingOverride: v.landingOverride } });
        vN++;
        await prisma.inventory.create({ data: { variantId: vr.id, branchId: BRANCH_ID, quantity: v.qty, minStockLevel: 0 } });
        if (v.barcode) bcToVariant.set(v.barcode, vr.id);
      }
    }
    console.log(`stock: ${pN} products, ${vN} variants`);
    const phoneToId = new Map(); let cN = 0;
    for (const c of p.customers) { const cu = await prisma.customer.create({ data: { firstName: c.firstName, lastName: c.lastName, phone: c.phone, loyaltyPoints: c.points, totalSpent: c.spent, visitCount: c.visits } }); phoneToId.set(c.phone, cu.id); cN++; }
    console.log(`customers: ${cN}`);
    let bN = 0, iN = 0;
    for (const b of p.bills) {
      const custId = b.customerMobile ? (phoneToId.get(b.customerMobile) || null) : null;
      const row = await prisma.$queryRawUnsafe(`INSERT INTO "historical_bills" ("billNumber","fiscalYear","originalBillNo","billDate","customerId","customerNameRaw","customerMobile","grossAmount","discountAmount","taxAmount","total","cashAmount","cardAmount") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        b.billNumber, b.fiscalYear, b.originalBillNo, b.billDate ? new Date(b.billDate) : null, custId, b.customerNameRaw, b.customerMobile, b.grossAmount, b.discountAmount, b.taxAmount, b.total, b.cashAmount, b.cardAmount);
      const billId = row[0].id; bN++;
      for (const it of b.items) {
        const vid = it.barcode ? (bcToVariant.get(it.barcode) || null) : null;
        await prisma.$executeRawUnsafe(`INSERT INTO "historical_bill_items" ("historicalBillId","barcode","itemName","colour","size","category","brandName","quantity","mrp","rate","cdPercent","sgst","cgst","lineTotal","variantId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          billId, it.barcode, it.itemName, it.colour, it.size, it.category, it.brandName, it.quantity, it.mrp, it.rate, it.cdPercent, it.sgst, it.cgst, it.lineTotal, vid);
        iN++;
      }
    }
    console.log(`bills: ${bN} archived, ${iN} items`);
    console.log('=== COMMIT DONE ===');
  } finally { await prisma.$disconnect(); }
}

async function main() {
  if (!FILE) throw new Error('Pass book.xlsx (with --dump out.json) or payload.json (with --commit)');
  const payload = FILE.endsWith('.xlsx') ? parse(FILE) : JSON.parse(fs.readFileSync(FILE, 'utf8'));
  console.log(`${COMMIT ? '=== COMMIT ===' : DUMP ? '=== DUMP ===' : '=== DRY RUN ==='}  ${path.basename(FILE)}`);
  tally(payload);
  if (DUMP) { fs.writeFileSync(DUMP, JSON.stringify(payload)); console.log(`\nwrote payload → ${DUMP} (${(fs.statSync(DUMP).size / 1024).toFixed(0)} KB)`); }
  if (COMMIT) await commit(payload);
}
main().catch((e) => { console.error(e); process.exit(1); });
