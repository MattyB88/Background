"""Render Nudge architecture + process-flow diagrams to PNG (Pillow only)."""
from PIL import Image, ImageDraw, ImageFont

INK = (33, 37, 48)
ACCENT = (196, 98, 61)
ACCENT2 = (61, 110, 132)
BG = (245, 243, 238)
BOX = (255, 255, 255)


def font(sz, bold=False):
    paths = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, sz)
        except OSError:
            pass
    return ImageFont.load_default()


def box(d, xy, text, fill=BOX, outline=INK, tcol=INK, f=None, w=3):
    x0, y0, x1, y1 = xy
    d.rounded_rectangle(xy, radius=14, fill=fill, outline=outline, width=w)
    f = f or font(22, True)
    lines = text.split("\n")
    th = sum(d.textbbox((0, 0), ln, font=f)[3] for ln in lines) + (len(lines) - 1) * 6
    y = (y0 + y1) / 2 - th / 2
    for ln in lines:
        bb = d.textbbox((0, 0), ln, font=f)
        d.text(((x0 + x1) / 2 - (bb[2] - bb[0]) / 2, y), ln, fill=tcol, font=f)
        y += (bb[3] - bb[1]) + 10


def arrow(d, p0, p1, col=ACCENT, w=4):
    d.line([p0, p1], fill=col, width=w)
    import math
    a = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    L = 14
    for s in (-0.5, 0.5):
        d.line([p1, (p1[0] - L * math.cos(a + s), p1[1] - L * math.sin(a + s))],
               fill=col, width=w)


def architecture():
    W, H = 1180, 760
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((40, 28), "Nudge — System Architecture", fill=INK, font=font(38, True))
    d.text((40, 78), "Sensor does the watching; MCU sleeps until a candidate gesture.",
           fill=ACCENT2, font=font(20))

    f = font(20, True)
    fs = font(17)
    # IMU
    box(d, (60, 150, 360, 290),
        "LSM6DSV16X IMU\n+ ML-Core (always-on)\nwatches gestures @ µA", tcol=INK, f=fs,
        outline=ACCENT2)
    # MCU module
    box(d, (470, 150, 800, 330),
        "MDBT50Q-1MV2\n(nRF52840 module)\npre-certified radio+MCU\nBLE 5 • OTA DFU",
        f=fs, outline=ACCENT, w=4)
    # Haptic
    box(d, (60, 350, 360, 470), "DRV2605L driver\n→ LRA  (the nudge)", f=fs)
    # button/led
    box(d, (60, 520, 360, 620), "button + LED", f=fs)
    # power
    box(d, (470, 430, 690, 560), "MCP73831\nLiPo charger", f=fs)
    box(d, (710, 430, 930, 560), "LiPo 110mAh\n+ protection", f=fs)
    # phone
    box(d, (910, 150, 1120, 290), "Phone / PWA\nstats • config\nOTA", f=fs,
        outline=ACCENT2)
    # charge port
    box(d, (470, 610, 690, 700), "USB-C / pogo\n(sealed)", f=fs)

    arrow(d, (360, 215), (470, 215), ACCENT)        # IMU INT -> MCU
    d.text((365, 180), "INT1 wake", fill=INK, font=font(15))
    arrow(d, (470, 250), (360, 250), ACCENT2)       # I2C back
    arrow(d, (360, 410), (470, 300), ACCENT)        # haptic <-> mcu (i2c)
    arrow(d, (300, 470), (300, 520), ACCENT2)
    arrow(d, (800, 240), (910, 230), ACCENT2)       # BLE
    d.text((805, 195), "BLE ●)))", fill=INK, font=font(15))
    arrow(d, (690, 495), (710, 495), ACCENT)        # charger->batt
    arrow(d, (635, 430), (635, 330), ACCENT)        # VBAT up to module
    d.text((640, 360), "VBAT", fill=INK, font=font(15))
    arrow(d, (580, 610), (580, 560), ACCENT2)       # charge in

    img.save("nudge_architecture.png")
    print("wrote nudge_architecture.png")


def process_flow():
    W, H = 1180, 560
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((40, 28), "Nudge — Manufacturing Process Flow (10–25 units)",
           fill=INK, font=font(34, True))
    steps = ["Panelize", "Paste +\nStencil", "PnP\nPlace", "Reflow", "Inspect /\nRework",
             "Flash FW", "FCT Test", "Battery +\nPogo", "Overmold\n(seal)",
             "TPU Band", "Final +\nWear", "Pack /\nShip"]
    fs = font(18, True)
    cols, rows = 4, 3
    bw, bh, gx, gy = 230, 95, 60, 55
    x0, y0 = 50, 110
    centers = []
    for i, s in enumerate(steps):
        r, c = divmod(i, cols)
        if r % 2 == 1:
            c = cols - 1 - c            # serpentine
        x = x0 + c * (bw + gx)
        y = y0 + r * (bh + gy)
        col = ACCENT if s in ("FCT Test", "Overmold\n(seal)") else BOX
        tc = BOX if col == ACCENT else INK
        box(d, (x, y, x + bw, y + bh), s, fill=col, tcol=tc, f=fs)
        centers.append((x, y, x + bw, y + bh))
    # connect serpentine
    for i in range(len(steps) - 1):
        a, b = centers[i], centers[i + 1]
        ra, rb = i // cols, (i + 1) // cols
        if ra == rb:
            if (ra % 2 == 0):
                arrow(d, (a[2], (a[1]+a[3])/2), (b[0], (b[1]+b[3])/2), ACCENT2)
            else:
                arrow(d, (a[0], (a[1]+a[3])/2), (b[2], (b[1]+b[3])/2), ACCENT2)
        else:
            arrow(d, ((a[0]+a[2])/2, a[3]), ((b[0]+b[2])/2, b[1]), ACCENT2)
    d.text((50, 500), "Orange = hard quality gates (don't seal a board that failed FCT).",
           fill=ACCENT, font=font(18))
    img.save("nudge_process_flow.png")
    print("wrote nudge_process_flow.png")


if __name__ == "__main__":
    architecture()
    process_flow()
