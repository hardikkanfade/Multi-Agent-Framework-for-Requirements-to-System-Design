import os
from types import SimpleNamespace
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

settings = SimpleNamespace(
    max_revisions=int(os.getenv("MAX_REVISIONS", "2")),
    llm_provider=os.getenv("LLM_PROVIDER", "demo"),
    gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
    gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash"),
)
