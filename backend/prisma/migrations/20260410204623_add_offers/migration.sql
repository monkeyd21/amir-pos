-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('percentage', 'flat', 'buy_x_get_y_free', 'buy_x_get_y_percent', 'bundle');

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "effectiveUnitPrice" DECIMAL(10,2),
ADD COLUMN     "offerId" INTEGER;

-- CreateTable
CREATE TABLE "offers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "OfferType" NOT NULL,
    "percentValue" DECIMAL(5,2),
    "flatValue" DECIMAL(10,2),
    "buyQty" INTEGER,
    "getQty" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_products" (
    "offerId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_products_pkey" PRIMARY KEY ("offerId","productId")
);

-- CreateTable
CREATE TABLE "offer_variants" (
    "offerId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_variants_pkey" PRIMARY KEY ("offerId","variantId")
);

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_products" ADD CONSTRAINT "offer_products_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_products" ADD CONSTRAINT "offer_products_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_variants" ADD CONSTRAINT "offer_variants_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_variants" ADD CONSTRAINT "offer_variants_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
