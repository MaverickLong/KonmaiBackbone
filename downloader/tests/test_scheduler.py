import pytest

from konmai_downloader import scheduler
from konmai_downloader.config import Config, HostConfig
from konmai_downloader.host import VariantTask


class Stop(Exception):
    pass


def task(variant_id: int, due: bool) -> VariantTask:
    return VariantTask(variant_id, "com.example", f"v{variant_id}", "V", {"type": "manual"}, None, None, due)


class FakeHost:
    def __init__(self, tasks):
        self.tasks = tasks
        self.heartbeats = []

    def variants(self):
        return self.tasks

    def heartbeat(self, phase, *_):
        self.heartbeats.append(phase)


class FakeRunner:
    def __init__(self):
        self.passes = []

    def run_pass(self, tasks=None):
        self.passes.append([task.id for task in tasks])


def run_one_poll(monkeypatch, tmp_path, tasks):
    def stop(_seconds):
        raise Stop()

    monkeypatch.setattr(scheduler.time, "sleep", stop)
    config = Config(host=HostConfig(ingest_token="x" * 16), staging_directory=tmp_path,
                    credentials_file=tmp_path / "credentials.json")
    host, runner = FakeHost(tasks), FakeRunner()
    with pytest.raises(Stop):
        scheduler.run_forever(config, host, runner)
    return host, runner


def test_only_due_variants_are_checked(monkeypatch, tmp_path):
    _, runner = run_one_poll(monkeypatch, tmp_path, [task(1, False), task(2, True), task(3, True)])
    assert runner.passes == [[2, 3]]


def test_nothing_due_only_reports_idle(monkeypatch, tmp_path):
    host, runner = run_one_poll(monkeypatch, tmp_path, [task(1, False)])
    assert runner.passes == []
    assert host.heartbeats == ["idle", "idle"]
