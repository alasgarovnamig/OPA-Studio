// Package integration exercises OPA Studio against a real OPA binary.
//
//	OPA_BIN=/path/to/opa go test ./test/integration/
//
// The test is skipped when OPA_BIN is unset. CI runs it with the OPA release
// the Studio release targets.
package integration

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alasgarovnamig/opa-studio/internal/api"
	"github.com/alasgarovnamig/opa-studio/internal/localopa"
	"github.com/alasgarovnamig/opa-studio/internal/manifest"
	"github.com/alasgarovnamig/opa-studio/internal/opacli"
	"github.com/alasgarovnamig/opa-studio/internal/repl"
	"github.com/alasgarovnamig/opa-studio/internal/workspace"
)

func freeAddr(t *testing.T) string {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

func setup(t *testing.T) (*opacli.Binary, *manifest.Manifest, *workspace.Store) {
	path := os.Getenv("OPA_BIN")
	if path == "" {
		t.Skip("OPA_BIN not set")
	}
	bin, err := opacli.Detect(path)
	if err != nil {
		t.Fatal(err)
	}
	m, err := manifest.Get(bin.Version)
	if err != nil {
		m = manifest.Live(bin.Version, opacli.Help(path))
	}
	ws, _ := workspace.NewStore(t.TempDir())
	if _, err := ws.Create("default", "Default", "", api.Template("rbac", m.PreferredDialect)); err != nil {
		t.Fatal(err)
	}
	return bin, m, ws
}

func TestCLI(t *testing.T) {
	bin, m, ws := setup(t)
	dir, _ := ws.Dir("default")
	r := opacli.New(opacli.Options{Binary: bin, Manifest: m, Sandbox: true, Timeout: time.Minute, MaxOutput: 1 << 20, Concurrency: 2, TmpRoot: t.TempDir()})
	if m.HasCommand("test") {
		args := []string{"test", "-v", "."}
		if m.HasFlag("test", "ignore") {
			args = append(args, "--ignore", "input*.json")
		}
		res, err := r.Run(context.Background(), &opacli.Request{Args: args}, dir)
		if err != nil || res.ExitCode != 0 {
			t.Fatalf("opa test: %v %+v", err, res)
		}
	}
	if m.HasCommand("eval") && m.HasFlag("eval", "format") && m.HasFlag("eval", "ignore") {
		res, err := r.Run(context.Background(), &opacli.Request{Args: []string{"eval", "-d", ".", "--ignore", "input*.json", "-i", "input.json", "--format", "json", "data.app.rbac.allow"}}, dir)
		if err != nil || !strings.Contains(res.Stdout, `"value": true`) {
			t.Fatalf("opa eval: %v %+v", err, res)
		}
	}
	if m.HasCommand("build") && m.HasFlag("build", "bundle") {
		res, err := r.Run(context.Background(), &opacli.Request{Args: []string{"build", "-b", ".", "--ignore", "input*.json", "-o", "bundle.tar.gz"}, Collect: []string{"bundle.tar.gz"}}, dir)
		if err != nil || res.Files["bundle.tar.gz"].Base64 == "" {
			t.Fatalf("opa build: %v %+v", err, res)
		}
	}
}

func TestLocalOPAAndREPL(t *testing.T) {
	bin, m, ws := setup(t)
	addr := freeAddr(t)
	mg, err := localopa.New(bin.Path, m, t.TempDir(), localopa.Settings{Addr: addr, Workspace: "default"}, ws.Dir, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	if err := mg.Start(); err != nil {
		t.Fatal(err)
	}
	defer mg.Stop()
	deadline := time.Now().Add(30 * time.Second)
	for mg.State().Status != "running" && time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
	}
	if mg.State().Status != "running" {
		t.Fatalf("local OPA did not start: %+v %v", mg.State(), mg.Logs(0))
	}
	body := `{"input": {"user": "bob", "action": "update", "type": "dog"}}`
	resp, err := http.Post(mg.URL()+"/v1/data/app/rbac/allow", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var out struct {
		Result any `json:"result"`
	}
	_ = json.Unmarshal(b, &out)
	if m.PreferredDialect != "datalog-noinput" && out.Result != true {
		t.Errorf("decision = %s", b)
	}

	rm := repl.New(bin.Path, 2, time.Minute)
	defer rm.Shutdown()
	d := t.TempDir()
	_ = os.WriteFile(filepath.Join(d, "x.rego"), []byte("package x\n"), 0o644)
	s, err := rm.Start(d, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Input("1 + 1"); err != nil {
		t.Fatal(err)
	}
	deadline = time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		for _, e := range s.Events(0) {
			if e.Stream == "stdout" && strings.Contains(e.Text, "2") {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Errorf("REPL produced no result: %+v", s.Events(0))
}
