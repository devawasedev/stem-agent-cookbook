"""Private stdin-only child for shared_memory_demo.mjs. Never prints tokens or memories."""
import json
import platform
import sys
import time
from stem_client import RESOURCE, StemClient, endpoint


def read_selected_memory(payload):
    """Open a fresh Python MCP session and compare exactly the synthetic note in memory."""
    if not isinstance(payload, dict) or set(payload) != {"url", "accessToken", "allowLocal", "marker", "expectedId", "expectedText"}:
        raise ValueError("Invalid demo input.")
    local = payload["allowLocal"] is True
    target = endpoint(payload["url"], local)
    if (local and (target.scheme != "http" or target.hostname != "127.0.0.1")) or (not local and payload["url"] != RESOURCE):
        raise ValueError("Unexpected demo resource.")
    if type(payload["expectedId"]) is not int or payload["expectedId"] <= 0:
        raise ValueError("Invalid synthetic ID.")
    if not isinstance(payload["marker"], str) or not payload["marker"].startswith("stem-shared-demo-") or len(payload["marker"]) > 100:
        raise ValueError("Invalid synthetic marker.")
    if payload["expectedText"] != payload["marker"] + ": Synthetic project Lantern chooses amber for its demo label.":
        raise ValueError("Unexpected synthetic text.")
    client = StemClient(payload["url"], payload["accessToken"], allow_local=local)
    timings = {}
    try:
        started = time.perf_counter()
        client.initialize()
        timings["pythonInitializeMs"] = round((time.perf_counter() - started) * 1000, 3)
        started = time.perf_counter()
        recalled = client.call("recall", {"query": payload["marker"], "limit": 8})
        timings["pythonRecallMs"] = round((time.perf_counter() - started) * 1000, 3)
        exact = any(item.get("id") == payload["expectedId"] and item.get("text") == payload["expectedText"] for item in recalled.get("results", []))
        return {"ok": exact, "exactSyntheticMatch": exact, "pythonVersion": platform.python_version(), "timings": timings}
    finally:
        client.forget_token()
        payload["accessToken"] = None


if __name__ == "__main__":
    try:
        raw = sys.stdin.buffer.read(16_385)
        if len(raw) > 16_384:
            raise ValueError("Demo input exceeds limit.")
        result = read_selected_memory(json.loads(raw))
        print(json.dumps(result))
        sys.exit(0 if result["ok"] else 1)
    except Exception:
        # Never print exception text, a traceback, input or a server response.
        print(json.dumps({"ok": False, "errorCode": "python_reader_failed"}))
        sys.exit(1)
