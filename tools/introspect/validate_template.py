#!/usr/bin/env python3
"""Validate the example workspace against one OPA binary (runs inside Docker).

Usage: validate_template.py <opa> <workspace-dir> <manifest.json>
Prints a JSON report: CLI check/test/eval results and a live server decision.
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request

opa, ws, manifest_path = sys.argv[1:4]
m = json.load(open(manifest_path))
cmds = m["cli"]["commands"]
report = {}


def run(args):
    p = subprocess.run([opa] + args, capture_output=True, text=True, cwd=ws, timeout=120)
    return {"rc": p.returncode, "out": (p.stdout + p.stderr)[-1500:]}


def files(include_tests=True):
    out = []
    for root, _, names in os.walk(ws):
        for n in names:
            rel = os.path.relpath(os.path.join(root, n), ws)
            if n.startswith("input"):
                continue
            if n.endswith(".rego") and (include_tests or not n.endswith("_test.rego")):
                out.append(rel)
            elif n == "data.json":
                out.append(rel)
    return sorted(out)


if "check" in cmds:
    report["check"] = run(["check"] + files())
if "test" in cmds:
    report["test"] = run(["test", "-v"] + files())
if "eval" in cmds:
    args = ["eval"]
    flags = cmds["eval"]["flags"]
    if "format" in flags:
        args += ["--format", "json"]
    if flags.get("data", {}).get("type") == "string":
        args += ["-d", "."]  # single-valued --data in early releases
    else:
        for f in files(False):
            args += ["-d", f]
    if os.path.exists(os.path.join(ws, "input.json")) and "input" in cmds["eval"]["flags"]:
        args += ["-i", "input.json"]
    args.append("data.app.rbac.allow")
    report["eval"] = run(args)

s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
proc = subprocess.Popen([opa, "run", "--server", "--addr", "127.0.0.1:%d" % port] + files(False), cwd=ws, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
base = "http://127.0.0.1:%d" % port
ok = False
for _ in range(200):
    try:
        urllib.request.urlopen(base + "/v1/policies", timeout=1).read()
        ok = True
        break
    except Exception:
        if proc.poll() is not None:
            break
        time.sleep(0.2)
server = {"started": ok}
if ok:
    body = json.dumps({"input": json.load(open(os.path.join(ws, "input.json")))}).encode() if os.path.exists(os.path.join(ws, "input.json")) else None
    try:
        if body and m["server"]["endpoints"]["data_get_input"]["status"] == 200:
            r = urllib.request.urlopen(urllib.request.Request(base + "/v1/data/app/rbac/allow", data=body, method="POST", headers={"Content-Type": "application/json"}), timeout=10)
        else:
            r = urllib.request.urlopen(base + "/v1/data/app/rbac/allow", timeout=10)
        server["decision"] = r.read().decode()[:300]
    except Exception as e:  # noqa: BLE001
        server["error"] = str(e)
else:
    server["log"] = proc.stdout.read().decode()[-1500:] if proc.poll() is not None else ""
proc.kill()
report["server"] = server
print(json.dumps(report))
