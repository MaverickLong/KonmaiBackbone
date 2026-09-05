"""Generates src/gpapi/googleplay_pb2.py from the submodule's googleplay.proto.

Run once after `uv sync` (and again after updating the submodule):
    uv run python scripts/generate_protobuf.py
"""

from pathlib import Path

from grpc_tools import protoc

root = Path(__file__).resolve().parents[1]
proto_directory = root / "googleplay-api"
output_directory = root / "src" / "gpapi"

exit_code = protoc.main(
    [
        "protoc",
        f"--proto_path={proto_directory}",
        f"--python_out={output_directory}",
        str(proto_directory / "googleplay.proto"),
    ]
)
if exit_code != 0:
    raise SystemExit(f"protoc failed with {exit_code}")
print(f"generated {output_directory / 'googleplay_pb2.py'}")
