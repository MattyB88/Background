# Poster Forge — the $200/week printable wall-art playbook

`poster_forge.py` mass-produces unique, print-ready (300 DPI) poster art plus an
Etsy-ready listing manifest. The art is 100% generative — no stock images, no
copyrighted quotes, no licensed fonts — so it's clean to sell. This file is the
business side: how the generated files turn into roughly $200/week.

## Why this can work (and why it's low effort)
- **Make once, sell forever.** A printable digital download is the same file on
  every sale. No printing, packing, or shipping — the buyer prints it.
- **Inventory is the bottleneck, and this removes it.** Shops with 100+ tasteful
  listings get found; this script builds 100 designs in one command.
- **Two fulfillment routes, both hands-off:**
  - *Instant download* (Etsy "digital", or Gumroad): buyer gets the PNG. $0 cost.
  - *Print-on-demand* (Printify/Gelato connected to Etsy): they print + ship a
    physical poster, you keep the margin. Higher price, still zero touch.

## The money math
Pick the lane that matches your effort tolerance:

| Lane | Price | Sales needed/week for ~$200 | Notes |
|---|---|---|---|
| Instant download | $5 | ~40 | ~100% margin; volume game |
| Instant download bundle (set of 6) | $12 | ~17 | higher AOV, easy upsell |
| Print-on-demand 18×24" | ~$15 profit | ~13 | Printify prints & ships |

40 download sales/week across a 100+ listing shop is very achievable once a few
listings rank. The leverage: every listing is a 24/7 storefront you built in
seconds.

## Step-by-step (first week)
1. **Generate a catalog**
   ```bash
   python poster_forge.py --count 120 --print-ready
   ```
   Produces 120 sellable 6000×9000 px / 300 DPI PNGs + `posters/catalog.csv`
   (it covers all five styles in rotation). Heavy run — leave it going.
2. **Cull to your best ~40.** Delete the weak ones; quality > quantity for the
   shop's first impression. Re-roll any style with `--style dunes --seed 5000`.
3. **Open a shop.** Etsy (most traffic) or Gumroad (instant, no fees to start).
4. **List using the manifest.** `catalog.csv` already has a suggested title,
   8 SEO tags, and a price per file — paste them in. Tweak titles to taste.
5. **Make 1–2 mockups per listing.** Drop the PNG into a free framed-wall mockup
   (Canva, Placeit, or Photoshop) so buyers see it on a wall. This is the single
   biggest conversion lever.
6. **Bundle.** Also list "Set of 6" bundles at ~$12 — higher order value for the
   same work.

## Scaling past $200/week
- **More niches = more search surface.** Run each style as its own collection.
- **Seasonal drops.** Re-run near Q4/holidays with celestial + warm palettes.
- **Bundles + a "100-poster mega pack"** as a single high-ticket Gumroad product.
- **Connect Printify** to add physical prints on your best sellers (higher margin
  per sale, fewer sales needed).
- **Reinvest** ~$5–10/wk in Etsy ads on proven listings once organic sales start.

## Commands cheat-sheet
```bash
python poster_forge.py                       # 12 mixed previews (fast)
python poster_forge.py --count 120 --print-ready   # full sellable catalog
python poster_forge.py --style celestial --count 30
python poster_forge.py --width 24 --height 36 --dpi 300   # exact print size
python poster_forge.py --seed 9000 --count 40            # a fresh, different batch
```
Change `--seed` to get a completely different, reproducible set every time.

## Honest expectations & rules
- This is a **real but not instant** model — first sales typically take a few
  weeks of listings + decent mockups. The script removes the *production* grind,
  not the *marketing* one.
- **Stay original.** The output is generative and safe to sell. Don't add famous
  quotes, brand logos, or licensed characters — that's where printable shops get
  taken down.
- **Read each platform's TOS** on AI-assisted / generated art (Etsy currently
  allows it but requires you to disclose your process honestly).
