"""Google account login for Play.

A one-time credential (the `oauth_token` cookie from Google's EmbeddedSetup page, or a password)
is exchanged for a long-lived master token. Every device session is then created from that master
token alone: an ac2dm token for the device check-in and an androidmarket token for Play requests.
"""

from __future__ import annotations

import requests
from gpapi.googleplay import AuthHTTPAdapter, GooglePlayAPI

auth_url = "https://android.clients.google.com/auth"
embedded_setup_url = "https://accounts.google.com/EmbeddedSetup"
google_signature = "38918a453d07199354f8b19af05ec6562ced5788"
play_services_version = "240913000"

oauth_token_instructions = f"""\
To sign in, get a one-time oauth_token from Google:

  1. Open {embedded_setup_url} in a desktop browser (a private window is easiest).
  2. Sign in with the Google account (its normal password and 2-step verification,
     not an app password).
  3. Accept the terms with "I agree". The page may keep loading forever; that is expected.
  4. Open the developer tools, go to Application (Chrome) or Storage (Firefox) > Cookies >
     https://accounts.google.com and copy the value of the cookie named oauth_token.
     It starts with "oauth2_4/".

The token can be used once and expires within minutes, so paste it right away.
"""


class GoogleLoginError(Exception):
    """Google refused a login step; the message carries Google's error code."""


def parse_auth_response(text: str) -> dict[str, str]:
    values = {}
    for line in text.splitlines():
        key, separator, value = line.partition("=")
        if separator:
            values[key.strip().lower()] = value.strip()
    return values


def oauth_token_credential(oauth_token: str) -> dict[str, str]:
    return {"ACCESS_TOKEN": "1", "Token": oauth_token.strip()}


def password_credential(email: str, password: str) -> dict[str, str]:
    encrypted = GooglePlayAPI().encryptPassword(email, password).decode("ascii")
    return {"EncryptedPasswd": encrypted}


def master_login(email: str, credential: dict[str, str], locale: str) -> str:
    """Adds the account the way Google Play services does and returns its master token."""
    language, _, country = locale.partition("_")
    parameters = {
        "accountType": "HOSTED_OR_GOOGLE",
        "Email": email,
        "has_permission": "1",
        "add_account": "1",
        "get_accountid": "1",
        "service": "ac2dm",
        "source": "android",
        "callerPkg": "com.google.android.gms",
        "callerSig": google_signature,
        "client_sig": google_signature,
        "google_play_services_version": play_services_version,
        "sdk_version": "28",
        "device_country": (country or language).lower(),
        "lang": language,
        # Google started rejecting logins without this field in 2026; "null" is what
        # Play services send on devices where DroidGuard did not run.
        "droidguard_results": "null",
        **credential,
    }
    session = requests.Session()
    session.mount("https://", AuthHTTPAdapter())
    response = session.post(
        auth_url,
        data=parameters,
        headers={"app": "com.google.android.gms", "User-Agent": "GoogleAuth/1.4"},
        timeout=60,
    )
    values = parse_auth_response(response.text)
    token = values.get("token")
    if token:
        return token
    error = values.get("error") or f"HTTP {response.status_code} without a token"
    if error == "BadAuthentication" and "EncryptedPasswd" in credential:
        error += " (Google refuses password logins for this account; use `konmai-downloader login`)"
    elif error == "NeedsBrowser":
        error += f" (finish the sign-in in a browser: {values.get('url', embedded_setup_url)})"
    raise GoogleLoginError(error)


def service_token(api: GooglePlayAPI, email: str, master_token: str, service: str, app: str) -> str:
    parameters = api.deviceBuilder.getLoginParams(email, "")
    parameters["service"] = service
    parameters["app"] = app
    return api.getSecondRoundToken(master_token, parameters)


def open_device(
    device: str,
    locale: str,
    timezone: str,
    email: str,
    master_token: str,
    gsf_id: int | None,
) -> GooglePlayAPI:
    """Returns a ready Play session; checks the device in first when it has no gsfId yet."""
    api = GooglePlayAPI(locale, timezone, device)
    if gsf_id is None:
        ac2dm = service_token(api, email, master_token, "ac2dm", "com.google.android.gms")
        gsf_id = int(api.checkin(email, ac2dm))
    api.gsfId = gsf_id
    api.setAuthSubToken(service_token(api, email, master_token,
                        "androidmarket", "com.android.vending"))
    api.uploadDeviceConfig()
    return api
