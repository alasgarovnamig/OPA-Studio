#!/usr/bin/env python3
"""Build versions/opa-versions.json: every OPA version OPA Studio tracks.

Sources (GitHub REST API, unauthenticated or with $GITHUB_TOKEN):
  * every GitHub release of open-policy-agent/opa (stable and pre-release)
  * every stable git tag that was never turned into a GitHub release but was
    still published as an official Docker image (e.g. v0.13.1, v0.29.0, v0.46.0)

Release-candidate tags that were never published anywhere are excluded.
"""
import json
import os
import re
import sys
import urllib.request

API = "https://api.github.com/repos/open-policy-agent/opa"
SEMVER = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$")


def get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        req.add_header("Authorization", "Bearer " + tok)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def paged(path):
    out, page = [], 1
    while True:
        batch = get("%s/%s?per_page=100&page=%d" % (API, path, page))
        if not batch:
            return out
        out += batch
        page += 1


def semver_key(tag):
    m = SEMVER.match(tag)
    major, minor, patch, pre = m.groups()
    # A pre-release sorts before its final release.
    return (int(major), int(minor), int(patch), 0 if pre else 1, pre or "")


def docker_image_exists(tag):
    url = "https://hub.docker.com/v2/repositories/openpolicyagent/opa/tags/" + tag.lstrip("v")
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status == 200, json.load(r).get("last_updated")
    except Exception:  # noqa: BLE001
        return False, None


def highlights(body, limit=12):
    """Return the section headings and bullet items of a release body.

    Bullets that wrap over several lines are joined; nested bullets are skipped.
    """
    if not body:
        return []
    out = []
    current = None

    def flush():
        nonlocal current
        if current is not None:
            text = re.sub(r"\s+", " ", current).strip()
            text = re.sub(r"\s*\(\[?#\d+\]?(\([^)]*\))?\)", "", text)
            text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
            if len(text) > 200:
                text = text[:197].rstrip() + "..."
            if text and len([o for o in out if o["type"] == "item"]) < limit:
                out.append({"type": "item", "text": text})
        current = None

    for line in body.splitlines():
        s = line.strip()
        if s.startswith("#"):
            flush()
            title = s.lstrip("#").strip()
            if title:
                out.append({"type": "heading", "text": title})
        elif re.match(r"^[-*] ", line):
            flush()
            current = s[2:]
        elif re.match(r"^\s+[-*] ", line):
            flush()  # nested bullet: keep the top level only
        elif s and current is not None:
            current += " " + s
        else:
            flush()
    flush()
    return out[:40]


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "versions/opa-versions.json"
    releases = paged("releases")
    tags = [t["name"] for t in paged("tags")]
    entries = {}
    for r in releases:
        if r.get("draft"):
            continue
        tag = r["tag_name"]
        if not SEMVER.match(tag):
            continue
        entries[tag] = {
            "tag": tag,
            "published_at": r["published_at"],
            "prerelease": bool(r["prerelease"]),
            "github_release": True,
            "release_url": r["html_url"],
            "assets": sorted(a["name"] for a in r["assets"]),
            "highlights": highlights(r.get("body") or ""),
        }
    for tag in tags:
        m = SEMVER.match(tag)
        if not m or tag in entries or m.group(4):
            continue
        exists, updated = docker_image_exists(tag)
        if exists:
            entries[tag] = {
                "tag": tag,
                "published_at": updated,
                "prerelease": False,
                "github_release": False,
                "release_url": "https://github.com/open-policy-agent/opa/tree/" + tag,
                "assets": [],
                "docker_image": "openpolicyagent/opa:" + tag.lstrip("v"),
                "highlights": [],
            }
    ordered = sorted(entries.values(), key=lambda e: semver_key(e["tag"]))
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w") as f:
        json.dump({"source": API, "count": len(ordered), "versions": ordered}, f, indent=1)
        f.write("\n")
    print("wrote %d versions to %s" % (len(ordered), out_path))


if __name__ == "__main__":
    main()
