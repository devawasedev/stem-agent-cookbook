"""Dependency-free JSON-response STEM MCP client. Python 3.9+; no credential persistence."""
import json
import urllib.error
import urllib.request
import uuid
from urllib.parse import urlsplit

RESOURCE = "https://awase.dev/stem"
PROTOCOL_VERSION = "2025-06-18"


def endpoint(value, allow_local=False):
    url = urlsplit(value)
    if not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("Endpoint must not contain credentials, query parameters or a fragment.")
    if url.scheme != "https" and not (allow_local and url.scheme == "http" and url.hostname == "127.0.0.1"):
        raise ValueError("HTTPS required; HTTP is limited to explicit 127.0.0.1 fixtures.")
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, data=None, headers=None, timeout=15):
    """Redirects disabled so bearer credentials cannot follow a redirect to another origin."""
    try:
        req = urllib.request.Request(url, data=data, headers=headers or {})
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=timeout) as response:
            body = response.read(1_048_577)
            if len(body) > 1_048_576:
                raise RuntimeError("Response exceeds the cookbook safety limit.")
            return response.status, response.headers, body
    except urllib.error.HTTPError as exc:
        # Do not include URL, response body, token or auth code in diagnostics.
        code = exc.code
        exc.close()
        raise RuntimeError("HTTP %s; reconnect on 401. Never automatically retry writes." % code) from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError("Connection failed or timed out. Never automatically retry writes.") from None


class StemClient:
    def __init__(self, url=RESOURCE, access_token=None, allow_local=False):
        endpoint(url, allow_local)
        if access_token is not None and (not isinstance(access_token, str) or not access_token.strip() or "\r" in access_token or "\n" in access_token):
            raise ValueError("Invalid in-memory access token.")
        self.url, self._token, self._session, self._id = url, access_token, None, 0

    def rpc(self, method, params=None, notification=False):
        self._id += 1
        msg = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if not notification:
            msg["id"] = self._id
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL_VERSION}
        if self._token:
            headers["Authorization"] = "Bearer " + self._token
        if self._session:
            headers["Mcp-Session-Id"] = self._session
        _, response_headers, raw = request(self.url, json.dumps(msg).encode(), headers)
        if response_headers.get("Mcp-Session-Id"):
            self._session = response_headers["Mcp-Session-Id"]
        if notification and not raw:
            return None
        if "application/json" not in response_headers.get("Content-Type", ""):
            raise RuntimeError("This minimal client requires JSON responses. Use a full SDK for SSE streams.")
        try:
            body = json.loads(raw)
        except ValueError:
            raise RuntimeError("Invalid MCP JSON response.") from None
        if not isinstance(body, dict) or body.get("id") != self._id or body.get("jsonrpc") != "2.0":
            raise RuntimeError("MCP response does not match this request.")
        if "error" in body:
            raise RuntimeError("MCP request was rejected. Check method and arguments.")
        if not isinstance(body.get("result"), dict):
            raise RuntimeError("Missing MCP result.")
        return body["result"]

    def initialize(self):
        result = self.rpc("initialize", {"protocolVersion": PROTOCOL_VERSION, "capabilities": {}, "clientInfo": {"name": "stem-python-cookbook", "version": "1.0.0"}})
        if result.get("protocolVersion") != PROTOCOL_VERSION:
            raise RuntimeError("Server selected a protocol version this minimal client does not implement.")
        self.rpc("notifications/initialized", notification=True)
        return result

    def call(self, name, arguments):
        result = self.rpc("tools/call", {"name": name, "arguments": arguments})
        if result.get("isError"):
            raise RuntimeError("Tool error: check arguments, consent, capacity and permissions. Writes are not retried.")
        if "structuredContent" in result:
            return result["structuredContent"]
        try:
            return json.loads(next(item["text"] for item in result["content"] if item.get("type") == "text"))
        except (ValueError, KeyError, StopIteration, TypeError):
            raise RuntimeError("Expected structured JSON tool result.") from None

    def forget_token(self):
        self._token = self._session = None


def synthetic_workflow(client):
    client.initialize()
    names = {tool["name"] for tool in client.rpc("tools/list")["tools"]}
    if not {"remember", "recall", "graph", "forget"}.issubset(names):
        raise RuntimeError("Required STEM tools unavailable.")
    marker = "stem-python-cookbook-" + uuid.uuid4().hex
    text = marker + ": Synthetic project Lantern chooses amber for its demo label."
    created_id = None
    try:
        saved = client.call("remember", {"text": text, "source": "notes", "type": "decision", "tags": ["cookbook", "synthetic"], "autolink": False})
        if saved.get("ok") is not True or type(saved.get("id")) is not int or saved["id"] <= 0:
            raise RuntimeError("Save returned no valid ID; never guess a cleanup ID.")
        created_id = saved["id"]
        recalled = client.call("recall", {"query": marker, "limit": 8})
        if not any(item["id"] == created_id and item["text"] == text for item in recalled["results"]):
            raise RuntimeError("Synthetic memory was not returned exactly; retrieval may be bounded.")
        graph = client.call("graph", {"limit": 1000})
        result = {"kind": "synthetic-workflow", "saved": True, "recalled": True, "graphContainsCreatedMemory": any(node["id"] == "m%s" % created_id for node in graph["nodes"])}
    finally:
        if created_id is not None:
            try:
                deleted = client.call("forget", {"id": created_id})
                if deleted.get("ok") is not True or deleted.get("forgot") != created_id:
                    raise RuntimeError()
            except Exception:
                raise RuntimeError("Cleanup was not confirmed for synthetic memory ID %s. Inspect that exact ID before retrying." % created_id) from None
    after = client.call("recall", {"query": marker, "limit": 8})
    if any(item["id"] == created_id for item in after["results"]):
        raise RuntimeError("Deleted synthetic memory still appeared in recall.")
    return dict(result, deleteAcknowledged=True, absentFromSubsequentRecall=True)
