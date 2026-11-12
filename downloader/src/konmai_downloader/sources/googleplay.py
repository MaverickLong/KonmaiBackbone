from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar

from gpapi.googleplay import GooglePlayAPI

from ..credentials import GoogleAccount
from ..google_account import oldest_first, open_device
from ..host import VariantTask
from ..staging import ReleaseDirectory, StagedFile, sanitize_version
from .base import Compatibility, RemoteVersion, SourceContext, SourceError

logger = logging.getLogger(__name__)

Result = TypeVar("Result")

add_account_hint = "add one with `konmai-downloader account add`"


@dataclass
class PlaySettings:
    package_name: str
    # Every device and account pair to try, devices oldest first, each with every account.
    combinations: list[Compatibility]
    # The variant names both a device and an account: only that pair is tried.
    pinned: bool
    locale: str
    timezone: str
    expansion_files: bool


class GooglePlaySource:
    """Talks to Google Play with one session per account and device.

    The variant's source may name a `device` and an `account` (by email); the downloader saves
    them there once a pair works. Whatever is not named is tried in turn.
    """

    def __init__(self, context: SourceContext) -> None:
        if context.config.google is None:
            raise SourceError("google is not configured")
        self.google = context.config.google
        self.credentials = context.credentials
        self.sessions = context.play_sessions

    def _api(self, account: GoogleAccount, device: str, locale: str, timezone: str) -> GooglePlayAPI:
        key = f"{account.email}|{device}|{locale}|{timezone}"
        api = self.sessions.get(key)
        if api is not None:
            return api
        gsf_id = account.gsf_ids.get(device)
        try:
            api = open_device(device, locale, timezone, account.email, account.master_token, gsf_id)
        except Exception as error:
            if gsf_id is None:
                raise SourceError(f"google login failed: {error}") from error
            # The stored check-in may have been revoked; check the device in again once.
            logger.warning("session for %s with %s failed (%s), checking the device in again",
                           device, account.alias, error)
            self.credentials.forget_device(account.email, device)
            try:
                api = open_device(device, locale, timezone, account.email,
                                  account.master_token, None)
            except Exception as retry_error:
                raise SourceError(f"google login failed: {retry_error}") from retry_error
        if gsf_id != api.gsfId:
            self.credentials.store_device(account.email, device, api.gsfId)
        self.sessions[key] = api
        return api

    def _settings(self, task: VariantTask) -> PlaySettings:
        source: dict[str, Any] = task.source
        device = source.get("device")
        email = source.get("account")
        pinned = bool(device and email)
        devices = [str(device)] if device else oldest_first(
            list(source.get("devices") or self.google.devices))
        if email:
            if self.credentials.find_by_email(str(email)) is None:
                raise SourceError(
                    f"account {email} is not signed in; {add_account_hint} or pick another "
                    "account for this variant", alert=pinned)
            emails = [str(email)]
        else:
            emails = [account.email for account in self.credentials.accounts]
            if not emails:
                raise SourceError(f"no Google account; {add_account_hint}")
        return PlaySettings(
            package_name=str(source.get("packageName") or task.package_name),
            combinations=[Compatibility(device, email) for device in devices for email in emails],
            pinned=pinned,
            locale=str(source.get("locale") or self.google.locale),
            timezone=str(source.get("timezone") or self.google.timezone),
            expansion_files=bool(source.get("expansionFiles", True)),
        )

    def _first_working(
        self,
        settings: PlaySettings,
        action: Callable[[GooglePlayAPI, str], Result],
        start: Compatibility | None = None,
    ) -> tuple[Compatibility, Result]:
        """Runs `action` with each combination from `start` on until one succeeds."""
        combinations = settings.combinations
        if start in combinations:
            combinations = combinations[combinations.index(start):]
        failures = []
        for combination in combinations:
            account = self.credentials.find_by_email(combination.account)
            if account is None:
                continue
            label = f"{combination.device}/{account.alias}"
            try:
                api = self._api(account, combination.device, settings.locale, settings.timezone)
                return combination, action(api, settings.package_name)
            except SourceError as error:
                failures.append(f"{label}: {error}")
            except Exception as error:
                failures.append(f"{label}: {error}")
                logger.info("%s failed for %s: %s", label, settings.package_name, error)
                # Play tokens expire; the next attempt mints a fresh one from the master token.
                self.sessions.pop(
                    f"{account.email}|{combination.device}|{settings.locale}|{settings.timezone}",
                    None)
        raise SourceError("; ".join(failures) or "no usable account", alert=settings.pinned)

    def check(self, task: VariantTask) -> RemoteVersion | None:
        def read_details(api: GooglePlayAPI, package_name: str) -> RemoteVersion:
            details = api.details(package_name)
            app_details = details["details"]["appDetails"]
            return RemoteVersion(
                version=sanitize_version(str(app_details["versionString"])),
                version_code=int(app_details["versionCode"]),
            )

        combination, remote = self._first_working(self._settings(task), read_details)
        remote.compatibility = combination
        return remote

    def fetch(self, task: VariantTask, remote: RemoteVersion, directory: ReleaseDirectory) -> list[StagedFile]:
        settings = self._settings(task)

        def start_download(api: GooglePlayAPI, name: str):
            return api.download(name, versionCode=remote.version_code,
                                expansion_files=settings.expansion_files)

        # Combinations before the one the check succeeded with already failed to read the listing.
        remote.compatibility, download = self._first_working(
            settings, start_download, remote.compatibility)
        staged: list[StagedFile] = []
        base_name = f"{settings.package_name}_{remote.version}"
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
