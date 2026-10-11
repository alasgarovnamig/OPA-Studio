# Architecture

OPA Studio is a single Go binary that embeds a React single-page application. It drives OPA in three ways:
through OPA's REST API (any number of servers), through the OPA CLI binary it ships with, and by acting as
the control plane that OPA agents talk to.

```mermaid
flowchart LR
  subgraph Browser
    UI[React SPA<br/>web/]
  end
  subgraph Studio[opa-studio]
    API[HTTP API<br/>internal/api]
    PX[REST proxy]
    CLI[CLI runner<br/>sandboxed]
    REPL[REPL sessions]
    LOCAL[Local OPA manager]
    WS[(Workspaces)]
    CP[Control plane<br/>bundles · discovery<br/>decision logs · status]
    MF[Measured manifests<br/>versions/]
  end
  OPAS[(OPA servers)]
  BIN[[opa binary]]
  AG[OPA agents]

  UI -- /api --> API
  API --> PX --> OPAS
  API --> CLI --> BIN
  API --> REPL --> BIN
  API --> LOCAL -- opa run --server --> BIN
  CLI --> WS
  API --> WS
  API --> CP
  AG -- /cp/bundles, /cp/discovery --> CP
  AG -- /cp/logs, /cp/status --> CP
  API --> MF
```

## Components

| Package | Responsibility |
|---|---|
| `cmd/opa-studio` | Configuration, wiring, graceful shutdown, `healthcheck` sub-command |
| `internal/config` | Flags and `OPA_STUDIO_*` environment variables, validation |
| `internal/manifest` | Embedded per-release manifests, cobra help parser, live introspection for unknown builds |
| `internal/opacli` | Runs `opa` in a temporary copy of a workspace with a scrubbed environment, timeouts, output caps, file collection and sandbox rules |
| `internal/localopa` | Supervises `opa run --server` (version-aware flags, restart on failure, log streaming) |
| `internal/repl` | Interactive `opa run` sessions streamed over Server-Sent Events |
| `internal/workspace` | File-based projects with path-traversal protection and atomic writes |
| `internal/bundle` | Native bundle reader/writer (deterministic archives for stable ETags) |
| `internal/controlplane` | Bundle/discovery service, decision-log and status ingestion |
| `internal/store` | Connection store (mode 0600) |
| `internal/api` | HTTP handlers, OPA proxy, deploy/pull, templates per Rego dialect |
| `internal/server` | Middleware: authentication, read-only mode, CORS, security headers, logging, SPA serving |
| `web/` | React + TypeScript UI (CodeMirror 6 editors, no runtime CDN dependencies) |

## Version awareness

Every OPA release behaves differently: the first releases only had `opa run`, Rego used Datalog-style rules
and had no `input` document; the Compile API arrived in v0.9.0, the Health API in v0.10.3, the Config API in
v0.28.0; Rego v1 became the default in v1.0.0. Studio does not hard-code any of this.

`tools/introspect` downloads every OPA release, runs it in a sandbox and records a manifest:

* the CLI command tree and every flag (parsed from `--help`),
* which Rego dialects the parser accepts,
* how ~40 REST endpoints respond,
* the built-in catalogue (`opa capabilities`) when available,
* quirks such as v0.11.0's write lock after a rejected policy upload.

The manifests are embedded in the binary. The UI gates every page, option and preset on the manifest of the
bundled binary (CLI features) or of the connected server's version (REST features).

## Releases

Each OPA release has an OPA Studio release with the same tag. A release commit stamps the version in
`OPA_VERSION`, `internal/buildinfo`, the Dockerfile and the deployment manifests, and adds a README with
screenshots captured against that OPA release. The release workflow builds binaries and a container image
that bundles the matching OPA binary.
