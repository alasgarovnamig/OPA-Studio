#!/usr/bin/env python3
"""Generate the README of the OPA Studio release that targets one OPA version.

Everything version specific is derived from measured data:
  * versions/manifests/<v>.json   (CLI, dialect, REST endpoints, built-ins)
  * versions/opa-versions.json    (release date, assets, upstream highlights)
  * <shots>/report.json + *.webp  (UI tour captured against that OPA release)
  * template validation report    (example workspace checked on that release)

Usage:
  readme.py --version v1.0.0 --shots docs/screenshots --validation report.json --out README.md
"""
import argparse
import json
import os

from common import (API_FEATURES, DIALECTS, IMAGE, REPO_URL, available, binary_targets, builtin_names,
                    commands, linux_platforms, manifest, template_policy, versions)

GUIDES = {
    "01-dashboard": [
        "Pick the OPA server in the top bar (the managed **Local OPA** is selected by default).",
        "The cards show the server version, policy and data counts, health, configuration and the latest decisions.",
        "**Refresh** re-probes the server; a warning appears when its version differs from the one this release targets.",
    ],
    "02-workspace": [
        "Workspaces hold policies, tests, `data.json`/`data.yaml` documents and `input*.json` files; select one in the top bar.",
        "Click a file to edit it, <kbd>Ctrl/⌘</kbd>+<kbd>Enter</kbd> saves. **Format** and **Check** run `opa fmt` / `opa check` on the open file.",
        "**Deploy to OPA** uploads data (`PUT /v1/data`) and policies (`PUT /v1/policies`) to any connection; **Pull from OPA** does the reverse.",
        "**Import bundle** / **Export bundle** move the workspace in and out as an OPA bundle (`.tar.gz`).",
    ],
    "03-evaluate": [
        "Write a query, choose an input file and press **Evaluate** (<kbd>Ctrl/⌘</kbd>+<kbd>Enter</kbd>).",
        "Only flags supported by this OPA release are offered; anything else goes into *Additional flags*.",
        "The command preview at the top is the exact `opa eval` invocation and can be copied to a terminal.",
    ],
    "04-test": [
        "**Run tests** executes every `test_` rule of the workspace.",
        "Results are parsed into a table; enable coverage to see per-file coverage and uncovered lines.",
    ],
    "05-check-format": [
        "**Check** compiles all modules and lists errors with their location; strict mode adds the strict checks of this release.",
        "The **opa fmt** tab shows a diff of unformatted files or formats and saves them.",
    ],
    "06-policies": [
        "Lists the modules stored on the server; select one to view or edit its source and AST.",
        "**New** creates a module from a starter written in this release's Rego dialect; **Delete** removes it.",
    ],
    "07-data": [
        "Click a node in the document tree to target its path.",
        "GET / POST (with input) evaluate documents; PUT, PATCH (JSON Patch) and DELETE modify base documents.",
        "Explanations, metrics, instrumentation and provenance are rendered in their own tabs when the release supports them.",
    ],
    "08-query": [
        "Ad-hoc queries run through `/v1/query`; each line is an expression and variable bindings are shown as a table.",
        "The *Default decision* tab posts the request body to `POST /` when the release supports it.",
    ],
    "09-compile": [
        "Declare unknowns (e.g. `input.action`) and **Compile** to get the residual queries of partial evaluation.",
        "On releases with data filtering a second tab translates rules into UCAST or SQL filters.",
    ],
    "10-health": [
        "**Check** calls `/health` with the selected bundle/plugin requirements (and the custom live/ready checks when available).",
        "*Install on server* uploads a `system.health` policy for custom liveness and readiness.",
    ],
    "11-config-status": [
        "The Config API shows the runtime configuration (credentials are redacted by OPA).",
        "The Status API lists plugin states and bundle activations.",
    ],
    "12-metrics": [
        "Studio parses the Prometheus exposition of `/metrics`; filter families and click one to inspect its samples.",
    ],
    "13-bundles": [
        "**Build** runs `opa build` on the workspace (targets, entrypoints, optimisation, revision and signing when supported).",
        "Built bundles can be downloaded or published to the Studio control plane; **Inspect**, **Sign** and **Verify** work on any archive.",
    ],
    "14-control-plane": [
        "Studio implements the OPA management APIs: bundle and discovery downloads, decision log and status uploads.",
        "The *OPA config* tab generates the agent configuration; *Apply to Local OPA* wires the managed server to Studio.",
        "Decision logs stream live; click a row for input, result, labels and metrics.",
    ],
    "15-local-opa": [
        "Start, stop or restart the managed `opa run --server` process and change its address, loaded workspace, flags and configuration file.",
        "Process output is streamed live.",
    ],
    "16-repl": [
        "**Start session** launches `opa run` with the workspace loaded; type Rego and REPL commands (`show`, `trace`, `metrics`, …).",
    ],
    "17-command-builder": [
        "Every command, subcommand and flag of this OPA binary is rendered as a form, generated from the measured manifest.",
        "Runs execute in a sandboxed copy of the workspace; output files can be collected and downloaded.",
    ],
    "18-api-console": [
        "Choose a preset (operations unavailable in this release are dimmed) or craft any request: method, path, query, headers and body.",
    ],
    "19-builtins": [
        "Searchable catalogue of the built-in functions of this release with signatures, descriptions and categories.",
    ],
    "20-compatibility": [
        "The measured capability matrix of all OPA releases; select a release to see its commands, endpoints and changes.",
    ],
}


def table(rows, header):
    out = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def tick(b):
    return "✅" if b else "—"


def flag_names(m, cmd):
    return set(m["cli"]["commands"].get(cmd, {}).get("flags", {}).keys())


def diff_section(m, prev, entry):
    lines = []
    if prev is None:
        lines.append("This is the **first public release of OPA**. Everything below is new.")
        return "\n".join(lines)
    pv = prev["opa"]["version"]
    cur_c, prev_c = commands(m), commands(prev)
    added_c = sorted(set(cur_c) - set(prev_c))
    removed_c = sorted(set(prev_c) - set(cur_c))
    rows = []
    for c in added_c:
        rows.append(("➕ CLI command", "`opa %s` — %s" % (c, cur_c[c]["description"])))
    for c in removed_c:
        rows.append(("➖ CLI command", "`opa %s`" % c))
    for c in sorted(set(cur_c) & set(prev_c)):
        a = sorted(flag_names(m, c) - flag_names(prev, c))
        r = sorted(flag_names(prev, c) - flag_names(m, c))
        if a:
            rows.append(("➕ flags of `opa %s`" % c, ", ".join("`--%s`" % f for f in a)))
        if r:
            rows.append(("➖ flags of `opa %s`" % c, ", ".join("`--%s`" % f for f in r)))
    for label, key, path in API_FEATURES:
        if available(m, key) and not available(prev, key):
            rows.append(("➕ REST API", "%s (`%s`)" % (label, path)))
        if available(prev, key) and not available(m, key):
            rows.append(("➖ REST API", "%s (`%s`)" % (label, path)))
    if m.get("preferred_dialect") != prev.get("preferred_dialect"):
        rows.append(("🔤 Rego dialect", "%s → **%s**" % (DIALECTS[prev["preferred_dialect"]][0], DIALECTS[m["preferred_dialect"]][0])))
    nb, pb = builtin_names(m), builtin_names(prev)
    if nb and pb:
        a = sorted(set(nb) - set(pb))
        r = sorted(set(pb) - set(nb))
        if a:
            rows.append(("➕ built-in functions", ", ".join("`%s`" % x for x in a)))
        if r:
            rows.append(("➖ built-in functions", ", ".join("`%s`" % x for x in r)))
    elif nb and not pb:
        rows.append(("➕ capabilities", "`opa capabilities` reports %d built-in functions" % len(nb)))
    q, pq = m["server"].get("quirks", {}), prev["server"].get("quirks", {})
    for k, v in q.items():
        if v and not pq.get(k):
            rows.append(("⚠️ quirk", k.replace("_", " ")))
        if not v and pq.get(k):
            rows.append(("✔️ fixed", k.replace("_", " ")))
    lines.append("Measured difference between OPA **%s** and **%s**:" % (pv, m["opa"]["version"]))
    lines.append("")
    if rows:
        lines.append(table(rows, ["Change", "Details"]))
    else:
        lines.append("_No change of the CLI surface, REST API, Rego dialect or built-in catalogue was measured — this is a bug-fix / internal release. OPA Studio is rebuilt and re-verified against it all the same._")
    hl = entry.get("highlights") or []
    if hl:
        lines.append("")
        lines.append("<details><summary><b>Upstream release note highlights</b></summary>")
        lines.append("")
        for h in hl[:30]:
            if h["type"] == "heading":
                lines.append("")
                lines.append("**%s**" % h["text"])
                lines.append("")
            else:
                lines.append("- %s" % h["text"].replace("|", "\\|"))
        lines.append("")
        lines.append("Full notes: %s" % entry["release_url"])
        lines.append("")
        lines.append("</details>")
    return "\n".join(lines)


def render(version, shots_rel, report, validation):
    vs = versions()
    idx = next(i for i, e in enumerate(vs) if e["tag"] == version)
    entry = vs[idx]
    prev_tag = vs[idx - 1]["tag"] if idx > 0 else None
    next_tag = vs[idx + 1]["tag"] if idx + 1 < len(vs) else None
    m = manifest(version)
    prev = manifest(prev_tag) if prev_tag else None
    dialect = m["preferred_dialect"]
    dname, ddesc = DIALECTS[dialect]
    date = (entry.get("published_at") or "")[:10]
    cmds = commands(m)
    plats, opa_image = linux_platforms(entry)
    bins = binary_targets(entry)
    vo = m.get("version_output", {})
    quirks = [k for k, v in m["server"].get("quirks", {}).items() if v]
    nbuiltins = len(builtin_names(m))
    short = version.lstrip("v")

    L = []
    w = L.append
    w('<p align="center"><img src="docs/assets/logo.svg" width="84" alt="OPA Studio"></p>')
    w("")
    w('<h1 align="center">OPA Studio <code>%s</code></h1>' % version)
    w("")
    w('<p align="center"><b>The web UI for every Open Policy Agent operation — built, tested and documented for <a href="%s">OPA %s</a>.</b></p>' % (entry["release_url"], version))
    w("")
    badges = [
        '<img alt="OPA" src="https://img.shields.io/badge/OPA-%s-0d9488">' % short.replace("-", "--"),
        '<img alt="released" src="https://img.shields.io/badge/OPA%%20released-%s-64748b">' % date.replace("-", "--"),
        '<img alt="dialect" src="https://img.shields.io/badge/Rego-%s-7c3aed">' % dname.replace(" ", "%20").replace("-", "--").replace("`", "").replace("(", "").replace(")", ""),
        '<a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-2563eb"></a>',
    ]
    w('<p align="center">' + " ".join(badges) + "</p>")
    w("")
    w("> **One Studio release per OPA release.** This is tag [`%s`](%s/tree/%s) of OPA Studio and it targets **OPA %s** exactly: the image bundles that OPA binary, the UI only offers what that release can do, and the example workspace is written in its Rego dialect. Using another OPA version? Pick the matching tag in [docs/VERSIONS.md](%s/blob/main/docs/VERSIONS.md)." % (version, REPO_URL, version, version, REPO_URL))
    if entry.get("prerelease"):
        w(">")
        w("> ⚠️ OPA %s is a **pre-release**." % version)
    if not entry.get("github_release", True):
        w(">")
        w("> ℹ️ OPA %s was tagged upstream but never published as a GitHub release; its binary is only available in the official image `openpolicyagent/opa:%s`, which this release uses." % (version, short))
    w("")
    nav = []
    if prev_tag:
        nav.append('<a href="%s/tree/%s">← %s</a>' % (REPO_URL, prev_tag, prev_tag))
    nav.append('<a href="%s/blob/main/docs/VERSIONS.md">All versions</a>' % REPO_URL)
    if next_tag:
        nav.append('<a href="%s/tree/%s">%s →</a>' % (REPO_URL, next_tag, next_tag))
    w('<p align="center">' + " · ".join(nav) + "</p>")
    w("")
    w("OPA Studio lets you do everything OPA can do from a browser: manage policies and data on any number of OPA servers, "
      "evaluate, test, format, benchmark, build and sign policies with the OPA CLI, use the REPL, and act as the control plane "
      "OPA agents download bundles from and report decisions and status to. Nothing you can do with OPA %s is out of reach — "
      "see the [feature coverage](docs/feature-coverage.md)." % version)
    w("")
    w("**Docs:** [Feature coverage](docs/feature-coverage.md) · [Compatibility](docs/compatibility.md) · [Configuration](docs/configuration.md) · "
      "[Security](docs/security.md) · [HTTP API](docs/api.md) · [Architecture](docs/architecture.md) · [Development](docs/development.md)")
    w("")
    if report and report.get("screens"):
        first = report["screens"][0]
        w('<p align="center"><img src="%s/%s" alt="%s" width="900"></p>' % (shots_rel, first["file"], first["title"]))
        w("")

    w("## Contents")
    w("")
    for t in ["Quick start", "What OPA %s can do" % version, "What changed in OPA %s" % version, "Guided tour", "Connect OPA agents to Studio", "Configuration", "Verification", "Build from source", "Other OPA versions"]:
        anchor = t.lower().replace(" ", "-").replace(".", "")
        for ch in "()`":
            anchor = anchor.replace(ch, "")
        w("- [%s](#%s)" % (t, anchor))
    w("")

    # ---- quick start ---------------------------------------------------------------
    w("## Quick start")
    w("")
    w("```bash")
    w("docker run --rm -p 9080:9080 -v opa-studio:/var/lib/opa-studio %s:%s" % (IMAGE, version))
    w("```")
    w("")
    w("Open <http://localhost:9080>. Studio starts a managed OPA %s server, creates an example workspace and connects to it." % version)
    w("Container platforms for this release: %s (determined by the binaries OPA %s ships)." % (", ".join("`%s`" % p for p in plats), version))
    w("")
    w("Connect to your own OPA %s server instead (or in addition):" % version)
    w("")
    w("```bash")
    w("docker run --rm -p 9080:9080 \\")
    w("  -e OPA_STUDIO_CONNECTIONS='[{\"id\":\"prod\",\"name\":\"Production\",\"url\":\"http://opa.internal:8181\",\"token\":\"…\"}]' \\")
    w("  -e OPA_STUDIO_AUTH_MODE=basic -e OPA_STUDIO_BASIC_PASSWORD='change-me' \\")
    w("  %s:%s" % (IMAGE, version))
    w("```")
    w("")
    if bins:
        w("Standalone binaries (Studio + matching OPA) are attached to the [GitHub release](%s/releases/tag/%s) for: %s." % (REPO_URL, version, ", ".join("`%s/%s`" % b for b in bins)))
        w("")

    # ---- capabilities -----------------------------------------------------------------
    w("## What OPA %s can do" % version)
    w("")
    w("Measured by running the official OPA %s binary (`%s`%s). Studio enables exactly these features." % (
        version, vo.get("Build Commit", "?")[:12], (", " + vo["Go Version"]) if vo.get("Go Version") else ""))
    w("")
    w("### Rego dialect: %s" % dname)
    w("")
    w(ddesc)
    w("")
    w("The example workspace Studio creates for this release (`app/rbac.rego`):")
    w("")
    w("```rego")
    w(template_policy(dialect).rstrip())
    w("```")
    w("")
    w("### CLI commands (%d)" % len(cmds))
    w("")
    rows = []
    page_for = {"eval": "Evaluate", "test": "Test", "check": "Check & Format", "fmt": "Check & Format", "parse": "Parse & Deps",
                "deps": "Parse & Deps", "bench": "Benchmark", "exec": "Exec", "build": "Bundles", "sign": "Bundles",
                "inspect": "Bundles", "capabilities": "Built-ins", "run": "Local OPA, REPL", "version": "About"}
    for name, c in sorted(cmds.items()):
        rows.append(("`opa %s`" % name, c.get("description", ""), len(c.get("flags", {})), page_for.get(name, "Command Builder") + " · Command Builder"))
    w(table(rows, ["Command", "Description", "Flags", "Studio page"]))
    w("")
    w("<details><summary>All flags of every command</summary>")
    w("")
    for name, c in sorted(cmds.items()):
        flags = c.get("flags", {})
        if not flags:
            continue
        w("**opa %s**" % name)
        w("")
        w(table([("`--%s`%s" % (f, (" `-%s`" % d["short"]) if d.get("short") else ""), "`%s`" % d.get("type", ""), d.get("description", "").replace("|", "\\|"))
                 for f, d in sorted(flags.items()) if f != "help"], ["Flag", "Type", "Description"]))
        w("")
    w("</details>")
    w("")
    w("### REST API")
    w("")
    w(table([(label, "`%s`" % path, tick(available(m, key))) for label, key, path in API_FEATURES], ["Capability", "Endpoint", "OPA %s" % version]))
    w("")
    w("Every endpoint — including ones without a dedicated page — can be called from the **API Console**.")
    w("")
    if nbuiltins:
        w("### Built-in functions")
        w("")
        w("`opa capabilities` reports **%d built-in functions** for this release; browse them on the **Built-ins** page." % nbuiltins)
        w("")
    if quirks:
        w("### Known issues of OPA %s" % version)
        w("")
        if "write_lock_after_policy_error" in quirks:
            w("- A rejected policy upload (`PUT /v1/policies/…` with a parse error) leaves the store's write lock held, so every later write hangs until OPA restarts. This was **measured** and is fixed upstream in v0.12.0. Studio warns about it on the dashboard; validate policies with *Check & Format* before uploading them.")
        w("")

    # ---- changes ---------------------------------------------------------------------
    w("## What changed in OPA %s" % version)
    w("")
    w(diff_section(m, prev, entry))
    w("")

    # ---- tour --------------------------------------------------------------------------
    w("## Guided tour")
    w("")
    if report and report.get("screens"):
        w("Every screenshot below was captured automatically from OPA Studio `%s` running against OPA `%s`." % (version, version))
        w("")
        for i, s in enumerate(report["screens"], 1):
            if not s.get("file"):
                continue
            name = s["file"].rsplit(".", 1)[0]
            w("### %d. %s" % (i, s["title"]))
            w("")
            w(s.get("description", ""))
            w("")
            w('<img src="%s/%s" alt="%s" width="900">' % (shots_rel, s["file"], s["title"]))
            w("")
            for g in GUIDES.get(name, []):
                w("- " + g)
            w("")
        missing = [t for t, cond in [
            ("Evaluate", "eval"), ("Test", "test"), ("Check & Format", "check"), ("Benchmark", "bench"), ("Exec", "exec"),
            ("Bundle build", "build"), ("Bundle signing", "sign"), ("Built-ins", "capabilities")] if cond not in cmds]
        if missing:
            w("> Pages not shown: %s — OPA %s does not have the corresponding CLI command, so Studio marks them *n/a*. Everything that exists in this release is covered." % (", ".join(missing), version))
            w("")
    else:
        w("_Screenshots were not captured for this release._")
        w("")

    # ---- control plane ---------------------------------------------------------------
    w("## Connect OPA agents to Studio")
    w("")
    w("Studio implements OPA's management APIs under `/cp`, so agents can download bundles from it and report decisions and status to it:")
    w("")
    legacy = semver_lt(version, "v0.13.0")
    w("```yaml")
    w("services:")
    w("  studio:")
    w("    url: https://opa-studio.example.com/cp")
    w("    credentials:")
    w("      bearer:")
    w("        token: ${OPA_STUDIO_CONTROL_PLANE_TOKEN}")
    if legacy:
        w("bundle:            # releases before v0.13.0 use the single 'bundle' key")
        w("  name: app")
        w("  service: studio")
    else:
        w("bundles:")
        w("  app:")
        w("    service: studio")
        w("    resource: bundles/app")
    w("decision_logs:")
    w("  service: studio")
    w("status:")
    w("  service: studio")
    w("```")
    w("")
    if "config-file" not in m["cli"]["commands"].get("run", {}).get("flags", {}):
        w("> OPA %s has no `--config-file` flag, so it cannot use these plugins; Studio's bundle server still works with tools that download bundles." % version)
        w("")
    w("The **Control Plane → OPA config** tab generates this file for you.")
    w("")

    # ---- configuration -----------------------------------------------------------------
    w("## Configuration")
    w("")
    w(table([
        ("`OPA_STUDIO_ADDR`", "`:9080`", "Listen address"),
        ("`OPA_STUDIO_AUTH_MODE`", "`none`", "`none`, `basic` or `token`"),
        ("`OPA_STUDIO_BASIC_USER` / `_PASSWORD`", "`admin` / –", "Credentials for basic auth"),
        ("`OPA_STUDIO_AUTH_TOKEN`", "–", "Token for token auth (≥ 16 characters)"),
        ("`OPA_STUDIO_READ_ONLY`", "`false`", "Reject every mutating operation"),
        ("`OPA_STUDIO_CONNECTIONS`", "–", "JSON array (or `@file.json`) of OPA servers"),
        ("`OPA_STUDIO_LOCAL_OPA`", "`true`", "Run the managed OPA %s server" % version),
        ("`OPA_STUDIO_CONTROL_PLANE_TOKEN`", "–", "Bearer token agents must send to `/cp`"),
        ("`OPA_STUDIO_CLI_SANDBOX`", "`true`", "Reject absolute paths / traversal in CLI arguments"),
        ("`OPA_STUDIO_TLS_CERT_FILE` / `_KEY_FILE`", "–", "Serve HTTPS"),
    ], ["Variable", "Default", "Purpose"]))
    w("")
    w("All options: [docs/configuration.md](docs/configuration.md) · Security hardening: [docs/security.md](docs/security.md) · Kubernetes and Compose: [deploy/](deploy/).")
    w("")

    # ---- verification ------------------------------------------------------------------
    w("## Verification")
    w("")
    rows = []
    if validation:
        for k, label in [("check", "`opa check` on the example workspace"), ("test", "`opa test` on the example workspace"), ("eval", "`opa eval` of `data.app.rbac.allow`")]:
            if k in validation:
                rows.append((label, "✅ passed" if validation[k] else "❌ failed"))
        if "server" in validation:
            rows.append(("`opa run --server` loads the workspace and decides", "✅ `%s`" % validation.get("decision", "") if validation["server"] else "❌"))
    if report:
        ok = len([x for x in report["screens"] if x.get("file") and not x.get("error")])
        rows.append(("UI pages exercised end-to-end", "✅ %d pages, %d failed actions" % (ok, len([x for x in report["screens"] if x.get("error")]))))
        rows.append(("Browser console errors", "✅ none" if not report.get("consoleErrors") else "⚠️ %d" % len(report["consoleErrors"])))
        rows.append(("Studio API server errors", "✅ none" if not report.get("apiFailures") else "⚠️ %d" % len(report["apiFailures"])))
    if rows:
        w("Automated checks run against OPA %s for this release:" % version)
        w("")
        w(table(rows, ["Check", "Result"]))
        w("")
    w("The Go unit tests, UI tests and the integration test (`OPA_BIN=… go test ./test/...`) run in CI for every tag.")
    w("")

    # ---- build -------------------------------------------------------------------------
    w("## Build from source")
    w("")
    w("```bash")
    w("git clone --branch %s %s.git && cd OPA-Studio" % (version, REPO_URL))
    w("make ui build          # web UI + bin/opa-studio (OPA version stamped from ./OPA_VERSION)")
    if bins:
        w("make opa               # downloads OPA %s to bin/opa (checksum verified when published)" % version)
        w("make run               # http://localhost:9080")
    w("make docker            # container image %s:%s" % (IMAGE, version))
    w("```")
    w("")
    if opa_image:
        w("The Docker build takes the OPA binary from `%s` (`--build-arg OPA_IMAGE=%s`)." % (opa_image, opa_image))
        w("")
    w("Requirements: Go 1.23+, Node.js 20+, Docker (for images). See [docs/development.md](docs/development.md).")
    w("")

    # ---- versions ---------------------------------------------------------------------
    w("## Other OPA versions")
    w("")
    neigh = vs[max(0, idx - 3): idx + 4]
    w(table([("**%s**" % e["tag"] if e["tag"] == version else "[%s](%s/tree/%s)" % (e["tag"], REPO_URL, e["tag"]), (e.get("published_at") or "")[:10],
              DIALECTS[manifest(e["tag"])["preferred_dialect"]][0]) for e in neigh], ["OPA Studio tag = OPA version", "OPA released", "Rego dialect"]))
    w("")
    w("All %d supported OPA releases: [docs/VERSIONS.md](%s/blob/main/docs/VERSIONS.md)." % (len(vs), REPO_URL))
    w("")
    w("---")
    w("")
    w("OPA Studio is an independent project and is not affiliated with the Open Policy Agent project or the CNCF. Licensed under [Apache-2.0](LICENSE).")
    w("")
    return "\n".join(L)


def load_validation(path=None):
    """versions/template-validation.json produced by tools/introspect/validate_all.py."""
    from common import ROOT
    path = path or os.path.join(ROOT, "versions", "template-validation.json")
    if not os.path.exists(path):
        return {}
    return json.load(open(path)).get("results", {})


def semver_lt(a, b):
    from common import semver_key
    return semver_key(a) < semver_key(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--shots", help="directory holding report.json and the images")
    ap.add_argument("--shots-rel", default="docs/screenshots")
    ap.add_argument("--validation")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    report = None
    if a.shots and os.path.exists(os.path.join(a.shots, "report.json")):
        report = json.load(open(os.path.join(a.shots, "report.json")))
    validation = load_validation(a.validation).get(a.version)
    with open(a.out, "w") as f:
        f.write(render(a.version, a.shots_rel, report, validation))


if __name__ == "__main__":
    main()
