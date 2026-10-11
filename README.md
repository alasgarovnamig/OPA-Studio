<p align="center"><img src="docs/assets/logo.svg" width="84" alt="OPA Studio"></p>

<h1 align="center">OPA Studio <code>v0.10.4</code></h1>

<p align="center"><b>The web UI for every Open Policy Agent operation — built, tested and documented for <a href="https://github.com/open-policy-agent/opa/releases/tag/v0.10.4">OPA v0.10.4</a>.</b></p>

<p align="center"><img alt="OPA" src="https://img.shields.io/badge/OPA-0.10.4-0d9488"> <img alt="released" src="https://img.shields.io/badge/OPA%20released-2019--02--19-64748b"> <img alt="dialect" src="https://img.shields.io/badge/Rego-Classic%20Rego-7c3aed"> <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-2563eb"></a></p>

> **One Studio release per OPA release.** This is tag [`v0.10.4`](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.10.4) of OPA Studio and it targets **OPA v0.10.4** exactly: the image bundles that OPA binary, the UI only offers what that release can do, and the example workspace is written in its Rego dialect. Using another OPA version? Pick the matching tag in [docs/VERSIONS.md](https://github.com/alasgarovnamig/OPA-Studio/blob/main/docs/VERSIONS.md).

<p align="center"><a href="https://github.com/alasgarovnamig/OPA-Studio/tree/v0.10.3">← v0.10.3</a> · <a href="https://github.com/alasgarovnamig/OPA-Studio/blob/main/docs/VERSIONS.md">All versions</a> · <a href="https://github.com/alasgarovnamig/OPA-Studio/tree/v0.10.5">v0.10.5 →</a></p>

OPA Studio lets you do everything OPA can do from a browser: manage policies and data on any number of OPA servers, evaluate, test, format, benchmark, build and sign policies with the OPA CLI, use the REPL, and act as the control plane OPA agents download bundles from and report decisions and status to. Nothing you can do with OPA v0.10.4 is out of reach — see the [feature coverage](docs/feature-coverage.md).

**Docs:** [Feature coverage](docs/feature-coverage.md) · [Compatibility](docs/compatibility.md) · [Configuration](docs/configuration.md) · [Security](docs/security.md) · [HTTP API](docs/api.md) · [Architecture](docs/architecture.md) · [Development](docs/development.md)

<p align="center"><img src="docs/screenshots/01-dashboard.webp" alt="Dashboard" width="900"></p>

## Contents

- [Quick start](#quick-start)
- [What OPA v0.10.4 can do](#what-opa-v0104-can-do)
- [What changed in OPA v0.10.4](#what-changed-in-opa-v0104)
- [Guided tour](#guided-tour)
- [Connect OPA agents to Studio](#connect-opa-agents-to-studio)
- [Configuration](#configuration)
- [Verification](#verification)
- [Build from source](#build-from-source)
- [Other OPA versions](#other-opa-versions)

## Quick start

```bash
docker run --rm -p 9080:9080 -v opa-studio:/var/lib/opa-studio ghcr.io/alasgarovnamig/opa-studio:v0.10.4
```

Open <http://localhost:9080>. Studio starts a managed OPA v0.10.4 server, creates an example workspace and connects to it.
Container platforms for this release: `linux/amd64` (determined by the binaries OPA v0.10.4 ships).

Connect to your own OPA v0.10.4 server instead (or in addition):

```bash
docker run --rm -p 9080:9080 \
  -e OPA_STUDIO_CONNECTIONS='[{"id":"prod","name":"Production","url":"http://opa.internal:8181","token":"…"}]' \
  -e OPA_STUDIO_AUTH_MODE=basic -e OPA_STUDIO_BASIC_PASSWORD='change-me' \
  ghcr.io/alasgarovnamig/opa-studio:v0.10.4
```

Standalone binaries (Studio + matching OPA) are attached to the [GitHub release](https://github.com/alasgarovnamig/OPA-Studio/releases/tag/v0.10.4) for: `linux/amd64`, `darwin/amd64`, `windows/amd64`.

## What OPA v0.10.4 can do

Measured by running the official OPA v0.10.4 binary (`5fc77076`). Studio enables exactly these features.

### Rego dialect: Classic Rego

Rule bodies in braces, `:=` assignment and `==` comparison; no `if` / `contains` keywords.

The example workspace Studio creates for this release (`app/rbac.rego`):

```rego
package app.rbac

# Role-based access control example shipped with OPA Studio.

default allow = false

# Admins may do anything.
allow {
	user_is_admin
}

# Everybody else needs a grant for the action and type.
allow {
	grant := user_is_granted[_]
	input.action == grant.action
	input.type == grant.type
}

user_is_admin {
	data.rbac.user_roles[input.user][_] == "admin"
}

user_is_granted[grant] {
	role := data.rbac.user_roles[input.user][_]
	grant := data.rbac.role_grants[role][_]
}

reasons[msg] {
	not allow
	msg := sprintf("%s may not %s %s", [input.user, input.action, input.type])
}
```

### CLI commands (9)

| Command | Description | Flags | Studio page |
|---|---|---|---|
| `opa build` | Compile Rego policy queries | 6 | Bundles · Command Builder |
| `opa check` | Check Rego source files | 5 | Check & Format · Command Builder |
| `opa deps` | Analyze Rego query dependencies | 5 | Parse & Deps · Command Builder |
| `opa eval` | Evaluate a Rego query | 20 | Evaluate · Command Builder |
| `opa fmt` | Format Rego source files | 5 | Check & Format · Command Builder |
| `opa parse` | Parse Rego source file | 3 | Parse & Deps · Command Builder |
| `opa run` | Start OPA in interactive or server mode | 16 | Local OPA, REPL · Command Builder |
| `opa test` | Execute Rego test cases | 10 | Test · Command Builder |
| `opa version` | Print the version of OPA | 2 | About · Command Builder |

<details><summary>All flags of every command</summary>

**opa build**

| Flag | Type | Description |
|---|---|---|
| `--data` `-d` | `string` | set data file(s) or directory path(s) |
| `--debug` `-D` | `bool` | enable debug output |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--output` `-o` | `string` | set the filename of the compiled policy (default "policy.wasm") |
| `--plugin-dir` | `string` | set directory path to load built-in and plugin shared object files from |

**opa check**

| Flag | Type | Description |
|---|---|---|
| `--format` `-f` | `{pretty,json}` | set output format (default pretty) |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--max-errors` `-m` | `int` | set the number of errors to allow before compilation fails early (default 10) |
| `--plugin-dir` | `string` | set directory path to load built-in and plugin shared object files from |

**opa deps**

| Flag | Type | Description |
|---|---|---|
| `--data` `-d` | `string` | set data file(s) or directory path(s) |
| `--format` `-f` | `{pretty,json}` | set output format (default pretty) |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--plugin-dir` | `string` | set directory path to load built-in and plugin shared object files from |

**opa eval**

| Flag | Type | Description |
|---|---|---|
| `--coverage` | `bool` | report coverage |
| `--data` `-d` | `string` | set data file(s) or directory path(s) |
| `--explain` | `{full}` | enable query explainations |
| `--fail` | `bool` | exits with non-zero exit code on undefined result and errors |
| `--format` `-f` | `{json,values,bindings,pretty}` | set output format (default json) |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--import` | `string` | set query import(s) |
| `--input` `-i` | `string` | set input file path |
| `--metrics` | `bool` | report query performance metrics |
| `--package` | `string` | set query package |
| `--partial` `-p` | `bool` | perform partial evaluation |
| `--plugin-dir` | `string` | set directory path to load built-in and plugin shared object files from |
| `--pretty-limit` | `int` | set limit after which pretty output gets truncated (default 80) |
| `--profile` | `bool` | perform expression profiling |
| `--profile-limit` | `int` | set number of profiling results to show (default 10) |
| `--profile-sort` | `string` | set sort order of expression profiler results |
| `--stdin` | `bool` | read query from stdin |
| `--stdin-input` `-I` | `bool` | read input document from stdin |
| `--unknowns` `-u` | `strings` | set paths to treat as unknown during partial evaluation (default [input]) |

**opa fmt**

| Flag | Type | Description |
|---|---|---|
| `--diff` `-d` | `bool` | only display a diff of the changes |
| `--list` `-l` | `bool` | list all files who would change when formatted |
| `--plugin-dir` | `string` | set directory path to load built-in and plugin shared object files from |
| `--write` `-w` | `bool` | overwrite the original source file |

**opa parse**

| Flag | Type | Description |
|---|---|---|
| `--format` `-f` | `{pretty,json}` | set output format (default pretty) |
| `--plugin-dir` | `string` | set directory path to load built-in and plugin shared object files from |

**opa run**

| Flag | Type | Description |
|---|---|---|
| `--addr` `-a` | `strings` | set listening address of the server (e.g., [ip]:<port> for TCP, unix://<path> for UNIX domain socket) (default [:8181]) |
| `--authentication` | `{token,tls,off}` | set authentication scheme (default off) |
| `--authorization` | `{basic,off}` | set authorization scheme (default off) |
| `--config-file` `-c` | `string` | set path of configuration file |
| `--format` `-f` | `string` | set shell output format, i.e, pretty, json (default "pretty") |
| `--history` `-H` | `string` | set path of history file (default "/root/.opa_history") |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--log-format` | `{text,json}` | set log format (default text) |
| `--log-level` `-l` | `{debug,info,error}` | set log level (default info) |
| `--max-errors` `-m` | `int` | set the number of errors to allow before compilation fails early (default 10) |
| `--server` `-s` | `bool` | start the runtime in server mode |
| `--tls-ca-cert-file` | `string` | set path of TLS CA cert file |
| `--tls-cert-file` | `string` | set path of TLS certificate file |
| `--tls-private-key-file` | `string` | set path of TLS private key file |
| `--watch` `-w` | `bool` | watch command line files for changes |

**opa test**

| Flag | Type | Description |
|---|---|---|
| `--coverage` `-c` | `bool` | report coverage (overrides debug tracing) |
| `--format` `-f` | `{pretty,json}` | set output format (default pretty) |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--max-errors` `-m` | `int` | set the number of errors to allow before compilation fails early (default 10) |
| `--plugin-dir` | `string` | set directory path to load built-in and plugin shared object files from |
| `--show-failure-line` `-l` | `bool` | show test failure line |
| `--threshold` | `float` | set coverage threshold and exit with non-zero status if coverage is less than threshold % |
| `--timeout` `-t` | `duration` | set test timeout (default 5s) |
| `--verbose` `-v` | `bool` | set verbose reporting mode |

**opa version**

| Flag | Type | Description |
|---|---|---|
| `--plugin-dir` | `string` | set directory path to load built-in and plugin shared object files from |

</details>

### REST API

| Capability | Endpoint | OPA v0.10.4 |
|---|---|---|
| Policy API — list | `GET /v1/policies` | ✅ |
| Policy API — create/update | `PUT /v1/policies/{id}` | ✅ |
| Policy API — delete | `DELETE /v1/policies/{id}` | ✅ |
| Data API — read root document | `GET /v1/data` | ✅ |
| Data API — decision with input | `POST /v1/data/{path}` | ✅ |
| Data API — write document | `PUT /v1/data/{path}` | ✅ |
| Data API — create-only (If-None-Match) | `PUT /v1/data/{path}` | ✅ |
| Data API — JSON Patch | `PATCH /v1/data/{path}` | ✅ |
| Data API — delete | `DELETE /v1/data/{path}` | ✅ |
| Data API — v0 webhook | `POST /v0/data/{path}` | ✅ |
| Explanations (explain=full) | `?explain=full` | ✅ |
| Query API — GET | `GET /v1/query?q=` | ✅ |
| Query API — POST with input | `POST /v1/query` | ✅ |
| Compile API — partial evaluation | `POST /v1/compile` | ✅ |
| Compile API — data filtering (UCAST/SQL) | `POST /v1/compile/{path}` | — |
| Health API | `GET /health` | ✅ |
| Health — bundles & plugins | `GET /health?bundles&plugins` | ✅ |
| Health — custom live/ready policies | `GET /health/live, /health/ready` | — |
| Prometheus metrics | `GET /metrics` | ✅ |
| Config API | `GET /v1/config` | — |
| Status API | `GET /v1/status` | — |

Every endpoint — including ones without a dedicated page — can be called from the **API Console**.

## What changed in OPA v0.10.4

Measured difference between OPA **v0.10.3** and **v0.10.4**:

| Change | Details |
|---|---|
| ➕ flags of `opa eval` | `--coverage` |

<details><summary><b>Upstream release note highlights</b></summary>

- This release adds support for scoping bundles to specific roots under `data`. This allows bundles to be used in conjunction with sidecars like `kube-mgmt` that load local data and policy into OPA....
- This release includes a small but backwards incompatible change to the Decision Log event format. Instead of including the OPA version as a top-level field, the OPA version is included in the label...

**Fixes**

- Add coverage support to `opa eval` sub-command
- Fix path checking in server to prevent overlapping base and virtual docs
- Fix cmd integration tests to cleanup plugin directory
- Improve TLS support in `http.send`

Full notes: https://github.com/open-policy-agent/opa/releases/tag/v0.10.4

</details>

## Guided tour

Every screenshot below was captured automatically from OPA Studio `v0.10.4` running against OPA `v0.10.4`.

### 1. Dashboard

Connection health, server version, policy/data counts, runtime configuration and recent decisions at a glance.

<img src="docs/screenshots/01-dashboard.webp" alt="Dashboard" width="900">

- Pick the OPA server in the top bar (the managed **Local OPA** is selected by default).
- The cards show the server version, policy and data counts, health, configuration and the latest decisions.
- **Refresh** re-probes the server; a warning appears when its version differs from the one this release targets.

### 2. Workspace editor

Policies, data, inputs and tests of a workspace with Rego syntax highlighting, formatting, checks, deploy/pull, bundle import and export.

<img src="docs/screenshots/02-workspace.webp" alt="Workspace editor" width="900">

- Workspaces hold policies, tests, `data.json`/`data.yaml` documents and `input*.json` files; select one in the top bar.
- Click a file to edit it, <kbd>Ctrl/⌘</kbd>+<kbd>Enter</kbd> saves. **Format** and **Check** run `opa fmt` / `opa check` on the open file.
- **Deploy to OPA** uploads data (`PUT /v1/data`) and policies (`PUT /v1/policies`) to any connection; **Pull from OPA** does the reverse.
- **Import bundle** / **Export bundle** move the workspace in and out as an OPA bundle (`.tar.gz`).

### 3. Evaluate (opa eval)

Evaluates a query against the workspace with the input document; every `opa eval` flag of this release is available.

<img src="docs/screenshots/03-evaluate.webp" alt="Evaluate (opa eval)" width="900">

- Write a query, choose an input file and press **Evaluate** (<kbd>Ctrl/⌘</kbd>+<kbd>Enter</kbd>).
- Only flags supported by this OPA release are offered; anything else goes into *Additional flags*.
- The command preview at the top is the exact `opa eval` invocation and can be copied to a terminal.

### 4. Test (opa test)

Runs the policy tests; results, coverage and benchmarks are rendered as tables.

<img src="docs/screenshots/04-test.webp" alt="Test (opa test)" width="900">

- **Run tests** executes every `test_` rule of the workspace.
- Results are parsed into a table; enable coverage to see per-file coverage and uncovered lines.

### 5. Check & Format

`opa check` (including strict mode) and `opa fmt` with diff preview and write-back.

<img src="docs/screenshots/05-check-format.webp" alt="Check & Format" width="900">

- **Check** compiles all modules and lists errors with their location; strict mode adds the strict checks of this release.
- The **opa fmt** tab shows a diff of unformatted files or formats and saves them.

### 6. Policy API

Lists, reads, creates, updates and deletes the Rego modules stored on the server (`/v1/policies`).

<img src="docs/screenshots/06-policies.webp" alt="Policy API" width="900">

- Lists the modules stored on the server; select one to view or edit its source and AST.
- **New** creates a module from a starter written in this release's Rego dialect; **Delete** removes it.

### 7. Data API

Browse the document tree, query decisions with input, explanations, metrics and provenance, and write documents (PUT / PATCH / DELETE).

<img src="docs/screenshots/07-data.webp" alt="Data API" width="900">

- Click a node in the document tree to target its path.
- GET / POST (with input) evaluate documents; PUT, PATCH (JSON Patch) and DELETE modify base documents.
- Explanations, metrics, instrumentation and provenance are rendered in their own tabs when the release supports them.

### 8. Query API

Ad-hoc Rego queries through `/v1/query` (GET and POST with input) and the default decision endpoint.

<img src="docs/screenshots/08-query.webp" alt="Query API" width="900">

- Ad-hoc queries run through `/v1/query`; each line is an expression and variable bindings are shown as a table.
- The *Default decision* tab posts the request body to `POST /` when the release supports it.

### 9. Compile API

Partial evaluation with unknowns (`/v1/compile`); newer releases add data filtering to UCAST and SQL.

<img src="docs/screenshots/09-compile.webp" alt="Compile API" width="900">

- Declare unknowns (e.g. `input.action`) and **Compile** to get the residual queries of partial evaluation.
- On releases with data filtering a second tab translates rules into UCAST or SQL filters.

### 10. Health API

Health checks including bundle and plugin readiness and custom `system.health` policies.

<img src="docs/screenshots/10-health.webp" alt="Health API" width="900">

- **Check** calls `/health` with the selected bundle/plugin requirements (and the custom live/ready checks when available).
- *Install on server* uploads a `system.health` policy for custom liveness and readiness.

### 11. Prometheus metrics

Parsed `/metrics` exposition with metric families, types and samples.

<img src="docs/screenshots/12-metrics.webp" alt="Prometheus metrics" width="900">

- Studio parses the Prometheus exposition of `/metrics`; filter families and click one to inspect its samples.

### 12. Bundles

Build (`opa build`), inspect, sign and verify bundles; the native builder covers releases without `opa build`.

<img src="docs/screenshots/13-bundles.webp" alt="Bundles" width="900">

- **Build** runs `opa build` on the workspace (targets, entrypoints, optimisation, revision and signing when supported).
- Built bundles can be downloaded or published to the Studio control plane; **Inspect**, **Sign** and **Verify** work on any archive.

### 13. Control plane: decision logs

Studio serves bundles and discovery and receives decision logs and status reports from OPA agents.

<img src="docs/screenshots/14-control-plane.webp" alt="Control plane: decision logs" width="900">

- Studio implements the OPA management APIs: bundle and discovery downloads, decision log and status uploads.
- The *OPA config* tab generates the agent configuration; *Apply to Local OPA* wires the managed server to Studio.
- Decision logs stream live; click a row for input, result, labels and metrics.

### 14. Local OPA

Start, stop and configure the managed OPA server; live process logs.

<img src="docs/screenshots/15-local-opa.webp" alt="Local OPA" width="900">

- Start, stop or restart the managed `opa run --server` process and change its address, loaded workspace, flags and configuration file.
- Process output is streamed live.

### 15. REPL (opa run)

The interactive Rego shell in the browser, with the workspace loaded.

<img src="docs/screenshots/16-repl.webp" alt="REPL (opa run)" width="900">

- **Start session** launches `opa run` with the workspace loaded; type Rego and REPL commands (`show`, `trace`, `metrics`, …).

### 16. Command Builder

Every command, subcommand and flag of this OPA release as a form — nothing the CLI can do is out of reach.

<img src="docs/screenshots/17-command-builder.webp" alt="Command Builder" width="900">

- Every command, subcommand and flag of this OPA binary is rendered as a form, generated from the measured manifest.
- Runs execute in a sandboxed copy of the workspace; output files can be collected and downloaded.

### 17. API Console

Any HTTP request against the OPA REST API with presets for every documented operation.

<img src="docs/screenshots/18-api-console.webp" alt="API Console" width="900">

- Choose a preset (operations unavailable in this release are dimmed) or craft any request: method, path, query, headers and body.

### 18. Compatibility matrix

Measured capabilities of every OPA release and the changes introduced by this one.

<img src="docs/screenshots/20-compatibility.webp" alt="Compatibility matrix" width="900">

- The measured capability matrix of all OPA releases; select a release to see its commands, endpoints and changes.

> Pages not shown: Benchmark, Exec, Bundle signing, Built-ins — OPA v0.10.4 does not have the corresponding CLI command, so Studio marks them *n/a*. Everything that exists in this release is covered.

## Connect OPA agents to Studio

Studio implements OPA's management APIs under `/cp`, so agents can download bundles from it and report decisions and status to it:

```yaml
services:
  studio:
    url: https://opa-studio.example.com/cp
    credentials:
      bearer:
        token: ${OPA_STUDIO_CONTROL_PLANE_TOKEN}
bundle:            # releases before v0.13.0 use the single 'bundle' key
  name: app
  service: studio
decision_logs:
  service: studio
status:
  service: studio
```

The **Control Plane → OPA config** tab generates this file for you.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OPA_STUDIO_ADDR` | `:9080` | Listen address |
| `OPA_STUDIO_AUTH_MODE` | `none` | `none`, `basic` or `token` |
| `OPA_STUDIO_BASIC_USER` / `_PASSWORD` | `admin` / – | Credentials for basic auth |
| `OPA_STUDIO_AUTH_TOKEN` | – | Token for token auth (≥ 16 characters) |
| `OPA_STUDIO_READ_ONLY` | `false` | Reject every mutating operation |
| `OPA_STUDIO_CONNECTIONS` | – | JSON array (or `@file.json`) of OPA servers |
| `OPA_STUDIO_LOCAL_OPA` | `true` | Run the managed OPA v0.10.4 server |
| `OPA_STUDIO_CONTROL_PLANE_TOKEN` | – | Bearer token agents must send to `/cp` |
| `OPA_STUDIO_CLI_SANDBOX` | `true` | Reject absolute paths / traversal in CLI arguments |
| `OPA_STUDIO_TLS_CERT_FILE` / `_KEY_FILE` | – | Serve HTTPS |

All options: [docs/configuration.md](docs/configuration.md) · Security hardening: [docs/security.md](docs/security.md) · Kubernetes and Compose: [deploy/](deploy/).

## Verification

Automated checks run against OPA v0.10.4 for this release:

| Check | Result |
|---|---|
| `opa check` on the example workspace | ✅ passed |
| `opa test` on the example workspace | ✅ passed |
| `opa eval` of `data.app.rbac.allow` | ✅ passed |
| `opa run --server` loads the workspace and decides | ✅ `{"result":true}` |
| UI pages exercised end-to-end | ✅ 18 pages, 0 failed actions |
| Browser console errors | ✅ none |
| Studio API server errors | ✅ none |

The Go unit tests, UI tests and the integration test (`OPA_BIN=… go test ./test/...`) run in CI for every tag.

## Build from source

```bash
git clone --branch v0.10.4 https://github.com/alasgarovnamig/OPA-Studio.git && cd OPA-Studio
make ui build          # web UI + bin/opa-studio (OPA version stamped from ./OPA_VERSION)
make opa               # downloads OPA v0.10.4 to bin/opa (checksum verified when published)
make run               # http://localhost:9080
make docker            # container image ghcr.io/alasgarovnamig/opa-studio:v0.10.4
```

Requirements: Go 1.23+, Node.js 20+, Docker (for images). See [docs/development.md](docs/development.md).

## Other OPA versions

| OPA Studio tag = OPA version | OPA released | Rego dialect |
|---|---|---|
| [v0.10.1](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.10.1) | 2018-10-30 | Classic Rego |
| [v0.10.2](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.10.2) | 2018-12-10 | Classic Rego |
| [v0.10.3](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.10.3) | 2019-01-22 | Classic Rego |
| **v0.10.4** | 2019-02-19 | Classic Rego |
| [v0.10.5](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.10.5) | 2019-02-25 | Classic Rego |
| [v0.10.6](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.10.6) | 2019-03-26 | Classic Rego |
| [v0.10.7](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.10.7) | 2019-04-09 | Classic Rego |

All 216 supported OPA releases: [docs/VERSIONS.md](https://github.com/alasgarovnamig/OPA-Studio/blob/main/docs/VERSIONS.md).

---

OPA Studio is an independent project and is not affiliated with the Open Policy Agent project or the CNCF. Licensed under [Apache-2.0](LICENSE).
