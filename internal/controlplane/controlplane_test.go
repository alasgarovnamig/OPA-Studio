package controlplane

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/alasgarovnamig/opa-studio/internal/bundle"
)

func gz(t *testing.T, b []byte) []byte {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	_, _ = w.Write(b)
	_ = w.Close()
	return buf.Bytes()
}

func TestDecisionLogs(t *testing.T) {
	s, err := Open(t.TempDir(), 3, 10)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	events := `[{"decision_id":"1","path":"app/rbac/allow","result":true},{"decision_id":"2","path":"app/other","result":false}]`
	if n, err := s.IngestDecisions(gz(t, []byte(events)), "1.2.3.4", 1<<20); err != nil || n != 2 {
		t.Fatalf("ingest gzip = %d, %v", n, err)
	}
	if n, err := s.IngestDecisions([]byte(`{"decision_id":"3","path":"app/rbac/allow"}`), "x", 1<<20); err != nil || n != 1 {
		t.Fatalf("ingest single = %d, %v", n, err)
	}
	items, total := s.Decisions(DecisionQuery{Path: "app/rbac"})
	if total != 2 || items[0].DecisionID != "3" {
		t.Errorf("filtered = %d %+v", total, items)
	}
	_, _ = s.IngestDecisions([]byte(`[{"decision_id":"4"},{"decision_id":"5"}]`), "x", 1<<20)
	all, total := s.Decisions(DecisionQuery{})
	if total != 3 || all[0].DecisionID != "5" {
		t.Errorf("ring buffer = %d %+v", total, all)
	}
	if _, err := s.IngestDecisions([]byte("garbage"), "x", 1<<20); err == nil {
		t.Error("garbage must fail")
	}
	if _, err := s.IngestDecisions(gz(t, bytes.Repeat([]byte("a"), 2048)), "x", 1024); err == nil {
		t.Error("oversized decompressed payload must fail")
	}
	if err := s.ClearDecisions(); err != nil {
		t.Fatal(err)
	}
	if _, total := s.Decisions(DecisionQuery{}); total != 0 {
		t.Error("clear failed")
	}
}

func TestStatus(t *testing.T) {
	s, _ := Open(t.TempDir(), 10, 10)
	defer s.Close()
	if err := s.IngestStatus([]byte(`{"labels":{"id":"a","version":"1.0.0"},"plugins":{}}`), "r", 1<<20); err != nil {
		t.Fatal(err)
	}
	_ = s.IngestStatus([]byte(`{"labels":{"id":"a"}}`), "r", 1<<20)
	_ = s.IngestStatus([]byte(`{"labels":{"id":"b"}}`), "r", 1<<20)
	if len(s.Instances()) != 2 || len(s.Statuses("a", 0)) != 2 {
		t.Errorf("instances=%d statuses=%d", len(s.Instances()), len(s.Statuses("a", 0)))
	}
}

func TestBundlesAndDiscovery(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir, 10, 10)
	src := t.TempDir()
	_ = os.WriteFile(filepath.Join(src, "a.rego"), []byte("package a"), 0o644)
	archive, _ := bundle.Build(src, map[string]any{"revision": "rev-1"})
	m, err := s.PublishBundle("app", "test", archive)
	if err != nil || m.Revision != "rev-1" {
		t.Fatalf("publish = %+v, %v", m, err)
	}
	if _, err := s.PublishBundle("../evil", "x", archive); err == nil {
		t.Error("invalid name must fail")
	}
	if _, err := s.PublishBundle("bad", "x", []byte("nope")); err == nil {
		t.Error("invalid archive must fail")
	}
	s.RecordFetch("app", "client", false)
	s.RecordFetch("app", "client", true)
	s.Close()

	// Reopen: metadata survives restarts.
	s2, _ := Open(dir, 10, 10)
	defer s2.Close()
	meta, b, err := s2.Bundle("app")
	if err != nil || meta.Downloads != 1 || meta.NotModified != 1 || !bytes.Equal(b, archive) {
		t.Fatalf("reloaded = %+v, %v", meta, err)
	}

	cfg, _ := json.Marshal(map[string]any{"decision_logs": map[string]any{"console": true}})
	if err := s2.PutDiscovery(&Discovery{Name: "d", Decision: "example.discovery", Config: cfg}); err != nil {
		t.Fatal(err)
	}
	db, err := s2.DiscoveryBundle("d")
	if err != nil {
		t.Fatal(err)
	}
	sum, _ := bundle.Inspect(db)
	found := false
	for _, e := range sum.Entries {
		if e.Path == "example/discovery/data.json" {
			found = true
		}
	}
	if !found {
		t.Errorf("discovery bundle entries = %+v", sum.Entries)
	}
	if err := s2.PutDiscovery(&Discovery{Name: "x", Decision: "a", Config: []byte(`[1]`)}); err == nil {
		t.Error("non-object config must fail")
	}
	if err := s2.DeleteBundle("app"); err != nil {
		t.Fatal(err)
	}
}
