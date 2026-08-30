# Sabiha's Ethnic — Online Store (`storefront`)

**Status:** Planning · no code written yet
**Owner:** Imran
**Created:** 2026-08-30
**Tracks:** the build of a public e-commerce website on the same database as the existing POS/ERP.

This is the living tracking document. Tick the boxes as work lands. The
companion `tech-spec.html` holds the detailed technical design; this file holds
*what we're doing, in what order, and what's still unknown*.

---

## 1. Decisions taken (2026-08-30)

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | Codebase topology | **New workspace in this monorepo** — `storefront/` + `backend/src/modules/shop/` | One Prisma schema, one migration history, one `deploy.sh`. The offers/loyalty/GST/checkout engines are imported directly instead of being reimplemented or proxied over HTTP. |
| D2 | Storefront stack | **Next.js (App Router) + React + Tailwind** | Retail discovery is organic search. Server-rendered product pages are indexable; an SPA effectively is not. Cost accepted: two frameworks in the house. |
| D3 | Stock model | **Live shared stock + cart reservation** | The shop and the site sell from one stock room. A soft hold with expiry is what keeps the two channels honest with each other — necessary at today's thin stock, still correct as quantities grow. |
| D4 | v1 scope | **Browse → pay online → ship** | Full transactional store. Click-and-collect and WhatsApp ordering are additive later, not v1 blockers. |
| D5 | Visual direction | **Conventional Indian D2C**, per the houseofiqf.com reference | The reference is a stock Shopify Dawn 15.3.0 theme: announcement bar, MRP struck through on every card, trust strip, category tiles, reviews, dark footer. Familiar beats distinctive for a shop whose customers already buy this way. |
| D6 | Catalogue | **Kids ethnic wear**, sizes 12–36 mapped to ages 6 months–16 years | Numeric Indian kidswear sizing. The size number is not self-explanatory to a parent, so age travels with it everywhere in the UI. |

### Deliberately *not* in v1
Wishlist · product reviews · multi-currency · guest checkout without OTP ·
marketplace/multi-vendor · abandoned-cart automation · click-and-collect ·
subscription or loyalty-tier-gated pricing online.

---

## 2. The problem the shop actually has

The site and the shop floor sell from one stock room. A cashier can scan the
last of something at the same moment a shopper online is paying for it.

Stock levels today are thin — the schema notes `minStockLevel` defaults to 0
because most articles are currently single-piece — so the two channels collide
often. As buying moves to depth, collisions get rarer, but they never reach
zero, and one oversold order costs more than the engineering to prevent it.

The policy, in one line:

**An in-store scan beats an unpaid web hold. A paid web order beats an in-store
scan.** Settled money wins; unsettled intent loses.

Three consequences that must be built, not assumed:

- **`topUpShortfall()` must be disabled for `channel: 'online'`.** Today
  `pos/service.ts` silently manufactures an `adjustment` stock-in when a scan
  exceeds on-hand, so a counter sale never dead-ends (`§ghost-inventory`). That
  is right for a cashier holding the garment and wrong for a web order — it
  would mint phantom stock and ship nothing. Online checkout must fail loudly
  and auto-refund.
- **Availability is `inventory.quantity − active reservations`, never the raw
  quantity.** Any shop query reading the raw quantity is a bug.
- **Reservations expire lazily** (`expiresAt > now()` in the availability
  query), so correctness never depends on a cron job firing on a 1 GB box.

None of this is customer-facing. Shoppers see ordinary stock and ordinary sizes;
the only timer they ever meet is the one on their own held cart.

---

## 2a. Sizing — kids ethnic wear

The catalogue is children's ethnic wear and sizes are numeric, 12 to 36, mapped
to age:

| Size | Age | Size | Age | Size | Age |
|---|---|---|---|---|---|
| 12 | 6 months | 22 | 4 years | 32 | 11–12 years |
| 14 | 9 months | 24 | 5 years | 34 | 13–14 years |
| 16 | 1 year | 26 | 6 years | 36 | 15–16 years |
| 18 | 2 years | 28 | 7–8 years | | |
| 20 | 3 years | 30 | 9–10 years | | |

Four consequences that touch code, not just design:

- **`Size` has no age field.** The model is `{ name, sortOrder, isActive }`.
  Add `ageLabel` (e.g. `"4 years"`), plus `chestInches` and `lengthInches` for
  the size guide. Everything customer-facing shows the number and the age
  together — `22 · 4 years` — because a parent does not carry the mapping in
  their head. The barcode label keeps printing just the number.
- **The real size grid is not seeded.** `backend/prisma/seed.ts` has demo data
  (Levi's 28–36, Nike S–XXL). The thirteen real sizes need seeding before any
  catalogue work.
- **"Shop by age" is a primary browse axis**, alongside category. Parents
  arrive knowing an age, not a size. It needs to be a filter on listing pages
  and a navigation entry, not just a line in a size chart.
- **Thirteen sizes per style is a lot of variants.** A 300-style catalogue is
  ~3,900 variants. Fine for Postgres, but it makes the listing-page availability
  query (§4) hot, and it means "in stock" on a card means *some* size is
  available — the card must not imply the size a shopper wants is there.

### Size exchanges are the main support flow

In kidswear the commonest reason a parcel comes back is that the size was wrong,
not that the garment was. The original plan pushed reverse logistics to Phase 9;
that is probably wrong here. A same-product, different-size exchange should be
a first-class flow, and the ERP already has the machinery — `Return`,
`ReturnItem`, and `pos/exchange-policy.ts` with `canExchangeLine`.

Worth deciding early: does v1 ship a self-serve "wrong size, send me the next
one up" flow, or is that handled over WhatsApp at launch?

---

## 3. What we reuse vs. what is new

Reuse is the whole point of D1. Concretely:

| Concern | Verdict | Note |
|---|---|---|
| Products / variants / price stack | **Reuse as-is** | `mrpOverride → priceOverride` resolution is already correct. Never read product-level price where a variant price exists. |
| Offers engine (`offers/engine.ts`) | **Reuse + extend** | Needs an `onlineEligible` flag so counter-only promos don't leak to the web. |
| Loyalty earn/redeem | **Reuse** | Redemption online requires an OTP-verified customer. |
| GST / `priceIncludesTax` | **Reuse** | Shipping-charge GST is an open question — see §7. |
| `Sale` / `SaleItem` | **Reuse** | `SaleChannel.online` already exists in the schema. |
| `posService.checkout()` | **Reuse, guarded** | Already accepts `channel` and `clientRef`. Needs: no `PosSession` requirement, no shortfall top-up, no commission, on the online path. |
| Cashfree gateway + webhook | **Reuse the driver, new intent flow** | `createUpiPayment()` hard-requires an open POS session; the web needs a session-free sibling. |
| `Return` model | **Reuse** | Reverse logistics is post-v1; v1 accepts in-store drop-off and by-post returns. |
| WhatsApp (Graph API) | **Reuse** | Doubles as the login OTP channel and the order-status notifier. |
| Bill numbering | **Reuse** | `BillSequence` already anticipates an `O-` online prefix. |
| Customer identity | **NEW** | `Customer` has no password and no auth of any kind today. |
| Addresses | **NEW** | `Customer.address` is a single free-text line. Shipping needs structured, multiple, validated addresses. |
| Cart + reservation | **NEW** | `HeldTransaction` is a counter park-a-sale, not a web cart, and holds no stock. |
| Order lifecycle | **NEW** | A `Sale` means *money taken, stock gone*. An order that is placed-but-unpaid is not a Sale. |
| Product images | **NEW** | The schema has **zero** image fields anywhere. See §6. |
| Shipping / tracking | **NEW** | No carrier, no AWB, no serviceable-pincode concept exists. |

### The Order/Sale boundary (important)

`ShopOrder` owns the fulfilment lifecycle. The `Sale` row — the thing that hits
GST, reports, daily rollups and loyalty — is created **once, at payment
confirmation**, and never before. A cancelled unpaid order therefore leaves no
trace in the books, and the accounting side of the ERP needs no changes to stay
correct.

---

## 4. Build phases

### Phase 0 — Spec & design `IN PROGRESS`
- [x] Lock the four architectural decisions (D1–D4)
- [x] Audit the existing schema and checkout path for reuse and hazards
- [x] Write this tracking document
- [ ] Write `tech-spec.html`
- [ ] Produce the visual design canvas (storefront screens)
- [ ] Review + sign-off before any code is written

### Phase 1 — Data model & the image pipeline
- [ ] Migration: `ProductImage`, `Address`, `ShopCart`(+items), `StockReservation`, `ShopOrder`(+items), `Shipment`, `CustomerAuth`, `CustomerOtp`
- [ ] Migration: `Product.onlineVisible` / SEO content fields; `ProductVariant.onlineSellable`; `Offer.onlineEligible`
- [ ] Migration: `Size.ageLabel`, `Size.chestInches`, `Size.lengthInches`
- [ ] Seed the real size grid — 12 to 36, with age labels (replaces the demo Levi's/Nike sizes)
- [ ] Seed the system "Online Store" user + confirm which branch fulfils web orders
- [ ] Choose and wire object storage for images (Cloudflare R2 preferred — free egress)
- [ ] Bulk photo-upload tool in the ERP admin: scan barcode → shoot → upload → crop
- [ ] Backfill: decide the first ~100 SKUs to photograph and list

### Phase 2 — Shop API (`backend/src/modules/shop/`)
- [ ] Availability service — the single source of truth for "can this be sold online"
- [ ] Catalogue endpoints: list, filter, facets, search, single product
- [ ] Age/size filter — the primary browse axis for kidswear
- [ ] Cart: create, add (reserve), update, remove (release), extend hold
- [ ] Reservation sweeper + lazy expiry in every availability read
- [ ] Unit tests covering the concurrency cases in tech-spec §4.6

### Phase 3 — Storefront skeleton
- [ ] Scaffold `storefront/` as an npm workspace (Next.js + Tailwind)
- [ ] Add it to root `package.json` scripts and `deploy/deploy.sh`
- [ ] Home, category/listing, product detail, cart — server-rendered
- [ ] Size guide page (age → size → measurements) — high-traffic help page, linked from nav, footer and every product page
- [ ] Responsive pass (mobile is the majority of Indian retail traffic)

### Phase 4 — Customer identity
- [ ] Phone + OTP login over the existing WhatsApp integration
- [ ] Customer session tokens (separate from staff JWTs — different audience, different lifetime)
- [ ] Address book CRUD + pincode serviceability check
- [ ] Link a web signup to an existing `Customer` row by phone (do not duplicate the CRM record)

### Phase 5 — Checkout & payment
- [ ] Session-free online payment intent (Cashfree)
- [ ] Webhook → verify reservation still valid → create `Sale(channel: 'online')` → consume reservation
- [ ] Guard rails: no shortfall top-up, no POS session, no commission, `O-` bill prefix
- [ ] Auto-refund path when the piece vanished between payment and confirmation
- [ ] Order confirmation page + WhatsApp confirmation message

### Phase 6 — Fulfilment (ERP side)
- [ ] Orders screen in the Angular admin: new → packed → shipped → delivered
- [ ] Pick list / packing slip print (reuse the `printing` module)
- [ ] Carrier integration or manual AWB entry + tracking link
- [ ] Order-status notifications over WhatsApp

### Phase 7 — POS integration
- [ ] Cashier warning when scanning a barcode with a live web hold
- [ ] Verify `closeSession` cash-expectation math excludes online sales entirely
- [ ] Verify online sales don't distort commission, daily rollups, or drawer variance
- [ ] End-to-end race test: web hold vs. counter scan, both orderings

### Phase 8 — Launch
- [ ] SEO: sitemap, robots, canonical URLs, Open Graph, `schema.org/Product`
- [ ] `shop.sabihasethnic.com` (or apex) DNS + TLS + nginx vhost
- [ ] Analytics + basic conversion funnel
- [ ] Legal pages: returns, shipping, privacy, T&C
- [ ] Load-sanity check on the 1 GB Oracle box; decide if the storefront needs its own host

### Phase 9 — Post-launch backlog
- [ ] Online returns with reverse pickup
- [ ] Wishlist, reviews, recently-viewed
- [ ] Abandoned-cart WhatsApp nudge
- [ ] Click & collect
- [ ] "Order on WhatsApp" fallback button

---

## 5. Infrastructure reality check

The whole ERP currently runs on **one free Oracle ARM VM**, Node capped at a
1 GB heap, nginx → `:3000`, Angular served out of `backend/public`.

Adding a public, image-heavy, search-engine-crawled Next.js app to that box is
the main operational risk in this project. Positions to decide in Phase 3:

- **Images must not be served from the box.** Object storage + CDN, always.
- Next.js runs as a **second systemd service** on `:3001`; nginx routes by
  hostname. It does *not* get merged into the Express process.
- Expect to move the storefront (or the whole stack) to a paid host once real
  traffic and crawlers arrive. Budget for it rather than discovering it.

---

## 6. Photography

There are no images in the database. Not a missing column — the concept does
not exist in the schema. Every product needs shots before it can be listed, and
that is a content operation that will outlast the code.

Buying in depth changes the arithmetic here, decisively and in our favour. One
shoot covers a *product*, and all its size variants inherit it. At single-piece
stock, a hundred garments meant a hundred shoots; at six sizes a style, the same
hundred garments are seventeen shoots. Photography stops being the thing that
gates the catalogue.

Still needs deciding before Phase 1 closes:

- Who shoots — in-house on a phone, or a photographer?
- How many angles per product? Three is the realistic minimum: front, detail,
  fabric.
- What is the turnaround, and does it gate listing new arrivals?
- Which styles make the launch catalogue?

**Recommendation:** launch curated rather than exhaustive. Well-shot products
convert; grey placeholders do not.

---

## 7. Open questions

| # | Question | Blocks | Status |
|---|---|---|---|
| Q1 | Which branch fulfils web orders — a real store, or a dedicated online branch row? | Phase 1 | OPEN |
| Q2 | Shipping charges: flat, weight-based, or free above a threshold? And GST treatment of the shipping line (composite supply)? | Phase 5 | OPEN |
| Q3 | Courier — Delhivery/Shiprocket integration, or manual AWB entry in v1? | Phase 6 | OPEN |
| Q4 | Hold duration. 15 min is the proposed default; too short frustrates, too long hides stock from the counter. | Phase 2 | PROPOSED: 15 min cart / 20 min at checkout |
| Q5 | Do online sales earn staff commission? Proposal: no. | Phase 5 | PROPOSED: no |
| Q6 | Can loyalty points be redeemed online in v1? Proposal: yes, OTP-verified only. | Phase 5 | PROPOSED: yes |
| Q7 | Domain: `shop.sabihasethnic.com` or the apex, with the ERP staying on `erp.`? | Phase 8 | OPEN |
| Q8 | Return window and who pays return shipping? | Phase 9 | OPEN |
| Q9 | Photography ownership, cadence and launch catalogue (see §6). | Phase 1 | OPEN |
| Q10 | **Cash on delivery** — offer it globally, or gate it per product so thin lines stay prepaid-only? See §8. | Phase 5 | PROPOSED: offer, gated per product |
| Q11 | Headline discount depth. The reference runs 30–50% off MRP. Our schema auto-sets sale price at MRP − 10%, so every item shows a genuine 10% off. Deeper discounts, or stand behind the 10%? | Phase 3 | OPEN |
| Q12 | The real size grid. | Phase 3 | **ANSWERED** — 12 to 36, age-mapped. See §2a |
| Q13 | Real chest and length measurements per size. The size-guide design carries my estimates and must not ship with them. | Phase 3 | OPEN |
| Q14 | Does every style run the full 12–36, or do ranges vary per style? The designs assume ranges vary. | Phase 2 | OPEN |
| Q15 | Navigation — lead with Girls/Boys or with category? Designs assume both, Girls/Boys first. | Phase 3 | OPEN |
| Q16 | Self-serve size exchange in v1, or handle it over WhatsApp at launch? See §2a. | Phase 6 | OPEN |
| Q17 | Free-delivery threshold. Designs use ₹1,500 to suit kidswear baskets. | Phase 5 | OPEN |

---

## 8. Cash on delivery

COD is close to table stakes in Indian D2C and the reference site offers it.
Buying in depth makes it a far easier yes than it would have been: a refused
COD order on a restockable style is ordinary reverse logistics — the item goes
back into stock alongside its siblings and nothing else is affected.

Two things still worth pricing in:

- Refusal rates in this segment run roughly 20–40%, so COD orders are worth
  materially less per order than prepaid ones. The reference already answers
  this with a 5% prepaid discount, which is the cheapest available lever.
- Whatever thin, one-off stock remains is still exposed: a COD round trip on
  the last of something takes it out of circulation for a week. If depth is
  uneven across the catalogue, COD can be enabled per product rather than
  globally.

**Recommendation:** offer COD, keep the 5% prepaid incentive, and gate it per
product so genuinely scarce stock can be prepaid-only.

---

## 9. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Overselling stock shared with the counter | Refunds, bad reviews, chargebacks | Reservation model (§2); paid-beats-unpaid rule; auto-refund path |
| `topUpShortfall` reached from the web path | Phantom stock, orders that can never ship | Explicit guard + a regression test that fails if the guard is removed |
| Photography never happens | The site launches empty and stays empty | Tracked workstream with a named owner. Depth buying cuts the volume sharply (§6) |
| 1 GB box under crawler + shopper load | Site down, POS down *with it* | Images off-box; separate service; migration budget agreed in advance |
| Size-exchange volume underestimated | Support load and reverse-shipping cost swamp a launch built without a size-exchange flow | Decide Q16 before Phase 6; the `Return` / `exchange-policy` machinery already exists |
| Two frameworks to maintain | Slower iteration, context switching | Keep shared logic in `backend`/`shared`; the storefront stays a thin view layer |
| One repo = one blast radius | A shop bug takes down the till | Shop code confined to its own module; POS paths untouched except where explicitly listed |
| Migration drift against a live production DB | Data loss on a running shop | Same discipline already used for payroll: reviewed SQL in `deploy/sql/` |
| COD refusals | Order value materially below prepaid; thin stock tied up in transit | 5% prepaid incentive; per-product COD gate for scarce lines (§8) |

---

## 10. Changelog

| Date | Entry |
|---|---|
| 2026-08-30 | Catalogue confirmed as **kids ethnic wear**, sizes 12–36 age-mapped (D6, §2a). Storefront redrawn: age travels with every size, shop-by-age added as a browse axis, size guide promoted to its own page. Found `Size` has no age field and the real grid is not seeded — both added to Phase 1. Size exchanges flagged as likely the main support flow, which may pull reverse logistics forward from Phase 9. |
| 2026-08-30 | Buying moves to depth — quantity per style will grow, so one-of-a-kind is dropped as a customer-facing idea. Scarcity messaging removed from the designs; the reservation engine stays, since the shop and the site still share one stock room. Photography (§6) and COD (§8) both get substantially cheaper as a result. |
| 2026-08-30 | Visual direction set from the houseofiqf.com reference (D5). Reference audited: stock Shopify Dawn 15.3.0, `Assistant` type, square corners — the look is the standard D2C register, not a bespoke design. Storefront screens redrawn to match. COD raised as a first-class decision (§8, Q10) because it collides with single-piece stock. |
| 2026-08-30 | Document created. D1–D4 decided. Schema audited; `SaleChannel.online`, `clientRef` idempotency and `BillSequence` online-prefix support found already present. `topUpShortfall` identified as the primary hazard. Zero image fields confirmed. |
