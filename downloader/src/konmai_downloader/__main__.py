"""Command line entry point."""

from __future__ import annotations

import argparse
import getpass
import logging
import shutil
import sys
from pathlib import Path

from .config import Config, load_config
from .credentials import Credentials
from .google_account import (
    GoogleLoginError,
    master_login,
    oauth_token_credential,
    oauth_token_instructions,
    open_device,
)
from .host import HostClient, HostError, VariantTask
from .runner import PassSummary, Runner
from .scheduler import run_forever
from .staging import ReleaseDirectory, describe, sanitize_version


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="konmai-downloader")
    parser.add_argument("--config", default="config.json", help="path to config.json")
    commands = parser.add_subparsers(dest="command", required=True)

    run = commands.add_parser("run", help="check every variant and publish updates")
    run.add_argument("--once", action="store_true", help="single pass instead of the daily loop")

    check = commands.add_parser("check", help="check and update a single variant now")
    check.add_argument("variant_id", type=int)

    publish = commands.add_parser(
        "publish", help="publish local files as a release of a manual variant")
    publish.add_argument("package_name")
    publish.add_argument("variant")
    publish.add_argument("version")
    publish.add_argument("files", nargs="+", type=Path)
    publish.add_argument("--version-code", type=int, default=None)

    commands.add_parser(
        "login", help="sign in to Google with a browser oauth_token and check every device")
    return parser


# A listing that exists on every device profile; reading it proves the session can use Play.
probe_package = "com.android.chrome"


def login(config: Config, credentials: Credentials) -> None:
    google = config.google
    if google is None:
        raise SystemExit("config.json has no google section")
    print(oauth_token_instructions)
    oauth_token = getpass.getpass("oauth_token (input hidden): ").strip()
    if not oauth_token:
        raise SystemExit("no token given")
    try:
        master_token = master_login(
            google.email, oauth_token_credential(oauth_token), google.locale)
    except GoogleLoginError as error:
        raise SystemExit(f"Google refused the token: {error}") from None
    credentials.store_master_token(google.email, master_token)
    print(f"signed in as {google.email}; master token stored in {credentials.path}")

    failed = False
    for device in google.devices:
        try:
            api = open_device(device, google.locale, google.timezone, google.email,
                              master_token, credentials.gsf_id(device))
            credentials.store_device(device, api.gsfId)
            details = api.details(probe_package)["details"]["appDetails"]
            print(f"  {device}: ok (gsfId {api.gsfId:x}, "
                  f"{probe_package} {details['versionString']} visible)")
        except Exception as error:
            failed = True
            print(f"  {device}: failed: {error}")
    sys.exit(1 if failed else 0)


def find_task(host: HostClient, variant_id: int | None = None, package_name: str | None = None, slug: str | None = None) -> VariantTask:
    for task in host.variants():
        if variant_id is not None and task.id == variant_id:
            return task
        if package_name is not None and task.package_name == package_name and task.slug == slug:
            return task
    raise SystemExit("variant not found on the host (is it enabled?)")


def publish_files(config, host: HostClient, runner: Runner, arguments: argparse.Namespace) -> None:
    task = find_task(host, package_name=arguments.package_name, slug=arguments.variant)
    version = sanitize_version(arguments.version)
    directory = ReleaseDirectory(config.staging_directory, task.package_name, task.slug, version)
    staged = []
    for source in arguments.files:
        if not source.is_file():
            raise SystemExit(f"not a file: {source}")
        target = directory.path / source.name
        shutil.copy2(source, target)
        staged.append(describe(target))
    runner.publish(task, version, arguments.version_code, staged)
    directory.discard()
    print(f"published {task.package_name}/{task.slug} {version} ({len(staged)} file(s))")


def main() -> None:
    arguments = build_parser().parse_args()
    config = load_config(Path(arguments.config))
    logging.basicConfig(
        level=getattr(logging, config.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    if arguments.command == "login":
        login(config, Credentials(config.credentials_file))
    config.staging_directory.mkdir(parents=True, exist_ok=True)
    host = HostClient(config.host.url, config.host.ingest_token)
    runner = Runner(config, host)
    try:
        if arguments.command == "run":
            if arguments.once:
                summary = runner.run_pass()
                sys.exit(1 if summary.failed and not summary.updated and summary.failed ==
                         summary.checked else 0)
            run_forever(config, host, runner)
        elif arguments.command == "check":
            task = find_task(host, variant_id=arguments.variant_id)
            result = PassSummary()
            runner.process(task, result)
            print(result.text())
            sys.exit(1 if result.failed else 0)
        elif arguments.command == "publish":
            publish_files(config, host, runner, arguments)
    except HostError as error:
        raise SystemExit(f"host error: {error}") from None


if __name__ == "__main__":
    main()
