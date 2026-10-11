#!/usr/bin/env python3
"""Validate the example workspace on every OPA release (see validate_template.py).

Usage: validate_all.py --cache <binary cache> --out <report.json> [-j 4] [--only v1,v2]
"""
import argparse
import concurrent.futures
import json
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))


def validate(v, cache, gen):
    m = json.load(open(os.path.join(ROOT, "versions", "manifests", v + ".json")))
    meta = json.load(open(os.path.join(cache, v, "meta.json")))
    ws = tempfile.mkdtemp(prefix="tmpl-")
    try:
        subprocess.run([gen, "-dialect", m["preferred_dialect"], "-out", ws], check=True)
        p = subprocess.run([
            "docker", "run", "--rm", "--platform", meta["platform"], "--entrypoint", "python3",
            "-v", os.path.join(cache, v) + ":/opa:ro", "-v", ws + ":/ws",
            "-v", os.path.join(HERE, "validate_template.py") + ":/validate.py:ro",
            "-v", os.path.join(ROOT, "versions", "manifests", v + ".json") + ":/manifest.json:ro",
            "opa-studio-introspect:" + meta["platform"].split("/")[1], "/validate.py", "/opa/opa", "/ws", "/manifest.json",
        ], capture_output=True, text=True, timeout=900)
        if p.returncode != 0:
            return v, {"error": p.stderr[-800:]}
        return v, json.loads(p.stdout)
    finally:
        shutil.rmtree(ws, ignore_errors=True)


def ok(r):
    if "error" in r:
        return False
    for k in ("check", "test", "eval"):
        if k in r and r[k]["rc"] != 0:
            return False
    s = r.get("server", {})
    return s.get("started") and "decision" in s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only")
    ap.add_argument("-j", type=int, default=4)
    a = ap.parse_args()
    gen = os.path.join(tempfile.mkdtemp(), "gentemplate")
    subprocess.run(["go", "build", "-o", gen, "./tools/gentemplate"], check=True, cwd=ROOT)
    versions = [e["tag"] for e in json.load(open(os.path.join(ROOT, "versions", "opa-versions.json")))["versions"]]
    if a.only:
        versions = [v for v in versions if v in a.only.split(",")]
    results = {}
    with concurrent.futures.ThreadPoolExecutor(a.j) as ex:
        for v, r in ex.map(lambda v: validate(v, a.cache, gen), versions):
            results[v] = r
            print(v, "OK" if ok(r) else "FAIL", flush=True)
    json.dump(results, open(a.out, "w"), indent=1)
    bad = [v for v, r in results.items() if not ok(r)]
    print("failed:", bad)


if __name__ == "__main__":
    main()
