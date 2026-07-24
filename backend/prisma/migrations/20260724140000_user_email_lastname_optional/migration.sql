-- Email and last name are no longer mandatory for employees (many are just
-- salespeople tracked for commission and never log in).
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "lastName" DROP NOT NULL;
