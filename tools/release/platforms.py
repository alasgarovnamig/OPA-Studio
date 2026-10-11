#!/usr/bin/env python3
"""Print the build matrix of a release as JSON (used by .github/workflows/release.yml).

  platforms.py v1.0.0
  {"tag": "v1.0.0", "platforms": "linux/amd64,linux/arm64", "opa_image": "", "binaries": [...],
   "prerelease": false, "latest": false}
"""
import json
import sys

from common import binary_targets, linux_platforms, semver_key, versions


def main(tag):
    vs = versions()
    entry = next((e for e in vs if e["tag"] == tag), None)
    if entry is None:
        sys.exit("unknown OPA version %s" % tag)
    plats, opa_image = linux_platforms(entry)
    bins = [{"os": o, "arch": a} for o, a in binary_targets(entry)]
    if not bins and opa_image:
        bins = [{"os": "linux", "arch": "amd64"}]
    newest = max((e["tag"] for e in vs if not e["prerelease"]), key=semver_key)
    print(json.dumps({
        "tag": tag,
        "platforms": ",".join(plats),
        "opa_image": opa_image or "",
        "binaries": bins,
        "prerelease": bool(entry["prerelease"]),
        "latest": tag == newest,
    }))


if __name__ == "__main__":
    main(sys.argv[1])
