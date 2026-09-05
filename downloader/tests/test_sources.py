from pathlib import Path

import responses

from konmai_downloader.config import Config, HostConfig
from konmai_downloader.credentials import Credentials
from konmai_downloader.host import VariantTask
from konmai_downloader.sources import RemoteVersion, SourceContext, create_source, is_newer
from konmai_downloader.staging import ReleaseDirectory


def make_context(tmp_path: Path) -> SourceContext:
    config = Config(
        host=HostConfig(ingest_token="x" * 16),
        staging_directory=tmp_path,
        credentials_file=tmp_path / "credentials.json",
        github_token="token",
    )
    return SourceContext(config, Credentials(config.credentials_file))


def make_task(source: dict, active_version=None, active_version_code=None) -> VariantTask:
    return VariantTask(1, "com.example", "gp", "GP", source, active_version, active_version_code, False)


def test_is_newer_prefers_version_codes_then_strings():
    assert is_newer(RemoteVersion("1.0", 10), make_task({}))
    assert is_newer(RemoteVersion("1.0", 11), make_task({}, "1.0", 10))
    assert not is_newer(RemoteVersion("1.1", 10), make_task({}, "1.0", 10))
    assert is_newer(RemoteVersion("1.1"), make_task({}, "1.0", 10))
    assert not is_newer(RemoteVersion("1.0"), make_task({}, "1.0", None))


@responses.activate
def test_github_check_and_fetch(tmp_path):
    responses.get(
        "https://api.github.com/repos/owner/name/releases/latest",
        json={
            "tag_name": "v1.2.3",
            "assets": [
                {"name": "app-arm64.apk", "browser_download_url": "https://dl/app-arm64.apk"},
                {"name": "app-x86.apk", "browser_download_url": "https://dl/app-x86.apk"},
            ],
        },
    )
    responses.get("https://dl/app-arm64.apk", body=b"arm64 build")
    source = create_source({"type": "github"}, make_context(tmp_path))
    task = make_task({"type": "github", "repository": "owner/name",
                     "assetPattern": "arm64.*\\.apk$"})
    remote = source.check(task)
    assert remote == RemoteVersion("v1.2.3", None)
    files = source.fetch(task, remote, ReleaseDirectory(
        tmp_path, "com.example", "gp", remote.version))
    assert [file.file_name for file in files] == ["app-arm64.apk"]
    assert files[0].size_bytes == len(b"arm64 build")
    assert responses.calls[-1].request.headers["authorization"] == "Bearer token"


@responses.activate
def test_arcaea_check_and_fetch(tmp_path):
    responses.get(
        "https://webapi.lowiro.com/webapi/serve/static/bin/arcaea/apk",
        json={"success": True, "value": {"version": "4.1.9c", "url": "https://dl/arcaea.apk"}},
    )
    responses.get("https://dl/arcaea.apk", body=b"apk")
    source = create_source({"type": "arcaea"}, make_context(tmp_path))
    task = make_task({"type": "arcaea"})
    remote = source.check(task)
    assert remote.version == "4.1.9c"
    files = source.fetch(task, remote, ReleaseDirectory(
        tmp_path, "com.example", "gp", remote.version))
    assert files[0].file_name == "com.example_4.1.9c.apk"


def test_manual_never_updates(tmp_path):
    source = create_source({"type": "manual"}, make_context(tmp_path))
    assert source.check(make_task({"type": "manual"})) is None
