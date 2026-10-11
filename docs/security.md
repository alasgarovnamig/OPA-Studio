# Security guide

OPA Studio is an administration tool: whoever can use it can change policies on the OPA servers it is
connected to. Treat access to Studio like access to those servers.

## Recommended production settings

```bash
OPA_STUDIO_AUTH_MODE=token                     # or basic
OPA_STUDIO_AUTH_TOKEN=$(openssl rand -hex 32)
OPA_STUDIO_TLS_CERT_FILE=/etc/tls/tls.crt      # or terminate TLS at a reverse proxy
OPA_STUDIO_TLS_KEY_FILE=/etc/tls/tls.key
OPA_STUDIO_CONTROL_PLANE_TOKEN=$(openssl rand -hex 32)
OPA_STUDIO_CLI_SANDBOX=true                    # default
OPA_STUDIO_READ_ONLY=true                      # for audit / observer deployments
```

## Controls built into Studio

| Area | Control |
|---|---|
| Authentication | `basic` or `token` mode; constant-time comparison; token sessions use an HttpOnly, SameSite=Strict cookie |
| Read-only mode | Blocks writes to OPA servers (PUT/PATCH/DELETE through the proxy, deploy), workspaces, the control plane and the local OPA |
| Browser hardening | Strict Content-Security-Policy (no third-party origins), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer` |
| Secrets | Connection tokens, client keys and sensitive headers are stored with mode 0600 and never returned to the browser |
| CLI sandbox | Commands run in a temporary copy of the workspace; absolute paths, `~` and `..` are rejected; the environment is emptied so `opa.runtime().env` cannot read Studio's secrets; timeouts, output caps and a concurrency limit apply |
| Workspaces | Path traversal and hidden files are rejected; writes are atomic |
| Archives | Bundle extraction enforces per-file and total size limits and rejects unsafe paths |
| Control plane | Separate bearer token for agents; decompressed payload size is bounded |
| Request limits | Body size limit (`OPA_STUDIO_MAX_BODY_MB`), header timeout, idle timeout |
| Container | Runs as UID 10001, works with a read-only root filesystem, `tini` as PID 1, health check without extra tools |

## Network exposure

* The managed local OPA listens on `127.0.0.1:8181` inside the container by default. Expose it deliberately
  (`OPA_STUDIO_LOCAL_OPA_ADDR=0.0.0.0:8181`) and protect it with OPA's own `--authentication` /
  `--authorization` flags (*Local OPA → Extra flags*).
* `/cp/*` must be reachable by OPA agents; set `OPA_STUDIO_CONTROL_PLANE_TOKEN` whenever it is reachable from
  untrusted networks.
* When Studio runs behind a reverse proxy, set `OPA_STUDIO_PUBLIC_URL` so generated configurations point to
  the public address.

## Reporting vulnerabilities

See [SECURITY.md](../SECURITY.md).
