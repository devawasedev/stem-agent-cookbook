"""STEM-specific PKCE/DCR tutorial. Tokens/codes/verifier stay in memory; callback logging is disabled."""
import base64
import hashlib
import hmac
import json
import secrets
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit, parse_qs, urlencode
from stem_client import RESOURCE, endpoint, request


def json_request(url, value=None, form=False):
    data = None if value is None else (urlencode(value).encode() if form else json.dumps(value).encode())
    _, _, raw = request(url, data, {"Content-Type": "application/x-www-form-urlencoded" if form else "application/json"})
    try:
        return json.loads(raw)
    except ValueError:
        raise RuntimeError("Invalid OAuth JSON response.") from None


def authorize(resource=RESOURCE, allow_local=False, on_authorization_url=print, timeout=180):
    target = endpoint(resource, allow_local)
    origin = "%s://%s" % (target.scheme, target.netloc)
    protected = json_request(origin + "/.well-known/oauth-protected-resource" + target.path)
    if protected.get("resource") != resource or origin not in protected.get("authorization_servers", []) or "stem" not in protected.get("scopes_supported", []):
        raise RuntimeError("Unexpected STEM resource metadata.")
    metadata = json_request(origin + "/.well-known/oauth-authorization-server")
    if metadata.get("issuer") != origin:
        raise RuntimeError("Unexpected OAuth issuer.")
    for key in ("authorization_endpoint", "registration_endpoint", "token_endpoint", "revocation_endpoint"):
        if key == "revocation_endpoint" and not metadata.get(key):
            continue
        candidate = endpoint(metadata[key], allow_local)
        if "%s://%s" % (candidate.scheme, candidate.netloc) != origin:
            raise RuntimeError("OAuth endpoints must use the pinned STEM issuer.")
    if "S256" not in metadata.get("code_challenge_methods_supported", []) or "none" not in metadata.get("token_endpoint_auth_methods_supported", []):
        raise RuntimeError("S256 and public-client authentication are required.")
    verifier = secrets.token_urlsafe(32)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(32)
    event, callback = threading.Event(), {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log callback URL, code or query parameters.

        def do_GET(self):
            incoming = urlsplit(self.path)
            params = parse_qs(incoming.query)
            def value(key):
                return params.get(key, [""])[0]
            valid = incoming.path == "/callback" and hmac.compare_digest(value("state").encode(), state.encode()) and (not value("iss") or value("iss") == origin)
            if not valid or event.is_set():
                status, text = 400, "Invalid or consumed callback."
            else:
                callback["code"] = value("code") if not value("error") else None
                event.set()
                status, text = 200, "Authorization received. Return to your terminal."
            self.send_response(status)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(text.encode())

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    redirect = "http://127.0.0.1:%s/callback" % server.server_address[1]
    try:
        registered = json_request(metadata["registration_endpoint"], {"client_name": "STEM Python cookbook synthetic smoke", "redirect_uris": [redirect], "token_endpoint_auth_method": "none", "grant_types": ["authorization_code"], "response_types": ["code"]})
        if not isinstance(registered.get("client_id"), str) or not registered["client_id"] or registered.get("token_endpoint_auth_method", "none") != "none" or redirect not in registered.get("redirect_uris", []):
            raise RuntimeError("Unexpected OAuth public-client registration.")
        auth_url = metadata["authorization_endpoint"] + "?" + urlencode({"client_id": registered["client_id"], "redirect_uri": redirect, "response_type": "code", "scope": "stem", "resource": resource, "code_challenge": challenge, "code_challenge_method": "S256", "state": state})
        on_authorization_url(auth_url)
        if not event.wait(timeout) or not callback.get("code"):
            raise RuntimeError("Authorization denied, incomplete or timed out.")
        tokens = json_request(metadata["token_endpoint"], {"grant_type": "authorization_code", "code": callback["code"], "client_id": registered["client_id"], "redirect_uri": redirect, "code_verifier": verifier, "resource": resource}, form=True)
        if not isinstance(tokens.get("access_token"), str) or not tokens["access_token"] or str(tokens.get("token_type", "")).lower() != "bearer" or set(tokens.get("scope", "stem").split()) != {"stem"}:
            raise RuntimeError("Unexpected OAuth token response or granted scope.")
        return Grant(tokens, metadata.get("revocation_endpoint"), registered["client_id"])
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class Grant:
    def __init__(self, tokens, revocation_endpoint, client_id):
        self.access_token = tokens["access_token"]
        self._refresh_token = tokens.get("refresh_token")
        self._revocation_endpoint, self._client_id = revocation_endpoint, client_id

    def revoke(self):
        ok = bool(self._revocation_endpoint)
        try:
            if not self._revocation_endpoint:
                return False
            for token, hint in ((self.access_token, "access_token"), (self._refresh_token, "refresh_token")):
                if token:
                    try:
                        request(self._revocation_endpoint, urlencode({"token": token, "token_type_hint": hint, "client_id": self._client_id}).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
                    except Exception:
                        ok = False
            return ok
        finally:
            self.access_token = self._refresh_token = None
