from __future__ import annotations

import logging
from typing import Any

from gpapi.googleplay import GooglePlayAPI, LoginError, RequestError

from ..credentials import DeviceLogin
from ..host import VariantTask
from ..staging import ReleaseDirectory, StagedFile, sanitize_version
from .base import RemoteVersion, SourceContext, SourceError

logger = logging.getLogger(__name__)


class GooglePlaySource:
    """Talks to Google Play through one login per configured device, trying devices in order."""

    def __init__(self, context: SourceContext) -> None:
        if context.config.google is None:
            raise SourceError("google account is not configured")
        self.google = context.config.google
        self.credentials = context.credentials
        self.apis: dict[str, GooglePlayAPI] = {}

    def _api(self, device: str, locale: str, timezone: str) -> GooglePlayAPI:
        key = f"{device}|{locale}|{timezone}"
        api = self.apis.get(key)
        if api is not None:
            return api
        api = GooglePlayAPI(locale, timezone, device)
        cached = self.credentials.get(device)
        if cached is not None:
            try:
                api.login(gsfId=cached.gsf_id, authSubToken=cached.auth_sub_token)
                self.apis[key] = api
                return api
            except (LoginError, RequestError, Exception) as error:
                logger.warning("cached login for %s rejected (%s), logging in again", device, error)
                self.credentials.forget(device)
        try:
            gsf_id, token = api.login(self.google.email, self.google.password, returnParams=True)
        except Exception as error:
            raise SourceError(f"google login failed for device {device}: {error}") from error
        self.credentials.store(device, DeviceLogin(int(gsf_id), str(token)))
        self.apis[key] = api
        return api

    def _settings(self, task: VariantTask) -> tuple[str, list[str], str, str, bool]:
        source: dict[str, Any] = task.source
        return (
            str(source.get("packageName") or task.package_name),
            list(source.get("devices") or self.google.devices),
            str(source.get("locale") or self.google.locale),
            str(source.get("timezone") or self.google.timezone),
            bool(source.get("expansionFiles", True)),
        )

    def _first_working(self, task: VariantTask, action):
        package_name, devices, locale, timezone, _ = self._settings(task)
        failures = []
        for device in devices:
            try:
                return device, action(self._api(device, locale, timezone), package_name)
            except SourceError as error:
                failures.append(f"{device}: {error}")
            except Exception as error:
                failures.append(f"{device}: {error}")
                logger.info("device %s failed for %s: %s", device, package_name, error)
        raise SourceError("; ".join(failures))

    def check(self, task: VariantTask) -> RemoteVersion | None:
        def read_details(api: GooglePlayAPI, package_name: str):
            details = api.details(package_name)
            app_details = details["details"]["appDetails"]
            return RemoteVersion(
                version=sanitize_version(str(app_details["versionString"])),
                version_code=int(app_details["versionCode"]),
            )

        _, remote = self._first_working(task, read_details)
        return remote

    def fetch(self, task: VariantTask, remote: RemoteVersion, directory: ReleaseDirectory) -> list[StagedFile]:
        package_name, _, _, _, expansion_files = self._settings(task)

        def start_download(api: GooglePlayAPI, name: str):
            return api.download(name, versionCode=remote.version_code, expansion_files=expansion_files)

        _, download = self._first_working(task, start_download)
        staged: list[StagedFile] = []
        base_name = f"{package_name}_{remote.version}"
        splits = download.get("splits") or []
        if splits:
            base = directory.write_stream("base.apk", download["file"]["data"])
            members = [base.path]
            for split in splits:
                members.append(directory.write_stream(
                    f"{split['name']}.apk", split["file"]["data"]).path)
            staged.append(directory.zip_apks(f"{base_name}.apks", members))
        else:
            staged.append(directory.write_stream(f"{base_name}.apk", download["file"]["data"]))
        for obb in download.get("additionalData") or []:
            file_name = f"{obb['type']}.{obb['versionCode']}.{download['docId']}.obb"
            staged.append(directory.write_stream(file_name, obb["file"]["data"]))
        return staged
