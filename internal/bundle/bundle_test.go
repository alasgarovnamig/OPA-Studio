package bundle

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, dir, name, content string) {
	t.Helper()
	p := filepath.Join(dir, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestBuildInspectExtract(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "app/rbac.rego", "package app.rbac\n")
	write(t, dir, "data.json", `{"a":1}`)
	write(t, dir, "README.md", "ignored")
	write(t, dir, ".hidden/x.rego", "package hidden")
	write(t, dir, "input.json", `{"user":"x"}`)

	archive, err := Build(dir, map[string]any{"revision": "r1", "roots": []string{"app"}})
	if err != nil {
		t.Fatal(err)
	}
	s, err := Inspect(archive)
	if err != nil {
		t.Fatal(err)
	}
	paths := map[string]string{}
	for _, e := range s.Entries {
		paths[e.Path] = e.Kind
	}
	if paths["app/rbac.rego"] != "rego" || paths["data.json"] != "data" || paths[".manifest"] != "manifest" {
		t.Errorf("entries = %v", paths)
	}
	if _, ok := paths["README.md"]; ok {
		t.Error("README.md must not be bundled")
	}
	if _, ok := paths[".hidden/x.rego"]; ok {
		t.Error("hidden directories must not be bundled")
	}
	var mf map[string]any
	if err := json.Unmarshal(s.Manifest, &mf); err != nil || mf["revision"] != "r1" {
		t.Errorf("manifest = %s", s.Manifest)
	}
	// input.json is a data file name-wise only when named data.json
	if _, ok := paths["input.json"]; ok {
		t.Error("input.json must not be bundled")
	}

	out := t.TempDir()
	names, err := Extract(archive, out)
	if err != nil || len(names) != 3 {
		t.Fatalf("extract = %v, %v", names, err)
	}
	if b, _ := os.ReadFile(filepath.Join(out, "app", "rbac.rego")); string(b) != "package app.rbac\n" {
		t.Errorf("extracted = %q", b)
	}
	if ETag(archive) == "" || ETag(archive) != ETag(append([]byte{}, archive...)) {
		t.Error("ETag must be deterministic")
	}
}

func TestBuildIsReproducible(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "a.rego", "package a\n")
	a, _ := Build(dir, nil)
	b, _ := Build(dir, nil)
	if string(a) != string(b) {
		t.Error("identical input must produce identical archives (stable ETags)")
	}
}

func TestFromData(t *testing.T) {
	archive, err := FromData(map[string]any{"example/discovery": map[string]any{"bundles": map[string]any{}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	s, err := Inspect(archive)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Entries) != 1 || s.Entries[0].Path != "example/discovery/data.json" {
		t.Errorf("entries = %+v", s.Entries)
	}
}

func TestInspectRejectsGarbage(t *testing.T) {
	if _, err := Inspect([]byte("not a tarball")); err == nil {
		t.Error("expected error")
	}
}
