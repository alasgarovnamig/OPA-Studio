# Compatibility methodology

OPA Studio supports **every OPA release ever published** — 216 versions from v0.1.0 (July 2016) to the
newest release — and publishes one Studio release per OPA release. The list is in [VERSIONS.md](VERSIONS.md).

## Which versions are included

* Every GitHub release of `open-policy-agent/opa`, including the published pre-release `v0.19.0-rc1`.
* Every stable upstream tag that never became a GitHub release but was published as an official Docker image:
  `v0.13.1`, `v0.29.0`, `v0.46.0`.
* Release-candidate tags that were never published (`v0.1.0-rc1…rc3`, `v0.9.3-rc1…rc3`, `v0.25.0-rc1…rc4`,
  `v0.30.0-rc0`) have no binaries and are therefore not releases.

## How capabilities are measured

`tools/introspect/run_all.py` downloads the official binary of each release (GitHub assets, or the Docker image
for the three image-only tags), runs it inside a Linux container and records:

1. **CLI** — `opa help` and `opa <cmd> --help` for every command and subcommand → commands, flags, types,
   defaults, usage.
2. **Rego dialects** — seven variants of the same policy (Datalog `:-` rules with and without `input`, classic
   unification, classic with `:=`/`==`, `future.keywords`, `import rego.v1`, Rego v1) are compiled by
   `opa check` and uploaded through the Policy API. The first accepted one is the release's *preferred dialect*.
3. **REST API** — a fresh `opa run --server` is probed with ~40 requests (Policy, Data, Query, Compile, Health,
   Config, Status, Metrics APIs and their options). A JSON 404 counts as "route exists"; a text 404 as "no route".
4. **Built-ins** — `opa capabilities --current` where available (v0.40.0+).
5. **Quirks** — behaviour that breaks tooling, e.g. OPA v0.11.0 keeps the store locked after a rejected policy
   upload.

`tools/introspect/validate_all.py` then proves that the example workspace written in each release's dialect
passes `opa check`, `opa test`, `opa eval` and is served correctly by `opa run --server` on that release.

## Dialect timeline (measured)

| OPA releases | Preferred dialect | Also accepted |
|---|---|---|
| v0.1.0 – v0.4.0 | Datalog-style rules (`head :- body`), no `input` document | — |
| v0.4.1 | Datalog-style rules with `input` | no-input Datalog |
| v0.4.2 – v0.6.x | Classic Rego, unification (`=`) | — |
| v0.7.0 – v0.41.x | Classic Rego with `:=` and `==` | unification |
| v0.42.0 – v0.58.x | `future.keywords` (`if`, `contains`, `in`, `every`) | classic Rego |
| v0.59.0 – v0.70.0 | `import rego.v1` | `future.keywords`, classic Rego |
| v1.0.0 and later | Rego v1 (default) | `import rego.v1`, `future.keywords`; v0 syntax only with `--v0-compatible` |

## Milestones (measured)

| Capability | First release |
|---|---|
| `opa run` (server + REPL), Policy API, Query API (GET), Data API PATCH | v0.1.0 |
| Data API: read root document, PUT | v0.2.0 |
| Data API: POST with request body | v0.4.0 |
| `input` document | v0.4.1 |
| v0 webhook (`POST /v0/data`) | v0.4.9 |
| `opa fmt`, `opa check` | v0.5.0 |
| Default decision (`POST /`) | v0.5.2 |
| `opa test` | v0.5.7 |
| Data API DELETE, Prometheus `/metrics` | v0.7.0 |
| `opa eval`, `opa parse` | v0.8.0 |
| Compile API (partial evaluation) | v0.9.0 |
| `opa deps` | v0.9.2 |
| `opa build`, Query API POST | v0.10.0 |
| Health API (incl. `?bundles`, `?plugins`) | v0.10.3 |
| `opa bench` | v0.18.0 |
| `opa sign` | v0.22.0 |
| Config API | v0.28.0 |
| `opa completion` | v0.31.0 |
| Custom health checks (`/health/live`, `/health/ready`) | v0.33.0 |
| `opa exec`, Status API | v0.36.0 |
| `opa inspect` | v0.37.0 |
| `opa capabilities` (built-in catalogue) | v0.40.0 |
| `import rego.v1` | v0.59.0 |
| Rego v1 by default | v1.0.0 |
| Data filtering (`POST /v1/compile/{path}` → UCAST / SQL) | v1.9.0 |

The **Compatibility** page in Studio shows the full matrix and the per-release changes interactively.
