// Command opa-studio is a web UI covering every capability of Open Policy Agent.
package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/api"
	"github.com/alasgarovnamig/opa-studio/internal/buildinfo"
	"github.com/alasgarovnamig/opa-studio/internal/config"
	"github.com/alasgarovnamig/opa-studio/internal/controlplane"
	"github.com/alasgarovnamig/opa-studio/internal/localopa"
	"github.com/alasgarovnamig/opa-studio/internal/manifest"
	"github.com/alasgarovnamig/opa-studio/internal/opacli"
	"github.com/alasgarovnamig/opa-studio/internal/repl"
	"github.com/alasgarovnamig/opa-studio/internal/server"
	"github.com/alasgarovnamig/opa-studio/internal/store"
	"github.com/alasgarovnamig/opa-studio/internal/workspace"
	"github.com/alasgarovnamig/opa-studio/web"
)

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "version", "--version":
			fmt.Printf("OPA Studio %s (OPA %s, commit %s, built %s)\n", buildinfo.Version, buildinfo.OPAVersion, buildinfo.Commit, buildinfo.Date)
			return
		case "healthcheck":
			os.Exit(healthcheck())
		}
	}
	if err := run(); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintln(os.Stderr, "opa-studio:", err)
		os.Exit(1)
	}
}

// healthcheck probes /healthz of the local instance; used by container
// HEALTHCHECK instructions (the runtime image ships no curl/wget).
func healthcheck() int {
	addr := os.Getenv("OPA_STUDIO_ADDR")
	if addr == "" {
		addr = ":9080"
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return 1
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	scheme := "http"
	client := &http.Client{Timeout: 3 * time.Second}
	if os.Getenv("OPA_STUDIO_TLS_CERT_FILE") != "" {
		scheme = "https"
		client.Transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}} //nolint:gosec // loopback self-check
	}
	resp, err := client.Get(scheme + "://" + net.JoinHostPort(host, port) + "/healthz")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func newLogger(cfg *config.Config) *slog.Logger {
	var lvl slog.Level
	_ = lvl.UnmarshalText([]byte(cfg.LogLevel))
	opts := &slog.HandlerOptions{Level: lvl}
	if strings.EqualFold(cfg.LogFormat, "json") {
		return slog.New(slog.NewJSONHandler(os.Stderr, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stderr, opts))
}

// loadManifest picks the manifest describing the OPA binary: the measured
// manifest of that exact release when known, otherwise a live introspection.
func loadManifest(bin *opacli.Binary, log *slog.Logger) *manifest.Manifest {
	if bin == nil {
		m, err := manifest.Get(buildinfo.OPAVersion)
		if err != nil {
			log.Warn("no manifest for target OPA version", "version", buildinfo.OPAVersion, "error", err)
			return nil
		}
		return m
	}
	if m, err := manifest.Get(bin.Version); err == nil {
		return m
	}
	log.Info("unknown OPA build, introspecting binary", "version", bin.Version)
	return manifest.Live(bin.Version, opacli.Help(bin.Path))
}

func run() error {
	cfg, err := config.Load(os.Args[1:])
	if err != nil {
		return err
	}
	log := newLogger(cfg)
	slog.SetDefault(log)
	log.Info("starting OPA Studio", "version", buildinfo.Version, "target_opa", buildinfo.OPAVersion, "commit", buildinfo.Commit)

	for _, d := range []string{cfg.DataDir, filepath.Join(cfg.DataDir, "tmp")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return fmt.Errorf("data dir: %w", err)
		}
	}
	// Remove leftovers of a previous crash.
	if entries, err := os.ReadDir(filepath.Join(cfg.DataDir, "tmp")); err == nil {
		for _, e := range entries {
			_ = os.RemoveAll(filepath.Join(cfg.DataDir, "tmp", e.Name()))
		}
	}

	var bin *opacli.Binary
	if p, err := opacli.Locate(cfg.OPABinary); err != nil {
		log.Warn("OPA binary not found: CLI features, REPL and Local OPA are disabled", "error", err)
	} else if bin, err = opacli.Detect(p); err != nil {
		log.Warn("OPA binary unusable", "path", p, "error", err)
		bin = nil
	} else {
		log.Info("using OPA binary", "path", bin.Path, "version", bin.Version)
		if bin.Version != manifest.Normalize(buildinfo.OPAVersion) {
			log.Warn("OPA binary does not match the version this Studio release targets", "binary", bin.Version, "target", buildinfo.OPAVersion)
		}
	}
	m := loadManifest(bin, log)

	runner := opacli.New(opacli.Options{
		Binary: bin, Manifest: m, Sandbox: cfg.CLISandbox, Timeout: cfg.CLITimeout,
		MaxOutput: cfg.CLIMaxOutput, Concurrency: cfg.CLIConcurrency, TmpRoot: filepath.Join(cfg.DataDir, "tmp"),
	})

	ws, err := workspace.NewStore(filepath.Join(cfg.DataDir, "workspaces"))
	if err != nil {
		return err
	}
	if list, _ := ws.List(); len(list) == 0 {
		dialect := "v1"
		if m != nil && m.PreferredDialect != "" {
			dialect = m.PreferredDialect
		}
		if _, err := ws.Create("default", "Example: RBAC", "Role-based access control example", api.Template("rbac", dialect)); err != nil {
			log.Warn("cannot create example workspace", "error", err)
		}
	}

	var local *localopa.Manager
	var localConn *store.Connection
	if cfg.LocalOPA && bin != nil {
		local, err = localopa.New(bin.Path, m, filepath.Join(cfg.DataDir, "local-opa"), localopa.Settings{
			Addr: cfg.LocalOPAAddr, Autostart: cfg.LocalOPAAutostart, ExtraArgs: cfg.LocalOPAArgs,
			LogLevel: "info", RestartOnFailure: true, Workspace: "default",
		}, ws.Dir, log)
		if err != nil {
			return err
		}
		localConn = &store.Connection{ID: "local", Name: "Local OPA (managed)", URL: local.URL(), Source: "local"}
		if local.Settings().Autostart {
			if err := local.Start(); err != nil {
				log.Warn("local OPA failed to start", "error", err)
			}
		}
	}

	conns, err := store.Open(filepath.Join(cfg.DataDir, "connections.json"), cfg.Connections, localConn)
	if err != nil {
		return err
	}
	cp, err := controlplane.Open(filepath.Join(cfg.DataDir, "control"), cfg.DecisionLogLimit, cfg.StatusLimit)
	if err != nil {
		return err
	}
	defer cp.Close()

	binPath := ""
	if bin != nil {
		binPath = bin.Path
	}
	replMgr := repl.New(binPath, cfg.REPLMaxSessions, cfg.REPLIdleTimeout)

	a := &api.API{
		Cfg: cfg, Log: log, CLI: runner, Manifest: m, Workspaces: ws, Connections: conns,
		LocalOPA: local, REPL: replMgr, Control: cp, StartedAt: time.Now().UTC(),
	}
	ui, err := fs.Sub(web.Dist, "dist")
	if err != nil {
		return err
	}
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.Handler(cfg, a, ui, log),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", cfg.Addr, "tls", cfg.TLSCertFile != "", "auth", cfg.AuthMode, "read_only", cfg.ReadOnly)
		if cfg.TLSCertFile != "" {
			errCh <- srv.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile)
		} else {
			errCh <- srv.ListenAndServe()
		}
	}()
	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	log.Info("shutting down")
	sctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	_ = srv.Shutdown(sctx)
	replMgr.Shutdown()
	if local != nil {
		local.Shutdown(sctx)
	}
	return nil
}
