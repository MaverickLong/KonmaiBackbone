from __future__ import annotations

import requests

from ..host import VariantTask
from ..staging import ReleaseDirectory, StagedFile, sanitize_version
from .base import RemoteVersion, SourceContext, SourceError

api_url = "https://webapi.lowiro.com/webapi/serve/static/bin/arcaea/apk"


class ArcaeaSource:
    def __init__(self, context: SourceContext) -> None:
        self.session = requests.Session()

    def _current(self) -> dict:
        response = self.session.get(api_url, timeout=60)
        if response.status_code != 200:
            raise SourceError(f"lowiro answered {response.status_code}")
        body = response.json()
        if not body.get("success"):
            raise SourceError("lowiro reported failure")
        return body["value"]

    def check(self, task: VariantTask) -> RemoteVersion | None:
        return RemoteVersion(version=sanitize_version(str(self._current()["version"])))

    def fetch(self, task: VariantTask, remote: RemoteVersion, directory: ReleaseDirectory) -> list[StagedFile]:
        current = self._current()
        with self.session.get(current["url"], stream=True, timeout=600) as response:
            if response.status_code != 200:
                raise SourceError(f"downloading the apk failed with {response.status_code}")
            file_name = f"{task.package_name}_{remote.version}.apk"
            return [directory.write_stream(file_name, response.iter_content(chunk_size=1 << 20))]
