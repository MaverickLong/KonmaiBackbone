"""One pass over the host's work list: check every variant, fetch and publish what is new."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .config import Config
from .credentials import Credentials
from .host import HostClient, HostError, VariantTask
from .sources import SourceContext, SourceError, create_source, is_newer
from .staging import ReleaseDirectory, StagedFile

logger = logging.getLogger(__name__)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass
class PassSummary:
    checked: int = 0
    updated: int = 0
    failed: int = 0
    failures: list[str] = field(default_factory=list)

    def text(self) -> str:
        line = f"checked {self.checked}, updated {self.updated}, failed {self.failed}"
        if self.failures:
            line += ": " + "; ".join(self.failures[:10])
        return line


class Runner:
    def __init__(self, config: Config, host: HostClient) -> None:
        self.config = config
        self.host = host
        self.context = SourceContext(config, Credentials(config.credentials_file))

    def run_pass(self, only_requested: bool = False) -> PassSummary:
        started_at = now_iso()
        summary = PassSummary()
        tasks = self.host.variants()
        if only_requested:
            tasks = [task for task in tasks if task.check_requested]
        for task in tasks:
            self.process(task, summary)
        self.host.heartbeat(
            "idle",
            pass_started_at=started_at,
            pass_finished_at=now_iso(),
            pass_summary=summary.text(),
        )
        logger.info("pass finished: %s", summary.text())
        return summary

    def process(self, task: VariantTask, summary: PassSummary) -> None:
        label = f"{task.package_name}/{task.slug}"
        summary.checked += 1
        self.host.heartbeat("checking", task.id)
        try:
            source = create_source(task.source, self.context)
            remote = source.check(task)
            if remote is None:
                self.host.report_check(task, "up_to_date")
                return
            if not is_newer(remote, task):
                self.host.report_check(
                    task, "up_to_date", remote_version=remote.version, remote_version_code=remote.version_code
                )
                return
            logger.info("%s: %s -> %s, downloading", label, task.active_version, remote.version)
            self.host.heartbeat("downloading", task.id)
            directory = ReleaseDirectory(
                self.config.staging_directory, task.package_name, task.slug, remote.version
            )
            try:
                files = source.fetch(task, remote, directory)
                self.publish(task, remote.version, remote.version_code, files)
            except Exception:
                directory.discard()
                raise
            directory.discard()
            summary.updated += 1
            self.host.report_check(
                task, "updated", remote_version=remote.version, remote_version_code=remote.version_code
            )
        except (SourceError, HostError, ValueError, KeyError, OSError) as error:
            summary.failed += 1
            summary.failures.append(f"{label}: {error}")
            logger.error("%s: %s", label, error)
            self.host.report_check(task, "failed", error=str(error))
        except Exception as error:
            summary.failed += 1
            summary.failures.append(f"{label}: {error}")
            logger.exception("%s: unexpected failure", label)
            self.host.report_check(task, "failed", error=f"unexpected: {error}")

    def publish(self, task: VariantTask, version: str, version_code: int | None, files: list[StagedFile]) -> None:
        response = self.host.publish_release(task, version, version_code, files)
        if response.status_code == 409 and version_code is not None:
            # The same version string was published before with a different version code.
            response = self.host.publish_release(
                task, f"{version}-{version_code}", version_code, files)
        if response.status_code != 201:
            raise HostError(response.status_code, response.text)
        logger.info("%s/%s: published %s", task.package_name, task.slug, version)
