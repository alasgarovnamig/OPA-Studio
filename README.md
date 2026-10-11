<p align="center"><img src="docs/assets/logo.svg" width="84" alt="OPA Studio"></p>

<h1 align="center">OPA Studio <code>v0.1.0</code></h1>

<p align="center"><b>The web UI for every Open Policy Agent operation — built, tested and documented for <a href="https://github.com/open-policy-agent/opa/releases/tag/v0.1.0">OPA v0.1.0</a>.</b></p>

<p align="center"><img alt="OPA" src="https://img.shields.io/badge/OPA-0.1.0-0d9488"> <img alt="released" src="https://img.shields.io/badge/OPA%20released-2016--07--14-64748b"> <img alt="dialect" src="https://img.shields.io/badge/Rego-Datalog--style%20Rego%20no%20input-7c3aed"> <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-2563eb"></a></p>

> **One Studio release per OPA release.** This is tag [`v0.1.0`](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.1.0) of OPA Studio and it targets **OPA v0.1.0** exactly: the image bundles that OPA binary, the UI only offers what that release can do, and the example workspace is written in its Rego dialect. Using another OPA version? Pick the matching tag in [docs/VERSIONS.md](https://github.com/alasgarovnamig/OPA-Studio/blob/main/docs/VERSIONS.md).

<p align="center"><a href="https://github.com/alasgarovnamig/OPA-Studio/blob/main/docs/VERSIONS.md">All versions</a> · <a href="https://github.com/alasgarovnamig/OPA-Studio/tree/v0.2.0">v0.2.0 →</a></p>

OPA Studio lets you do everything OPA can do from a browser: manage policies and data on any number of OPA servers, evaluate, test, format, benchmark, build and sign policies with the OPA CLI, use the REPL, and act as the control plane OPA agents download bundles from and report decisions and status to. Nothing you can do with OPA v0.1.0 is out of reach — see the [feature coverage](docs/feature-coverage.md).

**Docs:** [Feature coverage](docs/feature-coverage.md) · [Compatibility](docs/compatibility.md) · [Configuration](docs/configuration.md) · [Security](docs/security.md) · [HTTP API](docs/api.md) · [Architecture](docs/architecture.md) · [Development](docs/development.md)

<p align="center"><img src="docs/screenshots/01-dashboard.webp" alt="Dashboard" width="900"></p>

## Contents

- [Quick start](#quick-start)
- [What OPA v0.1.0 can do](#what-opa-v010-can-do)
- [What changed in OPA v0.1.0](#what-changed-in-opa-v010)
- [Guided tour](#guided-tour)
- [Connect OPA agents to Studio](#connect-opa-agents-to-studio)
- [Configuration](#configuration)
- [Verification](#verification)
- [Build from source](#build-from-source)
- [Other OPA versions](#other-opa-versions)

## Quick start

```bash
docker run --rm -p 9080:9080 -v opa-studio:/var/lib/opa-studio ghcr.io/alasgarovnamig/opa-studio:v0.1.0
```

Open <http://localhost:9080>. Studio starts a managed OPA v0.1.0 server, creates an example workspace and connects to it.
Container platforms for this release: `linux/amd64` (determined by the binaries OPA v0.1.0 ships).

Connect to your own OPA v0.1.0 server instead (or in addition):

```bash
docker run --rm -p 9080:9080 \
  -e OPA_STUDIO_CONNECTIONS='[{"id":"prod","name":"Production","url":"http://opa.internal:8181","token":"…"}]' \
  -e OPA_STUDIO_AUTH_MODE=basic -e OPA_STUDIO_BASIC_PASSWORD='change-me' \
  ghcr.io/alasgarovnamig/opa-studio:v0.1.0
```

Standalone binaries (Studio + matching OPA) are attached to the [GitHub release](https://github.com/alasgarovnamig/OPA-Studio/releases/tag/v0.1.0) for: `linux/amd64`, `darwin/amd64`.

## What OPA v0.1.0 can do

Measured by running the official OPA v0.1.0 binary (`ca3bb4d`). Studio enables exactly these features.

### Rego dialect: Datalog-style Rego (no input)

Rules are written as `head :- body`; there is no `input` document yet, requests are modelled as data.

The example workspace Studio creates for this release (`app/rbac.rego`):

```rego
package app.rbac

# Role-based access control example shipped with OPA Studio.

request_user = "bob"

request_action = "update"

request_type = "dog"

allow :- user_is_admin

allow :- user_is_granted[grant], request_action = grant.action, request_type = grant.type

user_is_admin :- data.rbac.user_roles[request_user][_] = "admin"

user_is_granted[grant] :- role = data.rbac.user_roles[request_user][_], grant = data.rbac.role_grants[role][_]
```

### CLI commands (2)

| Command | Description | Flags | Studio page |
|---|---|---|---|
| `opa run` | Start OPA in interative or server mode | 12 | Local OPA, REPL · Command Builder |
| `opa version` | Print the version of OPA | 0 | About · Command Builder |

<details><summary>All flags of every command</summary>

**opa run**

| Flag | Type | Description |
|---|---|---|
| `--addr` `-a` | `string` | set listening address of the server (default ":8181") |
| `--alsologtostderr` | `value` | log to standard error as well as files |
| `--format` `-f` | `string` | set shell output format, i.e, pretty, json (default "pretty") |
| `--history` `-H` | `string` | set path of history file (default "/root/.opa_history") |
| `--log_backtrace_at` | `value` | when logging hits line file:N, emit a stack trace (default :0) |
| `--log_dir` | `value` | If non-empty, write log files in this directory |
| `--logtostderr` | `value` | log to standard error instead of files |
| `--policy-dir` `-p` | `string` | set directory to store policy definitions |
| `--server` `-s` | `bool` | start the runtime in server mode |
| `--stderrthreshold` | `value` | logs at or above this threshold go to stderr (default 2) |
| `--v` | `value` | log level for V logs |
| `--vmodule` | `value` | comma-separated list of pattern=N settings for file-filtered logging |

</details>

### REST API

| Capability | Endpoint | OPA v0.1.0 |
|---|---|---|
| Policy API — list | `GET /v1/policies` | ✅ |
| Policy API — create/update | `PUT /v1/policies/{id}` | ✅ |
| Policy API — delete | `DELETE /v1/policies/{id}` | ✅ |
| Data API — read root document | `GET /v1/data` | — |
| Data API — decision with input | `POST /v1/data/{path}` | — |
| Data API — write document | `PUT /v1/data/{path}` | — |
| Data API — create-only (If-None-Match) | `PUT /v1/data/{path}` | — |
| Data API — JSON Patch | `PATCH /v1/data/{path}` | ✅ |
| Data API — delete | `DELETE /v1/data/{path}` | — |
| Data API — v0 webhook | `POST /v0/data/{path}` | — |
| Explanations (explain=full) | `?explain=full` | ✅ |
| Query API — GET | `GET /v1/query?q=` | ✅ |
| Query API — POST with input | `POST /v1/query` | — |
| Compile API — partial evaluation | `POST /v1/compile` | — |
| Compile API — data filtering (UCAST/SQL) | `POST /v1/compile/{path}` | — |
| Health API | `GET /health` | — |
| Health — bundles & plugins | `GET /health?bundles&plugins` | — |
| Health — custom live/ready policies | `GET /health/live, /health/ready` | — |
| Prometheus metrics | `GET /metrics` | — |
| Config API | `GET /v1/config` | — |
| Status API | `GET /v1/status` | — |

Every endpoint — including ones without a dedicated page — can be called from the **API Console**.

## What changed in OPA v0.1.0

This is the **first public release of OPA**. Everything below is new.

## Guided tour

Every screenshot below was captured automatically from OPA Studio `v0.1.0` running against OPA `v0.1.0`.

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

### 3. Policy API

Lists, reads, creates, updates and deletes the Rego modules stored on the server (`/v1/policies`).

<img src="docs/screenshots/06-policies.webp" alt="Policy API" width="900">

- Lists the modules stored on the server; select one to view or edit its source and AST.
- **New** creates a module from a starter written in this release's Rego dialect; **Delete** removes it.

### 4. Data API

Browse the document tree, query decisions with input, explanations, metrics and provenance, and write documents (PUT / PATCH / DELETE).

<img src="docs/screenshots/07-data.webp" alt="Data API" width="900">

- Click a node in the document tree to target its path.
- GET / POST (with input) evaluate documents; PUT, PATCH (JSON Patch) and DELETE modify base documents.
- Explanations, metrics, instrumentation and provenance are rendered in their own tabs when the release supports them.

### 5. Query API

Ad-hoc Rego queries through `/v1/query` (GET and POST with input) and the default decision endpoint.

<img src="docs/screenshots/08-query.webp" alt="Query API" width="900">

- Ad-hoc queries run through `/v1/query`; each line is an expression and variable bindings are shown as a table.
- The *Default decision* tab posts the request body to `POST /` when the release supports it.

### 6. Bundles

Build (`opa build`), inspect, sign and verify bundles; the native builder covers releases without `opa build`.

<img src="docs/screenshots/13-bundles.webp" alt="Bundles" width="900">

- **Build** runs `opa build` on the workspace (targets, entrypoints, optimisation, revision and signing when supported).
- Built bundles can be downloaded or published to the Studio control plane; **Inspect**, **Sign** and **Verify** work on any archive.

### 7. Control plane: decision logs

Studio serves bundles and discovery and receives decision logs and status reports from OPA agents.

<img src="docs/screenshots/14-control-plane.webp" alt="Control plane: decision logs" width="900">

- Studio implements the OPA management APIs: bundle and discovery downloads, decision log and status uploads.
- The *OPA config* tab generates the agent configuration; *Apply to Local OPA* wires the managed server to Studio.
- Decision logs stream live; click a row for input, result, labels and metrics.

### 8. Local OPA

Start, stop and configure the managed OPA server; live process logs.

<img src="docs/screenshots/15-local-opa.webp" alt="Local OPA" width="900">

- Start, stop or restart the managed `opa run --server` process and change its address, loaded workspace, flags and configuration file.
- Process output is streamed live.

### 9. REPL (opa run)

The interactive Rego shell in the browser, with the workspace loaded.

<img src="docs/screenshots/16-repl.webp" alt="REPL (opa run)" width="900">

- **Start session** launches `opa run` with the workspace loaded; type Rego and REPL commands (`show`, `trace`, `metrics`, …).

### 10. Command Builder

Every command, subcommand and flag of this OPA release as a form — nothing the CLI can do is out of reach.

<img src="docs/screenshots/17-command-builder.webp" alt="Command Builder" width="900">

- Every command, subcommand and flag of this OPA binary is rendered as a form, generated from the measured manifest.
- Runs execute in a sandboxed copy of the workspace; output files can be collected and downloaded.

### 11. API Console

Any HTTP request against the OPA REST API with presets for every documented operation.

<img src="docs/screenshots/18-api-console.webp" alt="API Console" width="900">

- Choose a preset (operations unavailable in this release are dimmed) or craft any request: method, path, query, headers and body.

### 12. Compatibility matrix

Measured capabilities of every OPA release and the changes introduced by this one.

<img src="docs/screenshots/20-compatibility.webp" alt="Compatibility matrix" width="900">

- The measured capability matrix of all OPA releases; select a release to see its commands, endpoints and changes.

> Pages not shown: Evaluate, Test, Check & Format, Benchmark, Exec, Bundle build, Bundle signing, Built-ins — OPA v0.1.0 does not have the corresponding CLI command, so Studio marks them *n/a*. Everything that exists in this release is covered.

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

> OPA v0.1.0 has no `--config-file` flag, so it cannot use these plugins; Studio's bundle server still works with tools that download bundles.

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
| `OPA_STUDIO_LOCAL_OPA` | `true` | Run the managed OPA v0.1.0 server |
| `OPA_STUDIO_CONTROL_PLANE_TOKEN` | – | Bearer token agents must send to `/cp` |
| `OPA_STUDIO_CLI_SANDBOX` | `true` | Reject absolute paths / traversal in CLI arguments |
| `OPA_STUDIO_TLS_CERT_FILE` / `_KEY_FILE` | – | Serve HTTPS |

All options: [docs/configuration.md](docs/configuration.md) · Security hardening: [docs/security.md](docs/security.md) · Kubernetes and Compose: [deploy/](deploy/).

## Verification

Automated checks run against OPA v0.1.0 for this release:

| Check | Result |
|---|---|
| `opa run --server` loads the workspace and decides | ✅ `true` |
| UI pages exercised end-to-end | ✅ 12 pages, 0 failed actions |
| Browser console errors | ✅ none |
| Studio API server errors | ✅ none |

The Go unit tests, UI tests and the integration test (`OPA_BIN=… go test ./test/...`) run in CI for every tag.

## Build from source

```bash
git clone --branch v0.1.0 https://github.com/alasgarovnamig/OPA-Studio.git && cd OPA-Studio
make ui build          # web UI + bin/opa-studio (OPA version stamped from ./OPA_VERSION)
make opa               # downloads OPA v0.1.0 to bin/opa (checksum verified when published)
make run               # http://localhost:9080
make docker            # container image ghcr.io/alasgarovnamig/opa-studio:v0.1.0
```

Requirements: Go 1.23+, Node.js 20+, Docker (for images). See [docs/development.md](docs/development.md).

## Other OPA versions

| OPA Studio tag = OPA version | OPA released | Rego dialect |
|---|---|---|
| **v0.1.0** | 2016-07-14 | Datalog-style Rego (no input) |
| [v0.2.0](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.2.0) | 2016-11-07 | Datalog-style Rego (no input) |
| [v0.2.1](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.2.1) | 2016-11-23 | Datalog-style Rego (no input) |
| [v0.2.2](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.2.2) | 2016-12-01 | Datalog-style Rego (no input) |

All 216 supported OPA releases: [docs/VERSIONS.md](https://github.com/alasgarovnamig/OPA-Studio/blob/main/docs/VERSIONS.md).

---

OPA Studio is an independent project and is not affiliated with the Open Policy Agent project or the CNCF. Licensed under [Apache-2.0](LICENSE).
