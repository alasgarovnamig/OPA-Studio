// Package versions embeds the measured compatibility data for every OPA
// release: the list of versions and one introspection manifest per version.
//
// The data is produced by tools/introspect and must not be edited by hand.
package versions

import "embed"

// FS holds opa-versions.json and manifests/<version>.json.
//
//go:embed opa-versions.json manifests/*.json
var FS embed.FS
