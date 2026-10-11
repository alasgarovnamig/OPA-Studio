package opacli

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestValidateArgsSandbox(t *testing.T) {
	r := New(Options{Sandbox: true})
	bad := [][]string{
		{"eval", "-d", "/etc", "data"},
		{"eval", "-d", "../secret", "data"},
		{"eval", "--data=/etc/passwd", "data"},
		{"eval", "-d", "x:/abs", "data"},
		{"eval", "-d", "~/x", "data"},
		{"run", "-s"},
		{},
	}
	for _, a := range bad {
		if err := r.ValidateArgs(a); err == nil {
			t.Errorf("ValidateArgs(%q) should fail", a)
		}
	}
	good := [][]string{
		{"eval", "-d", ".", "--format", "json", "data.x == \"/a\""},
		{"build", "-b", ".", "-o", "bundle.tar.gz"},
		{"eval", "--capabilities", "https://example.com/caps.json", "x"},
		{"test", "policies/a_test.rego"},
	}
	for _, a := range good {
		if err := r.ValidateArgs(a); err != nil {
			t.Errorf("ValidateArgs(%q) = %v", a, err)
		}
	}
	if err := New(Options{Sandbox: false}).ValidateArgs([]string{"eval", "-d", "/etc", "x"}); err != nil {
		t.Errorf("sandbox off should allow absolute paths: %v", err)
	}
}

func TestSafeJoin(t *testing.T) {
	root := t.TempDir()
	for _, bad := range []string{"..", "../x", "a/../../x", "."} {
		if _, err := SafeJoin(root, bad); err == nil {
			t.Errorf("SafeJoin(%q) should fail", bad)
		}
	}
	p, err := SafeJoin(root, "/a/b.rego")
	if err != nil || p != filepath.Join(root, "a", "b.rego") {
		t.Errorf("SafeJoin = %q, %v", p, err)
	}
}

// fakeOPA writes a shell script standing in for the opa binary.
func fakeOPA(t *testing.T, body string) *Binary {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake requires a POSIX shell")
	}
	p := filepath.Join(t.TempDir(), "opa")
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"+body+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return &Binary{Path: p, Version: "v1.0.0"}
}

func TestRunCollectsFilesAndChanges(t *testing.T) {
	bin := fakeOPA(t, `case "$1" in
fmt) printf 'package x\n' > policy.rego ;;
build) printf 'BUNDLE' > bundle.tar.gz ;;
env) env ;;
sleep) sleep 5 ;;
esac
echo "args: $*"`)
	r := New(Options{Binary: bin, Timeout: 2 * time.Second, MaxOutput: 1 << 20, Concurrency: 2, TmpRoot: t.TempDir()})

	res, err := r.Run(context.Background(), &Request{Args: []string{"fmt", "-w", "policy.rego"}, Files: map[string]string{"policy.rego": "package   x"}}, "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Changed["policy.rego"] != "package x\n" {
		t.Errorf("changed = %v", res.Changed)
	}
	if !strings.Contains(res.Stdout, "args: fmt -w policy.rego") {
		t.Errorf("stdout = %q", res.Stdout)
	}

	res, err = r.Run(context.Background(), &Request{Args: []string{"build"}, Collect: []string{"bundle.tar.gz"}}, "")
	if err != nil {
		t.Fatal(err)
	}
	if f := res.Files["bundle.tar.gz"]; f.Base64 != "QlVORExF" {
		t.Errorf("collected = %+v", res.Files)
	}

	t.Setenv("OPA_STUDIO_AUTH_TOKEN", "super-secret")
	res, err = r.Run(context.Background(), &Request{Args: []string{"env"}}, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(res.Stdout, "super-secret") {
		t.Error("environment must be scrubbed")
	}

	res, err = r.Run(context.Background(), &Request{Args: []string{"sleep"}, TimeoutSeconds: 1}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !res.TimedOut {
		t.Error("expected timeout")
	}
}

func TestRunCopiesWorkspaceWithoutHiddenFiles(t *testing.T) {
	src := t.TempDir()
	_ = os.WriteFile(filepath.Join(src, "a.rego"), []byte("package a"), 0o644)
	_ = os.WriteFile(filepath.Join(src, ".studio-workspace.json"), []byte("{}"), 0o644)
	bin := fakeOPA(t, `ls -a`)
	r := New(Options{Binary: bin, Timeout: 5 * time.Second, MaxOutput: 1 << 20, TmpRoot: t.TempDir()})
	res, err := r.Run(context.Background(), &Request{Args: []string{"x"}}, src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Stdout, "a.rego") || strings.Contains(res.Stdout, ".studio-workspace.json") {
		t.Errorf("listing = %q", res.Stdout)
	}
}

func TestOutputCap(t *testing.T) {
	bin := fakeOPA(t, `i=0; while [ $i -lt 2000 ]; do echo 0123456789; i=$((i+1)); done`)
	r := New(Options{Binary: bin, Timeout: 5 * time.Second, MaxOutput: 1000, TmpRoot: t.TempDir()})
	res, err := r.Run(context.Background(), &Request{Args: []string{"x"}}, "")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Truncated || len(res.Stdout) != 1000 {
		t.Errorf("truncated=%v len=%d", res.Truncated, len(res.Stdout))
	}
}

func TestNoBinary(t *testing.T) {
	r := New(Options{})
	if _, err := r.Run(context.Background(), &Request{Args: []string{"eval"}}, ""); err != ErrNoBinary {
		t.Errorf("err = %v", err)
	}
}
