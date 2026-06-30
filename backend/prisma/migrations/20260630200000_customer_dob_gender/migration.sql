-- §5.3 — customer DOB + gender for insights, suggestions, segmentation.
ALTER TABLE "customers" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "customers" ADD COLUMN "gender" TEXT;
