"""Shim over the unmodified `googleplay-api` submodule.

The upstream package expects `googleplay_pb2.py` next to its own modules and generates it with
whatever `protoc` is installed, which ties the generated code to an unpredictable runtime
version. Extending this package's search path lets the upstream modules be imported as `gpapi.*`
while the generated module lives here, produced by a pinned `grpcio-tools`.

The upstream device list stops at Android 9, so newer device profiles from `devices.properties`
are loaded on top of it.
"""

from pathlib import Path

upstream = Path(__file__).resolve().parents[2] / "googleplay-api" / "gpapi"
if not upstream.is_dir():
    raise ImportError(
        f"googleplay-api submodule missing at {upstream}; run `git submodule update --init`")
__path__.append(str(upstream))

from . import config  # noqa: E402 (resolvable only once the upstream path is added)

config.config.read(Path(__file__).with_name("devices.properties"), encoding="utf-8")
