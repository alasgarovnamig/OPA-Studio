package api

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/alasgarovnamig/opa-studio/internal/bundle"
	"github.com/alasgarovnamig/opa-studio/internal/controlplane"
)

// ---- management API (UI) ---------------------------------------------------------

func (a *API) cpListBundles(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.Control.Bundles())
}

type publishRequest struct {
	Workspace string   `json:"workspace"`
	Revision  string   `json:"revision"`
	Roots     []string `json:"roots"`
	// Metadata is stored in the bundle manifest.
	Metadata map[string]any `json:"metadata"`
}

// cpPublishBundle publishes either an uploaded archive (application/gzip or
// application/octet-stream body, e.g. the output of `opa build`) or a
// natively built bundle of a workspace (JSON body).
func (a *API) cpPublishBundle(w http.ResponseWriter, r *http.Request) {
	if a.Cfg.ReadOnly {
		writeError(w, http.StatusForbidden, errReadOnly)
		return
	}
	name := r.PathValue("name")
	ct := r.Header.Get("Content-Type")
	var archive []byte
	source := "upload"
	if strings.HasPrefix(ct, "application/json") {
		var req publishRequest
		if !a.decode(w, r, &req) {
			return
		}
		var mf map[string]any
		if req.Revision != "" || len(req.Roots) > 0 || len(req.Metadata) > 0 {
			mf = map[string]any{}
			if req.Revision != "" {
				mf["revision"] = req.Revision
			}
			if len(req.Roots) > 0 {
				mf["roots"] = req.Roots
			}
			if len(req.Metadata) > 0 {
				mf["metadata"] = req.Metadata
			}
		}
		b, err := a.Workspaces.Bundle(req.Workspace, mf)
		if err != nil {
			fail(w, err)
			return
		}
		archive, source = b, "workspace:"+req.Workspace
	} else {
		b, ok := a.readBody(w, r)
		if !ok {
			return
		}
		archive = b
	}
	meta, err := a.Control.PublishBundle(name, source, archive)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, meta)
}

func (a *API) cpDeleteBundle(w http.ResponseWriter, r *http.Request) {
	if a.Cfg.ReadOnly {
		writeError(w, http.StatusForbidden, errReadOnly)
		return
	}
	if err := a.Control.DeleteBundle(r.PathValue("name")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) cpDownloadBundle(w http.ResponseWriter, r *http.Request) {
	meta, b, err := a.Control.Bundle(r.PathValue("name"))
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.tar.gz"`, meta.Name))
	_, _ = w.Write(b)
}

func (a *API) cpInspectBundle(w http.ResponseWriter, r *http.Request) {
	_, b, err := a.Control.Bundle(r.PathValue("name"))
	if err != nil {
		fail(w, err)
		return
	}
	sum, err := bundle.Inspect(b)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sum)
}

func (a *API) cpListDiscovery(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.Control.Discoveries())
}

func (a *API) cpPutDiscovery(w http.ResponseWriter, r *http.Request) {
	if a.Cfg.ReadOnly {
		writeError(w, http.StatusForbidden, errReadOnly)
		return
	}
	var d controlplane.Discovery
	if !a.decode(w, r, &d) {
		return
	}
	d.Name = r.PathValue("name")
	if err := a.Control.PutDiscovery(&d); err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, d)
}

func (a *API) cpDeleteDiscovery(w http.ResponseWriter, r *http.Request) {
	if a.Cfg.ReadOnly {
		writeError(w, http.StatusForbidden, errReadOnly)
		return
	}
	if err := a.Control.DeleteDiscovery(r.PathValue("name")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) cpDecisions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	list, total := a.Control.Decisions(controlplane.DecisionQuery{
		Path: q.Get("path"), Search: q.Get("search"), Limit: queryInt(r, "limit", 100), Offset: queryInt(r, "offset", 0),
	})
	writeJSON(w, http.StatusOK, map[string]any{"total": total, "items": list})
}

func (a *API) cpClearDecisions(w http.ResponseWriter, r *http.Request) {
	if err := a.Control.ClearDecisions(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) cpDecisionStream(w http.ResponseWriter, r *http.Request) {
	f, ok := sse(w)
	if !ok {
		return
	}
	ch, cancel := a.Control.SubscribeDecisions()
	defer cancel()
	for {
		select {
		case <-r.Context().Done():
			return
		case d := <-ch:
			if sseSend(w, f, d) != nil {
				return
			}
		}
	}
}

func (a *API) cpStatuses(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.Control.Statuses(r.URL.Query().Get("instance"), queryInt(r, "limit", 100)))
}

func (a *API) cpInstances(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.Control.Instances())
}

func (a *API) cpClearStatuses(w http.ResponseWriter, r *http.Request) {
	a.Control.ClearStatuses()
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) publicURL(r *http.Request) string {
	if a.Cfg.PublicURL != "" {
		return strings.TrimRight(a.Cfg.PublicURL, "/")
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := r.Host
	if fh := r.Header.Get("X-Forwarded-Host"); fh != "" {
		host = fh
	}
	return scheme + "://" + host
}

func yamlString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// cpConfigSnippet renders an OPA configuration file that points an agent at
// this Studio instance. ?style=legacy emits the pre-v0.13 single "bundle" key.
func (a *API) cpConfigSnippet(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	base := a.publicURL(r) + "/cp"
	var sb strings.Builder
	sb.WriteString("# OPA configuration generated by OPA Studio\n")
	sb.WriteString("services:\n  studio:\n    url: " + yamlString(base) + "\n")
	if a.Cfg.ControlPlaneToken != "" {
		sb.WriteString("    credentials:\n      bearer:\n        token: \"${OPA_STUDIO_CONTROL_PLANE_TOKEN}\"\n")
	}
	if name := q.Get("bundle"); name != "" {
		if q.Get("style") == "legacy" {
			sb.WriteString("bundle:\n  name: " + yamlString(name) + "\n  service: studio\n  polling:\n    min_delay_seconds: 10\n    max_delay_seconds: 20\n")
		} else {
			sb.WriteString("bundles:\n  " + yamlString(name) + ":\n    service: studio\n    resource: " + yamlString("bundles/"+name) + "\n    polling:\n      min_delay_seconds: 10\n      max_delay_seconds: 20\n")
		}
	}
	if q.Get("decisionLogs") != "false" {
		sb.WriteString("decision_logs:\n  service: studio\n  reporting:\n    min_delay_seconds: 5\n    max_delay_seconds: 10\n")
	}
	if q.Get("status") != "false" {
		sb.WriteString("status:\n  service: studio\n")
	}
	if name := q.Get("discovery"); name != "" {
		decision := ""
		for _, d := range a.Control.Discoveries() {
			if d.Name == name {
				decision = d.Decision
			}
		}
		sb.WriteString("discovery:\n  name: " + yamlString(name) + "\n  service: studio\n  resource: " + yamlString("discovery/"+name) + "\n")
		if decision != "" {
			sb.WriteString("  decision: " + yamlString(decision) + "\n")
		}
	}
	w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
	_, _ = w.Write([]byte(sb.String()))
}

// ---- control plane protocol (OPA agents) ----------------------------------

func (a *API) cpAuthorized(w http.ResponseWriter, r *http.Request) bool {
	if a.Cfg.ControlPlaneToken == "" {
		return true
	}
	got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if subtle.ConstantTimeCompare([]byte(got), []byte(a.Cfg.ControlPlaneToken)) == 1 {
		return true
	}
	writeJSON(w, http.StatusUnauthorized, map[string]string{"code": "unauthorized", "message": "invalid control plane token"})
	return false
}

func clientOf(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ua := r.UserAgent(); ua != "" {
		return host + " (" + ua + ")"
	}
	return host
}

func serveArchive(w http.ResponseWriter, r *http.Request, archive []byte, etag string) bool {
	w.Header().Set("ETag", etag)
	w.Header().Set("Content-Type", "application/gzip")
	if inm := r.Header.Get("If-None-Match"); inm != "" && (inm == etag || strings.Trim(inm, `"`) == strings.Trim(etag, `"`)) {
		w.WriteHeader(http.StatusNotModified)
		return true
	}
	_, _ = w.Write(archive)
	return false
}

func (a *API) cpServeBundle(w http.ResponseWriter, r *http.Request) {
	if !a.cpAuthorized(w, r) {
		return
	}
	name := strings.TrimSuffix(strings.TrimSuffix(r.PathValue("name"), ".tar.gz"), "/")
	meta, b, err := a.Control.Bundle(name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"code": "not_found", "message": "bundle " + name + " not found"})
		return
	}
	notModified := serveArchive(w, r, b, meta.ETag)
	a.Control.RecordFetch(name, clientOf(r), notModified)
}

func (a *API) cpServeDiscovery(w http.ResponseWriter, r *http.Request) {
	if !a.cpAuthorized(w, r) {
		return
	}
	name := strings.TrimSuffix(strings.TrimSuffix(r.PathValue("name"), ".tar.gz"), "/")
	b, err := a.Control.DiscoveryBundle(name)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"code": "not_found", "message": "discovery " + name + " not found"})
		return
	}
	serveArchive(w, r, b, bundle.ETag(b))
}

func (a *API) cpIngestLogs(w http.ResponseWriter, r *http.Request) {
	if !a.cpAuthorized(w, r) {
		return
	}
	body, ok := a.readBody(w, r)
	if !ok {
		return
	}
	if _, err := a.Control.IngestDecisions(body, clientOf(r), a.Cfg.MaxBodyBytes); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (a *API) cpIngestStatus(w http.ResponseWriter, r *http.Request) {
	if !a.cpAuthorized(w, r) {
		return
	}
	body, ok := a.readBody(w, r)
	if !ok {
		return
	}
	if err := a.Control.IngestStatus(body, clientOf(r), a.Cfg.MaxBodyBytes); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.WriteHeader(http.StatusOK)
}
