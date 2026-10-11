"""Shared helpers for the release tooling (README, release notes, platforms)."""
import json
import os
import re
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REPO = "alasgarovnamig/OPA-Studio"
REPO_URL = "https://github.com/" + REPO
IMAGE = "ghcr.io/alasgarovnamig/opa-studio"

DIALECTS = {
    "v1": ("Rego v1", "OPA 1.x syntax: `if` / `contains` are mandatory, `:=` for defaults, `import rego.v1` not needed."),
    "rego.v1": ("Rego with `import rego.v1`", "The v1 syntax is opted into per module with `import rego.v1`; v0 syntax keeps working."),
    "future-keywords": ("Rego with `future.keywords`", "`if`, `contains`, `in` and `every` are opted into with `import future.keywords.*`."),
    "legacy-assign": ("Classic Rego", "Rule bodies in braces, `:=` assignment and `==` comparison; no `if` / `contains` keywords."),
    "legacy": ("Classic Rego (unification)", "Rule bodies in braces with `=` unification; no `:=` / `==` yet."),
    "datalog": ("Datalog-style Rego", "Rules are written as `head :- body` and the `input` document is available."),
    "datalog-noinput": ("Datalog-style Rego (no input)", "Rules are written as `head :- body`; there is no `input` document yet, requests are modelled as data."),
}

# Measured REST features: (label, endpoint key, path shown in docs).
API_FEATURES = [
    ("Policy API — list", "policies_list", "GET /v1/policies"),
    ("Policy API — create/update", "policies_put", "PUT /v1/policies/{id}"),
    ("Policy API — delete", "policies_delete", "DELETE /v1/policies/{id}"),
    ("Data API — read root document", "data_get", "GET /v1/data"),
    ("Data API — decision with input", "data_get_input", "POST /v1/data/{path}"),
    ("Data API — write document", "data_put", "PUT /v1/data/{path}"),
    ("Data API — create-only (If-None-Match)", "data_put_if_none_match", "PUT /v1/data/{path}"),
    ("Data API — JSON Patch", "data_patch", "PATCH /v1/data/{path}"),
    ("Data API — delete", "data_delete", "DELETE /v1/data/{path}"),
    ("Data API — v0 webhook", "data_webhook_v0", "POST /v0/data/{path}"),
    ("Explanations (explain=full)", "data_explain_full", "?explain=full"),
    ("Query API — GET", "query_get", "GET /v1/query?q="),
    ("Query API — POST with input", "query_post", "POST /v1/query"),
    ("Compile API — partial evaluation", "compile", "POST /v1/compile"),
    ("Compile API — data filtering (UCAST/SQL)", "compile_path", "POST /v1/compile/{path}"),
    ("Health API", "health", "GET /health"),
    ("Health — bundles & plugins", "health_plugins", "GET /health?bundles&plugins"),
    ("Health — custom live/ready policies", "health_live", "GET /health/live, /health/ready"),
    ("Prometheus metrics", "metrics", "GET /metrics"),
    ("Config API", "config", "GET /v1/config"),
    ("Status API", "status", "GET /v1/status"),
]

SEMVER = re.compile(r"^v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$")


def semver_key(tag):
    m = SEMVER.match(tag)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3)), 0 if m.group(4) else 1, m.group(4) or "")


def versions():
    return json.load(open(os.path.join(ROOT, "versions", "opa-versions.json")))["versions"]


def manifest(tag):
    return json.load(open(os.path.join(ROOT, "versions", "manifests", tag + ".json")))


def available(m, key):
    e = m.get("server", {}).get("endpoints", {}).get(key)
    if not e:
        return False
    st = e.get("status", 0)
    if st in (0, 405):
        return False
    if st == 404:
        return "json" in (e.get("content_type") or "")
    return True


def commands(m):
    return {k: v for k, v in m["cli"]["commands"].items() if k not in ("help", "completion")}


def builtin_names(m):
    caps = m.get("capabilities") or {}
    return sorted(b["name"] for b in caps.get("builtins", []) if b.get("name"))


def linux_platforms(entry):
    """Docker platforms an image can be built for, and the OPA image fallback."""
    assets = set(entry.get("assets", []))
    plats = []
    if {"opa_linux_amd64", "opa_linux_amd64_static"} & assets:
        plats.append("linux/amd64")
    if {"opa_linux_arm64", "opa_linux_arm64_static"} & assets:
        plats.append("linux/arm64")
    opa_image = None
    if not entry.get("github_release", True) or not plats:
        opa_image = "openpolicyagent/opa:" + entry["tag"].lstrip("v")
        plats = ["linux/amd64"]
    return plats, opa_image


def binary_targets(entry):
    """OS/arch pairs for which the OPA release ships binaries."""
    assets = set(entry.get("assets", []))
    out = []
    for os_, arch, names in [
        ("linux", "amd64", ["opa_linux_amd64", "opa_linux_amd64_static"]),
        ("linux", "arm64", ["opa_linux_arm64", "opa_linux_arm64_static"]),
        ("darwin", "amd64", ["opa_darwin_amd64"]),
        ("darwin", "arm64", ["opa_darwin_arm64", "opa_darwin_arm64_static"]),
        ("windows", "amd64", ["opa_windows_amd64.exe"]),
    ]:
        if any(n in assets for n in names):
            out.append((os_, arch))
    return out


_template_cache = {}


def template_policy(dialect):
    """The example policy for a dialect, rendered by tools/gentemplate."""
    if dialect in _template_cache:
        return _template_cache[dialect]
    d = tempfile.mkdtemp()
    subprocess.run(["go", "run", "./tools/gentemplate", "-dialect", dialect, "-out", d], cwd=ROOT, check=True)
    src = open(os.path.join(d, "app", "rbac.rego")).read()
    _template_cache[dialect] = src
    return src
