"""Writes downloaded content into the host's staging directory, hashing as it goes."""

from __future__ import annotations

import hashlib
import re
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

version_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
file_kinds_by_suffix = {".apk": "apk", ".apks": "apks"}


@dataclass
class StagedFile:
    path: Path
    file_name: str
    kind: str
    size_bytes: int
    sha256: str


def sanitize_version(raw: str) -> str:
    """Turns an arbitrary version string into the path-safe form the host accepts."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw.strip()).strip("._-")[:64]
    if not version_pattern.match(cleaned):
        raise ValueError(f"cannot derive a usable version from {raw!r}")
    return cleaned


def kind_for(file_name: str) -> str:
    lowered = file_name.lower()
    if lowered.endswith(".obb"):
        return "obb-patch" if lowered.startswith("patch.") else "obb-main"
    return file_kinds_by_suffix.get(Path(lowered).suffix, "other")


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def describe(path: Path, kind: str | None = None) -> StagedFile:
    return StagedFile(
        path=path,
        file_name=path.name,
        kind=kind or kind_for(path.name),
        size_bytes=path.stat().st_size,
        sha256=hash_file(path),
    )


class ReleaseDirectory:
    """A fresh `<staging>/<package>/<variant>/<version>` directory for one release."""

    def __init__(self, staging_root: Path, package_name: str, variant: str, version: str) -> None:
        self.path = staging_root / package_name / variant / version
        if self.path.exists():
            shutil.rmtree(self.path)
        self.path.mkdir(parents=True)

    def write_stream(self, file_name: str, chunks: Iterable[bytes], kind: str | None = None) -> StagedFile:
        target = self.path / file_name
        digest = hashlib.sha256()
        size = 0
        with target.open("wb") as handle:
            for chunk in chunks:
                if chunk:
                    handle.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
        return StagedFile(target, file_name, kind or kind_for(file_name), size, digest.hexdigest())

    def zip_apks(self, file_name: str, members: list[Path]) -> StagedFile:
        """Bundles a base APK and its splits into an .apks archive (stored, APKs are already compressed)."""
        target = self.path / file_name
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
            for member in members:
                archive.write(member, arcname=member.name)
        for member in members:
            member.unlink()
        return describe(target, "apks")

    def discard(self) -> None:
        shutil.rmtree(self.path, ignore_errors=True)
