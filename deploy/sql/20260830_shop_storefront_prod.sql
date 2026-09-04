-- Storefront (shop module) — production schema change.
--
-- HISTORICAL. This script has already been applied to production and is kept as
-- the record of how that release reached the box. It is not the current process:
-- prod's migration history was repaired on 2026-09-04 and `prisma migrate deploy`
-- is the normal path again. See docs/deploy-notes.md.
--
-- At the time this ran it had to be applied by hand, before ./deploy/push.sh,
-- because `prisma migrate deploy` did not work on this box: the migration
-- history had diverged and migrate aborted on the first already-existing table.
-- It was run as:
--
--   sudo -u postgres psql -d amir_pos -v ON_ERROR_STOP=1 \
--     -f 20260830_shop_storefront_prod.sql
--
-- Everything here is ADDITIVE and IDEMPOTENT: new tables, new nullable or
-- defaulted columns, no type or nullability change to anything that exists. The
-- POS keeps running against this database throughout. Safe to re-run.
--
-- Take a dump first regardless:
--   sudo -u postgres pg_dump amir_pos | gzip > /root/amir_pos-pre-shop.sql.gz

BEGIN;

-- ─── Enums ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ReservationStatus" AS ENUM ('held','consumed','released','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ShopOrderStatus" AS ENUM
    ('pending_payment','paid','packed','shipped','delivered','cancelled','refunded','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ShopPaymentMode" AS ENUM ('prepaid','cod');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ShipmentStatus" AS ENUM
    ('pending','in_transit','out_for_delivery','delivered','returned','lost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Sizing ──────────────────────────────────────────────────────────────
-- Kidswear sizes are numbers that mean nothing to a shopper on their own, so
-- the age travels with the size. The barcode label still prints only `name`.
ALTER TABLE "sizes"
  ADD COLUMN IF NOT EXISTS "ageLabel"      TEXT,
  ADD COLUMN IF NOT EXISTS "chestInches"   DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS "lengthInches"  DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS "ageFromMonths" INTEGER,
  ADD COLUMN IF NOT EXISTS "ageToMonths"   INTEGER;

-- ─── Products gain a storefront face ─────────────────────────────────────
-- `onlineVisible` defaults FALSE on purpose: nothing appears on the website
-- until someone deliberately lists it. The counter catalogue is not the web
-- catalogue.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "onlineVisible"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "onlineDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "metaTitle"         TEXT,
  ADD COLUMN IF NOT EXISTS "metaDescription"   TEXT,
  ADD COLUMN IF NOT EXISTS "codBlocked"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "audience"          TEXT;

ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "onlineSellable" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "offers"
  ADD COLUMN IF NOT EXISTS "onlineEligible" BOOLEAN NOT NULL DEFAULT true;

-- ─── New tables ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "product_images" (
  "id"        SERIAL       PRIMARY KEY,
  "productId" INTEGER      NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "variantId" INTEGER      REFERENCES "product_variants"("id") ON DELETE SET NULL,
  "url"       TEXT         NOT NULL,
  "alt"       TEXT,
  "width"     INTEGER,
  "height"    INTEGER,
  "sortOrder" INTEGER      NOT NULL DEFAULT 0,
  "isPrimary" BOOLEAN      NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "product_images_productId_sortOrder_idx"
  ON "product_images"("productId","sortOrder");

CREATE TABLE IF NOT EXISTS "customer_otps" (
  "id"         SERIAL       PRIMARY KEY,
  "phone"      TEXT         NOT NULL,
  "codeHash"   TEXT         NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "attempts"   INTEGER      NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "customer_otps_phone_createdAt_idx"
  ON "customer_otps"("phone","createdAt");

CREATE TABLE IF NOT EXISTS "customer_sessions" (
  "id"               SERIAL       PRIMARY KEY,
  "customerId"       INTEGER      NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "refreshTokenHash" TEXT         NOT NULL,
  "userAgent"        TEXT,
  "ipAddress"        TEXT,
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  "revokedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_sessions_refreshTokenHash_key"
  ON "customer_sessions"("refreshTokenHash");
CREATE INDEX IF NOT EXISTS "customer_sessions_customerId_idx"
  ON "customer_sessions"("customerId");

CREATE TABLE IF NOT EXISTS "addresses" (
  "id"         SERIAL       PRIMARY KEY,
  "customerId" INTEGER      NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "name"       TEXT         NOT NULL,
  "phone"      TEXT         NOT NULL,
  "line1"      TEXT         NOT NULL,
  "line2"      TEXT,
  "landmark"   TEXT,
  "city"       TEXT         NOT NULL,
  "state"      TEXT         NOT NULL,
  "pincode"    VARCHAR(6)   NOT NULL,
  "isDefault"  BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "addresses_customerId_idx" ON "addresses"("customerId");

CREATE TABLE IF NOT EXISTS "shop_carts" (
  "id"         SERIAL       PRIMARY KEY,
  "token"      TEXT         NOT NULL,
  "customerId" INTEGER      REFERENCES "customers"("id") ON DELETE SET NULL,
  "branchId"   INTEGER      NOT NULL REFERENCES "branches"("id"),
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "shop_carts_token_key" ON "shop_carts"("token");
CREATE INDEX IF NOT EXISTS "shop_carts_customerId_idx" ON "shop_carts"("customerId");

CREATE TABLE IF NOT EXISTS "shop_orders" (
  "id"                    SERIAL            PRIMARY KEY,
  "orderNumber"           TEXT              NOT NULL,
  "customerId"            INTEGER           NOT NULL REFERENCES "customers"("id"),
  "branchId"              INTEGER           NOT NULL REFERENCES "branches"("id"),
  "saleId"                INTEGER           REFERENCES "sales"("id") ON DELETE SET NULL,
  "status"                "ShopOrderStatus" NOT NULL DEFAULT 'pending_payment',
  "paymentMode"           "ShopPaymentMode" NOT NULL DEFAULT 'prepaid',
  "shipName"              TEXT              NOT NULL,
  "shipPhone"             TEXT              NOT NULL,
  "shipLine1"             TEXT              NOT NULL,
  "shipLine2"             TEXT,
  "shipLandmark"          TEXT,
  "shipCity"              TEXT              NOT NULL,
  "shipState"             TEXT              NOT NULL,
  "shipPincode"           VARCHAR(6)        NOT NULL,
  "subtotal"              DECIMAL(10,2)     NOT NULL,
  "discountAmount"        DECIMAL(10,2)     NOT NULL DEFAULT 0,
  "loyaltyDiscountAmount" DECIMAL(10,2)     NOT NULL DEFAULT 0,
  "prepaidDiscountAmount" DECIMAL(10,2)     NOT NULL DEFAULT 0,
  "shippingAmount"        DECIMAL(10,2)     NOT NULL DEFAULT 0,
  "codFeeAmount"          DECIMAL(10,2)     NOT NULL DEFAULT 0,
  "taxAmount"             DECIMAL(10,2)     NOT NULL DEFAULT 0,
  "total"                 DECIMAL(10,2)     NOT NULL,
  "loyaltyPointsRedeemed" INTEGER           NOT NULL DEFAULT 0,
  "clientRef"             TEXT,
  "paymentIntentId"       TEXT,
  "paymentProviderRef"    TEXT,
  "paymentQrUrl"          TEXT,
  "paymentUpiLink"        TEXT,
  "paymentExpiresAt"      TIMESTAMP(3),
  "cancelReason"          TEXT,
  "notes"                 TEXT,
  "placedAt"              TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt"                TIMESTAMP(3),
  "cancelledAt"           TIMESTAMP(3),
  "updatedAt"             TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "shop_orders_orderNumber_key" ON "shop_orders"("orderNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "shop_orders_saleId_key"      ON "shop_orders"("saleId");
CREATE UNIQUE INDEX IF NOT EXISTS "shop_orders_clientRef_key"   ON "shop_orders"("clientRef");
CREATE INDEX IF NOT EXISTS "shop_orders_customerId_placedAt_idx" ON "shop_orders"("customerId","placedAt");
CREATE INDEX IF NOT EXISTS "shop_orders_status_idx"              ON "shop_orders"("status");

CREATE TABLE IF NOT EXISTS "shop_order_items" (
  "id"          SERIAL        PRIMARY KEY,
  "orderId"     INTEGER       NOT NULL REFERENCES "shop_orders"("id") ON DELETE CASCADE,
  "variantId"   INTEGER       NOT NULL REFERENCES "product_variants"("id"),
  "quantity"    INTEGER       NOT NULL,
  "unitPrice"   DECIMAL(10,2) NOT NULL,
  "mrp"         DECIMAL(10,2),
  "discount"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "taxAmount"   DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total"       DECIMAL(10,2) NOT NULL,
  "offerId"     INTEGER,
  "productName" TEXT          NOT NULL,
  "sizeName"    TEXT          NOT NULL,
  "colorName"   TEXT
);
CREATE INDEX IF NOT EXISTS "shop_order_items_orderId_idx" ON "shop_order_items"("orderId");

-- The core of the shared-stock design. Availability is always
-- inventory.quantity minus live holds — never the raw quantity.
CREATE TABLE IF NOT EXISTS "stock_reservations" (
  "id"        SERIAL              PRIMARY KEY,
  "variantId" INTEGER             NOT NULL REFERENCES "product_variants"("id"),
  "branchId"  INTEGER             NOT NULL REFERENCES "branches"("id"),
  "quantity"  INTEGER             NOT NULL,
  "status"    "ReservationStatus" NOT NULL DEFAULT 'held',
  "expiresAt" TIMESTAMP(3)        NOT NULL,
  "cartId"    INTEGER             REFERENCES "shop_carts"("id") ON DELETE SET NULL,
  "orderId"   INTEGER             REFERENCES "shop_orders"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- The hot path: availability for a variant at a branch.
CREATE INDEX IF NOT EXISTS "stock_reservations_variantId_branchId_status_expiresAt_idx"
  ON "stock_reservations"("variantId","branchId","status","expiresAt");
CREATE INDEX IF NOT EXISTS "stock_reservations_cartId_idx"  ON "stock_reservations"("cartId");
CREATE INDEX IF NOT EXISTS "stock_reservations_orderId_idx" ON "stock_reservations"("orderId");

CREATE TABLE IF NOT EXISTS "shop_cart_items" (
  "id"            SERIAL       PRIMARY KEY,
  "cartId"        INTEGER      NOT NULL REFERENCES "shop_carts"("id") ON DELETE CASCADE,
  "variantId"     INTEGER      NOT NULL REFERENCES "product_variants"("id"),
  "quantity"      INTEGER      NOT NULL,
  "reservationId" INTEGER      REFERENCES "stock_reservations"("id") ON DELETE SET NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "shop_cart_items_reservationId_key"    ON "shop_cart_items"("reservationId");
CREATE UNIQUE INDEX IF NOT EXISTS "shop_cart_items_cartId_variantId_key" ON "shop_cart_items"("cartId","variantId");
CREATE INDEX        IF NOT EXISTS "shop_cart_items_cartId_idx"           ON "shop_cart_items"("cartId");

CREATE TABLE IF NOT EXISTS "shipments" (
  "id"          SERIAL           PRIMARY KEY,
  "orderId"     INTEGER          NOT NULL REFERENCES "shop_orders"("id") ON DELETE CASCADE,
  "carrier"     TEXT,
  "awb"         TEXT,
  "trackingUrl" TEXT,
  "status"      "ShipmentStatus" NOT NULL DEFAULT 'pending',
  "shippedAt"   TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "shipments_orderId_idx" ON "shipments"("orderId");

-- ─── Sizing: reconciling two vocabularies ────────────────────────────────
--
-- This shop has been using TWO size vocabularies side by side, and until now
-- nothing joined them up:
--
--   * `sizes` (the ERP dropdown) holds only AGE forms — "4-5 Y", "6-9 M", "3Y".
--   * `product_variants.size` is free text, and 79% of live variants are plain
--     NUMBERS — 12, 14 … 36 — which have no row in `sizes` at all.
--
-- The shop's printed size chart is precisely the map between the two, so this
-- is where it gets encoded once, in the data, for both the ERP and the website.
--
-- Two jobs:
--   1. INSERT the numeric sizes, each carrying its age label. These are the
--      ones a parent cannot decode: "22" means nothing, "22 · 4 years" does.
--   2. Backfill the age RANGE (in months) onto every existing row, so
--      "shop by age" works across both vocabularies. These rows deliberately
--      get NO ageLabel — "6-9 M" already reads as an age; labelling it would
--      be noise.
--
-- CHEST follows the Indian kidswear convention that the size number is the
-- chest in inches. LENGTHS ARE ESTIMATES and must be replaced with the shop's
-- own measurements before the size guide is trusted — PLAN.md Q13.

-- 1. The numeric grid, with age labels. Idempotent on `name`.
INSERT INTO "sizes" ("name","sortOrder","isActive","ageLabel","chestInches","lengthInches","ageFromMonths","ageToMonths","createdAt")
VALUES
  ('12',1012,true,'6 months',   12,17,   6,  8, CURRENT_TIMESTAMP),
  ('14',1014,true,'9 months',   14,19,   9, 11, CURRENT_TIMESTAMP),
  ('16',1016,true,'1 year',     16,21,  12, 23, CURRENT_TIMESTAMP),
  ('18',1018,true,'2 years',    18,24,  24, 35, CURRENT_TIMESTAMP),
  ('20',1020,true,'3 years',    20,26,  36, 47, CURRENT_TIMESTAMP),
  ('22',1022,true,'4 years',    22,28,  48, 59, CURRENT_TIMESTAMP),
  ('24',1024,true,'5 years',    24,30,  60, 71, CURRENT_TIMESTAMP),
  ('26',1026,true,'6 years',    26,32,  72, 83, CURRENT_TIMESTAMP),
  ('28',1028,true,'7–8 years',  28,34,  84,107, CURRENT_TIMESTAMP),
  ('30',1030,true,'9–10 years', 30,37, 108,131, CURRENT_TIMESTAMP),
  ('32',1032,true,'11–12 years',32,40, 132,155, CURRENT_TIMESTAMP),
  ('34',1034,true,'13–14 years',34,43, 156,179, CURRENT_TIMESTAMP),
  ('36',1036,true,'15–16 years',36,45, 180,203, CURRENT_TIMESTAMP),
  -- Sizes the shop stocks that the printed chart does not reach. They get a
  -- chest but deliberately NO age label: inventing one would be worse than
  -- showing the bare number, which is what the tag says anyway.
  ('38',1038,true,NULL,38,47, NULL,NULL, CURRENT_TIMESTAMP),
  ('40',1040,true,NULL,40,49, NULL,NULL, CURRENT_TIMESTAMP),
  -- Live variants are typed "6-7Y"; the master had "6-7". Both now exist so
  -- either spelling resolves.
  ('6-7Y',1060,true,NULL,NULL,NULL, 72,95, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET
  "ageLabel"      = EXCLUDED."ageLabel",
  "chestInches"   = EXCLUDED."chestInches",
  "lengthInches"  = COALESCE("sizes"."lengthInches", EXCLUDED."lengthInches"),
  "ageFromMonths" = EXCLUDED."ageFromMonths",
  "ageToMonths"   = EXCLUDED."ageToMonths";

-- 2. Age ranges for the vocabulary the shop already had. No ageLabel: these
--    names ARE the age. "6-7" is missing its Y in the live data — kept exactly
--    as typed so the join still matches, and read as years.
UPDATE "sizes" s SET "ageFromMonths" = a.from_m, "ageToMonths" = a.to_m
FROM (VALUES
  ('1Y',12,23),   ('2Y',24,35),   ('3Y',36,47),   ('4Y',48,59),
  ('5Y',60,71),   ('6Y',72,83),   ('8Y',96,107),  ('10Y',120,131),
  ('12Y',144,155),('14Y',168,179),('16Y',192,203),
  ('0-3 M',0,3),  ('0-6 M',0,6),  ('3-6 M',3,6),  ('6-9 M',6,9),
  ('6-12 M',6,12),('9-12 M',9,12),('12-18 M',12,18),('18-24 M',18,24),
  ('24-30 M',24,30),('24-36 M',24,36),('30-36 M',30,36),
  ('1-2 Y',12,35),('2-3 Y',24,47),('3-4 Y',36,59),('4-5 Y',48,71),
  ('5-6 Y',60,83),('6-7',72,95),  ('7-8 Y',84,107),('8-9 Y',96,119),
  ('9-10 Y',108,131),('10-11 Y',120,143),('11-12 Y',132,155),
  ('12-13 Y',144,167),('13-14 Y',156,179),('14-15 Y',168,191),
  ('15-16 Y',180,203)
) AS a(name, from_m, to_m)
WHERE s."name" = a.name;

-- ─── Grants ──────────────────────────────────────────────────────────────
-- This script is run as `postgres` (the app role cannot create types), so every
-- new table and sequence is owned by postgres and the app role `amir` gets
-- nothing by default. Without this the API fails with
-- "permission denied for table product_images" the moment it reads the
-- catalogue. Derive the role from the existing tables rather than hardcoding
-- it, so this is correct on any environment.
DO $$
DECLARE app_role TEXT;
BEGIN
  SELECT tableowner INTO app_role FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'products';

  IF app_role IS NULL THEN
    RAISE NOTICE 'Could not determine the app role — grant by hand.';
    RETURN;
  END IF;

  EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA public TO %I', app_role);
  EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO %I', app_role);
  -- Ownership too, so future ALTERs by the app role work as they do elsewhere.
  EXECUTE format('ALTER TABLE product_images    OWNER TO %I', app_role);
  EXECUTE format('ALTER TABLE customer_otps     OWNER TO %I', app_role);
  EXECUTE format('ALTER TABLE customer_sessions OWNER TO %I', app_role);
  EXECUTE format('ALTER TABLE addresses         OWNER TO %I', app_role);
  EXECUTE format('ALTER TABLE shop_carts        OWNER TO %I', app_role);
  EXECUTE format('ALTER TABLE shop_cart_items   OWNER TO %I', app_role);
  EXECUTE format('ALTER TABLE shop_orders       OWNER TO %I', app_role);
  EXECUTE format('ALTER TABLE shop_order_items  OWNER TO %I', app_role);
  EXECUTE format('ALTER TABLE stock_reservations OWNER TO %I', app_role);
  EXECUTE format('ALTER TABLE shipments         OWNER TO %I', app_role);
  RAISE NOTICE 'Granted new shop tables to %', app_role;
END $$;

COMMIT;

-- ─── Verify ──────────────────────────────────────────────────────────────
-- Expect: 10 new tables, and age labels on the numeric sizes in use.
SELECT COUNT(*) AS new_tables FROM information_schema.tables
 WHERE table_name IN ('product_images','customer_otps','customer_sessions','addresses',
                      'shop_carts','shop_orders','shop_order_items','stock_reservations',
                      'shop_cart_items','shipments');
SELECT COUNT(*) FILTER (WHERE "ageLabel" IS NOT NULL)      AS numeric_sizes_labelled,
       COUNT(*) FILTER (WHERE "ageFromMonths" IS NOT NULL) AS sizes_with_age_range,
       COUNT(*)                                            AS total_sizes
  FROM "sizes";
