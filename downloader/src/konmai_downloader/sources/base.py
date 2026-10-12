from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol

from ..config import Config
from ..credentials import Credentials
from ..host import VariantTask
from ..staging import ReleaseDirectory, StagedFile

if TYPE_CHECKING:
    from gpapi.googleplay import GooglePlayAPI


class SourceError(Exception):
    """Raised when checking or fetching fails for a reason worth showing in the dashboard."""


@dataclass
class RemoteVersion:
    version: str
    version_code: int | None = None


@dataclass
class SourceContext:
    config: Config
    credentials: Credentials
    # Open Play sessions by device and locale, shared by every variant so a pass does not
    # sign in once per app.
    play_sessions: dict[str, GooglePlayAPI] = field(default_factory=dict)


class Source(Protocol):
    def check(self, task: VariantTask) -> RemoteVersion | None:
        """Returns the newest upstream version, or None when the source never updates."""

    def fetch(self, task: VariantTask, remote: RemoteVersion, directory: ReleaseDirectory) -> list[StagedFile]:
        """Downloads every file of `remote` into `directory`."""


def is_newer(remote: RemoteVersion, task: VariantTask) -> bool:
    if task.active_version is None:
        return True
    if remote.version_code is not None and task.active_version_code is not None:
        return remote.version_code > task.active_version_code
    return remote.version != task.active_version
