# 09 — Mechanical: slim build + charm ("jiblet") system

Two goals: (1) keep it **slim** so it's comfortable and discreet, and (2) add a
**charm attachment thread/bail** so users can personalize it with "jiblets" —
which also becomes a recurring revenue stream.

## 1. Why slim matters
For this community, "looks like a medical gadget" kills adoption. Thin +
charm-able = it reads as jewelry, not a device. The incumbent looks clinical;
this is your visual differentiator.

## 2. Z-height stack-up (the thickness budget)
Thickness is driven by the battery and the actuator, not the chips.

| Layer | Part | ~mm |
|---|---|---|
| Skin-side overmold wall | polyamide | 0.6 |
| LRA (slim Z-axis) **or** thin LiPo (they sit side-by-side, not stacked) | LRA1 / BT1 | 3.2–4.0 |
| PCB (4-layer) | core | 0.8 |
| Components above PCB (module 1.0, caps ≤0.9) | tallest | 1.0 |
| Top-side overmold wall | polyamide | 0.6 |
| **Core total (target)** | | **~6–7 mm** |

Key slimming moves:
- **Lay the battery and LRA beside each other**, both on the same side as the PCB
  cutout — don't stack them. This is the single biggest thickness win.
- Pick a **Z-axis (vertical) LRA ~3.2 mm** and a **~4 mm LiPo** (e.g. 503040) and
  match their heights so neither dominates.
- **Tag-Connect (TC2030) pads** instead of an SWD header = no connector body.
- **Pogo charge** instead of USB-C = no recessed port cavity, and it lets you
  fully seal the overmold.
- 0402 passives, 0.8 mm 4-layer board, components on one side where possible.

## 3. The charm / "jiblet" system
A small **attachment bail (BAIL1)** molded into the overmold at the **12 o'clock**
position (top of the core), plus **optional loops** integrated along the TPU band.

Two attachment modes — offer both, they suit different charms:
- **Clip-on (default):** the bail is a smooth **loop / lug** (think a watch lug or
  a small D-ring) sized for a standard **spring/jump ring or lobster clasp**. Any
  jewelry charm clips on. Zero tools. Most accessible.
- **Screw-on (premium):** an **M2.5 brass threaded insert** heat-set into a boss
  in the overmold, so machined/printed charms **screw on** flush and won't snag.
  More secure, a nicer "system" feel, harder to knock off in sleep.

Design notes:
- **Mold the bail/boss into the overmold step** (you're already overmolding — add
  the feature to the mold cavity). 3D-printed mold proto → aluminum once proven,
  exactly your stated tooling path.
- Keep the bail **away from the antenna keep-out** and **non-metallic at the
  antenna face**; a brass insert is fine at 12 o'clock if the module antenna is at
  6 o'clock (opposite end) — keep them apart.
- Round every edge; charms must not press into the wrist when worn tight.
- Band loops: small molded TPU loops every ~15 mm so users can thread additional
  jiblets around the band (bracelet aesthetic).

## 4. Charm "jiblets" as a product line (recurring revenue)
This is the scalable upsell — far higher margin and lower effort than the device.
- **Charm packs**: themed sets (calming/affirmation words, birthstone-style,
  minimalist shapes, "milestone" charms for streaks — e.g. a charm at 7/30/90
  pick-free days). Sell on the same Tindie/Shopify/Etsy listing.
- **Print-to-order** charms via SLA/MJF or your PnP-adjacent stack; near-zero
  inventory risk. Aluminum/anodized once a design proves out.
- **Functional charms** later: a charm that *is* the magnetic charger, or a
  fidget-style charm (community loves tactile fidgets as a picking substitute).
- **Open the spec**: publish the bail/thread dimensions so makers design charms —
  a tiny ecosystem that markets the device for you.
- Margin math: a $5–12 charm pack at ~80% margin, attach-rate even 1–2 packs per
  device, materially lifts revenue per customer on top of the band.

## 5. Materials / comfort
- Skin-contact: documented **hypoallergenic TPU or LSR silicone** band (keep the
  supplier datasheet for §`06_TEST_PLAN.md` biocompat).
- Overmold polyamide is skin-adjacent through the band — verify skin-safe grade.
- Sweat path: ensure the bail/boss interface is sealed (no capillary path into the
  electronics) — test in the IPX4 splash check.

## 6. What to prototype first
1. A **dummy slim core** (battery + LRA + blank PCB) at target thickness — prove
   6–7 mm is comfortable before committing the layout.
2. The **bail/boss in the 3D-printed mold** — pull a few shots, hang charms, tug
   test, sleep test (does it snag?).
3. One **charm pack** to photograph for the listing — the charm story sells the
   band.
