package api

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/store"
)

// ---- connection CRUD ---------------------------------------------------------

func (a *API) resolveConnection(id string) (store.Connection, error) {
	c, err := a.Connections.Get(id)
	if err != nil {
		return c, err
	}
	if c.Source == "local" && a.LocalOPA != nil {
		c.URL = a.LocalOPA.URL()
	}
	return c, nil
}

func (a *API) listConnections(w http.ResponseWriter, r *http.Request) {
	list := a.Connections.List()
	out := make([]store.Connection, 0, len(list))
	for _, c := range list {
		if c.Source == "local" && a.LocalOPA != nil {
			c.URL = a.LocalOPA.URL()
		}
		out = append(out, c.Public())
	}
	writeJSON(w, http.StatusOK, out)
}

func (a *API) getConnection(w http.ResponseWriter, r *http.Request) {
	c, err := a.resolveConnection(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, c.Public())
}

func (a *API) createConnection(w http.ResponseWriter, r *http.Request) {
	var c store.Connection
	if !a.decode(w, r, &c) {
		return
	}
	created, err := a.Connections.Create(c)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created.Public())
}

func (a *API) updateConnection(w http.ResponseWriter, r *http.Request) {
	var c store.Connection
	if !a.decode(w, r, &c) {
		return
	}
	id := r.PathValue("id")
	updated, err := a.Connections.Update(id, c)
	if err != nil {
		fail(w, err)
		return
	}
	a.proxy.forget(id)
	writeJSON(w, http.StatusOK, updated.Public())
}

func (a *API) deleteConnection(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := a.Connections.Delete(id); err != nil {
		fail(w, err)
		return
	}
	a.proxy.forget(id)
	w.WriteHeader(http.StatusNoContent)
}

// testConnection probes a server and reports its version where possible.
func (a *API) testConnection(w http.ResponseWriter, r *http.Request) {
	c, err := a.resolveConnection(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	res := a.probe(r.Context(), c)
	// The managed server runs the bundled binary, so its version is known even
	// for releases that predate the Config API.
	if res.Reachable && res.Version == "" && c.Source == "local" && a.CLI.Binary() != nil {
		res.Version, res.Source = a.CLI.Binary().Version, "binary"
	}
	writeJSON(w, http.StatusOK, res)
}

type probeResult struct {
	Reachable bool   `json:"reachable"`
	Version   string `json:"version,omitempty"`
	Source    string `json:"versionSource,omitempty"`
	Healthy   *bool  `json:"healthy,omitempty"`
	LatencyMs int64  `json:"latencyMs"`
	Error     string `json:"error,omitempty"`
	URL       string `json:"url"`
}

func (a *API) probe(ctx context.Context, c store.Connection) probeResult {
	res := probeResult{URL: c.URL}
	client, err := a.proxy.client(c)
	if err != nil {
		res.Error = err.Error()
		return res
	}
	get := func(path string) (int, []byte, error) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.URL+path, nil)
		applyAuth(req, c)
		resp, err := client.Do(req)
		if err != nil {
			return 0, nil, err
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return resp.StatusCode, b, nil
	}
	start := time.Now()
	st, _, err := get("/v1/policies")
	res.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		res.Error = err.Error()
		return res
	}
	res.Reachable = st < 500
	if st == http.StatusUnauthorized || st == http.StatusForbidden {
		res.Error = fmt.Sprintf("OPA rejected the credentials (HTTP %d)", st)
	}
	if st, _, err := get("/health"); err == nil && st != http.StatusNotFound {
		ok := st == http.StatusOK
		res.Healthy = &ok
	}
	for _, src := range []string{"/v1/config", "/v1/status"} {
		st, body, err := get(src)
		if err != nil || st != http.StatusOK {
			continue
		}
		var doc struct {
			Result struct {
				Labels map[string]string `json:"labels"`
			} `json:"result"`
		}
		if json.Unmarshal(body, &doc) == nil && doc.Result.Labels["version"] != "" {
			res.Version = "v" + strings.TrimPrefix(doc.Result.Labels["version"], "v")
			res.Source = src
			break
		}
	}
	return res
}

// ---- proxy -----------------------------------------------------------------

type proxyPool struct {
	timeout time.Duration
	mu      sync.Mutex
	clients map[string]*http.Client
}

func newProxyPool(timeout time.Duration) *proxyPool {
	return &proxyPool{timeout: timeout, clients: map[string]*http.Client{}}
}

func (p *proxyPool) forget(id string) {
	p.mu.Lock()
	delete(p.clients, id)
	p.mu.Unlock()
}

func (p *proxyPool) client(c store.Connection) (*http.Client, error) {
	key := c.ID + "|" + c.UpdatedAt.String()
	p.mu.Lock()
	defer p.mu.Unlock()
	if cl, ok := p.clients[key]; ok {
		return cl, nil
	}
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: c.InsecureSkipVerify} //nolint:gosec // explicit per-connection opt-in
	if c.CACert != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(c.CACert)) {
			return nil, errors.New("invalid CA certificate PEM")
		}
		tlsCfg.RootCAs = pool
	}
	if c.ClientCert != "" || c.ClientKey != "" {
		cert, err := tls.X509KeyPair([]byte(c.ClientCert), []byte(c.ClientKey))
		if err != nil {
			return nil, fmt.Errorf("invalid client certificate: %w", err)
		}
		tlsCfg.Certificates = []tls.Certificate{cert}
	}
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = tlsCfg
	tr.Proxy = http.ProxyFromEnvironment
	cl := &http.Client{
		Transport: tr,
		Timeout:   p.timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	for k := range p.clients {
		if strings.HasPrefix(k, c.ID+"|") {
			delete(p.clients, k)
		}
	}
	p.clients[key] = cl
	return cl, nil
}

func applyAuth(req *http.Request, c store.Connection) {
	for k, v := range c.Headers {
		req.Header.Set(k, v)
	}
	if c.Token != "" && req.Header.Get("Authorization") == "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
}

// Headers forwarded verbatim from the browser to OPA.
var forwardHeaders = []string{"Content-Type", "Accept", "If-None-Match", "If-Match", "Content-Encoding", "Accept-Encoding"}

// Response headers returned to the browser.
var returnHeaders = []string{"Content-Type", "Etag", "Content-Encoding", "Www-Authenticate", "Location", "Cache-Control"}

const customHeaderPrefix = "X-Opa-Header-"

// proxyRequest forwards any request to the selected OPA server. This is the
// foundation of the API console: every REST operation OPA offers - including
// ones Studio has no dedicated page for - can be issued through it.
func (a *API) proxyRequest(w http.ResponseWriter, r *http.Request) {
	c, err := a.resolveConnection(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	if a.Cfg.ReadOnly && (r.Method == http.MethodPut || r.Method == http.MethodPatch || r.Method == http.MethodDelete) {
		writeError(w, http.StatusForbidden, errors.New("OPA Studio runs in read-only mode"))
		return
	}
	client, err := a.proxy.client(c)
	if err != nil {
		fail(w, err)
		return
	}
	target, err := url.Parse(c.URL + "/" + strings.TrimPrefix(r.PathValue("path"), "/"))
	if err != nil {
		fail(w, err)
		return
	}
	target.RawQuery = r.URL.RawQuery
	body, ok := a.readBody(w, r)
	if !ok {
		return
	}
	var rd io.Reader
	if len(body) > 0 || r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), rd)
	if err != nil {
		fail(w, err)
		return
	}
	for _, h := range forwardHeaders {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}
	applyAuth(req, c)
	for k, vs := range r.Header {
		if strings.HasPrefix(k, customHeaderPrefix) && len(vs) > 0 {
			req.Header.Set(strings.TrimPrefix(k, customHeaderPrefix), vs[0])
		}
	}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "OPA unreachable: " + err.Error(), "studioProxyError": true})
		return
	}
	defer resp.Body.Close()
	for _, h := range returnHeaders {
		if v := resp.Header.Get(h); v != "" {
			w.Header().Set(h, v)
		}
	}
	w.Header().Set("X-Studio-Upstream-Status", fmt.Sprint(resp.StatusCode))
	w.Header().Set("X-Studio-Duration-Ms", fmt.Sprint(time.Since(start).Milliseconds()))
	w.Header().Set("X-Studio-Target", target.Redacted())
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, a.Cfg.MaxBodyBytes))
}

// opaDo performs a request against a connection (used by deploy/pull).
func (a *API) opaDo(ctx context.Context, c store.Connection, method, path string, body []byte, contentType string) (int, []byte, error) {
	client, err := a.proxy.client(c)
	if err != nil {
		return 0, nil, err
	}
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.URL+path, rd)
	if err != nil {
		return 0, nil, err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	applyAuth(req, c)
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, a.Cfg.MaxBodyBytes))
	return resp.StatusCode, b, err
}
