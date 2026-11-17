"""All settings come from environment variables (or a .env file next to the run_*.py scripts)."""
import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:  # python-dotenv is optional
    pass

ROOT = Path(__file__).resolve().parent.parent


def _path(var: str, default: str) -> str:
    """Relative paths in .env are relative to the ai_coworker folder, not the current directory."""
    p = Path(os.getenv(var) or default)
    return str(p if p.is_absolute() else ROOT / p)


@dataclass
class Settings:
    bot_name: str = os.getenv("BOT_NAME", "Worker")
    company_context: str = os.getenv("COMPANY_CONTEXT", "")

    # LLM: any OpenAI-compatible endpoint (OpenAI, Azure OpenAI, Anthropic's OpenAI-compatible endpoint, local models...)
    llm_api_key: str = os.getenv("LLM_API_KEY", "")
    llm_base_url: str = os.getenv("LLM_BASE_URL", "")  # blank = api.openai.com
    llm_model: str = os.getenv("LLM_MODEL", "gpt-5-mini")

    # ERP
    erp_backend: str = os.getenv("ERP_BACKEND", "csv")  # csv | accentis_sql
    erp_csv_dir: str = _path("ERP_CSV_DIR", "sample_data")
    accentis_odbc: str = os.getenv("ACCENTIS_ODBC", "")
    accentis_queries: str = _path("ACCENTIS_QUERIES", "accentis_queries.toml")

    # Shared memory (meeting notes, issues, actions)
    memory_db: str = _path("MEMORY_DB", "coworker_memory.sqlite3")

    # Chat adapters
    discord_token: str = os.getenv("DISCORD_TOKEN", "")
    discord_digest_channel_id: str = os.getenv("DISCORD_DIGEST_CHANNEL_ID", "")
    digest_time: str = os.getenv("DIGEST_TIME", "07:30")  # local time, HH:MM
    discord_webhook_url: str = os.getenv("DISCORD_WEBHOOK_URL", "")
    teams_webhook_url: str = os.getenv("TEAMS_WEBHOOK_URL", "")


settings = Settings()
