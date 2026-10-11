<p align="center"><img src="docs/assets/logo.svg" width="84" alt="OPA Studio"></p>

<h1 align="center">OPA Studio</h1>

<p align="center"><b>A web UI that covers every operation of Open Policy Agent — for every OPA release.</b></p>

OPA Studio lets you do everything OPA can do from a browser: manage policies and data on any number of OPA
servers, evaluate, test, format, benchmark and bundle policies with the OPA CLI, run the REPL, and act as the
control plane OPA agents download bundles from and send decision logs and status to.

Every OPA release has a matching OPA Studio release with the **same tag** (OPA `v1.0.0` ↔ OPA Studio
`v1.0.0`). Each tag bundles that OPA binary, only offers what that release can do — measured, not guessed —
and has its own README with screenshots captured against it. See [docs/VERSIONS.md](docs/VERSIONS.md).

## Documentation

* [Feature coverage](docs/feature-coverage.md) — every OPA capability and where it lives in Studio
* [Compatibility methodology](docs/compatibility.md) — how each OPA release is measured
* [Configuration](docs/configuration.md) · [Security](docs/security.md) · [HTTP API](docs/api.md)
* [Architecture](docs/architecture.md) · [Development](docs/development.md)

## Quick start

```bash
make ui build opa run   # http://localhost:9080
```

Licensed under [Apache-2.0](LICENSE). OPA Studio is an independent project and is not affiliated with the
Open Policy Agent project or the CNCF.
