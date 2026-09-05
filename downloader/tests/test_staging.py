import hashlib
import zipfile

import pytest

from konmai_downloader.staging import ReleaseDirectory, kind_for, sanitize_version


def test_sanitize_version_keeps_safe_strings_and_cleans_others():
    assert sanitize_version("4.1.9c") == "4.1.9c"
    assert sanitize_version(" v2.0.0-beta.1 ") == "v2.0.0-beta.1"
    assert sanitize_version("1.0.1 (beta)") == "1.0.1-beta"
    with pytest.raises(ValueError):
        sanitize_version("   ")


def test_kind_for_file_names():
    assert kind_for("com.example_1.0.apk") == "apk"
    assert kind_for("com.example_1.0.apks") == "apks"
    assert kind_for("main.100.com.example.obb") == "obb-main"
    assert kind_for("patch.100.com.example.obb") == "obb-patch"
    assert kind_for("game.7z") == "other"


def test_write_stream_hashes_content(tmp_path):
    directory = ReleaseDirectory(tmp_path, "com.example", "gp", "1.0")
    staged = directory.write_stream("com.example_1.0.apk", [b"abc", b"", b"def"])
    assert staged.size_bytes == 6
    assert staged.sha256 == hashlib.sha256(b"abcdef").hexdigest()
    assert staged.kind == "apk"
    assert staged.path == tmp_path / "com.example" / "gp" / "1.0" / "com.example_1.0.apk"


def test_zip_apks_bundles_and_removes_members(tmp_path):
    directory = ReleaseDirectory(tmp_path, "com.example", "gp", "1.0")
    base = directory.write_stream("base.apk", [b"base"])
    split = directory.write_stream("config.arm64.apk", [b"split"])
    bundle = directory.zip_apks("com.example_1.0.apks", [base.path, split.path])
    assert bundle.kind == "apks"
    assert not base.path.exists() and not split.path.exists()
    with zipfile.ZipFile(bundle.path) as archive:
        assert sorted(archive.namelist()) == ["base.apk", "config.arm64.apk"]
        assert archive.getinfo("base.apk").compress_type == zipfile.ZIP_STORED


def test_release_directory_starts_empty(tmp_path):
    first = ReleaseDirectory(tmp_path, "com.example", "gp", "1.0")
    first.write_stream("stale.apk", [b"x"])
    second = ReleaseDirectory(tmp_path, "com.example", "gp", "1.0")
    assert list(second.path.iterdir()) == []
