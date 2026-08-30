-- Storefront (shop module) — additive schema for the public e-commerce site.
--
-- Nothing here changes an existing column's type or nullability, so the POS and
-- ERP keep running against the same database throughout the build. Every new
-- column is defaulted or nullable; every new table is new.
--
-- Spec: docs/ecommerce/tech-spec.html   ·   Plan: docs/ecommerce/PLAN.md

-- ─── Enums ───────────────────────────────────────────────────────────────
CREATE TYPE "ReservationStatus" AS ENUM ('held', 'consumed', 'released', 'expired');
CREATE TYPE "ShopOrderStatus"   AS ENUM ('pending_payment', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded', 'failed');
CREATE TYPE "ShopPaymentMode"   AS ENUM ('prepaid', 'cod');
CREATE TYPE "ShipmentStatus"    AS ENUM ('pending', 'in_transit', 'out_for_delivery', 'delivered', 'returned', 'lost');

-- ─── Kidswear sizing ─────────────────────────────────────────────────────
-- Indian kidswear sizes are numbers (12–36) that mean nothing to a shopper on
-- their own — which is exactly why the shop hands out a printed size chart. The
-- age now travels with the size in the data, so every storefront surface can
-- render "22 · 4 years". The barcode label still prints only `name`.
ALTER TABLE "sizes"
  ADD COLUMN "ageLabel"      TEXT,
  ADD COLUMN "chestInches"   DECIMAL(5,1),
  ADD COLUMN "lengthInches"  DECIMAL(5,1),
  ADD COLUMN "ageFromMonths" INTEGER,
  ADD COLUMN "ageToMonths"   INTEGER;

-- ─── Products gain a storefront face ─────────────────────────────────────
-- Listing is opt-in per product: the counter catalogue is not the web catalogue.
ALTER TABLE "products"
  ADD COLUMN "onlineVisible"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "onlineDescription" TEXT,
  ADD COLUMN "metaTitle"         TEXT,
  ADD COLUMN "metaDescription"   TEXT,
  ADD COLUMN "codBlocked"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "audience"          TEXT;

-- Lets one size be held back for the shop floor without delisting the product.
ALTER TABLE "product_variants"
  ADD COLUMN "onlineSellable" BOOLEAN NOT NULL DEFAULT true;

-- Counter-only promotions must not leak onto the website.
ALTER TABLE "offers"
  ADD COLUMN "onlineEligible" BOOLEAN NOT NULL DEFAULT true;

-- ─── Product imagery ─────────────────────────────────────────────────────
-- The ERP had no image concept at all. `url` is an object-storage key (or a
-- relative /uploads path in local dev) — never a data URI.
CREATE TABLE "product_images" (
  "id"        SERIAL       NOT NULL,
  "productId" INTEGER      NOT NULL,
  "variantId" INTEGER,
  "url"       TEXT         NOT NULL,
  "alt"       TEXT,
  "width"     INTEGER,
  "height"    INTEGER,
  "sortOrder" INTEGER      NOT NULL DEFAULT 0,
  "isPrimary" BOOLEAN      NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_images_productId_sortOrder_idx" ON "product_images"("productId", "sortOrder");

-- ─── Customer identity ───────────────────────────────────────────────────
-- Shoppers never get a password. They sign in with a phone OTP over the
-- WhatsApp integration the ERP already runs, and a web signup is matched to an
-- existing customer by phone so the CRM record is never split in two.
CREATE TABLE "customer_otps" (
  "id"         SERIAL       NOT NULL,
  "phone"      TEXT         NOT NULL,
  "codeHash"   TEXT         NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "attempts"   INTEGER      NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_otps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "customer_otps_phone_createdAt_idx" ON "customer_otps"("phone", "createdAt");

CREATE TABLE "customer_sessions" (
  "id"               SERIAL       NOT NULL,
  "customerId"       INTEGER      NOT NULL,
  "refreshTokenHash" TEXT         NOT NULL,
  "userAgent"        TEXT,
  "ipAddress"        TEXT,
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  "revokedAt"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_sessions_refreshTokenHash_key" ON "customer_sessions"("refreshTokenHash");
CREATE INDEX "customer_sessions_customerId_idx" ON "customer_sessions"("customerId");

-- ─── Addresses ───────────────────────────────────────────────────────────
-- `customers.address` is one free-text line: fine for a counter record, useless
-- for despatch.
CREATE TABLE "addresses" (
  "id"         SERIAL       NOT NULL,
  "customerId" INTEGER      NOT NULL,
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
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "addresses_customerId_idx" ON "addresses"("customerId");

-- ─── Carts ───────────────────────────────────────────────────────────────
CREATE TABLE "shop_carts" (
  "id"         SERIAL       NOT NULL,
  "token"      TEXT         NOT NULL,
  "customerId" INTEGER,
  "branchId"   INTEGER      NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "shop_carts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shop_carts_token_key" ON "shop_carts"("token");
CREATE INDEX "shop_carts_customerId_idx" ON "shop_carts"("customerId");

-- ─── Orders ──────────────────────────────────────────────────────────────
-- A `Sale` means money taken, stock gone, GST recorded. An order that is placed
-- but unpaid is none of those, so `saleId` stays NULL until the order settles.
CREATE TABLE "shop_orders" (
  "id"                    SERIAL            NOT NULL,
  "orderNumber"           TEXT              NOT NULL,
  "customerId"            INTEGER           NOT NULL,
  "branchId"              INTEGER           NOT NULL,
  "saleId"                INTEGER,
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
  "updatedAt"             TIMESTAMP(3)      NOT NULL,
  CONSTRAINT "shop_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shop_orders_orderNumber_key" ON "shop_orders"("orderNumber");
CREATE UNIQUE INDEX "shop_orders_saleId_key"      ON "shop_orders"("saleId");
CREATE UNIQUE INDEX "shop_orders_clientRef_key"   ON "shop_orders"("clientRef");
CREATE INDEX "shop_orders_customerId_placedAt_idx" ON "shop_orders"("customerId", "placedAt");
CREATE INDEX "shop_orders_status_idx"              ON "shop_orders"("status");

CREATE TABLE "shop_order_items" (
  "id"          SERIAL        NOT NULL,
  "orderId"     INTEGER       NOT NULL,
  "variantId"   INTEGER       NOT NULL,
  "quantity"    INTEGER       NOT NULL,
  "unitPrice"   DECIMAL(10,2) NOT NULL,
  "mrp"         DECIMAL(10,2),
  "discount"    DECIMAL(10,2) NOT NULL DEFAULT 0,
  "taxAmount"   DECIMAL(10,2) NOT NULL DEFAULT 0,
  "total"       DECIMAL(10,2) NOT NULL,
  "offerId"     INTEGER,
  "productName" TEXT          NOT NULL,
  "sizeName"    TEXT          NOT NULL,
  "colorName"   TEXT,
  CONSTRAINT "shop_order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shop_order_items_orderId_idx" ON "shop_order_items"("orderId");

-- ─── Reservations ────────────────────────────────────────────────────────
-- Availability is ALWAYS inventory.quantity − SUM(active reservations).
-- "Active" = status 'held' AND "expiresAt" > now(), so an expired hold stops
-- blocking a sale the instant it lapses; the sweeper is housekeeping, not
-- correctness.
CREATE TABLE "stock_reservations" (
  "id"        SERIAL              NOT NULL,
  "variantId" INTEGER             NOT NULL,
  "branchId"  INTEGER             NOT NULL,
  "quantity"  INTEGER             NOT NULL,
  "status"    "ReservationStatus" NOT NULL DEFAULT 'held',
  "expiresAt" TIMESTAMP(3)        NOT NULL,
  "cartId"    INTEGER,
  "orderId"   INTEGER,
  "createdAt" TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)        NOT NULL,
  CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);
-- The hot path: availability for a variant at a branch.
CREATE INDEX "stock_reservations_variantId_branchId_status_expiresAt_idx"
  ON "stock_reservations"("variantId", "branchId", "status", "expiresAt");
CREATE INDEX "stock_reservations_cartId_idx"  ON "stock_reservations"("cartId");
CREATE INDEX "stock_reservations_orderId_idx" ON "stock_reservations"("orderId");

CREATE TABLE "shop_cart_items" (
  "id"            SERIAL       NOT NULL,
  "cartId"        INTEGER      NOT NULL,
  "variantId"     INTEGER      NOT NULL,
  "quantity"      INTEGER      NOT NULL,
  "reservationId" INTEGER,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shop_cart_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shop_cart_items_reservationId_key"   ON "shop_cart_items"("reservationId");
CREATE UNIQUE INDEX "shop_cart_items_cartId_variantId_key" ON "shop_cart_items"("cartId", "variantId");
CREATE INDEX "shop_cart_items_cartId_idx"                  ON "shop_cart_items"("cartId");

-- ─── Shipments ───────────────────────────────────────────────────────────
CREATE TABLE "shipments" (
  "id"          SERIAL           NOT NULL,
  "orderId"     INTEGER          NOT NULL,
  "carrier"     TEXT,
  "awb"         TEXT,
  "trackingUrl" TEXT,
  "status"      "ShipmentStatus" NOT NULL DEFAULT 'pending',
  "shippedAt"   TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "shipments_orderId_idx" ON "shipments"("orderId");

-- ─── Foreign keys ────────────────────────────────────────────────────────
ALTER TABLE "product_images"    ADD CONSTRAINT "product_images_productId_fkey"    FOREIGN KEY ("productId") REFERENCES "products"("id")          ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "product_images"    ADD CONSTRAINT "product_images_variantId_fkey"    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id")  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id")       ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "addresses"         ADD CONSTRAINT "addresses_customerId_fkey"        FOREIGN KEY ("customerId") REFERENCES "customers"("id")        ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "shop_carts"        ADD CONSTRAINT "shop_carts_customerId_fkey"       FOREIGN KEY ("customerId") REFERENCES "customers"("id")        ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shop_carts"        ADD CONSTRAINT "shop_carts_branchId_fkey"         FOREIGN KEY ("branchId")   REFERENCES "branches"("id")         ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_orders"       ADD CONSTRAINT "shop_orders_customerId_fkey"      FOREIGN KEY ("customerId") REFERENCES "customers"("id")        ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_orders"       ADD CONSTRAINT "shop_orders_branchId_fkey"        FOREIGN KEY ("branchId")   REFERENCES "branches"("id")         ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_orders"       ADD CONSTRAINT "shop_orders_saleId_fkey"          FOREIGN KEY ("saleId")     REFERENCES "sales"("id")            ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shop_order_items"  ADD CONSTRAINT "shop_order_items_orderId_fkey"    FOREIGN KEY ("orderId")    REFERENCES "shop_orders"("id")      ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "shop_order_items"  ADD CONSTRAINT "shop_order_items_variantId_fkey"  FOREIGN KEY ("variantId")  REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_branchId_fkey"  FOREIGN KEY ("branchId")  REFERENCES "branches"("id")         ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_cartId_fkey"    FOREIGN KEY ("cartId")    REFERENCES "shop_carts"("id")       ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_orderId_fkey"   FOREIGN KEY ("orderId")   REFERENCES "shop_orders"("id")      ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shop_cart_items"   ADD CONSTRAINT "shop_cart_items_cartId_fkey"        FOREIGN KEY ("cartId")    REFERENCES "shop_carts"("id")       ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "shop_cart_items"   ADD CONSTRAINT "shop_cart_items_variantId_fkey"     FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_cart_items"   ADD CONSTRAINT "shop_cart_items_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "stock_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "shipments"         ADD CONSTRAINT "shipments_orderId_fkey"             FOREIGN KEY ("orderId")   REFERENCES "shop_orders"("id")      ON DELETE CASCADE  ON UPDATE CASCADE;

-- ─── Seed the real kidswear size grid ────────────────────────────────────
-- Ages come from the shop's printed chart. Chest follows the Indian kidswear
-- convention that the size number is the chest in inches. LENGTHS ARE
-- PLACEHOLDERS and must be replaced with the shop's own measurements before
-- launch — see PLAN.md Q13. `sizes.name` is unique, so this is idempotent.
INSERT INTO "sizes" ("name", "sortOrder", "isActive", "ageLabel", "chestInches", "lengthInches", "ageFromMonths", "ageToMonths", "createdAt") VALUES
  ('12',  10, true, '6 months',    12, 17,   6,   8, CURRENT_TIMESTAMP),
  ('14',  20, true, '9 months',    14, 19,   9,  11, CURRENT_TIMESTAMP),
  ('16',  30, true, '1 year',      16, 21,  12,  23, CURRENT_TIMESTAMP),
  ('18',  40, true, '2 years',     18, 24,  24,  35, CURRENT_TIMESTAMP),
  ('20',  50, true, '3 years',     20, 26,  36,  47, CURRENT_TIMESTAMP),
  ('22',  60, true, '4 years',     22, 28,  48,  59, CURRENT_TIMESTAMP),
  ('24',  70, true, '5 years',     24, 30,  60,  71, CURRENT_TIMESTAMP),
  ('26',  80, true, '6 years',     26, 32,  72,  83, CURRENT_TIMESTAMP),
  ('28',  90, true, '7–8 years',   28, 34,  84, 107, CURRENT_TIMESTAMP),
  ('30', 100, true, '9–10 years',  30, 37, 108, 131, CURRENT_TIMESTAMP),
  ('32', 110, true, '11–12 years', 32, 40, 132, 155, CURRENT_TIMESTAMP),
  ('34', 120, true, '13–14 years', 34, 43, 156, 179, CURRENT_TIMESTAMP),
  ('36', 130, true, '15–16 years', 36, 45, 180, 203, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO UPDATE SET
  "ageLabel"      = EXCLUDED."ageLabel",
  "chestInches"   = EXCLUDED."chestInches",
  "lengthInches"  = EXCLUDED."lengthInches",
  "ageFromMonths" = EXCLUDED."ageFromMonths",
  "ageToMonths"   = EXCLUDED."ageToMonths",
  "sortOrder"     = EXCLUDED."sortOrder";
