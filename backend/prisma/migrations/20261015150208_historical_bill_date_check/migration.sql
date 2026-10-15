-- Dashboard spec §12.4: an imported legacy bill must carry its original sale
-- date, and it cannot be before 01-01-2010. The importer refuses such bills
-- with a reason (scripts/import-stock-bills.js); this makes the database say
-- the same, so no other path can archive an undated bill. A date in the future
-- is refused by the importer only: a CHECK may not depend on the clock.
--
-- NOT VALID: enforced for every new or changed row, without re-checking rows
-- already archived. Existing data is left exactly as it is.
ALTER TABLE "historical_bills"
  ADD CONSTRAINT "historical_bills_bill_date_valid"
  CHECK ("billDate" IS NOT NULL AND "billDate" >= TIMESTAMP '2010-01-01')
  NOT VALID;
