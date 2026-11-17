"""The only things the worker needs from an ERP. Every backend is READ-ONLY by design."""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class Item:
    code: str
    description: str
    type: str = "buy"  # "make" (has a BOM) or "buy"
    uom: str = "ea"
    lead_time_days: int = 0
    min_stock: float = 0


@dataclass
class Stock:
    item: str
    on_hand: float = 0
    allocated: float = 0  # committed to sales orders / jobs
    on_order: float = 0  # open purchase orders

    @property
    def available(self) -> float:
        return self.on_hand - self.allocated


class ErpBackend(ABC):
    @abstractmethod
    def get_item(self, code: str) -> Item | None: ...

    @abstractmethod
    def search_items(self, text: str, limit: int = 20) -> list[Item]: ...

    @abstractmethod
    def list_items(self) -> list[Item]: ...

    @abstractmethod
    def get_stock(self, code: str) -> Stock: ...

    @abstractmethod
    def get_bom(self, code: str) -> list[tuple[str, float]]:
        """Single-level BOM: [(component_code, qty_per_parent), ...]. Empty if bought-in."""

    @abstractmethod
    def get_usage(self, code: str, days: int = 365) -> float:
        """Total quantity issued/consumed in the last `days` days."""
