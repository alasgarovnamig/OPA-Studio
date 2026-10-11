package server

import (
	"encoding/json"
	"net/http"

	"github.com/alasgarovnamig/opa-studio/internal/config"
)

// AuthHandler implements POST/DELETE /api/auth for token mode: the browser
// exchanges the token for an HttpOnly cookie so EventSource streams and
// downloads are authenticated too.
func AuthHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if cfg.AuthMode != config.AuthToken {
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		cookie := &http.Cookie{Name: "opa_studio_token", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: r.TLS != nil}
		if r.Method == http.MethodDelete {
			cookie.MaxAge = -1
			http.SetCookie(w, cookie)
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
		var body struct {
			Token string `json:"token"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 4096)
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !equal(body.Token, cfg.AuthToken) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"invalid token"}`))
			return
		}
		cookie.Value = body.Token
		cookie.MaxAge = 12 * 3600
		http.SetCookie(w, cookie)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}
}
