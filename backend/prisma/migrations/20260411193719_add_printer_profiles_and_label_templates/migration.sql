-- CreateTable
CREATE TABLE "printer_profiles" (
    "id" SERIAL NOT NULL,
    "branchId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL DEFAULT 'generic',
    "model" TEXT,
    "driver" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "connection" JSONB NOT NULL DEFAULT '{}',
    "dpi" INTEGER NOT NULL DEFAULT 203,
    "maxWidthMm" DOUBLE PRECISION NOT NULL DEFAULT 108,
    "capabilities" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "label_templates" (
    "id" SERIAL NOT NULL,
    "printerProfileId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "widthMm" DOUBLE PRECISION NOT NULL,
    "heightMm" DOUBLE PRECISION NOT NULL,
    "gapMm" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "density" INTEGER NOT NULL DEFAULT 8,
    "speed" INTEGER NOT NULL DEFAULT 4,
    "elements" JSONB NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "label_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "printer_profiles_branchId_idx" ON "printer_profiles"("branchId");

-- CreateIndex
CREATE INDEX "label_templates_printerProfileId_idx" ON "label_templates"("printerProfileId");

-- AddForeignKey
ALTER TABLE "printer_profiles" ADD CONSTRAINT "printer_profiles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_printerProfileId_fkey" FOREIGN KEY ("printerProfileId") REFERENCES "printer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Backfill: one default TSPL printer per branch ──────────────────────
-- Every existing branch gets a profile pointing at /dev/usb/lp0 (matches the
-- prior hard-coded behavior). Support techs can update the transport + address
-- from the Settings → Printers UI after deploy.
INSERT INTO "printer_profiles" (
    "branchId", "name", "vendor", "model", "driver", "transport",
    "connection", "dpi", "maxWidthMm", "capabilities", "isDefault", "isActive", "updatedAt"
)
SELECT
    b."id",
    'Default Printer',
    'generic',
    NULL,
    'tspl',
    'usb-lp',
    '{"devicePath":"/dev/usb/lp0"}'::jsonb,
    203,
    108,
    '{"supportedBarcodes":["code128","ean13","code39","qr"]}'::jsonb,
    true,
    true,
    CURRENT_TIMESTAMP
FROM "branches" b;

-- ─── Backfill: port the global labelTemplate Setting → LabelTemplate ────
-- The old `Setting` row stored an IR using dots @ 203 DPI with TSPL fonts.
-- We convert:
--   xMm = round((x_dots / 8) * 100) / 100     (8 dots/mm @ 203 DPI)
--   yMm = round((y_dots / 8) * 100) / 100
--   fontSizePt = { 1:8, 2:12, 3:14, 4:18, 5:24 }[font]
--   barcodeHeightMm = round((barcodeHeight_dots / 8) * 100) / 100
-- Elements that used xScale/yScale lose those multipliers — drivers map fontSize
-- directly now. If a customer had a heavily scaled template, they can nudge in
-- the designer after migration.
--
-- If no global template exists, we skip and the default template seeds later
-- from application code (ir/defaults.ts).
DO $$
DECLARE
    old_template jsonb;
    converted_elements jsonb;
    branch_id int;
    new_profile_id int;
    el jsonb;
BEGIN
    SELECT value INTO old_template FROM "settings" WHERE key = 'labelTemplate';

    IF old_template IS NULL THEN
        RETURN;
    END IF;

    -- Build converted elements array
    converted_elements := '[]'::jsonb;
    FOR el IN SELECT * FROM jsonb_array_elements(COALESCE(old_template->'elements', '[]'::jsonb))
    LOOP
        converted_elements := converted_elements || jsonb_build_array(jsonb_build_object(
            'id', el->>'id',
            'type', el->>'type',
            'xMm', ROUND(((COALESCE((el->>'x')::numeric, 0)) / 8.0)::numeric, 2),
            'yMm', ROUND(((COALESCE((el->>'y')::numeric, 0)) / 8.0)::numeric, 2),
            'visible', COALESCE((el->>'visible')::boolean, true),
            'fontSizePt', CASE COALESCE((el->>'font')::int, 3)
                WHEN 1 THEN 8
                WHEN 2 THEN 12
                WHEN 3 THEN 14
                WHEN 4 THEN 18
                WHEN 5 THEN 24
                ELSE 14
            END,
            'align', COALESCE(el->>'align', 'left'),
            'widthMm', CASE
                WHEN el ? 'width' THEN ROUND(((el->>'width')::numeric / 8.0)::numeric, 2)
                ELSE NULL
            END,
            'content', el->>'content',
            'barcodeType', CASE WHEN el->>'type' = 'barcode' THEN 'code128' ELSE NULL END,
            'barcodeHeightMm', CASE
                WHEN el ? 'barcodeHeight' THEN ROUND(((el->>'barcodeHeight')::numeric / 8.0)::numeric, 2)
                ELSE NULL
            END,
            'showBarcodeText', COALESCE((el->>'showBarcodeText')::boolean, true),
            'weight', CASE WHEN COALESCE((el->>'bold')::boolean, false) THEN 'bold' ELSE 'normal' END,
            'underline', COALESCE((el->>'underline')::boolean, false)
        ));
    END LOOP;

    -- Attach one template copy per branch's default profile
    FOR branch_id IN SELECT "id" FROM "branches" LOOP
        SELECT "id" INTO new_profile_id
        FROM "printer_profiles"
        WHERE "branchId" = branch_id AND "isDefault" = true
        LIMIT 1;

        IF new_profile_id IS NOT NULL THEN
            INSERT INTO "label_templates" (
                "printerProfileId", "name", "widthMm", "heightMm", "gapMm",
                "density", "speed", "elements", "isDefault", "updatedAt"
            ) VALUES (
                new_profile_id,
                'Migrated Template',
                COALESCE((old_template->>'widthMm')::numeric, 50),
                COALESCE((old_template->>'heightMm')::numeric, 75),
                COALESCE((old_template->>'gapMm')::numeric, 2),
                COALESCE((old_template->>'density')::int, 8),
                COALESCE((old_template->>'speed')::int, 4),
                converted_elements,
                true,
                CURRENT_TIMESTAMP
            );
        END IF;
    END LOOP;
END $$;
