"""GPIO buzzer button (and optional LED) for the Raspberry Pi.

Falls back to a no-op when gpiozero isn't available (e.g. testing on a laptop),
so the on-screen / admin "press" still works.
"""
from __future__ import annotations

import logging
from typing import Callable

from game import ACTIVE, ANNOUNCE, FAIL, SUCCESS

log = logging.getLogger(__name__)


class Hardware:
    def __init__(self, cfg: dict, on_press: Callable[[], None], enabled: bool = True):
        self.button = None
        self.led = None
        if not enabled:
            log.info("GPIO disabled - use the admin page or screen press to test")
            return
        try:
            from gpiozero import LED, Button
        except ImportError:
            log.warning("gpiozero not installed - running without the physical buzzer")
            return

        pin = cfg.get("button_pin", 17)
        bounce = cfg.get("bounce_ms", 50) / 1000
        # Button wired between the GPIO pin and GND; internal pull-up enabled.
        self.button = Button(pin, pull_up=True, bounce_time=bounce)
        self.button.when_pressed = lambda: on_press()
        log.info("Buzzer button on GPIO%s", pin)

        if cfg.get("led_pin") is not None:
            self.led = LED(cfg["led_pin"])
            log.info("Buzzer LED on GPIO%s", cfg["led_pin"])

    def on_phase(self, phase: str) -> None:
        if not self.led:
            return
        if phase == ANNOUNCE:
            self.led.blink(on_time=0.15, off_time=0.15)
        elif phase == ACTIVE:
            self.led.blink(on_time=0.5, off_time=0.5)
        elif phase == SUCCESS:
            self.led.on()
        elif phase == FAIL:
            self.led.blink(on_time=0.05, off_time=0.05, n=40)
        else:
            self.led.off()

    def close(self) -> None:
        for dev in (self.button, self.led):
            if dev:
                dev.close()
