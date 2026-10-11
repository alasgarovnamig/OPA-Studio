#!/usr/bin/env python3
"""Download every OPA release and introspect it inside Docker.

Usage:
  python3 tools/introspect/run_all.py --versions versions/opa-versions.json \
      --cache /path/to/binary/cache --out versions/manifests [--only v1.0.0,...] [-j 3]

Binaries come from the official GitHub release assets. Tags that were never
published as a GitHub release (but were pushed to Docker Hub) are extracted
from the official openpolicyagent/opa image instead.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGE = "opa-studio-introspect"

# Preference order: native arm64 (fast on Apple silicon / Graviton), then amd64.
ASSET_PREFERENCE = [
    ("opa_linux_arm64_static", "linux/arm64"),
    ("opa_linux_arm64", "linux/arm64"),
    ("opa_linux_amd64_static", "linux/amd64"),
    ("opa_linux_amd64", "linux/amd64"),
]


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def build_images():
    for plat in ("linux/arm64", "linux/amd64"):
        tag = IMAGE + ":" + plat.split("/")[1]
        sh(["docker", "build", "-q", "--platform", plat, "-t", tag, HERE], stdout=subprocess.DEVNULL)


def download(url, dest):
    tmp = dest + ".part"
    with urllib.request.urlopen(url, timeout=300) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)


def verify_sha256(path, url):
    try:
        with urllib.request.urlopen(url + ".sha256", timeout=60) as r:
            expected = r.read().decode().split()[0]
    except Exception:  # noqa: BLE001 - older releases ship no checksum file
        return None
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    if h.hexdigest() != expected:
        raise RuntimeError("sha256 mismatch for %s" % path)
    return expected


def fetch(entry, cache):
    v = entry["tag"]
    vdir = os.path.join(cache, v)
    os.makedirs(vdir, exist_ok=True)
    meta_path = os.path.join(vdir, "meta.json")
    if os.path.exists(meta_path) and os.path.exists(os.path.join(vdir, "opa")):
        return json.load(open(meta_path))
    assets = set(entry.get("assets", []))
    for asset, plat in ASSET_PREFERENCE:
        if asset in assets:
            url = "https://github.com/open-policy-agent/opa/releases/download/%s/%s" % (v, asset)
            dest = os.path.join(vdir, "opa")
            download(url, dest)
            os.chmod(dest, 0o755)
            sha = verify_sha256(dest, url)
            meta = {"source": "github-release", "asset": asset, "url": url, "platform": plat, "sha256": sha}
            json.dump(meta, open(meta_path, "w"))
            return meta
    # No release asset: pull the official image and copy the binary out.
    image = "openpolicyagent/opa:" + v.lstrip("v")
    plat = "linux/amd64"
    sh(["docker", "pull", "-q", "--platform", plat, image], stdout=subprocess.DEVNULL)
    cid = subprocess.check_output(["docker", "create", "--platform", plat, image]).decode().strip()
    try:
        sh(["docker", "cp", cid + ":/opa", os.path.join(vdir, "opa")])
    finally:
        subprocess.run(["docker", "rm", cid], stdout=subprocess.DEVNULL)
    meta = {"source": "docker-image", "image": image, "platform": plat, "sha256": None}
    json.dump(meta, open(meta_path, "w"))
    return meta


def probe(entry, cache, out_dir):
    v = entry["tag"]
    dest = os.path.join(out_dir, v + ".json")
    if os.path.exists(dest) and not os.environ.get("FORCE"):
        return v, "cached"
    meta = fetch(entry, cache)
    vdir = os.path.join(cache, v)
    tag = IMAGE + ":" + meta["platform"].split("/")[1]
    p = subprocess.run(
        ["docker", "run", "--rm", "--platform", meta["platform"], "-v", vdir + ":/opa:ro", tag],
        capture_output=True, text=True, timeout=1800,
    )
    if p.returncode != 0:
        return v, "FAILED: " + p.stderr[-500:]
    manifest = json.loads(p.stdout)
    manifest["opa"] = {
        "version": v,
        "published_at": entry.get("published_at"),
        "prerelease": entry.get("prerelease", False),
        "github_release": entry.get("github_release", True),
        "binary": meta,
    }
    with open(dest, "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
        f.write("\n")
    return v, "ok"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--versions", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only")
    ap.add_argument("-j", type=int, default=3)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    entries = json.load(open(a.versions))["versions"]
    if a.only:
        wanted = set(a.only.split(","))
        entries = [e for e in entries if e["tag"] in wanted]
    build_images()
    failed = []
    with concurrent.futures.ThreadPoolExecutor(a.j) as ex:
        futs = {ex.submit(probe, e, a.cache, a.out): e["tag"] for e in entries}
        for f in concurrent.futures.as_completed(futs):
            try:
                v, st = f.result()
            except Exception as e:  # noqa: BLE001
                v, st = futs[f], "FAILED: %s" % e
            print(v, st, flush=True)
            if st.startswith("FAILED"):
                failed.append(v)
    if failed:
        print("failed:", " ".join(sorted(failed)))
        sys.exit(1)


if __name__ == "__main__":
    main()
