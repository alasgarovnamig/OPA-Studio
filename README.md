<p align="center"><img src="docs/assets/logo.svg" width="84" alt="OPA Studio"></p>

<h1 align="center">OPA Studio <code>v0.64.0</code></h1>

<p align="center"><b>The web UI for every Open Policy Agent operation — built, tested and documented for <a href="https://github.com/open-policy-agent/opa/releases/tag/v0.64.0">OPA v0.64.0</a>.</b></p>

<p align="center"><img alt="OPA" src="https://img.shields.io/badge/OPA-0.64.0-0d9488"> <img alt="released" src="https://img.shields.io/badge/OPA%20released-2024--04--25-64748b"> <img alt="dialect" src="https://img.shields.io/badge/Rego-Rego%20with%20import%20rego.v1-7c3aed"> <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-Apache--2.0-2563eb"></a></p>

> **One Studio release per OPA release.** This is tag [`v0.64.0`](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.64.0) of OPA Studio and it targets **OPA v0.64.0** exactly: the image bundles that OPA binary, the UI only offers what that release can do, and the example workspace is written in its Rego dialect. Using another OPA version? Pick the matching tag in [docs/VERSIONS.md](https://github.com/alasgarovnamig/OPA-Studio/blob/main/docs/VERSIONS.md).

<p align="center"><a href="https://github.com/alasgarovnamig/OPA-Studio/tree/v0.63.0">← v0.63.0</a> · <a href="https://github.com/alasgarovnamig/OPA-Studio/blob/main/docs/VERSIONS.md">All versions</a> · <a href="https://github.com/alasgarovnamig/OPA-Studio/tree/v0.64.1">v0.64.1 →</a></p>

OPA Studio lets you do everything OPA can do from a browser: manage policies and data on any number of OPA servers, evaluate, test, format, benchmark, build and sign policies with the OPA CLI, use the REPL, and act as the control plane OPA agents download bundles from and report decisions and status to. Nothing you can do with OPA v0.64.0 is out of reach — see the [feature coverage](docs/feature-coverage.md).

**Docs:** [Feature coverage](docs/feature-coverage.md) · [Compatibility](docs/compatibility.md) · [Configuration](docs/configuration.md) · [Security](docs/security.md) · [HTTP API](docs/api.md) · [Architecture](docs/architecture.md) · [Development](docs/development.md)

<p align="center"><img src="docs/screenshots/01-dashboard.webp" alt="Dashboard" width="900"></p>

## Contents

- [Quick start](#quick-start)
- [What OPA v0.64.0 can do](#what-opa-v0640-can-do)
- [What changed in OPA v0.64.0](#what-changed-in-opa-v0640)
- [Guided tour](#guided-tour)
- [Connect OPA agents to Studio](#connect-opa-agents-to-studio)
- [Configuration](#configuration)
- [Verification](#verification)
- [Build from source](#build-from-source)
- [Other OPA versions](#other-opa-versions)

## Quick start

Build the image from this tag and run it — Docker is the only requirement:

```bash
git clone --branch v0.64.0 --single-branch https://github.com/alasgarovnamig/OPA-Studio.git opa-studio-v0.64.0
cd opa-studio-v0.64.0
docker build -t opa-studio:v0.64.0 .
docker run --rm -p 9080:9080 -v opa-studio-data:/var/lib/opa-studio opa-studio:v0.64.0
```

Open <http://localhost:9080>. Studio starts a managed OPA v0.64.0 server, creates an example workspace and connects to it.

> The image builds natively on `linux/amd64` and `linux/arm64` (including Apple Silicon).

Connect to your own OPA v0.64.0 servers as well (and protect Studio with a password):

```bash
docker run --rm -p 9080:9080 -v opa-studio-data:/var/lib/opa-studio \
  -e OPA_STUDIO_CONNECTIONS='[{"id":"prod","name":"Production","url":"http://opa.internal:8181","token":"…"}]' \
  -e OPA_STUDIO_AUTH_MODE=basic -e OPA_STUDIO_BASIC_PASSWORD='change-me' \
  opa-studio:v0.64.0
```

With Docker Compose (builds the same image and starts an OPA agent wired to Studio's control plane): `OPA_STUDIO_BASIC_PASSWORD=change-me docker compose -f deploy/docker-compose.yml up --build`.

<details><summary>Prebuilt images and binaries</summary>

When the repository's release workflow has published this tag, the image can be pulled instead of built:

```bash
docker run --rm -p 9080:9080 -v opa-studio-data:/var/lib/opa-studio ghcr.io/alasgarovnamig/opa-studio:v0.64.0
```

The [GitHub release](https://github.com/alasgarovnamig/OPA-Studio/releases/tag/v0.64.0) then also carries archives with `opa-studio` and the matching `opa` binary for: `linux/amd64`, `linux/arm64`, `darwin/arm64`, `windows/amd64`.

If the pull fails with `denied`, the image has not been published yet — build it as shown above.

</details>

## What OPA v0.64.0 can do

Measured by running the official OPA v0.64.0 binary (`75cc90abee5e`, go1.22.2). Studio enables exactly these features.

### Rego dialect: Rego with `import rego.v1`

The v1 syntax is opted into per module with `import rego.v1`; v0 syntax keeps working.

The example workspace Studio creates for this release (`app/rbac.rego`):

```rego
package app.rbac

import rego.v1

# Role-based access control example shipped with OPA Studio.

default allow := false

# Admins may do anything.
allow if user_is_admin

# Everybody else needs a grant for the action and type.
allow if {
	some grant in user_is_granted
	input.action == grant.action
	input.type == grant.type
}

user_is_admin if "admin" in data.rbac.user_roles[input.user]

user_is_granted contains grant if {
	some role in data.rbac.user_roles[input.user]
	some grant in data.rbac.role_grants[role]
}

reasons contains msg if {
	not allow
	msg := sprintf("%s may not %s %s", [input.user, input.action, input.type])
}
```

### CLI commands (14)

| Command | Description | Flags | Studio page |
|---|---|---|---|
| `opa bench` | Benchmark a Rego query | 23 | Benchmark · Command Builder |
| `opa build` | Build an OPA bundle | 21 | Bundles · Command Builder |
| `opa capabilities` | Print the capabilities of OPA | 4 | Built-ins · Command Builder |
| `opa check` | Check Rego source files | 10 | Check & Format · Command Builder |
| `opa deps` | Analyze Rego query dependencies | 6 | Parse & Deps · Command Builder |
| `opa eval` | Evaluate a Rego query | 37 | Evaluate · Command Builder |
| `opa exec` | Execute against input files | 15 | Exec · Command Builder |
| `opa fmt` | Format Rego source files | 7 | Check & Format · Command Builder |
| `opa inspect` | Inspect OPA bundle(s) | 4 | Bundles · Command Builder |
| `opa parse` | Parse Rego source file | 4 | Parse & Deps · Command Builder |
| `opa run` | Start OPA in interactive or server mode | 39 | Local OPA, REPL · Command Builder |
| `opa sign` | Generate an OPA bundle signature | 7 | Bundles · Command Builder |
| `opa test` | Execute Rego test cases | 20 | Test · Command Builder |
| `opa version` | Print the version of OPA | 2 | About · Command Builder |

<details><summary>All flags of every command</summary>

**opa bench**

| Flag | Type | Description |
|---|---|---|
| `--benchmem` | `bool` | report memory allocations with benchmark results (default true) |
| `--bundle` `-b` | `string` | set bundle file(s) or directory path(s). This flag can be repeated. |
| `--config-file` `-c` | `string` | set path of configuration file |
| `--count` | `int` | number of times to repeat each benchmark (default 1) |
| `--data` `-d` | `string` | set policy or data file(s). This flag can be repeated. |
| `--e2e` | `bool` | run benchmarks against a running OPA server |
| `--fail` | `bool` | exits with non-zero exit code on undefined/empty result and errors (default true) |
| `--format` `-f` | `{json,pretty,gobench}` | set output format (default pretty) |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--import` | `string` | set query import(s). This flag can be repeated. |
| `--input` `-i` | `string` | set input file path |
| `--metrics` | `bool` | report query performance metrics (default true) |
| `--package` | `string` | set query package |
| `--partial` `-p` | `bool` | perform partial evaluation |
| `--schema` `-s` | `string` | set schema file path or directory path |
| `--shutdown-grace-period` | `int` | set the time (in seconds) that the server will wait to gracefully shut down. This flag is valid in 'e2e' mode only. (default 10) |
| `--shutdown-wait-period` | `int` | set the time (in seconds) that the server will wait before initiating shutdown. This flag is valid in 'e2e' mode only. |
| `--stdin` | `bool` | read query from stdin |
| `--stdin-input` `-I` | `bool` | read input document from stdin |
| `--target` `-t` | `{rego,wasm}` | set the runtime to exercise (default rego) |
| `--unknowns` `-u` | `stringArray` | set paths to treat as unknown during partial evaluation (default [input]) |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |

**opa build**

| Flag | Type | Description |
|---|---|---|
| `--bundle` `-b` | `bool` | load paths as bundle files or root directories |
| `--capabilities` | `string` | set capabilities version or capabilities.json file path |
| `--claims-file` | `string` | set path of JSON file containing optional claims (see: https://www.openpolicyagent.org/docs/latest/management-bundles/#signature-format) |
| `--debug` | `bool` | enable debug output |
| `--entrypoint` `-e` | `string` | set slash separated entrypoint path |
| `--exclude-files-verify` | `strings` | set file names to exclude during bundle verification |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--optimize` `-O` | `int` | set optimization level |
| `--output` `-o` | `string` | set the output filename (default "bundle.tar.gz") |
| `--partial-namespace` | `string` | set the namespace to use for partially evaluated files in an optimized bundle (default "partial") |
| `--prune-unused` | `bool` | exclude dependents of entrypoints |
| `--revision` `-r` | `string` | set output bundle revision |
| `--scope` | `string` | scope to use for bundle signature verification |
| `--signing-alg` | `string` | name of the signing algorithm (default "RS256") |
| `--signing-key` | `string` | set the secret (HMAC) or path of the PEM file containing the private key (RSA and ECDSA) |
| `--signing-plugin` | `string` | name of the plugin to use for signing/verification (see https://www.openpolicyagent.org/docs/latest/management-bundles/#signature-plugin |
| `--target` `-t` | `{rego,wasm,plan}` | set the output bundle target type (default rego) |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |
| `--verification-key` | `string` | set the secret (HMAC) or path of the PEM file containing the public key (RSA and ECDSA) |
| `--verification-key-id` | `string` | name assigned to the verification key used for bundle verification (default "default") |

**opa capabilities**

| Flag | Type | Description |
|---|---|---|
| `--current` | `bool` | print current capabilities |
| `--file` | `string` | print current capabilities |
| `--version` | `string` | print capabilities of a specific version |

**opa check**

| Flag | Type | Description |
|---|---|---|
| `--bundle` `-b` | `bool` | load paths as bundle files or root directories |
| `--capabilities` | `string` | set capabilities version or capabilities.json file path |
| `--format` `-f` | `{pretty,json}` | set output format (default pretty) |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--max-errors` `-m` | `int` | set the number of errors to allow before compilation fails early (default 10) |
| `--rego-v1` | `bool` | check for Rego v1 compatibility (policies must also be compatible with current OPA version) |
| `--schema` `-s` | `string` | set schema file path or directory path |
| `--strict` `-S` | `bool` | enable compiler strict mode |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |

**opa deps**

| Flag | Type | Description |
|---|---|---|
| `--bundle` `-b` | `string` | set bundle file(s) or directory path(s). This flag can be repeated. |
| `--data` `-d` | `string` | set policy or data file(s). This flag can be repeated. |
| `--format` `-f` | `{pretty,json}` | set output format (default pretty) |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |

**opa eval**

| Flag | Type | Description |
|---|---|---|
| `--bundle` `-b` | `string` | set bundle file(s) or directory path(s). This flag can be repeated. |
| `--capabilities` | `string` | set capabilities version or capabilities.json file path |
| `--count` | `int` | number of times to repeat each benchmark (default 1) |
| `--coverage` | `bool` | report coverage |
| `--data` `-d` | `string` | set policy or data file(s). This flag can be repeated. |
| `--disable-early-exit` | `bool` | disable 'early exit' optimizations |
| `--disable-indexing` | `bool` | disable indexing optimizations |
| `--disable-inlining` | `stringArray` | set paths of documents to exclude from inlining |
| `--entrypoint` `-e` | `string` | set slash separated entrypoint path |
| `--explain` | `{off,full,notes,fails,debug}` | enable query explanations (default off) |
| `--fail` | `bool` | exits with non-zero exit code on undefined/empty result and errors |
| `--fail-defined` | `bool` | exits with non-zero exit code on defined/non-empty result and errors |
| `--format` `-f` | `{json,values,bindings,pretty,source,raw,discard}` | set output format (default json) |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--import` | `string` | set query import(s). This flag can be repeated. |
| `--input` `-i` | `string` | set input file path |
| `--instrument` | `bool` | enable query instrumentation metrics (implies --metrics) |
| `--metrics` | `bool` | report query performance metrics |
| `--optimize` `-O` | `int` | set optimization level |
| `--package` | `string` | set query package |
| `--partial` `-p` | `bool` | perform partial evaluation |
| `--pretty-limit` | `int` | set limit after which pretty output gets truncated (default 80) |
| `--profile` | `bool` | perform expression profiling |
| `--profile-limit` | `int` | set number of profiling results to show (default 10) |
| `--profile-sort` | `string` | set sort order of expression profiler results. Accepts: total_time_ns, num_eval, num_redo, num_gen_expr, file, line. This flag can be repeated. |
| `--schema` `-s` | `string` | set schema file path or directory path |
| `--shallow-inlining` | `bool` | disable inlining of rules that depend on unknowns |
| `--show-builtin-errors` | `bool` | collect and return all encountered built-in errors, built in errors are not fatal |
| `--stdin` | `bool` | read query from stdin |
| `--stdin-input` `-I` | `bool` | read input document from stdin |
| `--strict` `-S` | `bool` | enable compiler strict mode |
| `--strict-builtin-errors` | `bool` | treat the first built-in function error encountered as fatal |
| `--target` `-t` | `{rego,wasm}` | set the runtime to exercise (default rego) |
| `--timeout` | `duration` | set eval timeout (default unlimited) |
| `--unknowns` `-u` | `stringArray` | set paths to treat as unknown during partial evaluation (default [input]) |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |

**opa exec**

| Flag | Type | Description |
|---|---|---|
| `--bundle` `-b` | `string` | set bundle file(s) or directory path(s). This flag can be repeated. |
| `--config-file` `-c` | `string` | set path of configuration file |
| `--decision` | `string` | set decision to evaluate |
| `--fail` | `bool` | exits with non-zero exit code on undefined result and errors |
| `--fail-defined` | `bool` | exits with non-zero exit code on defined result and errors |
| `--fail-non-empty` | `bool` | exits with non-zero exit code on non-empty result and errors |
| `--format` `-f` | `{pretty,json}` | set output format (default pretty) |
| `--log-format` | `{text,json,json-pretty}` | set log format (default json) |
| `--log-level` `-l` | `{debug,info,error}` | set log level (default error) |
| `--log-timestamp-format` | `string` | set log timestamp format (OPA_LOG_TIMESTAMP_FORMAT environment variable) |
| `--set` | `stringArray` | override config values on the command line (use commas to specify multiple values) |
| `--set-file` | `stringArray` | override config values with files on the command line (use commas to specify multiple values) |
| `--timeout` | `duration` | set exec timeout with a Go-style duration, such as '5m 30s'. (default unlimited) |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |

**opa fmt**

| Flag | Type | Description |
|---|---|---|
| `--diff` `-d` | `bool` | only display a diff of the changes |
| `--fail` | `bool` | non zero exit code on reformat |
| `--list` `-l` | `bool` | list all files who would change when formatted |
| `--rego-v1` | `bool` | format module(s) to be compatible with both Rego v1 and current OPA version) |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |
| `--write` `-w` | `bool` | overwrite the original source file |

**opa inspect**

| Flag | Type | Description |
|---|---|---|
| `--annotations` `-a` | `bool` | list annotations |
| `--format` `-f` | `{json,pretty}` | set output format (default pretty) |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |

**opa parse**

| Flag | Type | Description |
|---|---|---|
| `--format` `-f` | `{pretty,json}` | set output format (default pretty) |
| `--json-include` | `string` | include or exclude optional elements. By default comments are included. Current options: locations, comments. E.g. --json-include locations,-comments will include locations and exclude comments. |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |

**opa run**

| Flag | Type | Description |
|---|---|---|
| `--addr` `-a` | `strings` | set listening address of the server (e.g., [ip]:<port> for TCP, unix://<path> for UNIX domain socket) (default [:8181]) |
| `--authentication` | `{token,tls,off}` | set authentication scheme (default off) |
| `--authorization` | `{basic,off}` | set authorization scheme (default off) |
| `--bundle` `-b` | `bool` | load paths as bundle files or root directories |
| `--config-file` `-c` | `string` | set path of configuration file |
| `--diagnostic-addr` | `strings` | set read-only diagnostic listening address of the server for /health and /metric APIs (e.g., [ip]:<port> for TCP, unix://<path> for UNIX domain socket) |
| `--disable-telemetry` | `bool` | disables anonymous information reporting (see: https://www.openpolicyagent.org/docs/latest/privacy) |
| `--exclude-files-verify` | `strings` | set file names to exclude during bundle verification |
| `--format` `-f` | `string` | set shell output format, i.e, pretty, json (default "pretty") |
| `--h2c` | `bool` | enable H2C for HTTP listeners |
| `--history` `-H` | `string` | set path of history file (default "/root/.opa_history") |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--log-format` | `{text,json,json-pretty}` | set log format (default json) |
| `--log-level` `-l` | `{debug,info,error}` | set log level (default info) |
| `--log-timestamp-format` | `string` | set log timestamp format (OPA_LOG_TIMESTAMP_FORMAT environment variable) |
| `--max-errors` `-m` | `int` | set the number of errors to allow before compilation fails early (default 10) |
| `--min-tls-version` | `{1.0,1.1,1.2,1.3}` | set minimum TLS version to be used by OPA's server (default 1.2) |
| `--pprof` | `bool` | enables pprof endpoints |
| `--ready-timeout` | `int` | wait (in seconds) for configured plugins before starting server (value <= 0 disables ready check) |
| `--scope` | `string` | scope to use for bundle signature verification |
| `--server` `-s` | `bool` | start the runtime in server mode |
| `--set` | `stringArray` | override config values on the command line (use commas to specify multiple values) |
| `--set-file` | `stringArray` | override config values with files on the command line (use commas to specify multiple values) |
| `--shutdown-grace-period` | `int` | set the time (in seconds) that the server will wait to gracefully shut down (default 10) |
| `--shutdown-wait-period` | `int` | set the time (in seconds) that the server will wait before initiating shutdown |
| `--signing-alg` | `string` | name of the signing algorithm (default "RS256") |
| `--skip-known-schema-check` | `bool` | disables type checking on known input schemas |
| `--skip-verify` | `bool` | disables bundle signature verification |
| `--tls-ca-cert-file` | `string` | set path of TLS CA cert file |
| `--tls-cert-file` | `string` | set path of TLS certificate file |
| `--tls-cert-refresh-period` | `duration` | set certificate refresh period |
| `--tls-cipher-suites` | `strings` | set list of enabled TLS 1.0–1.2 cipher suites (IANA) |
| `--tls-private-key-file` | `string` | set path of TLS private key file |
| `--unix-socket-perm` | `string` | specify the permissions for the Unix domain socket if used to listen for incoming connections (default "755") |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |
| `--verification-key` | `string` | set the secret (HMAC) or path of the PEM file containing the public key (RSA and ECDSA) |
| `--verification-key-id` | `string` | name assigned to the verification key used for bundle verification (default "default") |
| `--watch` `-w` | `bool` | watch command line files for changes |

**opa sign**

| Flag | Type | Description |
|---|---|---|
| `--bundle` `-b` | `bool` | load paths as bundle files or root directories |
| `--claims-file` | `string` | set path of JSON file containing optional claims (see: https://www.openpolicyagent.org/docs/latest/management-bundles/#signature-format) |
| `--output-file-path` `-o` | `string` | set the location for the .signatures.json file (default ".") |
| `--signing-alg` | `string` | name of the signing algorithm (default "RS256") |
| `--signing-key` | `string` | set the secret (HMAC) or path of the PEM file containing the private key (RSA and ECDSA) |
| `--signing-plugin` | `string` | name of the plugin to use for signing/verification (see https://www.openpolicyagent.org/docs/latest/management-bundles/#signature-plugin |

**opa test**

| Flag | Type | Description |
|---|---|---|
| `--bench` | `bool` | benchmark the unit tests |
| `--benchmem` | `bool` | report memory allocations with benchmark results (default true) |
| `--bundle` `-b` | `bool` | load paths as bundle files or root directories |
| `--capabilities` | `string` | set capabilities version or capabilities.json file path |
| `--count` | `int` | number of times to repeat each test (default 1) |
| `--coverage` `-c` | `bool` | report coverage (overrides debug tracing) |
| `--exit-zero-on-skipped` `-z` | `bool` | skipped tests return status 0 |
| `--explain` | `{fails,full,notes,debug}` | enable query explanations (default fails) |
| `--format` `-f` | `{pretty,json,gobench}` | set output format (default pretty) |
| `--ignore` | `strings` | set file and directory names to ignore during loading (e.g., '.*' excludes hidden files) |
| `--max-errors` `-m` | `int` | set the number of errors to allow before compilation fails early (default 10) |
| `--run` `-r` | `string` | run only test cases matching the regular expression. |
| `--schema` `-s` | `string` | set schema file path or directory path |
| `--target` `-t` | `{rego,wasm}` | set the runtime to exercise (default rego) |
| `--threshold` | `float` | set coverage threshold and exit with non-zero status if coverage is less than threshold % |
| `--timeout` | `duration` | set test timeout (default 5s, 30s when benchmarking) |
| `--v1-compatible` | `bool` | opt-in to OPA features and behaviors that will be enabled by default in a future OPA v1.0 release |
| `--verbose` `-v` | `bool` | set verbose reporting mode |
| `--watch` `-w` | `bool` | watch command line files for changes |

**opa version**

| Flag | Type | Description |
|---|---|---|
| `--check` `-c` | `bool` | check for latest OPA release |

</details>

### REST API

| Capability | Endpoint | OPA v0.64.0 |
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
| Health — custom live/ready policies | `GET /health/live, /health/ready` | ✅ |
| Prometheus metrics | `GET /metrics` | ✅ |
| Config API | `GET /v1/config` | ✅ |
| Status API | `GET /v1/status` | ✅ |

Every endpoint — including ones without a dedicated page — can be called from the **API Console**.

### Built-in functions

`opa capabilities` reports **198 built-in functions** for this release; browse them on the **Built-ins** page.

## What changed in OPA v0.64.0

Measured difference between OPA **v0.63.0** and **v0.64.0**:

| Change | Details |
|---|---|
| ➕ built-in functions | `json.marshal_with_options` |

<details><summary><b>Upstream release note highlights</b></summary>


**Breaking Change**


**Bootstrap configuration overrides Discovered configuration**


**Add `rego_version` attribute to the bundle manifest**


**Runtime, Tooling, SDK**

- compile: Fix panic from CLI + metadata entrypoint overlaps. The panic occurs when `opa build` was provided an entrypoint from both a CLI flag, and via entrypoint metadata annotation. authored by @p...
- cmd/deps: Improve memory footprint and execution time of `deps` command for policies with high dependency connectivity authored by @johanfylling
- server: Keep default decision path in-sync with manager's config authored by @ashutosh-narkar
- server: Remove unnecessary AST-to-JSON conversions and authored by @koponen-styra
- sdk: Allow customizations of the plugin manager via SDK authored by @xico42
- sdk: Fix issue where active parser options aren't propagated to module reload during bundle activation resulting in errors while activating bundles with `v1` syntax authored by @xico42
- plugins/rest: Close response body in OAuth2 client credentials flow authored by @johanneslarsson

**Topdown and Rego**

- ast: Import `rego.v1` in `v0` support modules when applicable authored by @johanfylling
- rego: Set query Rego version from configured imports authored by @johanfylling
- topdown: New `json.marshal_with_options()` builtin for indented/"pretty-printed" and/or line-prefixed JSON authored by @sean-r-williams

**Docs, Website, Ecosystem**

- Add Raygun to ecosystem projects authored by @johndbro1
- Add env0 to ecosystem projects authored by @yarivg

**Miscellaneous**


Full notes: https://github.com/open-policy-agent/opa/releases/tag/v0.64.0

</details>

## Guided tour

Every screenshot below was captured automatically from OPA Studio `v0.64.0` running against OPA `v0.64.0`.

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

### 11. Config & Status APIs

The active runtime configuration and status of plugins and bundles.

<img src="docs/screenshots/11-config-status.webp" alt="Config & Status APIs" width="900">

- The Config API shows the runtime configuration (credentials are redacted by OPA).
- The Status API lists plugin states and bundle activations.

### 12. Prometheus metrics

Parsed `/metrics` exposition with metric families, types and samples.

<img src="docs/screenshots/12-metrics.webp" alt="Prometheus metrics" width="900">

- Studio parses the Prometheus exposition of `/metrics`; filter families and click one to inspect its samples.

### 13. Bundles

Build (`opa build`), inspect, sign and verify bundles; the native builder covers releases without `opa build`.

<img src="docs/screenshots/13-bundles.webp" alt="Bundles" width="900">

- **Build** runs `opa build` on the workspace (targets, entrypoints, optimisation, revision and signing when supported).
- Built bundles can be downloaded or published to the Studio control plane; **Inspect**, **Sign** and **Verify** work on any archive.

### 14. Control plane: decision logs

Studio serves bundles and discovery and receives decision logs and status reports from OPA agents.

<img src="docs/screenshots/14-control-plane.webp" alt="Control plane: decision logs" width="900">

- Studio implements the OPA management APIs: bundle and discovery downloads, decision log and status uploads.
- The *OPA config* tab generates the agent configuration; *Apply to Local OPA* wires the managed server to Studio.
- Decision logs stream live; click a row for input, result, labels and metrics.

### 15. Local OPA

Start, stop and configure the managed OPA server; live process logs.

<img src="docs/screenshots/15-local-opa.webp" alt="Local OPA" width="900">

- Start, stop or restart the managed `opa run --server` process and change its address, loaded workspace, flags and configuration file.
- Process output is streamed live.

### 16. REPL (opa run)

The interactive Rego shell in the browser, with the workspace loaded.

<img src="docs/screenshots/16-repl.webp" alt="REPL (opa run)" width="900">

- **Start session** launches `opa run` with the workspace loaded; type Rego and REPL commands (`show`, `trace`, `metrics`, …).

### 17. Command Builder

Every command, subcommand and flag of this OPA release as a form — nothing the CLI can do is out of reach.

<img src="docs/screenshots/17-command-builder.webp" alt="Command Builder" width="900">

- Every command, subcommand and flag of this OPA binary is rendered as a form, generated from the measured manifest.
- Runs execute in a sandboxed copy of the workspace; output files can be collected and downloaded.

### 18. API Console

Any HTTP request against the OPA REST API with presets for every documented operation.

<img src="docs/screenshots/18-api-console.webp" alt="API Console" width="900">

- Choose a preset (operations unavailable in this release are dimmed) or craft any request: method, path, query, headers and body.

### 19. Built-in functions

All built-in functions, future keywords and features reported by `opa capabilities`.

<img src="docs/screenshots/19-builtins.webp" alt="Built-in functions" width="900">

- Searchable catalogue of the built-in functions of this release with signatures, descriptions and categories.

### 20. Compatibility matrix

Measured capabilities of every OPA release and the changes introduced by this one.

<img src="docs/screenshots/20-compatibility.webp" alt="Compatibility matrix" width="900">

- The measured capability matrix of all OPA releases; select a release to see its commands, endpoints and changes.

## Connect OPA agents to Studio

Studio implements OPA's management APIs under `/cp`, so agents can download bundles from it and report decisions and status to it:

```yaml
services:
  studio:
    url: https://opa-studio.example.com/cp
    credentials:
      bearer:
        token: ${OPA_STUDIO_CONTROL_PLANE_TOKEN}
bundles:
  app:
    service: studio
    resource: bundles/app
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
| `OPA_STUDIO_LOCAL_OPA` | `true` | Run the managed OPA v0.64.0 server |
| `OPA_STUDIO_CONTROL_PLANE_TOKEN` | – | Bearer token agents must send to `/cp` |
| `OPA_STUDIO_CLI_SANDBOX` | `true` | Reject absolute paths / traversal in CLI arguments |
| `OPA_STUDIO_TLS_CERT_FILE` / `_KEY_FILE` | – | Serve HTTPS |

All options: [docs/configuration.md](docs/configuration.md) · Security hardening: [docs/security.md](docs/security.md) · Kubernetes and Compose: [deploy/](deploy/).

## Verification

Automated checks run against OPA v0.64.0 for this release:

| Check | Result |
|---|---|
| `opa check` on the example workspace | ✅ passed |
| `opa test` on the example workspace | ✅ passed |
| `opa eval` of `data.app.rbac.allow` | ✅ passed |
| `opa run --server` loads the workspace and decides | ✅ `{"result":true}` |
| UI pages exercised end-to-end | ✅ 20 pages, 0 failed actions |
| Browser console errors | ✅ none |
| Studio API server errors | ✅ none |

The Go unit tests, UI tests and the integration test (`OPA_BIN=… go test ./test/...`) run in CI for every tag.

## Build from source

```bash
git clone --branch v0.64.0 --single-branch https://github.com/alasgarovnamig/OPA-Studio.git opa-studio-v0.64.0 && cd opa-studio-v0.64.0
make ui build          # web UI + bin/opa-studio (OPA version stamped from ./OPA_VERSION)
make opa               # downloads OPA v0.64.0 to bin/opa (checksum verified when published)
make run               # http://localhost:9080
docker build -t opa-studio:v0.64.0 .   # container image
```

Requirements: Go 1.23+, Node.js 20+, Docker (for images). See [docs/development.md](docs/development.md).

## Other OPA versions

| OPA Studio tag = OPA version | OPA released | Rego dialect |
|---|---|---|
| [v0.62.0](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.62.0) | 2024-02-29 | Rego with `import rego.v1` |
| [v0.62.1](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.62.1) | 2024-03-06 | Rego with `import rego.v1` |
| [v0.63.0](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.63.0) | 2024-03-28 | Rego with `import rego.v1` |
| **v0.64.0** | 2024-04-25 | Rego with `import rego.v1` |
| [v0.64.1](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.64.1) | 2024-04-26 | Rego with `import rego.v1` |
| [v0.65.0](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.65.0) | 2024-05-30 | Rego with `import rego.v1` |
| [v0.66.0](https://github.com/alasgarovnamig/OPA-Studio/tree/v0.66.0) | 2024-06-27 | Rego with `import rego.v1` |

All 216 supported OPA releases: [docs/VERSIONS.md](https://github.com/alasgarovnamig/OPA-Studio/blob/main/docs/VERSIONS.md).

---

OPA Studio is an independent project and is not affiliated with the Open Policy Agent project or the CNCF. Licensed under [Apache-2.0](LICENSE).
