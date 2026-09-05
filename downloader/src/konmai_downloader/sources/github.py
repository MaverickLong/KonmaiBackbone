from __future__ import annotations

import re
from typing import Any

import requests

from ..host import VariantTask
from ..staging import ReleaseDirectory, StagedFile, sanitize_version
from .base import RemoteVersion, SourceContext, SourceError

api_url = "https://api.github.com"


class GitHubSource:
    def __init__(self, context: SourceContext) -> None:
        self.session = requests.Session()
        self.session.headers["accept"] = "application/vnd.github+json"
        if context.config.github_token:
            self.session.headers["authorization"] = f"Bearer {context.config.github_token}"

    def _latest(self, task: VariantTask) -> dict[str, Any]:
        repository = task.source.get("repository")
        if not repository:
            raise SourceError("github source needs a repository")
        if task.source.get("includePrereleases"):
            response = self.session.get(f"{api_url}/repos/{repository}/releases", timeout=60)
            if response.status_code != 200:
                raise SourceError(f"github answered {response.status_code}")
            candidates = [release for release in response.json() if not release.get("draft")]
            if not candidates:
                raise SourceError("repository has no releases")
            return candidates[0]
        response = self.session.get(f"{api_url}/repos/{repository}/releases/latest", timeout=60)
        if response.status_code != 200:
            raise SourceError(f"github answered {response.status_code}")
        return response.json()

    def check(self, task: VariantTask) -> RemoteVersion | None:
        release = self._latest(task)
        return RemoteVersion(version=sanitize_version(str(release["tag_name"])))

    def fetch(self, task: VariantTask, remote: RemoteVersion, directory: ReleaseDirectory) -> list[StagedFile]:
        release = self._latest(task)
        pattern = re.compile(str(task.source.get("assetPattern") or r"\.apk$"))
        assets = [
            asset
            for asset in release.get("assets", [])
            if pattern.search(asset["name"]) or pattern.search(asset["browser_download_url"])
        ]
        if not assets:
            raise SourceError(f"no asset of {release['tag_name']} matches {pattern.pattern!r}")
        staged = []
        for asset in assets:
            with self.session.get(asset["browser_download_url"], stream=True, timeout=600) as response:
                if response.status_code != 200:
                    raise SourceError(
                        f"downloading {asset['name']} failed with {response.status_code}")
                staged.append(directory.write_stream(
                    asset["name"], response.iter_content(chunk_size=1 << 20)))
        return staged
