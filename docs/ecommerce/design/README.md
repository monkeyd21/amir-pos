# Storefront design canvas — source files

`*.dc.html` and `canvas.json` are the editable source. The published canvas is
seeded from them, so **edit these, not the generated file**.

Published: https://claude.ai/code/artifact/5c838a67-2ad5-4530-a562-8c8750c6941a

| File | Artboard |
|---|---|
| `Main.dc.html` | Direction A — Atelier (gallery / editorial) |
| `Bazaar.dc.html` | Direction B — Bazaar (jewel-toned / textile-forward) |
| `Register.dc.html` | Direction C — Register (archival / utilitarian) |
| `canvas.json` | Artboard layout and the review notes on the canvas |

`sabihas-ethnic-storefront-directions.html` is a ~2 MB generated bundle and is
git-ignored; it is regenerated on every publish.

Each artboard is the same product detail page, so the directions differ only in
voice. Once one is chosen, the remaining screens (home, listing, cart,
checkout, order confirmation, mobile) get built in that direction.
