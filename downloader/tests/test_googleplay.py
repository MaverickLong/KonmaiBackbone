from pathlib import Path

import pytest

from konmai_downloader.config import Config, GoogleConfig, HostConfig
from konmai_downloader.credentials import Credentials
from konmai_downloader.host import VariantTask
from konmai_downloader.sources import Compatibility, SourceContext, SourceError
from konmai_downloader.sources.googleplay import GooglePlaySource
from konmai_downloader.staging import ReleaseDirectory


class FakePlay:
    """Answers like Play for the (device, email) pairs in `working`, fails for the others."""

    def __init__(self, device: str, email: str, working: set, downloadable: set):
        self.pair = (device, email)
        self.working = working
        self.downloadable = downloadable

    def details(self, _package_name):
        if self.pair not in self.working:
            raise RuntimeError("item not found")
        return {"details": {"appDetails": {"versionString": "2.0", "versionCode": 20}}}

    def download(self, _package_name, versionCode, expansion_files):
        if self.pair not in self.downloadable:
            raise RuntimeError("incompatible device")
        return {"docId": "com.example", "file": {"data": iter([b"apk"])}}


@pytest.fixture
def play(tmp_path: Path, monkeypatch):
    credentials = Credentials(tmp_path / "credentials.json")
    credentials.add("first", "one@gmail.com", "aas_et/1")
    credentials.add("second", "two@gmail.com", "aas_et/2")
    config = Config(
        host=HostConfig(ingest_token="x" * 16),
        staging_directory=tmp_path,
        credentials_file=credentials.path,
        # Configured newest first; tried oldest first.
        google=GoogleConfig(devices=["walleye", "crackling"]),
    )
    attempts = []
    behaviour = {"working": set(), "downloadable": set()}

    def fake_api(_self, account, device, _locale, _timezone):
        attempts.append((device, account.alias))
        return FakePlay(device, account.email, behaviour["working"], behaviour["downloadable"])

    monkeypatch.setattr(GooglePlaySource, "_api", fake_api)
    source = GooglePlaySource(SourceContext(config, credentials))
    return source, attempts, behaviour


def task(**source) -> VariantTask:
    return VariantTask(1, "com.example", "gp", "GP", {"type": "googleplay", **source}, None, None, True)


def test_devices_oldest_first_each_with_every_account(play):
    source, attempts, behaviour = play
    behaviour["working"] = {("walleye", "two@gmail.com")}
    remote = source.check(task())
    assert attempts == [("crackling", "first"), ("crackling", "second"),
                        ("walleye", "first"), ("walleye", "second")]
    assert remote.compatibility == Compatibility("walleye", "two@gmail.com")


def test_one_pinned_parameter_only_iterates_the_other(play):
    source, attempts, behaviour = play
    behaviour["working"] = {("walleye", "one@gmail.com")}
    source.check(task(device="walleye"))
    assert attempts == [("walleye", "first")]

    attempts.clear()
    behaviour["working"] = {("walleye", "two@gmail.com")}
    source.check(task(account="two@gmail.com"))
    assert attempts == [("crackling", "second"), ("walleye", "second")]


def test_pinned_combination_failure_alerts_without_trying_others(play):
    source, attempts, behaviour = play
    behaviour["working"] = {("crackling", "one@gmail.com")}
    with pytest.raises(SourceError) as failure:
        source.check(task(device="walleye", account="two@gmail.com"))
    assert failure.value.alert
    assert attempts == [("walleye", "second")]


def test_unknown_pinned_account_fails(play):
    source, attempts, _ = play
    with pytest.raises(SourceError, match="gone@gmail.com is not signed in") as failure:
        source.check(task(device="walleye", account="gone@gmail.com"))
    assert failure.value.alert
    assert attempts == []
    with pytest.raises(SourceError) as failure:
        source.check(task(account="gone@gmail.com"))
    assert not failure.value.alert


def test_fetch_continues_after_the_combination_the_check_found(play, tmp_path):
    source, attempts, behaviour = play
    behaviour["working"] = {("crackling", "two@gmail.com")}
    behaviour["downloadable"] = {("walleye", "one@gmail.com")}
    variant = task()
    remote = source.check(variant)
    assert remote.compatibility == Compatibility("crackling", "two@gmail.com")
    attempts.clear()
    files = source.fetch(variant, remote, ReleaseDirectory(tmp_path, "com.example", "gp", "2.0"))
    assert attempts == [("crackling", "second"), ("walleye", "first")]
    assert remote.compatibility == Compatibility("walleye", "one@gmail.com")
    assert [file.file_name for file in files] == ["com.example_2.0.apk"]
