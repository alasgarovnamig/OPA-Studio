# Contributing

Thanks for helping! The short version:

1. `make ui build test` must pass; `make test-integration` runs the tests against the targeted OPA binary.
2. Keep the UI version-aware: gate features on the manifest (`web/src/lib/features.ts`) instead of hard-coding
   OPA versions.
3. Changes to the introspection probes require regenerating manifests (`make manifests`) — commit the result.
4. New pages or options should be added to [docs/feature-coverage.md](docs/feature-coverage.md).

See [docs/development.md](docs/development.md) for the layout, tooling and the release process.

By contributing you agree that your contributions are licensed under the Apache License 2.0.
