"""Command line entry point."""

from __future__ import annotations

import argparse
import getpass
import logging
import shutil
import sys
from pathlib import Path

from .config import Config, GoogleConfig, load_config
from .credentials import Credentials, CredentialsError, GoogleAccount
from .google_account import (
    GoogleLoginError,
    master_login,
    oauth_token_credential,
    oauth_token_instructions,
    oldest_first,
    open_device,
    password_credential,
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

    account = commands.add_parser("account", help="manage the Google accounts used for Play")
    account_commands = account.add_subparsers(dest="account_command", required=True)
    account_commands.add_parser("list", help="show every account and its checked-in devices")
    add = account_commands.add_parser(
        "add", help="sign in to a new account and check every default device in")
    add.add_argument("alias", help="short name shown in the dashboard")
    add.add_argument("email")
    login = account_commands.add_parser(
        "login", help="sign in to an existing account again, e.g. after its token was revoked")
    login.add_argument("alias")
    for signing_in in (add, login):
        signing_in.add_argument(
            "--password", action="store_true",
            help="sign in with the account password instead of a browser oauth_token")
    rename = account_commands.add_parser("rename", help="change the alias of an account")
    rename.add_argument("alias")
    rename.add_argument("new_alias")
    remove = account_commands.add_parser("remove", help="forget an account and its token")
    remove.add_argument("alias")
    return parser


# A listing that exists on every device profile; reading it proves the session can use Play.
probe_package = "com.android.chrome"


def sign_in(google: GoogleConfig, email: str, use_password: bool) -> str:
    """Asks for a one-time credential and returns the account's master token."""
    if use_password:
        secret = getpass.getpass(f"password for {email} (input hidden): ")
        credential = password_credential(email, secret)
    else:
        print(oauth_token_instructions)
        secret = getpass.getpass("oauth_token (input hidden): ").strip()
        credential = oauth_token_credential(secret)
    if not secret:
        raise SystemExit("nothing given")
    try:
        return master_login(email, credential, google.locale)
    except GoogleLoginError as error:
        raise SystemExit(f"Google refused the sign-in: {error}") from None


def check_in_devices(google: GoogleConfig, credentials: Credentials, account: GoogleAccount) -> bool:
    """Checks every default device in with the account; returns whether all of them work."""
    working = True
    for device in oldest_first(google.devices):
        try:
            api = open_device(device, google.locale, google.timezone, account.email,
                              account.master_token, account.gsf_ids.get(device))
            credentials.store_device(account.email, device, api.gsfId)
            details = api.details(probe_package)["details"]["appDetails"]
            print(f"  {device}: ok (gsfId {api.gsfId:x}, "
                  f"{probe_package} {details['versionString']} visible)")
        except Exception as error:
            working = False
            print(f"  {device}: failed: {error}")
    return working


def manage_accounts(config: Config, arguments: argparse.Namespace) -> None:
    credentials = Credentials(config.credentials_file)
    command = arguments.account_command
    if command == "list":
        if not credentials.accounts:
            print("no accounts; add one with `konmai-downloader account add ALIAS EMAIL`")
        for account in credentials.accounts:
            devices = ", ".join(sorted(account.gsf_ids)) or "no device checked in"
            print(f"{account.alias}\t{account.email}\t{devices}")
        return
    if command == "rename":
        credentials.rename(arguments.alias, arguments.new_alias)
        print(f"renamed {arguments.alias} to {arguments.new_alias}")
        return
    if command == "remove":
        credentials.remove(arguments.alias)
        print(f"removed {arguments.alias}; variants pinned to it fail until another account is "
              "chosen in the dashboard")
        return
    google = config.google
    if google is None:
        raise SystemExit("config.json has no google section")
    if command == "add":
        # Checked before asking for the one-time token so it is not wasted.
        credentials.ensure_unused(arguments.alias, arguments.email)
        master_token = sign_in(google, arguments.email, arguments.password)
        credentials.add(arguments.alias, arguments.email, master_token)
    else:
        master_token = sign_in(google, credentials.find(arguments.alias).email,
                               arguments.password)
        credentials.replace_master_token(arguments.alias, master_token)
    account = credentials.find(arguments.alias)
    print(f"signed in as {account.email} ({account.alias}); token stored in {credentials.path}")
    sys.exit(0 if check_in_devices(google, credentials, account) else 1)


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
    if config.google is not None and (config.google.email or config.google.password):
        logging.warning("google.email and google.password are ignored; accounts are managed "
                        "with `konmai-downloader account`")
    if arguments.command == "account":
        try:
            manage_accounts(config, arguments)
        except CredentialsError as error:
            raise SystemExit(str(error)) from None
        return
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
