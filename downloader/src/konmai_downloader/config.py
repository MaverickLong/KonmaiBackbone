"""Configuration file handling (config.json, camelCase keys like the other services)."""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class HostConfig(CamelModel):
    url: str = "http://127.0.0.1:3000"
    ingest_token: str = Field(min_length=16)


class GoogleConfig(CamelModel):
    email: str
    password: str
    devices: list[str] = Field(default_factory=lambda: ["crackling", "walleye"], min_length=1)
    locale: str = "en_US"
    timezone: str = "UTC"


class Config(CamelModel):
    host: HostConfig
    staging_directory: Path
    credentials_file: Path
    google: GoogleConfig | None = None
    github_token: str | None = None
    daily_at: str = Field(default="03:00", pattern=r"^\d{2}:\d{2}$")
    poll_seconds: int = Field(default=30, ge=5)
    log_level: str = "INFO"


def load_config(path: Path) -> Config:
    absolute = path.resolve()
    with absolute.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    try:
        config = Config.model_validate(raw)
    except ValidationError as error:
        problems = "\n".join(
            f"  {'.'.join(str(part) for part in issue['loc']) or '(root)'}: {issue['msg']}"
            for issue in error.errors()
        )
        raise SystemExit(f"invalid configuration in {absolute}:\n{problems}") from None
    base = absolute.parent
    config.staging_directory = (base / config.staging_directory).resolve()
    config.credentials_file = (base / config.credentials_file).resolve()
    config.host.url = config.host.url.rstrip("/")
    return config
