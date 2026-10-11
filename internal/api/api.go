// Package api implements the OPA Studio HTTP API consumed by the web UI.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/buildinfo"
	"github.com/alasgarovnamig/opa-studio/internal/config"
	"github.com/alasgarovnamig/opa-studio/internal/controlplane"
	"github.com/alasgarovnamig/opa-studio/internal/localopa"
	"github.com/alasgarovnamig/opa-studio/internal/manifest"
	"github.com/alasgarovnamig/opa-studio/internal/opacli"
	"github.com/alasgarovnamig/opa-studio/internal/repl"
	"github.com/alasgarovnamig/opa-studio/internal/store"
	"github.com/alasgarovnamig/opa-studio/internal/workspace"
)

// API wires every subsystem to HTTP handlers.
type API struct {
	Cfg         *config.Config
	Log         *slog.Logger
	CLI         *opacli.Runner
	Manifest    *manifest.Manifest
	Workspaces  *workspace.Store
	Connections *store.Store
	LocalOPA    *localopa.Manager // nil when disabled
	REPL        *repl.Manager
	Control     *controlplane.Store
	StartedAt   time.Time

	proxy *proxyPool
}

// Register mounts all routes on mux.
func (a *API) Register(mux *http.ServeMux) {
	a.proxy = newProxyPool(a.Cfg.ProxyTimeout)

	mux.HandleFunc("GET /api/info", a.info)
	mux.HandleFunc("GET /api/versions", a.versions)
	mux.HandleFunc("GET /api/versions/summary", a.versionSummaries)
	mux.HandleFunc("GET /api/versions/{version}/manifest", a.versionManifest)
	mux.HandleFunc("GET /api/manifest", a.activeManifest)

	mux.HandleFunc("GET /api/connections", a.listConnections)
	mux.HandleFunc("POST /api/connections", a.createConnection)
	mux.HandleFunc("GET /api/connections/{id}", a.getConnection)
	mux.HandleFunc("PUT /api/connections/{id}", a.updateConnection)
	mux.HandleFunc("DELETE /api/connections/{id}", a.deleteConnection)
	mux.HandleFunc("POST /api/connections/{id}/test", a.testConnection)
	mux.HandleFunc("/api/connections/{id}/proxy/{path...}", a.proxyRequest)

	mux.HandleFunc("GET /api/cli/commands", a.cliCommands)
	mux.HandleFunc("POST /api/cli/run", a.cliRun)

	mux.HandleFunc("GET /api/workspaces", a.listWorkspaces)
	mux.HandleFunc("POST /api/workspaces", a.createWorkspace)
	mux.HandleFunc("GET /api/workspaces/{ws}", a.getWorkspace)
	mux.HandleFunc("PUT /api/workspaces/{ws}", a.updateWorkspace)
	mux.HandleFunc("DELETE /api/workspaces/{ws}", a.deleteWorkspace)
	mux.HandleFunc("GET /api/workspaces/{ws}/files", a.listFiles)
	mux.HandleFunc("GET /api/workspaces/{ws}/files/{path...}", a.readFile)
	mux.HandleFunc("PUT /api/workspaces/{ws}/files/{path...}", a.writeFile)
	mux.HandleFunc("DELETE /api/workspaces/{ws}/files/{path...}", a.deleteFile)
	mux.HandleFunc("POST /api/workspaces/{ws}/rename", a.renameFile)
	mux.HandleFunc("GET /api/workspaces/{ws}/export", a.exportWorkspace)
	mux.HandleFunc("POST /api/workspaces/{ws}/import", a.importWorkspace)
	mux.HandleFunc("POST /api/workspaces/{ws}/deploy", a.deployWorkspace)
	mux.HandleFunc("POST /api/workspaces/{ws}/pull", a.pullWorkspace)

	mux.HandleFunc("POST /api/bundles/inspect", a.inspectBundle)

	mux.HandleFunc("GET /api/local-opa", a.localState)
	mux.HandleFunc("PUT /api/local-opa/settings", a.localSettings)
	mux.HandleFunc("POST /api/local-opa/{action}", a.localAction)
	mux.HandleFunc("GET /api/local-opa/logs", a.localLogs)
	mux.HandleFunc("DELETE /api/local-opa/logs", a.localClearLogs)
	mux.HandleFunc("GET /api/local-opa/logs/stream", a.localLogStream)

	mux.HandleFunc("GET /api/repl", a.replList)
	mux.HandleFunc("POST /api/repl", a.replStart)
	mux.HandleFunc("POST /api/repl/{id}/input", a.replInput)
	mux.HandleFunc("GET /api/repl/{id}/events", a.replEvents)
	mux.HandleFunc("GET /api/repl/{id}/stream", a.replStream)
	mux.HandleFunc("DELETE /api/repl/{id}", a.replClose)

	mux.HandleFunc("GET /api/control/bundles", a.cpListBundles)
	mux.HandleFunc("POST /api/control/bundles/{name}", a.cpPublishBundle)
	mux.HandleFunc("DELETE /api/control/bundles/{name}", a.cpDeleteBundle)
	mux.HandleFunc("GET /api/control/bundles/{name}/download", a.cpDownloadBundle)
	mux.HandleFunc("GET /api/control/bundles/{name}/inspect", a.cpInspectBundle)
	mux.HandleFunc("GET /api/control/discovery", a.cpListDiscovery)
	mux.HandleFunc("PUT /api/control/discovery/{name}", a.cpPutDiscovery)
	mux.HandleFunc("DELETE /api/control/discovery/{name}", a.cpDeleteDiscovery)
	mux.HandleFunc("GET /api/control/decisions", a.cpDecisions)
	mux.HandleFunc("DELETE /api/control/decisions", a.cpClearDecisions)
	mux.HandleFunc("GET /api/control/decisions/stream", a.cpDecisionStream)
	mux.HandleFunc("GET /api/control/status", a.cpStatuses)
	mux.HandleFunc("GET /api/control/instances", a.cpInstances)
	mux.HandleFunc("DELETE /api/control/status", a.cpClearStatuses)
	mux.HandleFunc("GET /api/control/config", a.cpConfigSnippet)

	// Endpoints called by OPA agents (control plane protocol).
	mux.HandleFunc("GET /cp/bundles/{name...}", a.cpServeBundle)
	mux.HandleFunc("GET /cp/discovery/{name...}", a.cpServeDiscovery)
	mux.HandleFunc("POST /cp/logs", a.cpIngestLogs)
	mux.HandleFunc("POST /cp/logs/{rest...}", a.cpIngestLogs)
	mux.HandleFunc("POST /cp/status", a.cpIngestStatus)
	mux.HandleFunc("POST /cp/status/{rest...}", a.cpIngestStatus)

	mux.HandleFunc("/api/{rest...}", notFound)
}

func notFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, fmt.Errorf("no route for %s %s", r.Method, r.URL.Path))
}

// ---- helpers ---------------------------------------------------------------

type errorBody struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, errorBody{Error: err.Error()})
}

func statusFor(err error) int {
	switch {
	case errors.Is(err, workspace.ErrNotFound), errors.Is(err, store.ErrNotFound), errors.Is(err, controlplane.ErrNotFound), errors.Is(err, os.ErrNotExist):
		return http.StatusNotFound
	case errors.Is(err, store.ErrReadOnly):
		return http.StatusForbidden
	case errors.Is(err, opacli.ErrNoBinary):
		return http.StatusServiceUnavailable
	}
	return http.StatusBadRequest
}

func fail(w http.ResponseWriter, err error) { writeError(w, statusFor(err), err) }

func (a *API) decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, a.Cfg.MaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(v); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid JSON body: %w", err))
		return false
	}
	return true
}

func (a *API) readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, a.Cfg.MaxBodyBytes)
	b, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, err)
		return nil, false
	}
	return b, true
}

func queryInt(r *http.Request, key string, def int) int {
	if v := r.URL.Query().Get(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return def
}

// sse prepares a Server-Sent Events response.
func sse(w http.ResponseWriter) (http.Flusher, bool) {
	f, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming unsupported"))
		return nil, false
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	f.Flush()
	return f, true
}

func sseSend(w http.ResponseWriter, f http.Flusher, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", b); err != nil {
		return err
	}
	f.Flush()
	return nil
}

// ---- info ------------------------------------------------------------------

func (a *API) info(w http.ResponseWriter, r *http.Request) {
	type binaryInfo struct {
		Available       bool   `json:"available"`
		Path            string `json:"path,omitempty"`
		Version         string `json:"version,omitempty"`
		MatchesTarget   bool   `json:"matchesTarget"`
		ManifestVersion string `json:"manifestVersion,omitempty"`
		ManifestLive    bool   `json:"manifestLive"`
	}
	bi := binaryInfo{}
	if b := a.CLI.Binary(); b != nil {
		bi.Available, bi.Path, bi.Version = true, b.Path, b.Version
		bi.MatchesTarget = b.Version == manifest.Normalize(buildinfo.OPAVersion)
	}
	if a.Manifest != nil {
		bi.ManifestVersion, bi.ManifestLive = a.Manifest.OPA.Version, a.Manifest.Live
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"studio": map[string]any{
			"version":          buildinfo.Version,
			"commit":           buildinfo.Commit,
			"date":             buildinfo.Date,
			"targetOpaVersion": manifest.Normalize(buildinfo.OPAVersion),
			"startedAt":        a.StartedAt,
		},
		"opa": bi,
		"settings": map[string]any{
			"readOnly":                  a.Cfg.ReadOnly,
			"authMode":                  a.Cfg.AuthMode,
			"cliSandbox":                a.Cfg.CLISandbox,
			"localOpa":                  a.LocalOPA != nil,
			"publicUrl":                 a.Cfg.PublicURL,
			"controlPlaneTokenRequired": a.Cfg.ControlPlaneToken != "",
		},
		"manifest": a.Manifest,
	})
}

func (a *API) versions(w http.ResponseWriter, r *http.Request) {
	vs, err := manifest.Versions()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, vs)
}

func (a *API) versionManifest(w http.ResponseWriter, r *http.Request) {
	b, err := manifest.Raw(r.PathValue("version"))
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(b)
}

func (a *API) versionSummaries(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=3600")
	writeJSON(w, http.StatusOK, manifest.Summaries())
}

func (a *API) activeManifest(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.Manifest)
}
