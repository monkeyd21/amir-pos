# On-Priority Bugs

Yellow "On Priority" items pulled from the **BUGS** tab of the spec doc
([source](https://docs.google.com/document/d/1FgWFVSuNo5L44RKEhmOr-soAffrDLP9LAoFMw3N_OSg/edit?tab=t.aph4a2fujtm1)).
Synced 2026-07-30.

## Main bugs list
- [x] **#2** Create a restricted staff billing login limited to POS + Return/Exchange + Refund _(shipped — commit b778808)_
- [x] **#5** Update return history to include full item descriptions and pricing _(sale-detail returns now show name, size/color, SKU, unit price + per-line refund; refund receipt already itemised)_
- [x] **#6** Assign a single salesperson to an entire transaction _(POS whole-bill salesperson picker + sale-detail "Assign all to" bulk action)_
- [x] **#9** Fix manual barcode/SKU entry issues in the exchange interface _(Enter-to-add via exact barcode/SKU lookup; also fixed a variantId shape mismatch that broke add-from-search)_
- [x] **#11** Display barcode & SKU details prominently in the exchange window _(SKU + barcode shown on return rows, new-item rows and search results)_
- [x] **#13** Bill W0019 — show both exchanged and sold items on the bill receipt _(receipt HTML + PDF now list the returned/exchanged items under the sold items)_

## Clearance / second block
- [x] **#4** Clearance items should show Purchase price alongside MRP and clearance price _(Purchase column added; backend surfaces costOverride ?? costPrice)_
- [x] **#6** Unable to create New Employee _(verified: routed EmployeeFormComponent only requires firstName; backend Zod matches. The old employee-dialog is dead code.)_
- [x] **#8** Clearance receipt must show both original MRP and final clearance price _(new SaleItem.isClearance persisted at checkout; receipt prints "CLEARANCE (was <MRP>)" on clearance lines)_

---
_Note: the doc API export doesn't carry highlight colour, so items were matched on the "On Priority" text marker rather than the yellow fill directly._

## Deploy note
`#8` adds a DB column — migration `20260730000000_add_saleitem_isclearance`
(`ALTER TABLE "sale_items" ADD COLUMN "isClearance" BOOLEAN NOT NULL DEFAULT false`).
Prod (`/opt/amir-pos`, Contabo) is a file-copy deploy, so this ALTER must be run
manually against the `amir_pos` DB before/with the backend update.
