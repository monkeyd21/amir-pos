-- §2.4 — persist whether a sale line was priced off the variant's clearance flag
-- so the receipt can show "was <MRP>" against the fixed clearance price even
-- after the variant later leaves clearance.
ALTER TABLE "sale_items" ADD COLUMN "isClearance" BOOLEAN NOT NULL DEFAULT false;
