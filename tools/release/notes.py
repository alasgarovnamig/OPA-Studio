#!/usr/bin/env python3
"""Render the GitHub release body for one OPA Studio release.

  notes.py v1.0.0 > notes.md
"""
import sys

from common import DIALECTS, IMAGE, REPO_URL, manifest, versions
from readme import diff_section


def main(tag):
    vs = versions()
    idx = next(i for i, e in enumerate(vs) if e["tag"] == tag)
    entry = vs[idx]
    m = manifest(tag)
    prev = manifest(vs[idx - 1]["tag"]) if idx else None
    print("**OPA Studio %s** — the OPA Studio release for [OPA %s](%s) (released %s)." % (tag, tag, entry["release_url"], (entry.get("published_at") or "")[:10]))
    print()
    print("```bash")
    print("docker run --rm -p 9080:9080 %s:%s" % (IMAGE, tag))
    print("```")
    print()
    print("* Rego dialect: **%s**" % DIALECTS[m["preferred_dialect"]][0])
    print("* README with screenshots for this OPA version: %s/tree/%s#readme" % (REPO_URL, tag))
    print("* Archives below contain `opa-studio` and the matching `opa` binary.")
    print()
    print("## What changed in OPA %s" % tag)
    print()
    print(diff_section(m, prev, entry))


if __name__ == "__main__":
    main(sys.argv[1])
