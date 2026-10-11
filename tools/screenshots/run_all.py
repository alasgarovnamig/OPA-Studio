#!/usr/bin/env python3
"""Run OPA Studio against every OPA release and capture README screenshots.

For each version:
  1. build opa-studio for linux/<arch> with the release's version stamped in,
  2. start it in a container next to the official OPA binary of that release,
  3. seed it (control-plane wiring, bundle, discovery, decisions),
  4. drive the UI with Playwright (shoot.mjs) -> <out>/<version>/*.webp + report.json.

Usage:
  python3 tools/screenshots/run_all.py --cache <opa binary cache> --out <dir> [-j 3] [--only v1,v2]
"""
import argparse
import concurrent.futures
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PKG = "github.com/alasgarovnamig/opa-studio/internal/buildinfo"


def http(method, url, body=None, headers=None, timeout=20):
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        if isinstance(body, (dict, list)):
            data = json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
        else:
            data = body.encode() if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001
        return 0, str(e).encode()


def build(version, arch, outdir):
    dest = os.path.join(outdir, "opa-studio-%s-%s" % (version, arch))
    if os.path.exists(dest):
        return dest
    ldflags = "-s -w -X %s.Version=%s -X %s.OPAVersion=%s -X %s.Commit=%s -X %s.Date=%s" % (
        PKG, version, PKG, version, PKG, os.environ.get("STUDIO_COMMIT", "release"), PKG, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    env = dict(os.environ, CGO_ENABLED="0", GOOS="linux", GOARCH=arch)
    subprocess.run(["go", "build", "-trimpath", "-ldflags", ldflags, "-o", dest, "./cmd/opa-studio"], cwd=ROOT, env=env, check=True)
    return dest


def wait(fn, timeout=90, interval=0.5):
    end = time.time() + timeout
    while time.time() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception:  # noqa: BLE001
            pass
        time.sleep(interval)
    return None


CONFIG_MAP = """services:
  studio:
    url: http://127.0.0.1:9080/cp
decision_logs:
  service: studio
  reporting:
    min_delay_seconds: 1
    max_delay_seconds: 2
status:
  service: studio
"""

CONFIG_LIST = """services:
  - name: studio
    url: http://127.0.0.1:9080/cp
decision_logs:
  service: studio
  reporting:
    min_delay_seconds: 1
    max_delay_seconds: 2
status:
  service: studio
"""

INPUTS = [
    {"user": "alice", "action": "delete", "type": "dog"},
    {"user": "bob", "action": "update", "type": "dog"},
    {"user": "bob", "action": "update", "type": "finance"},
    {"user": "eve", "action": "adopt", "type": "cat"},
    {"user": "eve", "action": "update", "type": "dog"},
    {"user": "mallory", "action": "read", "type": "dog"},
]


def seed(base, manifest, log):
    info = json.loads(http("GET", base + "/api/info")[1])
    run_flags = manifest["cli"]["commands"].get("run", {}).get("flags", {})
    local = json.loads(http("GET", base + "/api/local-opa")[1])
    running = lambda: json.loads(http("GET", base + "/api/local-opa")[1])["state"]["status"] == "running"  # noqa: E731
    if not wait(running, 120):
        log.append("local OPA did not start: %s" % local)
        return
    settings = local["settings"]
    if "config-file" in run_flags:
        for cfg in (CONFIG_MAP, CONFIG_LIST, ""):
            settings["config"] = cfg
            http("PUT", base + "/api/local-opa/settings", settings)
            http("POST", base + "/api/local-opa/restart")
            if wait(running, 60):
                log.append("config: %s" % ("map" if cfg == CONFIG_MAP else "list" if cfg else "none"))
                break
    st, _ = http("POST", base + "/api/control/bundles/app", {"workspace": "default", "revision": manifest["opa"]["version"] + "-demo"})
    log.append("publish bundle: %d" % st)
    disc = {"decision": "studio/discovery", "config": {"bundles": {"app": {"service": "studio", "resource": "bundles/app"}}, "decision_logs": {"service": "studio"}}}
    http("PUT", base + "/api/control/discovery/default", disc)
    ep = manifest["server"]["endpoints"]
    post_input = ep.get("data_get_input", {}).get("status") == 200 and manifest["preferred_dialect"] != "datalog-noinput"
    for inp in INPUTS:
        if post_input:
            http("POST", base + "/api/connections/local/proxy/v1/data/app/rbac/allow", {"input": inp})
        else:
            http("GET", base + "/api/connections/local/proxy/v1/data/app/rbac/allow")
    # Let the decision_logs/status plugins upload.
    time.sleep(5)
    _ = info


def shoot(version, cache, outdir, bindir, node_args):
    meta = json.load(open(os.path.join(cache, version, "meta.json")))
    manifest = json.load(open(os.path.join(ROOT, "versions", "manifests", version + ".json")))
    arch = meta["platform"].split("/")[1]
    studio = build(version, arch, bindir)
    vout = os.path.join(outdir, version)
    os.makedirs(vout, exist_ok=True)
    data = tempfile.mkdtemp(prefix="studio-data-")
    name = "studio-shot-" + version.replace(".", "-")
    subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    cid = subprocess.check_output([
        "docker", "run", "-d", "--name", name, "--platform", meta["platform"],
        "-p", "127.0.0.1::9080",
        "-v", studio + ":/usr/local/bin/opa-studio:ro",
        "-v", os.path.join(cache, version) + ":/opa:ro",
        "-v", data + ":/data",
        "-e", "OPA_STUDIO_OPA_BINARY=/opa/opa",
        "-e", "OPA_STUDIO_DATA_DIR=/data",
        "-e", "OPA_STUDIO_ADDR=:9080",
        "-e", "OPA_STUDIO_LOCAL_OPA_ADDR=127.0.0.1:8181",
        "-e", "OPA_STUDIO_PUBLIC_URL=http://127.0.0.1:9080",
        "--entrypoint", "/usr/local/bin/opa-studio",
        "opa-studio-introspect:" + arch,
    ]).decode().strip()
    log = []
    try:
        port = subprocess.check_output(["docker", "port", cid, "9080/tcp"]).decode().split(":")[-1].strip()
        base = "http://127.0.0.1:" + port
        if not wait(lambda: http("GET", base + "/healthz")[0] == 200, 60):
            raise RuntimeError("studio did not become healthy")
        seed(base, manifest, log)
        p = subprocess.run(["node", os.path.join(HERE, "shoot.mjs"), "--base", base, "--out", vout] + node_args,
                           capture_output=True, text=True, timeout=900)
        log.append(p.stdout.strip() or p.stderr.strip()[-500:])
        ok = p.returncode == 0
    except Exception as e:  # noqa: BLE001
        ok = False
        log.append("error: %s" % e)
    finally:
        logs = subprocess.run(["docker", "logs", cid], capture_output=True, text=True).stderr[-4000:]
        subprocess.run(["docker", "rm", "-f", cid], capture_output=True)
        subprocess.run(["rm", "-rf", data])
    with open(os.path.join(vout, "run.log"), "w") as f:
        f.write("\n".join(log) + "\n---- studio log tail ----\n" + logs)
    return version, ok, log[-1] if log else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only")
    ap.add_argument("--skip-existing", action="store_true")
    ap.add_argument("-j", type=int, default=3)
    ap.add_argument("--node-args", default="")
    a = ap.parse_args()
    subprocess.run(["npx", "vite", "build"], cwd=os.path.join(ROOT, "web"), check=True, capture_output=True)
    versions = [e["tag"] for e in json.load(open(os.path.join(ROOT, "versions", "opa-versions.json")))["versions"]]
    if a.only:
        versions = [v for v in versions if v in a.only.split(",")]
    if a.skip_existing:
        versions = [v for v in versions if not os.path.exists(os.path.join(a.out, v, "report.json"))]
    bindir = tempfile.mkdtemp(prefix="studio-bin-")
    failed = []
    with concurrent.futures.ThreadPoolExecutor(a.j) as ex:
        futs = [ex.submit(shoot, v, a.cache, a.out, bindir, a.node_args.split()) for v in versions]
        for f in concurrent.futures.as_completed(futs):
            v, ok, msg = f.result()
            print(v, "OK" if ok else "FAIL", msg, flush=True)
            if not ok:
                failed.append(v)
    print("failed:", sorted(failed))


if __name__ == "__main__":
    main()
