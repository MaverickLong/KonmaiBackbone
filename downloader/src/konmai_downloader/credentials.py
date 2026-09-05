"""Cached Google login state (gsfId / authSubToken) per device, stored with mode 0600."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class DeviceLogin:
    gsf_id: int
    auth_sub_token: str


class Credentials:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.logins: dict[str, DeviceLogin] = {}
        if path.exists():
            with path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
            for device, entry in raw.items():
                self.logins[device] = DeviceLogin(int(entry["gsfId"]), str(entry["authSubToken"]))

    def get(self, device: str) -> DeviceLogin | None:
        return self.logins.get(device)

    def store(self, device: str, login: DeviceLogin) -> None:
        self.logins[device] = login
        self.save()

    def forget(self, device: str) -> None:
        if device in self.logins:
            del self.logins[device]
            self.save()

    def save(self) -> None:
        payload = {
            device: {"gsfId": login.gsf_id, "authSubToken": login.auth_sub_token}
            for device, login in self.logins.items()
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
