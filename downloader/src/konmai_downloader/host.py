"""HTTP client for the host's ingest API."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any

import requests

from .staging import StagedFile

logger = logging.getLogger(__name__)

retry_delays_seconds = (1, 5, 15)


@dataclass
class VariantTask:
    id: int
    package_name: str
    slug: str
    name: str
    source: dict[str, Any]
    active_version: str | None
    active_version_code: int | None
    check_requested: bool


class HostError(Exception):
    def __init__(self, status: int, body: Any) -> None:
        super().__init__(f"host answered {status}: {body}")
        self.status = status
        self.body = body


class HostClient:
    def __init__(self, url: str, ingest_token: str) -> None:
        self.url = url
        self.session = requests.Session()
        self.session.headers["authorization"] = f"Bearer {ingest_token}"

    def _request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        last_error: Exception | None = None
        for attempt, delay in enumerate(retry_delays_seconds):
            try:
                response = self.session.request(method, self.url + path, timeout=60, **kwargs)
            except requests.ConnectionError as error:
                last_error = error
                logger.warning("host unreachable (attempt %d): %s", attempt + 1, error)
                time.sleep(delay)
                continue
            if response.status_code >= 500:
                logger.warning("host error %d (attempt %d)", response.status_code, attempt + 1)
                time.sleep(delay)
                continue
            return response
        raise HostError(0, str(last_error) if last_error else "host kept failing")

    def variants(self) -> list[VariantTask]:
        response = self._request("GET", "/api/ingest/variants")
        if response.status_code != 200:
            raise HostError(response.status_code, response.text)
        tasks = []
        for entry in response.json():
            active = entry.get("activeRelease")
            tasks.append(
                VariantTask(
                    id=entry["id"],
                    package_name=entry["packageName"],
                    slug=entry["slug"],
                    name=entry["name"],
                    source=entry["source"],
                    active_version=None if active is None else active["version"],
                    active_version_code=None if active is None else active.get("versionCode"),
                    check_requested=bool(entry.get("checkRequested")),
                )
            )
        return tasks

    def publish_release(
        self,
        task: VariantTask,
        version: str,
        version_code: int | None,
        files: list[StagedFile],
    ) -> requests.Response:
        payload = {
            "packageName": task.package_name,
            "variant": task.slug,
            "version": version,
            "versionCode": version_code,
            "files": [
                {
                    "path": str(file.path),
                    "fileName": file.file_name,
                    "kind": file.kind,
                    "sizeBytes": file.size_bytes,
                    "sha256": file.sha256,
                }
                for file in files
            ],
        }
        return self._request("POST", "/api/ingest/releases", json=payload)

    def report_check(
        self,
        task: VariantTask,
        status: str,
        error: str | None = None,
        remote_version: str | None = None,
        remote_version_code: int | None = None,
    ) -> None:
        payload: dict[str, Any] = {"status": status}
        if error is not None:
            payload["error"] = error[:4000]
        if remote_version is not None:
            payload["remoteVersion"] = remote_version
        if remote_version_code is not None:
            payload["remoteVersionCode"] = remote_version_code
        response = self._request(
            "POST", f"/api/ingest/variants/{task.id}/check-result", json=payload)
        if response.status_code >= 400:
            logger.warning("reporting check result failed: %s %s",
                           response.status_code, response.text)

    def heartbeat(
        self,
        phase: str,
        variant_id: int | None = None,
        pass_started_at: str | None = None,
        pass_finished_at: str | None = None,
        pass_summary: str | None = None,
    ) -> None:
        payload = {
            "phase": phase,
            "variantId": variant_id,
            "passStartedAt": pass_started_at,
            "passFinishedAt": pass_finished_at,
            "passSummary": pass_summary,
        }
        try:
            self._request("POST", "/api/ingest/heartbeat", json=payload)
        except HostError as error:
            logger.warning("heartbeat failed: %s", error)
