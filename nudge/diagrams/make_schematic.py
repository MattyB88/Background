"""Render a net-label-style schematic for Nudge (Pillow only).

Mirrors how a flat KiCad schematic reads: each part shows its pins and each pin
carries a NET LABEL. Pins sharing a label are connected (same as nudge.net).
"""
from PIL import Image, ImageDraw, ImageFont

INK = (33, 37, 48); ACC = (196, 98, 61); ACC2 = (61, 110, 132)
PWR = (170, 120, 30); GNDc = (90, 90, 96); BG = (247, 245, 240); BOX = (255, 255, 255)


def F(sz, b=False):
    p = ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if b
         else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    try: return ImageFont.truetype(p, sz)
    except OSError: return ImageFont.load_default()


def netcol(n):
    if n in ("VBAT", "VBUS", "DRV_REG"): return PWR
    if n == "GND": return GNDc
    return ACC2


def part(d, x, y, w, title, sub, pins, side="right", compact=False):
    rowh = 30
    h = 56 + rowh * len(pins)
    d.rounded_rectangle((x, y, x + w, y + h), radius=12, fill=BOX, outline=INK, width=3)
    d.text((x + 14, y + 9), title, fill=INK, font=F(20, True))
    if sub: d.text((x + 14, y + 32), sub, fill=ACC2, font=F(13))
    yy = y + 56
    for name, net in pins:
        if compact:
            d.text((x + 14, yy + 4), name, fill=INK, font=F(15))
            f = F(15, True); tw = d.textbbox((0, 0), net, font=f)[2]
            d.text((x + w - tw - 14, yy + 4), net, fill=netcol(net), font=f)
        else:
            d.text((x + 16, yy + 4), name, fill=INK, font=F(15))
            sx = x + w if side == "right" else x
            ex = sx + (46 if side == "right" else -46)
            d.line((sx, yy + 12, ex, yy + 12), fill=netcol(net), width=3)
            f = F(15, True); lw = d.textbbox((0, 0), net, font=f)[2] + 14
            lx = ex if side == "right" else ex - lw
            d.rounded_rectangle((lx, yy, lx + lw, yy + 24), radius=6,
                                fill=(240, 236, 228), outline=netcol(net), width=2)
            d.text((lx + 7, yy + 3), net, fill=netcol(net), font=f)
        yy += rowh
    return h


def main():
    W, H = 1500, 1200
    img = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(img)
    d.text((40, 24), "Nudge — Core Schematic (net-label style)", fill=INK, font=F(34, True))
    d.text((40, 70), "Pins with the same label are connected. Power=amber, GND=grey, "
           "signals=blue.  Matches nudge.net.", fill=ACC2, font=F(16))

    # U1 — left, net labels to the right
    h1 = part(d, 60, 120, 360, "U1  MDBT50Q-1MV2", "nRF52840 module (radio+MCU)", [
        ("VDD", "VBAT"), ("GND", "GND"),
        ("P0.04", "SDA"), ("P0.05", "SCL"),
        ("P0.28", "IMU_INT1"), ("P0.29", "IMU_INT2"),
        ("P0.30", "HAP_EN"), ("P0.31", "BTN"),
        ("P0.02", "LED_STAT"), ("P0.03/AIN", "VBAT_SENSE"),
        ("SWDIO", "SWDIO"), ("SWDCLK", "SWDCLK"), ("RESET", "nRESET"),
    ], side="right")

    # U2 / U3 / U4 — right column, net labels to the left
    part(d, 1010, 120, 380, "U2  LSM6DSV16X", "IMU + ML core (Stage-1)", [
        ("VDD/VDDIO", "VBAT"), ("CS", "VBAT"), ("GND", "GND"), ("SA0", "GND"),
        ("SDA", "SDA"), ("SCL", "SCL"), ("INT1", "IMU_INT1"), ("INT2", "IMU_INT2"),
    ], side="left")
    part(d, 1010, 450, 380, "U3  DRV2605L", "haptic LRA driver", [
        ("VDD", "VBAT"), ("GND", "GND"), ("SDA", "SDA"), ("SCL", "SCL"),
        ("EN", "HAP_EN"), ("OUT+", "LRA_P"), ("OUT-", "LRA_N"), ("REG", "DRV_REG"),
    ], side="left")
    part(d, 1010, 780, 380, "U4  MCP73831", "LiPo charger", [
        ("VDD (4)", "VBUS"), ("VBAT (3)", "VBAT"), ("STAT (1)", "CHG_STAT"),
        ("PROG (5)", "ISET"), ("VSS (2)", "GND"),
    ], side="left")

    # Discretes (compact, no stubs) — under U1
    part(d, 60, 610, 410, "Discrete network", "pull-ups / divider / charge-set / decoupling", [
        ("R1, R2  4k7", "SDA/SCL -> VBAT"), ("R8 / R9  1M divider", "VBAT_SENSE"),
        ("R6  5k", "ISET"), ("R10 330 -> LED2", "LED_STAT"),
        ("R7  1k -> LED1", "CHG_STAT"), ("C1/2/3, C5, C6x2, C7, C9", "VBAT // GND"),
        ("C4", "VBUS // GND"), ("C8", "VBAT_SENSE // GND"), ("C10", "DRV_REG // GND"),
    ], compact=True)

    # Peripherals row (compact) — bottom-left, clear of U4
    px = 60
    for t, s, pins in [
        ("LRA1", "actuator", [("OUT+", "LRA_P"), ("OUT-", "LRA_N")]),
        ("BT1 LiPo+PCM", "150 mAh", [("BAT+", "VBAT"), ("BAT-", "GND")]),
        ("J1 Pogo", "sealed charge", [("VBUS", "VBUS"), ("GND", "GND")]),
        ("SW1 button", "user input", [("1", "BTN"), ("2", "GND")]),
        ("J2 SWD", "TC2030", [("IO/CLK", "SWDIO/CLK"), ("RST", "nRESET")]),
    ]:
        part(d, px, 1000, 175, t, s, pins, compact=True); px += 188

    d.text((40, 1168), "Charm bail (BAIL1) is mechanical — molded into the overmold at "
           "12 o'clock; not on the schematic.", fill=ACC, font=F(15))
    img.save("nudge_schematic.png"); print("wrote nudge_schematic.png")


if __name__ == "__main__":
    main()
