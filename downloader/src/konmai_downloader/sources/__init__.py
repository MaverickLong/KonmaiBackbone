"""Source implementations: each knows how to check and fetch one kind of upstream."""

from __future__ import annotations

from typing import Any

from .arcaea import ArcaeaSource
from .base import RemoteVersion, Source, SourceContext, SourceError, is_newer
from .github import GitHubSource
from .googleplay import GooglePlaySource
from .manual import ManualSource

__all__ = [
    "RemoteVersion",
    "Source",
    "SourceContext",
    "SourceError",
    "create_source",
    "is_newer",
]


def create_source(source: dict[str, Any], context: SourceContext) -> Source:
    kind = source.get("type")
    if kind == "googleplay":
        return GooglePlaySource(context)
    if kind == "github":
        return GitHubSource(context)
    if kind == "arcaea":
        return ArcaeaSource(context)
    if kind == "manual":
        return ManualSource()
    raise SourceError(f"unknown source type {kind!r}")
