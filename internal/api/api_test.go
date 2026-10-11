package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/bundle"
	"github.com/alasgarovnamig/opa-studio/internal/config"
	"github.com/alasgarovnamig/opa-studio/internal/controlplane"
	"github.com/alasgarovnamig/opa-studio/internal/manifest"
	"github.com/alasgarovnamig/opa-studio/internal/opacli"
	"github.com/alasgarovnamig/opa-studio/internal/repl"
	"github.com/alasgarovnamig/opa-studio/internal/store"
	"github.com/alasgarovnamig/opa-studio/internal/workspace"
)

// fakeOPA records requests and answers like a minimal OPA server.
type fakeOPA struct {
	mu       sync.Mutex
	requests []string
	auth     []string
}

func (f *fakeOPA) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	f.requests = append(f.requests, r.Method+" "+r.URL.RequestURI()+" "+string(body))
	f.auth = append(f.auth, r.Header.Get("Authorization"))
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch {
	case r.URL.Path == "/v1/config":
		_, _ = w.Write([]byte(`{"result":{"labels":{"version":"1.0.0"}}}`))
	case r.URL.Path == "/v1/policies" && r.Method == http.MethodGet:
		_, _ = w.Write([]byte(`{"result":[{"id":"x/../../evil.rego","raw":"package evil"},{"id":"app.rego","raw":"package app"}]}`))
	case r.URL.Path == "/v1/data" && r.Method == http.MethodGet:
		_, _ = w.Write([]byte(`{"result":{"system":{"x":1},"servers":[1]}}`))
	case strings.HasPrefix(r.URL.Path, "/v1/policies/bad"):
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"invalid_parameter","message":"parse error"}`))
	case r.Method == http.MethodPut:
		w.WriteHeader(http.StatusNoContent)
	default:
		_, _ = w.Write([]byte(`{"result":true}`))
	}
}

func newAPI(t *testing.T, opaURL string, readOnly bool) (*API, *http.ServeMux) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{MaxBodyBytes: 1 << 20, ProxyTimeout: 5 * time.Second, ReadOnly: readOnly}
	ws, _ := workspace.NewStore(filepath.Join(dir, "ws"))
	m, _ := manifest.Get("v1.21.1")
	if _, err := ws.Create("default", "Default", "", Template("rbac", "v1")); err != nil {
		t.Fatal(err)
	}
	conns, err := store.Open(filepath.Join(dir, "c.json"), []config.Connection{{ID: "fake", Name: "Fake", URL: opaURL, Token: "tok"}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	cp, _ := controlplane.Open(filepath.Join(dir, "cp"), 100, 100)
	t.Cleanup(func() { cp.Close() })
	a := &API{
		Cfg: cfg, Log: slog.Default(), Manifest: m, Workspaces: ws, Connections: conns, Control: cp,
		CLI: opacli.New(opacli.Options{Manifest: m, Sandbox: true}), REPL: repl.New("", 1, time.Minute), StartedAt: time.Now(),
	}
	mux := http.NewServeMux()
	a.Register(mux)
	return a, mux
}

func do(t *testing.T, h http.Handler, method, url string, body any, hdr ...string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		rd = bytes.NewReader(b)
	case string:
		rd = strings.NewReader(b)
	default:
		j, _ := json.Marshal(b)
		rd = bytes.NewReader(j)
	}
	req := httptest.NewRequest(method, url, rd)
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestProxyForwardsAndAuthenticates(t *testing.T) {
	f := &fakeOPA{}
	srv := httptest.NewServer(f)
	defer srv.Close()
	_, mux := newAPI(t, srv.URL, false)

	rec := do(t, mux, "POST", "/api/connections/fake/proxy/v1/data/app/allow?explain=full&pretty", `{"input":{}}`, "Content-Type", "application/json", "X-Opa-Header-X-Custom", "1")
	if rec.Code != 200 || rec.Header().Get("X-Studio-Upstream-Status") != "200" {
		t.Fatalf("proxy = %d %s", rec.Code, rec.Body)
	}
	if !strings.Contains(f.requests[0], "POST /v1/data/app/allow?explain=full&pretty {\"input\":{}}") {
		t.Errorf("upstream request = %q", f.requests[0])
	}
	if f.auth[0] != "Bearer tok" {
		t.Errorf("auth = %q", f.auth[0])
	}
	if rec := do(t, mux, "GET", "/api/connections/missing/proxy/v1/data", nil); rec.Code != 404 {
		t.Errorf("unknown connection = %d", rec.Code)
	}
	// Tokens never leave the server.
	rec = do(t, mux, "GET", "/api/connections", nil)
	if strings.Contains(rec.Body.String(), "tok\"") {
		t.Errorf("token leaked: %s", rec.Body)
	}
	rec = do(t, mux, "POST", "/api/connections/fake/test", nil)
	var p probeResult
	_ = json.Unmarshal(rec.Body.Bytes(), &p)
	if !p.Reachable || p.Version != "v1.0.0" {
		t.Errorf("probe = %+v", p)
	}
}

func TestReadOnlyBlocksWrites(t *testing.T) {
	f := &fakeOPA{}
	srv := httptest.NewServer(f)
	defer srv.Close()
	_, mux := newAPI(t, srv.URL, true)
	if rec := do(t, mux, "PUT", "/api/connections/fake/proxy/v1/data/x", `{}`); rec.Code != 403 {
		t.Errorf("read-only PUT = %d", rec.Code)
	}
	if rec := do(t, mux, "POST", "/api/connections/fake/proxy/v1/data/x", `{}`); rec.Code != 200 {
		t.Errorf("read-only POST query = %d", rec.Code)
	}
	if rec := do(t, mux, "POST", "/api/workspaces/default/deploy", map[string]any{"connection": "fake", "policies": true}); rec.Code != 403 {
		t.Errorf("read-only deploy = %d", rec.Code)
	}
}

func TestDeployAndPull(t *testing.T) {
	f := &fakeOPA{}
	srv := httptest.NewServer(f)
	defer srv.Close()
	a, mux := newAPI(t, srv.URL, false)
	_ = a.Workspaces.WriteFile("default", "bad.rego", []byte("package bad"))

	rec := do(t, mux, "POST", "/api/workspaces/default/deploy", map[string]any{"connection": "fake", "policies": true, "data": true, "dataPrefix": "tenant"})
	if rec.Code != http.StatusMultiStatus {
		t.Fatalf("deploy = %d %s", rec.Code, rec.Body)
	}
	joined := strings.Join(f.requests, "\n")
	for _, want := range []string{"PUT /v1/data/tenant {\"rbac\"", "PUT /v1/policies/app/rbac.rego package app.rbac", "PUT /v1/policies/bad.rego"} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in\n%s", want, joined)
		}
	}
	if strings.Contains(joined, "rbac_test.rego") {
		t.Error("tests must not be deployed unless requested")
	}

	rec = do(t, mux, "POST", "/api/workspaces/default/pull", map[string]any{"connection": "fake", "policies": true, "data": true})
	if rec.Code != 200 {
		t.Fatalf("pull = %d %s", rec.Code, rec.Body)
	}
	files, _ := a.Workspaces.ReadAll("default")
	if files["pulled/app.rego"] != "package app" || files["pulled/evil.rego"] != "package evil" {
		t.Errorf("pulled files = %v", keys(files))
	}
	if strings.Contains(files["data.json"], "system") {
		t.Error("system documents must not be pulled")
	}
}

func keys(m map[string]string) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}

func TestControlPlaneProtocol(t *testing.T) {
	a, mux := newAPI(t, "http://127.0.0.1:1", false)
	rec := do(t, mux, "POST", "/api/control/bundles/app", map[string]any{"workspace": "default", "revision": "r7"}, "Content-Type", "application/json")
	if rec.Code != 201 {
		t.Fatalf("publish = %d %s", rec.Code, rec.Body)
	}
	rec = do(t, mux, "GET", "/cp/bundles/app", nil)
	etag := rec.Header().Get("ETag")
	if rec.Code != 200 || etag == "" {
		t.Fatalf("serve = %d", rec.Code)
	}
	s, err := bundle.Inspect(rec.Body.Bytes())
	if err != nil || !strings.Contains(string(s.Manifest), "r7") {
		t.Errorf("served bundle = %+v %v", s, err)
	}
	if rec := do(t, mux, "GET", "/cp/bundles/app", nil, "If-None-Match", etag); rec.Code != 304 {
		t.Errorf("conditional GET = %d", rec.Code)
	}
	if rec := do(t, mux, "POST", "/cp/logs", `[{"decision_id":"d1","path":"app/rbac/allow","result":true}]`); rec.Code != 200 {
		t.Errorf("logs = %d", rec.Code)
	}
	if rec := do(t, mux, "POST", "/cp/status", `{"labels":{"id":"i1"}}`); rec.Code != 200 {
		t.Errorf("status = %d", rec.Code)
	}
	rec = do(t, mux, "GET", "/api/control/decisions?path=app", nil)
	if !strings.Contains(rec.Body.String(), "d1") {
		t.Errorf("decisions = %s", rec.Body)
	}
	rec = do(t, mux, "GET", "/api/control/config?bundle=app", nil)
	if !strings.Contains(rec.Body.String(), "resource: \"bundles/app\"") || !strings.Contains(rec.Body.String(), "/cp\"") {
		t.Errorf("config = %s", rec.Body)
	}

	a.Cfg.ControlPlaneToken = "cp-secret"
	if rec := do(t, mux, "GET", "/cp/bundles/app", nil); rec.Code != 401 {
		t.Errorf("unauthenticated agent = %d", rec.Code)
	}
	if rec := do(t, mux, "GET", "/cp/bundles/app", nil, "Authorization", "Bearer cp-secret"); rec.Code != 200 {
		t.Errorf("authenticated agent = %d", rec.Code)
	}
}

func TestWorkspaceAPI(t *testing.T) {
	_, mux := newAPI(t, "http://127.0.0.1:1", false)
	rec := do(t, mux, "POST", "/api/workspaces", map[string]any{"name": "Legacy demo", "template": "rbac"})
	if rec.Code != 201 {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	if rec := do(t, mux, "PUT", "/api/workspaces/legacy-demo/files/policies/x.rego", "package x"); rec.Code != 204 {
		t.Errorf("write = %d", rec.Code)
	}
	if rec := do(t, mux, "GET", "/api/workspaces/legacy-demo/files/policies/x.rego", nil); rec.Body.String() != "package x" {
		t.Errorf("read = %s", rec.Body)
	}
	if rec := do(t, mux, "PUT", "/api/workspaces/legacy-demo/files/..%2F..%2Fevil", "x"); rec.Code == 204 {
		t.Error("traversal must fail")
	}
	rec = do(t, mux, "GET", "/api/workspaces/legacy-demo/export", nil)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/gzip" {
		t.Fatalf("export = %d", rec.Code)
	}
	if rec := do(t, mux, "POST", "/api/bundles/inspect", rec.Body.Bytes()); rec.Code != 200 {
		t.Errorf("inspect = %d", rec.Code)
	}
	if rec := do(t, mux, "POST", "/api/cli/run", map[string]any{"args": []string{"version"}}); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("cli without binary = %d", rec.Code)
	}
	if rec := do(t, mux, "GET", "/api/nope", nil); rec.Code != 404 {
		t.Errorf("unknown route = %d", rec.Code)
	}
}

func TestTemplatesCoverEveryDialect(t *testing.T) {
	for _, d := range []string{"v1", "rego.v1", "future-keywords", "legacy-assign", "legacy", "datalog", "datalog-noinput"} {
		files := Template("rbac", d)
		if !strings.HasPrefix(files["app/rbac.rego"], "package app.rbac") {
			t.Errorf("%s: missing policy", d)
		}
	}
	if len(Template("empty", "v1")) != 1 {
		t.Error("empty template")
	}
}
