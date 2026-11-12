import json
from pathlib import Path

import responses

from konmai_downloader.config import Config, HostConfig
from konmai_downloader.host import HostClient
from konmai_downloader import runner as runner_module
from konmai_downloader.runner import Runner
from konmai_downloader.sources import Compatibility, RemoteVersion, SourceError

host_url = "http://host.test"


def make_runner(tmp_path: Path) -> Runner:
    config = Config(
        host=HostConfig(url=host_url, ingest_token="x" * 16),
        staging_directory=tmp_path / "staging",
        credentials_file=tmp_path / "credentials.json",
    )
    return Runner(config, HostClient(host_url, config.host.ingest_token))


def variant_list(active=None):
    return [
        {
            "id": 7,
            "packageName": "com.example",
            "slug": "gh",
            "name": "GitHub",
            "source": {"type": "github", "repository": "o/n", "assetPattern": "\\.apk$"},
            "activeRelease": active,
            "checkDue": True,
        }
    ]


def bodies_sent_to(path: str) -> list[dict]:
    return [
        json.loads(call.request.body)
        for call in responses.calls
        if call.request.url == host_url + path
    ]


@responses.activate
def test_pass_publishes_new_release_and_reports(tmp_path):
    responses.add(responses.GET, f"{host_url}/api/ingest/variants",
                  json=variant_list({"version": "1.0", "versionCode": None}))
    responses.add(responses.POST, f"{host_url}/api/ingest/heartbeat", status=204)
    responses.add(responses.PUT, f"{host_url}/api/ingest/google-play", status=204)
    responses.add(
        responses.GET,
        "https://api.github.com/repos/o/n/releases/latest",
        json={"tag_name": "1.1", "assets": [
            {"name": "a.apk", "browser_download_url": "https://dl/a.apk"}]},
    )
    responses.add(responses.GET, "https://dl/a.apk", body=b"new build")
    responses.add(responses.POST, f"{host_url}/api/ingest/releases", status=201, json={"id": 1})
    responses.add(responses.POST, f"{host_url}/api/ingest/variants/7/check-result", status=204)

    summary = make_runner(tmp_path).run_pass()

    assert (summary.checked, summary.updated, summary.failed) == (1, 1, 0)
    body = bodies_sent_to("/api/ingest/releases")[0]
    assert body["version"] == "1.1" and body["files"][0]["fileName"] == "a.apk"
    assert body["files"][0]["path"].startswith(str(tmp_path / "staging"))
    assert bodies_sent_to("/api/ingest/variants/7/check-result")[0]["status"] == "updated"
    assert not (tmp_path / "staging" / "com.example" / "gh" / "1.1").exists()


@responses.activate
def test_pass_reports_up_to_date_and_failures(tmp_path):
    responses.add(responses.GET, f"{host_url}/api/ingest/variants",
                  json=variant_list({"version": "1.1", "versionCode": None}))
    responses.add(responses.POST, f"{host_url}/api/ingest/heartbeat", status=204)
    responses.add(responses.PUT, f"{host_url}/api/ingest/google-play", status=204)
    responses.add(responses.GET, "https://api.github.com/repos/o/n/releases/latest",
                  json={"tag_name": "1.1", "assets": []})
    responses.add(responses.POST, f"{host_url}/api/ingest/variants/7/check-result", status=204)
    summary = make_runner(tmp_path).run_pass()
    assert (summary.updated, summary.failed) == (0, 0)
    assert bodies_sent_to("/api/ingest/variants/7/check-result")[0]["status"] == "up_to_date"

    responses.replace(responses.GET, "https://api.github.com/repos/o/n/releases/latest", status=404)
    summary = make_runner(tmp_path).run_pass()
    assert summary.failed == 1
    assert bodies_sent_to("/api/ingest/variants/7/check-result")[-1]["status"] == "failed"


@responses.activate
def test_pass_reports_accounts_compatibility_and_alerts(tmp_path, monkeypatch):
    responses.add(responses.GET, f"{host_url}/api/ingest/variants",
                  json=variant_list({"version": "1.1", "versionCode": 11}))
    responses.add(responses.POST, f"{host_url}/api/ingest/heartbeat", status=204)
    responses.add(responses.PUT, f"{host_url}/api/ingest/google-play", status=204)
    responses.add(responses.POST, f"{host_url}/api/ingest/variants/7/check-result", status=204)

    class FakeSource:
        def __init__(self, outcome):
            self.outcome = outcome

        def check(self, _task):
            if isinstance(self.outcome, Exception):
                raise self.outcome
            return self.outcome

    runner = make_runner(tmp_path)
    runner.context.credentials.add("main", "a@gmail.com", "aas_et/x")
    outcome = RemoteVersion("1.1", 11, Compatibility("walleye", "a@gmail.com"))
    monkeypatch.setattr(runner_module, "create_source", lambda *_: FakeSource(outcome))
    runner.run_pass()
    outcome = SourceError("walleye/main: item not found", alert=True)
    runner.run_pass()

    reports = bodies_sent_to("/api/ingest/google-play")
    assert len(reports) == 1
    assert reports[0]["accounts"] == [{"alias": "main", "email": "a@gmail.com", "devices": []}]
    assert any(device["codename"] == "walleye" and device["apiLevel"] == 28
               for device in reports[0]["devices"])
    results = bodies_sent_to("/api/ingest/variants/7/check-result")
    assert results[0]["compatibility"] == {"device": "walleye", "account": "a@gmail.com"}
    assert not results[0]["alert"]
    assert results[1]["status"] == "failed" and results[1]["alert"]
