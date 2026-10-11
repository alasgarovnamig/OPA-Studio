#!/usr/bin/env python3
"""Introspect one OPA binary and print a JSON manifest to stdout.

The manifest records, for the exact binary under test:
  * the CLI command tree and the flags of every command (parsed from --help)
  * the builtin catalogue (when `opa capabilities` exists)
  * which Rego dialects the parser accepts
  * which REST endpoints the server answers and how

Everything is measured, nothing is assumed, so OPA Studio can gate its UI on
facts about the binary instead of on hand-maintained version tables.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

OPA = os.environ.get("OPA_BIN", "/opa/opa")
WORK = tempfile.mkdtemp(prefix="probe-")

DIALECTS = {
    "v1": """package studio.example

default allow := false

allow if {
	input.user == "alice"
}

deny contains msg if {
	input.user == "mallory"
	msg := "mallory is not allowed"
}
""",
    "rego.v1": """package studio.example

import rego.v1

default allow := false

allow if {
	input.user == "alice"
}

deny contains msg if {
	input.user == "mallory"
	msg := "mallory is not allowed"
}
""",
    "future-keywords": """package studio.example

import future.keywords.contains
import future.keywords.if

default allow := false

allow if {
	input.user == "alice"
}

deny contains msg if {
	input.user == "mallory"
	msg := "mallory is not allowed"
}
""",
    "legacy-assign": """package studio.example

default allow = false

allow {
	input.user == "alice"
}

deny[msg] {
	input.user == "mallory"
	msg := "mallory is not allowed"
}
""",
    "legacy": """package studio.example

default allow = false

allow {
	input.user = "alice"
}

deny[msg] {
	input.user = "mallory"
	msg = "mallory is not allowed"
}
""",
    "datalog": """package studio.example

default allow = false

allow :- input.user = "alice"

deny[msg] :- input.user = "mallory", msg = "mallory is not allowed"
""",
    "datalog-noinput": """package studio.example

admins = ["alice"]

allow :- admins[_] = "alice"

deny[msg] :- admins[_] = "mallory", msg = "mallory is not allowed"
""",
}


def run(args, timeout=30, stdin=None, cwd=None):
    try:
        p = subprocess.run(
            [OPA] + args,
            input=stdin,
            capture_output=True,
            timeout=timeout,
            cwd=cwd or WORK,
            text=True,
        )
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except Exception as e:  # noqa: BLE001
        return -2, "", str(e)


COMMAND_LINE = re.compile(r"^\s{2}([a-z][a-z0-9-]*)\s+(.*)$")
FLAG_LINE = re.compile(
    r"^\s+(?:-([A-Za-z0-9]), )?--([A-Za-z0-9][A-Za-z0-9_.-]*)(?:\s+([A-Za-z0-9_{}<>|:,.\[\]-]+))?\s{2,}(.*)$"
)
GO_FLAG_LINE = re.compile(r"^\s+-([A-Za-z0-9_][A-Za-z0-9_.-]*)(?:\s+(\w+))?\s*$")


def parse_commands(text):
    cmds = {}
    in_section = False
    for line in text.splitlines():
        if line.strip() in ("Available Commands:",):
            in_section = True
            continue
        if in_section:
            if not line.strip():
                if cmds:
                    in_section = False
                continue
            m = COMMAND_LINE.match(line)
            if m:
                cmds[m.group(1)] = m.group(2).strip()
            elif not line.startswith(" "):
                in_section = False
    return cmds


def parse_flags(text):
    flags = {}
    section = None
    lines = text.splitlines()
    for i, line in enumerate(lines):
        s = line.strip()
        if s in ("Flags:", "Global Flags:"):
            section = s
            continue
        if section is None:
            continue
        if s.startswith("Use \"") or s.startswith("Additional help"):
            section = None
            continue
        m = FLAG_LINE.match(line)
        if m:
            short, name, typ, desc = m.groups()
            default = None
            dm = re.search(r"\(default (.*)\)\s*$", desc)
            if dm:
                default = dm.group(1)
            flags[name] = {
                "short": short,
                "type": typ or "bool",
                "description": desc.strip(),
                "default": default,
                "global": section == "Global Flags:",
            }
    return flags


def usage_line(text):
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.strip() == "Usage:" and i + 1 < len(lines):
            return lines[i + 1].strip()
    return None


def short_description(text):
    for line in text.splitlines():
        if line.strip():
            return line.strip()
    return ""


def cli_tree():
    rc, out, err = run(["help"])
    text = out + err
    cmds = parse_commands(text)
    if not cmds:
        rc, out, err = run(["--help"])
        cmds = parse_commands(out + err)
    root_flags = parse_flags(text)
    tree = {}
    for name, desc in sorted(cmds.items()):
        if name in ("help", "completion"):
            tree[name] = {"description": desc, "flags": {}, "usage": None, "subcommands": {}}
            continue
        rc, out, err = run([name, "--help"])
        htxt = out + err
        sub = parse_commands(htxt)
        subtree = {}
        for sname, sdesc in sorted(sub.items()):
            if sname == "help":
                continue
            rc2, o2, e2 = run([name, sname, "--help"])
            subtree[sname] = {
                "description": sdesc,
                "usage": usage_line(o2 + e2),
                "flags": parse_flags(o2 + e2),
            }
        tree[name] = {
            "description": desc,
            "long": short_description(htxt),
            "usage": usage_line(htxt),
            "flags": parse_flags(htxt),
            "subcommands": subtree,
        }
    return tree, root_flags


def write(name, content):
    p = os.path.join(WORK, name)
    with open(p, "w") as f:
        f.write(content)
    return p


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def http(method, url, body=None, headers=None, timeout=10):
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
            raw = r.read()
            return r.status, dict(r.headers), raw
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()
    except Exception as e:  # noqa: BLE001
        return 0, {}, str(e).encode()


def as_json(raw):
    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        return None


def keys_of(raw):
    j = as_json(raw)
    if isinstance(j, dict):
        return sorted(j.keys())
    return None


def probe_cli_features(tree, dialect):
    res = {}
    if dialect is None:
        return res
    pol = write("policy.rego", DIALECTS[dialect])
    write("input.json", json.dumps({"user": "alice"}))
    if "eval" in tree:
        rc, out, err = run(["eval", "--format", "json", "-d", "policy.rego", "-i", "input.json", "data.studio.example.allow"])
        j = as_json(out)
        res["eval"] = {"rc": rc, "ok": rc == 0 and j is not None, "result_keys": sorted(j.keys()) if isinstance(j, dict) else None}
    if "fmt" in tree:
        rc, out, err = run(["fmt", "policy.rego"])
        res["fmt"] = {"rc": rc, "ok": rc == 0}
    if "check" in tree:
        rc, out, err = run(["check", "policy.rego"])
        res["check"] = {"rc": rc, "ok": rc == 0}
    if "test" in tree:
        test_src = DIALECTS[dialect].replace("package studio.example", "package studio.example_test", 1)
        test_src = test_src.split("\n\n", 1)[0] + "\n\n"
        imports = ""
        if dialect == "rego.v1":
            imports = "import rego.v1\n\n"
        elif dialect == "future-keywords":
            imports = "import future.keywords.if\n\n"
        body = {
            "v1": 'test_alice_allowed if {\n\tdata.studio.example.allow with input as {"user": "alice"}\n}\n',
            "rego.v1": 'test_alice_allowed if {\n\tdata.studio.example.allow with input as {"user": "alice"}\n}\n',
            "future-keywords": 'test_alice_allowed if {\n\tdata.studio.example.allow with input as {"user": "alice"}\n}\n',
        }.get(dialect, 'test_alice_allowed {\n\tdata.studio.example.allow with input as {"user": "alice"}\n}\n')
        write("policy_test.rego", "package studio.example_test\n\n" + imports + body)
        rc, out, err = run(["test", "-v", "policy.rego", "policy_test.rego"])
        res["test"] = {"rc": rc, "ok": rc == 0, "sample": (out + err)[:400]}
    if "parse" in tree:
        rc, out, err = run(["parse", "policy.rego"])
        res["parse"] = {"rc": rc, "ok": rc == 0}
    if "build" in tree:
        rc, out, err = run(["build", "-o", os.path.join(WORK, "bundle.tar.gz"), "policy.rego"])
        res["build_bundle"] = {"rc": rc, "ok": rc == 0 and os.path.exists(os.path.join(WORK, "bundle.tar.gz"))}
    if "inspect" in tree and res.get("build_bundle", {}).get("ok"):
        rc, out, err = run(["inspect", "--format", "json", "bundle.tar.gz"])
        res["inspect"] = {"rc": rc, "ok": rc == 0}
    if "bench" in tree:
        rc, out, err = run(["bench", "--count", "1", "-d", "policy.rego", "-i", "input.json", "data.studio.example.allow"], timeout=60)
        res["bench"] = {"rc": rc, "ok": rc == 0}
    if "deps" in tree:
        rc, out, err = run(["deps", "-d", "policy.rego", "data.studio.example.allow"])
        res["deps"] = {"rc": rc, "ok": rc == 0}
    return res


def dialect_cli_check(tree, name, src):
    p = write("d_%s.rego" % re.sub(r"\W", "_", name), src)
    if "check" in tree:
        rc, out, err = run(["check", p])
        return rc == 0
    if "parse" in tree:
        rc, out, err = run(["parse", p])
        return rc == 0
    return None


def start_server(tree):
    port = free_port()
    run_flags = tree.get("run", {}).get("flags", {})
    args = [OPA, "run", "--server", "--addr", "127.0.0.1:%d" % port]
    if "log-level" in run_flags:
        args += ["--log-level", "error"]
    log = open(os.path.join(WORK, "server.log"), "w")
    proc = subprocess.Popen(args, stdout=log, stderr=log, cwd=WORK)
    base = "http://127.0.0.1:%d" % port
    for _ in range(300):
        st, _, _ = http("GET", base + "/v1/policies", timeout=2)
        if st:
            return proc, base
        if proc.poll() is not None:
            break
        time.sleep(0.2)
    return proc, None


def probe_server(tree, accepted):
    proc, base = start_server(tree)
    out = {"started": base is not None, "endpoints": {}, "dialects": {}}
    if not base:
        try:
            out["log"] = open(os.path.join(WORK, "server.log")).read()[-2000:]
        except Exception:  # noqa: BLE001
            pass
        proc.kill()
        return out
    E = out["endpoints"]

    def rec(key, method, path, body=None, headers=None, timeout=10, keep_keys=True):
        st, hd, raw = http(method, base + path, body, headers, timeout)
        entry = {"method": method, "path": path, "status": st}
        if keep_keys:
            entry["keys"] = keys_of(raw)
        ct = hd.get("Content-Type") or hd.get("content-type")
        if ct:
            entry["content_type"] = ct
        E[key] = entry
        return st, raw

    def restart(proc):
        proc.kill()
        try:
            proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            pass
        return start_server(tree)

    # Quirk: some releases never release the store write lock after a rejected
    # policy upload (all later writes hang). Detect it on a fresh instance.
    st, _, _ = http("PUT", base + "/v1/policies/broken", "package broken\n\np[[[", {"Content-Type": "text/plain"})
    wst, _, _ = http("PUT", base + "/v1/data/studio_probe", {"ok": True}, timeout=4)
    quirk = st >= 400 and wst == 0
    out["quirks"] = {"write_lock_after_policy_error": quirk}
    proc, base = restart(proc)

    # Dialects accepted by the server's parser (Policy API).
    for name, src in DIALECTS.items():
        if not base:
            break
        st, hd, raw = http("PUT", base + "/v1/policies/dialect_" + name.replace(".", "_"), src.replace("studio.example", "dialect." + re.sub(r"\W", "_", name)), {"Content-Type": "text/plain"})
        out["dialects"][name] = st == 200
        http("DELETE", base + "/v1/policies/dialect_" + name.replace(".", "_"))
        if quirk and st != 200:
            proc, base = restart(proc)

    preferred = next((d for d in DIALECTS if out["dialects"].get(d)), None)
    out["preferred_dialect"] = preferred
    proc, base = restart(proc)
    if not base:
        out["started"] = False
        proc.kill()
        return out
    E = out["endpoints"]

    rec("index", "GET", "/", keep_keys=False)
    rec("health", "GET", "/health")
    rec("health_bundles", "GET", "/health?bundles")
    rec("health_plugins", "GET", "/health?plugins")
    rec("health_live", "GET", "/health/live")
    rec("health_ready", "GET", "/health/ready")
    rec("config", "GET", "/v1/config")
    rec("status", "GET", "/v1/status")
    rec("metrics", "GET", "/metrics", keep_keys=False)
    rec("policies_list", "GET", "/v1/policies")
    if preferred:
        rec("policies_put", "PUT", "/v1/policies/studio", DIALECTS[preferred], {"Content-Type": "text/plain"})
        rec("policies_get", "GET", "/v1/policies/studio")
    rec("data_get", "GET", "/v1/data")
    rec("data_get_input", "POST", "/v1/data/studio/example", {"input": {"user": "alice"}})
    rec("data_get_input_query_param", "GET", "/v1/data/studio/example?input=%7B%22user%22%3A%22alice%22%7D")
    rec("data_explain_full", "GET", "/v1/data/studio/example?explain=full")
    rec("data_explain_notes", "GET", "/v1/data/studio/example?explain=notes")
    rec("data_explain_fails", "GET", "/v1/data/studio/example?explain=fails")
    rec("data_explain_debug", "GET", "/v1/data/studio/example?explain=debug")
    rec("data_metrics", "GET", "/v1/data/studio/example?metrics=true")
    rec("data_instrument", "GET", "/v1/data/studio/example?metrics=true&instrument=true")
    rec("data_provenance", "GET", "/v1/data/studio/example?provenance=true")
    rec("data_strict_builtin_errors", "GET", "/v1/data/studio/example?strict-builtin-errors=true")
    rec("data_pretty", "GET", "/v1/data/studio/example?pretty=true")
    rec("data_put", "PUT", "/v1/data/studio/test", {"a": 1})
    rec("data_put_if_none_match", "PUT", "/v1/data/studio/test2", {"a": 1}, {"If-None-Match": "*"})
    rec("data_patch", "PATCH", "/v1/data/studio/test", [{"op": "add", "path": "/b", "value": 2}])
    rec("data_delete", "DELETE", "/v1/data/studio/test")
    rec("data_webhook_v0", "POST", "/v0/data/studio/example/allow", {"user": "alice"})
    rec("query_get", "GET", "/v1/query?q=x%20%3D%201")
    rec("query_post", "POST", "/v1/query", {"query": "x = 1"})
    rec("query_post_input", "POST", "/v1/query", {"query": "x = input.user", "input": {"user": "alice"}})
    rec("default_decision", "POST", "/", {"user": "alice"})
    rec("compile", "POST", "/v1/compile", {"query": "data.studio.example.allow == true", "input": {}, "unknowns": ["input"]})
    rec("compile_path", "POST", "/v1/compile/studio/example/allow", {"input": {}, "unknowns": ["input.user"]},
        {"Accept": "application/vnd.opa.ucast.all+json"})
    rec("compile_path_sql", "POST", "/v1/compile/studio/example/allow", {"input": {}, "unknowns": ["input.user"]},
        {"Accept": "application/vnd.opa.sql.postgresql+json"})
    rec("data_watch", "GET", "/v1/data/studio?watch", timeout=2)
    rec("pprof", "GET", "/debug/pprof/", keep_keys=False)
    rec("policies_delete", "DELETE", "/v1/policies/studio")
    proc.kill()
    try:
        proc.wait(timeout=5)
    except Exception:  # noqa: BLE001
        pass
    return out


def capabilities(tree):
    if "capabilities" not in tree:
        return None
    rc, out, err = run(["capabilities", "--current"])
    j = as_json(out)
    if not isinstance(j, dict):
        return None
    builtins = []
    for b in j.get("builtins", []):
        decl = b.get("decl", {})
        builtins.append({
            "name": b.get("name"),
            "infix": b.get("infix"),
            "args": [a.get("name") or a.get("type") for a in decl.get("args", [])] if isinstance(decl.get("args"), list) else None,
            "result": (decl.get("result") or {}).get("type") if isinstance(decl.get("result"), dict) else None,
            "nondeterministic": b.get("nondeterministic", False),
            "relation": b.get("relation", False),
            "categories": b.get("categories"),
            "description": b.get("description"),
        })
    return {
        "builtins": builtins,
        "future_keywords": j.get("future_keywords"),
        "features": j.get("features"),
        "wasm_abi_versions": j.get("wasm_abi_versions"),
        "allow_net": j.get("allow_net"),
    }


def main():
    rc, out, err = run(["version"])
    version_text = (out + err).strip()
    info = {}
    for line in version_text.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            info[k.strip()] = v.strip()
    tree, root_flags = cli_tree()
    cli_dialects = {name: dialect_cli_check(tree, name, src) for name, src in DIALECTS.items()}
    server = probe_server(tree, cli_dialects)
    preferred = server.get("preferred_dialect") or next((d for d, ok in cli_dialects.items() if ok), None)
    manifest = {
        "schema": 1,
        "version_output": info,
        "cli": {"commands": tree, "root_flags": root_flags},
        "dialects": {"cli": cli_dialects, "server": server.get("dialects", {})},
        "preferred_dialect": preferred,
        "cli_features": probe_cli_features(tree, preferred),
        "server": {k: v for k, v in server.items() if k != "dialects"},
        "capabilities": capabilities(tree),
    }
    json.dump(manifest, sys.stdout, indent=1, sort_keys=True)
    shutil.rmtree(WORK, ignore_errors=True)


if __name__ == "__main__":
    main()
