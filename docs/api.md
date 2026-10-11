# OPA Studio HTTP API

The UI uses this API; it is stable within a release and can be scripted. All `/api` endpoints require the
configured authentication. Responses are JSON unless noted.

## Information

| Method | Path | Description |
|---|---|---|
| GET | `/healthz`, `/readyz` | Liveness / readiness (no auth) |
| GET | `/api/info` | Studio build, OPA binary, settings and the active manifest |
| GET | `/api/manifest` | Manifest of the bundled OPA binary |
| GET | `/api/versions` | Every tracked OPA release |
| GET | `/api/versions/summary` | Compact capability matrix of every release |
| GET | `/api/versions/{version}/manifest` | Measured manifest of one release |
| POST / DELETE | `/api/auth` | Token mode: exchange the token for a session cookie / sign out |

## Connections and the OPA proxy

| Method | Path | Description |
|---|---|---|
| GET / POST | `/api/connections` | List / create (secrets are masked in responses) |
| GET / PUT / DELETE | `/api/connections/{id}` | Read / update / delete a user connection |
| POST | `/api/connections/{id}/test` | Reachability, health and version detection |
| ANY | `/api/connections/{id}/proxy/{path}` | Forwards the request to `{url}/{path}?{query}` with the connection's credentials |

Proxy details: `Content-Type`, `Accept`, `If-None-Match`, `If-Match`, `Content-Encoding` and `Accept-Encoding`
are forwarded; any other header can be sent as `X-Opa-Header-<Name>`. Responses carry
`X-Studio-Upstream-Status`, `X-Studio-Duration-Ms` and `X-Studio-Target`. A `502` with
`{"studioProxyError": true}` means OPA was unreachable.

## CLI

`POST /api/cli/run`

```json
{
  "args": ["eval", "-d", ".", "--format", "json", "data.app.rbac.allow"],
  "workspace": "default",
  "files": { "input.json": "{\"user\":\"bob\"}" },
  "binaryFiles": { "bundle.tar.gz": "<base64>" },
  "stdin": "",
  "timeoutSeconds": 30,
  "collect": ["bundle.tar.gz", "*.json"],
  "writeBack": false
}
```

Response: `command`, `exitCode`, `stdout`, `stderr`, `durationMs`, `timedOut`, `truncated`,
`files` (collected outputs, text or base64) and `changed` (workspace files modified by the command;
saved back when `writeBack` is true). `opa run` is rejected here — use the REPL or Local OPA endpoints.
`GET /api/cli/commands` returns the command tree of the binary.

## Workspaces

| Method | Path | Description |
|---|---|---|
| GET / POST | `/api/workspaces` | List / create (`{"name", "description", "template": "rbac" \| "empty", "files"}`) |
| GET / PUT / DELETE | `/api/workspaces/{ws}` | Read / rename / delete |
| GET | `/api/workspaces/{ws}/files[?content=true]` | File list (optionally with contents) |
| GET / PUT / DELETE | `/api/workspaces/{ws}/files/{path}` | Read / write (raw body) / delete a file |
| POST | `/api/workspaces/{ws}/rename` | `{"from", "to"}` |
| GET | `/api/workspaces/{ws}/export[?revision=]` | Download as bundle (`application/gzip`) |
| POST | `/api/workspaces/{ws}/import` | Upload a bundle archive (raw body) |
| POST | `/api/workspaces/{ws}/deploy` | `{"connection", "policies", "data", "dataPrefix", "includeTests"}` |
| POST | `/api/workspaces/{ws}/pull` | `{"connection", "policies", "data", "dataPath"}` |
| POST | `/api/bundles/inspect` | Inspect an uploaded archive (raw body) |

## Local OPA

| Method | Path | Description |
|---|---|---|
| GET | `/api/local-opa` | State, settings and the command line that will be executed |
| PUT | `/api/local-opa/settings` | `{"addr", "autostart", "extraArgs", "config", "workspace", "watch", "logLevel", "restartOnFailure"}` |
| POST | `/api/local-opa/{start\|stop\|restart}` | Process control |
| GET / DELETE | `/api/local-opa/logs[?after=seq]` | Buffered output / clear |
| GET | `/api/local-opa/logs/stream` | Server-Sent Events |

## REPL

| Method | Path | Description |
|---|---|---|
| GET / POST | `/api/repl` | List / start (`{"workspace", "args"}`) |
| POST | `/api/repl/{id}/input` | `{"line"}` |
| GET | `/api/repl/{id}/events[?after=seq]` | Buffered output |
| GET | `/api/repl/{id}/stream` | Server-Sent Events |
| DELETE | `/api/repl/{id}` | Terminate |

## Control plane management

| Method | Path | Description |
|---|---|---|
| GET | `/api/control/bundles` | Published bundles with fetch statistics |
| POST | `/api/control/bundles/{name}` | Publish: JSON `{"workspace", "revision", "roots", "metadata"}` or a raw archive |
| DELETE | `/api/control/bundles/{name}` | Unpublish |
| GET | `/api/control/bundles/{name}/download`, `/inspect` | Archive / contents |
| GET / PUT / DELETE | `/api/control/discovery[/{name}]` | Discovery documents `{"decision", "config"}` |
| GET / DELETE | `/api/control/decisions[?path=&search=&limit=&offset=]` | Decision logs |
| GET | `/api/control/decisions/stream` | Live decision logs (SSE) |
| GET / DELETE | `/api/control/status[?instance=&limit=]` | Status reports |
| GET | `/api/control/instances` | Latest report per agent |
| GET | `/api/control/config?bundle=&discovery=&decisionLogs=&status=&style=legacy` | Generated OPA configuration (YAML) |

## Agent endpoints

`GET /cp/bundles/{name}`, `GET /cp/discovery/{name}`, `POST /cp/logs`, `POST /cp/status` — see
[configuration.md](configuration.md#control-plane).
