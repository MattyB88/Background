"""Poster Forge — a batch generator for print-on-demand wall art.

Why this exists
---------------
Selling printable wall art is one of the lowest-effort, most scalable digital
side hustles: you generate the artwork once, upload it to a print-on-demand
shop (Etsy + Printify/Gelato, or Gumroad for instant-download files), and the
same file sells over and over with zero per-sale work. The hard part is making
*enough* designs that look good and cover popular niches. This script does
exactly that — it produces unique, royalty-clean, 300 DPI poster files plus a
listing manifest (titles, tags, suggested price) you can paste straight into a
shop.

Every design is generated from a numeric seed, so output is 100% reproducible
and each piece is unique. Nothing here uses external images, fonts you don't
own, or copyrighted quotes — the art is fully generative, so it's safe to sell.

Five built-in styles, each targeting a proven Etsy niche:
  - arches    : boho / mid-century concentric arch art
  - dunes     : layered sunset hills (huge "minimalist nature" niche)
  - bauhaus   : geometric primary-shape art
  - celestial : moon-phase / starfield art (top-selling dark wall art)
  - grid      : abstract mid-century shape grid

Usage
-----
    python poster_forge.py                 # 12 mixed posters at preview res
    python poster_forge.py --count 50      # build a 50-piece catalog
    python poster_forge.py --print-ready   # 6000x9000 px, 300 DPI files to sell
    python poster_forge.py --style dunes --count 20
    python poster_forge.py --width 24 --height 36 --dpi 300   # exact print size

Output lands in ./posters/ with a catalog.csv manifest.

Only dependency: Pillow  (pip install Pillow)
"""
from __future__ import annotations

import argparse
import colorsys
import csv
import math
import random
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# --------------------------------------------------------------------------- #
# Palettes — hand-picked, "Etsy-friendly" combinations (background, ink list).
# Each palette is (name, background_hex, [accent_hex, ...]).
# --------------------------------------------------------------------------- #
PALETTES = [
    ("terracotta", "#efe7dc", ["#c4623d", "#d99873", "#824b35", "#e9c4a0"]),
    ("sage",       "#eef0e9", ["#7d8c6f", "#aebd9a", "#4f5d45", "#cdd6bf"]),
    ("dusk",       "#f3ece4", ["#9a6c8c", "#d99fb0", "#5b4a66", "#e7c1cd"]),
    ("ocean",      "#e9eef0", ["#3c6e84", "#7fa9b8", "#27424f", "#bcd4dc"]),
    ("mustard",    "#f4efe1", ["#d6a534", "#e8c570", "#8a6d1f", "#b98b2a"]),
    ("ink",        "#f2efe9", ["#2c2c34", "#5a5a66", "#8a8a96", "#0f0f14"]),
    ("blush",      "#f6ece9", ["#cf8170", "#e6b4a6", "#a85a4b", "#f0d2c8"]),
    ("midnight",   "#11131f", ["#e8c372", "#f3e2b0", "#5b6b9c", "#cfd8f0"]),
]

# Style -> SEO keyword bank used to build listing titles & tags.
KEYWORDS = {
    "arches": ["boho wall art", "mid century modern", "arch print", "neutral decor",
               "minimalist art", "abstract arches", "living room art", "earth tones"],
    "dunes": ["minimalist landscape", "sunset print", "abstract hills", "boho nature",
              "layered mountains", "warm wall art", "bedroom decor", "modern nature"],
    "bauhaus": ["bauhaus print", "geometric art", "mid century modern", "primary colors",
                "abstract poster", "retro wall art", "shapes print", "graphic decor"],
    "celestial": ["moon phases print", "celestial wall art", "starfield poster", "lunar art",
                  "dark academia", "night sky decor", "boho celestial", "gold and navy"],
    "grid": ["abstract geometric", "mid century grid", "modern wall art", "shape collage",
             "minimalist poster", "gallery wall", "contemporary art", "neutral abstract"],
}

ADJECTIVES = ["Calm", "Warm", "Quiet", "Bold", "Soft", "Modern", "Faded", "Golden",
              "Dusty", "Still", "Sunlit", "Muted"]
NOUNS = {
    "arches": ["Arches", "Doorway", "Horizon", "Portal", "Curve"],
    "dunes": ["Dunes", "Hills", "Valley", "Ridge", "Sunset"],
    "bauhaus": ["Composition", "Forms", "Balance", "Study", "Shapes"],
    "celestial": ["Phases", "Cosmos", "Nightfall", "Orbit", "Constellation"],
    "grid": ["Grid", "Mosaic", "Collage", "Field", "Arrangement"],
}


# --------------------------------------------------------------------------- #
# Color helpers
# --------------------------------------------------------------------------- #
def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore


def shade(rgb: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    """factor < 1 darkens, > 1 lightens, via HLS lightness."""
    r, g, b = (c / 255 for c in rgb)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = max(0.0, min(1.0, l * factor))
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (round(r * 255), round(g * 255), round(b * 255))


# --------------------------------------------------------------------------- #
# Drawing primitives
# --------------------------------------------------------------------------- #
def grain(img: Image.Image, strength: int, rng: random.Random) -> Image.Image:
    """Add a subtle paper grain so prints don't look flatly digital."""
    if strength <= 0:
        return img
    noise = Image.effect_noise(img.size, strength).convert("L")
    noise = noise.point(lambda v: 128 + (v - 128) // 2)
    grained = Image.composite(img, Image.new("RGB", img.size, (0, 0, 0)), noise)
    return Image.blend(img, grained, 0.06)


# --------------------------------------------------------------------------- #
# Style renderers — each returns an RGB image at the requested pixel size.
# All coordinates are computed from W/H so any aspect ratio / resolution works.
# --------------------------------------------------------------------------- #
def render_arches(W: int, H: int, pal, rng: random.Random) -> Image.Image:
    _, bg, inks = pal
    img = Image.new("RGB", (W, H), hex_to_rgb(bg))
    d = ImageDraw.Draw(img)
    cx = W // 2
    n = rng.randint(4, 7)
    base = int(H * 0.86)
    span = int(W * rng.uniform(0.62, 0.78))
    for i in range(n):
        t = i / max(1, n - 1)
        r = int(span / 2 * (1 - t * 0.82))
        col = hex_to_rgb(rng.choice(inks))
        col = shade(col, 1.0 + (t - 0.5) * 0.5)
        top = base - r * 2
        d.pieslice([cx - r, top, cx + r, base + r], 180, 360, fill=col)
        d.rectangle([cx - r, base, cx + r, base + r], fill=col)
    # grounding bar
    d.rectangle([0, base, W, H], fill=shade(hex_to_rgb(inks[0]), 0.7))
    return img


def render_dunes(W: int, H: int, pal, rng: random.Random) -> Image.Image:
    name, bg, inks = pal
    img = Image.new("RGB", (W, H), hex_to_rgb(bg))
    d = ImageDraw.Draw(img)
    # soft sky gradient
    top = shade(hex_to_rgb(inks[-1]), 1.25)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)],
               fill=tuple(round(top[i] + (hex_to_rgb(bg)[i] - top[i]) * t) for i in range(3)))
    # sun
    sr = int(W * rng.uniform(0.16, 0.26))
    sx = rng.randint(int(W * 0.3), int(W * 0.7))
    sy = int(H * rng.uniform(0.28, 0.42))
    d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=shade(hex_to_rgb(inks[0]), 1.3))
    # layered hills
    layers = rng.randint(4, 6)
    for i in range(layers):
        t = i / max(1, layers - 1)
        ybase = int(H * (0.5 + t * 0.5))
        amp = int(H * 0.06 * (1 - t * 0.4))
        freq = rng.uniform(1.2, 2.6)
        phase = rng.uniform(0, math.tau)
        col = shade(hex_to_rgb(inks[i % len(inks)]), 1.1 - t * 0.5)
        pts = [(0, H)]
        for x in range(0, W + 1, max(1, W // 240)):
            yy = ybase + int(amp * math.sin(freq * math.tau * x / W + phase))
            pts.append((x, yy))
        pts.append((W, H))
        d.polygon(pts, fill=col)
    return img


def render_bauhaus(W: int, H: int, pal, rng: random.Random) -> Image.Image:
    name, bg, inks = pal
    img = Image.new("RGB", (W, H), hex_to_rgb(bg))
    d = ImageDraw.Draw(img)
    cols, rows = 3, 4
    cw, ch = W / cols, H / rows
    shapes = rng.randint(7, 11)
    for _ in range(shapes):
        gx, gy = rng.randint(0, cols - 1), rng.randint(0, rows - 1)
        x0, y0 = gx * cw, gy * ch
        col = hex_to_rgb(rng.choice(inks))
        kind = rng.choice(["circle", "semi", "tri", "bar", "quarter"])
        pad = min(cw, ch) * 0.08
        box = [x0 + pad, y0 + pad, x0 + cw - pad, y0 + ch - pad]
        if kind == "circle":
            d.ellipse(box, fill=col)
        elif kind == "semi":
            d.pieslice(box, rng.choice([0, 90, 180, 270]),
                       rng.choice([0, 90, 180, 270]) + 180, fill=col)
        elif kind == "quarter":
            a = rng.choice([0, 90, 180, 270])
            d.pieslice([box[0], box[1], box[0] + 2 * (box[2] - box[0]),
                        box[1] + 2 * (box[3] - box[1])], a, a + 90, fill=col)
        elif kind == "tri":
            d.polygon([(box[0], box[3]), (box[2], box[3]),
                       ((box[0] + box[2]) / 2, box[1])], fill=col)
        else:
            if rng.random() < 0.5:
                bw = (box[2] - box[0]) * 0.4
                d.rectangle([(box[0] + box[2]) / 2 - bw / 2, box[1],
                             (box[0] + box[2]) / 2 + bw / 2, box[3]], fill=col)
            else:
                bh = (box[3] - box[1]) * 0.4
                d.rectangle([box[0], (box[1] + box[3]) / 2 - bh / 2,
                             box[2], (box[1] + box[3]) / 2 + bh / 2], fill=col)
    return img


def render_celestial(W: int, H: int, pal, rng: random.Random) -> Image.Image:
    # force a dark palette feel regardless of input
    bg = "#11131f"
    gold = "#e8c372"
    img = Image.new("RGB", (W, H), hex_to_rgb(bg))
    d = ImageDraw.Draw(img)
    # starfield
    for _ in range(int(W * H / 5000)):
        x, y = rng.randint(0, W), rng.randint(0, H)
        s = rng.choice([1, 1, 1, 2, 3]) * max(1, W // 600)
        b = rng.randint(120, 255)
        d.ellipse([x, y, x + s, y + s], fill=(b, b, min(255, b + 20)))
    # moon-phase row
    phases = rng.choice([5, 7, 8])
    margin = W * 0.12
    gap = (W - 2 * margin) / (phases - 1)
    r = int(min(gap * 0.4, H * 0.06))
    cy = int(H * 0.5)
    for i in range(phases):
        cx = int(margin + i * gap)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=hex_to_rgb(gold))
        frac = i / (phases - 1)
        shadow = hex_to_rgb(bg)
        off = int((frac * 2 - 1) * 2 * r)
        d.ellipse([cx - r + off, cy - r, cx + r + off, cy + r], fill=shadow)
    # thin frame line
    m = int(min(W, H) * 0.05)
    d.rectangle([m, m, W - m, H - m], outline=hex_to_rgb(gold), width=max(1, W // 700))
    return img


def render_grid(W: int, H: int, pal, rng: random.Random) -> Image.Image:
    name, bg, inks = pal
    img = Image.new("RGB", (W, H), hex_to_rgb(bg))
    d = ImageDraw.Draw(img)
    cols = rng.randint(3, 4)
    rows = rng.randint(4, 5)
    m = int(min(W, H) * 0.07)
    gw, gh = (W - 2 * m), (H - 2 * m)
    cw, ch = gw / cols, gh / rows
    for r in range(rows):
        for c in range(cols):
            x0 = m + c * cw
            y0 = m + r * ch
            pad = min(cw, ch) * 0.06
            box = [x0 + pad, y0 + pad, x0 + cw - pad, y0 + ch - pad]
            col = hex_to_rgb(rng.choice(inks))
            kind = rng.choice(["circle", "ring", "diag", "dot", "full", "half"])
            if kind == "circle":
                d.ellipse(box, fill=col)
            elif kind == "ring":
                d.ellipse(box, outline=col, width=max(2, int(cw * 0.07)))
            elif kind == "dot":
                inset = (box[2] - box[0]) * 0.3
                d.ellipse([box[0] + inset, box[1] + inset,
                           box[2] - inset, box[3] - inset], fill=col)
            elif kind == "diag":
                d.line([box[0], box[3], box[2], box[1]], fill=col,
                       width=max(2, int(cw * 0.08)))
            elif kind == "half":
                d.pieslice(box, rng.choice([0, 90, 180, 270]),
                           rng.choice([0, 90, 180, 270]) + 180, fill=col)
            else:
                d.rectangle(box, fill=col)
    return img


RENDERERS = {
    "arches": render_arches,
    "dunes": render_dunes,
    "bauhaus": render_bauhaus,
    "celestial": render_celestial,
    "grid": render_grid,
}


# --------------------------------------------------------------------------- #
# Catalog metadata
# --------------------------------------------------------------------------- #
@dataclass
class Listing:
    filename: str
    style: str
    seed: int
    title: str
    tags: str
    price_usd: float
    px_w: int
    px_h: int
    dpi: int


def make_listing(style: str, seed: int, fname: str, w: int, h: int, dpi: int,
                 rng: random.Random) -> Listing:
    adj = rng.choice(ADJECTIVES)
    noun = rng.choice(NOUNS[style])
    kw = KEYWORDS[style]
    title = f"{adj} {noun} — Printable {style.title()} Wall Art | Digital Download"
    tags = ", ".join(rng.sample(kw, k=min(8, len(kw))))
    # Instant-download printables usually sell for $4–9; mockup-bundle ~ this.
    price = round(rng.choice([4.0, 5.0, 6.0, 7.0, 8.0]), 2)
    return Listing(fname, style, seed, title, tags, price, w, h, dpi)


# --------------------------------------------------------------------------- #
# Build pipeline
# --------------------------------------------------------------------------- #
def build(args) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    if args.print_ready:
        W, H, dpi = 6000, 9000, 300          # 20x30in @300 / 24x36in @250
    elif args.width and args.height:
        dpi = args.dpi
        W, H = int(args.width * dpi), int(args.height * dpi)
    else:
        W, H, dpi = 1600, 2400, 96           # fast 2:3 preview

    styles = [args.style] if args.style != "mix" else list(RENDERERS)
    listings: list[Listing] = []

    print(f"Forging {args.count} poster(s) at {W}x{H}px ({dpi} DPI)\n")
    for i in range(args.count):
        seed = args.seed + i
        rng = random.Random(seed)
        style = styles[i % len(styles)] if args.style == "mix" else args.style
        pal = rng.choice(PALETTES)

        img = RENDERERS[style](W, H, pal, rng)
        img = grain(img, args.grain, rng)

        fname = f"{style}_{pal[0]}_{seed:05d}.png"
        img.save(out / fname, "PNG", dpi=(dpi, dpi))
        listings.append(make_listing(style, seed, fname, W, H, dpi, rng))
        print(f"  [{i + 1:>3}/{args.count}] {fname}")

    # manifest
    csv_path = out / "catalog.csv"
    with csv_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["filename", "style", "seed", "suggested_title",
                    "suggested_tags", "suggested_price_usd", "px_w", "px_h", "dpi"])
        for L in listings:
            w.writerow([L.filename, L.style, L.seed, L.title, L.tags,
                        L.price_usd, L.px_w, L.px_h, L.dpi])

    total_low = sum(L.price_usd for L in listings)
    print(f"\nDone. {len(listings)} files + manifest -> {out}/")
    print(f"Manifest: {csv_path}")
    print(f"If each design sells just once: ${total_low:.0f}. "
          f"Printables resell infinitely — that's the scalable part.")
    if not args.print_ready and not (args.width and args.height):
        print("\nTip: re-run with --print-ready to export sellable 300 DPI files.")


def parse_args():
    p = argparse.ArgumentParser(description="Generate print-on-demand wall art in bulk.")
    p.add_argument("--count", type=int, default=12, help="number of posters")
    p.add_argument("--style", default="mix",
                   choices=["mix", *RENDERERS.keys()], help="art style")
    p.add_argument("--seed", type=int, default=1000, help="base random seed")
    p.add_argument("--out", default="posters", help="output directory")
    p.add_argument("--print-ready", action="store_true",
                   help="export 6000x9000 px @300 DPI sellable files")
    p.add_argument("--width", type=float, help="print width in inches")
    p.add_argument("--height", type=float, help="print height in inches")
    p.add_argument("--dpi", type=int, default=300, help="DPI for --width/--height")
    p.add_argument("--grain", type=int, default=22, help="paper grain strength (0=off)")
    return p.parse_args()


if __name__ == "__main__":
    build(parse_args())
