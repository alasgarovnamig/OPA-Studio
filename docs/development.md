# Development

## Requirements

* Go 1.23+
* Node.js 20+ and npm
* Docker (container images, introspection, screenshots)
* Python 3.9+ (tooling under `tools/`)

## Layout

```
cmd/opa-studio/        entry point
internal/              backend packages (see architecture.md)
web/                   React + TypeScript UI (Vite)
versions/              measured OPA release catalogue and manifests (embedded)
tools/introspect/      download + introspect OPA releases, validate the example workspace on each
tools/screenshots/     Playwright UI tour / end-to-end smoke test per OPA release
tools/release/         README and release-note generators, release commit tooling
tools/gentemplate/     renders the example workspace for a Rego dialect
test/integration/      tests against a real OPA binary
deploy/                docker compose and Kubernetes manifests
```

## Everyday commands

```bash
make ui build          # build the UI and bin/opa-studio
make opa               # download the OPA release from ./OPA_VERSION into bin/opa
make run               # run Studio against bin/opa on :9080
make dev               # Vite dev server on :5173 proxying /api to :9080
make test              # go vet, go test -race, UI type check and unit tests
make test-integration  # tests against bin/opa
make docker            # container image for ./OPA_VERSION
```

## Supporting a new OPA release

```bash
make versions                # refresh versions/opa-versions.json from GitHub
make manifests               # introspect releases that have no manifest yet (Docker)
make validate-templates      # prove the example workspace on every release
python3 tools/screenshots/run_all.py --cache .cache/opa --out .cache/shots --only vX.Y.Z
python3 tools/release/release.py --version vX.Y.Z --shots .cache/shots/vX.Y.Z   # release commit + tag
```

If the new release changes the CLI or REST surface, the manifest captures it automatically; the UI picks it up
without code changes. Only genuinely new features (a new endpoint or command) need a page or preset.

## Versioning scheme

* Tag `vX.Y.Z` of OPA Studio targets OPA `vX.Y.Z` (including the pre-release `v0.19.0-rc1` and the
  upstream tags without a GitHub release: `v0.13.1`, `v0.29.0`, `v0.46.0`).
* `main` always equals the release for the newest OPA version.
* Fixes to Studio itself are released by re-tagging affected versions through the release workflow
  (`workflow_dispatch`).

## Publishing images

The release workflow always pushes `ghcr.io/<owner>/opa-studio:<tag>`. To publish to Docker Hub as well,
add two repository secrets (*Settings → Secrets and variables → Actions*):

| Secret | Value |
|---|---|
| `DOCKERHUB_USERNAME` | Docker Hub user or organisation, e.g. `alasgarovnamig` |
| `DOCKERHUB_TOKEN` | Docker Hub access token with *Read & Write* scope |

Images are then also pushed as `docker.io/<DOCKERHUB_USERNAME>/opa-studio:<tag>` (and `:latest` for the newest
OPA version). Run **Actions → Backfill releases** with `all` to publish every tag.

## Tests

* `internal/...` — unit tests (manifest parsing, sandbox rules, workspaces, bundles, control plane, auth, proxy).
* `test/integration` — real OPA binary: CLI runs, local OPA server, REPL.
* `web/src/**/*.test.ts` — UI unit tests (vitest).
* `tools/introspect/validate_all.py` — example workspace on all OPA releases.
* `tools/screenshots/run_all.py` — every UI page on every OPA release, failing on console or API errors.
