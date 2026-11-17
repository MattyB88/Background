from .base import ErpBackend, Item, Stock


def get_backend(settings) -> ErpBackend:
    if settings.erp_backend == "csv":
        from .csv_backend import CsvBackend

        return CsvBackend(settings.erp_csv_dir)
    if settings.erp_backend == "accentis_sql":
        from .accentis_sql import AccentisSqlBackend

        return AccentisSqlBackend(settings.accentis_odbc, settings.accentis_queries)
    raise ValueError(f"Unknown ERP_BACKEND {settings.erp_backend!r}")


__all__ = ["ErpBackend", "Item", "Stock", "get_backend"]
