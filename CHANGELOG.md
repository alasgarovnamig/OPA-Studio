# Changelog

OPA Studio releases follow OPA releases: tag `vX.Y.Z` of Studio targets OPA `vX.Y.Z`.
What changed in OPA itself between releases is part of each tag's README ("What changed in OPA …").

## Studio feature set (all tags)

* Server: dashboard, Policy / Data / Query / Compile / Health / Config / Status APIs, Prometheus metrics,
  API console with presets for every documented operation.
* Develop: workspaces with deploy / pull / bundle import & export, Evaluate, Test, Check & Format,
  Parse & Deps, Benchmark, Exec, REPL, Command Builder covering every command and flag of the bundled OPA.
* Distribute: bundle build / inspect / sign / verify, control plane (bundle service, discovery, decision
  logs, status reports, generated OPA configuration).
* Runtime: managed local OPA server, multiple connections with token, header and mTLS authentication.
* Reference: built-in catalogue, measured compatibility matrix of all OPA releases.
* Operations: basic / token authentication, read-only mode, TLS, CLI sandbox, structured logging, health
  checks, non-root container image, Kubernetes and Compose manifests.
* Verified on every OPA release: example workspace (check / test / eval / server) and an end-to-end UI run.
