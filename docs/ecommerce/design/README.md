# Storefront design canvas — source files

`*.dc.html` and `canvas.json` are the editable source. The published canvas is
seeded from them, so **edit these, not the generated file**.

Published: https://claude.ai/code/artifact/5c838a67-2ad5-4530-a562-8c8750c6941a

## Page 1 — Direction D (current)

Kids ethnic wear in the conventional Indian D2C register matched to the
houseofiqf.com reference. Sizes 12–36, age-paired everywhere.

| File | Artboard |
|---|---|
| `HighStreet.dc.html` | Home / new arrivals, with shop-by-age |
| `HighStreetProduct.dc.html` | Product detail, size chips carry the age |
| `SizeGuide.dc.html` | Size guide page (age → size → measurements) |
| `HighStreetMobile.dc.html` | Mobile product detail (390px) |

**Note:** the chest and length figures in `SizeGuide.dc.html` are estimates and
must be replaced with the shop's real measurements before launch (PLAN.md Q13).

## Page 2 — Earlier directions

Superseded by D, kept for comparison.

| File | Artboard |
|---|---|
| `Main.dc.html` | A — Atelier (gallery / editorial) |
| `Bazaar.dc.html` | B — Bazaar (jewel-toned / textile-forward) |
| `Register.dc.html` | C — Register (archival / utilitarian) |

## Notes

`canvas.json` holds the artboard layout, the two pages, and the review notes
that sit on the canvas.

`sabihas-ethnic-storefront-directions.html` is a ~2 MB generated bundle and is
git-ignored; it is regenerated on every publish.

Still to draw once the direction is signed off: category listing with age/size
filters, cart with expiring holds, checkout with phone-OTP, order confirmation.
