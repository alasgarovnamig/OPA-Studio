// Package server assembles the HTTP server: middleware, API routes and the UI.
package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"path"
	"runtime/debug"
	"slices"
	"strings"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/api"
	"github.com/alasgarovnamig/opa-studio/internal/config"
)

// Handler returns the root handler.
func Handler(cfg *config.Config, a *api.API, ui fs.FS, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	})
	mux.HandleFunc("POST /api/auth", AuthHandler(cfg))
	mux.HandleFunc("DELETE /api/auth", AuthHandler(cfg))
	a.Register(mux)
	mux.Handle("/", spa(ui))

	var h http.Handler = mux
	h = readOnly(cfg, h)
	h = authenticate(cfg, h)
	h = cors(cfg, h)
	h = securityHeaders(h)
	h = recoverer(log, h)
	h = logRequests(log, h)
	return h
}

// ---- middleware ------------------------------------------------------------

type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	n, err := s.ResponseWriter.Write(b)
	s.bytes += n
	return n, err
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func logRequests(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
			return
		}
		lvl := slog.LevelDebug
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/cp/") {
			lvl = slog.LevelInfo
		}
		if rec.status >= 500 {
			lvl = slog.LevelError
			if strings.Contains(r.URL.Path, "/proxy/") {
				lvl = slog.LevelWarn // upstream OPA error, relayed verbatim
			}
		}
		log.Log(r.Context(), lvl, "http", "method", r.Method, "path", r.URL.Path, "status", rec.status,
			"bytes", rec.bytes, "duration_ms", time.Since(start).Milliseconds(), "remote", r.RemoteAddr)
	})
}

func recoverer(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				if err, ok := v.(error); ok && errors.Is(err, http.ErrAbortHandler) {
					panic(v)
				}
				log.Error("panic", "error", v, "stack", string(debug.Stack()))
				http.Error(w, `{"error":"internal server error"}`, http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if !strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/cp/") {
			h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'")
		}
		next.ServeHTTP(w, r)
	})
}

func cors(cfg *config.Config, next http.Handler) http.Handler {
	if len(cfg.CORSOrigins) == 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (slices.Contains(cfg.CORSOrigins, "*") || slices.Contains(cfg.CORSOrigins, origin)) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept, If-None-Match, X-Opa-Header-Authorization")
			w.Header().Set("Access-Control-Expose-Headers", "X-Studio-Upstream-Status, X-Studio-Duration-Ms, X-Studio-Target, ETag")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func equal(a, b string) bool {
	ha, hb := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ha[:], hb[:]) == 1
}

// public paths never require Studio authentication. /cp/* is protected by
// the separate control plane token because OPA agents call it.
func public(p string) bool {
	return p == "/healthz" || p == "/readyz" || strings.HasPrefix(p, "/cp/") || p == "/api/auth"
}

func authenticate(cfg *config.Config, next http.Handler) http.Handler {
	if cfg.AuthMode == config.AuthNone {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if public(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		switch cfg.AuthMode {
		case config.AuthBasic:
			u, p, ok := r.BasicAuth()
			if ok && equal(u, cfg.BasicUser) && equal(p, cfg.BasicPassword) {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("WWW-Authenticate", `Basic realm="OPA Studio", charset="UTF-8"`)
		case config.AuthToken:
			tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if tok == "" {
				if c, err := r.Cookie("opa_studio_token"); err == nil {
					tok = c.Value
				}
			}
			if tok != "" && equal(tok, cfg.AuthToken) {
				next.ServeHTTP(w, r)
				return
			}
			// The SPA shell must load so it can show the login form.
			if !strings.HasPrefix(r.URL.Path, "/api/") {
				next.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"authentication required","authMode":"` + string(cfg.AuthMode) + `"}`))
	})
}

// readOnly rejects mutating Studio API calls when the server is read-only.
// Evaluation endpoints (CLI runs, REPL, proxied queries) stay available; the
// handlers themselves block writes to OPA servers and workspaces.
func readOnly(cfg *config.Config, next http.Handler) http.Handler {
	if !cfg.ReadOnly {
		return next
	}
	allowed := []string{"/api/cli/run", "/api/repl", "/api/bundles/inspect", "/api/connections/"}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions && strings.HasPrefix(r.URL.Path, "/api/") {
			ok := false
			for _, p := range allowed {
				if strings.HasPrefix(r.URL.Path, p) {
					ok = true
				}
			}
			if strings.HasPrefix(r.URL.Path, "/api/connections/") && !strings.Contains(r.URL.Path, "/proxy/") && !strings.HasSuffix(r.URL.Path, "/test") {
				ok = false
			}
			if !ok {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(`{"error":"OPA Studio runs in read-only mode"}`))
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// spa serves the embedded UI and falls back to index.html for client routes.
func spa(ui fs.FS) http.Handler {
	files := http.FileServer(http.FS(ui))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if f, err := ui.Open(p); err == nil {
			st, _ := f.Stat()
			f.Close()
			if st != nil && !st.IsDir() {
				if strings.HasPrefix(p, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				} else {
					w.Header().Set("Cache-Control", "no-cache")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		index, err := fs.ReadFile(ui, "index.html")
		if err != nil {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte("OPA Studio UI is not built. Run `make ui` and rebuild, or use the API under /api.\n"))
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(index)
	})
}
