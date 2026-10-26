import argparse
import json
import sys
from stem_client import RESOURCE, StemClient, synthetic_workflow, endpoint
from oauth_client import authorize

parser = argparse.ArgumentParser(description="Save/recall/inspect/delete only a synthetic memory. Live mode creates an OAuth client and requests browser sign-in.")
mode = parser.add_mutually_exclusive_group(required=True)
mode.add_argument("--fixture", help="Explicit http://127.0.0.1:PORT/stem transport fixture")
mode.add_argument("--live-synthetic", action="store_true")
args = parser.parse_args()
grant = client = None
try:
    if args.fixture:
        local = endpoint(args.fixture, True)
        if local.scheme != "http" or local.hostname != "127.0.0.1":
            raise ValueError("Fixture mode accepts only an explicit HTTP 127.0.0.1 endpoint.")
    if args.live_synthetic:
        print("Open the following URL in your browser. Select manual saving for this test connection.")
        grant = authorize()
    client = StemClient(RESOURCE if args.live_synthetic else args.fixture, grant.access_token if grant else None, allow_local=bool(args.fixture))
    result = synthetic_workflow(client)
    print(json.dumps(dict(result, evidence="live-authorized-synthetic-workflow" if args.live_synthetic else "local-transport-fixture-only", modelEvaluation=False)))
except Exception as error:
    print(str(error), file=sys.stderr)
    exit_code = 1
finally:
    if client:
        client.forget_token()
    if grant:
        print(json.dumps({"oauthRevocationAcknowledged": grant.revoke(), "registrationMayRemain": True}))
sys.exit(locals().get("exit_code", 0))
