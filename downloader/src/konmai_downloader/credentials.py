"""Cached Google login state, stored with mode 0600.

Holds the account's master token and the gsfId each emulated device received at check-in.
Play tokens are short-lived and minted from the master token on demand, so they are not stored.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


class Credentials:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.email: str | None = None
        self.master_token: str | None = None
        self.devices: dict[str, int] = {}
        if path.exists():
            with path.open("r", encoding="utf-8") as handle:
                raw = json.load(handle)
            self.email = raw.get("email")
            self.master_token = raw.get("masterToken")
            self.devices = {
                device: int(entry["gsfId"]) for device, entry in raw.get("devices", {}).items()
            }

    def master_token_for(self, email: str) -> str | None:
        return self.master_token if self.email == email else None

    def store_master_token(self, email: str, master_token: str) -> None:
        # Devices were checked in with the previous account, so they must check in again.
        if email != self.email:
            self.devices.clear()
        self.email = email
        self.master_token = master_token
        self.save()

    def gsf_id(self, device: str) -> int | None:
        return self.devices.get(device)

    def store_device(self, device: str, gsf_id: int) -> None:
        self.devices[device] = gsf_id
        self.save()

    def forget_device(self, device: str) -> None:
        if self.devices.pop(device, None) is not None:
            self.save()

    def save(self) -> None:
        payload = {
            "email": self.email,
            "masterToken": self.master_token,
            "devices": {device: {"gsfId": gsf_id} for device, gsf_id in self.devices.items()},
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
