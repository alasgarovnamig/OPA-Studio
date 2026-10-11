package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/alasgarovnamig/opa-studio/internal/bundle"
)

var errReadOnly = errors.New("OPA Studio runs in read-only mode")

func (a *API) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	list, err := a.Workspaces.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type workspaceBody struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Files       map[string]string `json:"files"`
	// Template seeds the workspace with an example for the OPA version.
	Template string `json:"template"`
}

func (a *API) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var b workspaceBody
	if !a.decode(w, r, &b) {
		return
	}
	files := b.Files
	if files == nil && b.Template != "" {
		files = Template(b.Template, a.dialect())
	}
	ws, err := a.Workspaces.Create(b.ID, b.Name, b.Description, files)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ws)
}

func (a *API) getWorkspace(w http.ResponseWriter, r *http.Request) {
	ws, err := a.Workspaces.Get(r.PathValue("ws"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

func (a *API) updateWorkspace(w http.ResponseWriter, r *http.Request) {
	var b workspaceBody
	if !a.decode(w, r, &b) {
		return
	}
	ws, err := a.Workspaces.Update(r.PathValue("ws"), b.Name, b.Description)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ws)
}

func (a *API) deleteWorkspace(w http.ResponseWriter, r *http.Request) {
	if err := a.Workspaces.Delete(r.PathValue("ws")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) listFiles(w http.ResponseWriter, r *http.Request) {
	files, err := a.Workspaces.Files(r.PathValue("ws"))
	if err != nil {
		fail(w, err)
		return
	}
	if r.URL.Query().Get("content") == "true" {
		all, err := a.Workspaces.ReadAll(r.PathValue("ws"))
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"files": files, "content": all})
		return
	}
	writeJSON(w, http.StatusOK, files)
}

func (a *API) readFile(w http.ResponseWriter, r *http.Request) {
	b, err := a.Workspaces.ReadFile(r.PathValue("ws"), r.PathValue("path"))
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write(b)
}

func (a *API) writeFile(w http.ResponseWriter, r *http.Request) {
	b, ok := a.readBody(w, r)
	if !ok {
		return
	}
	if err := a.Workspaces.WriteFile(r.PathValue("ws"), r.PathValue("path"), b); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) deleteFile(w http.ResponseWriter, r *http.Request) {
	if err := a.Workspaces.DeleteFile(r.PathValue("ws"), r.PathValue("path")); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) renameFile(w http.ResponseWriter, r *http.Request) {
	var b struct{ From, To string }
	if !a.decode(w, r, &b) {
		return
	}
	if err := a.Workspaces.RenameFile(r.PathValue("ws"), b.From, b.To); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// exportWorkspace downloads the workspace as a native bundle archive.
func (a *API) exportWorkspace(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("ws")
	var mf map[string]any
	if rev := r.URL.Query().Get("revision"); rev != "" {
		mf = map[string]any{"revision": rev}
	}
	archive, err := a.Workspaces.Bundle(id, mf)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.tar.gz"`, id))
	_, _ = w.Write(archive)
}

// importWorkspace extracts an uploaded bundle (.tar.gz) into the workspace.
func (a *API) importWorkspace(w http.ResponseWriter, r *http.Request) {
	body, ok := a.readBody(w, r)
	if !ok {
		return
	}
	names, err := a.Workspaces.Import(r.PathValue("ws"), body)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"imported": names})
}

func (a *API) inspectBundle(w http.ResponseWriter, r *http.Request) {
	body, ok := a.readBody(w, r)
	if !ok {
		return
	}
	sum, err := bundle.Inspect(body)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sum)
}

// ---- deploy / pull -----------------------------------------------------------

type deployRequest struct {
	Connection string `json:"connection"`
	Policies   bool   `json:"policies"`
	Data       bool   `json:"data"`
	// DataPrefix mounts workspace data below this data path (e.g. "app/config").
	DataPrefix string `json:"dataPrefix"`
	// IncludeTests also uploads *_test.rego files.
	IncludeTests bool `json:"includeTests"`
}

type deployStep struct {
	Action string `json:"action"`
	Target string `json:"target"`
	Status int    `json:"status"`
	Error  string `json:"error,omitempty"`
}

func escapePath(p string) string {
	parts := strings.Split(strings.Trim(p, "/"), "/")
	for i, s := range parts {
		parts[i] = url.PathEscape(s)
	}
	return strings.Join(parts, "/")
}

// deployWorkspace pushes data documents and policy modules to an OPA server
// through the Data and Policy APIs (PUT /v1/data/..., PUT /v1/policies/...).
func (a *API) deployWorkspace(w http.ResponseWriter, r *http.Request) {
	if a.Cfg.ReadOnly {
		writeError(w, http.StatusForbidden, errReadOnly)
		return
	}
	var req deployRequest
	if !a.decode(w, r, &req) {
		return
	}
	c, err := a.resolveConnection(req.Connection)
	if err != nil {
		fail(w, err)
		return
	}
	files, err := a.Workspaces.ReadAll(r.PathValue("ws"))
	if err != nil {
		fail(w, err)
		return
	}
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	steps := []deployStep{}
	failed := false
	if req.Data {
		for _, n := range names {
			base := path.Base(n)
			if base != "data.json" && base != "data.yaml" && base != "data.yml" {
				continue
			}
			var doc any
			if base == "data.json" {
				err = json.Unmarshal([]byte(files[n]), &doc)
			} else {
				err = yaml.Unmarshal([]byte(files[n]), &doc)
			}
			step := deployStep{Action: "PUT data"}
			dir := strings.Trim(path.Dir(n), "./")
			target := strings.Trim(path.Join(req.DataPrefix, dir), "/")
			step.Target = "/v1/data/" + target
			if err != nil {
				step.Error = "parse " + n + ": " + err.Error()
				steps, failed = append(steps, step), true
				continue
			}
			body, _ := json.Marshal(doc)
			st, resp, err := a.opaDo(r.Context(), c, http.MethodPut, "/v1/data/"+escapePath(target), body, "application/json")
			step.Status = st
			if err != nil {
				step.Error = err.Error()
			} else if st >= 300 {
				step.Error = strings.TrimSpace(string(resp))
			}
			failed = failed || step.Error != ""
			steps = append(steps, step)
		}
	}
	if req.Policies {
		for _, n := range names {
			if !strings.HasSuffix(n, ".rego") || (!req.IncludeTests && strings.HasSuffix(n, "_test.rego")) {
				continue
			}
			step := deployStep{Action: "PUT policy", Target: "/v1/policies/" + n}
			st, resp, err := a.opaDo(r.Context(), c, http.MethodPut, "/v1/policies/"+escapePath(n), []byte(files[n]), "text/plain")
			step.Status = st
			if err != nil {
				step.Error = err.Error()
			} else if st >= 300 {
				step.Error = strings.TrimSpace(string(resp))
			}
			failed = failed || step.Error != ""
			steps = append(steps, step)
		}
	}
	status := http.StatusOK
	if failed {
		status = http.StatusMultiStatus
	}
	writeJSON(w, status, map[string]any{"steps": steps, "ok": !failed})
}

type pullRequest struct {
	Connection string `json:"connection"`
	Policies   bool   `json:"policies"`
	Data       bool   `json:"data"`
	DataPath   string `json:"dataPath"`
}

// pullWorkspace downloads policies (GET /v1/policies) and data (GET /v1/data)
// from an OPA server into the workspace.
func (a *API) pullWorkspace(w http.ResponseWriter, r *http.Request) {
	if a.Cfg.ReadOnly {
		writeError(w, http.StatusForbidden, errReadOnly)
		return
	}
	var req pullRequest
	if !a.decode(w, r, &req) {
		return
	}
	id := r.PathValue("ws")
	if _, err := a.Workspaces.Get(id); err != nil {
		fail(w, err)
		return
	}
	c, err := a.resolveConnection(req.Connection)
	if err != nil {
		fail(w, err)
		return
	}
	written := []string{}
	if req.Policies {
		st, body, err := a.opaDo(r.Context(), c, http.MethodGet, "/v1/policies", nil, "")
		if err != nil || st != http.StatusOK {
			writeError(w, http.StatusBadGateway, fmt.Errorf("list policies: HTTP %d %v %s", st, err, body))
			return
		}
		var resp struct {
			Result []struct {
				ID  string `json:"id"`
				Raw string `json:"raw"`
			} `json:"result"`
		}
		// OPA <= 0.2 returned a bare array with capitalised keys.
		if json.Unmarshal(body, &resp) != nil || resp.Result == nil {
			var legacy []struct {
				ID  string `json:"ID"`
				Raw string `json:"Raw"`
			}
			_ = json.Unmarshal(body, &legacy)
			for _, l := range legacy {
				resp.Result = append(resp.Result, struct {
					ID  string `json:"id"`
					Raw string `json:"raw"`
				}{l.ID, l.Raw})
			}
		}
		for _, p := range resp.Result {
			if p.Raw == "" {
				continue
			}
			name := policyFileName(p.ID)
			if err := a.Workspaces.WriteFile(id, name, []byte(p.Raw)); err != nil {
				fail(w, err)
				return
			}
			written = append(written, name)
		}
	}
	if req.Data {
		target := "/v1/data"
		file := "data.json"
		if p := strings.Trim(req.DataPath, "/"); p != "" {
			target += "/" + escapePath(p)
			file = p + "/data.json"
		}
		st, body, err := a.opaDo(r.Context(), c, http.MethodGet, target, nil, "")
		if err != nil || st != http.StatusOK {
			writeError(w, http.StatusBadGateway, fmt.Errorf("get data: HTTP %d %v %s", st, err, body))
			return
		}
		var resp struct {
			Result json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(body, &resp); err != nil || resp.Result == nil {
			resp.Result = body
		}
		var v any
		_ = json.Unmarshal(resp.Result, &v)
		if m, ok := v.(map[string]any); ok && req.DataPath == "" {
			delete(m, "system") // OPA-internal documents
		}
		pretty, _ := json.MarshalIndent(v, "", "  ")
		if err := a.Workspaces.WriteFile(id, file, append(pretty, '\n')); err != nil {
			fail(w, err)
			return
		}
		written = append(written, file)
	}
	writeJSON(w, http.StatusOK, map[string]any{"written": written})
}

func policyFileName(id string) string {
	clean := strings.Trim(path.Clean("/"+id), "/")
	var parts []string
	for _, p := range strings.Split(clean, "/") {
		if p == "" || p == "." || p == ".." {
			continue
		}
		p = strings.TrimLeft(p, ".")
		if p == "" {
			p = "_"
		}
		parts = append(parts, p)
	}
	name := strings.Join(parts, "/")
	if name == "" {
		name = "policy"
	}
	if !strings.HasSuffix(name, ".rego") {
		name += ".rego"
	}
	return "pulled/" + name
}
