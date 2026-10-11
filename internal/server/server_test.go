package server

import (
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/api"
	"github.com/alasgarovnamig/opa-studio/internal/config"
	"github.com/alasgarovnamig/opa-studio/internal/controlplane"
	"github.com/alasgarovnamig/opa-studio/internal/opacli"
	"github.com/alasgarovnamig/opa-studio/internal/repl"
	"github.com/alasgarovnamig/opa-studio/internal/store"
	"github.com/alasgarovnamig/opa-studio/internal/workspace"
)

func handler(t *testing.T, cfg *config.Config) http.Handler {
	t.Helper()
	dir := t.TempDir()
	cfg.MaxBodyBytes = 1 << 20
	ws, _ := workspace.NewStore(filepath.Join(dir, "ws"))
	conns, _ := store.Open(filepath.Join(dir, "c.json"), nil, nil)
	cp, _ := controlplane.Open(filepath.Join(dir, "cp"), 10, 10)
	t.Cleanup(func() { cp.Close() })
	a := &api.API{Cfg: cfg, Log: slog.Default(), Workspaces: ws, Connections: conns, Control: cp, CLI: opacli.New(opacli.Options{}), REPL: repl.New("", 1, time.Minute)}
	ui := fstest.MapFS{"index.html": {Data: []byte("<html>studio</html>")}, "assets/app.js": {Data: []byte("js")}}
	return Handler(cfg, a, fs.FS(ui), slog.Default())
}

func get(h http.Handler, path string, hdr ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", path, nil)
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestSPAAndHeaders(t *testing.T) {
	h := handler(t, &config.Config{AuthMode: config.AuthNone})
	rec := get(h, "/policies")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "studio") {
		t.Errorf("SPA fallback = %d", rec.Code)
	}
	if rec.Header().Get("Content-Security-Policy") == "" || rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Error("security headers missing")
	}
	if rec := get(h, "/assets/app.js"); !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Error("assets must be cacheable")
	}
	if rec := get(h, "/healthz"); rec.Code != 200 {
		t.Error("healthz")
	}
}

func TestBasicAuth(t *testing.T) {
	h := handler(t, &config.Config{AuthMode: config.AuthBasic, BasicUser: "admin", BasicPassword: "pw"})
	if rec := get(h, "/api/workspaces"); rec.Code != 401 || rec.Header().Get("WWW-Authenticate") == "" {
		t.Errorf("unauthenticated = %d", rec.Code)
	}
	req := httptest.NewRequest("GET", "/api/workspaces", nil)
	req.SetBasicAuth("admin", "pw")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Errorf("authenticated = %d", rec.Code)
	}
	if rec := get(h, "/healthz"); rec.Code != 200 {
		t.Error("healthz must stay public")
	}
	if rec := get(h, "/cp/bundles/x"); rec.Code != 404 {
		t.Errorf("control plane uses its own token, got %d", rec.Code)
	}
}

func TestTokenAuth(t *testing.T) {
	cfg := &config.Config{AuthMode: config.AuthToken, AuthToken: "0123456789abcdef"}
	h := handler(t, cfg)
	if rec := get(h, "/api/workspaces"); rec.Code != 401 {
		t.Errorf("no token = %d", rec.Code)
	}
	if rec := get(h, "/"); rec.Code != 200 {
		t.Error("the SPA shell must load for the login form")
	}
	if rec := get(h, "/api/workspaces", "Authorization", "Bearer 0123456789abcdef"); rec.Code != 200 {
		t.Errorf("bearer = %d", rec.Code)
	}
	req := httptest.NewRequest("POST", "/api/auth", strings.NewReader(`{"token":"0123456789abcdef"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	cookies := rec.Result().Cookies()
	if rec.Code != 200 || len(cookies) != 1 || !cookies[0].HttpOnly {
		t.Fatalf("login = %d %v", rec.Code, cookies)
	}
	req = httptest.NewRequest("GET", "/api/workspaces", nil)
	req.AddCookie(cookies[0])
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Errorf("cookie = %d", rec.Code)
	}
}

func TestReadOnlyMiddleware(t *testing.T) {
	h := handler(t, &config.Config{AuthMode: config.AuthNone, ReadOnly: true})
	req := httptest.NewRequest("POST", "/api/workspaces", strings.NewReader(`{"name":"x"}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Errorf("read-only create = %d", rec.Code)
	}
}
