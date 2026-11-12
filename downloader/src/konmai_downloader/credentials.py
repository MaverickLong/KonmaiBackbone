"""Google accounts the downloader signs in with, stored with mode 0600.

Each account holds its master token and the gsfId every emulated device received when it was
checked in with that account. Play tokens are short-lived and minted from the master token on
demand, so they are not stored.

The `account` commands and the running downloader both write this file, so every change is made
under a lock on a fresh read of the file and written atomically.
"""

from __future__ import annotations

import fcntl
import json
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path


class CredentialsError(Exception):
    """An account command refers to an alias or email that is missing or already taken."""


@dataclass
class GoogleAccount:
    alias: str
    email: str
    master_token: str
    gsf_ids: dict[str, int] = field(default_factory=dict)


def parse_accounts(raw: dict) -> list[GoogleAccount]:
    def gsf_ids(devices: dict) -> dict[str, int]:
        return {device: int(entry["gsfId"]) for device, entry in devices.items()}

    if "accounts" in raw:
        return [
            GoogleAccount(entry["alias"], entry["email"], entry["masterToken"],
                          gsf_ids(entry.get("devices", {})))
            for entry in raw["accounts"]
        ]
    # The single-account file written before accounts had aliases.
    if raw.get("email") and raw.get("masterToken"):
        email = raw["email"]
        return [GoogleAccount(email.partition("@")[0], email, raw["masterToken"],
                              gsf_ids(raw.get("devices", {})))]
    return []


class Credentials:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.accounts: list[GoogleAccount] = []
        self.signature: tuple[int, int, int] | None = None
        self.load()

    def _current_signature(self) -> tuple[int, int, int] | None:
        try:
            status = self.path.stat()
        except FileNotFoundError:
            return None
        return (status.st_ino, status.st_mtime_ns, status.st_size)

    def load(self) -> None:
        self.signature = self._current_signature()
        if self.signature is None:
            self.accounts = []
            return
        with self.path.open("r", encoding="utf-8") as handle:
            self.accounts = parse_accounts(json.load(handle))

    def reload_if_changed(self) -> bool:
        """Picks up changes another process made; returns whether there were any."""
        if self._current_signature() == self.signature:
            return False
        self.load()
        return True

    def find(self, alias: str) -> GoogleAccount:
        for account in self.accounts:
            if account.alias == alias:
                return account
        raise CredentialsError(f"no account named {alias!r}")

    def find_by_email(self, email: str) -> GoogleAccount | None:
        return next((account for account in self.accounts if account.email == email), None)

    def _change(self, mutate: Callable[[], None]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.path.with_name(self.path.name + ".lock")
        with lock_path.open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.load()
            mutate()
            payload = {
                "accounts": [
                    {
                        "alias": account.alias,
                        "email": account.email,
                        "masterToken": account.master_token,
                        "devices": {device: {"gsfId": gsf_id}
                                    for device, gsf_id in account.gsf_ids.items()},
                    }
                    for account in self.accounts
                ]
            }
            temporary = self.path.with_name(self.path.name + ".tmp")
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, indent=2)
            os.replace(temporary, self.path)
            self.signature = self._current_signature()

    def ensure_unused(self, alias: str, email: str | None = None) -> None:
        if any(account.alias == alias for account in self.accounts):
            raise CredentialsError(f"alias {alias!r} is already used")
        if email is not None and self.find_by_email(email) is not None:
            raise CredentialsError(f"{email} is already added")

    def add(self, alias: str, email: str, master_token: str) -> None:
        def mutate() -> None:
            self.ensure_unused(alias, email)
            self.accounts.append(GoogleAccount(alias, email, master_token))

        self._change(mutate)

    def replace_master_token(self, alias: str, master_token: str) -> None:
        # Device check-ins belong to the Google account, not the token, so they stay valid.
        self._change(lambda: setattr(self.find(alias), "master_token", master_token))

    def rename(self, alias: str, new_alias: str) -> None:
        def mutate() -> None:
            self.ensure_unused(new_alias)
            self.find(alias).alias = new_alias

        self._change(mutate)

    def remove(self, alias: str) -> None:
        self._change(lambda: self.accounts.remove(self.find(alias)))

    def store_device(self, email: str, device: str, gsf_id: int) -> None:
        def mutate() -> None:
            # The account may have been removed by an `account` command meanwhile.
            account = self.find_by_email(email)
            if account is not None:
                account.gsf_ids[device] = gsf_id

        self._change(mutate)

    def forget_device(self, email: str, device: str) -> None:
        def mutate() -> None:
            account = self.find_by_email(email)
            if account is not None:
                account.gsf_ids.pop(device, None)

        self._change(mutate)
