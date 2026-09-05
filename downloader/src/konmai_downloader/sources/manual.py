from __future__ import annotations

from ..host import VariantTask
from ..staging import ReleaseDirectory, StagedFile
from .base import RemoteVersion, SourceError


class ManualSource:
    """Never updates by itself; releases are published with the `publish` command."""

    def check(self, task: VariantTask) -> RemoteVersion | None:
        return None

    def fetch(self, task: VariantTask, remote: RemoteVersion, directory: ReleaseDirectory) -> list[StagedFile]:
        raise SourceError("manual variants are published by hand")
