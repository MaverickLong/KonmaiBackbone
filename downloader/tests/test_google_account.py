import stat
from urllib.parse import parse_qs

import pytest
import responses

from konmai_downloader.credentials import Credentials
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
    with pytest.raises(GoogleLoginError, match="konmai-downloader login"):
        master_login("user@gmail.com", password_credential(
            "user@gmail.com", "abcdabcdabcdabcd"), "en_US")
    assert "EncryptedPasswd" in sent_form()


@responses.activate
def test_needs_browser_reports_the_url():
    responses.add(responses.POST, auth_url, status=403,
                  body="Error=NeedsBrowser\nUrl=https://accounts.google.com/x\n")
    with pytest.raises(GoogleLoginError, match="https://accounts.google.com/x"):
        master_login("user@gmail.com", oauth_token_credential("oauth2_4/abc"), "en_US")


def test_credentials_round_trip_and_account_change(tmp_path):
    path = tmp_path / "credentials.json"
    credentials = Credentials(path)
    credentials.store_master_token("a@gmail.com", "aas_et/one")
    credentials.store_device("crackling", 0xABC)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600

    reloaded = Credentials(path)
    assert reloaded.master_token_for("a@gmail.com") == "aas_et/one"
    assert reloaded.master_token_for("b@gmail.com") is None
    assert reloaded.gsf_id("crackling") == 0xABC

    reloaded.store_master_token("a@gmail.com", "aas_et/two")
    assert reloaded.gsf_id("crackling") == 0xABC
    reloaded.store_master_token("b@gmail.com", "aas_et/three")
    assert reloaded.gsf_id("crackling") is None


def test_old_credentials_files_are_ignored(tmp_path):
    path = tmp_path / "credentials.json"
    path.write_text('{"crackling": {"gsfId": 1, "authSubToken": "x"}}')
    credentials = Credentials(path)
    assert credentials.master_token is None
    assert credentials.gsf_id("crackling") is None
