-- §2.3 Owner Discretion Discount — per-line discretionary discount (₹),
-- authorised by the Owner PIN at checkout, stored distinctly from `discount`.
ALTER TABLE "sale_items" ADD COLUMN "ownerDiscretionDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0;
