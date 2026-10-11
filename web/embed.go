// Package web embeds the compiled single-page application (web/dist).
//
// Build the UI with `npm --prefix web ci && npm --prefix web run build`
// (or `make ui`) before `go build` so the binary ships the interface.
package web

import "embed"

// Dist is the compiled UI.
//
//go:embed all:dist
var Dist embed.FS
