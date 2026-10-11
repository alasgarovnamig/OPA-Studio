# OPA feature coverage

OPA Studio's goal is that **nothing you can do with OPA is impossible from the UI**. This page maps every
capability of OPA — the REST API, the CLI and the management (control plane) APIs — to the place in Studio
where it is available. Availability per OPA release is measured, see [compatibility.md](compatibility.md).

Two generic tools guarantee full coverage even for options without a dedicated form:

* **API Console** — sends any HTTP request (method, path, query string, headers, body) to the selected OPA server.
* **Command Builder** — renders every command, subcommand and flag of the bundled OPA binary as a form
  (generated from the binary's own `--help` output) and also accepts a raw command line.

## REST API

| OPA operation | Endpoint | Studio |
|---|---|---|
| List policies | `GET /v1/policies` | Policies |
| Get a policy (source + AST) | `GET /v1/policies/{id}` | Policies → Source / AST |
| Create or update a policy (compile metrics) | `PUT /v1/policies/{id}[?metrics]` | Policies → Save, Workspace → Deploy |
| Delete a policy | `DELETE /v1/policies/{id}` | Policies → Delete |
| Get a document | `GET /v1/data/{path}` | Data → GET, document tree |
| Get a document with input | `POST /v1/data/{path}` | Data → POST (input) |
| Input via query parameter (early releases) | `GET /v1/data/{path}?input=` | API Console |
| Explanations | `?explain=notes\|fails\|full\|debug` | Data, Query, Compile → Explanation tab |
| Metrics / instrumentation | `?metrics`, `?instrument` | Data, Query, Compile → Metrics tab |
| Provenance | `?provenance` | Data → Provenance tab |
| Strict built-in errors | `?strict-builtin-errors` | Data |
| Pretty printing | `?pretty` | Data, Query, Compile, Config & Status |
| Create or overwrite a document | `PUT /v1/data/{path}` | Data → PUT, Workspace → Deploy |
| Create only if absent | `PUT` + `If-None-Match: *` | Data → PUT |
| Patch a document | `PATCH /v1/data/{path}` (JSON Patch) | Data → PATCH |
| Delete a document | `DELETE /v1/data/{path}` | Data → DELETE |
| Webhook (v0) decision | `POST /v0/data/{path}` | Data → v0 webhook |
| Default decision | `POST /` | Query → Default decision |
| Ad-hoc query | `GET /v1/query?q=`, `POST /v1/query` | Query |
| Partial evaluation | `POST /v1/compile` | Compile → Partial evaluation |
| Data filtering (UCAST, SQL dialects) | `POST /v1/compile/{path}` + `Accept` | Compile → Data filtering |
| Health | `GET /health[?bundles][&plugins][&exclude-plugin=]` | Health, Dashboard |
| Custom health checks | `GET /health/live`, `GET /health/ready` (+ `system.health` policy) | Health |
| Configuration | `GET /v1/config` | Config & Status, Dashboard |
| Status | `GET /v1/status` | Config & Status, Dashboard |
| Prometheus metrics | `GET /metrics` | Metrics |
| pprof (when started with `--pprof`) | `GET /debug/pprof/…` | API Console |
| Built-in index page | `GET /` (early releases) | API Console |
| Authentication (`--authentication=token`) | `Authorization: Bearer` | Connections (token, headers, mTLS) |
| Watch (early releases) | `?watch` | API Console |

## CLI

| Command | Studio |
|---|---|
| `opa eval` | Evaluate (all flags of the release; explanation, metrics, profile, coverage and partial results rendered) |
| `opa test` | Test (results table, coverage, benchmarks, `--run`, `--explain`, …) |
| `opa check` | Check & Format → opa check (strict, schema, capabilities, `--rego-v1`, …) |
| `opa fmt` | Check & Format → opa fmt (list, diff, write, `--rego-v1`, `--v0-v1`, …), Workspace → Format |
| `opa parse` | Parse & Deps → opa parse (JSON / pretty AST, `--json-include`) |
| `opa deps` | Parse & Deps → opa deps |
| `opa bench` | Benchmark |
| `opa build` | Bundles → Build (bundle mode, rego / wasm / plan targets, entrypoints, optimisation, revision, signing) |
| `opa sign` | Bundles → Sign |
| `opa build --verification-key` | Bundles → Verify |
| `opa inspect` | Bundles → Inspect (plus Studio's native inspection) |
| `opa exec` | Exec |
| `opa capabilities` | Built-ins (and download of `opa capabilities --current`) |
| `opa run` (REPL) | REPL |
| `opa run --server` | Local OPA (address, workspace, `--watch`, log level, config file, any extra flag) |
| `opa version` | About, Command Builder |
| `opa completion` and anything else | Command Builder |

## Management APIs (control plane)

Studio implements the server side of OPA's management APIs so OPA agents can be pointed at it:

| OPA plugin | Studio |
|---|---|
| Bundles (`bundles` / legacy `bundle`) | Control Plane → Bundle service: publish workspaces or uploaded archives, ETag / `If-None-Match` caching, download statistics |
| Discovery | Control Plane → Discovery: JSON configuration served as a discovery bundle at a decision path |
| Decision logs | Control Plane → Decision logs: gzip uploads, live tail, search, details |
| Status | Control Plane → Status reports: latest report per agent and history |
| Configuration | Control Plane → OPA config: generated agent configuration, one-click apply to the managed OPA |

## Development workflow

| Task | Studio |
|---|---|
| Edit policies, data, inputs and tests | Workspace |
| Deploy to / pull from a server | Workspace → Deploy / Pull |
| Bundle import / export | Workspace → Import / Export bundle |
| Multiple OPA servers | Connections |
| Release-specific starter policies | New workspace / New policy (dialect of the release) |
| Release capabilities and history | Compatibility |
