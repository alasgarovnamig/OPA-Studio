# Configuration

OPA Studio is configured with command-line flags or `OPA_STUDIO_*` environment variables
(flag beats environment, environment beats default). `opa-studio --help` prints the flags.

## Server

| Flag | Environment | Default | Description |
|---|---|---|---|
| `--addr` | `OPA_STUDIO_ADDR` | `:9080` | Listen address |
| `--tls-cert-file` | `OPA_STUDIO_TLS_CERT_FILE` | | Certificate (PEM); enables HTTPS together with the key |
| `--tls-key-file` | `OPA_STUDIO_TLS_KEY_FILE` | | Private key (PEM) |
| `--data-dir` | `OPA_STUDIO_DATA_DIR` | `./data` (`/var/lib/opa-studio` in the image) | Persistent state: workspaces, connections, control plane, local OPA settings |
| `--public-url` | `OPA_STUDIO_PUBLIC_URL` | derived from the request | Externally reachable URL; used in generated OPA configurations |
| `--log-level` | `OPA_STUDIO_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `--log-format` | `OPA_STUDIO_LOG_FORMAT` | `text` (`json` in the image) | `text` or `json` |
| `--max-body-mb` | `OPA_STUDIO_MAX_BODY_MB` | `64` | Maximum request body |
| `--cors-origins` | `OPA_STUDIO_CORS_ORIGINS` | | Comma separated origins allowed to call the API from other sites |

## Authentication and authorisation

| Flag | Environment | Default | Description |
|---|---|---|---|
| `--auth-mode` | `OPA_STUDIO_AUTH_MODE` | `none` | `none`, `basic` or `token` |
| `--basic-user` | `OPA_STUDIO_BASIC_USER` | `admin` | User for basic auth |
| `--basic-password` | `OPA_STUDIO_BASIC_PASSWORD` | | Password for basic auth (required in basic mode) |
| `--auth-token` | `OPA_STUDIO_AUTH_TOKEN` | | Token for token mode (≥ 16 characters). The UI shows a login form and exchanges it for an HttpOnly cookie |
| `--read-only` | `OPA_STUDIO_READ_ONLY` | `false` | Reject every mutation of OPA servers, workspaces, the control plane and the local OPA. Queries, evaluation and CLI runs stay available |

`/healthz`, `/readyz` and the control-plane endpoints under `/cp` never require Studio authentication;
`/cp` is protected by its own token (below) because OPA agents call it.

## OPA binary and CLI

| Flag | Environment | Default | Description |
|---|---|---|---|
| `--opa-binary` | `OPA_STUDIO_OPA_BINARY` | `opa` on `PATH` | The OPA binary used for CLI features, the REPL and the local server |
| `--cli-sandbox` | `OPA_STUDIO_CLI_SANDBOX` | `true` | Reject absolute paths, `~` and `..` in CLI arguments so commands only see their working copy |
| `--cli-timeout` | `OPA_STUDIO_CLI_TIMEOUT` | `2m` | Maximum duration of one CLI invocation |
| `--cli-concurrency` | `OPA_STUDIO_CLI_CONCURRENCY` | `4` | Concurrent CLI invocations |
| `--cli-max-output-mb` | `OPA_STUDIO_CLI_MAX_OUTPUT_MB` | `16` | Captured stdout/stderr per invocation |
| `--repl-max-sessions` | `OPA_STUDIO_REPL_MAX_SESSIONS` | `8` | Concurrent REPL sessions |
| `--repl-idle-timeout` | `OPA_STUDIO_REPL_IDLE_TIMEOUT` | `15m` | Idle REPL sessions are closed |

CLI commands run in a temporary copy of the workspace with an empty environment (only `HOME`, `PATH`,
`TMPDIR`), so secrets in Studio's environment are never visible to `opa.runtime().env`.

When the binary's version has a measured manifest (every published OPA release), Studio uses it.
For other builds (e.g. `-dev` snapshots) Studio introspects `--help` at startup.

## Managed local OPA

| Flag | Environment | Default | Description |
|---|---|---|---|
| `--local-opa` | `OPA_STUDIO_LOCAL_OPA` | `true` | Enable the managed `opa run --server` process |
| `--local-opa-autostart` | `OPA_STUDIO_LOCAL_OPA_AUTOSTART` | `true` | Start it with Studio (the UI setting is persisted in the data directory) |
| `--local-opa-addr` | `OPA_STUDIO_LOCAL_OPA_ADDR` | `127.0.0.1:8181` | Its listen address. Use `0.0.0.0:8181` and publish the port to reach it from outside the container |
| `--local-opa-args` | `OPA_STUDIO_LOCAL_OPA_ARGS` | | Extra comma separated `opa run` arguments |

Address, loaded workspace, `--watch`, log level, configuration file and extra flags can be changed at runtime
on the **Local OPA** page.

## Connections

| Flag | Environment | Description |
|---|---|---|
| `--connections` | `OPA_STUDIO_CONNECTIONS` | JSON array of connections, or `@/path/to/file.json` |

```json
[
  {
    "id": "prod",
    "name": "Production",
    "url": "https://opa.internal:8181",
    "token": "bearer token for --authentication=token",
    "headers": { "X-Tenant": "acme" },
    "caCert": "-----BEGIN CERTIFICATE-----…",
    "clientCert": "-----BEGIN CERTIFICATE-----…",
    "clientKey": "-----BEGIN PRIVATE KEY-----…",
    "insecureSkipVerify": false
  }
]
```

Configured connections are read-only in the UI. Connections added in the UI are stored in
`<data-dir>/connections.json` with mode `0600`; secrets are never sent to the browser.

## Control plane

| Flag | Environment | Default | Description |
|---|---|---|---|
| `--control-plane-token` | `OPA_STUDIO_CONTROL_PLANE_TOKEN` | | Bearer token OPA agents must present on `/cp/*` |
| `--decision-log-limit` | `OPA_STUDIO_DECISION_LOG_LIMIT` | `10000` | Decision events kept in memory (all events are also appended to `<data-dir>/control/decisions.jsonl`) |
| `--status-limit` | `OPA_STUDIO_STATUS_LIMIT` | `1000` | Status reports kept in memory |

Agent endpoints:

| Path | Used by |
|---|---|
| `GET /cp/bundles/{name}` | bundles plugin (`resource: bundles/{name}`) |
| `GET /cp/discovery/{name}` | discovery plugin (`resource: discovery/{name}`) |
| `POST /cp/logs` | decision_logs plugin |
| `POST /cp/status` | status plugin |

## Proxy

| Flag | Environment | Default | Description |
|---|---|---|---|
| `--proxy-timeout` | `OPA_STUDIO_PROXY_TIMEOUT` | `60s` | Timeout of requests forwarded to OPA servers |

`HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` are honoured for outbound connections.
