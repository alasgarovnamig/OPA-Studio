// Package buildinfo carries values injected at link time via -ldflags.
package buildinfo

// These are overridden with -ldflags "-X github.com/alasgarovnamig/opa-studio/internal/buildinfo.Version=..."
var (
	// Version is the OPA Studio release. Every OPA Studio release is tagged
	// with the exact OPA version it targets (e.g. v1.0.0 <-> OPA v1.0.0).
	Version = "dev"
	// OPAVersion is the OPA release this build targets and bundles.
	OPAVersion = "v0.4.2"
	// Commit is the git commit the binary was built from.
	Commit = "unknown"
	// Date is the build timestamp (RFC 3339).
	Date = "unknown"
)
