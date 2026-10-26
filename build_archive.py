"""Deterministic, allowlisted cookbook ZIP. No recursive directory ingestion."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = (
    ".gitignore", "README.md", "package.json", "stem-client.mjs", "oauth.mjs", "smoke.mjs",
    "stem_client.py", "oauth_client.py", "smoke.py", "fixture-server.mjs",
    "fixtures/tool-catalog.json", "evals/golden-prompts.json", "evals/evaluate.mjs",
    "evals/README.md", "evals/baseline.json", "recipes/README.md", "recipes/fastmcp_recall.py",
    "test/cookbook.test.mjs", "test/evaluate.test.mjs", "test/archive.test.mjs",
    "build_archive.py", "record_baseline.mjs",
)


def build(output):
    entries = {}
    for name in sorted(FILES):
        source = ROOT / name
        if source.is_symlink() or not source.is_file() or ROOT not in source.resolve().parents:
            raise ValueError("Missing, symlinked or escaping allowlist input: " + name)
        entries[name] = source.read_bytes()
    sums = "".join(hashlib.sha256(data).hexdigest() + "  " + name + "\n" for name, data in entries.items())
    entries["SHA256SUMS"] = sums.encode()
    output = Path(output)
    if output.is_symlink() or output.resolve() in [(ROOT / name).resolve() for name in FILES]:
        raise ValueError("Refusing symlink output or overwrite of a cookbook source file.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo("stem-agent-cookbook/" + name, date_time=(2026, 10, 25, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return {"path": str(output.resolve()), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "files": len(entries), "bytes": output.stat().st_size}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(ROOT / "dist" / "stem-agent-cookbook.zip"))
    args = parser.parse_args()
    print(json.dumps(build(args.output)))
