import stat
from urllib.parse import parse_qs

import pytest
import responses

from konmai_downloader.credentials import Credentials, CredentialsError
from konmai_downloader.google_account import (
    GoogleLoginError,
    auth_url,
    master_login,
    oauth_token_credential,
    parse_auth_response,
    password_credential,
)


def sent_form() -> dict[str, str]:
    body = responses.calls[-1].request.body
    text = body if isinstance(body, str) else body.decode()
    return {key: values[0] for key, values in parse_qs(text).items()}


def test_parse_auth_response_lowercases_keys():
    assert parse_auth_response("Token=aas_et/abc==\nAuth=xyz\n\nbroken line") == {
        "token": "aas_et/abc==",
        "auth": "xyz",
    }


@responses.activate
def test_oauth_token_is_exchanged_for_a_master_token():
    responses.add(responses.POST, auth_url, body="Token=aas_et/master\nAuth=ac2dm\n")
    token = master_login("user@gmail.com", oauth_token_credential(" oauth2_4/abc "), "ja_JP")
    assert token == "aas_et/master"
    form = sent_form()
    assert form["ACCESS_TOKEN"] == "1"
    assert form["Token"] == "oauth2_4/abc"
    assert form["service"] == "ac2dm"
    assert form["droidguard_results"] == "null"
    assert (form["lang"], form["device_country"]) == ("ja", "jp")
    assert "EncryptedPasswd" not in form


@responses.activate
def test_refused_password_login_points_to_the_login_command():
    responses.add(responses.POST, auth_url, status=403, body="Error=BadAuthentication\n")
    with pytest.raises(GoogleLoginError, match="konmai-downloader account add"):
        master_login("user@gmail.com", password_credential(
            "user@gmail.com", "abcdabcdabcdabcd"), "en_US")
    assert "EncryptedPasswd" in sent_form()


@responses.activate
def test_needs_browser_reports_the_url():
    responses.add(responses.POST, auth_url, status=403,
                  body="Error=NeedsBrowser\nUrl=https://accounts.google.com/x\n")
    with pytest.raises(GoogleLoginError, match="https://accounts.google.com/x"):
        master_login("user@gmail.com", oauth_token_credential("oauth2_4/abc"), "en_US")


def test_credentials_manage_accounts_and_persist(tmp_path):
    path = tmp_path / "credentials.json"
    credentials = Credentials(path)
    credentials.add("main", "a@gmail.com", "aas_et/one")
    credentials.add("spare", "b@gmail.com", "aas_et/two")
    credentials.store_device("a@gmail.com", "crackling", 0xABC)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600

    with pytest.raises(CredentialsError):
        credentials.add("main", "c@gmail.com", "aas_et/three")
    with pytest.raises(CredentialsError):
        credentials.add("other", "a@gmail.com", "aas_et/three")
    with pytest.raises(CredentialsError):
        credentials.rename("spare", "main")

    credentials.replace_master_token("main", "aas_et/four")
    credentials.rename("spare", "backup")
    reloaded = Credentials(path)
    assert [(account.alias, account.email) for account in reloaded.accounts] == [
        ("main", "a@gmail.com"), ("backup", "b@gmail.com")]
    assert reloaded.find("main").master_token == "aas_et/four"
    # A new token keeps the device check-ins, which belong to the account.
    assert reloaded.find("main").gsf_ids == {"crackling": 0xABC}

    reloaded.remove("backup")
    assert reloaded.find_by_email("b@gmail.com") is None
    with pytest.raises(CredentialsError):
        reloaded.find("backup")


def test_changes_from_another_process_are_kept(tmp_path):
    path = tmp_path / "credentials.json"
    daemon = Credentials(path)
    command = Credentials(path)
    command.add("main", "a@gmail.com", "aas_et/one")
    assert daemon.accounts == []
    # The daemon writes a check-in after the command added an account it has not loaded yet.
    daemon.store_device("a@gmail.com", "walleye", 7)
    assert Credentials(path).find("main").gsf_ids == {"walleye": 7}

    command.add("spare", "b@gmail.com", "aas_et/two")
    assert daemon.reload_if_changed()
    assert not daemon.reload_if_changed()
    assert [account.alias for account in daemon.accounts] == ["main", "spare"]


def test_single_account_files_become_one_account(tmp_path):
    path = tmp_path / "credentials.json"
    path.write_text('{"email": "player@gmail.com", "masterToken": "aas_et/x", '
                    '"devices": {"walleye": {"gsfId": 5}}}')
    account = Credentials(path).find("player")
    assert (account.email, account.master_token, account.gsf_ids) == (
        "player@gmail.com", "aas_et/x", {"walleye": 5})


def test_old_credentials_files_are_ignored(tmp_path):
    path = tmp_path / "credentials.json"
    path.write_text('{"crackling": {"gsfId": 1, "authSubToken": "x"}}')
    assert Credentials(path).accounts == []
